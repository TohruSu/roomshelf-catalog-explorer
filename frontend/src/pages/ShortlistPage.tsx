import { Link } from "react-router-dom";
import { ProductCard } from "../components/ProductCard";
import { ShortlistFeedback } from "../components/ShortlistFeedback";
import { useShortlist } from "../state/ShortlistProvider";

export function ShortlistPage() {
  const shortlist = useShortlist();
  return (
    <main
      id="main-content"
      className="collection-main"
      aria-busy={shortlist.status === "loading"}
    >
      <section className="collection-intro">
        <p className="eyebrow">03 / Keep a few in mind</p>
        <h1>Your shortlist</h1>
        <p>
          Saved in this browser session. Return to a piece when you’re ready.
        </p>
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
          <Link className="button primary" to="/products">
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
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
