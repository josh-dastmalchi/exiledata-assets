# ExileData — local development & Cloudflare deployment

The full dev/deploy stack for the **exiledata** multi-repo system. Siblings under `/c/dev`:

| Repo | Role | Deploys to | Live URL |
| --- | --- | --- | --- |
| `exiledata-ui` | Angular 22 browser app (SSG/prerender, zoneless, signals, Tailwind v4) | Cloudflare **Pages** | `exiledata.com` |
| `exiledata-worker` | Cloudflare **Worker** API (Hono + D1 + R2 + Workflows + Cron) | Cloudflare Workers | `exiledata.com/api/*` |
| `exiledata-assets` | Static art/data (webp icons, UI art, catalog JSON) | Cloudflare **Pages** | `assets.exiledata.com` |
| `exiledata-extraction` | PoE2 dat/asset extraction tooling (offline; not deployed) | — | — |

**Prereqs:** system Node is v24 — run `node`/`npm`/`npx` **bare** (never a PATH prefix). Each deployable
repo has a **gitignored `.env`** with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (copy from
`.env.example`). The token needs Workers Scripts·Edit, D1·Edit, R2·Edit, Cloudflare Pages·Edit. It does
**not** have Zone·Cache-Purge or Zone·Workers-Routes — those are managed by hand in the dashboard.

---

## Local development

### exiledata-ui (Angular)

**Never `ng serve`.** It runs dev-mode client rendering and skips the static prerender (`outputMode:
static`), hiding the SSG / hydration / TransferState bugs that only appear in a real build. Use a watched
production-shaped build and serve its output:

```sh
npm --prefix /c/dev/exiledata-ui run watch     # ng build --watch --configuration development
                                                # → dist/exiledata-ui/browser  (rebuilds on save)
```

- **Serve the output** with a static server that has an SPA/CSR fallback. Client-rendered routes
  (`/valuation`, `/valuation/:category`) have **no prerendered `index.html`** — unmatched paths must fall
  back to `browser/index.csr.html` (the boot shell). Prerendered routes (everything else) serve their own
  `index.html`. `wrangler pages dev dist/exiledata-ui/browser` or any static server with that fallback works.
- **API base**: `environment.development.ts` → `apiUrl: http://localhost:8787/api`; production
  `environment.ts` → `/api` (same-origin). So the watched build expects the worker (or a shim) on **:8787**.
- **Restart the watch after adding a new lazy-loaded component or installing a dep** — esbuild caches module
  resolution and won't pick up brand-new files.
- Verify a real build: `npm --prefix /c/dev/exiledata-ui run build` (prerenders ~4500 routes).

### exiledata-worker (Cloudflare Worker)

```sh
npm --prefix /c/dev/exiledata-worker run db:migrate:local    # apply schema to the LOCAL D1
npm --prefix /c/dev/exiledata-worker run dev                 # wrangler dev → http://localhost:8787
```

- **Always run wrangler via the repo's npm scripts** (`npm --prefix /c/dev/exiledata-worker run …`) so its
  working dir is the worker repo and Miniflare uses `exiledata-worker/.wrangler/state`. Running `wrangler`
  from another cwd, or passing `--persist-to <absolute-path>`, makes Miniflare hash a **different** local D1
  file — so the DB you migrated/seeded is invisible and every query looks empty. `db:migrate:local` and
  `dev` must be launched the same way to share one D1 file.
- **Trigger the Cron/scheduled handler locally** (runs the valuation harvest + the poe2scout
  currency-exchange ingest, writing D1 through the worker's own binding — the compatible way):
  ```sh
  # with `npm run dev` running:
  curl -X POST http://localhost:8787/cdn-cgi/handler/scheduled
  ```
  The valuation harvest is gated to ~6h; to force it, clear the cursor:
  `wrangler d1 execute exiledata --local --command "DELETE FROM poller_state WHERE id='poe2scout';"`
- **Seed the local D1 manually** only with `wrangler d1 execute exiledata --local --file <sql>` (or
  `--command`). **Never write the local D1 sqlite with Node's `node:sqlite`** — Node 24's newer SQLite bumps
  the file format and Miniflare/wrangler can no longer open it (every D1 endpoint then returns 500, including
  ones you didn't touch). If that happens: delete
  `exiledata-worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` (keep `metadata.sqlite`) and
  re-run `db:migrate:local`.
- No GGG token is needed for the valuation + currency-exchange features. The GGG OAuth / cxapi-poller /
  per-user features stay dormant behind `isConfigured()` until the four secrets exist (`.dev.vars` locally).
- `npm run test` (Vitest, pure functions) and `npm run typecheck` before shipping.

### Recommended UI eval: the dev API shim

The lightest way to see the UI against **real** data without provisioning a full local worker DB: run a
tiny Node server on **:8787** (where the dev config points) that **proxies `/api/*` to the live worker**
(`https://exiledata.com`) and optionally computes specific endpoints locally by importing the worker's pure
TS (Node 24 strips types — `await import(pathToFileURL('…/src/exchange.ts').href)`). Cache-bust
`/valuation/snapshot` (`?bust=<ts>`) to dodge the edge cache. This avoids the local-D1 dance entirely and is
what we use for layout iteration. (A scratch example lived under the session scratchpad.)

**Full local stack** = `worker dev` (:8787, seeded via the scheduled trigger) + `ui watch` + a static
server for `dist/exiledata-ui/browser`. **Shim stack** = shim (:8787 → live) + `ui watch` + static server.

---

## Cloudflare deployment

Deploys are **direct from a local build** (no CI required); each repo's `npm run deploy` reads creds from
its gitignored `.env` via `node --env-file-if-exists=.env`.

### Worker

```sh
npm --prefix /c/dev/exiledata-worker run deploy     # → npx wrangler deploy
```

Registers the Worker, the `valuation-harvest` **Workflow**, and the **Cron `0 * * * *`** (hourly UTC).
Bindings: D1 `exiledata` (`database_id f83a4059-3d5d-44e1-a9c3-dcf1f13b3198`), R2 `exiledata-valuation`
(`VALUATION_BUCKET`), Workflow `valuation-harvest`. Requires **Workers Paid** (Workflows + D1 write caps).

- **Route**: `exiledata.com/api/*` is bound **manually in the dashboard** (the token lacks
  Zone·Workers-Routes). The `[[routes]]` block in `wrangler.toml` is commented so deploys don't touch it.
- **Remote D1 migrations**: `npm --prefix /c/dev/exiledata-worker run db:migrate:remote`.
- **Remote D1 one-off exec / seed** (e.g. bootstrapping `currency_snapshots` before the first cron tick):
  ```sh
  node --env-file-if-exists=C:/dev/exiledata-worker/.env \
    C:/dev/exiledata-worker/node_modules/wrangler/bin/wrangler.js \
    d1 execute exiledata --remote --config C:/dev/exiledata-worker/wrangler.toml --file <sql>
  ```
  Chunk multi-row INSERTs (~50 rows/statement) to avoid `SQLITE_TOOBIG`.
- **Caching**: `/api/valuation/snapshot` is an R2 artifact fronted by the edge Cache API (`Cache-Control`
  + `ETag`, ~1h fresh). A shape/data change can take up to ~1h to propagate unless the URL is purged in the
  dashboard (Caching → Purge → Custom URL) — our token can't purge. `/api/currency/*` are **not** cached
  (read D1 each request).

### UI (Cloudflare Pages)

```sh
npm --prefix /c/dev/exiledata-ui run deploy         # scripts/deploy.mjs
```

Builds into an **isolated `dist/deploy`** (so a running `watch` — dev config, localhost asset URLs — can't
contaminate the artifact), refuses to upload if any prerendered HTML contains `localhost`/`REPLACE_ME`, then
`wrangler pages deploy` to project **`exiledata-ui`**, production branch **`main`**. Prerenders ~4517 routes
(~90s). **Stop the dev `watch` before deploying** (or it may race the isolated build).

### Assets (Cloudflare Pages)

`npm --prefix /c/dev/exiledata-assets run deploy` (its own `scripts/deploy.mjs`, same `.env` pattern) →
`assets.exiledata.com`. Serves the webp art + catalog JSON the UI references via `assetsUrl`.

---

## Data features (where the pieces live)

- **Valuation** (auth-free): poe2scout `ByCategory` → `item_prices`/`valuations`/`price_daily` in D1;
  `finalize` publishes `valuation/<realm>/latest.json` to R2 → `GET /api/valuation/snapshot`. UI: `/valuation`.
- **Currency arbitrage** (auth-free): poe2scout `SnapshotPairs` → `currency_snapshots` (hourly, ungated
  ingest in `scheduled()`); `computeBackboneArbitrage` → `GET /api/currency/arbitrage`. UI: the
  arbitrage panel on the `/valuation` landing. Backbone-only by design — the full currency graph is too
  noisy to price. See the worker README and the plan for the why.

## Gotchas checklist

- ❌ `ng serve` — use `npm run watch` + static serve.
- ❌ seeding local D1 with `node:sqlite` — use `wrangler d1 execute --local` or the scheduled trigger.
- ❌ running `wrangler` from the wrong cwd / `--persist-to <abs>` — use the repo's npm scripts.
- ⚠️ new lazy component or new dep in the UI → restart the `watch`.
- ⚠️ `/api/valuation/snapshot` is edge-cached ~1h; `/api/currency/*` is not.
- ⚠️ stop the UI `watch` before `npm run deploy` (isolated-build race).
