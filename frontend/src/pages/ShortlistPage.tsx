import { useEffect, useLayoutEffect, useRef } from "react";
import type { Product } from "../api/types";
import { Link } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { ShortlistFeedback } from "../components/ShortlistFeedback";
import { usePageNavigation } from "../navigation/usePageNavigation";
import { useShortlist } from "../state/ShortlistProvider";

interface RemovalIntent {
  id: number;
  source: HTMLButtonElement;
  neighbors: number[];
}

export function ShortlistPage() {
  const shortlist = useShortlist();
  usePageNavigation("Your Shortlist | RoomShelf");
  const removalIntent = useRef<RemovalIntent | null>(null);
  const removalButtons = useRef(new Map<number, HTMLButtonElement>());
  const browseLink = useRef<HTMLAnchorElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const cancelMovedFocus = (event: FocusEvent) => {
      const intent = removalIntent.current;
      if (
        intent &&
        event.target !== intent.source &&
        event.target !== document.body
      )
        removalIntent.current = null;
    };
    const cancelOutsidePointer = (event: PointerEvent) => {
      const intent = removalIntent.current;
      if (intent && !intent.source.contains(event.target as Node))
        removalIntent.current = null;
    };
    document.addEventListener("focusin", cancelMovedFocus);
    document.addEventListener("pointerdown", cancelOutsidePointer);
    return () => {
      document.removeEventListener("focusin", cancelMovedFocus);
      document.removeEventListener("pointerdown", cancelOutsidePointer);
      removalIntent.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const intent = removalIntent.current;
    if (!intent || shortlist.pendingIds.has(intent.id)) return;
    // Recover keyboard context from the rendered server state. This does not
    // claim that an uncertain mutation succeeded or retry the write.
    removalIntent.current = null;
    if (
      document.activeElement !== intent.source &&
      document.activeElement !== document.body
    )
      return;
    let target: HTMLElement | null | undefined;
    if (shortlist.status === "ready") {
      if (shortlist.items.some(({ product }) => product.id === intent.id))
        target = removalButtons.current.get(intent.id);
      else
        target =
          intent.neighbors
            .map((id) => removalButtons.current.get(id))
            .find((button) => button && !button.disabled) ?? browseLink.current;
    } else if (shortlist.status === "error") {
      target = main.current?.querySelector<HTMLButtonElement>(
        ".shortlist-feedback button",
      );
    }
    target ??= heading.current;
    if (target instanceof HTMLButtonElement && target.disabled) return;
    if (target !== document.activeElement)
      target?.focus({ preventScroll: true });
  }, [
    shortlist.items,
    shortlist.pendingIds,
    shortlist.status,
    shortlist.error,
  ]);

  const toggleFromShortlist = (product: Product, button: HTMLButtonElement) => {
    if (shortlist.isSaved(product.id) && document.activeElement === button) {
      const ids = shortlist.items.map((item) => item.product.id);
      const index = ids.indexOf(product.id);
      removalIntent.current = {
        id: product.id,
        source: button,
        neighbors: [...ids.slice(index + 1), ...ids.slice(0, index).reverse()],
      };
    }
    void shortlist.toggle(product);
  };
  return (
    <main
      ref={main}
      id="main-content"
      tabIndex={-1}
      className="collection-main"
      aria-busy={shortlist.status === "loading"}
    >
      <section className="collection-intro">
        <p className="eyebrow">03 / Keep a few in mind</p>
        <h1 ref={heading} tabIndex={-1}>
          Your shortlist
        </h1>
        <p>Your shortlist belongs to this browser. No account is needed.</p>
        <p>
          Saved pieces remain for 30 days from when your shortlist is created,
          including after a reload or server restart, while this browser’s
          cookie and the stored shortlist are kept. Clearing cookies or losing
          or expiring that session removes access to it.
        </p>
        <p>Comparison is temporary and clears when you reload the page.</p>
      </section>
      <ShortlistFeedback />
      {shortlist.status === "loading" && (
        <p className="collection-status" role="status">
          Loading your shortlist…
        </p>
      )}
      {shortlist.status === "error" && (
        <section className="request-state">
          <h2>Your shortlist needs a refresh.</h2>
          <p>Refresh it before saving or removing products.</p>
        </section>
      )}
      {shortlist.status === "ready" && shortlist.items.length === 0 && (
        <section className="request-state empty-state">
          <p className="eyebrow">A place to come back to</p>
          <h2>A little room for favorites.</h2>
          <p>Save individual pieces from the catalog to keep them here.</p>
          <Link ref={browseLink} className="button primary" to="/products">
            Browse the catalog
          </Link>
        </section>
      )}
      {shortlist.status === "ready" && shortlist.items.length > 0 && (
        <>
          <p className="collection-status" role="status" aria-live="polite">
            {shortlist.items.length} saved{" "}
            {shortlist.items.length === 1 ? "product" : "products"}
          </p>
          <ul
            className="product-grid shortlist-grid"
            aria-label="Saved products"
          >
            {shortlist.items.map(({ product }) => (
              <li key={product.id}>
                <ProductCard
                  product={product}
                  actionsProps={{
                    shortlistButtonRef: (button) => {
                      if (button)
                        removalButtons.current.set(product.id, button);
                      else removalButtons.current.delete(product.id);
                    },
                    onShortlistToggle: toggleFromShortlist,
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
