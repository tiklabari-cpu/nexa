/**
 * The platform process's boot rules (tm 389.3) — and that none of them reach
 * the tenant API, whose boot no root-panel setting may stop (owner rule
 * 2026-10-10).
 */
import { describe, expect, it } from 'vitest';
import { parseEnv, type Env } from './env.js';
import { assertPlatformEnv, PLATFORM_DEFAULTS, platformEnvProblems } from './platform-env.js';

const OWNER = 'postgresql://siyahtus:owner-pw@127.0.0.1:5432/siyahtus';
const TENANT = 'postgresql://siyahtus_app:app-pw@127.0.0.1:5432/siyahtus';
const PLATFORM = 'postgresql://siyahtus_platform:platform-pw@127.0.0.1:5432/siyahtus';

const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: OWNER,
  DATABASE_APP_URL: TENANT,
  DATABASE_PLATFORM_URL: PLATFORM,
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
  WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
  CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
  UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
  AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
};

const envWith = (overrides: NodeJS.ProcessEnv = {}): Env => parseEnv({ ...BASE, ...overrides });
/** `isProduction` alone: the platform rules read it, and nothing else production asks matters here. */
const production = (overrides: NodeJS.ProcessEnv = {}): Env => ({
  ...envWith(overrides),
  isProduction: true,
});

describe('assertPlatformEnv (tm 389.3)', () => {
  it('fills the defaults: port 4002, every interface, the admin dev server, 300 a minute', () => {
    expect(assertPlatformEnv(envWith())).toEqual({
      databaseUrl: PLATFORM,
      port: 4002,
      host: '0.0.0.0',
      adminOrigin: PLATFORM_DEFAULTS.adminAppUrl,
      rateLimitPerMin: 300,
    });
  });

  it('reads every key it owns, and applies the pool size like the primary', () => {
    const platform = assertPlatformEnv(
      envWith({
        PLATFORM_PORT: '4102',
        PLATFORM_HOST: '127.0.0.1',
        ADMIN_APP_URL: 'https://admin.example.com/',
        RATE_LIMIT_PLATFORM_PER_MIN: '50',
        DATABASE_POOL_SIZE: '4',
      }),
    );
    expect(platform).toMatchObject({
      port: 4102,
      host: '127.0.0.1',
      adminOrigin: 'https://admin.example.com',
      rateLimitPerMin: 50,
    });
    expect(new URL(platform.databaseUrl).searchParams.get('connection_limit')).toBe('4');
  });

  it('refuses to start without DATABASE_PLATFORM_URL', () => {
    expect(() => assertPlatformEnv(envWith({ DATABASE_PLATFORM_URL: undefined }))).toThrow(
      /DATABASE_PLATFORM_URL is required/,
    );
  });

  it('refuses the owner and the tenant role as the platform connection', () => {
    expect(platformEnvProblems(envWith({ DATABASE_PLATFORM_URL: OWNER }))).toEqual([
      expect.stringMatching(/connects as the table owner/),
    ]);
    expect(platformEnvProblems(envWith({ DATABASE_PLATFORM_URL: TENANT }))).toEqual([
      expect.stringMatching(/connects as the tenant role/),
    ]);
    expect(platformEnvProblems(envWith({ DATABASE_PLATFORM_URL: 'redis://x:y@h:1/0' }))).toEqual([
      expect.stringMatching(/postgresql:\/\//),
    ]);
  });

  it('names every problem at once, not the first one', () => {
    const problems = platformEnvProblems(
      envWith({
        DATABASE_PLATFORM_URL: undefined,
        PLATFORM_PORT: '70000',
        RATE_LIMIT_PLATFORM_PER_MIN: '0',
        ADMIN_APP_URL: 'https://a.example.com,https://b.example.com',
      }),
    );
    expect(problems).toHaveLength(4);
    expect(problems.join('\n')).toMatch(
      /DATABASE_PLATFORM_URL[\s\S]*PLATFORM_PORT[\s\S]*RATE_LIMIT_PLATFORM_PER_MIN[\s\S]*ADMIN_APP_URL/,
    );
  });

  it('in production asks for an https ADMIN_APP_URL rather than assuming the dev server', () => {
    expect(platformEnvProblems(production())).toEqual([
      expect.stringMatching(/ADMIN_APP_URL is required in production/),
    ]);
    expect(platformEnvProblems(production({ ADMIN_APP_URL: 'http://admin.example.com' }))).toEqual([
      expect.stringMatching(/https in production/),
    ]);
    expect(platformEnvProblems(production({ ADMIN_APP_URL: 'https://admin.example.com' }))).toEqual(
      [],
    );
  });

  it('leaves the tenant API booting on every value it refuses (owner rule 2026-10-10)', () => {
    const refused = {
      DATABASE_PLATFORM_URL: 'not a url',
      PLATFORM_PORT: 'abc',
      PLATFORM_HOST: '',
      ADMIN_APP_URL: 'not an origin',
      RATE_LIMIT_PLATFORM_PER_MIN: '-1',
    };
    const env = envWith(refused);
    expect(env.API_PORT).toBe(4000);
    expect(platformEnvProblems(env)).toHaveLength(5);
  });
});
