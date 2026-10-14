import type { Product } from "../api/types";
import { useCompare } from "../state/CompareProvider";
import { useShortlist } from "../state/ShortlistProvider";

export function ProductActions({
  product,
  allowSave = true,
}: {
  product: Product;
  allowSave?: boolean;
}) {
  const compare = useCompare();
  const shortlist = useShortlist();
  const selected = compare.isSelected(product.id);
  const saved = shortlist.isSaved(product.id);
  const pending = shortlist.pendingIds.has(product.id);
  const atLimit = !selected && compare.products.length >= 3;

  return (
    <div className="product-actions">
      <button
        className={`action-button${saved ? " selected" : ""}`}
        aria-label={
          saved
            ? `Remove ${product.title} from shortlist`
            : `Save ${product.title} to shortlist`
        }
        aria-pressed={saved}
        disabled={!allowSave || shortlist.status !== "ready" || pending}
        onClick={() => void shortlist.toggle(product)}
      >
        {pending ? "Updating…" : saved ? "Saved" : "Save"}
      </button>
      <button
        className={`action-button${selected ? " selected" : ""}`}
        aria-label={
          selected
            ? `Remove ${product.title} from comparison`
            : `Add ${product.title} to comparison`
        }
        aria-pressed={selected}
        aria-describedby={atLimit ? "compare-limit-note" : undefined}
        disabled={atLimit}
        onClick={() => compare.toggle(product)}
      >
        {selected ? "Comparing" : "Compare"}
      </button>
    </div>
  );
}
