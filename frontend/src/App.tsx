import { Link, Navigate, Route, Routes } from "react-router-dom";
import { CatalogPage } from "./pages/CatalogPage";

export function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to catalog
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
        <span className="header-note">An independent fictional catalog</span>
      </header>
      <Routes>
        <Route path="/" element={<Navigate to="/products" replace />} />
        <Route path="/products" element={<CatalogPage />} />
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
      <footer className="site-footer">
        <span>RoomShelf — Furniture Catalog Explorer</span>
        <span>Fictional products. Prices in JPY. Dimensions in cm.</span>
      </footer>
    </>
  );
}
