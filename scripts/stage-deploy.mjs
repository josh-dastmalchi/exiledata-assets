// Stage the SWA deploy payload into dist-deploy/.
//
// The repo also tracks ~800MB of skill-tutorial videos under art/videos/, which exceed Azure SWA's
// 500MB per-app cap, so they are EXCLUDED here and stay local until they get a real home (blob/CDN).
// Everything else served by the CDN — the webp trees (2DItems/2dart/textures), index.html, 404.html,
// and staticwebapp.config.json — is copied as-is (no build; the webp are pre-converted). New
// top-level asset dirs are picked up automatically; only repo meta and the videos are filtered out.
import { cpSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '');
const out = join(root, 'dist-deploy');

// Repo plumbing that must never ship to the CDN.
const EXCLUDE_TOP = new Set([
  '.git',
  '.github',
  '.gitignore',
  '.gitattributes',
  'node_modules',
  'scripts',
  'dist-deploy',
  '.swa',
  'swa-cli-output',
  'package.json',
  'package-lock.json',
  'README.md',
  'CLAUDE.md',
]);
const VIDEOS = join(root, 'art', 'videos');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Copy each kept top-level entry individually (cpSync refuses to copy root into its own subdir).
for (const e of readdirSync(root, { withFileTypes: true })) {
  if (EXCLUDE_TOP.has(e.name)) continue;
  const src = join(root, e.name);
  // art/ currently holds only the deferred videos; copy it but skip that subtree.
  if (e.name === 'art') {
    cpSync(src, join(out, e.name), {
      recursive: true,
      filter: (p) => p !== VIDEOS && !p.startsWith(VIDEOS + sep),
    });
  } else {
    cpSync(src, join(out, e.name), { recursive: true });
  }
}

let bytes = 0;
let count = 0;
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      bytes += statSync(p).size;
      count++;
    }
  }
})(out);

const mb = bytes / 1048576;
console.log(`staged ${count} files, ${mb.toFixed(1)} MB -> dist-deploy/ (videos excluded)`);
if (count > 15000) console.warn(`NOTE: ${count} files is near SWA's ~15,000-file cap`);
if (mb > 500) {
  console.error('ERROR: payload exceeds SWA 500MB cap');
  process.exit(1);
} else if (mb > 250) {
  console.warn('NOTE: payload exceeds SWA Free 250MB cap — requires the Standard tier');
}
