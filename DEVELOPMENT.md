# ExileData — local development & Cloudflare deployment

The full dev/deploy stack for the **exiledata** multi-repo system. Siblings under `/c/dev`:

| Repo | Role | Deploys to | Live URL |
| --- | --- | --- | --- |
| `exiledata-ui` | Angular 22 app (SSG/prerender) **+ the merged `worker/` API** (Hono + D1 + R2 + Workflows + Cron) | Cloudflare **Worker w/ static assets** | `exiledata.com` (+ `/api/*`) |
| `exiledata-assets` | Static art/data (webp icons, UI art, catalog JSON) | Cloudflare **Pages** (→ static-assets) | `assets.exiledata.com` |
| `exiledata-extraction` | PoE2 dat/asset extraction tooling (offline; not deployed) | — | — |
| `exiledata-worker` | **RETIRED standalone worker — do NOT deploy** (shares the name; clobbers the consolidated worker). Source now lives in `exiledata-ui/worker/`. | — | — |

**Architecture (2026-07 consolidation).** We moved off the old split model (UI on Pages + a separate
Worker bolted on at `/api/*` via a hand-made dashboard route) to Cloudflare's recommended **single Worker
with attached static assets**: one Worker owns `exiledata.com`, serving the prerendered site from its
`[assets]` binding and the `/api/*` Hono app from code. The worker source was merged into
`exiledata-ui/worker/`; the UI repo is now **self-contained** (its catalog inputs are vendored, so it
builds in single-repo CI). See **Consolidated deploy** below. **The cutover is DONE (2026-07-06):** `exiledata.com` is served
entirely by the consolidated Worker (Workers Builds on `exiledata-ui`); the old split model (Pages +
standalone `/api/*` worker) is retired. ⚠️ The standalone `exiledata-worker` repo must NEVER be
`npm run deploy`'d — it shares the worker name but has no `[assets]`, so a manual deploy clobbers the
consolidated worker and 404s the whole site (see Gotchas).

**Prereqs:** system Node is v24 — run `node`/`npm`/`npx` **bare** (never a PATH prefix). Each deployable
repo has a **gitignored `.env`** with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (copy from
`.env.example`). The token needs Workers Scripts·Edit, D1·Edit, R2·Edit, Cloudflare Pages·Edit. It does
**not** have Zone·Cache-Purge or Zone·Workers-Routes — those are managed by hand in the dashboard.

**Repos are on GitHub** (`github.com/josh-dastmalchi/exiledata-{ui,worker,assets}`), which enables
Cloudflare **git-based builds** (Workers Builds / Pages Git) so deploys run on CF's infra, not locally.

### Merged `exiledata-ui` layout

```
exiledata-ui/
  src/                     Angular app (unchanged)
  data-src/                VENDORED catalog JSON (committed, ~22MB) — the build's inputs, so CI is self-contained.
                           Refresh from extraction with its `npm run sync:ui`; copy-catalog reads this (was the sibling repo).
  public/_redirects        /valuation → /index.csr CSR-shell rewrite (honored by Pages AND Workers assets)
  public/_headers          immutable cache headers for hashed assets
  worker/                  MERGED API worker (src/ migrations/ test/ scripts/ tsconfig.json vitest.config.ts)
  wrangler.toml            unified: main=worker/src/index.ts, [assets].directory=dist/exiledata-ui/browser, D1/R2/Workflow/Cron
  scripts/deploy-app.mjs   unified deploy (build → guard → wrangler deploy); scripts/deploy.mjs = legacy Pages (until cutover)
```

The worker's `fetch` owns `/api/*` (Hono) and delegates everything else to `env.ASSETS.fetch` (which
applies `_headers`/`_redirects`). `wrangler.toml`'s `run_worker_first=["/api/*"]` serves static assets
directly in production for speed; the code delegation is the correctness net whenever the worker is reached.

---

## Local development

### exiledata-ui (Angular)

**Two modes — don't conflate them.** (An earlier version of this doc said "never `ng serve`"; that was
wrong. `ng serve` runs dev-mode **SSR + hydration + HMR** here, because `ssr.entry: src/server.ts` is
configured — it renders through the same `server.ts` as the prod prerender. Verified: it returns fully
rendered HTML, not an empty `<app-root>` shell.)

*Mode 1 — iterate (default, 95% of the time):*

```sh
npm --prefix /c/dev/exiledata-ui run start     # ng serve → http://localhost:4200 (dev-SSR + HMR)
```

Fast, no wrangler, no manifest, no zombies. Binds **IPv6** — browse `localhost:4200`, not `127.0.0.1`.
Art comes from the assets dev server: run `npm --prefix /c/dev/exiledata-assets start` (`:4201`, matches
`environment.development.ts`). `/api` isn't served in this mode (dev config points it at `:8787`).

*Mode 2 — verify the deploy shape (before committing/pushing, or when touching `/api` or headers):*

```sh
npm --prefix /c/dev/exiledata-ui run build     # ng build → dist/exiledata-ui/browser (prerenders ~4500 routes)
npm --prefix /c/dev/exiledata-ui run worker:dev  # wrangler dev → serves the build + /api/* on :8787
```

`worker:dev` mirrors production: static assets **and** the `/api/*` worker from one origin, applying
`_headers`/`_redirects` (so the `/valuation` CSR-shell rewrite works; those CSR routes fall back to
`browser/index.csr.html`). This catches the things `ng serve` can't: build-time prerender *failures*,
the CF serving layer, and `/api`.

> ⚠️ **Never run `wrangler dev` / `watch` as the edit loop.** wrangler snapshots its asset manifest at
> **startup** and does not re-index — so `watch`'s changing chunk hashes 404 (`ChunkLoadError`). Worse,
> wrangler (`workerd`) and vite leave **zombie child processes** holding their ports after you stop the
> parent, including on **IPv6** (`[::1]:4200`, `[::1]:8787`) which `netstat -ano -p tcp` does **not**
> show. Before restarting a server, reap stragglers: `netstat -ano | findstr :4200` (plain, both
> stacks) → `taskkill /F /PID <pid>`. This one gotcha caused most of our "local hosting is broken" time.
- **Catalog inputs are vendored** in `data-src/` (committed). copy-catalog reads them at build (was the
  sibling extraction repo). After re-extracting, refresh with `npm --prefix /c/dev/exiledata-extraction/dat-export
  run sync:ui` and commit `exiledata-ui/data-src`. (Override the source path with `CATALOG_SRC` if needed.)
- **API base**: `environment.development.ts` → `apiUrl: http://localhost:8787/api`; production
  `environment.ts` → `/api` (same-origin). So the watched build expects the worker (or a shim) on **:8787**.
- **Restart the watch after adding a new lazy-loaded component or installing a dep** — esbuild caches module
  resolution and won't pick up brand-new files.
- Verify a real build: `npm --prefix /c/dev/exiledata-ui run build` (prerenders ~4500 routes).

### exiledata-ui worker (`/api/*` — Cloudflare Worker)

The `/api/*` Hono app lives in `exiledata-ui/worker/` (the standalone `exiledata-worker` repo is retired).
`worker:dev` runs `wrangler dev`, which serves the built assets **and** `/api/*` from one origin, so hit the
site on **:8787** for `/api` to resolve same-origin.

```sh
npm --prefix /c/dev/exiledata-ui run db:migrate:local    # apply schema to the LOCAL D1
npm --prefix /c/dev/exiledata-ui run worker:dev          # wrangler dev → http://localhost:8787 (assets + /api)
```

- **Always run wrangler via the repo's npm scripts** (`npm --prefix /c/dev/exiledata-ui run …`) so its
  working dir is `exiledata-ui` and Miniflare uses `exiledata-ui/.wrangler/state`. Running `wrangler`
  from another cwd, or passing `--persist-to <absolute-path>`, makes Miniflare hash a **different** local D1
  file — so the DB you migrated/seeded is invisible and every query looks empty. `db:migrate:local` and
  `worker:dev` must be launched the same way to share one D1 file.
- **Trigger the Cron/scheduled handler locally** (runs the valuation harvest + the poe2scout
  currency-exchange ingest, writing D1 through the worker's own binding — the compatible way):
  ```sh
  # with `worker:dev` running:
  curl -X POST http://localhost:8787/cdn-cgi/handler/scheduled
  ```
  The valuation harvest is gated to ~6h; to force it, clear the cursor:
  `wrangler d1 execute exiledata --local --command "DELETE FROM poller_state WHERE id='poe2scout';"`
- **Restore real valuations into local D1 WITHOUT running the poller** (preferred for `/valuation` +
  `/filter` dev): `npm --prefix /c/dev/exiledata-ui run restore:valuations`. It pulls the small
  valuation tables (`valuations`/`valuation_meta`/`poller_state`, ~1.1k rows) via **plain
  `d1 execute --remote SELECT`s** — ordinary reads, so prod stays fully available (deliberately NOT
  `d1 export`, which takes a snapshot lock and briefly makes the prod DB unavailable) — turns the rows
  into `INSERT OR REPLACE` and applies them to local via `d1 execute --local --file`. Run
  `db:migrate:local` first if the local schema is empty. It imports `poller_state` too, so the local
  scheduled harvest stays gated and never re-runs the poller. The full DB
  (currency_snapshots/price_daily, ~300k rows) is left out; add tables to `TABLES` in
  `worker/scripts/restore-valuations.mjs` if you need `/currency/*` (at that size prefer `d1 export`).
- **Seed the local D1 manually** only with `wrangler d1 execute exiledata --local --file <sql>` (or
  `--command`). **Never write the local D1 sqlite with Node's `node:sqlite`** — Node 24's newer SQLite bumps
  the file format and Miniflare/wrangler can no longer open it (every D1 endpoint then returns 500, including
  ones you didn't touch). If that happens: delete
  `exiledata-ui/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` (keep `metadata.sqlite`) and
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

**Full local stack** = `npm --prefix /c/dev/exiledata-ui run start` (`ng serve`, :4200 — the UI) +
`npm --prefix /c/dev/exiledata-ui run worker:dev` (:8787 — real `/api/*`, seeded via the scheduled
trigger). **Shim stack** = `ng serve` (:4200) + a shim (:8787 → live), when you only need the UI against
live `/api` data. Both rely on `environment.development.ts` pointing `apiUrl` at `:8787`.

---

## Cloudflare deployment

### Consolidated deploy — one Worker (UI + API)

The target: the existing Worker `exiledata-worker` (upgraded in place) on `exiledata.com` serving the prerendered site (`[assets]`) + the
`/api/*` Hono app. Requires **Workers Paid** (Workflows + D1 write caps). Bindings (in
`exiledata-ui/wrangler.toml`): D1 `exiledata` (`database_id f83a4059-3d5d-44e1-a9c3-dcf1f13b3198`), R2
`exiledata-valuation` (`VALUATION_BUCKET`), Workflow `valuation-harvest`, `[assets]` `dist/exiledata-ui/browser`,
Cron `0 * * * *`.

- **Git-based (preferred):** Cloudflare **Workers Builds** connected to `github.com/josh-dastmalchi/exiledata-ui`.
  Build command `npm ci && npm run build`; deploy `wrangler deploy` (Workers Builds runs it). One CI run
  prerenders (~4522 routes, ~65s) and deploys worker + assets. Enable build caching for `node_modules` +
  `.angular/cache`. Push to `main` = deploy.
- **Local fallback:** `npm --prefix /c/dev/exiledata-ui run deploy:app` — builds, refuses to upload if any
  prerendered HTML contains `localhost`/`REPLACE_ME`, then `wrangler deploy`. **Stop the dev `watch`/`worker:dev`
  first** (they write the same `dist`).
- **DB migrations:** `npm --prefix /c/dev/exiledata-ui run db:migrate:local` (local) /
  `db:migrate:remote` (remote). Secrets via `wrangler secret put` (never in `.env`).
- **Remote D1 one-off exec / seed:**
  ```sh
  node --env-file-if-exists=C:/dev/exiledata-ui/.env \
    C:/dev/exiledata-ui/node_modules/wrangler/bin/wrangler.js \
    d1 execute exiledata --remote --config C:/dev/exiledata-ui/wrangler.toml --file <sql>
  ```
  Chunk multi-row INSERTs (~50 rows/statement) to avoid `SQLITE_TOOBIG`.
- **Caching**: `/api/valuation/snapshot` is an R2 artifact fronted by the edge Cache API (`Cache-Control` +
  `ETag`, ~1h fresh); token can't purge. `/api/currency/*` are **not** cached (read D1 each request).

### Cutover (Pages+split → single Worker) — DONE 2026-07-06 (recorded for history / rollback)

Completed: `exiledata.com` now resolves to the consolidated Worker (assets + `/api/*`), deployed by
Workers Builds on push to `exiledata-ui` `main`. Kept below as the record + the rollback path. Order was:
1. Deploy the unified worker (git or `deploy:app`); verify on its `*.workers.dev` URL (site + `/api/*`).
2. **Retire the old `exiledata-worker`** (or at least its Workflow) — a Workflow name is account-scoped, so
   `valuation-harvest` can't be owned by two scripts. Run remote D1 migrations against the same DB if needed.
3. Attach `exiledata.com` as the unified worker's **custom domain**. This supersedes the Pages custom domain
   and the hand-made `/api/*` route — remove that route. Retire the old `exiledata-ui` Pages project.
4. **Rollback if broken:** detach the custom domain from the worker and re-point `exiledata.com` at the Pages
   project (the old artifact is still there); re-add the `/api/*` route to the old worker.

### Assets (Cloudflare Pages / static)

`exiledata-assets` is fully static (no build). Either keep local `npm --prefix /c/dev/exiledata-assets run
deploy`, or connect the GitHub repo for git-based deploy (build command = `node scripts/stage-deploy.mjs`,
output `dist-deploy` — keeps the 60fps-source exclusion + file-count guard). → `assets.exiledata.com`.

---

## Data features (where the pieces live)

- **Valuation** (auth-free): poe2scout `ByCategory` → `item_prices`/`valuations`/`price_daily` in D1;
  `finalize` publishes `valuation/<realm>/latest.json` to R2 → `GET /api/valuation/snapshot`. UI: `/valuation`.
- **Currency arbitrage** (auth-free): poe2scout `SnapshotPairs` → `currency_snapshots` (hourly, ungated
  ingest in `scheduled()`); `computeBackboneArbitrage` → `GET /api/currency/arbitrage`. UI: the
  arbitrage panel on the `/valuation` landing. Backbone-only by design — the full currency graph is too
  noisy to price. See the worker README and the plan for the why.

## Gotchas checklist

- ✅ `ng serve` (`npm run start`, :4200) IS the iteration loop (dev-SSR + HMR). ❌ don't use `wrangler
  dev`/`watch` as the edit loop — stale asset manifest → `ChunkLoadError`, plus zombie ports. Reserve
  `build` + `worker:dev` for deploy-shape verification.
- ❌ seeding local D1 with `node:sqlite` — use `wrangler d1 execute --local` or the scheduled trigger.
- ❌ running `wrangler` from the wrong cwd / `--persist-to <abs>` — use the repo's npm scripts.
- ⚠️ **Windows drive-letter casing:** invoke `npm`/`node` with an **uppercase** drive (`C:/dev/...`). A
  lowercase `c:/` makes `vitest` load its runner twice → every test errors `Cannot read properties of
  undefined (reading 'config')` (vitest #5251). Same class of bug can bite other path-keyed tools.
- ⚠️ re-extracted the catalog? run extraction's `sync:ui` and commit `exiledata-ui/data-src` (else CI builds stale data).
- ⚠️ installed a new dep? restart `ng serve` (esbuild caches module resolution). Stopping any dev
  server? reap zombie children on its port — incl. IPv6 `[::1]` — with plain `netstat -ano` (not `-p
  tcp`) → `taskkill /F /PID` before restarting.
- ❌ **NEVER `npm run deploy` / `wrangler deploy` the standalone `/c/dev/exiledata-worker`** — it's RETIRED and
  shares the worker name `exiledata-worker` but has no `[assets]`, so a manual deploy CLOBBERS the git-deployed
  consolidated worker → the whole site 404s (root → Hono `{"error":"not_found"}`; `/api` still works). Caused an
  outage 2026-07-06. Recover by pushing `exiledata-ui` (Workers Build redeploys the consolidated worker, ~2min).
  Worker changes go in `exiledata-ui/worker/` + git push.
- ⚠️ `/api/valuation/snapshot`: worker sends `max-age=0, s-maxage=300` (browsers revalidate; edge 5min); a zone
  **Cache Rule scoped to `/api` = "Respect origin"** stops CF's default 4h Browser Cache TTL from overriding it.
  `/api/currency/*` is not cached. Token can't purge cache or manage routes/rules (dashboard only).
- ⚠️ stop the UI `watch`/`worker:dev` before `npm run deploy:app` (they share `dist`).
