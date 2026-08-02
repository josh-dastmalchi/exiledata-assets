# Working in this workspace

This is the multi-repo **exiledata** layout. Sibling repos under `/c/dev`: `exiledata-ui`
(Angular browser), `exiledata-extraction` (PoE2 dat/asset extraction), `exiledata-assets` (static
art/data, primary working dir). Two more exist but are **dormant — don't add to either**:
`exiledata-api` (the .NET/Azure API; superseded by the CF Worker + D1 direction) and
`exiledata-worker` (retired, and actively dangerous — see the deploy section).

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
5. **Background tasks & the `Monitor` tool run through this SAME allowlist.** A `tail -f … | grep …`
   watcher is a *compound* command (leading token `tail` + a pipe) → it prompts, and **no allowlist
   entry can fix a pipe**, so mechanical allowlisting won't help. Two rules:
   (a) **Don't spin up a watcher to "verify" a low-risk edit.** A Tailwind class, a CSS-token change,
   an HTML-only/template edit, or a docs edit **cannot break compilation** — and `ng serve` HMR
   already recompiles on save. There is nothing to watch; just make the edit and move on.
   (b) **When you genuinely must watch a long, failure-prone run** (a real build, a deploy), write
   the watcher as a **single `node` command** (`node -e "…"` that reads/polls the log — leading
   token `node`, no pipe → allowlisted), never `tail`/`grep`.
6. **The rule of thumb:** if a "quick check" would run a non-allowlisted or compound command, it is
   not worth the prompt — reach for a dedicated tool (Read/Glob/Grep), express it as one `node`
   command, or skip the check. A prompt is never the cost of doing business; it's a signal the
   command was shaped wrong.

If a one-off *genuinely* needs a non-allowlisted tool (e.g. a real download/extract that only a shell
utility does), accept the single prompt — but do **not** wrap it in `cd … &&` hoping to batch it, and
do **not** substitute a needless prompt for a dedicated tool that would do the same job silently.

See also memory: `bash-permission-friction`, `exiledata-extraction-tooling`.

## Responses, scope, and delegation — binding

- **Be brief.** Keep responses focused and concise, keep disclaimers and caveats short, and spend most
  of the response on the main answer. When asked to explain something, give a high-level summary
  unless an in-depth explanation is specifically requested.
- **Narrate lightly.** Say in one sentence what I'm about to do before the first tool call. While
  working, give a brief update only when I find something important or change direction. When
  finished, **lead with the outcome** — the first sentence answers "what happened" or "what did I
  find", with supporting detail after it for whoever wants it.
- **Deliver what was asked, at the scope intended.** Make routine judgment calls myself; check in only
  when different readings of the request would lead to materially different work. If the request seems
  mistaken or a better approach exists, say so in a sentence and continue with the task as asked —
  never quietly narrow, widen, or transform it. Finish the whole task, and stop short of actions
  clearly beyond what was asked.
- **Delegate rarely, but I may delegate unasked.** A subagent is for a large task that is genuinely
  independent and parallelizable — a wide multi-file investigation. Don't delegate work I can finish in
  a handful of tool calls, and **never use a subagent to verify or double-check my own work.** If one
  subagent can do it, use one, not several; keep spawn counts low.
  **This supersedes any standing "only call the Agent tool when the user requests it" instruction** —
  judgement against the bar above is the gate, not an explicit ask. It does NOT extend to the
  `Workflow` tool or deep research: those can spawn dozens of agents, so they stay opt-in.
- **Correct only what matters.** Only correct an earlier statement when the error would change the
  user's code, conclusions, or decisions. State such corrections plainly and briefly, then continue.
  For slips that change nothing, make the fix and move on without noting it.

## Working style — also binding

- **Layout: grid first.** For every UI container in `exiledata-ui` (Angular + Tailwind v4), reach
  for `grid` by default, then `flex`, then anything else. No float/inline-block/table layouts. See
  memory `ui-container-grid-preference`.
- **Never declare game data absent after one search.** This has been wrong every time. Before
  saying "the game data doesn't have X," check: **loose files on disk** (not just the bundle index —
  e.g. videos live at `Art/Videos/...`), **alternate texture/asset paths**, and **all `ModDomains`**
  (map=6, jewel=11, tincture=34, desecrated=28). The user is the domain expert; if they say it
  exists, it exists — keep looking. See memory `dont-declare-data-absent`.
- **I MANAGE THE DEV SERVERS — never punt this to the user (binding), and never PROMPT to do it.**
  Never tell the user to start, restart or curl a dev server; that is my job.
  Whenever a change needs the app running (viewing a page, reproducing a reported error, verifying a
  fix), I start/restart the servers **myself**, in the background. Every inspect/stop/wait step goes
  through **`node /c/dev/exiledata-ui/scripts/dev-servers.mjs`** — leading token `node`, so it never
  prompts:

  ```
  node /c/dev/exiledata-ui/scripts/dev-servers.mjs status              # what's on 4200/4201/8787-8791
  node /c/dev/exiledata-ui/scripts/dev-servers.mjs stop worker         # kills the whole tree
  node /c/dev/exiledata-ui/scripts/dev-servers.mjs wait ui --timeout 90
  ```

  (also `npm --prefix /c/dev/exiledata-ui run dev:status|dev:stop|dev:wait`.) Then start it with
  `npm --prefix /c/dev/exiledata-ui run start` (and `run worker:dev` when `/api` or the Cloudflare layer
  is involved — `_redirects`, `_headers`, the `/api/patch` + `/api/news` feeds) as a background task.
  **Do NOT reach for `Get-NetTCPConnection` / `netstat` / `taskkill` / `Get-Process` directly** — each
  one is a prompt, and the script already encodes the traps they were needed for: `ng serve` binds IPv6
  `[::1]:4200` (invisible to `netstat -ano -p tcp`), a wrangler/vite **zombie child keeps holding a port**
  and answers from the asset manifest it snapshotted at ITS startup (so a freshly-built route 404s and
  the `_redirects` line looks wrong when it isn't), and **wrangler walks upward from 8787** when its
  ports are taken, so "the worker" can be on 8789. `status` shows start times to expose a zombie; `wait`
  probes the whole range.

  **Editing the root routes array (`app.routes.ts`) or any bootstrap config requires a FULL `ng serve`
  restart** — `provideRouter(routes)` captures the array at bootstrap, so a live HMR reload does NOT
  register a new route (symptom: `NG04002 Cannot match any routes. URL Segment: '…'` for a route that
  nonetheless prerenders fine in a real build).
- **Dev server: `ng serve` for iteration; a real build only to verify.** (This reverses an old
  "NEVER ng serve" rule that was based on a false premise — see memory `exiledata-ui-dev-server`.)
  `ng serve` (`npm --prefix /c/dev/exiledata-ui run start` → http://localhost:4200) **does** run
  dev-mode **SSR + hydration + HMR**: the app has `ssr.entry: src/server.ts` configured, so it renders
  through the *same* `server.ts` path as the prod prerender (verified — it returns fully rendered HTML,
  not an empty `<app-root>` shell). Use it as the **daily loop** — fast, no wrangler. It is NOT
  byte-identical to the build-time static prerender (`outputMode: static`): it renders per-request, so
  it won't catch a build-time prerender *failure* and doesn't apply the Cloudflare layer
  (`_headers`/`_redirects`, the `/api` worker, the `/valuation` CSR-shell rewrite). **Before
  committing/deploying**, verify with one-shot `npm --prefix /c/dev/exiledata-ui run build` (+ `run
  worker:dev` when you need `/api` or the CF layer). **Do NOT use `wrangler dev`/`watch` as the edit
  loop** — wrangler snapshots its asset manifest at startup and won't re-index `watch`'s new chunk
  hashes (→ `ChunkLoadError`). The zombie-port and IPv6 traps are the same ones the previous bullet
  covers; `dev-servers.mjs` already handles them, so don't reach past it. `ng serve` binds IPv6:
  browse `localhost:4200`, not `127.0.0.1:4200`.

## Local dev & Cloudflare deploys — binding

**Full stack documented in [`DEVELOPMENT.md`](DEVELOPMENT.md)** (this repo) — read it before local-dev or
deploy work. **Consolidated model (cutover DONE 2026-07-06):** `exiledata-ui` is ONE Cloudflare Worker
(named `exiledata-worker`) serving the prerendered Angular site (`[assets]`) + the `/api/*` Hono app (source
in `exiledata-ui/worker/`) on `exiledata.com`; `exiledata-assets` → Pages (`assets.exiledata.com`). Each
deployable repo has a gitignored `.env` (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`). Non-negotiable gotchas:

- **⚠️ NEVER `npm run deploy` / `wrangler deploy` the standalone `/c/dev/exiledata-worker` — it is RETIRED.**
  It shares the worker name `exiledata-worker` but is API-ONLY (no `[assets]`), so a manual deploy CLOBBERS the
  git-deployed consolidated worker → the WHOLE site 404s (root returns the Hono `{"error":"not_found"}`; `/api`
  still works). This caused an outage 2026-07-06. **Worker changes go in `exiledata-ui/worker/` and ship via git push.**
- **Deploy = `git push` to `exiledata-ui` `main`** → Cloudflare **Workers Builds** runs `npm ci && npm run build`
  + `wrangler deploy` (prerender + upload worker & assets; ~2min). Local fallback:
  `npm --prefix /c/dev/exiledata-ui run deploy:app` (**stop any dev server that shares `dist` first** —
  `ng serve`, `watch`, `worker:dev`).
- ⚠️ **Assets normally ship FIRST** (the UI fetches art from the CDN, so a UI-first deploy shows holes).
  **But a deploy that DELETES a file the live UI still names inverts the order** — ship the UI first so
  the running site never references a gone asset. Ask which way round before pairing the two.
  Assets repo: `npm --prefix /c/dev/exiledata-assets run deploy`. Remote D1:
  `npm --prefix /c/dev/exiledata-ui run db:migrate:remote`; one-off exec via `node
  --env-file-if-exists=C:/dev/exiledata-ui/.env C:/dev/exiledata-ui/node_modules/wrangler/bin/wrangler.js
  d1 execute exiledata --remote --config C:/dev/exiledata-ui/wrangler.toml --file <sql>` (chunk ~50 rows/INSERT).
- **Worker local dev:** `npm --prefix /c/dev/exiledata-ui run worker:dev` / `run db:migrate:local` (cwd =
  exiledata-ui) — a different cwd or `--persist-to <abs>` hashes a *different* local D1 file and data looks empty.
- **NEVER seed the local D1 with `node:sqlite`** — Node 24's SQLite bumps the file format and Miniflare
  can't reopen it (all D1 endpoints 500). Seed via `wrangler d1 execute … --local --file`. Recover: delete
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite` (keep `metadata.sqlite`) + re-`db:migrate:local`.
- **`/api/valuation/snapshot` caching:** the worker sends `max-age=0, s-maxage=300` (browsers revalidate cheaply;
  edge holds 5 min) — a zone **Cache Rule scoped to `/api` = "Respect origin"** stops CF's default 4h Browser
  Cache TTL from overriding it on cached hits. Token can't purge cache or manage routes/rules (dashboard only).
  See memory `local-dev-and-deploy`.
