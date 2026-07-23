/**
 * Reseed before the suite runs.
 *
 * Every run starts from the same fixture, so a test can assert on a specific
 * conversation without depending on whatever the last run — or the integration
 * suite, which truncates the same database — happened to leave behind.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const run = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, '../../..');

export default async function globalSetup(): Promise<void> {
  const { stdout } = await run('pnpm', ['db:seed'], {
    cwd: repoRoot,
    // The seed prints credentials; keep the buffer generous so a failure shows
    // the real output rather than a truncation error.
    maxBuffer: 4 * 1024 * 1024,
  });

  // The seed is idempotent and stays quiet about credentials when the tenant is
  // already there, so match on the tenant itself rather than on the noisier
  // first-run output.
  if (!stdout.includes('Acme Bikes')) {
    throw new Error(`Seed did not produce the expected demo tenant:\n${stdout}`);
  }
}
