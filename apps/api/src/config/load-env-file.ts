/**
 * Loads the repo-root `.env` into `process.env`.
 *
 * Without this, anything run outside `make dev` only works if the caller
 * happened to `source .env` first — a footgun that surfaces as a wall of
 * "Required" validation errors and reads like a code failure rather than a
 * shell one.
 *
 * Values already present win, so CI (which sets them directly) and a
 * developer's shell override the file rather than fighting it.
 *
 * Deliberately dependency-free and deliberately simple: this understands
 * `KEY=value` with optional surrounding quotes, which is all `.env.example`
 * uses. Anything fancier belongs in real configuration management, not here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

export function loadEnvFile(fromDir?: string): void {
  if (loaded) return;
  loaded = true;

  const base = fromDir ?? dirname(fileURLToPath(import.meta.url));
  // src/config → apps/api → apps → repo root
  const envFile = resolve(base, '../../../..', '.env');
  if (!existsSync(envFile)) return;

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
