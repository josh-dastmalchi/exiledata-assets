// Deploy the staged payload to Azure SWA. Run via `npm run deploy`, which invokes this with
// `node --env-file-if-exists=.env` so SWA_CLI_DEPLOYMENT_TOKEN is loaded from the gitignored .env
// (or the ambient shell env, or CI secrets). The token is read by the SWA CLI straight from the
// environment — it is never passed as an argument or logged, so it can't leak into output.
import { execSync } from 'node:child_process';

// execSync runs the command through the platform shell (cmd on Windows, sh on POSIX) so node/npx
// resolve normally — execFileSync can't spawn npx.cmd on Windows without a shell.
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

// 1. Require the token WITHOUT echoing its value.
if (!process.env.SWA_CLI_DEPLOYMENT_TOKEN) {
  console.error(
    '\nSWA_CLI_DEPLOYMENT_TOKEN is not set.\n' +
      'Copy .env.example to .env (gitignored) and fill it in, or export it in your shell.\n' +
      'Token: az staticwebapp secrets list -n <app> --query "properties.apiKey" -o tsv\n',
  );
  process.exit(1);
}

// 2. Stage the payload (webp + config; videos excluded).
run('node scripts/stage-deploy.mjs');

// 3. Upload. The CLI picks the token up from process.env on its own.
run('npx -y @azure/static-web-apps-cli deploy ./dist-deploy --env production');
