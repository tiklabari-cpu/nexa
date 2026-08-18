/**
 * Guards the three-way parity §D113/K2 found broken: an env var `env.ts`
 * reads has to also be documented in `.env.example` (so a developer can find
 * it) and registered in `turbo.json`'s `globalEnv` (so a cache key changes
 * when it does — otherwise turbo serves a stale build/test result across an
 * env change, and two of the missing keys were secrets, which is a real risk
 * in CI). `.env.example` is checked in the other direction too: a key nothing
 * reads is dead documentation.
 *
 * The API's own schema is read via `envSchema.shape` — exact, no parsing.
 * The RTM gateway's schema (`apps/rtm/src/config/env.ts`) is a sibling
 * package: importing it here would pull a file outside this package's
 * `rootDir` into `tsc -p tsconfig.json --noEmit` and break `pnpm -w
 * typecheck`, so it is read as text and its `z.object({ ... })` body is
 * parsed instead — same technique `apps/mobile/src/theme/tokens.test.ts`
 * uses to check a sibling package's CSS without importing it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { envSchema as apiEnvSchema } from './env.js';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Keys declared inside a `envSchema = z.object({ ... });` block, text-parsed. */
function schemaKeysFromSource(path: string): string[] {
  const source = readFileSync(path, 'utf8');
  const body = source.match(/envSchema\s*=\s*z\.object\(\{([\s\S]*?)\}\);/);
  if (!body) throw new Error(`${path}: could not locate "envSchema = z.object({ ... });"`);
  return [...body[1]!.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
}

/** Keys `.env.example`/`turbo.json` document — a commented `# KEY=` line still counts. */
function documentedEnvExampleKeys(): string[] {
  const source = readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8');
  return [...source.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
}

function turboGlobalEnvKeys(): string[] {
  const turboJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'turbo.json'), 'utf8')) as {
    globalEnv: string[];
  };
  return turboJson.globalEnv;
}

/** `want` entries missing from `have` — the one predicate every test below shares. */
function findMissing(want: readonly string[], have: readonly string[]): string[] {
  const haveSet = new Set(have);
  return want.filter((key) => !haveSet.has(key));
}

const apiKeys = Object.keys(apiEnvSchema.shape);
const rtmKeys = schemaKeysFromSource(resolve(REPO_ROOT, 'apps/rtm/src/config/env.ts'));
const schemaKeys = [...new Set([...apiKeys, ...rtmKeys])].sort();

const exampleKeys = documentedEnvExampleKeys();
const turboKeys = turboGlobalEnvKeys();

// Vite-side dev-server ports: apps/web and apps/widget read these through
// `import.meta.env` directly, never through a zod schema in this repo.
const EXAMPLE_ONLY_ALLOWLIST = ['WEB_PORT', 'WIDGET_PORT'];

describe('env var parity: env.ts (api + rtm) ↔ .env.example ↔ turbo.json globalEnv', () => {
  it('parses a non-trivial key count from each source (guards an empty/broken regex passing vacuously)', () => {
    expect(apiKeys.length).toBeGreaterThan(40);
    expect(rtmKeys.length).toBeGreaterThan(5);
    expect(exampleKeys.length).toBeGreaterThan(40);
    expect(turboKeys.length).toBeGreaterThan(40);
  });

  it('documents every env.ts key in .env.example (commented is fine)', () => {
    const missing = findMissing(schemaKeys, exampleKeys);
    expect(missing, `.env.example is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('registers every env.ts key in turbo.json globalEnv', () => {
    const missing = findMissing(schemaKeys, turboKeys);
    expect(missing, `turbo.json globalEnv is missing: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no .env.example key that no env.ts schema reads, other than the vite-port allowlist', () => {
    const stray = findMissing(exampleKeys, [...schemaKeys, ...EXAMPLE_ONLY_ALLOWLIST]);
    expect(stray, `.env.example documents keys nothing reads: ${stray.join(', ')}`).toEqual([]);
  });

  it('findMissing flags a deliberately absent key — proves the checks above are not vacuously green', () => {
    expect(findMissing(['TOTALLY_FAKE_ENV_KEY_XYZ'], exampleKeys)).toEqual([
      'TOTALLY_FAKE_ENV_KEY_XYZ',
    ]);
    expect(findMissing(['NODE_ENV'], exampleKeys)).toEqual([]);
  });
});
