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
import { envSchema, SECRET_KEYS } from './env.js';

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

  it('chooses the pilot providers, uncommented (tm 255.15)', () => {
    // The pilot runs a real model, real embeddings and real mail; a template
    // still saying `mock`/`file` would boot happily and send nothing.
    expect(uncommentedValueOf('LLM_PROVIDER')).toBe('openai');
    expect(uncommentedValueOf('EMBEDDING_PROVIDER')).toBe('openai');
    expect(uncommentedValueOf('MAIL_PROVIDER')).toBe('smtp');
    // No collector in the pilot: the console exporter would bury the log.
    expect(uncommentedValueOf('OTEL_EXPORTER')).toBe('none');
  });

  it('gives the pilot a 90-day trial, uncommented, and explains the override (tm 474)', () => {
    // No trial may end while the pilot runs (owner decision 2026-11-06); the
    // code default (env.ts) stays 14.
    expect(uncommentedValueOf('TRIAL_DAYS')).toBe('90');
    const comment = source.slice(
      source.indexOf('# Trial length, in days'),
      source.indexOf('TRIAL_DAYS=90'),
    );
    expect(comment).toMatch(/root\s+# panel/);
  });

  it('chooses the real website crawler and explains its SSRF guard and egress (tm 470.1)', () => {
    expect(uncommentedValueOf('CRAWLER_PROVIDER')).toBe('http');
    const comment = source.slice(
      source.indexOf('# Who fetches a website knowledge source'),
      source.indexOf('CRAWLER_PROVIDER=http'),
    );
    expect(comment).toMatch(/SSRF/);
    expect(comment).toMatch(/Egress/);
    expect(comment).toMatch(/169\.254\.169\.254/);
  });

  it('turns the pilot switch on, with the contact address left to fill in (tm 257.13)', () => {
    // The template is the pilot's: `PILOT_MODE=true` is what makes boot refuse
    // the stub providers above, and its contact address is the deployer's own.
    expect(uncommentedValueOf('PILOT_MODE')).toBe('true');
    expect(uncommentedValueOf('PILOT_CONTACT_EMAIL')).toMatch(/^<[^<>]+>$/);
  });

  it('carries the three legal keys, uncommented, left to fill in (tm 257.9)', () => {
    // The pilot requires them; the texts and their version are the owner's.
    expect(uncommentedValueOf('PRIVACY_POLICY_URL')).toMatch(/^https:\/\/<[^<>]+>\//);
    expect(uncommentedValueOf('TERMS_URL')).toMatch(/^https:\/\/<[^<>]+>\//);
    expect(uncommentedValueOf('TERMS_VERSION')).toMatch(/^<[^<>]+>$/);
  });

  it.each([
    'LLM_API_KEY',
    'EMBEDDING_API_KEY',
    'SMTP_USERNAME',
    'SMTP_PASSWORD',
    'SMTP_FROM',
    'POSTGRES_PASSWORD',
    'SIYAHTUS_APP_DB_PASSWORD',
  ])('%s is present with a <…> fill-in and no value (tm 255.15)', (key) => {
    // Key names only — a credential written here is a credential published.
    expect(uncommentedValueOf(key)).toMatch(/^<[^<>]+>$/);
  });

  it('INBOUND_EMAIL_SECRET does not carry a dev-only placeholder either', () => {
    const value = uncommentedValueOf('INBOUND_EMAIL_SECRET');
    expect(value?.startsWith('dev-only-')).toBe(false);
  });
});

describe('.env.production.example names every env var the api reads', () => {
  // `.env.example` is held to the same rule by env.parity.test.ts. The production
  // template used to drift (CRAWLER_PROVIDER, GEOIP_DB_PATH, INSTALL_GUIDE_URL, … were
  // missing, tm 403): a deployer could not find an optional knob without reading env.ts.
  // A commented `# KEY=` line counts — optional keys stay commented.
  const documented = new Set([...source.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));

  it('parses a non-trivial key count (guards a broken regex passing vacuously)', () => {
    expect(documented.size).toBeGreaterThan(80);
  });

  it('documents every key of the api env schema', () => {
    const missing = Object.keys(envSchema.shape).filter((key) => !documented.has(key));
    expect(missing, `.env.production.example is missing: ${missing.join(', ')}`).toEqual([]);
  });
});
