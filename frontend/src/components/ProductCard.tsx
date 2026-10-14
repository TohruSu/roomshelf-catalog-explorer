import type { Product } from "../api/types";
import { Link, useLocation } from "react-router-dom";
import { ProductActions, type ProductActionsProps } from "./ProductActions";
import { ProductVisual } from "./ProductVisual";
import { formatPrice } from "../catalog/display";
import { catalogReturnPath } from "../catalog/returnPath";
import { useCatalogNavigation } from "../navigation/catalogNavigation";

export function ProductCard({
  product,
  actionsProps,
}: {
  product: Product;
  actionsProps?: Omit<ProductActionsProps, "product">;
}) {
  const dimensions = product.dimensions_cm;
  const location = useLocation();
  const navigation = useCatalogNavigation();
  const from =
    location.pathname === "/products"
      ? catalogReturnPath(`${location.pathname}${location.search}`)
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
          <Link
            to={`/products/${product.slug}`}
            state={{
              from,
              ...(location.pathname === "/products"
                ? { catalogSourceKey: location.key }
                : {}),
            }}
            data-catalog-product-id={product.id}
            onClick={(event) => {
              if (
                location.pathname !== "/products" ||
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.shiftKey
              )
                return;
              navigation.remember({
                sourceKey: location.key,
                path: from,
                productId: product.id,
                slug: product.slug,
                x: window.scrollX,
                y: window.scrollY,
              });
            }}
          >
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
        <ProductActions {...actionsProps} product={product} />
      </div>
    </article>
  );
}
