// Deploy the staged payload to Cloudflare Pages. Run via `npm run deploy`, which invokes this with
// `node --env-file-if-exists=.env` so the Cloudflare credentials are loaded from the gitignored .env
// (or the ambient shell env, or CI secrets). Wrangler reads CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID straight from the environment — they are never passed as args or logged.
import { execSync } from 'node:child_process';

// Pages project to deploy to (override with CF_PAGES_PROJECT). The production branch must match the
// project's configured production branch so this counts as a production (not preview) deploy.
const PROJECT = process.env.CF_PAGES_PROJECT || 'exiledata-assets';
const BRANCH = process.env.CF_PAGES_BRANCH || 'main';

// execSync runs the command through the platform shell (cmd on Windows, sh on POSIX) so node/npx
// resolve normally — execFileSync can't spawn npx.cmd on Windows without a shell.
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

// 1. Require credentials WITHOUT echoing their values.
if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
  console.error(
    '\nCLOUDFLARE_API_TOKEN and/or CLOUDFLARE_ACCOUNT_ID are not set.\n' +
      'Copy .env.example to .env (gitignored) and fill them in, or export them in your shell.\n' +
      'Token: Cloudflare dashboard -> My Profile -> API Tokens (scope: Account > Cloudflare Pages > Edit).\n' +
      'Account ID: Cloudflare dashboard -> Workers & Pages (right sidebar).\n',
  );
  process.exit(1);
}

// 2. Ensure the Pages project exists — first run creates it (no dashboard / placeholder upload
//    needed). If it already exists this is a harmless no-op; a real auth failure surfaces at upload.
try {
  execSync(`npx -y wrangler pages project create ${PROJECT} --production-branch=${BRANCH}`, {
    stdio: 'pipe',
  });
  console.log(`Created Cloudflare Pages project "${PROJECT}".`);
} catch {
  console.log(`Pages project "${PROJECT}" already exists (or unchanged) — continuing.`);
}

// 3. Stage the payload (webp + videos + _headers; 60fps source and dotfiles excluded).
run('node scripts/stage-deploy.mjs');

// 4. Upload. Wrangler picks the token + account id up from process.env on its own.
run(
  `npx -y wrangler pages deploy ./dist-deploy --project-name=${PROJECT} --branch=${BRANCH} --commit-dirty=true`,
);
