// Stage the Cloudflare Pages deploy payload into dist-deploy/.
//
// Everything the CDN serves — the webp trees (2DItems/2dart/textures), the 188 skill-tutorial videos
// under art/videos/, index.html, 404.html, and _headers — is copied as-is (no build; the webp are
// pre-converted). The only things filtered out are repo plumbing, dotfiles, and the gitignored 60fps
// video source (art/videos/skilltutorials-orig60fps/, a re-encode safety net that is never shipped).
// New top-level asset dirs are picked up automatically.
//
// Unlike Azure SWA (500MB app cap), Cloudflare Pages has no total-size limit — only 20,000 files per
// deployment and 25MB per file — so the videos that SWA couldn't hold now ship here.
import { cpSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const out = join(root, 'dist-deploy');

// Repo plumbing that must never ship to the CDN. (All top-level dotfiles — .git, .env, .gitignore,
// … — are dropped separately below, so a real .env with the deploy token can never be uploaded.)
const EXCLUDE_TOP = new Set([
  'node_modules',
  'scripts',
  'dist-deploy',
  'swa-cli-output',
  'package.json',
  'package-lock.json',
  'README.md',
  'CLAUDE.md',
]);
// The 60fps source webms are gitignored and far larger than the shipped 30fps versions — never ship.
const ORIG60 = join(root, 'art', 'videos', 'skilltutorials-orig60fps');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Copy each kept top-level entry individually (cpSync refuses to copy root into its own subdir).
for (const e of readdirSync(root, { withFileTypes: true })) {
  if (e.name.startsWith('.')) continue; // never ship dotfiles (.git, .env, .gitignore, …)
  if (EXCLUDE_TOP.has(e.name)) continue;
  const src = join(root, e.name);
  // art/ ships (webp + the 30fps videos); only the 60fps source subtree is skipped.
  if (e.name === 'art') {
    cpSync(src, join(out, e.name), {
      recursive: true,
      filter: (p) => p !== ORIG60 && !p.startsWith(ORIG60 + sep),
    });
  } else {
    cpSync(src, join(out, e.name), { recursive: true });
  }
}

// Cloudflare Pages limits: 20,000 files per deployment, 25MB per file.
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
let bytes = 0;
let count = 0;
const oversized = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      const s = statSync(p).size;
      bytes += s;
      count++;
      if (s > MAX_FILE_BYTES) oversized.push(p);
    }
  }
})(out);

const mb = bytes / 1048576;
console.log(`staged ${count} files, ${mb.toFixed(1)} MB -> dist-deploy/ (videos included)`);
if (oversized.length) {
  console.error(`ERROR: ${oversized.length} file(s) exceed Cloudflare's 25MB limit (e.g. ${oversized[0]})`);
  process.exit(1);
}
if (count > MAX_FILES) {
  console.error(`ERROR: ${count} files exceeds Cloudflare Pages' ${MAX_FILES}-file deployment cap`);
  process.exit(1);
} else if (count > MAX_FILES * 0.9) {
  console.warn(`NOTE: ${count} files is near Cloudflare's ${MAX_FILES}-file cap`);
}
