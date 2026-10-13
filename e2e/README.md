# Browser checks

The browser suite uses real Flask, SQLite, and built React pages. Each run creates and seeds a temporary database, starts Flask on port 5000 and Vite preview on port 4173, and removes the database when the server exits. Both ports must be available. Browser requests to other origins are blocked and reported as failures.

Install the backend dependencies in `backend/.venv` and frontend dependencies as described in the root README, then run from this directory:

```sh
npm ci
npx playwright install chromium
npm test
```

On a Linux machine missing browser system libraries, use `npx playwright install --with-deps chromium` where package installation is permitted. CI uses this command.

`npm test` builds the frontend before starting the checks. The Playwright package and browser revision are pinned by `package-lock.json`; no account, token, remote product data, or deployed service is needed. Installing dependencies and browser binaries requires network access.

Optional environment overrides:

- `PLAYWRIGHT_BROWSERS_PATH`: location for Playwright-managed browser binaries.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: explicit local Chromium executable. This runs that installed browser rather than the Playwright-pinned revision; record its version with any result.
- `ROOMSHELF_E2E_PYTHON`: backend virtual environment's Python executable if it is not `backend/.venv/bin/python`.

Failures leave screenshots and traces under ignored `test-results/`. CI also retains its HTML report and failure artifacts for seven days.
