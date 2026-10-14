import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getJson } from "../api/client";
import type { Product, ProductDetail } from "../api/types";
import { ProductActions } from "../components/ProductActions";
import { ProductVisual } from "../components/ProductVisual";
import { availabilityLabels, formatPrice } from "../catalog/display";
import { ShortlistFeedback } from "../components/ShortlistFeedback";
import { useCompare } from "../state/CompareProvider";
import { usePageNavigation } from "../navigation/usePageNavigation";

type Column = {
  selected: Product;
  product: ProductDetail | null;
  error: string | null;
};

export function ComparePage() {
  const compare = useCompare();
  usePageNavigation("Compare Products | RoomShelf");
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  const emptyAction = useRef<HTMLAnchorElement>(null);
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
        ? emptyAction.current
        : removeButtons.current.get(pending.nextId);
    destination?.focus({ preventScroll: true });
  }, [compare.products]);

  function toggleComparison(product: Product, button: HTMLButtonElement) {
    if (compare.isSelected(product.id) && document.activeElement === button) {
      const index = compare.products.findIndex(
        (item) => item.id === product.id,
      );
      const next = compare.products[index + 1] ?? compare.products[index - 1];
      pendingFocus.current = { source: button, nextId: next?.id ?? null };
    }
    compare.toggle(product);
  }

  return (
    <main
      id="main-content"
      className="collection-main compare-main"
      tabIndex={-1}
    >
      <section className="collection-intro">
        <p className="eyebrow">02 / Side by side</p>
        <h1 tabIndex={-1}>Compare the details</h1>
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
          <Link
            className="button primary"
            to="/products"
            ref={emptyAction}
            data-compare-empty-action
          >
            Browse the catalog
          </Link>
        </section>
      ) : (
        <CompareTable
          selected={compare.products}
          removeButtons={removeButtons.current}
          onCompareToggle={toggleComparison}
        />
      )}
    </main>
  );
}

function CompareTable({
  selected,
  removeButtons,
  onCompareToggle,
}: {
  selected: Product[];
  removeButtons: Map<number, HTMLButtonElement>;
  onCompareToggle: (product: Product, button: HTMLButtonElement) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [columns, setColumns] = useState<Column[] | null>(null);
  // Keep surviving columns mounted so removal preserves focus and table scroll.
  const loadedColumns = useRef(new Map<number, Column>());
  useEffect(() => {
    const controller = new AbortController();
    const selectedIds = new Set(selected.map((product) => product.id));
    for (const id of loadedColumns.current.keys())
      if (!selectedIds.has(id)) loadedColumns.current.delete(id);
    void Promise.all(
      selected.map(async (product): Promise<Column> => {
        const loaded = loadedColumns.current.get(product.id);
        if (loaded?.selected.slug === product.slug)
          return { ...loaded, selected: product };
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
      if (!controller.signal.aborted) {
        loadedColumns.current = new Map(
          data.map((column) => [column.selected.id, column]),
        );
        setColumns(data);
      }
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
  const visibleColumns = columns.filter((column) =>
    selected.some(
      (product) =>
        product.id === column.selected.id &&
        product.slug === column.selected.slug,
    ),
  );
  return (
    <>
      {visibleColumns.some((column) => column.error) && (
        <div className="metadata-error" role="alert">
          <p>
            Some products could not be loaded. Remove an unavailable piece or
            try again.
          </p>
          <button
            className="text-button"
            onClick={() => {
              loadedColumns.current.clear();
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
              {visibleColumns.map(
                ({ selected: product, product: detail, error }) => (
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
                      compareButtonRef={(button) => {
                        if (button) removeButtons.set(product.id, button);
                        else removeButtons.delete(product.id);
                      }}
                      onCompareToggle={onCompareToggle}
                    />
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {visibleColumns.map((column) => (
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
