# RoomShelf — Furniture Catalog Explorer

A self-contained fictional furniture catalog with 144 products and original local illustrations. Browse by keyword, category, material, price, and maximum width, inspect individual products, compare up to three products, and keep an anonymous shortlist. Applied catalog filters stay in the URL for sharing and browser navigation.

Prices are whole Japanese yen (JPY), dimensions are centimetres (cm), and availability is fictional. There are no accounts, purchasing flows, or external runtime services.

## Requirements

- Python 3.12
- Node.js 24 (the tested version is recorded in `.node-version`)
- npm

## Run locally

From the repository root, prepare the backend:

```sh
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
.venv/bin/flask --app roomshelf init-db
.venv/bin/flask --app roomshelf seed
.venv/bin/flask --app roomshelf run --host 127.0.0.1 --port 5000
```

In another terminal, prepare and start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Open the address printed by Vite. Its development server proxies `/api` to the backend. Both processes must run. Dependency installation needs Internet access; normal application use does not need external network access or API keys.

The default database is `backend/instance/catalog.sqlite3`, which is ignored by Git. To use another SQLite database, set `ROOMSHELF_DATABASE_URL` to an absolute URL such as `sqlite:////absolute/path/catalog.sqlite3` before initialization and startup.

Development creates a random signing key in the ignored `backend/instance/session-secret` file. Keep that file and the database to preserve shortlist access after restarting the server. Alternatively, supply `ROOMSHELF_SECRET_KEY` through the process environment. Never commit signing secrets. Anonymous shortlists expire 30 days after creation; activity does not extend that deadline. Clearing the browser cookie or replacing the signing key loses access to that browser's previous shortlist. Comparison selections live in React memory and clear on reload.

The default browser origin is `http://localhost:5173`. If using another hostname or port, set `ROOMSHELF_PUBLIC_ORIGIN` to its exact origin, with no trailing slash. The frontend and API must share a browser origin through the Vite proxy or an equivalent reverse proxy.

For a production runtime, set `ROOMSHELF_ENV=production`, a stable random `ROOMSHELF_SECRET_KEY` of at least 32 characters, and an HTTPS `ROOMSHELF_PUBLIC_ORIGIN`. Missing or invalid production configuration stops startup. The production cookie is host-only, Secure, HttpOnly, and SameSite=Lax. Use a production WSGI server and serve the built frontend through the same HTTPS origin; Flask's development server is for local use.

Initialization and ordinary seeding preserve existing data. The seed inserts missing products and rejects conflicting identities without partial inserts. `seed --reset` explicitly replaces the catalog and removes dependent shortlist memberships; use it only when discarding that data is intended. Initialization does not migrate incompatible existing schemas.

## API

- `GET /api/health`: database/schema readiness.
- `GET /api/filters`: catalog-wide categories, materials, and price/dimension bounds.
- `GET /api/products`: validated filtering, sorting, and pagination.
- `GET /api/products/{slug}`: description and complete specifications.
- `GET /api/session`: anonymous session bootstrap and session-bound CSRF token.
- `GET /api/shortlist`: saved products for the signed browser cookie.
- `POST /api/shortlist/items`: idempotently save a product.
- `DELETE /api/shortlist/items/{product_id}`: idempotently remove a product.

See [the API reference](docs/API.md) for request shapes, security requirements, expiry, and recovery behavior.

Catalog query parameters are `q`, repeatable `category` and `material`, `min_price`, `max_price`, `max_width`, `sort`, `page`, and `page_size`. Facet values combine with OR inside each facet and AND across facets. Numeric bounds are inclusive. Search requires each normalized term to occur literally in the title or description.

Sort values are `featured`, `price_asc`, `price_desc`, and `title_asc`, with ascending product ID as the tie-breaker. Pages start at 1; page size defaults to 12 and is capped at 48. Responses distinguish the total matching count from the number of returned items. Unknown or invalid parameters return a structured JSON error.

## Checks

Backend, from `backend`:

```sh
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy roomshelf
.venv/bin/pytest
```

Frontend, from `frontend`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev
```

Browser smoke instructions are in `e2e/README.md`. GitHub Actions runs backend, frontend, and browser checks against a fresh seeded database. Local test success and hosted CI results are separate outcomes.

## Structure

`backend/roomshelf` contains the Flask application, SQLAlchemy models, validation, catalog queries, and initialization/seed commands. `frontend/src` contains the React catalog, URL/query handling, components, styles, and local SVG assets. Tests live beside their respective applications and in `e2e/`.
