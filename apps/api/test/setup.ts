/**
 * Loads the repo-root `.env` before any test runs.
 *
 * Without this, `pnpm test` only works if the caller happened to `source .env`
 * first — a footgun that produces a wall of "Required" validation errors and
 * looks like a code failure rather than a shell one.
 *
 * Values already present in the environment win, so CI (which sets them
 * directly) and a developer's shell override the file rather than fighting it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(repoRoot, '.env');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Tests must never run against a real deployment's data.
process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] ??= 'silent';
