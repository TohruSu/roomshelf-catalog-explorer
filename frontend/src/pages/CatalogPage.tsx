import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { CatalogResponse, Filters } from "../api/types";
import { useRequest } from "../api/useRequest";
import {
  defaultQuery,
  parseCatalogQuery,
  serializeCatalogQuery,
  sortOptions,
} from "../catalog/query";
import type { CatalogQuery, Sort } from "../catalog/query";
import { FilterPanel } from "../components/FilterPanel";
import { ProductCard } from "../components/ProductCard";
import { ShortlistFeedback } from "../components/ShortlistFeedback";
import { usePageNavigation } from "../navigation/usePageNavigation";
import { useCatalogPosition } from "../navigation/catalogNavigation";

export function CatalogPage() {
  usePageNavigation("Catalog | RoomShelf");
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const parsed = useMemo(
    () => parseCatalogQuery(new URLSearchParams(search)),
    [search],
  );
  const [attempt, setAttempt] = useState(0);
  const [resetVersion, setResetVersion] = useState(0);
  const canonical = parsed.ok
    ? serializeCatalogQuery(parsed.query).toString()
    : null;
  useEffect(() => {
    if (canonical !== null && canonical !== search)
      setSearchParams(new URLSearchParams(canonical), { replace: true });
  }, [canonical, search, setSearchParams]);
  const products = useRequest<CatalogResponse>(
    parsed.ok
      ? `/api/products?${serializeCatalogQuery(parsed.query).toString()}`
      : null,
    attempt,
  );
  const filters = useRequest<{ data: Filters }>("/api/filters", attempt);
  const changeQuery = (query: CatalogQuery) =>
    setSearchParams(serializeCatalogQuery(query));
  const reset = () => {
    setResetVersion((value) => value + 1);
    changeQuery({ ...defaultQuery, category: [], material: [] });
  };
  const query = parsed.ok ? parsed.query : defaultQuery;
  const total = products.data?.meta.total ?? 0;
  const first =
    products.data && products.data.data.length
      ? (products.data.meta.page - 1) * products.data.meta.page_size + 1
      : 0;
  const last =
    first && products.data ? first + products.data.data.length - 1 : 0;
  const active =
    query.category.length +
    query.material.length +
    (query.q ? 1 : 0) +
    [query.min_price, query.max_price, query.max_width].filter(
      (value) => value !== undefined,
    ).length;
  const retry = () => setAttempt((value) => value + 1);
  const invalidRequest = products.error?.status === 400;
  useCatalogPosition(
    parsed.ok &&
      canonical === search &&
      !products.loading &&
      !products.error &&
      !filters.loading,
    `/products${canonical ? `?${canonical}` : ""}`,
  );

  return (
    <main id="main-content" className="catalog-main" tabIndex={-1}>
      <section className="catalog-intro" aria-labelledby="catalog-title">
        <div>
          <p className="eyebrow">
            <span aria-hidden="true">01</span> / The collection
          </p>
          <h1 id="catalog-title" tabIndex={-1}>
            Make room
            <br />
            for the everyday<span>.</span>
          </h1>
        </div>
        <div className="intro-aside">
          <p>
            Thoughtful shapes. Useful dimensions. <br />
            Explore individual pieces at your own pace.
          </p>
          <span className="intro-line" aria-hidden="true" />
          <p className="intro-note">
            A fictional collection, made for discovery.
          </p>
        </div>
      </section>
      <ShortlistFeedback />
      {!parsed.ok ? (
        <section className="request-state invalid-state" role="alert">
          <p className="eyebrow">Check your filters</p>
          <h2>This catalog link has invalid filters.</h2>
          <ul>
            {parsed.issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                {issue.field}: {issue.message}
              </li>
            ))}
          </ul>
          <button className="button primary" onClick={reset}>
            Reset filters
          </button>
        </section>
      ) : (
        <div className="catalog-layout">
          <FilterPanel
            query={query}
            filters={filters.data?.data ?? null}
            onChange={changeQuery}
            onReset={reset}
            resetVersion={resetVersion}
          />
          <section
            className="catalog-results"
            aria-label="Catalog results"
            aria-busy={products.loading}
          >
            <div className="catalog-toolbar">
              <div className="result-count" role="status" aria-live="polite">
                <span>
                  {products.error
                    ? "Results unavailable"
                    : products.data
                      ? `${total} ${total === 1 ? "product" : "products"}`
                      : "Exploring the collection"}
                </span>
                <p>
                  {products.error
                    ? "Adjust your filters or try again"
                    : products.loading && products.data
                      ? "Updating results…"
                      : products.data && total > 0 && first > 0
                        ? `Showing ${first}–${last}`
                        : active
                          ? `${active} active ${active === 1 ? "filter" : "filters"}`
                          : "Find something that fits"}
                </p>
              </div>
              <div className="sort-control">
                <label htmlFor="catalog-sort">Sort by</label>
                <select
                  id="catalog-sort"
                  value={query.sort}
                  onChange={(event) =>
                    changeQuery({
                      ...query,
                      sort: event.target.value as Sort,
                      page: 1,
                    })
                  }
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {filters.error && (
              <div className="metadata-error" role="alert">
                <p>Filter ranges could not be loaded. You can still browse.</p>
                <button className="text-button" onClick={retry}>
                  Retry filter options
                </button>
              </div>
            )}
            {products.error && (
              <div className="request-state" role="alert">
                <p className="eyebrow">
                  {invalidRequest
                    ? "Check your filters"
                    : "Catalog unavailable"}
                </p>
                <h2>
                  {invalidRequest
                    ? "These filters need an adjustment."
                    : "We couldn’t load these results."}
                </h2>
                <p>{products.error.message}</p>
                {products.error.details.length > 0 && (
                  <ul>
                    {products.error.details.map((issue, index) => (
                      <li key={`${issue.field}-${index}`}>
                        {issue.field}: {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  className="button primary"
                  onClick={invalidRequest ? reset : retry}
                >
                  {invalidRequest ? "Reset filters" : "Retry"}
                </button>
              </div>
            )}
            {products.loading && !products.data && (
              <div className="initial-loading">
                <p className="sr-only" role="status">
                  Loading products…
                </p>
                <div className="product-grid" aria-hidden="true">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div className="skeleton-card" key={index}>
                      <div />
                      <span />
                      <span />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {products.data &&
              !products.error &&
              products.data.data.length > 0 && (
                <ul
                  className={`product-grid${products.loading ? " results-updating" : ""}`}
                  aria-label="Products"
                >
                  {products.data.data.map((product) => (
                    <li key={product.id}>
                      <ProductCard product={product} />
                    </li>
                  ))}
                </ul>
              )}
            {products.data &&
              products.data.data.length === 0 &&
              !products.loading &&
              !products.error && (
                <div className="request-state empty-state">
                  <span className="empty-symbol" aria-hidden="true">
                    ▤
                  </span>
                  <p className="eyebrow">A little more room</p>
                  <h2>
                    {total > 0
                      ? "This page is beyond the collection."
                      : "No products match these filters."}
                  </h2>
                  <p>
                    {total > 0
                      ? "Return to the first page to explore matching products."
                      : "Try a broader search or adjust your limits."}
                  </p>
                  {total > 0 ? (
                    <button
                      className="button primary"
                      onClick={() => changeQuery({ ...query, page: 1 })}
                    >
                      Go to first page
                    </button>
                  ) : (
                    <button className="button primary" onClick={reset}>
                      Reset filters
                    </button>
                  )}
                </div>
              )}
            {products.data && !products.error && (
              <div className="catalog-pagination">
                <div className="page-size-control">
                  <label htmlFor="page-size">Products per page</label>
                  <select
                    id="page-size"
                    value={query.page_size}
                    onChange={(event) =>
                      changeQuery({
                        ...query,
                        page_size: Number(event.target.value),
                        page: 1,
                      })
                    }
                  >
                    {[...new Set([12, 24, 48, query.page_size])]
                      .sort((a, b) => a - b)
                      .map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                  </select>
                </div>
                {products.data.meta.total_pages > 0 && (
                  <nav aria-label="Pagination">
                    <button
                      className="page-button"
                      disabled={query.page <= 1 || products.loading}
                      onClick={() =>
                        changeQuery({ ...query, page: query.page - 1 })
                      }
                      aria-label="Previous page"
                    >
                      ← <span>Previous</span>
                    </button>
                    <span className="page-indicator">
                      Page {query.page} of {products.data.meta.total_pages}
                    </span>
                    <button
                      className="page-button"
                      disabled={
                        query.page >= products.data.meta.total_pages ||
                        products.loading
                      }
                      onClick={() =>
                        changeQuery({ ...query, page: query.page + 1 })
                      }
                      aria-label="Next page"
                    >
                      <span>Next</span> →
                    </button>
                  </nav>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
