// Deploy the staged payload to Azure SWA. Run via `npm run deploy`, which invokes this with
// `node --env-file-if-exists=.env` so SWA_CLI_DEPLOYMENT_TOKEN is loaded from the gitignored .env
// (or the ambient shell env, or CI secrets). The token is read by the SWA CLI straight from the
// environment — it is never passed as an argument or logged, so it can't leak into output.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// 1. Stage the payload (webp + config; videos excluded).
execFileSync(process.execPath, [join(here, 'stage-deploy.mjs')], { stdio: 'inherit' });

// 2. Require the token WITHOUT echoing its value.
if (!process.env.SWA_CLI_DEPLOYMENT_TOKEN) {
  console.error(
    '\nSWA_CLI_DEPLOYMENT_TOKEN is not set.\n' +
      'Copy .env.example to .env (gitignored) and fill it in, or export it in your shell.\n' +
      'Token: az staticwebapp secrets list -n <app> --query "properties.apiKey" -o tsv\n',
  );
  process.exit(1);
}

// 3. Upload. The CLI picks the token up from process.env on its own.
execFileSync(
  'npx',
  ['-y', '@azure/static-web-apps-cli', 'deploy', './dist-deploy', '--env', 'production'],
  { stdio: 'inherit', shell: true },
);

// 4. Friendly pointer (the domain is public, not a secret).
if (process.env.ASSETS_URL) {
  console.log(`\nDeployed. Assets serve at ${process.env.ASSETS_URL} once Cloudflare DNS points there.`);
}
