import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { ProductDetail } from "../api/types";
import { useRequest } from "../api/useRequest";
import { catalogReturnPath } from "../catalog/returnPath";
import { ProductActions } from "../components/ProductActions";
import { ProductVisual } from "../components/ProductVisual";
import { availabilityLabels, formatPrice } from "../catalog/display";
import { ShortlistFeedback } from "../components/ShortlistFeedback";
import { usePageNavigation } from "../navigation/usePageNavigation";
import {
  catalogSourceKey,
  useCatalogNavigation,
} from "../navigation/catalogNavigation";
import type { CatalogPosition } from "../navigation/catalogNavigation";

export function ProductDetailPage() {
  const { slug = "" } = useParams();
  const location = useLocation();
  const state: unknown = location.state;
  const navigation = useCatalogNavigation();
  const from =
    state && typeof state === "object" && "from" in state
      ? state.from
      : undefined;
  // A new slug owns a new request state, so the previous product cannot flash.
  return (
    <ProductDetailContent
      key={slug}
      slug={slug}
      backTo={catalogReturnPath(from)}
      sourceKey={catalogSourceKey(state)}
      sourcePosition={navigation.find(catalogSourceKey(state) ?? "")}
    />
  );
}

function ProductDetailContent({
  slug,
  backTo,
  sourceKey,
  sourcePosition,
}: {
  slug: string;
  backTo: string;
  sourceKey: string | null;
  sourcePosition: CatalogPosition | undefined;
}) {
  const [attempt, setAttempt] = useState(0);
  const request = useRequest<{ data: ProductDetail }>(
    `/api/products/${encodeURIComponent(slug)}`,
    attempt,
  );
  const product = request.data?.data;
  const unknown = request.error?.status === 404;
  const invalid = request.error?.status === 400;
  usePageNavigation(
    request.error
      ? `${unknown ? "Product Not Found" : "Product Unavailable"} | RoomShelf`
      : product
        ? `${product.title} | RoomShelf`
        : "Product Details | RoomShelf",
    "main",
  );
  const returnState =
    sourcePosition?.path === backTo && sourcePosition.slug === slug
      ? { catalogSourceKey: sourceKey }
      : undefined;

  return (
    <main
      id="main-content"
      className="collection-main detail-main"
      aria-busy={request.loading}
      tabIndex={-1}
    >
      <Link className="back-link" to={backTo} state={returnState}>
        ← Back to catalog
      </Link>
      <ShortlistFeedback />
      {request.loading && !product && (
        <section className="detail-loading">
          <h1 className="sr-only">Product details</h1>
          <p role="status">Loading product details…</p>
          <div className="skeleton-card" aria-hidden="true">
            <div />
            <span />
            <span />
          </div>
        </section>
      )}
      {request.error && (
        <section className="request-state" role="alert">
          <p className="eyebrow">
            {unknown ? "404 / Product not found" : "Product unavailable"}
          </p>
          <h1>
            {unknown
              ? "This piece is off the shelf."
              : invalid
                ? "This product link is invalid."
                : "We couldn’t load this piece."}
          </h1>
          <p>
            {unknown
              ? "Explore the catalog to find another piece."
              : request.error.message}
          </p>
          {!unknown && !invalid && (
            <button
              className="button primary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry product details
            </button>
          )}
          {(unknown || invalid) && (
            <Link className="button primary" to={backTo} state={returnState}>
              Browse the catalog
            </Link>
          )}
        </section>
      )}
      {product && !request.error && (
        <article className="product-detail">
          <ProductVisual product={product} eager />
          <div className="detail-info">
            <p className="eyebrow">
              {product.category} / {product.material}
            </p>
            <h1>{product.title}</h1>
            <p className="detail-price">
              <span className="currency">JPY</span>{" "}
              {formatPrice(product.price_jpy)}
            </p>
            <p className="product-description">{product.description}</p>
            <dl className="detail-specs">
              <div>
                <dt>Width</dt>
                <dd>{product.dimensions_cm.width} cm</dd>
              </div>
              <div>
                <dt>Depth</dt>
                <dd>{product.dimensions_cm.depth} cm</dd>
              </div>
              <div>
                <dt>Height</dt>
                <dd>{product.dimensions_cm.height} cm</dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{product.category}</dd>
              </div>
              <div>
                <dt>Material</dt>
                <dd>{product.material}</dd>
              </div>
              <div>
                <dt>Color</dt>
                <dd>{product.color}</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>{availabilityLabels[product.availability]}</dd>
              </div>
            </dl>
            <ProductActions product={product} />
            <p className="detail-footnote">
              An individual fictional product. Prices in JPY; dimensions in cm.
            </p>
          </div>
        </article>
      )}
    </main>
  );
}
