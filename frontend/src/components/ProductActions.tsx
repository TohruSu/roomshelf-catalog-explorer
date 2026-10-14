import type { Ref } from "react";
import type { Product } from "../api/types";
import { useCompare } from "../state/CompareProvider";
import { useShortlist } from "../state/ShortlistProvider";

export interface ProductActionsProps {
  product: Product;
  allowSave?: boolean;
  shortlistButtonRef?: Ref<HTMLButtonElement>;
  onShortlistToggle?: (product: Product, button: HTMLButtonElement) => void;
  compareButtonRef?: Ref<HTMLButtonElement>;
  onCompareToggle?: (product: Product, button: HTMLButtonElement) => void;
}

export function ProductActions({
  product,
  allowSave = true,
  shortlistButtonRef,
  onShortlistToggle,
  compareButtonRef,
  onCompareToggle,
}: ProductActionsProps) {
  const compare = useCompare();
  const shortlist = useShortlist();
  const selected = compare.isSelected(product.id);
  const saved = shortlist.isSaved(product.id);
  const pending = shortlist.pendingIds.has(product.id);
  const atLimit = !selected && compare.products.length >= 3;

  return (
    <div className="product-actions">
      <button
        ref={shortlistButtonRef}
        className={`action-button${saved ? " selected" : ""}`}
        aria-label={
          saved
            ? `Remove ${product.title} from shortlist`
            : `Save ${product.title} to shortlist`
        }
        aria-pressed={saved}
        // A pending action stays focusable until its server state is known.
        // Native disabled would move Chromium's active focus to the page body.
        disabled={!allowSave || (shortlist.status !== "ready" && !pending)}
        aria-disabled={pending || undefined}
        onClick={(event) => {
          if (!allowSave || shortlist.status !== "ready" || pending) return;
          if (onShortlistToggle)
            onShortlistToggle(product, event.currentTarget);
          else void shortlist.toggle(product);
        }}
      >
        {pending ? "Updating…" : saved ? "Saved" : "Save"}
      </button>
      <button
        ref={compareButtonRef}
        className={`action-button${selected ? " selected" : ""}`}
        aria-label={
          selected
            ? `Remove ${product.title} from comparison`
            : `Add ${product.title} to comparison`
        }
        aria-pressed={selected}
        aria-describedby={atLimit ? "compare-limit-note" : undefined}
        disabled={atLimit}
        onClick={(event) => {
          if (onCompareToggle) onCompareToggle(product, event.currentTarget);
          else compare.toggle(product);
        }}
      >
        {selected ? "Comparing" : "Compare"}
      </button>
    </div>
  );
}
