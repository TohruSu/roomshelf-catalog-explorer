import type { Product } from "../api/types";
import chair from "../assets/illustrations/chair-01.svg";
import table from "../assets/illustrations/table-01.svg";
import desk from "../assets/illustrations/desk-01.svg";
import sofa from "../assets/illustrations/sofa-01.svg";
import storage from "../assets/illustrations/storage-01.svg";
import bed from "../assets/illustrations/bed-01.svg";

const illustrations: Record<string, string> = {
  "chair-01": chair,
  "table-01": table,
  "desk-01": desk,
  "sofa-01": sofa,
  "storage-01": storage,
  "bed-01": bed,
};
const availability = {
  in_stock: "In stock",
  made_to_order: "Made to order",
  unavailable: "Unavailable",
};
const price = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function ProductCard({ product }: { product: Product }) {
  const dimensions = product.dimensions_cm;
  return (
    <article className="product-card">
      <div className={`product-art color-${product.color}`}>
        {illustrations[product.illustration_key] ? (
          <img
            src={illustrations[product.illustration_key]}
            alt={`Illustration of ${product.title}`}
            width="360"
            height="260"
            loading="lazy"
          />
        ) : (
          <span>Illustration unavailable</span>
        )}
        <span className={`availability availability-${product.availability}`}>
          {availability[product.availability]}
        </span>
      </div>
      <div className="product-info">
        <p className="product-category">
          {product.category} <span aria-hidden="true">/</span>{" "}
          {product.material}
        </p>
        <h2>{product.title}</h2>
        <p className="product-price">
          <span className="currency">JPY</span>{" "}
          {price.format(product.price_jpy)}
        </p>
        <div className="product-specs">
          <span>{product.color}</span>
          <span>
            <span className="sr-only">Width, depth, height: </span>
            {dimensions.width} × {dimensions.depth} × {dimensions.height} cm
          </span>
        </div>
      </div>
    </article>
  );
}
