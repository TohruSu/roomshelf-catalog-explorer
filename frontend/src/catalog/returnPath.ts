import { parseCatalogQuery } from "./query";

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
  if (
    url.origin !== "http://roomshelf.local" ||
    url.pathname !== "/products" ||
    url.hash ||
    !parseCatalogQuery(url.searchParams).ok
  )
    return "/products";
  return `${url.pathname}${url.search}`;
}
