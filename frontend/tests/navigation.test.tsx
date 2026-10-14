import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ProductDetail } from "../src/api/types";
import { catalogReturnPath } from "../src/catalog/returnPath";
import { ensureFocusVisible } from "../src/navigation/catalogNavigation";

const product: ProductDetail = {
  id: 1,
  slug: "cove-chair-001",
  title: "Cove Chair",
  category: "chair",
  material: "wood",
  color: "natural",
  price_jpy: 19800,
  dimensions_cm: { width: 52, depth: 54, height: 80 },
  availability: "in_stock",
  illustration_key: "chair-01",
  description: "A compact curved chair.",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function catalog() {
  return json({
    data: [product],
    meta: { total: 36, page: 2, page_size: 12, total_pages: 3 },
  });
}
function filters() {
  return json({
    data: {
      categories: ["chair"],
      materials: ["wood"],
      price_jpy: { min: 19800, max: 19800 },
      dimensions_cm: {
        width: { min: 52, max: 52 },
        depth: { min: 54, max: 54 },
        height: { min: 80, max: 80 },
      },
    },
  });
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function api(
  override?: (url: URL) => Response | Promise<Response> | undefined,
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const replacement = override?.(url);
      if (replacement) return replacement;
      if (url.pathname === "/api/session")
        return json({
          data: {
            session_ref: "navigation-session",
            csrf_token: "navigation-token",
            csrf_expires_at: "2026-10-15T01:00:00.000000Z",
            session_expires_at: "2026-11-14T00:00:00.000000Z",
          },
        });
      if (url.pathname === "/api/shortlist")
        return json({ data: [], meta: { total: 0 } });
      if (url.pathname === "/api/filters") return filters();
      return url.pathname === "/api/products"
        ? catalog()
        : json({ data: product });
    }),
  );
}
function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>History back</button>
      <button onClick={() => navigate(1)}>History forward</button>
      <output aria-label="Location">
        {location.pathname + location.search}
      </output>
    </>
  );
}
function setup(path = "/products", strict = false) {
  const application = (
    <MemoryRouter initialEntries={[path]}>
      <App />
      <HistoryControls />
    </MemoryRouter>
  );
  return {
    user: userEvent.setup(),
    ...render(strict ? <StrictMode>{application}</StrictMode> : application),
  };
}
function scrollFixture() {
  vi.stubGlobal("scrollX", 0);
  vi.stubGlobal("scrollY", 0);
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(
    3000,
  );
  vi.spyOn(document.documentElement, "scrollWidth", "get").mockReturnValue(
    1024,
  );
  const scroll = vi.fn((options: ScrollToOptions) => {
    vi.stubGlobal("scrollX", options.left ?? 0);
    vi.stubGlobal("scrollY", options.top ?? 0);
  });
  vi.stubGlobal("scrollTo", scroll);
  return scroll;
}

afterEach(() => vi.restoreAllMocks());

describe("visible restored focus", () => {
  function target(rect: DOMRect) {
    const link = document.createElement("a");
    link.href = "/products/cove-chair-001";
    document.body.append(link);
    vi.spyOn(link, "getClientRects").mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
    vi.spyOn(link, "getBoundingClientRect").mockReturnValue(rect);
    link.scrollIntoView = vi.fn();
    return link;
  }

  it("preserves exact restored pixels when the focused title is fully visible", () => {
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("innerWidth", 390);
    const link = target(new DOMRect(20, 700, 160, 24));
    ensureFocusVisible(link);
    expect(link.scrollIntoView).not.toHaveBeenCalled();
    link.remove();
  });

  it("reveals a title clipped after the catalog reflows to a smaller viewport", () => {
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("innerWidth", 390);
    const link = target(new DOMRect(20, 843.77, 160, 16));
    ensureFocusVisible(link);
    expect(link.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
    link.remove();
  });

  it("reveals focused context clipped by a nested scroll container", () => {
    const link = target(new DOMRect(180, 50, 80, 24));
    const container = document.createElement("div");
    container.style.overflowX = "auto";
    document.body.append(container);
    container.append(link);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 120),
    );
    vi.spyOn(container, "clientWidth", "get").mockReturnValue(200);
    ensureFocusVisible(link);
    expect(link.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
    container.remove();
  });
});

describe("page navigation", () => {
  it.each([
    ["/products", "Catalog | RoomShelf", /Make room/],
    ["/compare", "Compare Products | RoomShelf", "Compare the details"],
    ["/shortlist", "Your Shortlist | RoomShelf", "Your shortlist"],
    ["/missing", "Page Not Found | RoomShelf", "This page is off the shelf."],
  ])("titles and focuses direct entry %s", (_path, title, heading) => {
    api();
    setup(String(_path));
    expect(document.title).toBe(title);
    expect(
      screen.getByRole("heading", { level: 1, name: heading }),
    ).toHaveFocus();
  });

  it("keeps search and sort control focus during query updates and history traversal", async () => {
    api();
    const { user } = setup();
    await screen.findByRole("link", { name: "Cove Chair" });
    const search = screen.getByRole("searchbox", { name: "Search furniture" });
    await user.type(search, "chair{Enter}");
    expect(search).toHaveFocus();
    const sort = screen.getByLabelText("Sort by");
    await user.selectOptions(sort, "price_asc");
    expect(sort).toHaveFocus();
    // A POP within the catalog must leave the initiating control alone.
    const back = screen.getByRole("button", { name: "History back" });
    await user.click(back);
    expect(back).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "History forward" }));
    expect(
      screen.getByRole("button", { name: "History forward" }),
    ).toHaveFocus();
    expect(document.title).toBe("Catalog | RoomShelf");
  });

  it("updates the detail title without stealing focus when loading resolves", async () => {
    const detail = deferred();
    api((url) =>
      url.pathname === `/api/products/${product.slug}`
        ? detail.promise
        : undefined,
    );
    const { user } = setup(`/products/${product.slug}`);
    expect(document.title).toBe("Product Details | RoomShelf");
    expect(screen.getByRole("main")).toHaveFocus();
    const back = screen.getByRole("link", { name: /Back to catalog/ });
    await user.tab();
    back.focus();
    await act(async () => detail.resolve(json({ data: product })));
    expect(
      await screen.findByRole("heading", { level: 1, name: product.title }),
    ).toBeVisible();
    expect(document.title).toBe("Cove Chair | RoomShelf");
    expect(back).toHaveFocus();
  });

  it("keeps the stable detail landmark focused across loading and error", async () => {
    const detail = deferred();
    api(() => detail.promise);
    setup(`/products/${product.slug}`);
    const main = screen.getByRole("main");
    expect(main).toHaveFocus();
    await act(async () =>
      detail.resolve(
        json(
          {
            error: {
              code: "not_found",
              message: "Missing product.",
              details: [],
            },
          },
          404,
        ),
      ),
    );
    await screen.findByRole("heading", {
      name: "This piece is off the shelf.",
    });
    expect(main).toHaveFocus();
    expect(document.title).toBe("Product Not Found | RoomShelf");
  });

  it("focuses the main landmark when the skip link is activated", async () => {
    api();
    const { user } = setup();
    const skip = screen.getByRole("link", { name: "Skip to content" });
    skip.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
  });
});

describe("catalog position", () => {
  const path = "/products?category=chair&sort=price_desc&page=2";

  async function leaveCatalog(
    user: ReturnType<typeof userEvent.setup>,
    scroll: ReturnType<typeof scrollFixture>,
    top = 850,
  ) {
    await screen.findByRole("link", { name: product.title });
    vi.stubGlobal("scrollY", top);
    await user.click(screen.getByRole("link", { name: product.title }));
    await screen.findByRole("heading", { level: 1, name: product.title });
    expect(document.title).toBe("Cove Chair | RoomShelf");
    expect(scroll).toHaveBeenCalledWith({
      left: 0,
      top: 0,
      behavior: "instant",
    });
    scroll.mockClear();
  }

  it.each(["Back to catalog", "History back"])(
    "waits for returning products then restores query, link focus and scroll through %s",
    async (returnLabel) => {
      const returned = deferred();
      let catalogs = 0;
      api((url) =>
        url.pathname === "/api/products" && ++catalogs === 2
          ? returned.promise
          : undefined,
      );
      const scroll = scrollFixture();
      const { user } = setup(path);
      await leaveCatalog(user, scroll);
      await user.click(
        returnLabel === "History back"
          ? screen.getByRole("button", { name: returnLabel })
          : screen.getByRole("link", { name: /Back to catalog/ }),
      );
      expect(
        screen.getByRole("heading", { level: 1, name: /Make room/ }),
      ).toHaveFocus();
      expect(scroll).not.toHaveBeenCalled();
      await act(async () => returned.resolve(catalog()));
      await waitFor(() =>
        expect(screen.getByRole("link", { name: product.title })).toHaveFocus(),
      );
      expect(screen.getByLabelText("Location")).toHaveTextContent(path);
      expect(scroll).toHaveBeenCalledExactlyOnceWith({
        left: 0,
        top: 850,
        behavior: "instant",
      });
    },
  );

  it("retains a trusted history snapshot across repeated back and forward visits", async () => {
    api();
    const scroll = scrollFixture();
    const { user } = setup(path, true);
    await leaveCatalog(user, scroll);
    await user.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: product.title })).toHaveFocus(),
    );
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 850,
      behavior: "instant",
    });
    await user.click(screen.getByRole("button", { name: "History forward" }));
    await screen.findByRole("heading", { level: 1, name: product.title });
    scroll.mockClear();
    await user.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: product.title })).toHaveFocus(),
    );
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 850,
      behavior: "instant",
    });
  });

  it("waits for filter metadata to settle before computing the restored page height", async () => {
    const metadata = deferred();
    let requests = 0;
    api((url) =>
      url.pathname === "/api/filters" && ++requests === 2
        ? metadata.promise
        : undefined,
    );
    const scroll = scrollFixture();
    const { user } = setup(path);
    await leaveCatalog(user, scroll);
    await user.click(screen.getByRole("button", { name: "History back" }));
    await screen.findByRole("link", { name: product.title });
    expect(scroll).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { level: 1, name: /Make room/ }),
    ).toHaveFocus();
    await act(async () => metadata.resolve(filters()));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: product.title })).toHaveFocus(),
    );
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 850,
      behavior: "instant",
    });
  });

  it("clamps an obsolete saved position to the current viewport and page size", async () => {
    api();
    const scroll = scrollFixture();
    const { user } = setup(path);
    await leaveCatalog(user, scroll, 4500);
    await user.click(screen.getByRole("button", { name: "History back" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: product.title })).toHaveFocus(),
    );
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 3000 - window.innerHeight,
      behavior: "instant",
    });
  });

  it("does not restore coordinates when the original product is absent from returned results", async () => {
    let requests = 0;
    api((url) =>
      url.pathname === "/api/products" && ++requests === 2
        ? json({
            data: [],
            meta: { total: 0, page: 2, page_size: 12, total_pages: 0 },
          })
        : undefined,
    );
    const scroll = scrollFixture();
    const { user } = setup(path);
    await leaveCatalog(user, scroll);
    await user.click(screen.getByRole("button", { name: "History back" }));
    await screen.findByRole("heading", {
      name: "No products match these filters.",
    });
    expect(
      screen.getByRole("heading", { level: 1, name: /Make room/ }),
    ).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();
  });

  it.each(["wheel", "focus", "scroll"])(
    "cancels delayed restoration after deliberate %s",
    async (intent) => {
      const returned = deferred();
      let catalogs = 0;
      api((url) =>
        url.pathname === "/api/products" && ++catalogs === 2
          ? returned.promise
          : undefined,
      );
      const scroll = scrollFixture();
      const { user } = setup(path);
      await leaveCatalog(user, scroll);
      await user.click(screen.getByRole("button", { name: "History back" }));
      if (intent === "wheel") fireEvent.wheel(window, { deltaY: 200 });
      if (intent === "focus") screen.getByLabelText("Search furniture").focus();
      if (intent === "scroll") {
        vi.stubGlobal("scrollY", 200);
        fireEvent.scroll(window);
      }
      await act(async () => returned.resolve(catalog()));
      await screen.findByRole("link", { name: product.title });
      expect(
        screen.getByRole("link", { name: product.title }),
      ).not.toHaveFocus();
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it("ignores the route's delayed top-reset scroll event", async () => {
    const returned = deferred();
    let catalogs = 0;
    api((url) =>
      url.pathname === "/api/products" && ++catalogs === 2
        ? returned.promise
        : undefined,
    );
    const scroll = scrollFixture();
    const { user } = setup(path);
    await leaveCatalog(user, scroll);
    vi.stubGlobal("scrollY", 300);
    await user.click(screen.getByRole("button", { name: "History back" }));
    fireEvent.scroll(window);
    scroll.mockClear();
    await act(async () => returned.resolve(catalog()));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: product.title })).toHaveFocus(),
    );
    expect(scroll).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 850,
      behavior: "instant",
    });
  });

  it("does not restore stale coordinates or card focus on query-only history POP", async () => {
    api();
    const scroll = scrollFixture();
    const { user } = setup(path);
    await leaveCatalog(user, scroll);
    await user.click(screen.getByRole("link", { name: /Back to catalog/ }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: product.title })).toHaveFocus(),
    );
    await user.selectOptions(screen.getByLabelText("Sort by"), "price_asc");
    scroll.mockClear();
    const back = screen.getByRole("button", { name: "History back" });
    await user.click(back);
    await waitFor(() =>
      expect(screen.getByLabelText("Sort by")).toHaveValue("price_desc"),
    );
    expect(back).toHaveFocus();
    expect(scroll).not.toHaveBeenCalled();
  });

  it("does not apply a late return response after navigating to a different view", async () => {
    const returned = deferred();
    let catalogs = 0;
    api((url) =>
      url.pathname === "/api/products" && ++catalogs === 2
        ? returned.promise
        : undefined,
    );
    const scroll = scrollFixture();
    const { user } = setup(path);
    await leaveCatalog(user, scroll);
    await user.click(screen.getByRole("button", { name: "History back" }));
    await user.click(screen.getByRole("link", { name: "Compare (0)" }));
    await act(async () => returned.resolve(catalog()));
    expect(
      screen.getByRole("heading", { level: 1, name: "Compare the details" }),
    ).toHaveFocus();
    expect(document.title).toBe("Compare Products | RoomShelf");
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe("catalog return URLs", () => {
  it("canonicalizes only valid catalog queries", () => {
    expect(
      catalogReturnPath(
        "/products?page=02&sort=featured&category=chair&category=chair",
      ),
    ).toBe("/products?category=chair&page=2");
  });
  it.each([
    "https://example.com/products",
    "//example.com/products",
    "/shortlist",
    "/products?sort=invalid",
    "/products#other",
    { from: "/products" },
  ])("uses a safe catalog fallback for %j", (value) => {
    expect(catalogReturnPath(value)).toBe("/products");
  });
});
