# RoomShelf — Furniture Catalog Explorer

A self-contained fictional furniture catalog with 144 products and original local illustrations. Browse by keyword, category, material, price, and maximum width, then sort and paginate the matching products. Applied filters stay in the URL for sharing and browser navigation.

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

Initialization and ordinary seeding preserve existing data. The seed inserts missing products and rejects conflicting identities without partial inserts. `seed --reset` explicitly replaces the catalog and removes dependent shortlist memberships; use it only when discarding that data is intended. Initialization does not migrate incompatible existing schemas.

## API

- `GET /api/health`: database/schema readiness.
- `GET /api/filters`: catalog-wide categories, materials, and price/dimension bounds.
- `GET /api/products`: validated filtering, sorting, and pagination.

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
```

Browser smoke instructions are in `e2e/README.md`. GitHub Actions runs backend, frontend, and browser checks against a fresh seeded database. Local test success and hosted CI results are separate outcomes.

## Structure

`backend/roomshelf` contains the Flask application, SQLAlchemy models, validation, catalog queries, and initialization/seed commands. `frontend/src` contains the React catalog, URL/query handling, components, styles, and local SVG assets. Tests live beside their respective applications and in `e2e/`.
