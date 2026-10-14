# RoomShelf — Furniture Catalog Explorer

RoomShelf is a full-stack furniture catalog built with React, Flask, and SQLite. Explore 144 fictional products with original SVG illustrations, narrow down the catalog with flexible filters, compare furniture side by side, and save a shortlist without creating an account.

![RoomShelf desktop catalog with category and material filters, sorting, and illustrated furniture cards](docs/screenshots/desktop-catalog.png)

## Features

- **Find the right piece:** Search product names and descriptions; filter by category, material, price, and maximum width; sort and paginate results.
- **Explore details:** View dimensions, availability, materials, colors, and prices in Japanese yen.
- **Compare products:** Select up to three pieces for a side-by-side specification table. Comparison stays in memory and clears on reload.
- **Keep a shortlist:** Save products to an anonymous, browser-specific collection that persists across reloads and server restarts while its 30-day session and server data remain available.
- **Pick up where you left off:** Catalog filters live in the URL, and returning from a product restores the relevant catalog context and scroll position.
- **Browse on smaller screens:** Responsive layouts, collapsible filters, keyboard navigation, and focus management support browsing across devices.

All products, prices, and availability are fictional. This is a catalog explorer, not an online store.

## Technology

| Layer | Tools |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Router |
| Backend | Python 3.12, Flask 3, Pydantic |
| Database | SQLAlchemy 2, SQLite |
| Testing | pytest, Vitest, Testing Library, Playwright (Chromium) |
| Code quality | Ruff, mypy, ESLint, Prettier, TypeScript |
| CI & dependencies | GitHub Actions, hash-locked Python requirements, npm lockfiles, dependency audits |

## Engineering decisions

- **URL-driven catalog state.** Applied filters, sorting, and pagination are shareable and compatible with browser history. SQLite handles filtering, counting, and paging using a consistent transaction snapshot and deterministic sort tie-breakers.
- **Transactional shortlist changes.** Saving and removing items are idempotent operations. Foreign keys and a composite membership key protect data consistency.
- **Session-scoped access.** A signed, host-only browser cookie identifies each anonymous shortlist. Mutations require an exact Origin match and a session-bound CSRF token; sessions have a fixed 30-day lifetime.
- **Careful network recovery.** API requests have a 10-second deadline, including response parsing. When a shortlist write times out or its result is unclear, the client reads the server state instead of blindly repeating the write.
- **Intentional focus behavior.** Navigation, product removal, and asynchronous updates preserve useful keyboard context. Browser tests cover responsive layouts, contrast, and 200%/400% zoom.
- **Repeatable checks.** CI runs backend, frontend, and real-browser tests, formatting and type checks, and dependency audits against pinned inputs.

For implementation details, see the [architecture notes](docs/ARCHITECTURE.md) and [API reference](docs/API.md).

## More screenshots

The images below were captured from the running application with a fresh, deterministic seed. [Capture details and reproduction steps](docs/screenshots/README.md) are available.

![Mobile RoomShelf catalog with filters collapsed and the first furniture card visible](docs/screenshots/mobile-catalog.png)

![Arc Chair 01 product details with local artwork, JPY price, dimensions, and save and compare actions](docs/screenshots/product-details.png)

![Three seeded chairs compared by price, dimensions, material, color, and availability](docs/screenshots/three-chair-comparison.png)

## Quick start

You will need **Python 3.12**, **Node.js 24** (see `.node-version`), and npm. Dependency installation needs an Internet connection; the running catalog uses only local data and assets.

From the repository root, start the backend:

```sh
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
.venv/bin/flask --app roomshelf init-db
.venv/bin/flask --app roomshelf seed
.venv/bin/flask --app roomshelf run --host 127.0.0.1 --port 5000
```

In a second terminal, start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite serves the React app and proxies `/api` requests to Flask on port 5000. Both servers need to be running.

The default SQLite database (`backend/instance/catalog.sqlite3`) and development signing key (`backend/instance/session-secret`) are ignored by Git. Keep them if you want the same browser shortlist to survive restarts. Initialization and ordinary seeding preserve existing data; `seed --reset` is destructive.

If you change the development origin, database location, or signing-key configuration, follow the [operations guide](docs/OPERATIONS.md).

## Testing and CI

Backend checks (from `backend/` after installation):

```sh
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy roomshelf
.venv/bin/pytest
.venv/bin/pip-audit --cache-dir .venv/audit-cache --strict --disable-pip --require-hashes \
  --vulnerability-service pypi --progress-spinner off -r requirements-dev.txt
.venv/bin/python ../scripts/check_docs.py
```

Frontend checks (from `frontend/`):

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev
```

Browser tests (from `e2e/`, with backend/frontend dependencies installed):

```sh
npm ci
npm audit
npx playwright install chromium
npm test
```

The Playwright suite builds the frontend, starts isolated local servers, and seeds a temporary SQLite database. Ports 5000 and 4173 must be free; on some Linux systems, Chromium also needs system packages installed with `npx playwright install --with-deps chromium`. See the [browser test guide](e2e/README.md).

[GitHub Actions](.github/workflows/ci.yml) runs on pushes to `main`, pull requests targeting `main`, and manual dispatch. Its three jobs cover backend checks, frontend checks, and Chromium end-to-end tests. Python dependency auditing uses a strict, hash-locked requirements file; npm CI fails for moderate-severity or higher advisories. Audit results reflect the advisories available at the time of each run.

## Sessions, security, and persistence

Public catalog requests do not require a session. An anonymous shortlist uses an HttpOnly, SameSite=Lax, host-only signed cookie and SQLite membership records. The session expires 30 days after creation; activity does not extend it. Clearing cookies or changing the signing key prevents access to the previous shortlist.

Shortlist writes are checked for session, CSRF, and Origin validity before changing data. Request timeouts do not cancel a transaction already executing on the server; the client therefore reconciles uncertain results through reads rather than automatic write retries. The [API reference](docs/API.md) documents request validation and recovery cases.

## Current scope

RoomShelf is designed for local demonstration and testing. It does not include shopping, user accounts, catalog administration, or image uploads. The SQLite database supports this small catalog, but multi-instance scaling and performance under production load have not been evaluated.

Public hosting has not been set up. A deployment would need HTTPS, a production WSGI server, same-origin static hosting, persistent storage and secrets, and a tested backup-and-restore process. See [operations](docs/OPERATIONS.md) for configuration details.

Automated accessibility tests cover keyboard interactions, focus, text contrast, reflow, and Chromium zoom. Manual testing with screen readers and additional browser/assistive-technology combinations remains to be done.

## Project layout

```text
backend/roomshelf/     Flask API, validation, models, SQL queries, security, seed commands
backend/tests/         API, persistence, configuration, and documentation tests
frontend/src/          React routes, URL state, providers, navigation, local SVGs
frontend/tests/        Components, state, recovery, and navigation tests
e2e/                  Browser tests and reproducible screenshot capture
docs/                 API, architecture, operations, and screenshots
scripts/check_docs.py JSON example and local-image validation
.github/workflows/    Backend, frontend, and browser CI
```

## License

Licensed under the [MIT License](LICENSE).
