export interface Dimensions {
  width: number;
  depth: number;
  height: number;
}

export interface Product {
  id: number;
  slug: string;
  title: string;
  category: string;
  material: string;
  color: string;
  price_jpy: number;
  dimensions_cm: Dimensions;
  availability: "in_stock" | "made_to_order" | "unavailable";
  illustration_key: string;
}

export interface Range {
  min: number | null;
  max: number | null;
}

export interface Filters {
  categories: string[];
  materials: string[];
  price_jpy: Range;
  dimensions_cm: { width: Range; depth: Range; height: Range };
}

export interface CatalogResponse {
  data: Product[];
  meta: { page: number; page_size: number; total: number; total_pages: number };
}

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ErrorEnvelope {
  error: { code: string; message: string; details: FieldIssue[] };
}
