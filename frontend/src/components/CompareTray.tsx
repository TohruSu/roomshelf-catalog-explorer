import { Link } from "react-router-dom";
import { useCompare } from "../state/CompareProvider";

export function CompareTray() {
  const compare = useCompare();
  if (compare.products.length === 0) return null;
  return (
    <aside className="compare-tray" aria-label="Selected comparison products">
      <div>
        <p className="eyebrow">Side by side</p>
        <p className="compare-count" role="status" aria-live="polite">
          {compare.products.length} of 3 products selected
        </p>
        <p id="compare-limit-note" className="compare-note">
          {compare.products.length === 3
            ? "Comparison holds three products. Remove one to add another."
            : "Choose up to three products. Comparison clears when you reload."}
        </p>
        {compare.error && <p role="alert">{compare.error}</p>}
      </div>
      <ul aria-label="Comparison selection">
        {compare.products.map((product) => (
          <li key={product.id}>
            <span>{product.title}</span>
            <button
              aria-label={`Remove ${product.title} from comparison selection`}
              onClick={() => compare.remove(product.id)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="tray-actions">
        <Link className="button primary" to="/compare">
          Compare selected products
        </Link>
        <button className="text-button" onClick={compare.clear}>
          Clear comparison
        </button>
      </div>
    </aside>
  );
}
