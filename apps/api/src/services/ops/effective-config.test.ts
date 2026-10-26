/**
 * The effective configuration the tenant API publishes for the root panel (tm 389.13 ·
 * FR-ADMIN-16): no secret leaves as a value, no URL keeps its credentials, every key says where
 * its value came from, and the two the panel overrides carry the value in force.
 */
import { describe, expect, it } from 'vitest';
import { envSchema, parseEnv } from '../../config/env.js';
import { buildEffectiveConfig, isSecretKey, stripUrlCredentials } from './effective-config.js';

const SETTINGS = {
  signupEnabled: false,
  signupEnabledSource: 'db' as const,
  trialDays: 7,
  trialDaysSource: 'db' as const,
};

function env(overrides: Record<string, string> = {}) {
  return parseEnv({
    NODE_ENV: 'test',
    JWT_SIGNING_KEY: 'j'.repeat(32),
    WEBHOOK_HMAC_SEED: 'w'.repeat(32),
    CUSTOMER_TOKEN_SECRET: 'c'.repeat(32),
    UPLOAD_SIGNING_KEY: 'u'.repeat(32),
    AUDIT_CHAIN_SECRET: 'a'.repeat(32),
    DATABASE_URL:
      'postgresql://siyahtus:s3cret-pw@db.internal:5432/siyahtus?schema=public&sslpassword=hunter2',
    REDIS_URL: 'redis://:redis-pw@cache.internal:6379/0',
    LLM_API_KEY: 'sk-live-should-never-leave',
    ...overrides,
  });
}

describe('what counts as a secret', () => {
  it.each([
    'JWT_SIGNING_KEY',
    'LLM_API_KEY',
    'SMTP_PASSWORD',
    'TURNSTILE_SECRET_KEY',
    'STORAGE_S3_ACCESS_KEY_ID',
    'APPS_CREDENTIAL_KEY',
    'CUSTOMER_TOKEN_SECRET',
  ])('%s', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each([
    'ACCESS_TOKEN_TTL',
    'RATE_LIMIT_TOKEN_PER_MIN',
    'LLM_MAX_OUTPUT_TOKENS',
    'SMTP_USERNAME',
  ])('not %s — a lifetime, a rate or a name', (key) => {
    expect(isSecretKey(key)).toBe(false);
  });

  it('catches every key of the schema whose name holds a secret word, but for limits', () => {
    const word = /(^|_)(SECRET|KEY|PASSWORD|PASS|TOKEN|CREDENTIAL)(_|$)/;
    for (const key of Object.keys(envSchema.shape)) {
      if (word.test(key) && !/(_TTL|_PER_[A-Z]+)$/.test(key))
        expect(isSecretKey(key), key).toBe(true);
    }
  });
});

describe('URLs', () => {
  it('lose the user name, the password and any secret-named query value', () => {
    expect(
      stripUrlCredentials('postgresql://u:p@db:5432/x?schema=public&sslpassword=hunter2&api_key=k'),
    ).toBe('postgresql://db:5432/x?schema=public&sslpassword=redacted&api_key=redacted');
  });

  it('leave a plain value alone and say nothing of an unparsable one', () => {
    expect(stripUrlCredentials('eu')).toBe('eu');
    expect(stripUrlCredentials('http://[::1')).toBe('[unparsed]');
  });
});

describe('buildEffectiveConfig', () => {
  const entries = buildEffectiveConfig(env(), SETTINGS);
  const entry = (key: string) => entries.find((candidate) => candidate.key === key);

  it('lists every schema key once, alphabetically', () => {
    const keys = entries.map((candidate) => candidate.key);
    expect(keys).toEqual([...Object.keys(envSchema.shape)].sort());
  });

  it('never carries a secret’s value — set or unset only', () => {
    expect(entry('LLM_API_KEY')).toMatchObject({ value: 'set', redacted: true, source: 'env' });
    expect(entry('TURNSTILE_SECRET_KEY')).toMatchObject({ value: 'unset', redacted: true });
    expect(JSON.stringify(entries)).not.toContain('sk-live-should-never-leave');
  });

  it('strips the credentials out of every connection string', () => {
    expect(entry('DATABASE_URL')?.value).toBe(
      'postgresql://db.internal:5432/siyahtus?schema=public&sslpassword=redacted',
    );
    expect(entry('REDIS_URL')?.value).toBe('redis://cache.internal:6379/0');
    const text = JSON.stringify(entries);
    for (const secret of ['s3cret-pw', 'hunter2', 'redis-pw']) expect(text).not.toContain(secret);
  });

  it('says where each value came from', () => {
    expect(entry('DATABASE_URL')?.source).toBe('env');
    expect(entry('LOG_LEVEL')?.source).toBe('default');
    expect(entry('PILOT_MODE')).toMatchObject({ value: 'false', source: 'default', panel: false });
    for (const candidate of entries) expect(['db', 'env', 'default']).toContain(candidate.source);
  });

  it('shows the panel’s sign-up switch and trial length as the values in force', () => {
    expect(entry('SIGNUP_ENABLED')).toMatchObject({ value: 'false', source: 'db', panel: true });
    expect(entry('TRIAL_DAYS')).toMatchObject({ value: '7', source: 'db', panel: true });
  });

  it('shows the live apps the deployment really runs, after its own filtering', () => {
    expect(entry('APPS_LIVE_PROVIDERS')).toMatchObject({ redacted: false, panel: false });
  });
});
