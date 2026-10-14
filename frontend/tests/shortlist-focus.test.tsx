import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Product, ShortlistItem } from "../src/api/types";
import { CatalogNavigationProvider } from "../src/navigation/CatalogNavigationProvider";
import { ShortlistPage } from "../src/pages/ShortlistPage";
import { CompareProvider } from "../src/state/CompareProvider";
import { ShortlistProvider } from "../src/state/ShortlistProvider";

const products: Product[] = [
  { id: 1, slug: "cove-chair", title: "Cove Chair" },
  { id: 2, slug: "mesa-table", title: "Mesa Table" },
  { id: 3, slug: "reed-desk", title: "Reed Desk" },
].map((product) => ({
  ...product,
  category: "chair",
  material: "wood",
  color: "natural",
  price_jpy: 19800,
  dimensions_cm: { width: 52, depth: 54, height: 80 },
  availability: "in_stock",
  illustration_key: "chair-01",
}));

function response(data: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function errorResponse(status: number, message: string) {
  return response(
    { error: { code: "request_failed", message, details: [] } },
    status,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function memberships(selected = products): ShortlistItem[] {
  return selected.map((product) => ({
    product,
    added_at: "2026-10-14T00:00:00.000000Z",
  }));
}
function mockApi(
  selected = products,
  override?: (
    url: URL,
    init: RequestInit | undefined,
    remove: (id: number) => void,
  ) => Promise<Response> | Response | undefined,
) {
  let items = memberships(selected);
  const remove = (id: number) => {
    items = items.filter((item) => item.product.id !== id);
  };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const overridden = override?.(url, init, remove);
    if (overridden !== undefined) return Promise.resolve(overridden);
    if (url.pathname === "/api/session")
      return Promise.resolve(
        response({
          data: {
            session_ref: "focus-session",
            csrf_token: "focus-token",
            csrf_expires_at: "2026-10-15T00:00:00.000000Z",
            session_expires_at: "2026-11-13T00:00:00.000000Z",
          },
        }),
      );
    if (url.pathname === "/api/shortlist")
      return Promise.resolve(
        response({ data: items, meta: { total: items.length } }),
      );
    if (init?.method === "DELETE") {
      remove(Number(url.pathname.split("/").at(-1)));
      return Promise.resolve(response(undefined, 204));
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
function setup() {
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter initialEntries={["/shortlist"]}>
        <CatalogNavigationProvider>
          <CompareProvider>
            <ShortlistProvider>
              <Link to="/elsewhere">Leave shortlist</Link>
              <button>Another action</button>
              <Routes>
                <Route path="/shortlist" element={<ShortlistPage />} />
                <Route path="/elsewhere" element={<h1>Another page</h1>} />
              </Routes>
            </ShortlistProvider>
          </CompareProvider>
        </CatalogNavigationProvider>
      </MemoryRouter>,
    ),
  };
}
function removeButton(title: string) {
  return screen.findByRole("button", {
    name: `Remove ${title} from shortlist`,
  });
}
async function activateRemoval(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
) {
  const button = await removeButton(title);
  button.focus();
  await user.keyboard("{Enter}");
  return button;
}
function expectRemoved(title: string) {
  return waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: `Remove ${title} from shortlist`,
      }),
    ).not.toBeInTheDocument(),
  );
}

describe("shortlist removal focus", () => {
  it.each([
    ["Cove Chair", "Mesa Table"],
    ["Mesa Table", "Reed Desk"],
    ["Reed Desk", "Mesa Table"],
  ])(
    "moves from %s to the adjacent removal control %s",
    async (removed, next) => {
      mockApi();
      const { user } = setup();
      await activateRemoval(user, removed);
      await expectRemoved(removed);
      await waitFor(async () => expect(await removeButton(next)).toHaveFocus());
    },
  );

  it("focuses Browse after the last confirmed removal", async () => {
    mockApi(products.slice(0, 1));
    const { user } = setup();
    await activateRemoval(user, "Cove Chair");
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Browse the catalog" }),
      ).toHaveFocus(),
    );
  });

  it("waits for the authoritative read before moving focus", async () => {
    const reading = deferred<Response>();
    let reads = 0;
    mockApi(products, (url) => {
      if (url.pathname === "/api/shortlist" && ++reads === 2)
        return reading.promise;
    });
    const { user } = setup();
    const source = await activateRemoval(user, "Cove Chair");
    await waitFor(() =>
      expect(source).toHaveAttribute("aria-disabled", "true"),
    );
    expect(await removeButton("Mesa Table")).not.toHaveFocus();
    await act(async () =>
      reading.resolve(
        response({ data: memberships(products.slice(1)), meta: { total: 2 } }),
      ),
    );
    await waitFor(async () =>
      expect(await removeButton("Mesa Table")).toHaveFocus(),
    );
  });

  it("restores the original viable control after a rejected removal without moving to a neighbor", async () => {
    const deleting = deferred<Response>();
    mockApi(products, (_url, init) =>
      init?.method === "DELETE" ? deleting.promise : undefined,
    );
    const { user } = setup();
    const source = await activateRemoval(user, "Cove Chair");
    await waitFor(() =>
      expect(source).toHaveAttribute("aria-disabled", "true"),
    );
    // Chromium blurs an active control when it becomes disabled.
    source.blur();
    await act(async () =>
      deleting.resolve(errorResponse(403, "Origin rejected.")),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Origin rejected.",
    );
    await waitFor(async () =>
      expect(await removeButton("Cove Chair")).toHaveFocus(),
    );
    expect(await removeButton("Mesa Table")).not.toHaveFocus();
  });

  it("recovers from an uncertain committed removal using the reconciled server list", async () => {
    mockApi(products, (url, init, remove) => {
      if (init?.method === "DELETE") {
        remove(Number(url.pathname.split("/").at(-1)));
        return errorResponse(503, "The request failed.");
      }
    });
    const { user } = setup();
    await activateRemoval(user, "Cove Chair");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be confirmed",
    );
    await expectRemoved("Cove Chair");
    await waitFor(async () =>
      expect(await removeButton("Mesa Table")).toHaveFocus(),
    );
  });

  it("restores the same removal control when reconciliation still contains the product", async () => {
    mockApi(products, (_url, init) =>
      init?.method === "DELETE"
        ? errorResponse(503, "The request failed.")
        : undefined,
    );
    const { user } = setup();
    await activateRemoval(user, "Cove Chair");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not be confirmed",
    );
    await waitFor(async () =>
      expect(await removeButton("Cove Chair")).toHaveFocus(),
    );
  });

  it("recovers to the current empty view when a lost session cancels the removal", async () => {
    let sessions = 0;
    const fetchMock = mockApi(products, (url, init, remove) => {
      if (url.pathname === "/api/session" && ++sessions > 1)
        return response({
          data: {
            session_ref: "replacement-session",
            csrf_token: "replacement-token",
            csrf_expires_at: "2026-10-15T00:00:00.000000Z",
            session_expires_at: "2026-11-13T00:00:00.000000Z",
          },
        });
      if (init?.method === "DELETE") {
        products.forEach((product) => remove(product.id));
        return errorResponse(401, "The session ended.");
      }
    });
    const { user } = setup();
    await activateRemoval(user, "Cove Chair");
    expect(await screen.findByRole("alert")).toHaveTextContent("session ended");
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Browse the catalog" }),
      ).toHaveFocus(),
    );
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("focuses the refresh action if reconciliation cannot establish membership", async () => {
    let deleting = false;
    mockApi(products, (url, init) => {
      if (init?.method === "DELETE") {
        deleting = true;
        return errorResponse(503, "The request failed.");
      }
      if (url.pathname === "/api/shortlist" && deleting)
        return errorResponse(503, "Reading failed.");
    });
    const { user } = setup();
    await activateRemoval(user, "Cove Chair");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh shortlist" }),
      ).toHaveFocus(),
    );
    expect(
      screen.queryByRole("link", { name: "Browse the catalog" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "could not be confirmed",
    );
  });

  it("keeps another action selected during a pending removal focused", async () => {
    const deleting = deferred<Response>();
    mockApi(products, (url, init, remove) => {
      if (init?.method === "DELETE") {
        remove(Number(url.pathname.split("/").at(-1)));
        return deleting.promise;
      }
    });
    const { user } = setup();
    const source = await activateRemoval(user, "Cove Chair");
    await waitFor(() =>
      expect(source).toHaveAttribute("aria-disabled", "true"),
    );
    const elsewhere = screen.getByRole("button", { name: "Another action" });
    elsewhere.focus();
    await act(async () => deleting.resolve(response(undefined, 204)));
    await expectRemoved("Cove Chair");
    expect(elsewhere).toHaveFocus();
  });

  it("cancels recovery when the user clicks elsewhere without changing focus", async () => {
    const deleting = deferred<Response>();
    mockApi(products, (url, init, remove) => {
      if (init?.method === "DELETE") {
        remove(Number(url.pathname.split("/").at(-1)));
        return deleting.promise;
      }
    });
    const { user } = setup();
    const source = await activateRemoval(user, "Cove Chair");
    await waitFor(() =>
      expect(source).toHaveAttribute("aria-disabled", "true"),
    );
    await user.pointer({
      target: screen.getByText(
        "Your shortlist belongs to this browser. No account is needed.",
      ),
      keys: "[MouseLeft]",
    });
    await act(async () => deleting.resolve(response(undefined, 204)));
    await expectRemoved("Cove Chair");
    expect(await removeButton("Mesa Table")).not.toHaveFocus();
  });

  it("does not apply a late focus intent after leaving the shortlist route", async () => {
    const deleting = deferred<Response>();
    mockApi(products, (_url, init) =>
      init?.method === "DELETE" ? deleting.promise : undefined,
    );
    const { user } = setup();
    await activateRemoval(user, "Cove Chair");
    await user.click(screen.getByRole("link", { name: "Leave shortlist" }));
    expect(screen.getByRole("heading", { name: "Another page" })).toBeVisible();
    const elsewhere = screen.getByRole("button", { name: "Another action" });
    elsewhere.focus();
    await act(async () => deleting.resolve(response(undefined, 204)));
    expect(elsewhere).toHaveFocus();
  });

  it("explains anonymous retention and temporary comparison", async () => {
    mockApi([]);
    setup();
    expect(
      screen.getByText(/Your shortlist belongs to this browser/),
    ).toBeVisible();
    expect(
      screen.getByText(/30 days from when your shortlist is created/),
    ).toHaveTextContent(
      /reload or server restart.*cookie and the stored shortlist.*Clearing cookies/s,
    );
    expect(
      screen.getByText(/Comparison is temporary and clears/),
    ).toBeVisible();
    await screen.findByRole("link", { name: "Browse the catalog" });
  });
});
