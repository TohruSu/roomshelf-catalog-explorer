import type { Product } from "../api/types";
import chair from "../assets/illustrations/chair-01.svg";
import table from "../assets/illustrations/table-01.svg";
import desk from "../assets/illustrations/desk-01.svg";
import sofa from "../assets/illustrations/sofa-01.svg";
import storage from "../assets/illustrations/storage-01.svg";
import bed from "../assets/illustrations/bed-01.svg";
import { availabilityLabels } from "../catalog/display";

const illustrations: Record<string, string> = {
  "chair-01": chair,
  "table-01": table,
  "desk-01": desk,
  "sofa-01": sofa,
  "storage-01": storage,
  "bed-01": bed,
};

export function ProductVisual({
  product,
  eager = false,
}: {
  product: Product;
  eager?: boolean;
}) {
  return (
    <div className={`product-art color-${product.color}`}>
      {illustrations[product.illustration_key] ? (
        <img
          src={illustrations[product.illustration_key]}
          alt={`Illustration of ${product.title}`}
          width="360"
          height="260"
          loading={eager ? "eager" : "lazy"}
        />
      ) : (
        <span>Illustration unavailable</span>
      )}
      <span className={`availability availability-${product.availability}`}>
        {availabilityLabels[product.availability]}
      </span>
    </div>
  );
}
