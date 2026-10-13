import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { CatalogResponse, Filters, Product } from "../src/api/types";

const filters: Filters = {
  categories: ["bed", "chair", "desk", "sofa", "storage", "table"],
  materials: ["fabric", "glass", "metal", "mixed", "wood"],
  price_jpy: { min: 4500, max: 248000 },
  dimensions_cm: {
    width: { min: 30, max: 220 },
    depth: { min: 28, max: 210 },
    height: { min: 30, max: 190 },
  },
};
const product: Product = {
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
};
function catalog(
  data: Product[] = [product],
  total = data.length,
  page = 1,
): CatalogResponse {
  return {
    data,
    meta: { total, page, page_size: 12, total_pages: Math.ceil(total / 12) },
  };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function mockRequests(
  productRequest: (url: URL) => Response | Promise<Response> = () =>
    response(catalog()),
) {
  const mock = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/filters")
      return Promise.resolve(response({ data: filters }));
    return Promise.resolve(productRequest(url));
  });
  vi.stubGlobal("fetch", mock);
  return mock;
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
      <button onClick={() => navigate(-1)}>Go back</button>
      <button onClick={() => navigate(1)}>Go forward</button>
    </>
  );
}
function setup(path = "/products") {
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    ),
  };
}
function currentQuery() {
  return new URLSearchParams(
    screen.getByLabelText("Current location").textContent?.split("?")[1] ?? "",
  );
}

describe("catalog browsing", () => {
  it("redirects the index, renders local illustrations and specifications, and omits unimplemented product actions", async () => {
    mockRequests();
    setup("/");
    expect(
      await screen.findByRole("heading", { name: "Cove Chair" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      "/products",
    );
    const list = screen.getByRole("list", { name: "Products" });
    expect(within(list).getByText("19,800")).toBeVisible();
    expect(within(list).getByText("52 × 54 × 80 cm")).toBeVisible();
    expect(within(list).getByRole("img")).toHaveAttribute(
      "src",
      expect.stringMatching(
        /^(?:\/src\/assets\/illustrations\/chair-01\.svg|data:image\/svg\+xml)/u,
      ),
    );
    expect(within(list).queryByRole("button")).not.toBeInTheDocument();
    expect(within(list).queryByRole("link")).not.toBeInTheDocument();
  });

  it("hydrates controls from a canonical URL and applies repeated facets without submitting search drafts", async () => {
    const fetchMock = mockRequests();
    const { user } = setup(
      "/products?category=chair&material=wood&min_price=01000&page=03&sort=price_desc",
    );
    await screen.findByRole("heading", { name: "Cove Chair" });
    expect(screen.getByRole("checkbox", { name: "Chair" })).toBeChecked();
    expect(screen.getByLabelText("Min price (JPY)")).toHaveValue("1000");
    expect(currentQuery().get("page")).toBe("3");
    await user.type(screen.getByLabelText("Search furniture"), "draft");
    await user.click(screen.getByRole("checkbox", { name: "Table" }));
    await waitFor(() =>
      expect(currentQuery().getAll("category")).toEqual(["chair", "table"]),
    );
    expect(currentQuery().has("page")).toBe(false);
    expect(currentQuery().has("q")).toBe(false);
    expect(screen.getByLabelText("Search furniture")).toHaveValue("draft");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain(
      "category=chair&category=table",
    );
  });

  it("applies search, limits, sort, and custom page size with a page reset", async () => {
    mockRequests();
    const { user } = setup("/products?page=2&page_size=7");
    await screen.findByRole("heading", { name: "Cove Chair" });
    await user.type(screen.getByLabelText("Search furniture"), "  Cove  ");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(currentQuery().get("q")).toBe("Cove");
    expect(currentQuery().has("page")).toBe(false);
    expect(screen.getByLabelText("Products per page")).toHaveValue("7");
    await user.type(screen.getByLabelText("Min price (JPY)"), "10000");
    await user.type(screen.getByLabelText("Max price (JPY)"), "60000");
    await user.type(screen.getByLabelText("Maximum width (cm)"), "90");
    await user.click(screen.getByRole("button", { name: /Apply limits/ }));
    expect(currentQuery().get("min_price")).toBe("10000");
    expect(currentQuery().get("max_price")).toBe("60000");
    expect(currentQuery().get("max_width")).toBe("90");
    await user.selectOptions(screen.getByLabelText("Sort by"), "price_asc");
    expect(currentQuery().get("sort")).toBe("price_asc");
    await user.selectOptions(screen.getByLabelText("Products per page"), "24");
    expect(currentQuery().get("page_size")).toBe("24");
    expect(currentQuery().has("page")).toBe(false);
  });

  it("keeps valid applied results while invalid draft bounds are corrected", async () => {
    const fetchMock = mockRequests();
    const { user } = setup();
    await screen.findByRole("heading", { name: "Cove Chair" });
    const count = fetchMock.mock.calls.length;
    await user.type(screen.getByLabelText("Min price (JPY)"), "20000");
    await user.type(screen.getByLabelText("Max price (JPY)"), "10000");
    await user.click(screen.getByRole("button", { name: /Apply limits/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Maximum price must be at least the minimum price.",
    );
    expect(screen.getByLabelText("Max price (JPY)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(fetchMock).toHaveBeenCalledTimes(count);
    expect(screen.getByRole("heading", { name: "Cove Chair" })).toBeVisible();
    await user.clear(screen.getByLabelText("Max price (JPY)"));
    await user.type(screen.getByLabelText("Max price (JPY)"), "40000");
    await user.click(screen.getByRole("button", { name: /Apply limits/ }));
    expect(currentQuery().get("max_price")).toBe("40000");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("restores URL controls and pagination through Back and Forward", async () => {
    mockRequests((url) =>
      response(
        catalog([product], 36, Number(url.searchParams.get("page") ?? 1)),
      ),
    );
    const { user } = setup();
    await screen.findByRole("heading", { name: "Cove Chair" });
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 3")).toBeVisible());
    await user.click(screen.getByRole("checkbox", { name: "Chair" }));
    expect(currentQuery().has("page")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(currentQuery().get("page")).toBe("2");
    expect(screen.getByRole("checkbox", { name: "Chair" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Go forward" }));
    expect(screen.getByRole("checkbox", { name: "Chair" })).toBeChecked();
    expect(currentQuery().has("page")).toBe(false);
  });

  it("shows invalid URLs without requesting products and can reset", async () => {
    const fetchMock = mockRequests();
    const { user } = setup("/products?page_size=49&sort=unknown");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This catalog link has invalid filters.",
    );
    expect(
      fetchMock.mock.calls.every(([input]) =>
        String(input).includes("/api/filters"),
      ),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await screen.findByRole("heading", { name: "Cove Chair" });
    expect(currentQuery().size).toBe(0);
  });

  it("restores applied search and numeric controls after history navigation", async () => {
    mockRequests();
    const { user } = setup("/products?q=Cove&min_price=5000&max_width=90");
    await screen.findByRole("heading", { name: "Cove Chair" });
    await user.clear(screen.getByLabelText("Search furniture"));
    await user.type(screen.getByLabelText("Search furniture"), "Table{Enter}");
    await user.clear(screen.getByLabelText("Min price (JPY)"));
    await user.type(screen.getByLabelText("Min price (JPY)"), "9000");
    await user.click(screen.getByRole("button", { name: /Apply limits/ }));
    await user.clear(screen.getByLabelText("Search furniture"));
    await user.type(screen.getByLabelText("Search furniture"), "unfinished");
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByLabelText("Search furniture")).toHaveValue("Table");
    expect(screen.getByLabelText("Min price (JPY)")).toHaveValue("5000");
    await user.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByLabelText("Search furniture")).toHaveValue("Cove");
    expect(screen.getByLabelText("Maximum width (cm)")).toHaveValue("90");
    await user.click(screen.getByRole("button", { name: "Go forward" }));
    expect(screen.getByLabelText("Search furniture")).toHaveValue("Table");
  });

  it("handles an empty result with a reset and never shows Page 1 of 0", async () => {
    mockRequests((url) =>
      response(url.searchParams.has("q") ? catalog([], 0) : catalog()),
    );
    const { user } = setup("/products?q=missing");
    await screen.findByRole("heading", {
      name: "No products match these filters.",
    });
    expect(
      screen.queryByRole("navigation", { name: "Pagination" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Page 1 of 0")).not.toBeInTheDocument();
    const state = screen.getByRole("heading", {
      name: "No products match these filters.",
    }).parentElement!;
    await user.click(
      within(state).getByRole("button", { name: "Reset filters" }),
    );
    await screen.findByRole("heading", { name: "Cove Chair" });
    expect(screen.getByLabelText("Search furniture")).toHaveValue("");
  });

  it("clears unfinished drafts when Reset filters is selected", async () => {
    mockRequests();
    const { user } = setup();
    await screen.findByRole("heading", { name: "Cove Chair" });
    await user.type(screen.getByLabelText("Search furniture"), "unfinished");
    await user.type(screen.getByLabelText("Min price (JPY)"), "5000");
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByLabelText("Search furniture")).toHaveValue("");
    expect(screen.getByLabelText("Min price (JPY)")).toHaveValue("");
  });

  it("renders network failure and recovers on Retry", async () => {
    let fail = true;
    mockRequests(() => {
      if (fail) return Promise.reject(new TypeError("Offline"));
      return response(catalog());
    });
    const { user } = setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the catalog.",
    );
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { name: "Cove Chair" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("handles the casefold-expanded query boundary and recovers by editing or resetting", async () => {
    const accepted = "ß".repeat(50);
    const rejected = "ß".repeat(51);
    const acceptedProduct = { ...product, title: "Boundary Chair" };
    const fetchMock = mockRequests((url) =>
      url.searchParams.get("q") === rejected
        ? response(
            {
              error: {
                code: "invalid_request",
                message: "Request validation failed.",
                details: [
                  {
                    field: "q",
                    message: "Use no more than 100 normalized characters.",
                  },
                ],
              },
            },
            400,
          )
        : response(
            catalog(
              url.searchParams.get("q") === accepted
                ? [acceptedProduct]
                : [product],
            ),
          ),
    );
    const { user } = setup();
    await screen.findByRole("heading", { name: "Cove Chair" });
    const search = screen.getByLabelText("Search furniture");
    await user.type(search, accepted);
    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { name: "Boundary Chair" });
    expect(currentQuery().get("q")).toBe(accepted);
    expect(
      screen.queryByRole("heading", { name: "Cove Chair" }),
    ).not.toBeInTheDocument();
    expect(
      new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost")
        .searchParams.get("q"),
    ).toBe(accepted);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.type(search, "ß");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "q: Use no more than 100 normalized characters.",
    );
    expect(currentQuery().get("q")).toBe(rejected);
    expect(search).toHaveValue(rejected);
    expect(
      new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost")
        .searchParams.get("q"),
    ).toBe(rejected);
    expect(
      screen.queryByRole("list", { name: "Products" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cove Chair" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Boundary Chair" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Results unavailable")).toBeVisible();
    expect(screen.queryByText("1 product")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();

    await user.type(search, "{Backspace}{Enter}");
    await screen.findByRole("heading", { name: "Boundary Chair" });
    expect(currentQuery().get("q")).toBe(accepted);
    expect(search).toHaveValue(accepted);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.type(search, "ß{Enter}");
    const error = await screen.findByRole("alert");
    await user.click(
      within(error).getByRole("button", { name: "Reset filters" }),
    );
    await screen.findByRole("heading", { name: "Cove Chair" });
    expect(currentQuery().size).toBe(0);
    expect(search).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides prior rows and counts when a category refresh fails", async () => {
    mockRequests((url) =>
      url.searchParams.has("category")
        ? Promise.reject(new TypeError("Offline"))
        : response(catalog()),
    );
    const { user } = setup();
    await screen.findByRole("heading", { name: "Cove Chair" });
    await user.click(screen.getByRole("checkbox", { name: "Table" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("heading", { name: "Cove Chair" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("1 product")).not.toBeInTheDocument();
    expect(screen.getByText("Results unavailable")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Table" })).toBeChecked();
  });

  it("retains previous rows during loading and ignores an obsolete response even if fetch ignores abort", async () => {
    let resolveOld: ((value: Response) => void) | undefined;
    let resolveLatest: ((value: Response) => void) | undefined;
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/filters")
          return Promise.resolve(response({ data: filters }));
        if (!url.searchParams.has("category"))
          return Promise.resolve(response(catalog()));
        if (init?.signal) signals.push(init.signal);
        if (url.searchParams.getAll("category").length === 1)
          return new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        return new Promise<Response>((resolve) => {
          resolveLatest = resolve;
        });
      }),
    );
    const { user } = setup();
    await screen.findByRole("heading", { name: "Cove Chair" });
    await user.click(screen.getByRole("checkbox", { name: "Chair" }));
    expect(screen.getByText("Updating results…")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Cove Chair" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Table" }));
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      resolveLatest?.(
        response(catalog([{ ...product, id: 2, title: "Current Table" }])),
      );
    });
    await screen.findByRole("heading", { name: "Current Table" });
    await act(async () => {
      resolveOld?.(
        response(catalog([{ ...product, title: "Obsolete Chair" }])),
      );
    });
    expect(
      screen.queryByRole("heading", { name: "Obsolete Chair" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Current Table" }),
    ).toBeVisible();
  });

  it("shows a not-found page without treating unimplemented detail paths as implemented", () => {
    const fetchMock = mockRequests();
    setup("/products/cove-chair-001");
    expect(
      screen.getByRole("heading", { name: "This page is off the shelf." }),
    ).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
