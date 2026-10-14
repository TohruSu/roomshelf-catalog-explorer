import { parseCatalogQuery, serializeCatalogQuery } from "./query";

export function catalogReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return "/products";
  let url: URL;
  try {
    url = new URL(value, "http://roomshelf.local");
  } catch {
    return "/products";
  }
  const parsed = parseCatalogQuery(url.searchParams);
  if (
    url.origin !== "http://roomshelf.local" ||
    url.pathname !== "/products" ||
    url.hash ||
    !parsed.ok
  )
    return "/products";
  const search = serializeCatalogQuery(parsed.query).toString();
  return `/products${search ? `?${search}` : ""}`;
}
