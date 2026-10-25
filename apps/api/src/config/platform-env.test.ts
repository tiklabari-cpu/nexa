/**
 * The platform process's boot rules (tm 389.3) — and that none of them reach
 * the tenant API, whose boot no root-panel setting may stop (owner rule
 * 2026-10-10).
 */
import { describe, expect, it } from 'vitest';
import { parseEnv, type Env } from './env.js';
import {
  assertPlatformEnv,
  DEV_PLATFORM_SETTINGS_KEY,
  PLATFORM_DEFAULTS,
  platformEnvProblems,
  platformEnvWarnings,
} from './platform-env.js';

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

/** A root key a production deployment could hold (not the published dev one). */
const REAL_KEY = 'p'.repeat(48);

const envWith = (overrides: NodeJS.ProcessEnv = {}): Env => parseEnv({ ...BASE, ...overrides });
/**
 * `isProduction` alone: the platform rules read it, and nothing else production
 * asks matters here. With a real settings key, which production requires
 * (tm 389.4) — a test about another key states that one only.
 */
const production = (overrides: NodeJS.ProcessEnv = {}): Env => ({
  ...envWith({ PLATFORM_SETTINGS_KEY: REAL_KEY, ...overrides }),
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
      ipAllowlist: [],
      sessionTtlS: 28_800,
      idleTtlS: 900,
      settingsKey: DEV_PLATFORM_SETTINGS_KEY,
      warnings: [expect.stringMatching(/PLATFORM_SETTINGS_KEY is unset/)],
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
      PLATFORM_IP_ALLOWLIST: '10.0.0.0/33',
      PLATFORM_SESSION_TTL: '1h',
      PLATFORM_IDLE_TTL: '0',
      PLATFORM_SETTINGS_KEY: 'short',
    };
    const env = envWith(refused);
    expect(env.API_PORT).toBe(4000);
    expect(platformEnvProblems(env)).toHaveLength(9);
  });
});

describe('the operator sign-in settings (tm 389.4)', () => {
  it('reads the allow-list, both lifetimes and the root key', () => {
    const platform = assertPlatformEnv(
      envWith({
        PLATFORM_IP_ALLOWLIST: ' 203.0.113.0/24, 2001:db8::/32  198.51.100.7 ',
        PLATFORM_SESSION_TTL: '3600',
        PLATFORM_IDLE_TTL: '600',
        PLATFORM_SETTINGS_KEY: ` ${REAL_KEY} `,
      }),
    );
    expect(platform).toMatchObject({
      ipAllowlist: ['203.0.113.0/24', '2001:db8::/32', '198.51.100.7'],
      sessionTtlS: 3600,
      idleTtlS: 600,
      settingsKey: REAL_KEY,
      warnings: [],
    });
  });

  it('refuses an entry it cannot parse instead of dropping it into an admit-everyone list', () => {
    expect(
      platformEnvProblems(envWith({ PLATFORM_IP_ALLOWLIST: '203.0.113.0/24,office-vpn' })),
    ).toEqual([expect.stringMatching(/not an IP address or CIDR: office-vpn/)]);
  });

  it('refuses lifetimes out of range, and an idle timeout longer than the session', () => {
    expect(platformEnvProblems(envWith({ PLATFORM_SESSION_TTL: '60' }))).toEqual([
      expect.stringMatching(/PLATFORM_SESSION_TTL/),
    ]);
    expect(platformEnvProblems(envWith({ PLATFORM_IDLE_TTL: '30' }))).toEqual([
      expect.stringMatching(/PLATFORM_IDLE_TTL must be/),
    ]);
    expect(
      platformEnvProblems(envWith({ PLATFORM_SESSION_TTL: '600', PLATFORM_IDLE_TTL: '900' })),
    ).toEqual([expect.stringMatching(/cannot be longer than PLATFORM_SESSION_TTL/)]);
  });

  it('in production requires a real settings key, and warns about an empty allow-list', () => {
    const https = { ADMIN_APP_URL: 'https://admin.example.com' };
    expect(platformEnvProblems(production({ ...https, PLATFORM_SETTINGS_KEY: '' }))).toEqual([
      expect.stringMatching(/PLATFORM_SETTINGS_KEY is required in production/),
    ]);
    expect(
      platformEnvProblems(
        production({ ...https, PLATFORM_SETTINGS_KEY: DEV_PLATFORM_SETTINGS_KEY }),
      ),
    ).toEqual([expect.stringMatching(/development placeholder/)]);
    expect(platformEnvWarnings(production(https))).toEqual([
      expect.stringMatching(/PLATFORM_IP_ALLOWLIST is empty/),
    ]);
    expect(
      platformEnvWarnings(production({ ...https, PLATFORM_IP_ALLOWLIST: '203.0.113.0/24' })),
    ).toEqual([]);
  });
});
