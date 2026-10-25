/**
 * `platform:audit-check` — check a downloaded page of the platform audit
 * export offline (tm 389.5 · docs/runbooks/platform-audit.md).
 *
 *   pnpm --filter @siyahtus/api platform:audit-check --file page.ndjson --signature <X-Siyahtus-Signature>
 *
 * In a built image: `node dist/src/services/platform/audit-export-check-run.js …`. Reads
 * `PLATFORM_SETTINGS_KEY` from the environment (or the `.env` beside it) and
 * nothing else — no database: the file and the header are the evidence.
 * Prints the verdict as JSON; exits 0 when the signature and every record
 * hold, 1 otherwise, 2 on a usage error.
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { readFileSync } from 'node:fs';
import { checkPlatformExport } from './audit-export-check.js';

function argsOf(argv: string[]): { file: string; signature: string } | null {
  let file: string | undefined;
  let signature: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--file') file = argv[++i];
    else if (arg === '--signature') signature = argv[++i];
    else return null;
  }
  return file && signature ? { file, signature } : null;
}

const args = argsOf(process.argv.slice(2));
const settingsKey = process.env['PLATFORM_SETTINGS_KEY'];
if (!args || !settingsKey) {
  process.stderr.write(
    'Usage: PLATFORM_SETTINGS_KEY=… platform:audit-check --file <page.ndjson> --signature <X-Siyahtus-Signature>\n',
  );
  process.exitCode = 2;
} else {
  const result = checkPlatformExport({
    body: readFileSync(args.file, 'utf8'),
    signature: args.signature.trim(),
    settingsKey,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.signatureOk && result.chain.ok ? 0 : 1;
}
