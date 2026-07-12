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
import { cpSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
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

const frames = {}
let dup = 0
for (const sheet of SHEETS) {
  const json = JSON.parse(readFileSync(join(ASSETS, `${sheet.file}.json`), 'utf8'))
  for (const [key, val] of Object.entries(json.frames)) {
    const outKey = sheet.strip ? key.slice(key.indexOf(':') + 1) : key
    if (frames[outKey]) dup++
    const f = val.frame
    frames[outKey] = { atlas: sheet.file, x: f.x, y: f.y, w: f.w, h: f.h }
  }
  cpSync(join(ASSETS, `${sheet.file}.webp`), join(OUT, `${sheet.file}.webp`))
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ frames }))
cpSync(join(EXPORT, 'data.json'), join(OUT, 'tree-data.json'))

const kb = (p) => `${(statSync(p).size / 1024).toFixed(0)} KB`
console.log(`vendor-skilltree -> ${OUT}`)
console.log(`  manifest.json: ${Object.keys(frames).length} sprite keys${dup ? ` (${dup} dup keys across sheets)` : ''}, ${kb(join(OUT, 'manifest.json'))}`)
for (const s of SHEETS) console.log(`  ${s.file}.webp: ${kb(join(OUT, `${s.file}.webp`))}`)
console.log(`  tree-data.json: ${kb(join(OUT, 'tree-data.json'))}`)
