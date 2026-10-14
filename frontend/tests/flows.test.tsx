import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ProductDetail, Session, ShortlistItem } from "../src/api/types";

const products: ProductDetail[] = [
  {
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
    description: "A curved wooden chair with a quiet, compact silhouette.",
  },
  {
    id: 2,
    slug: "mesa-table-002",
    title: "Mesa Table",
    category: "table",
    material: "metal",
    color: "charcoal",
    price_jpy: 42000,
    dimensions_cm: { width: 120, depth: 70, height: 74 },
    availability: "made_to_order",
    illustration_key: "table-01",
    description: "A broad tabletop supported by a simple metal frame.",
  },
  {
    id: 3,
    slug: "reed-desk-003",
    title: "Reed Desk",
    category: "desk",
    material: "wood",
    color: "ivory",
    price_jpy: 28500,
    dimensions_cm: { width: 100, depth: 55, height: 72 },
    availability: "unavailable",
    illustration_key: "desk-01",
    description: "A narrow desk for a small workspace.",
  },
  {
    id: 4,
    slug: "bay-sofa-004",
    title: "Bay Sofa",
    category: "sofa",
    material: "fabric",
    color: "sage",
    price_jpy: 96000,
    dimensions_cm: { width: 160, depth: 80, height: 75 },
    availability: "in_stock",
    illustration_key: "sofa-01",
    description: "A low fabric sofa with room for two.",
  },
];
const session: Session = {
  session_ref: "flows-session",
  csrf_token: "flows-token",
  csrf_expires_at: "2026-10-15T01:00:00.000000Z",
  session_expires_at: "2026-11-14T00:00:00.000000Z",
};

function response(data: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function failure(status: number, message: string, code = "request_failed") {
  return response({ error: { code, message, details: [] } }, status);
}
type Override = (
  url: URL,
  init?: RequestInit,
) => Response | Promise<Response> | undefined;

function mockApi(override?: Override, initialItems: ShortlistItem[] = []) {
  let items = initialItems;
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const overridden = override?.(url, init);
    if (overridden !== undefined) return Promise.resolve(overridden);
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/session")
      return Promise.resolve(response({ data: session }));
    if (url.pathname === "/api/shortlist")
      return Promise.resolve(
        response({ data: items, meta: { total: items.length } }),
      );
    if (url.pathname === "/api/shortlist/items" && method === "POST") {
      const { product_id: id } = JSON.parse(String(init?.body)) as {
        product_id: number;
      };
      const product = products.find((item) => item.id === id);
      if (!product)
        return Promise.resolve(failure(404, "Product not found.", "not_found"));
      if (!items.some((item) => item.product.id === id))
        items = [
          { product, added_at: "2026-10-15T00:00:00.000000Z" },
          ...items,
        ];
      return Promise.resolve(
        response({ data: { product_id: id, saved: true } }),
      );
    }
    if (
      url.pathname.startsWith("/api/shortlist/items/") &&
      method === "DELETE"
    ) {
      items = items.filter(
        (item) => item.product.id !== Number(url.pathname.split("/").at(-1)),
      );
      return Promise.resolve(response(undefined, 204));
    }
    if (url.pathname === "/api/filters")
      return Promise.resolve(
        response({
          data: {
            categories: ["chair", "desk", "sofa", "table"],
            materials: ["fabric", "metal", "wood"],
            price_jpy: { min: 19800, max: 96000 },
            dimensions_cm: {
              width: { min: 52, max: 160 },
              depth: { min: 54, max: 80 },
              height: { min: 72, max: 80 },
            },
          },
        }),
      );
    if (url.pathname === "/api/products")
      return Promise.resolve(
        response({
          data: products,
          meta: {
            page: Number(url.searchParams.get("page") ?? 1),
            page_size: 12,
            total: 36,
            total_pages: 3,
          },
        }),
      );
    if (url.pathname.startsWith("/api/products/")) {
      const product = products.find(
        (item) =>
          item.slug ===
          decodeURIComponent(url.pathname.split("/").at(-1) ?? ""),
      );
      return Promise.resolve(
        product
          ? response({ data: product })
          : failure(404, "Product not found.", "not_found"),
      );
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Current location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate("/products/mesa-table-002")}>
        Open Mesa directly
      </button>
    </>
  );
}
function setup(path = "/products", state?: unknown) {
  const queryIndex = path.indexOf("?");
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: queryIndex < 0 ? path : path.slice(0, queryIndex),
            search: queryIndex < 0 ? "" : path.slice(queryIndex),
            state,
          },
        ]}
      >
        <App />
        <LocationProbe />
      </MemoryRouter>,
    ),
  };
}
async function readyCatalog() {
  await screen.findByRole("heading", { name: "Cove Chair" });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save Cove Chair to shortlist" }),
    ).toBeEnabled(),
  );
}
async function chooseComparison(
  user: ReturnType<typeof userEvent.setup>,
  titles: string[],
) {
  for (const title of titles)
    await user.click(
      screen.getByRole("button", { name: `Add ${title} to comparison` }),
    );
}

describe("product details", () => {
  it("renders every specification and returns to the exact filtered catalog URL", async () => {
    mockApi();
    const path =
      "/products?category=chair&material=wood&sort=price_desc&page=2";
    const { user } = setup(path);
    await readyCatalog();
    await user.click(screen.getByRole("link", { name: "Cove Chair" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Cove Chair" }),
    ).toBeVisible();
    const main = screen.getByRole("main");
    expect(within(main).getByText(products[0]!.description)).toBeVisible();
    expect(within(main).getByText("19,800")).toBeVisible();
    const specs = main.querySelector("dl")!;
    for (const value of [
      "52 cm",
      "54 cm",
      "80 cm",
      "chair",
      "wood",
      "natural",
      "In stock",
    ])
      expect(within(specs).getByText(value)).toBeVisible();
    expect(within(main).getByRole("img")).toHaveAttribute("loading", "eager");
    expect(
      screen.getByRole("link", { name: /Back to catalog/ }),
    ).toHaveAttribute("href", path);
    await user.click(screen.getByRole("link", { name: /Back to catalog/ }));
    await readyCatalog();
    expect(screen.getByLabelText("Current location")).toHaveTextContent(path);
    expect(screen.getByRole("checkbox", { name: "Chair" })).toBeChecked();
    expect(screen.getByLabelText("Sort by")).toHaveValue("price_desc");
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
  });

  it.each([
    undefined,
    { from: "https://example.com/products" },
    { from: "//example.com/products" },
    { from: "/shortlist" },
    { from: "/products?sort=unknown" },
    { from: "/products#content" },
    { from: "/\\[" },
    { from: ["/products"] },
  ])(
    "uses the catalog fallback for direct or unsafe navigation state %j",
    async (state) => {
      mockApi();
      setup("/products/cove-chair-001", state);
      await screen.findByRole("heading", { level: 1, name: "Cove Chair" });
      expect(
        screen.getByRole("link", { name: /Back to catalog/ }),
      ).toHaveAttribute("href", "/products");
    },
  );

  it.each([
    [400, "This product link is invalid."],
    [404, "This piece is off the shelf."],
  ])("shows a clear terminal state for an API %i", async (status, heading) => {
    mockApi((url) =>
      url.pathname === "/api/products/missing"
        ? failure(status, "Product link unavailable.")
        : undefined,
    );
    setup("/products/missing");
    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    expect(screen.getByRole("alert")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Retry product details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse the catalog" }),
    ).toHaveAttribute("href", "/products");
  });

  it("retries a temporary detail failure and reveals the product", async () => {
    let fail = true;
    mockApi((url) =>
      url.pathname === "/api/products/cove-chair-001" && fail
        ? failure(503, "The database is busy.")
        : undefined,
    );
    const { user } = setup("/products/cove-chair-001");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The database is busy.",
    );
    fail = false;
    await user.click(
      screen.getByRole("button", { name: "Retry product details" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Cove Chair" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not flash an old product after slug navigation even when fetch ignores abort", async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    mockApi((url, init) => {
      if (url.pathname !== "/api/products/cove-chair-001") return;
      oldSignal = init?.signal ?? undefined;
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    });
    const { user } = setup("/products/cove-chair-001");
    expect(screen.getByText("Loading product details…")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Open Mesa directly" }),
    );
    await screen.findByRole("heading", { level: 1, name: "Mesa Table" });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      resolveOld?.(response({ data: products[0] }));
    });
    expect(
      screen.queryByRole("heading", { name: "Cove Chair" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Mesa Table" }),
    ).toBeVisible();
  });
});

describe("comparison", () => {
  it("enforces three distinct selections and renders an accessible table from individual detail requests", async () => {
    const fetchMock = mockApi();
    const { user } = setup();
    await readyCatalog();
    await chooseComparison(user, ["Cove Chair", "Mesa Table", "Reed Desk"]);
    const fourth = screen.getByRole("button", {
      name: "Add Bay Sofa to comparison",
    });
    expect(fourth).toBeDisabled();
    expect(fourth).toHaveAttribute("aria-describedby", "compare-limit-note");
    expect(
      screen.getByText(
        "Comparison holds three products. Remove one to add another.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Comparison selection" }).children,
    ).toHaveLength(3);
    await user.click(
      screen.getByRole("button", { name: "Remove Cove Chair from comparison" }),
    );
    expect(fourth).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Add Cove Chair to comparison" }),
    );
    await user.click(
      screen.getByRole("link", { name: "Compare selected products" }),
    );
    const table = await screen.findByRole("table", {
      name: "Furniture comparison",
    });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(4);
    for (const label of [
      "Price (JPY)",
      "Width (cm)",
      "Depth (cm)",
      "Height (cm)",
      "Category",
      "Material",
      "Color",
      "Availability",
    ])
      expect(
        within(table).getByRole("rowheader", { name: label }),
      ).toHaveAttribute("scope", "row");
    expect(
      within(table).getByRole("row", { name: "Width (cm) 120 100 52" }),
    ).toBeVisible();
    expect(
      within(table).getByRole("cell", { name: "Made to order" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Product comparison table" }),
    ).toHaveAttribute("tabindex", "0");
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).startsWith("/api/products/"),
      ),
    ).toHaveLength(3);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/compare"),
      ),
    ).toBe(false);
    await user.click(
      within(table).getByRole("button", {
        name: "Remove Mesa Table from comparison",
      }),
    );
    const updatedTable = await screen.findByRole("table", {
      name: "Furniture comparison",
    });
    expect(
      within(updatedTable).queryByRole("link", { name: "Mesa Table" }),
    ).not.toBeInTheDocument();
    expect(within(updatedTable).getAllByRole("columnheader")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Clear comparison" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Give your choices a little perspective.",
      }),
    ).toBeVisible();
  });

  it("keeps selections during navigation and clears them on a fresh app mount", async () => {
    mockApi();
    const first = setup();
    await readyCatalog();
    await chooseComparison(first.user, ["Cove Chair"]);
    await first.user.click(screen.getByRole("link", { name: "Cove Chair" }));
    await screen.findByRole("heading", { level: 1, name: "Cove Chair" });
    expect(
      screen.getByRole("button", { name: "Remove Cove Chair from comparison" }),
    ).toHaveAttribute("aria-pressed", "true");
    await first.user.click(screen.getByRole("link", { name: "Compare (1)" }));
    await screen.findByRole("table", { name: "Furniture comparison" });
    first.unmount();
    setup("/compare");
    expect(
      screen.getByRole("heading", {
        name: "Give your choices a little perspective.",
      }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Compare (0)" })).toBeVisible();
    expect(
      screen.queryByRole("complementary", {
        name: "Selected comparison products",
      }),
    ).not.toBeInTheDocument();
  });

  it("retains working columns, disables saving a missing product, and retries detail reads", async () => {
    let missing = true;
    mockApi((url) =>
      url.pathname === "/api/products/cove-chair-001" && missing
        ? failure(404, "Product not found.", "not_found")
        : undefined,
    );
    const { user } = setup();
    await readyCatalog();
    await chooseComparison(user, ["Cove Chair", "Mesa Table"]);
    await user.click(
      screen.getByRole("link", { name: "Compare selected products" }),
    );
    const table = await screen.findByRole("table", {
      name: "Furniture comparison",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Some products could not be loaded.",
    );
    expect(
      within(table).getByRole("row", { name: "Width (cm) Unavailable 120" }),
    ).toBeVisible();
    expect(
      within(table).getByRole("button", {
        name: "Save Cove Chair to shortlist",
      }),
    ).toBeDisabled();
    expect(
      within(table).getByRole("button", {
        name: "Remove Cove Chair from comparison",
      }),
    ).toBeEnabled();
    missing = false;
    await user.click(
      screen.getByRole("button", { name: "Retry comparison details" }),
    );
    const refreshed = await screen.findByRole("table", {
      name: "Furniture comparison",
    });
    expect(
      within(refreshed).getByRole("row", { name: "Width (cm) 52 120" }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(refreshed).getByRole("button", {
        name: "Save Cove Chair to shortlist",
      }),
    ).toBeEnabled();
  });
});

describe("shortlist interactions", () => {
  it("keeps saved membership consistent across catalog, details, and shortlist and supports keyboard removal", async () => {
    const fetchMock = mockApi();
    const { user } = setup();
    await readyCatalog();
    const save = screen.getByRole("button", {
      name: "Save Cove Chair to shortlist",
    });
    save.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("button", {
      name: "Remove Cove Chair from shortlist",
    });
    expect(screen.getByRole("link", { name: "Shortlist (1)" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Cove Chair" }));
    await screen.findByRole("heading", { level: 1, name: "Cove Chair" });
    expect(
      screen.getByRole("button", { name: "Remove Cove Chair from shortlist" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("link", { name: "Shortlist (1)" }));
    const saved = await screen.findByRole("list", { name: "Saved products" });
    expect(
      within(saved).getByRole("link", { name: "Cove Chair" }),
    ).toBeVisible();
    const remove = within(saved).getByRole("button", {
      name: "Remove Cove Chair from shortlist",
    });
    remove.focus();
    await user.keyboard(" ");
    await screen.findByRole("heading", {
      name: "A little room for favorites.",
    });
    expect(screen.getByRole("link", { name: "Shortlist (0)" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Catalog" }));
    await readyCatalog();
    expect(
      screen.getByRole("button", { name: "Save Cove Chair to shortlist" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });

  it("disables saving during bootstrap and presents shortlist loading before its empty state", async () => {
    let resolveSession: ((value: Response) => void) | undefined;
    mockApi((url) =>
      url.pathname === "/api/session"
        ? new Promise<Response>((resolve) => {
            resolveSession = resolve;
          })
        : undefined,
    );
    const { user } = setup();
    await screen.findByRole("heading", { name: "Cove Chair" });
    expect(
      screen.getByRole("button", { name: "Save Cove Chair to shortlist" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("link", { name: "Shortlist" }));
    expect(screen.getByText("Loading your shortlist…")).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "A little room for favorites." }),
    ).not.toBeInTheDocument();
    await act(async () => {
      resolveSession?.(response({ data: session }));
    });
    expect(
      await screen.findByRole("heading", {
        name: "A little room for favorites.",
      }),
    ).toBeVisible();
  });

  it("shows a read error instead of an empty shortlist and recovers through an explicit refresh", async () => {
    let fail = true;
    mockApi((url) =>
      url.pathname === "/api/shortlist" && fail
        ? failure(503, "The database is busy.")
        : undefined,
    );
    const { user } = setup("/shortlist");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The database is busy.",
    );
    expect(
      screen.getByRole("heading", { name: "Your shortlist needs a refresh." }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "A little room for favorites." }),
    ).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Refresh shortlist" }));
    expect(
      await screen.findByRole("heading", {
        name: "A little room for favorites.",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps a pending save disabled across route changes and waits for confirmed membership", async () => {
    let resolveWrite: ((value: Response) => void) | undefined;
    let confirmed = false;
    const fetchMock = mockApi((url, init) => {
      if (url.pathname === "/api/shortlist/items" && init?.method === "POST")
        return new Promise<Response>((resolve) => {
          resolveWrite = resolve;
        });
      if (url.pathname === "/api/shortlist" && confirmed)
        return response({
          data: [
            { product: products[0], added_at: "2026-10-15T00:00:00.000000Z" },
          ],
          meta: { total: 1 },
        });
    });
    const { user } = setup();
    await readyCatalog();
    await user.click(
      screen.getByRole("button", { name: "Save Cove Chair to shortlist" }),
    );
    expect(
      screen.getByRole("button", { name: "Save Cove Chair to shortlist" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save Cove Chair to shortlist" }),
    ).toHaveTextContent("Updating…");
    await user.click(screen.getByRole("link", { name: "Cove Chair" }));
    await screen.findByRole("heading", { level: 1, name: "Cove Chair" });
    const detailSave = screen.getByRole("button", {
      name: "Save Cove Chair to shortlist",
    });
    expect(detailSave).toBeDisabled();
    await user.click(detailSave);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    confirmed = true;
    await act(async () => {
      resolveWrite?.(response({ data: { product_id: 1, saved: true } }));
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Remove Cove Chair from shortlist",
        }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("link", { name: "Shortlist (1)" })).toBeVisible();
  });
});
