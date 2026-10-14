import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ensureFocusVisible } from "../navigation/catalogNavigation";
import { useCompare } from "../state/CompareProvider";

function nearbyMainControl() {
  const main =
    document.querySelector("#main-content") ?? document.querySelector("main");
  const controls = [
    ...(main?.querySelectorAll<HTMLElement>(
      "a[href], button, input:not([type='hidden']), select, textarea, [tabindex]",
    ) ?? []),
  ].filter(
    (control) =>
      control.tabIndex >= 0 &&
      !control.matches(":disabled, [aria-disabled='true']") &&
      !control.closest("[inert], [aria-hidden='true']") &&
      control.getClientRects().length > 0 &&
      getComputedStyle(control).visibility !== "hidden",
  );
  const visible = controls.filter((control) => {
    const rect = control.getBoundingClientRect();
    return (
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      rect.right > 0 &&
      rect.left < window.innerWidth
    );
  });
  if (visible.length) return visible.at(-1);
  // If the removed tray was the only content in view, reveal the nearest
  // surviving main control instead of jumping back to the page header.
  let nearest: HTMLElement | undefined;
  let distance = Infinity;
  for (const control of controls) {
    const rect = control.getBoundingClientRect();
    const gap =
      Math.max(0, -rect.bottom, rect.top - window.innerHeight) +
      Math.max(0, -rect.right, rect.left - window.innerWidth);
    if (gap <= distance) {
      nearest = control;
      distance = gap;
    }
  }
  return nearest;
}

export function CompareTray() {
  const compare = useCompare();
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  const pendingFocus = useRef<{
    source: HTMLButtonElement;
    nextId: number | null;
  } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if (
      document.activeElement !== pending.source &&
      (pending.source.isConnected || document.activeElement !== document.body)
    )
      return;
    const destination =
      pending.nextId === null
        ? (document.querySelector<HTMLAnchorElement>(
            "[data-compare-empty-action]",
          ) ??
          nearbyMainControl() ??
          document.querySelector<HTMLAnchorElement>(
            ".main-navigation a[href='/products']",
          ))
        : removeButtons.current.get(pending.nextId);
    destination?.focus({ preventScroll: true });
    if (destination) ensureFocusVisible(destination);
  }, [compare.products]);

  function remove(productId: number, button: HTMLButtonElement) {
    if (document.activeElement === button) {
      const index = compare.products.findIndex((item) => item.id === productId);
      const next = compare.products[index + 1] ?? compare.products[index - 1];
      pendingFocus.current = { source: button, nextId: next?.id ?? null };
    }
    compare.remove(productId);
  }

  function clear(button: HTMLButtonElement) {
    if (document.activeElement === button)
      pendingFocus.current = { source: button, nextId: null };
    compare.clear();
  }

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
              ref={(button) => {
                if (button) removeButtons.current.set(product.id, button);
                else removeButtons.current.delete(product.id);
              }}
              onClick={(event) => remove(product.id, event.currentTarget)}
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
        <button
          className="text-button"
          onClick={(event) => clear(event.currentTarget)}
        >
          Clear comparison
        </button>
      </div>
    </aside>
  );
}
