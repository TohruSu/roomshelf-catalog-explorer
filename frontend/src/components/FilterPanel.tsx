import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import type { Filters, FieldIssue } from "../api/types";
import {
  categories,
  materials,
  parseCatalogQuery,
  serializeCatalogQuery,
} from "../catalog/query";
import type { CatalogQuery } from "../catalog/query";

const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
interface Props {
  query: CatalogQuery;
  filters: Filters | null;
  onChange: (query: CatalogQuery) => void;
  onReset: () => void;
  resetVersion: number;
}

export function FilterPanel({
  query,
  filters,
  onChange,
  onReset,
  resetVersion,
}: Props) {
  const [search, setSearch] = useState(query.q);
  const [minPrice, setMinPrice] = useState(query.min_price?.toString() ?? "");
  const [maxPrice, setMaxPrice] = useState(query.max_price?.toString() ?? "");
  const [maxWidth, setMaxWidth] = useState(query.max_width?.toString() ?? "");
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const location = useLocation();
  const navigationType = useNavigationType();
  const disclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const openOnDesktop = () => {
      if (window.innerWidth > 700 && disclosure.current)
        disclosure.current.open = true;
    };
    window.addEventListener("resize", openOnDesktop);
    return () => window.removeEventListener("resize", openOnDesktop);
  }, []);
  useEffect(() => {
    setSearch(query.q);
  }, [query.q]);
  useEffect(() => {
    if (resetVersion > 0) {
      setSearch("");
      setMinPrice("");
      setMaxPrice("");
      setMaxWidth("");
      setIssues([]);
    }
  }, [resetVersion]);
  useEffect(() => {
    setMinPrice(query.min_price?.toString() ?? "");
    setMaxPrice(query.max_price?.toString() ?? "");
    setMaxWidth(query.max_width?.toString() ?? "");
    setIssues([]);
  }, [query.min_price, query.max_price, query.max_width]);
  useEffect(() => {
    if (navigationType === "POP") {
      setSearch(query.q);
      setMinPrice(query.min_price?.toString() ?? "");
      setMaxPrice(query.max_price?.toString() ?? "");
      setMaxWidth(query.max_width?.toString() ?? "");
      setIssues([]);
    }
  }, [
    location.key,
    navigationType,
    query.q,
    query.min_price,
    query.max_price,
    query.max_width,
  ]);

  const submit = (kind: "search" | "limits") => {
    const params = serializeCatalogQuery({ ...query, page: 1 });
    if (kind === "search") params.set("q", search);
    else {
      for (const [key, value] of [
        ["min_price", minPrice],
        ["max_price", maxPrice],
        ["max_width", maxWidth],
      ]) {
        if (!key || value === undefined) continue;
        if (value.trim() === "") params.delete(key);
        else params.set(key, value);
      }
    }
    const parsed = parseCatalogQuery(params);
    if (!parsed.ok) {
      setIssues(parsed.issues);
      return;
    }
    setIssues([]);
    onChange(parsed.query);
  };
  const facetToggle = (
    facet: "category" | "material",
    value: string,
    checked: boolean,
  ) => {
    onChange({
      ...query,
      page: 1,
      [facet]: checked
        ? [...query[facet], value]
        : query[facet].filter((item) => item !== value),
    });
  };
  const reset = () => {
    setSearch("");
    setMinPrice("");
    setMaxPrice("");
    setMaxWidth("");
    setIssues([]);
    onReset();
  };
  const issueFor = (field: string) =>
    issues.find((issue) => issue.field === field);
  return (
    <aside className="filter-panel" aria-label="Catalog filters">
      <details className="filter-disclosure" open ref={disclosure}>
        <summary>
          <span>Filters</span>
          <span className="filter-summary-mark" aria-hidden="true">
            ＋
          </span>
        </summary>
        <div className="filter-body">
          <div className="filter-heading">
            <h2>Find your fit</h2>
            <button className="text-button" onClick={reset}>
              Reset filters
            </button>
          </div>
          <form
            className="search-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit("search");
            }}
          >
            <label htmlFor="catalog-search">Search furniture</label>
            <div className="search-input">
              <input
                id="catalog-search"
                type="search"
                placeholder="Try a name or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-invalid={Boolean(issueFor("q"))}
                aria-describedby={issueFor("q") ? "search-error" : undefined}
              />
              <button aria-label="Search" type="submit">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  aria-hidden="true"
                >
                  <circle cx="10.5" cy="10.5" r="6.5" />
                  <path d="m15.5 15.5 5 5" />
                </svg>
              </button>
            </div>
            {issueFor("q") && (
              <p className="field-error" id="search-error" role="alert">
                {issueFor("q")?.message}
              </p>
            )}
          </form>
          <fieldset className="facet">
            <legend>Category</legend>
            <div className="facet-options">
              {(filters?.categories ?? categories).map((value) => (
                <label className="checkbox-label" key={value}>
                  <input
                    type="checkbox"
                    checked={query.category.includes(value)}
                    onChange={(event) =>
                      facetToggle("category", value, event.target.checked)
                    }
                  />
                  <span>{label(value)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="facet">
            <legend>Material</legend>
            <div className="facet-options">
              {(filters?.materials ?? materials).map((value) => (
                <label className="checkbox-label" key={value}>
                  <input
                    type="checkbox"
                    checked={query.material.includes(value)}
                    onChange={(event) =>
                      facetToggle("material", value, event.target.checked)
                    }
                  />
                  <span>{label(value)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <form
            className="limits-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit("limits");
            }}
          >
            <fieldset className="facet">
              <legend>
                Price <span className="unit-label">JPY</span>
              </legend>
              <div className="price-inputs">
                <div>
                  <label htmlFor="min-price">Min price (JPY)</label>
                  <input
                    id="min-price"
                    inputMode="numeric"
                    placeholder={filters?.price_jpy.min?.toString() ?? "Any"}
                    value={minPrice}
                    onChange={(event) => setMinPrice(event.target.value)}
                    aria-invalid={Boolean(issueFor("min_price"))}
                    aria-describedby={
                      issueFor("min_price") ? "limits-errors" : undefined
                    }
                  />
                </div>
                <span aria-hidden="true">—</span>
                <div>
                  <label htmlFor="max-price">Max price (JPY)</label>
                  <input
                    id="max-price"
                    inputMode="numeric"
                    placeholder={filters?.price_jpy.max?.toString() ?? "Any"}
                    value={maxPrice}
                    onChange={(event) => setMaxPrice(event.target.value)}
                    aria-invalid={Boolean(issueFor("max_price"))}
                    aria-describedby={
                      issueFor("max_price") ? "limits-errors" : undefined
                    }
                  />
                </div>
              </div>
            </fieldset>
            <div className="width-input">
              <label htmlFor="max-width">Maximum width (cm)</label>
              <input
                id="max-width"
                inputMode="numeric"
                placeholder="Any width"
                value={maxWidth}
                onChange={(event) => setMaxWidth(event.target.value)}
                aria-invalid={Boolean(issueFor("max_width"))}
                aria-describedby={
                  issueFor("max_width") ? "limits-errors" : undefined
                }
              />
            </div>
            {issues.some((issue) => issue.field !== "q") && (
              <ul className="field-error" id="limits-errors" role="alert">
                {issues
                  .filter((issue) => issue.field !== "q")
                  .map((issue) => (
                    <li key={issue.field}>{issue.message}</li>
                  ))}
              </ul>
            )}
            <button className="button apply-button" type="submit">
              Apply limits <span aria-hidden="true">→</span>
            </button>
          </form>
          <p className="filter-footnote">
            All dimensions are in centimetres.
            <br />
            Prices describe a fictional catalog.
          </p>
        </div>
      </details>
    </aside>
  );
}
