/**
 * The pilot gate's path list (tm 257.13): the matcher, and the boot-time check
 * that refuses a list which would quietly match less than it says. The gate on
 * the real server is `test/integration/pilot-gate.test.ts`.
 */
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../config/env.js';
import pilotGate, {
  PILOT_REFUSED_PATHS,
  assertPilotRefusedPaths,
  matchesPilotRefusedPath,
  type PilotRefusedPath,
} from './pilot-gate.js';

const BILLING: PilotRefusedPath = {
  methods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  pathRegex: /^\/api\/v1\/billing\//,
};

describe('matchesPilotRefusedPath', () => {
  it('matches a listed method under the path, and nothing else', () => {
    expect(matchesPilotRefusedPath([BILLING], 'PATCH', '/api/v1/billing/subscription')).toBe(true);
    expect(matchesPilotRefusedPath([BILLING], 'GET', '/api/v1/billing/subscription')).toBe(false);
    expect(matchesPilotRefusedPath([BILLING], 'PATCH', '/api/v1/chats/:chatId')).toBe(false);
  });

  it('reads HEAD as GET, the handler Fastify serves it from', () => {
    const read: PilotRefusedPath = { methods: ['GET'], pathRegex: /^\/api\/v1\/apps$/ };
    expect(matchesPilotRefusedPath([read], 'HEAD', '/api/v1/apps')).toBe(true);
    expect(matchesPilotRefusedPath([BILLING], 'HEAD', '/api/v1/billing/subscription')).toBe(false);
  });

  it('matches nothing when no route matched — the 404 answers that request', () => {
    expect(matchesPilotRefusedPath([BILLING], 'PATCH', undefined)).toBe(false);
  });
});

describe('PILOT_REFUSED_PATHS (tm 257.2)', () => {
  const refused = (method: string, routeUrl: string): boolean =>
    matchesPilotRefusedPath(PILOT_REFUSED_PATHS, method, routeUrl);

  it('refuses every write method under /billing/, including one no route has yet', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(refused(method, '/api/v1/billing/subscription'), method).toBe(true);
      expect(refused(method, '/api/v1/billing/a-write-added-later'), method).toBe(true);
    }
    expect(refused('PUT', '/api/v1/billing/payment-method')).toBe(true);
    expect(refused('POST', '/api/v1/billing/api-packages')).toBe(true);
    expect(refused('POST', '/api/v1/billing/ai-packages')).toBe(true);
  });

  it('leaves every billing read open', () => {
    for (const method of ['GET', 'HEAD']) {
      expect(refused(method, '/api/v1/billing/subscription'), method).toBe(false);
      expect(refused(method, '/api/v1/billing/invoices/:period/download'), method).toBe(false);
      expect(refused(method, '/api/v1/billing/entitlements'), method).toBe(false);
    }
  });

  it('refuses nothing outside the billing prefix', () => {
    expect(refused('PATCH', '/api/v1/settings/billing')).toBe(false);
    expect(refused('POST', '/api/v1/billingx/subscription')).toBe(false);
    expect(refused('POST', '/api/v2/billing/subscription')).toBe(false);
    expect(refused('PATCH', '/api/v1/chats/:chatId')).toBe(false);
  });
});

describe('assertPilotRefusedPaths', () => {
  it('accepts the shipped list and a well-formed entry', () => {
    expect(() => assertPilotRefusedPaths(PILOT_REFUSED_PATHS)).not.toThrow();
    expect(() => assertPilotRefusedPaths([BILLING])).not.toThrow();
  });

  it.each([
    [
      'a lower-case method, which never equals request.method',
      { methods: ['patch'] },
      /upper case/,
    ],
    ['a method HTTP routing here does not use', { methods: ['TRACE'] }, /upper case/],
    ['no method at all', { methods: [] }, /names no method/],
    ['an unanchored pattern', { pathRegex: /billing\// }, /anchored/],
    [
      'a g flag, which makes .test() alternate',
      { pathRegex: /^\/api\/v1\/billing\//g },
      /stateful/,
    ],
    ['a y flag', { pathRegex: /^\/api\/v1\/billing\//y }, /stateful/],
  ])('refuses %s', (_label, override, message) => {
    expect(() => assertPilotRefusedPaths([{ ...BILLING, ...override }])).toThrow(message);
  });

  it('runs at registration, switch on or off', async () => {
    for (const PILOT_MODE of ['true', 'false']) {
      const app = Fastify();
      // The real plugin declares `auth` as a dependency; a stand-in satisfies it.
      await app.register(fp(async () => {}, { name: 'auth' }));
      const env = parseEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://siyahtus:siyahtus@127.0.0.1:5432/siyahtus',
        REDIS_URL: 'redis://127.0.0.1:6379',
        JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
        WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
        CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
        UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
        AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
        PILOT_MODE,
      });
      await expect(
        app.register(pilotGate, { env, paths: [{ ...BILLING, methods: ['patch'] }] }),
      ).rejects.toThrow(/upper case/);
      await app.close();
    }
  });
});
