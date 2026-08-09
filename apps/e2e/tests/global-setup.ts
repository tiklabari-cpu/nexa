/**
 * Put the database into the demo fixture before the suite runs.
 *
 * This used to call the plain seed and claim every run started from the same
 * fixture. It did not. The seed is *idempotent*: pointed at a database that
 * already has the demo tenant it returns without changing anything, so each run
 * added to whatever the last one left rather than replacing it. Every widget
 * spec mints a customer token with no stored id, so every run created another
 * anonymous visitor; the customer directory orders by `last_activity_at DESC`,
 * and once enough of them piled up the seeded Robin/Alex/Mira dropped off the
 * first page. `customers.spec.ts` and `command-palette.spec.ts` then failed on
 * a product with nothing wrong with it — the same specs were green against a
 * freshly migrated database (tm 109).
 *
 * So the seed is asked to reset first. That truncates the tenant tables; it
 * neither drops the database nor touches the schema, and it is the same wipe
 * the integration suite already performs against this database before every
 * file. The cost is real and worth stating: running the e2e suite now clears
 * local development data, where before it only added to it.
 *
 * Note the ordering this runs in — Playwright starts `webServer` processes
 * *before* global setup, so the API and RTM servers are already up and
 * connected when the truncation lands. That is fine (pooled connections hold no
 * locks, and neither server caches tenant rows in memory) but it is the reason
 * this cannot assume an empty, quiet database.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../..');

export default async function globalSetup(): Promise<void> {
  const { stdout } = await run('pnpm', ['db:seed'], {
    cwd: repoRoot,
    // `pnpm` is a shell shim, not an executable, wherever it was installed by
    // npm — on Windows that is `pnpm.cmd`/`pnpm.ps1` plus an extensionless
    // script, and `CreateProcess` searches PATH for `.exe` only. Without this
    // the whole suite dies in setup with `spawn pnpm ENOENT` and not a single
    // test runs, which reads exactly like a broken product and is not one.
    shell: true,
    // Passed as an environment variable rather than an argument: this goes
    // through two layers of `pnpm run`, and a bare `--reset` is ambiguous with
    // pnpm's own flags at the outer one.
    env: { ...process.env, NEXA_SEED_RESET: '1' },
    // The seed prints credentials; keep the buffer generous so a failure shows
    // the real output rather than a truncation error.
    maxBuffer: 4 * 1024 * 1024,
  });

  if (!stdout.includes('Acme Bikes')) {
    throw new Error(`Seed did not produce the expected demo tenant:\n${stdout}`);
  }

  // With the reset in effect the seed must always take the create path. If it
  // reports the tenant was already there, the wipe silently did not happen —
  // fail here rather than let the suite drift back into the accumulation this
  // was written to end.
  if (stdout.includes('already present')) {
    throw new Error(`Seed skipped an existing tenant, so the reset did not run:\n${stdout}`);
  }
}
