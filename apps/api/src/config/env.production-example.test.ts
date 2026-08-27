/**
 * Guards `.env.production.example` (M-PROD-CFG-c) against the two ways it
 * could quietly stop doing its job: a key `parseEnv`'s `productionProblems`
 * requires going missing from the template, or a required key's placeholder
 * regressing to the `dev-only-…` value `.env.example` uses — which is exactly
 * what production refuses to boot with (M-PROD-CFG-a).
 *
 * Reads the schema itself (`SECRET_KEYS`) rather than hand-listing secrets, so
 * a sixth secret added there and not here fails this suite instead of
 * shipping a template that is quietly incomplete.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECRET_KEYS } from './env.js';

// src/config → apps/api → apps → repo root (same resolution as env.parity.test.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const source = readFileSync(resolve(REPO_ROOT, '.env.production.example'), 'utf8');

/** Always required, in every `NODE_ENV` (no schema default). */
const ALWAYS_REQUIRED = ['DATABASE_URL', 'REDIS_URL', ...SECRET_KEYS];
/** Only `productionProblems` requires these — optional outside production. */
const PRODUCTION_ONLY_REQUIRED = ['DATABASE_APP_URL', 'INBOUND_EMAIL_SECRET'];

function uncommentedValueOf(key: string): string | undefined {
  const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1];
}

describe('.env.production.example documents what parseEnv requires in production', () => {
  it('sets NODE_ENV=production, uncommented', () => {
    expect(uncommentedValueOf('NODE_ENV')).toBe('production');
  });

  it.each([...ALWAYS_REQUIRED, ...PRODUCTION_ONLY_REQUIRED])(
    '%s is present and uncommented (a deployer must supply a real value, not find it disabled)',
    (key) => {
      expect(uncommentedValueOf(key), `${key} is missing or commented out`).toBeDefined();
    },
  );

  it.each(SECRET_KEYS)('%s does not carry the .env.example dev-only placeholder', (key) => {
    const value = uncommentedValueOf(key);
    expect(value?.startsWith('dev-only-')).toBe(false);
  });

  it('INBOUND_EMAIL_SECRET does not carry a dev-only placeholder either', () => {
    const value = uncommentedValueOf('INBOUND_EMAIL_SECRET');
    expect(value?.startsWith('dev-only-')).toBe(false);
  });
});
