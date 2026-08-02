// Vendor GGG's official passive-tree runtime assets into skilltree/ for the CDN.
//
// The visual passive tree (/passives/tree in exiledata-ui) renders with @poe2-toolkit/tree-core +
// PixiJS. It needs three things at runtime, served cross-origin from assets.exiledata.com (the
// _headers `/*` rule already sends `Access-Control-Allow-Origin: *`, which WebGL texture upload
// requires):
//   tree-data.json — GGG's raw skill-tree export (normalized in the browser by tree-core/ggg).
//   manifest.json  — sprite manifest: every atlas key the renderer asks for -> {atlas,x,y,w,h}.
//   <atlas>.webp   — the packed atlas bitmaps the manifest indexes into.
//
// Source: the sibling poe2-skilltree-export repo (GGG's official export: one data.json + an assets/
// dir of atlas .webp + companion .json sheets). Re-run after pulling a new tree version there.
//
//   node scripts/vendor-skilltree.mjs
//
// The atlas .json sheets are keyed `<sheet>:<Key>` (e.g. `frame:KeystoneFrameAllocated`,
// `line:Orbit2Active`, `normalActive:Art/…png`). tree-react's spriteKeys helper asks for the BARE
// key for structural sheets (frame/line) but the FULL key for icon/effect sheets (the variant prefix
// is semantic there) — so frame/line get their prefix stripped, skills/mastery keep the whole key.
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
const EXPORT = join(root, '..', 'poe2-skilltree-export')
const ASSETS = join(EXPORT, 'assets')
const OUT = join(root, 'skilltree')

// Atlas sheets the base render needs. `strip` drops the `<sheet>:` prefix (structural sheets whose
// prefix is not part of the key the renderer asks for). Centre-hub art (background-*, group-
// background) is intentionally omitted — the renderer falls back to a vector hub without it.
// Playable classes that have a background-<class>.webp (portrait + ascendancy discs).
const CLASSES = ['druid', 'huntress', 'mercenary', 'monk', 'ranger', 'sorceress', 'warrior', 'witch']
const SHEETS = [
  { file: 'skills', strip: false }, // node icons; keys already `<variant>Active:<icon>`
  { file: 'mastery-effect-active', strip: false }, // notable/mastery background patterns
  { file: 'frame', strip: true }, // node overlay frames
  { file: 'line', strip: true }, // straight + orbit-arc connectors
  // Centre-hub art: the two concentric rings (startNode:MainCircle[Active]) + each class's portrait
  // (classNAME:Class0) and ascendancy discs (classNAME:Class1..N). Keys kept whole (the renderer asks
  // for them literally). background-<class> bitmaps are large + loaded on demand per selected class.
  { file: 'group-background', strip: false },
  ...CLASSES.map((c) => ({ file: `background-${c}`, strip: false })),
]

mkdirSync(OUT, { recursive: true })

// ⚠️ THE SHEET FILENAMES ARE CONTENT-HASHED, AND THEY HAVE TO BE. `_headers` serves `/*.webp` as
// `max-age=31536000, immutable` while `manifest.json` (not a .webp) revalidates normally, so at a stable
// `frame.webp` path those two files can SKEW: a browser holding last year's sheet picks up this year's
// rects and samples every sprite from the wrong place. `immutable` means it won't revalidate even on a
// hard reload, so the corruption persists for the full year.
//
// This is not hypothetical — it shipped once on the packed tree sheets (the Genesis Wombs drew "a low
// quality border with two different square icons inside" after the sprite caps were retuned). Those are
// hashed now; these vendored sheets were the last stable-path pair left, and they carry the SAME risk
// the moment a new GGG export repacks an atlas.
//
// The hash goes in the filename so the URL changes whenever the bytes do — `immutable` becomes true
// rather than a lie, and a manifest can only ever be read against the sheets it was generated with.
// `frames[].atlas` stays the LOGICAL sheet id the renderer keys textures by; `atlases` maps that id to
// the real filename. Every consumer must resolve through `atlases` (see tree-scene.service.ts).
const frames = {}
const atlases = {}
let dup = 0
for (const sheet of SHEETS) {
  const json = JSON.parse(readFileSync(join(ASSETS, `${sheet.file}.json`), 'utf8'))
  for (const [key, val] of Object.entries(json.frames)) {
    const outKey = sheet.strip ? key.slice(key.indexOf(':') + 1) : key
    if (frames[outKey]) dup++
    const f = val.frame
    frames[outKey] = { atlas: sheet.file, x: f.x, y: f.y, w: f.w, h: f.h }
  }
  const webp = readFileSync(join(ASSETS, `${sheet.file}.webp`))
  const file = `${sheet.file}.${createHash('sha256').update(webp).digest('hex').slice(0, 8)}.webp`
  writeFileSync(join(OUT, file), webp)
  atlases[sheet.file] = file
}

// Drop superseded sheets so the directory doesn't accumulate one per vendor run. Deliberately narrow:
// only `<sheet>.webp` and `<sheet>.<hash>.webp` for the sheets just written — the unhashed name is the
// pre-hashing legacy file and must go, or `immutable` keeps serving it to anyone with the old URL.
//
// ⚠️ DEPLOY ORDER, one time only, for the hashing cutover: ship exiledata-ui BEFORE this repo. The new
// UI reads `atlases` but falls back to `<id>.webp`, so it works against either manifest; a UI that
// predates the fallback hardcodes `<id>.webp` and would 404 the moment these unhashed files are gone.
// UI-then-assets has no broken window; assets-then-UI breaks every tree until the UI catches up.
const keep = new Set(Object.values(atlases))
const sheetNames = SHEETS.map((s) => s.file)
const stale = readdirSync(OUT).filter((f) => {
  const m = /^(.+?)(?:\.[0-9a-f]{8})?\.webp$/.exec(f)
  return m && sheetNames.includes(m[1]) && !keep.has(f)
})
for (const f of stale) unlinkSync(join(OUT, f))

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ atlases, frames }))
// GGG's data.json is pretty-printed (~5.1 MB). Reparse + write it minified (~2.3 MB). Brotli makes
// the on-the-wire cost nearly identical, but minifying halves the transient decompressed text buffer
// the browser holds before parse and shaves parse time — free, since the browser normalizes it anyway.
writeFileSync(join(OUT, 'tree-data.json'), JSON.stringify(JSON.parse(readFileSync(join(EXPORT, 'data.json'), 'utf8'))))

// Ascendancy-only slice of the raw export, for the read-only /classes disc views (exiledata-ui's
// TreeSceneService). Those views render ONE ascendancy disc at a time and never touch the ~4900
// main-tree nodes, yet loaded the whole ~5MB export. Keep every ascendancy node + the groups they sit
// in; leave everything else intact (edges table, classes, skillOverrides, bounds) so tree-core's
// normalizeGggTree + buildScene compute IDENTICAL ascendancy geometry — verified byte-identical across
// all ascendancies (nodes, connections, disc worldAnchor/size). ~5.1MB -> ~0.6MB. The full tree-data.json
// stays for the /passives/tree planner (which keeps its own loader).
const raw = JSON.parse(readFileSync(join(EXPORT, 'data.json'), 'utf8'))
const ascNodes = Object.entries(raw.nodes).filter(([, n]) => n.ascendancyId)
const ascGroups = new Set(ascNodes.map(([, n]) => n.group).filter((g) => g != null))
const ascSkills = new Set(ascNodes.map(([, n]) => Number(n.skill)))
const ascOnly = {
  ...raw,
  nodes: Object.fromEntries(ascNodes),
  groups: Object.fromEntries(Object.entries(raw.groups).filter(([g]) => ascGroups.has(Number(g)))),
  // Intra-ascendancy edges only (both endpoints kept). normalize keys arc geometry by the (from,to)
  // node pair, not the array index, so reindexing the filtered array is safe.
  edges: raw.edges.filter((e) => ascSkills.has(Number(e.from)) && ascSkills.has(Number(e.to))),
  jewelSlots: [], // all jewel sockets are main-tree; ascendancies have none
}
writeFileSync(join(OUT, 'ascendancy-tree-data.json'), JSON.stringify(ascOnly))

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`
console.log(`vendor-skilltree -> ${OUT}`)
console.log(`  manifest.json: ${Object.keys(frames).length} sprite keys${dup ? ` (${dup} dup keys across sheets)` : ''}, ${kb(join(OUT, 'manifest.json'))}`)
for (const s of SHEETS) console.log(`  ${atlases[s.file]}: ${kb(join(OUT, atlases[s.file]))}`)
if (stale.length) console.log(`  removed superseded: ${stale.join(', ')}`)
console.log(`  tree-data.json: ${kb(join(OUT, 'tree-data.json'))}`)
console.log(`  ascendancy-tree-data.json: ${kb(join(OUT, 'ascendancy-tree-data.json'))} (${ascNodes.length} asc nodes)`)
