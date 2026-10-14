import type { Product } from "../api/types";
import { Link, useLocation } from "react-router-dom";
import { ProductActions } from "./ProductActions";
import { ProductVisual } from "./ProductVisual";
import { formatPrice } from "../catalog/display";

export function ProductCard({ product }: { product: Product }) {
  const dimensions = product.dimensions_cm;
  const location = useLocation();
  const from =
    location.pathname === "/products"
      ? `${location.pathname}${location.search}`
      : "/products";
  return (
    <article className="product-card">
      <ProductVisual product={product} />
      <div className="product-info">
        <p className="product-category">
          {product.category} <span aria-hidden="true">/</span>{" "}
          {product.material}
        </p>
        <h2>
          <Link to={`/products/${product.slug}`} state={{ from }}>
            {product.title}
          </Link>
        </h2>
        <p className="product-price">
          <span className="currency">JPY</span> {formatPrice(product.price_jpy)}
        </p>
        <div className="product-specs">
          <span>{product.color}</span>
          <span>
            <span className="sr-only">Width, depth, height: </span>
            {dimensions.width} × {dimensions.depth} × {dimensions.height} cm
          </span>
        </div>
        <ProductActions product={product} />
      </div>
    </article>
  );
}
