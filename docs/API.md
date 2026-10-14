# RoomShelf API

The browser frontend and `/api` share one origin. Catalog responses are public. Shortlist access requires the verified signed browser cookie; request parameters and JSON never select a shortlist owner. Comparison has no API and lives in browser memory.

## Responses and validation

Successful reads use a `data` envelope. Validation and operational errors use:

```json
{"error":{"code":"invalid_request","message":"Request validation failed.","details":[{"field":"slug","message":"Slug must contain 1–80 lowercase ASCII letters or digits in hyphen-separated segments."}]}}
```

All endpoints reject unsupported query parameters. Read endpoints reject request bodies. Errors contain no signing secrets, session keys, SQL statements, or tracebacks. Relevant statuses are 400 for validation, 401 `session_required`, 403 `origin_forbidden` or `csrf_invalid`, 404 `product_not_found` or `route_not_found`, 405 for unsupported methods, 413 for bodies over 4 KiB, 415 for an unsupported POST media type, 503 for unavailable or busy SQLite, and 500 for unexpected failures. `details` is always an array.

## Catalog

`GET /api/health` returns `{"data":{"status":"ok","database":"ok"}}` when the initialized schema is usable; otherwise it returns 503.

`GET /api/filters` returns catalog-wide distinct categories and materials, price bounds, and width/depth/height bounds. Each bound contains numeric `min` and `max` fields; an empty catalog has empty facet arrays and null bounds. This endpoint does not apply product filters.

`GET /api/products` accepts:

| Parameter | Validation/default |
| --- | --- |
| `q` | NFKC, Unicode case folding, collapsed whitespace; at most 100 normalized characters and 8 terms |
| `category` | Repeatable: `bed`, `chair`, `desk`, `sofa`, `storage`, `table` |
| `material` | Repeatable: `fabric`, `glass`, `metal`, `mixed`, `wood` |
| `min_price`, `max_price` | Inclusive whole JPY, 0–2147483647; minimum cannot exceed maximum |
| `max_width` | Inclusive width limit, 1–1000 cm |
| `sort` | `featured` (default), `price_asc`, `price_desc`, `title_asc` |
| `page` | 1–10000, default 1 |
| `page_size` | 1–48, default 12 |

Numeric query values contain ASCII digits only; leading zeroes are accepted. Duplicate scalar parameters, empty numeric values, and unsupported values return 400. Repeated facets are deduplicated and combine with OR within a facet and AND between facets. Every search term must occur literally in the normalized title or description; SQL wildcard characters have no special meaning. The backend is authoritative when case folding expands a search beyond the limit.

Ordering is display order for `featured`, price for price sorts, and normalized title for `title_asc`. Every sort uses ascending product ID as its final tie-breaker. Filtering, counting, ordering, and pagination execute in SQLite, with count and rows from the same snapshot. A page beyond the last page returns an empty array and the correct totals. No matches means `total_pages: 0`.

Product summaries have the following fields. This is a complete summary object from the deterministic seed, rather than a complete endpoint response:

```json
{"id":1,"slug":"arc-bed-001","title":"Arc Bed 01","category":"bed","material":"fabric","color":"natural","price_jpy":135300,"dimensions_cm":{"width":154,"depth":201,"height":48},"availability":"in_stock","illustration_key":"bed-01"}
```

Complete response to `GET /api/products?page_size=1` on a fresh seed (one item requested, all matching products counted):

<!-- api-example: GET /api/products?page_size=1 -->
```json
{
  "data": [{
    "id": 1,
    "slug": "arc-bed-001",
    "title": "Arc Bed 01",
    "category": "bed",
    "material": "fabric",
    "color": "natural",
    "price_jpy": 135300,
    "dimensions_cm": {"width": 154, "depth": 201, "height": 48},
    "availability": "in_stock",
    "illustration_key": "bed-01"
  }],
  "meta": {"page": 1, "page_size": 1, "total": 144, "total_pages": 144}
}
```

Product colors are `natural`, `ivory`, `charcoal`, `sage`, or `terracotta`; availability is `in_stock`, `made_to_order`, or `unavailable`. Illustration keys refer only to bundled local artwork.

Complete response to `GET /api/products/arc-chair-025` on a fresh seed:

<!-- api-example: GET /api/products/arc-chair-025 -->
```json
{
  "data": {
    "id": 25,
    "slug": "arc-chair-025",
    "title": "Arc Chair 01",
    "category": "chair",
    "material": "glass",
    "color": "terracotta",
    "price_jpy": 110500,
    "dimensions_cm": {"width": 68, "depth": 49, "height": 97},
    "availability": "in_stock",
    "illustration_key": "chair-01",
    "description": "A compact chair with a gently angled back for a reading corner or dining table. Its primary material is glass."
  }
}
```

Slugs are 1–80 lowercase ASCII letters/digits in nonempty hyphen-separated segments. Malformed slugs return 400; a valid slug without a matching product returns 404 `product_not_found`. No query parameters are accepted.

## Anonymous sessions

Call `GET /api/session` before reading or changing the shortlist. It creates a cryptographically random session if the cookie is absent, invalid, expired, or no longer has a corresponding database row. Otherwise it reuses the current session without extending its absolute expiry or rewriting the cookie. The complete response shape is illustrated below. `SESSION_REF_PLACEHOLDER` and `CSRF_TOKEN_PLACEHOLDER` are deliberately unusable placeholders, not captured credentials; timestamps illustrate a session created at 2026-10-14 00:00 UTC. Obtain actual values from this endpoint at runtime:

```json
{"data":{"session_ref":"SESSION_REF_PLACEHOLDER","csrf_token":"CSRF_TOKEN_PLACEHOLDER","csrf_expires_at":"2026-10-14T01:00:00.000000Z","session_expires_at":"2026-11-13T00:00:00.000000Z"}}
```

The signed cookie contains the opaque shortlist key, a random CSRF nonce, and fixed expiry. Cookie contents are authenticated, not encrypted; they contain no personal information. Session keys must never be logged or accepted as client-supplied authority. `session_ref` helps detect replacement sessions and cannot authorize access.

Sessions last 30 days from creation. CSRF tokens last at most one hour and never outlive the session. Personalized responses, including errors, use `Cache-Control: no-store` and vary on `Cookie`. Only `/api/session` creates or renews a session; other shortlist endpoints return 401 when it is inactive.

Cookies are HttpOnly, SameSite=Lax, host-only, and scoped to `/`. Development uses `roomshelf_session`; production uses `__Host-roomshelf_session` with Secure. Keep the cookie, SQLite database, and stable signing secret to preserve memberships across application restarts. A cleared cookie, expired session, or replaced secret loses access without an account recovery mechanism.

The API does not enable credentialed cross-origin access. `ROOMSHELF_PUBLIC_ORIGIN` must already be in canonical browser form: lowercase ASCII host, no user information, path, query, fragment, or trailing slash; omit default ports and write nondefault ports without leading zeroes. Internationalized names require canonical `xn--` labels. Standard-library checks support a conservative subset of those names; contextual Unicode joiners are unsupported. IPv6 literals require brackets and compressed lowercase notation, including hexadecimal IPv4-mapped addresses; scope identifiers are rejected. Production requires HTTPS. Invalid configuration stops startup rather than being silently normalized. On personal GETs, an Origin header, when present, must equal the configured public origin exactly; explicit cross-site Fetch Metadata is rejected. Every mutation requires that exact Origin and a valid `X-CSRF-Token` bound to the active signed session. Missing/null/foreign Origin is rejected. Token and Origin failures occur before membership changes.

## Shortlist

`GET /api/shortlist` returns saved products ordered by `added_at` descending, then product ID ascending. Complete illustrative response after saving seeded product 1; `added_at` is an example timestamp, not a captured user record:

```json
{"data":[{"product":{"id":1,"slug":"arc-bed-001","title":"Arc Bed 01","category":"bed","material":"fabric","color":"natural","price_jpy":135300,"dimensions_cm":{"width":154,"depth":201,"height":48},"availability":"in_stock","illustration_key":"bed-01"},"added_at":"2026-10-14T00:00:00.000000Z"}],"meta":{"total":1}}
```

An empty shortlist is `{"data":[],"meta":{"total":0}}`.

`POST /api/shortlist/items` requires `Content-Type: application/json`, optionally with a charset parameter, plus Origin and CSRF headers. Media-type names are case-insensitive. Other types, including `application/*+json`, return 415 `unsupported_media_type`; malformed JSON with a supported type returns 400. Its only body field is `{"product_id":1}`: a JSON integer from 1 through 2147483647. Strings, booleans, fractions, missing fields, and extra fields return 400. Unknown products return 404. Both a new save and an already saved product return 200 `{"data":{"product_id":1,"saved":true}}`; repeated saves retain the original timestamp.

`DELETE /api/shortlist/items/{product_id}` requires Origin and CSRF headers, accepts no body or query, and validates a positive ASCII-digit ID in the same range. It returns 204 with no body even when the membership or product is already absent. Deletes are scoped to the current session. Mutations use an atomic SQLite transaction, reserve the writer before reading, and publish success only after commit. Foreign keys and the composite membership key prevent orphan rows and duplicates.

## Browser recovery

The frontend shares one in-flight session bootstrap within the page and serializes writes. Where Web Locks are available, it also serializes bootstrap across same-origin tabs so that simultaneous first visits reuse the first signed cookie. Without Web Locks, ordinary bootstrap remains available; if concurrent creation replaces a session, fingerprint checks cancel the pending action and ask the user to try again. Tokens and session fingerprints stay in memory, never local storage.

Every browser API request has a 10-second deadline from starting fetch through consuming the JSON response body. Caller cancellation, such as navigation, remains distinct from a timeout. Session bootstrap bounds the entire browser-lock wait and session request to 10 seconds; a failed or timed-out bootstrap is cleared so a later attempt can proceed. A deadline aborts the client request, not the server transaction. Late responses cannot update frontend state.

A `403 csrf_invalid` permits one token refresh and one retry only when `session_ref` still matches, because that rejection precedes mutation. A 401 or changed session fingerprint renews and reloads memberships, cancels the pending action, and asks the user to try it again. Timeouts, network failures, server failures, and unreadable mutation responses have an uncertain commit outcome: refresh the session and reconcile with a shortlist GET, show the server state and an unconfirmed-update message, and never automatically replay the write. Each recovery request has its own 10-second deadline. If reconciliation fails, clear pending controls and require a successful shortlist reload before another write; queued actions are cancelled when the session or confirmed state is no longer valid. Other 403 errors require correcting the origin or configuration.

Reconciliation reports the state at the time of that read. A server transaction can finish after the client deadline or after that read; a later shortlist reload observes subsequent commits. An unconfirmed message does not promise rollback or successful completion.
