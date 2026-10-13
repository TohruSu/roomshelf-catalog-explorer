import type { FieldIssue } from "../api/types";

export const categories = [
  "bed",
  "chair",
  "desk",
  "sofa",
  "storage",
  "table",
] as const;
export const materials = ["fabric", "glass", "metal", "mixed", "wood"] as const;
export const sortOptions = [
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "title_asc", label: "Name: A to Z" },
] as const;

export type Sort = (typeof sortOptions)[number]["value"];
export interface CatalogQuery {
  q: string;
  category: string[];
  material: string[];
  min_price?: number;
  max_price?: number;
  max_width?: number;
  sort: Sort;
  page: number;
  page_size: number;
}
export type ParsedQuery =
  { ok: true; query: CatalogQuery } | { ok: false; issues: FieldIssue[] };
export const defaultQuery: CatalogQuery = {
  q: "",
  category: [],
  material: [],
  sort: "featured",
  page: 1,
  page_size: 12,
};
const scalarKeys = [
  "q",
  "min_price",
  "max_price",
  "max_width",
  "sort",
  "page",
  "page_size",
];
const allowedKeys = new Set([...scalarKeys, "category", "material"]);

export function normalizeSearch(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function parseCatalogQuery(params: URLSearchParams): ParsedQuery {
  const issues: FieldIssue[] = [];
  for (const key of new Set(params.keys())) {
    if (!allowedKeys.has(key))
      issues.push({ field: key, message: "Unknown query parameter." });
  }
  for (const key of scalarKeys) {
    if (params.getAll(key).length > 1)
      issues.push({ field: key, message: "Use this parameter only once." });
  }
  const q = normalizeSearch(params.get("q") ?? "");
  if ([...q].length > 100)
    issues.push({ field: "q", message: "Use no more than 100 characters." });
  if (q && q.split(" ").length > 8)
    issues.push({
      field: "q",
      message: "Use no more than eight search terms.",
    });
  const facet = (
    key: "category" | "material",
    vocabulary: readonly string[],
  ) => {
    const values = [...new Set(params.getAll(key))].sort();
    if (values.some((value) => !vocabulary.includes(value)))
      issues.push({ field: key, message: `Choose a valid ${key}.` });
    return values;
  };
  const integer = (
    key: string,
    min: number,
    max: number,
    fallback?: number,
  ) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/u.test(raw) || Number(raw) < min || Number(raw) > max) {
      issues.push({
        field: key,
        message: `Enter a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`,
      });
      return fallback;
    }
    return Number(raw);
  };
  const min_price = integer("min_price", 0, 2147483647);
  const max_price = integer("max_price", 0, 2147483647);
  const max_width = integer("max_width", 1, 1000);
  if (
    min_price !== undefined &&
    max_price !== undefined &&
    min_price > max_price
  )
    issues.push({
      field: "max_price",
      message: "Maximum price must be at least the minimum price.",
    });
  const sort = params.get("sort") ?? "featured";
  if (!sortOptions.some((option) => option.value === sort))
    issues.push({ field: "sort", message: "Choose a valid sort order." });
  const query: CatalogQuery = {
    q,
    category: facet("category", categories),
    material: facet("material", materials),
    min_price,
    max_price,
    max_width,
    sort: sort as Sort,
    page: integer("page", 1, 10000, 1) ?? 1,
    page_size: integer("page_size", 1, 48, 12) ?? 12,
  };
  return issues.length ? { ok: false, issues } : { ok: true, query };
}

export function serializeCatalogQuery(query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  const q = normalizeSearch(query.q);
  if (q) params.set("q", q);
  for (const value of [...new Set(query.category)].sort())
    params.append("category", value);
  for (const value of [...new Set(query.material)].sort())
    params.append("material", value);
  for (const key of ["min_price", "max_price", "max_width"] as const) {
    if (query[key] !== undefined) params.set(key, String(query[key]));
  }
  if (query.sort !== "featured") params.set("sort", query.sort);
  if (query.page !== 1) params.set("page", String(query.page));
  if (query.page_size !== 12) params.set("page_size", String(query.page_size));
  return params;
}
