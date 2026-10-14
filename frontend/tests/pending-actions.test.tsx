import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "../src/api/types";
import { ProductActions } from "../src/components/ProductActions";
import { CompareProvider } from "../src/state/CompareProvider";
import {
  ShortlistProvider,
  useShortlist,
} from "../src/state/ShortlistProvider";

const product: Product = {
  id: 1,
  slug: "cove-chair",
  title: "Cove Chair",
  category: "chair",
  material: "wood",
  color: "natural",
  price_jpy: 19800,
  dimensions_cm: { width: 52, depth: 54, height: 80 },
  availability: "in_stock",
  illustration_key: "chair-01",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(data: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function memberships(saved: boolean) {
  const data = saved
    ? [{ product, added_at: "2026-10-14T00:00:00.000000Z" }]
    : [];
  return { data, meta: { total: data.length } };
}

function setup(initiallySaved = false, allowSave = true) {
  const writing = deferred<Response>();
  const reading = deferred<Response>();
  let reads = 0;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/session")
      return Promise.resolve(
        response({
          data: {
            session_ref: "pending-session",
            csrf_token: "pending-token",
            csrf_expires_at: "2026-10-15T00:00:00.000000Z",
            session_expires_at: "2026-11-13T00:00:00.000000Z",
          },
        }),
      );
    if (init?.method === "POST" || init?.method === "DELETE")
      return writing.promise;
    if (path === "/api/shortlist") {
      reads += 1;
      return reads === 1
        ? Promise.resolve(response(memberships(initiallySaved)))
        : reading.promise;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const toggleCalls = vi.fn();
  function Actions() {
    const shortlist = useShortlist();
    return (
      <ProductActions
        product={product}
        allowSave={allowSave}
        onShortlistToggle={(item) => {
          toggleCalls(item);
          void shortlist.toggle(item);
        }}
      />
    );
  }
  render(
    <CompareProvider>
      <ShortlistProvider>
        <Actions />
        <button>Another action</button>
      </ShortlistProvider>
    </CompareProvider>,
  );
  return {
    user: userEvent.setup(),
    fetchMock,
    toggleCalls,
    writeCount: () =>
      fetchMock.mock.calls.filter(
        ([, init]) => init?.method === "POST" || init?.method === "DELETE",
      ).length,
    readCount: () => reads,
    finishWrite: () =>
      writing.resolve(
        initiallySaved
          ? response(undefined, 204)
          : response({ data: { product_id: product.id, saved: true } }),
      ),
    failWrite: () =>
      writing.resolve(
        response(
          {
            error: {
              code: "request_failed",
              message: "The database is busy.",
              details: [],
            },
          },
          503,
        ),
      ),
    finishRead: () => reading.resolve(response(memberships(!initiallySaved))),
  };
}

describe("pending product actions", () => {
  it.each([
    [false, "Save Cove Chair to shortlist"],
    [true, "Remove Cove Chair from shortlist"],
  ])(
    "keeps %s membership action focused and suppresses repeat activation until the server read completes",
    async (initiallySaved, label) => {
      const view = setup(initiallySaved);
      const button = screen.getByRole("button", {
        name: "Save Cove Chair to shortlist",
      });
      // Before bootstrap, the action is unavailable even to a direct click.
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(view.writeCount()).toBe(0);
      await waitFor(() => expect(button).toBeEnabled());
      expect(button).toHaveAccessibleName(label);
      button.focus();
      await view.user.keyboard("{Enter}");
      await waitFor(() =>
        expect(button).toHaveAttribute("aria-disabled", "true"),
      );
      expect(button).toHaveFocus();
      expect(button).not.toBeDisabled();
      await view.user.keyboard("{Enter} ");
      fireEvent.click(button);
      expect(view.writeCount()).toBe(1);
      expect(view.toggleCalls).toHaveBeenCalledTimes(1);

      await act(async () => view.finishWrite());
      await waitFor(() => expect(view.readCount()).toBe(2));
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveTextContent("Updating…");
      await view.user.keyboard("{Enter} ");
      expect(view.writeCount()).toBe(1);
      expect(view.toggleCalls).toHaveBeenCalledTimes(1);

      await act(async () => view.finishRead());
      await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute("aria-pressed", String(!initiallySaved));
      expect(view.writeCount()).toBe(1);
    },
  );

  it("retains focus while an uncertain write is reconciled with loading state", async () => {
    const view = setup();
    const button = screen.getByRole("button", {
      name: "Save Cove Chair to shortlist",
    });
    await waitFor(() => expect(button).toBeEnabled());
    button.focus();
    await view.user.keyboard("{Enter}");
    await act(async () => view.failWrite());
    await waitFor(() => expect(view.readCount()).toBe(2));
    expect(button).toHaveFocus();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    await view.user.keyboard("{Enter} ");
    fireEvent.click(button);
    expect(view.writeCount()).toBe(1);
    expect(view.toggleCalls).toHaveBeenCalledTimes(1);
    await act(async () => view.finishRead());
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(view.writeCount()).toBe(1);
  });

  it("does not take focus back after the user leaves a pending action", async () => {
    const view = setup();
    const button = screen.getByRole("button", {
      name: "Save Cove Chair to shortlist",
    });
    await waitFor(() => expect(button).toBeEnabled());
    button.focus();
    await view.user.keyboard("{Enter}");
    await waitFor(() =>
      expect(button).toHaveAttribute("aria-disabled", "true"),
    );
    const another = screen.getByRole("button", { name: "Another action" });
    another.focus();
    await act(async () => view.finishWrite());
    await act(async () => view.finishRead());
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
    expect(another).toHaveFocus();
    expect(view.writeCount()).toBe(1);
  });

  it("keeps saving natively disabled where it is not allowed", async () => {
    const view = setup(false, false);
    const button = screen.getByRole("button", {
      name: "Save Cove Chair to shortlist",
    });
    await waitFor(() => expect(view.readCount()).toBe(1));
    expect(button).toBeDisabled();
    await view.user.click(button);
    fireEvent.click(button);
    expect(view.writeCount()).toBe(0);
  });
});
