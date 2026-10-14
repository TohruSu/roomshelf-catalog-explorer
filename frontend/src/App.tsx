import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { CatalogPage } from "./pages/CatalogPage";
import { ProductDetailPage } from "./pages/ProductDetailPage";
import { ComparePage } from "./pages/ComparePage";
import { ShortlistPage } from "./pages/ShortlistPage";
import { CompareTray } from "./components/CompareTray";
import { CompareProvider, useCompare } from "./state/CompareProvider";
import { ShortlistProvider, useShortlist } from "./state/ShortlistProvider";

export function App() {
  return (
    <CompareProvider>
      <ShortlistProvider>
        <AppLayout />
      </ShortlistProvider>
    </CompareProvider>
  );
}

function AppLayout() {
  const compare = useCompare();
  const shortlist = useShortlist();
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <Link
          to="/products"
          className="wordmark"
          aria-label="RoomShelf catalog"
        >
          <span className="brand-symbol" aria-hidden="true">
            ▤
          </span>{" "}
          RoomShelf<span className="brand-dot">.</span>
        </Link>
        <span className="header-description">Furniture Catalog Explorer</span>
        <nav className="main-navigation" aria-label="Main navigation">
          <NavLink to="/products" end>
            Catalog
          </NavLink>
          <NavLink to="/compare">Compare ({compare.products.length})</NavLink>
          <NavLink to="/shortlist">
            Shortlist
            {shortlist.status === "ready" ? ` (${shortlist.ids.size})` : ""}
          </NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/products" replace />} />
        <Route path="/products" element={<CatalogPage />} />
        <Route path="/products/:slug" element={<ProductDetailPage />} />
        <Route path="/compare" element={<ComparePage />} />
        <Route path="/shortlist" element={<ShortlistPage />} />
        <Route
          path="*"
          element={
            <main id="main-content" className="not-found">
              <p className="eyebrow">404 / Page not found</p>
              <h1>This page is off the shelf.</h1>
              <p>Return to the catalog to explore the collection.</p>
              <Link className="button primary" to="/products">
                Browse the catalog
              </Link>
            </main>
          }
        />
      </Routes>
      <CompareTray />
      <footer className="site-footer">
        <span>RoomShelf — Furniture Catalog Explorer</span>
        <span>Fictional products. Prices in JPY. Dimensions in cm.</span>
      </footer>
    </>
  );
}
