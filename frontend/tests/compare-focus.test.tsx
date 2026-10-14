import { useEffect, type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { ProductDetail } from "../src/api/types";
import { CompareTray } from "../src/components/CompareTray";
import { ComparePage } from "../src/pages/ComparePage";
import { CompareProvider, useCompare } from "../src/state/CompareProvider";
import { ShortlistProvider } from "../src/state/ShortlistProvider";

const products: ProductDetail[] = ["Cove Chair", "Mesa Table", "Reed Desk"].map(
  (title, index) => ({
    id: index + 1,
    slug: `${title.toLowerCase().replaceAll(" ", "-")}-00${index + 1}`,
    title,
    category: "chair",
    material: "wood",
    color: "natural",
    price_jpy: 19800,
    dimensions_cm: { width: 52, depth: 54, height: 80 },
    availability: "in_stock",
    illustration_key: "chair-01",
    description: "A compact wooden piece.",
  }),
);

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(
  override?: (path: string) => Response | Promise<Response> | undefined,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    const overridden = override?.(path);
    if (overridden !== undefined) return Promise.resolve(overridden);
    if (path === "/api/session")
      return Promise.resolve(
        response({
          data: {
            session_ref: "compare-focus-session",
            csrf_token: "compare-focus-token",
            csrf_expires_at: "2026-10-15T01:00:00.000000Z",
            session_expires_at: "2026-11-14T00:00:00.000000Z",
          },
        }),
      );
    if (path === "/api/shortlist")
      return Promise.resolve(response({ data: [], meta: { total: 0 } }));
    const product = products.find(
      (item) => path === `/api/products/${item.slug}`,
    );
    if (product) return Promise.resolve(response({ data: product }));
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function SelectionControls({ initial }: { initial: ProductDetail[] }) {
  const { add, remove, clear } = useCompare();
  useEffect(() => {
    for (const product of initial) add(product);
  }, [initial, add]);
  return (
    <>
      <button onClick={() => remove(1)}>Remove Cove elsewhere</button>
      <button onClick={clear}>Clear elsewhere</button>
    </>
  );
}

function setup(initial = products, showPage = true, mainControls?: ReactNode) {
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter initialEntries={[showPage ? "/compare" : "/products"]}>
        <CompareProvider>
          <ShortlistProvider>
            <nav className="main-navigation" aria-label="Main navigation">
              <Link to="/products">Catalog</Link>
            </nav>
            <SelectionControls initial={initial} />
            {showPage ? (
              <ComparePage />
            ) : (
              <main id="main-content">
                <h1 tabIndex={-1}>Furniture catalog</h1>
                {mainControls}
              </main>
            )}
            <CompareTray />
          </ShortlistProvider>
        </CompareProvider>
      </MemoryRouter>,
    ),
  };
}

function removal(title: string) {
  return screen.getByRole("button", {
    name: `Remove ${title} from comparison`,
  });
}

function trayRemoval(title: string) {
  return screen.getByRole("button", {
    name: `Remove ${title} from comparison selection`,
  });
}

async function readyTable() {
  await screen.findByRole("table", { name: "Furniture comparison" });
}

describe("comparison removal focus", () => {
  it.each([
    ["Cove Chair", "Mesa Table"],
    ["Mesa Table", "Reed Desk"],
    ["Reed Desk", "Mesa Table"],
  ])(
    "moves keyboard focus from %s to the adjacent %s control without refetching",
    async (removed, adjacent) => {
      const fetchMock = mockApi();
      const { user } = setup();
      await readyTable();
      const destination = removal(adjacent);
      const focus = vi.spyOn(destination, "focus");
      removal(removed).focus();
      await user.keyboard("{Enter}");
      expect(destination).toHaveFocus();
      expect(destination).toBe(removal(adjacent));
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      await waitFor(() =>
        expect(
          within(screen.getByRole("table")).getAllByRole("columnheader"),
        ).toHaveLength(3),
      );
      expect(
        fetchMock.mock.calls.filter(([path]) =>
          String(path).startsWith("/api/products/"),
        ),
      ).toHaveLength(3);
    },
  );

  it("focuses the empty-state browse action after the last keyboard removal", async () => {
    mockApi();
    const { user } = setup([products[0]!]);
    await readyTable();
    removal("Cove Chair").focus();
    await user.keyboard(" ");
    expect(
      screen.getByRole("link", { name: "Browse the catalog" }),
    ).toHaveFocus();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("keeps a surviving detail link focused during an unrelated removal", async () => {
    mockApi();
    setup();
    await readyTable();
    const remainingLink = screen.getByRole("link", { name: "Mesa Table" });
    remainingLink.focus();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Cove elsewhere" }),
    );
    expect(remainingLink).toHaveFocus();
    expect(remainingLink).toBe(
      screen.getByRole("link", { name: "Mesa Table" }),
    );
    await waitFor(() => expect(removal("Mesa Table")).toBeInTheDocument());
    expect(remainingLink).toHaveFocus();
  });

  it("does not take focus for a removal event from an unfocused control", async () => {
    mockApi();
    setup();
    await readyTable();
    const catalog = screen.getByRole("link", { name: "Catalog" });
    catalog.focus();
    fireEvent.click(removal("Mesa Table"));
    expect(catalog).toHaveFocus();
    await waitFor(() => expect(removal("Reed Desk")).toBeInTheDocument());
    expect(catalog).toHaveFocus();
  });

  it("preserves an unavailable remaining column and its focus destination", async () => {
    const fetchMock = mockApi((path) =>
      path.endsWith(products[1]!.slug)
        ? response(
            {
              error: {
                code: "unavailable",
                message: "This piece is temporarily unavailable.",
                details: [],
              },
            },
            503,
          )
        : undefined,
    );
    const { user } = setup();
    await readyTable();
    expect(
      screen.getByRole("button", { name: "Save Mesa Table to shortlist" }),
    ).toBeDisabled();
    removal("Cove Chair").focus();
    await user.keyboard("{Enter}");
    expect(removal("Mesa Table")).toHaveFocus();
    expect(
      screen.getByText("This piece is temporarily unavailable."),
    ).toBeVisible();
    expect(
      fetchMock.mock.calls.filter(([path]) =>
        String(path).startsWith("/api/products/"),
      ),
    ).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Retry comparison details" }),
    ).toBeEnabled();
  });
});

describe("comparison tray focus", () => {
  function layout(element: HTMLElement, top: number, height = 44) {
    const rect = new DOMRect(16, top, 180, height);
    vi.spyOn(element, "getClientRects").mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
    element.scrollIntoView = vi.fn();
  }

  it.each(["Clear comparison", "Remove Cove Chair from comparison selection"])(
    "keeps visible main context after %s without jumping to offscreen navigation",
    async (action) => {
      mockApi();
      const { user } = setup(
        [products[0]!],
        false,
        <>
          <label>
            Search furniture
            <input />
          </label>
          <button>Previous page</button>
          <button>Next page</button>
          <button disabled>Disabled action</button>
          <button aria-disabled="true">Unavailable action</button>
          <button style={{ visibility: "hidden" }}>Hidden action</button>
        </>,
      );
      const source = await screen.findByRole("button", { name: action });
      layout(screen.getByRole("textbox"), -1900);
      layout(screen.getByRole("button", { name: "Previous page" }), 500);
      const next = screen.getByRole("button", { name: "Next page" });
      layout(next, 560);
      layout(screen.getByRole("button", { name: "Disabled action" }), 620);
      layout(screen.getByRole("button", { name: "Unavailable action" }), 660);
      layout(screen.getByText("Hidden action"), 700);
      const nav = screen.getByRole("link", { name: "Catalog" });
      layout(nav, -2000);
      source.focus();
      await user.keyboard("{Enter}");
      expect(next).toHaveFocus();
      expect(next.scrollIntoView).not.toHaveBeenCalled();
      expect(nav.scrollIntoView).not.toHaveBeenCalled();
    },
  );

  it("reveals the nearest enabled main control when no surviving main control is in view", async () => {
    mockApi();
    const { user } = setup(
      [products[0]!],
      false,
      <>
        <label>
          Search furniture
          <input />
        </label>
        <button>Next page</button>
      </>,
    );
    const source = await screen.findByRole("button", {
      name: "Clear comparison",
    });
    layout(screen.getByRole("textbox"), -1800);
    const next = screen.getByRole("button", { name: "Next page" });
    layout(next, -100);
    source.focus();
    await user.keyboard("{Enter}");
    expect(next).toHaveFocus();
    expect(next.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
  });

  it.each([
    ["Cove Chair", "Mesa Table"],
    ["Mesa Table", "Reed Desk"],
    ["Reed Desk", "Mesa Table"],
  ])(
    "moves from %s to the adjacent %s tray removal",
    async (removed, adjacent) => {
      mockApi();
      const { user } = setup();
      await readyTable();
      const destination = trayRemoval(adjacent);
      const focus = vi.spyOn(destination, "focus");
      trayRemoval(removed).focus();
      await user.keyboard("{Enter}");
      expect(destination).toHaveFocus();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(destination).toBe(trayRemoval(adjacent));
    },
  );

  it("focuses the compare empty-state action when its last tray item disappears", async () => {
    mockApi();
    const { user } = setup([products[0]!]);
    await readyTable();
    trayRemoval("Cove Chair").focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("link", { name: "Browse the catalog" }),
    ).toHaveFocus();
  });

  it("returns focus to the catalog navigation after the last item on another route", async () => {
    mockApi();
    const { user } = setup([products[0]!], false);
    const button = await screen.findByRole("button", {
      name: "Remove Cove Chair from comparison selection",
    });
    const catalog = screen.getByRole("link", { name: "Catalog" });
    const focus = vi.spyOn(catalog, "focus");
    button.focus();
    await user.keyboard("{Enter}");
    expect(catalog).toHaveFocus();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it.each([true, false])(
    "restores meaningful focus after Clear (comparison route: %s)",
    async (showPage) => {
      mockApi();
      const { user } = setup(products, showPage);
      const button = await screen.findByRole("button", {
        name: "Clear comparison",
      });
      button.focus();
      await user.keyboard("{Enter}");
      expect(
        screen.getByRole("link", {
          name: showPage ? "Browse the catalog" : "Catalog",
        }),
      ).toHaveFocus();
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    },
  );

  it("does not steal focus when selection clears elsewhere", async () => {
    mockApi();
    const { user } = setup();
    await readyTable();
    const clearElsewhere = screen.getByRole("button", {
      name: "Clear elsewhere",
    });
    await user.click(clearElsewhere);
    expect(clearElsewhere).toHaveFocus();
    expect(
      screen.getByRole("link", { name: "Browse the catalog" }),
    ).not.toHaveFocus();
  });

  it("keeps adjacent tray focus while details are loading and ignores late removed results", async () => {
    let release!: (value: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      release = resolve;
    });
    mockApi((path) => (path.endsWith(products[0]!.slug) ? delayed : undefined));
    const { user } = setup();
    await screen.findByText("Loading comparison details…");
    trayRemoval("Cove Chair").focus();
    await user.keyboard("{Enter}");
    expect(trayRemoval("Mesa Table")).toHaveFocus();
    await readyTable();
    await act(async () => release(response({ data: products[0] })));
    expect(
      screen.queryByRole("link", { name: "Cove Chair" }),
    ).not.toBeInTheDocument();
    expect(trayRemoval("Mesa Table")).toHaveFocus();
  });
});
