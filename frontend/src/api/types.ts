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

export interface ProductDetail extends Product {
  description: string;
}

export interface ProductDetailResponse {
  data: ProductDetail;
}

export interface Session {
  session_ref: string;
  csrf_token: string;
  csrf_expires_at: string;
  session_expires_at: string;
}

export interface SessionResponse {
  data: Session;
}

export interface ShortlistItem {
  product: Product;
  added_at: string;
}

export interface ShortlistResponse {
  data: ShortlistItem[];
  meta: { total: number };
}

export interface SaveShortlistResponse {
  data: { product_id: number; saved: true };
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
