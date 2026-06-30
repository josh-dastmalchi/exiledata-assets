# exiledata-assets

Static CDN of converted **Path of Exile 2 item art** (`.webp`), one of the three
ExileData repos (alongside `exiledata-api` and `exiledata-ui`). It exists to give the
**Item Data Browser** an image for every item; the loot-filter generator emits text and
needs no art. See `exiledata-api/PRODUCT.md` and `DATA-SOURCING.md`.

## Layout

Each image mirrors the catalog's stored `artPath`, so the served URL is purely derivable:

```
<assets-domain>/<artPath>.webp
e.g.  /2DItems/Currency/CurrencyRerollRare.webp
```

```
exiledata-assets/
  2DItems/  2dart/  textures/          # the webp trees (artPath mirrored, ~11.6k files)
  art/videos/skilltutorials/           # skill-tutorial webm — LOCAL ONLY (too big for SWA, not deployed)
  staticwebapp.config.json             # immutable cache on *.webp, no SPA fallback, CORS
  index.html / 404.html                # landing + real 404 (assets must 404, not rewrite)
  scripts/stage-deploy.mjs             # builds the deploy payload (webp + config; videos excluded)
```

## How images get here (the pipeline)

Extraction is a **build step in `exiledata-api`, not here** — this repo holds only the
output. To (re)generate after a game patch:

```bash
cd exiledata-api/dat-export
node extract-assets.ts             # reads data/base-items.json artPaths,
                                   # decodes Art/<artPath>.dds from the game bundles,
                                   # writes <artPath>.webp into ../../exiledata-assets
```

Item art is uncompressed (DX10/R8G8B8A8), so `extract-assets.ts` decodes it in **pure Node**
via `sharp` — **no ImageMagick**. The block-compressed UI art that also lands in this repo
(skill/buff icons, gem-hover posters via `extract-ui-art.ts` / `extract-hover-images.ts`: BC1/BC7)
**does** require **ImageMagick** (`magick`, with the webp delegate) on PATH. Source is the local
game install (`config.json` `steam`) or GGG's patch CDN (`config.json` `patch`) — no game
install needed in CI.

The art library is **version-pinned and cumulative**: a patch *adds* new art and
occasionally *overwrites* a changed path, but old art is **kept** so older catalog
versions still render. A patch commit is the delta (`+N new`, rarely `~M changed`), never
a full re-export.

## Deploy

**Azure Static Web Apps** (Free tier) as the origin, **fronted by Cloudflare** for edge
caching + TLS. Deploys run from local with the SWA CLI — there is no GitHub Actions pipeline
(the repo has no remote, and the video set would blow the upload size cap):

```bash
export SWA_CLI_DEPLOYMENT_TOKEN=<token>   # az staticwebapp secrets list … / portal
npm run deploy                            # stages dist-deploy/ then uploads it
```

`scripts/stage-deploy.mjs` excludes `art/videos/` (~800 MB) so the payload (~65 MB / ~11.6k
files) fits the Free **250 MB** size cap and ~15k-file cap. `staticwebapp.config.json` sets
long immutable caching on `*.webp` and disables the SPA fallback so a missing image returns a
real `404`. The videos stay local until they get a Blob Storage + CDN home.

### Routing (Cloudflare → SWA)

- DNS: `CNAME assets → <swa>.azurestaticapps.net`, **proxied (orange cloud)** so Cloudflare's
  edge cache fronts SWA — important because SWA Free has a ~100 GB/mo bandwidth quota; Cloudflare
  serves the cached `.webp` and only misses reach the origin.
- TLS: Cloudflare SSL/TLS mode **Full (strict)**. Do **not** use "Flexible" — SWA forces HTTPS,
  which becomes a redirect loop.
- Validate the SWA custom domain via **TXT** (works while the CNAME is proxied), or set the CNAME
  DNS-only until SWA issues its managed cert, then flip to proxied.
- The UI consumes this as its prod `assetsUrl = https://assets.<domain>`.

> **Cache caveat:** `*.webp` is `immutable` and paths are stable (not content-hashed). On a patch
> that *overwrites* an existing art path, purge those paths from Cloudflare — otherwise the edge
> (and browsers) serve the stale image until the 1-year TTL expires. New paths are unaffected.
