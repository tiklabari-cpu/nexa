/**
 * `platform:chain-check` — verify the platform audit chain in rows read out of
 * a (restored) database (tm 392 · NFR-ADMIN-B). `scripts/restore-drill.sh`
 * pipes its scratch database's rows into it.
 *
 *   <head line + one export-shaped line per entry> | pnpm --filter @siyahtus/api --silent platform:chain-check
 *
 * In a built image: `node dist/src/services/platform/restore-chain-check-run.js`.
 * The input format is documented in `restore-chain-check.ts`. Reads
 * `PLATFORM_SETTINGS_KEY` from the environment (or the root `.env`); touches no
 * database.
 *
 * Exit: 0 verified · 1 broken · 2 unreadable input · 3 skipped (no key) · 4
 * empty (nothing to verify). The first stdout line says which.
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import {
  checkRestoredChain,
  describeOutcome,
  parseChainDump,
  RESTORE_CHAIN_EXIT,
} from './restore-chain-check.js';

function readAll(stream: NodeJS.ReadStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      data += chunk;
    });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

async function main(): Promise<number> {
  if (process.stdin.isTTY) {
    process.stderr.write(
      'Usage: <head line + export-shaped entries> | platform:chain-check   (see restore-chain-check.ts)\n',
    );
    return RESTORE_CHAIN_EXIT.error;
  }
  const dump = parseChainDump(await readAll(process.stdin));
  const outcome = await checkRestoredChain(dump, process.env['PLATFORM_SETTINGS_KEY']);
  process.stdout.write(`${describeOutcome(outcome).join('\n')}\n`);
  return RESTORE_CHAIN_EXIT[outcome.kind];
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `platform:chain-check: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = RESTORE_CHAIN_EXIT.error;
  },
);
