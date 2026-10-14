import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getJson } from "../api/client";
import type { Product, ProductDetail } from "../api/types";
import { ProductActions } from "../components/ProductActions";
import { ProductVisual } from "../components/ProductVisual";
import { availabilityLabels, formatPrice } from "../catalog/display";
import { ShortlistFeedback } from "../components/ShortlistFeedback";
import { useCompare } from "../state/CompareProvider";

type Column = {
  selected: Product;
  product: ProductDetail | null;
  error: string | null;
};

export function ComparePage() {
  const compare = useCompare();
  return (
    <main id="main-content" className="collection-main compare-main">
      <section className="collection-intro">
        <p className="eyebrow">02 / Side by side</p>
        <h1>Compare the details</h1>
        <p>
          Up to three individual pieces. This selection clears when you reload.
        </p>
      </section>
      <ShortlistFeedback />
      {compare.products.length === 0 ? (
        <section className="request-state empty-state">
          <h2>Give your choices a little perspective.</h2>
          <p>
            Add products from the catalog to compare their dimensions and
            details.
          </p>
          <Link className="button primary" to="/products">
            Browse the catalog
          </Link>
        </section>
      ) : (
        <CompareTable
          key={compare.products
            .map((product) => `${product.id}:${product.slug}`)
            .join(",")}
          selected={compare.products}
        />
      )}
    </main>
  );
}

function CompareTable({ selected }: { selected: Product[] }) {
  const [attempt, setAttempt] = useState(0);
  const [columns, setColumns] = useState<Column[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(
      selected.map(async (product): Promise<Column> => {
        try {
          const result = await getJson<{ data: ProductDetail }>(
            `/api/products/${encodeURIComponent(product.slug)}`,
            controller.signal,
          );
          return { selected: product, product: result.data, error: null };
        } catch (error) {
          return {
            selected: product,
            product: null,
            error:
              error instanceof ApiError
                ? error.message
                : "This product could not be loaded.",
          };
        }
      }),
    ).then((data) => {
      if (!controller.signal.aborted) setColumns(data);
    });
    return () => controller.abort();
  }, [selected, attempt]);

  const rows: {
    label: string;
    value: (product: ProductDetail) => string | number;
  }[] = [
    {
      label: "Price (JPY)",
      value: (product) => formatPrice(product.price_jpy),
    },
    { label: "Width (cm)", value: (product) => product.dimensions_cm.width },
    { label: "Depth (cm)", value: (product) => product.dimensions_cm.depth },
    { label: "Height (cm)", value: (product) => product.dimensions_cm.height },
    { label: "Category", value: (product) => product.category },
    { label: "Material", value: (product) => product.material },
    { label: "Color", value: (product) => product.color },
    {
      label: "Availability",
      value: (product) => availabilityLabels[product.availability],
    },
  ];

  if (!columns)
    return (
      <p className="collection-status" role="status">
        Loading comparison details…
      </p>
    );
  return (
    <>
      {columns.some((column) => column.error) && (
        <div className="metadata-error" role="alert">
          <p>
            Some products could not be loaded. Remove an unavailable piece or
            try again.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setColumns(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry comparison details
          </button>
        </div>
      )}
      <div
        className="comparison-scroll"
        role="region"
        aria-label="Product comparison table"
        tabIndex={0}
      >
        <table className="comparison-table">
          <caption>Furniture comparison</caption>
          <thead>
            <tr>
              <th scope="col">Specification</th>
              {columns.map(({ selected: product, product: detail, error }) => (
                <th scope="col" key={product.id}>
                  {detail && <ProductVisual product={detail} />}
                  <Link
                    className="compare-product-link"
                    to={`/products/${product.slug}`}
                  >
                    {detail?.title ?? product.title}
                  </Link>
                  {error && <p className="comparison-error">{error}</p>}
                  <ProductActions
                    product={detail ?? product}
                    allowSave={detail !== null}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {columns.map((column) => (
                  <td key={column.selected.id}>
                    {column.product ? row.value(column.product) : "Unavailable"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="comparison-hint">
        On a narrow screen, scroll the table horizontally to see every piece.
      </p>
    </>
  );
}
