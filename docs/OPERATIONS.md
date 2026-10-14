# Configuration and persistence

## Development

The [README quick start](../README.md#quick-start) uses Python 3.12 and Node 24. The default database is the ignored `backend/instance/catalog.sqlite3`. To use another SQLite database, set `ROOMSHELF_DATABASE_URL` to an absolute URL such as `sqlite:////absolute/path/catalog.sqlite3` before initialization and startup. The parent directory must exist and be writable.

Development generates a random key in ignored `backend/instance/session-secret` unless `ROOMSHELF_SECRET_KEY` is supplied through the environment. Keep the database, key, and browser cookie to preserve shortlist access across restarts. Never commit signing keys or session/cookie/token values. The fixed 30-day retention deadline does not slide with activity; comparison selections clear on page reload.

The default browser origin is `http://localhost:5173`. If using another hostname or port, set `ROOMSHELF_PUBLIC_ORIGIN` to the browser's canonical origin, with no trailing slash. Use lowercase ASCII hostnames, omit default ports (`:80` for HTTP and `:443` for HTTPS), and write other ports without leading zeroes. IPv6 addresses use brackets and their compressed lowercase form, for example `https://[2001:db8::1]:8443`; IPv4-mapped forms use hexadecimal notation and scope identifiers are rejected. Internationalized names must use canonical `xn--` labels. Standard-library checks support a conservative subset of those names; contextual Unicode joiners are unsupported. Invalid or noncanonical configuration stops startup; the server does not normalize incoming Origin headers.

Frontend and API must share a browser origin through Vite's proxy or an equivalent reverse proxy. No CORS credential setup or API keys are needed. Installation and advisory audits use the network; ordinary application use does not.

## Non-destructive database commands

`flask --app roomshelf init-db` initializes an empty database or accepts a compatible existing schema. It does not erase products/memberships and does not migrate incompatible schemas. `flask --app roomshelf seed` inserts missing products, preserving existing products, edits, and memberships. Conflicting seed identities fail without partial inserts.

`seed --reset` explicitly replaces the catalog and removes dependent memberships. It is not part of normal setup or screenshot capture. Use it only when intentionally discarding that data. Expired session rows currently have no automated cleanup command.

## Hypothetical production runtime

Set `ROOMSHELF_ENV=production`, a stable random `ROOMSHELF_SECRET_KEY` of at least 32 characters, and an HTTPS `ROOMSHELF_PUBLIC_ORIGIN`. Missing/invalid production configuration stops startup. The production cookie is host-only, Secure, HttpOnly, SameSite=Lax, and uses the `__Host-` prefix.

Use a production WSGI server and serve the built frontend with SPA fallback through the same HTTPS origin. Flask's development server and Vite preview are local tools. Configure TLS termination, forwarded headers, stable signing-key storage, and SQLite storage/backup permissions for the chosen host. No production server dependency or deployment configuration is included.

Production-mode tests use Flask's HTTPS request environment to verify startup validation, cookie flags, Origin/CSRF enforcement, and absolute expiry. They do not establish a TLS connection or validate a deployed reverse proxy. Backup/restore, migration, capacity, multi-instance behavior, and expired-row maintenance remain operational work. SQLite serializes writers; busy/unavailable errors return bounded 503 responses.

The API's `default-src 'none'` Content Security Policy applies only to `/api` responses. Do not copy it onto the built React HTML served by the static server/proxy. No deployment or production infrastructure validation is claimed.

## Dependency maintenance

Install from the committed locks with `pip install --require-hashes -r requirements-dev.txt` and `npm ci`. The development Python lock includes pinned pip-audit and its transitive requirements, including pip 26.2.1 required by pip-api; the runtime lock is separate. Both audit commands and formatting coverage are listed in the README. Advisory databases evolve, so a later audit can report new findings for the same commit.

To intentionally update Python locks, review input constraints and use Python 3.12 with pip-tools 7.6.2:

```sh
pip-compile --allow-unsafe --generate-hashes --no-emit-index-url --no-emit-trusted-host --output-file=requirements-dev.txt --strip-extras requirements-dev.in
```

`--allow-unsafe` is pip-tools' option to include/hash packaging tools such as pip rather than silently omit them; it does not disable verification. Use the equivalent command for `requirements.in`/`requirements.txt` when updating runtime dependencies. Lock generation is a maintainer operation, not required for setup. Inspect version/hash changes, retain verification, and rerun the checks before accepting updates. Do not use forced npm major upgrades or silently suppress audit findings.
