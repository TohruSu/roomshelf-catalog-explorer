# Application screenshots

Actual Flask/React browser captures with a newly initialized SQLite database and the deterministic 144-product seed. No screenshot uses a mockup, replacement artwork, altered UI, browser toolbar, or credential display. PNGs are captured at one device pixel per CSS pixel, without image editing.

| File | Capture viewport / state |
| --- | --- |
| `desktop-catalog.png` | 1440 × 1080; full page; choose Chair and Metal, then ascending price (five matches) |
| `mobile-catalog.png` | 390 × 844; viewport; fresh unfiltered catalog with default collapsed Filters |
| `product-details.png` | 1440 × 1080; full page; open seeded Arc Chair 01 from the catalog |
| `three-chair-comparison.png` | 1440 × 1080; full page; select Arc Chair 01, Cedarline Chair 02, Dune Chair 03, then open Compare (3) |

After the README backend/frontend setup and browser installation, stop other servers on ports 5000 and 4173. From `e2e/`, run:

```sh
npm ci
npx playwright install chromium
npm run screenshots
```

This explicit command rebuilds the frontend, starts the existing isolated seed/server harness, performs the interactions, and replaces these four PNGs. It never resets the development database. It uses the Playwright-locked Chromium revision; exact pixels may vary with browser/OS fonts. Normal `npm test` does not regenerate screenshot assets.
