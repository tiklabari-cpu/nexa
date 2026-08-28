/**
 * Where a rate limit is evaluated, not just what it counts (M-SEC-c1 · §D116 LOW/1).
 *
 * The buckets themselves are exercised in `auth.test.ts`; what is asserted here
 * is the *ordering* that makes them useful. Authentication runs in `onRequest`
 * and the account-scoped buckets in `preHandler`, so a request nobody can
 * authenticate used to be refused after it had already spent an
 * `auth_resolve_token` lookup — and, because an `onRequest` throw skips the
 * `preHandler`, without touching a limit at all. A flood of invalid bearer
 * tokens therefore bought one indexed query each, unbounded.
 *
 * Every test below fails against that arrangement. They assert the fix by its
 * effect rather than by inspecting hook registration, so re-introducing the
 * problem — swapping two `app.register` lines in `server.ts` is enough — turns
 * them red rather than leaving a comment to be believed.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Long enough to be a plausible token, and resolvable by nothing. */
const GARBAGE_BEARER = 'a'.repeat(64);

describe('rate limiting: the pre-auth stage', () => {
  let owner: PrismaClient;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  /**
   * Each test gets its own server because the ceiling under test is the thing
   * being varied, and a low one is the only way to reach it in a handful of
   * requests. Buckets live in Redis and outlive a server, hence the sweep at
   * both ends.
   */
  async function withServer(
    overrides: Record<string, string>,
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

  it('stops resolving tokens for an address that has spent its failure budget', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '3' }, async (server) => {
      // The measurement is the point of the finding: "how many requests were
      // refused" was never the problem — "how many database lookups a stranger
      // can buy" was. So the assertion counts lookups, at the one place every
      // bearer credential goes through to reach `auth_resolve_token`.
      const resolve = vi.spyOn(server.app.tokens, 'resolve');
      const call = () => server.get('/auth/me', { authorization: `Bearer ${GARBAGE_BEARER}` });

      for (let i = 0; i < 3; i++) {
        const rejected = await call();
        expect(rejected.statusCode).toBe(401);
      }
      expect(resolve).toHaveBeenCalledTimes(3);

      const limited = await call();
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.type).toBe('too_many_requests');
      // ADR-07's contract holds for this refusal too — it is raised a lifecycle
      // phase earlier than the others, which must not cost the client the
      // headers it needs to back off correctly.
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.headers['x-ratelimit-limit']).toBe('3');
      expect(limited.headers['x-ratelimit-remaining']).toBe('0');
      expect(limited.headers['x-ratelimit-reset']).toBeDefined();

      // The whole of it: the refusal happened before the lookup, so the flood
      // costs the ceiling per minute rather than one query per request.
      expect(resolve).toHaveBeenCalledTimes(3);
      resolve.mockRestore();
    });
  });

  it('does not charge a valid credential to the failure budget', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '2' }, async (server) => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });
      const headers = { authorization: `Bearer ${token}` };

      // Five requests against a budget of two. The pre-auth stage reads that
      // budget without spending from it, so a caller whose token is good never
      // walks into a limit that meters the ones that are not.
      for (let i = 0; i < 5; i++) {
        const response = await server.get('/auth/me', headers);
        expect(response.statusCode).toBe(200);
      }
    });
  });

  it('lets a good credential through until the address has actually failed', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '2' }, async (server) => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });
      const garbage = { authorization: `Bearer ${GARBAGE_BEARER}` };

      expect((await server.get('/auth/me', { authorization: `Bearer ${token}` })).statusCode).toBe(
        200,
      );
      expect((await server.get('/auth/me', garbage)).statusCode).toBe(401);
      expect((await server.get('/auth/me', garbage)).statusCode).toBe(401);

      // The budget is spent, and it is keyed by address rather than by
      // credential — deliberately, because the credential is the part that
      // could not be trusted. So the valid token from the same address is now
      // refused too, and told when to come back rather than left to guess.
      const limited = await server.get('/auth/me', { authorization: `Bearer ${token}` });
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  it('never meters a customer token, which costs no lookup to reject', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '1' }, async (server) => {
      const resolve = vi.spyOn(server.app.tokens, 'resolve');
      // `nxc1.` is verified by HMAC in this process. Putting a widget's visitors
      // — who share one address behind any NAT — into a per-IP failure budget
      // would be collateral bought for nothing, since there is no query to save.
      const headers = { authorization: 'Bearer nxc1.notatoken.notasignature' };

      for (let i = 0; i < 4; i++) {
        const rejected = await server.get('/auth/me', headers);
        expect(rejected.statusCode).toBe(401);
      }
      expect(resolve).not.toHaveBeenCalled();
      resolve.mockRestore();
    });
  });

  it('meters an anonymous caller before authentication turns it away', async () => {
    await withServer({ RATE_LIMIT_ANON_PER_MIN: '2' }, async (server) => {
      // A protected route with no credential at all. This used to be answered
      // 401 out of the authentication hook and never metered by anything,
      // because the anonymous bucket ran in a phase the throw skipped.
      expect((await server.get('/auth/me')).statusCode).toBe(401);
      expect((await server.get('/auth/me')).statusCode).toBe(401);

      const limited = await server.get('/auth/me');
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.type).toBe('too_many_requests');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  it('charges an anonymous request once, not once per lifecycle phase', async () => {
    await withServer({ RATE_LIMIT_ANON_PER_MIN: '30' }, async (server) => {
      // The anonymous bucket is now consulted in `onRequest` *and* reachable in
      // `preHandler`; a public route passes through both. Two hooks metering one
      // request would halve every anonymous limit in the product silently, so
      // the budget is read off the wire rather than assumed.
      const first = await server.post('/auth/login', {
        email: 'nobody@example.com',
        password: 'x',
      });
      const second = await server.post('/auth/login', {
        email: 'nobody@example.com',
        password: 'x',
      });

      expect(first.headers['x-ratelimit-limit']).toBe('30');
      expect(Number(first.headers['x-ratelimit-remaining'])).toBe(29);
      expect(Number(second.headers['x-ratelimit-remaining'])).toBe(28);
    });
  });

  it('keeps the health probe on its own bucket, credential or not', async () => {
    await withServer(
      { RATE_LIMIT_HEALTH_PER_MIN: '600', RATE_LIMIT_ANON_PER_MIN: '1' },
      async (server) => {
        // `/health` is public and carries `healthRateLimit`, so moving the
        // anonymous bucket earlier must not have quietly re-pointed the probe at
        // it (M-SEC-b2 still stands). A limit of one anonymous request a minute
        // would make that visible immediately.
        for (let i = 0; i < 4; i++) {
          const probe = await server.get('/health');
          expect(probe.statusCode).toBe(200);
          expect(probe.headers['x-ratelimit-limit']).toBe('600');
        }
      },
    );
  });
});
