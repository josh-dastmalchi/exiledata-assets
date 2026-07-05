# Working in this workspace

This is the multi-repo **exiledata** layout. Sibling repos under `/c/dev`: `exiledata-ui`
(Angular browser), `exiledata-extraction` (PoE2 dat/asset extraction), `exiledata-assets` (static
art/data, primary working dir), `exiledata-api`.

## Tool use — NON-NEGOTIABLE (this is the #1 source of friction; obey exactly)

The Bash allowlist matches on the command's **leading token**. `git`, `npm`, `npx`, `node`,
`dotnet` are allowed; everything else (and any compound command) prompts. So:

1. **NEVER chain, and NEVER lead with anything but an allowlisted command.** No `&&`, no `;`, no
   leading `cd`, no `>`/`|` redirects — AND no leading **variable assignment** (`VAR=…`) and no
   leading **command substitution** (`$(…)`). The matcher keys on the literal first token: `ff=… ;
   "$ff" …` has leading token `ff=`, which matches no rule → prompt, even if every part is a
   harmless read. One command, one allowlisted leading token (`node`/`npm`/`npx`/`git`/`dotnet`).
   Need a value computed first? Do the whole thing in `node`, don't assemble it in shell.
2. **NEVER use `cat`, `ls`, `grep`, `find`, `head`, `tail`, `echo` in Bash.** Use the dedicated
   tools — **Read** (not cat/head/tail), **Glob** (not ls/find), **Grep** (not grep). They never
   prompt and integrate with the UI.
3. **Cross-repo without `cd`:** run by absolute path — `node /c/dev/exiledata-ui/scripts/x.mjs`,
   `npm --prefix /c/dev/exiledata-ui run build`, `git -C /c/dev/exiledata-ui status`. The leading
   token stays `node`/`npm`/`git`, so it hits the allowlist regardless of cwd.
4. System `node` is already v24 — run `node`/`npm` **bare**, never with a PATH prefix or `export`.

If a one-off needs a non-allowlisted tool, accept the single prompt — do **not** wrap it in `cd …
&&` hoping to batch it; that just guarantees the prompt.

See also memory: `bash-permission-friction`, `exiledata-extraction-tooling`.

## Working style — also binding

- **Layout: grid first.** For every UI container in `exiledata-ui` (Angular + Tailwind v4), reach
  for `grid` by default, then `flex`, then anything else. No float/inline-block/table layouts. See
  memory `ui-container-grid-preference`.
- **Never declare game data absent after one search.** This has been wrong every time. Before
  saying "the game data doesn't have X," check: **loose files on disk** (not just the bundle index —
  e.g. videos live at `Art/Videos/...`), **alternate texture/asset paths**, and **all `ModDomains`**
  (map=6, jewel=11, tincture=34, desecrated=28). The user is the domain expert; if they say it
  exists, it exists — keep looking. See memory `dont-declare-data-absent`.
- **Dev server: real `ng build --watch`, NEVER `ng serve`.** `ng serve` does NOT reflect production —
  it runs dev-mode client rendering and skips the static prerender (`outputMode: static`) the real
  build produces, so it hides SSG / hydration / TransferState-inlining bugs (the exact things we keep
  needing to verify). Use a real build that watches: `npm --prefix /c/dev/exiledata-ui run watch`
  (emits `dist/exiledata-ui/browser`) and serve that output statically (SWA CLI, like the assets
  repo). One-shot `npm --prefix /c/dev/exiledata-ui run build` for verification. Caveat: **restart**
  the watch/build after adding a new lazy-loaded component or installing a dep — esbuild caches module
  resolution and won't pick up brand-new files. See memory `exiledata-ui-dev-server`.

## Local dev & Cloudflare deploys — binding

**Full stack documented in [`DEVELOPMENT.md`](DEVELOPMENT.md)** (this repo) — read it before local-dev or
deploy work. UI → Pages (`exiledata.com`), worker → `exiledata.com/api/*`, assets → Pages
(`assets.exiledata.com`). Each deployable repo has a gitignored `.env` (`CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID`); deploy via that repo's `npm run deploy`. Non-negotiable gotchas:

- **Worker local dev:** launch wrangler ONLY via `npm --prefix /c/dev/exiledata-worker run dev` /
  `run db:migrate:local` (cwd = worker repo) — a different cwd or `--persist-to <abs>` hashes a *different*
  local D1 file and your data looks empty.
- **NEVER seed the local D1 with `node:sqlite`** — Node 24's SQLite bumps the file format and Miniflare
  can't reopen it (all D1 endpoints 500). Seed via `wrangler d1 execute … --local --file`, or trigger the
  scheduled handler: `curl -X POST http://localhost:8787/cdn-cgi/handler/scheduled`. To recover: delete
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` (keep `metadata.sqlite`) + re-`db:migrate:local`.
- **UI eval shim:** the dev config points at `localhost:8787`; a tiny Node shim there proxying `/api/*` to
  the live worker (cache-busting `/valuation/snapshot`) is the lightest way to eval the UI on real data.
- **Deploy:** worker `npm run deploy` (registers Workflow + Cron `0 * * * *`; route bound by hand in the
  dashboard). UI `npm run deploy` (Pages; **stop the `watch` first**). Remote D1: `run db:migrate:remote`;
  one-off seed via `node --env-file-if-exists=.env node_modules/wrangler/bin/wrangler.js d1 execute exiledata
  --remote --file <sql>` (chunk ~50 rows/INSERT). `/api/valuation/snapshot` is edge-cached ~1h; token can't
  purge. See memory `local-dev-and-deploy`.
