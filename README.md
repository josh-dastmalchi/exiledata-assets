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
  2DItems/...                         # the webp tree (artPath mirrored, ~2.6k files)
  staticwebapp.config.json            # immutable cache on *.webp, no SPA fallback, CORS
  index.html / 404.html               # landing + real 404 (assets must 404, not rewrite)
  .github/workflows/                  # Azure Static Web Apps deploy
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

**Azure Static Web Apps** (chosen for instant custom domain + free managed HTTPS). Pushes
to `main` deploy the current tree; SWA uploads the whole folder, which is fine at this
scale (item icons are tiny). `staticwebapp.config.json` sets long immutable caching on
`*.webp` and disables the SPA fallback so a missing image returns a real `404`.

> If the library ever approaches the SWA app-size ceiling (250 MB Free / 500 MB Standard),
> the escape hatch is Blob Storage + Front Door with `azcopy sync` (delta-only upload).
