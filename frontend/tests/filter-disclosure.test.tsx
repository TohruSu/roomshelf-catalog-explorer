import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { defaultQuery, type CatalogQuery } from "../src/catalog/query";
import { FilterPanel } from "../src/components/FilterPanel";

function mockViewport(initiallyNarrow: boolean) {
  let narrow = initiallyNarrow;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    get matches() {
      return narrow;
    },
    addEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.add(listener),
    ),
    removeEventListener: vi.fn(
      (_type: string, listener: (event: MediaQueryListEvent) => void) =>
        listeners.delete(listener),
    ),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  return {
    media,
    setNarrow(value: boolean) {
      act(() => {
        narrow = value;
        for (const listener of listeners)
          listener({ matches: value } as MediaQueryListEvent);
      });
    },
    listenerCount: () => listeners.size,
  };
}

function Harness({ initialQuery }: { initialQuery: CatalogQuery }) {
  const [query, setQuery] = useState(initialQuery);
  const [resetVersion, setResetVersion] = useState(0);
  return (
    <>
      <FilterPanel
        query={query}
        filters={null}
        onChange={setQuery}
        onReset={() => {
          setQuery(defaultQuery);
          setResetVersion((version) => version + 1);
        }}
        resetVersion={resetVersion}
      />
      <button onClick={() => setQuery({ ...query, sort: "price_asc" })}>
        Change sort
      </button>
    </>
  );
}

function setup(narrow: boolean, initialQuery: CatalogQuery = defaultQuery) {
  const viewport = mockViewport(narrow);
  const rendered = render(
    <MemoryRouter>
      <Harness initialQuery={initialQuery} />
    </MemoryRouter>,
  );
  const details = rendered.container.querySelector("details");
  const summary = rendered.container.querySelector("summary");
  if (!details || !summary) throw new Error("Missing native filter disclosure");
  return {
    ...rendered,
    ...viewport,
    details,
    summary,
    user: userEvent.setup(),
  };
}

describe("responsive native filter disclosure", () => {
  it("starts collapsed on a narrow viewport without changing applied filters", () => {
    const { details, summary } = setup(true, {
      ...defaultQuery,
      q: "cove",
      category: ["chair", "table"],
      material: ["wood"],
      min_price: 0,
      max_price: 40000,
      max_width: 90,
      sort: "price_desc",
      page: 3,
      page_size: 24,
    });
    expect(details.open).toBe(false);
    expect(summary).toHaveTextContent("Filters7 active filters");
    expect(screen.getByLabelText("Search furniture")).toHaveValue("cove");
    expect(screen.getByLabelText("Min price (JPY)")).toHaveValue("0");
  });

  it("starts expanded on desktop with a native, focusable summary", () => {
    const { details, summary } = setup(false);
    expect(details.open).toBe(true);
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary).toHaveTextContent("FiltersNo active filters");
    summary.focus();
    expect(summary).toHaveFocus();
  });

  it("keeps search and numeric drafts and validation across closing and reopening", async () => {
    const { user, details, summary } = setup(true);
    await user.click(summary);
    await waitFor(() => expect(details.open).toBe(true));
    await user.type(
      screen.getByLabelText("Search furniture"),
      "unapplied draft",
    );
    await user.type(screen.getByLabelText("Min price (JPY)"), "20000");
    await user.type(screen.getByLabelText("Max price (JPY)"), "10000");
    await user.click(screen.getByRole("button", { name: /Apply limits/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Maximum price must be at least the minimum price.",
    );
    await user.click(summary);
    await waitFor(() => expect(details.open).toBe(false));
    await user.click(summary);
    await waitFor(() => expect(details.open).toBe(true));
    expect(screen.getByLabelText("Search furniture")).toHaveValue(
      "unapplied draft",
    );
    expect(screen.getByLabelText("Min price (JPY)")).toHaveValue("20000");
    expect(screen.getByLabelText("Max price (JPY)")).toHaveValue("10000");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Maximum price must be at least the minimum price.",
    );
    expect(summary).toHaveTextContent("No active filters");
  });

  it("counts applied changes, excludes drafts and sort, and preserves disclosure during reset", async () => {
    const { user, details, summary } = setup(true);
    await user.click(summary);
    await user.type(screen.getByLabelText("Search furniture"), "draft");
    expect(summary).toHaveTextContent("No active filters");
    await user.click(screen.getByRole("checkbox", { name: "Chair" }));
    expect(summary).toHaveTextContent("1 active filter");
    expect(screen.getByLabelText("Search furniture")).toHaveValue("draft");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(summary).toHaveTextContent("2 active filters");
    await user.type(screen.getByLabelText("Maximum width (cm)"), "90");
    await user.click(screen.getByRole("button", { name: /Apply limits/ }));
    expect(summary).toHaveTextContent("3 active filters");
    await user.click(summary);
    await waitFor(() => expect(details.open).toBe(false));
    await user.click(screen.getByRole("button", { name: "Change sort" }));
    expect(details.open).toBe(false);
    expect(summary).toHaveTextContent("3 active filters");
    await user.click(summary);
    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(details.open).toBe(true);
    expect(summary).toHaveTextContent("No active filters");
    expect(screen.getByLabelText("Search furniture")).toHaveValue("");
    expect(screen.getByLabelText("Maximum width (cm)")).toHaveValue("");
  });

  it.each([true, false])(
    "preserves an explicit native toggle from initial narrow=%s across breakpoints",
    async (narrow) => {
      const { user, details, summary, setNarrow } = setup(narrow);
      await user.click(summary);
      const chosenOpen = narrow;
      await waitFor(() => expect(details.open).toBe(chosenOpen));
      summary.focus();
      setNarrow(!narrow);
      expect(details.open).toBe(chosenOpen);
      expect(summary).toHaveFocus();
      setNarrow(narrow);
      expect(details.open).toBe(chosenOpen);
      expect(summary).toHaveFocus();
    },
  );

  it("tracks responsive defaults until the user chooses a disclosure state", () => {
    const { details, setNarrow } = setup(true);
    expect(details.open).toBe(false);
    setNarrow(false);
    expect(details.open).toBe(true);
    setNarrow(true);
    expect(details.open).toBe(false);
  });

  it("keeps an expanded panel and its focused input when resizing to mobile", () => {
    const { details, setNarrow } = setup(false);
    const search = screen.getByLabelText("Search furniture");
    search.focus();
    setNarrow(true);
    expect(details.open).toBe(true);
    expect(search).toHaveFocus();
  });

  it("removes the media listener on unmount", () => {
    const { unmount, listenerCount, media } = setup(true);
    expect(listenerCount()).toBe(1);
    unmount();
    expect(listenerCount()).toBe(0);
    expect(media.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });
});
