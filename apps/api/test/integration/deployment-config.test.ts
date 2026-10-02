/**
 * `GET /deployment` — the one anonymous read of this deployment's settings
 * (tm 257.13 · ADR docs/adr/pilot-public-readiness.md K-a).
 *
 * Three things are pinned here. The body is exactly the deployment-wide
 * fields and nothing else: `/health` was narrowed for an anonymous caller
 * (M-SEC-b2) and this route must not become the way around that. It reflects
 * the configuration it was booted with. And it is metered on its own bucket —
 * the panel reads it on every page load, and in the anon bucket it would spend
 * the budget sign-in and the widget's token mint share.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

async function withServer(
  overrides: Record<string, string | undefined>,
  body: (server: TestServer) => Promise<void>,
): Promise<void> {
  const server = await startTestServer(overrides);
  try {
    await clearRateLimits(server.app);
    await body(server);
  } finally {
    await clearRateLimits(server.app);
    await server.close();
  }
}

describe('GET /deployment', () => {
  it('answers an anonymous caller with exactly the seven deployment fields, off by default', async () => {
    await withServer(
      {
        PILOT_MODE: undefined,
        PILOT_CONTACT_EMAIL: undefined,
        SIGNUP_ENABLED: undefined,
        SIGNUP_EMAIL_VERIFICATION: undefined,
        PRIVACY_POLICY_URL: undefined,
        TERMS_URL: undefined,
        TERMS_VERSION: undefined,
      },
      async (server) => {
        const response = await server.get('/deployment');

        expect(response.statusCode).toBe(200);
        // Exact, not a subset: a version, region, provider or uptime field
        // appearing here is the leak this test exists to catch.
        expect(response.json()).toStrictEqual({
          pilot_mode: false,
          contact_email: null,
          signup_enabled: true,
          email_verification_required: false,
          // The legal links (tm 257.9), unset unless the deployment names them.
          privacy_policy_url: null,
          terms_url: null,
          terms_version: null,
        });
        expect(response.headers['cache-control']).toBe('no-cache');
      },
    );
  });

  it('reports the pilot switch and its contact address when they are set', async () => {
    await withServer(
      { PILOT_MODE: 'true', PILOT_CONTACT_EMAIL: 'pilot-desk@siyahtus.test' },
      async (server) => {
        const response = await server.get('/deployment');

        expect(response.statusCode).toBe(200);
        expect(response.json()).toStrictEqual({
          pilot_mode: true,
          contact_email: 'pilot-desk@siyahtus.test',
          signup_enabled: true,
          email_verification_required: false,
          // The legal links (tm 257.9), unset unless the deployment names them.
          privacy_policy_url: null,
          terms_url: null,
          terms_version: null,
        });
      },
    );
  });

  it('reports the legal links and the terms version when they are set (tm 257.9)', async () => {
    await withServer(
      {
        PRIVACY_POLICY_URL: 'https://siyahtus.test/privacy',
        TERMS_URL: 'https://siyahtus.test/terms',
        TERMS_VERSION: '2026-10-01',
      },
      async (server) => {
        const body = (await server.get('/deployment')).json();
        expect(body.privacy_policy_url).toBe('https://siyahtus.test/privacy');
        expect(body.terms_url).toBe('https://siyahtus.test/terms');
        expect(body.terms_version).toBe('2026-10-01');
      },
    );
  });

  it('reports closed sign-up', async () => {
    await withServer({ SIGNUP_ENABLED: 'false' }, async (server) => {
      expect((await server.get('/deployment')).json().signup_enabled).toBe(false);
    });
  });

  it('reports that a new owner must verify the address (tm 257.7)', async () => {
    await withServer({ SIGNUP_EMAIL_VERIFICATION: 'true' }, async (server) => {
      expect((await server.get('/deployment')).json().email_verification_required).toBe(true);
    });
  });

  describe('its own rate limit bucket', () => {
    it('keeps answering after the anonymous bucket is spent', async () => {
      await withServer(
        { RATE_LIMIT_ANON_PER_MIN: '2', RATE_LIMIT_PUBLIC_CONFIG_PER_MIN: '50' },
        async (server) => {
          expect((await server.get('/auth/me')).statusCode).toBe(401);
          expect((await server.get('/auth/me')).statusCode).toBe(401);
          expect((await server.get('/auth/me')).statusCode).toBe(429);

          const config = await server.get('/deployment');
          expect(config.statusCode).toBe(200);
          expect(config.headers['x-ratelimit-limit']).toBe('50');
        },
      );
    });

    it('does not spend the anonymous bucket sign-in needs', async () => {
      await withServer(
        { RATE_LIMIT_ANON_PER_MIN: '2', RATE_LIMIT_PUBLIC_CONFIG_PER_MIN: '50' },
        async (server) => {
          // A sign-in screen reloaded five times, then the sign-in itself.
          for (let i = 0; i < 5; i++) {
            expect((await server.get('/deployment')).statusCode).toBe(200);
          }
          const signIn = await server.post('/auth/login', {
            email: 'nobody@example.com',
            password: 'x',
          });
          expect(signIn.statusCode).not.toBe(429);
          expect(signIn.headers['x-ratelimit-limit']).toBe('2');
          expect(signIn.headers['x-ratelimit-remaining']).toBe('1');
        },
      );
    });

    it('refuses with 429 and Retry-After past its own ceiling', async () => {
      await withServer({ RATE_LIMIT_PUBLIC_CONFIG_PER_MIN: '3' }, async (server) => {
        for (let i = 0; i < 3; i++) {
          expect((await server.get('/deployment')).statusCode).toBe(200);
        }
        const limited = await server.get('/deployment');
        expect(limited.statusCode).toBe(429);
        expect(limited.json().error.type).toBe('too_many_requests');
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        expect(limited.headers['x-ratelimit-limit']).toBe('3');
      });
    });

    describe('with a credential', () => {
      let owner: PrismaClient;

      beforeAll(() => {
        owner = ownerClient();
      });

      afterAll(async () => {
        await owner.$disconnect();
      });

      it('meters a signed-in caller by the route, not by the agent bucket', async () => {
        const fx = await seedFixtures(owner);
        const token = await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          scopes: ['accounts--my:ro'],
        });

        await withServer({ RATE_LIMIT_PUBLIC_CONFIG_PER_MIN: '50' }, async (server) => {
          const response = await server.get('/deployment', { authorization: `Bearer ${token}` });
          expect(response.statusCode).toBe(200);
          expect(response.headers['x-ratelimit-limit']).toBe('50');
          // Same answer signed in or not: nothing here is about the caller.
          expect(response.json()).toStrictEqual((await server.get('/deployment')).json());
        });
      });
    });
  });
});
