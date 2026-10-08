/**
 * The token endpoint's own rate limit (tm 259.3 · Y1 in `docs/ux-audit-2026-10-07.md`).
 *
 * `POST /auth/token` used to fall into the anonymous per-address bucket that
 * sign-in and the widget's token mint share — 30 a minute by default. Every
 * panel page load spends one refresh, so a team behind one office address ran
 * into that ceiling with nothing but reloads, and the 429 signed people out
 * (the client half of that was tm 259.2). The exchange now has a bucket of its
 * own.
 *
 * The other half is what stops that bucket from being a gift to somebody
 * guessing. A refresh token, an authorization code and a client secret are all
 * credentials this endpoint looks up, so a refused one is charged to the same
 * per-address failure budget a refused bearer token is (M-SEC-c1) — and charged
 * on the way in, as a reservation the request hands back only once it has not
 * been refused, so the ceiling holds for requests sent all at once as well as
 * for ones sent in a polite queue.
 *
 * Addresses arrive the way they do behind the pilot's one edge — an
 * `X-Forwarded-For` from a loopback peer with `TRUST_PROXY_HOPS=1` — so one test
 * can sign in from one address and refresh from another and the budgets stay
 * exactly countable.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Where the sign-in that hands out the first refresh token comes from. */
const SIGN_IN_ADDRESS = '198.51.100.10';
/** The office: every test's counted traffic comes from here. */
const OFFICE = '203.0.113.40';

/** Long enough to look like a refresh token, and matching none. */
const GARBAGE_REFRESH_TOKEN = 'r'.repeat(43);
/** The same for a bearer credential — resolvable by nothing. */
const GARBAGE_BEARER = 'a'.repeat(64);

const from = (address: string) => ({ 'x-forwarded-for': address });

describe('rate limiting: the token endpoint (tm 259.3)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  /**
   * One server per test, because the ceilings are what is varied. Buckets live
   * in Redis and outlive a server, hence the sweep at both ends.
   */
  async function withServer(
    overrides: Record<string, string>,
    body: (server: TestServer) => Promise<void>,
  ): Promise<void> {
    const server = await startTestServer({ TRUST_PROXY_HOPS: '1', ...overrides });
    try {
      await clearRateLimits(server.app);
      await body(server);
    } finally {
      vi.restoreAllMocks();
      await clearRateLimits(server.app);
      await server.close();
    }
  }

  /** Authorize + code exchange — the panel's sign-in, minus the workspace list. */
  async function signIn(
    server: TestServer,
    address = SIGN_IN_ADDRESS,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const verifier = generateToken(48).slice(0, 64);
    const authorized = await server.post(
      '/auth/authorize',
      {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(verifier),
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      },
      from(address),
    );
    expect(authorized.statusCode).toBe(200);

    const exchanged = await server.post(
      '/auth/token',
      {
        grant_type: 'authorization_code',
        code: authorized.json().code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      },
      from(address),
    );
    expect(exchanged.statusCode).toBe(200);
    return exchanged.json();
  }

  const refresh = (
    server: TestServer,
    refreshToken: string,
    address = OFFICE,
    headers: Record<string, string> = {},
  ) =>
    server.post(
      '/auth/token',
      { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: fx.a.clientId },
      { ...from(address), ...headers },
    );

  const wrongPassword = (server: TestServer, address = OFFICE) =>
    server.post('/auth/login', { email: fx.a.ownerEmail, password: 'not-it' }, from(address));

  const garbageBearer = (server: TestServer, address = OFFICE) =>
    server.get('/auth/me', { ...from(address), authorization: `Bearer ${GARBAGE_BEARER}` });

  /** Rotates `count` times from `address`; every answer must be a grant. */
  async function rotate(
    server: TestServer,
    refreshToken: string,
    count: number,
    address = OFFICE,
  ): Promise<{ refreshToken: string; last: Awaited<ReturnType<typeof refresh>> }> {
    let current = refreshToken;
    let last: Awaited<ReturnType<typeof refresh>> | undefined;
    for (let i = 1; i <= count; i++) {
      last = await refresh(server, current, address);
      expect(last.statusCode, `refresh ${i} of ${count}`).toBe(200);
      current = last.json().refresh_token;
    }
    return { refreshToken: current, last: last! };
  }

  // =========================================================================
  // The bucket of its own
  // =========================================================================

  it('lets one address refresh more often than the anonymous ceiling allows', async () => {
    await withServer(
      { RATE_LIMIT_ANON_PER_MIN: '30', RATE_LIMIT_TOKEN_PER_MIN: '300' },
      async (server) => {
        const grant = await signIn(server);

        // The finding, measured: one more refresh than the anonymous bucket
        // holds, from one address inside one minute. The 31st used to be a 429.
        const { last } = await rotate(server, grant.refresh_token, 31);
        expect(last.headers['x-ratelimit-limit']).toBe('300');
        expect(last.headers['x-ratelimit-remaining']).toBe('269');
      },
    );
  });

  it('meters a token request by its own bucket instead of the anonymous one, never both', async () => {
    await withServer(
      { RATE_LIMIT_ANON_PER_MIN: '30', RATE_LIMIT_TOKEN_PER_MIN: '300' },
      async (server) => {
        // Sign-in's password step is the anonymous bucket's...
        const verifier = generateToken(48).slice(0, 64);
        const authorized = await server.post(
          '/auth/authorize',
          {
            client_id: fx.a.clientId,
            redirect_uri: fx.a.redirectUri,
            code_challenge: deriveCodeChallenge(verifier),
            email: fx.a.ownerEmail,
            password: TEST_PASSWORD,
            license_id: fx.a.licenseId.toString(),
          },
          from(OFFICE),
        );
        expect(authorized.headers['x-ratelimit-limit']).toBe('30');
        expect(authorized.headers['x-ratelimit-remaining']).toBe('29');

        // ...its code exchange is the token bucket's, and so is every refresh.
        const exchanged = await server.post(
          '/auth/token',
          {
            grant_type: 'authorization_code',
            code: authorized.json().code,
            code_verifier: verifier,
            client_id: fx.a.clientId,
            redirect_uri: fx.a.redirectUri,
          },
          from(OFFICE),
        );
        expect(exchanged.statusCode).toBe(200);
        expect(exchanged.headers['x-ratelimit-limit']).toBe('300');
        expect(exchanged.headers['x-ratelimit-remaining']).toBe('299');

        const rotated = await refresh(server, exchanged.json().refresh_token);
        expect(rotated.statusCode).toBe(200);
        // One slot per request: charged before authentication or after it, never
        // in both phases.
        expect(rotated.headers['x-ratelimit-remaining']).toBe('298');

        // And the token requests took nothing from sign-in's budget: the
        // authorize above is the only anonymous request this address has made.
        const signInAgain = await wrongPassword(server);
        expect(signInAgain.headers['x-ratelimit-limit']).toBe('30');
        expect(signInAgain.headers['x-ratelimit-remaining']).toBe('28');
      },
    );
  });

  it('keeps sign-in on the anonymous ceiling, and a spent one no longer stops a refresh', async () => {
    await withServer(
      { RATE_LIMIT_ANON_PER_MIN: '3', RATE_LIMIT_TOKEN_PER_MIN: '300' },
      async (server) => {
        const grant = await signIn(server);

        // Password guessing is exactly as bounded as before: ANON + 1 attempts
        // from one address, and the last is refused — at both password doors.
        for (let i = 0; i < 3; i++) {
          expect((await wrongPassword(server)).statusCode).toBe(401);
        }
        const limited = await wrongPassword(server);
        expect(limited.statusCode).toBe(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        const authorize = await server.post(
          '/auth/authorize',
          {
            client_id: fx.a.clientId,
            redirect_uri: fx.a.redirectUri,
            code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
            email: fx.a.ownerEmail,
            password: 'not-it',
            license_id: fx.a.licenseId.toString(),
          },
          from(OFFICE),
        );
        expect(authorize.statusCode).toBe(429);

        // But the people already signed in at that address keep their sessions.
        const rotated = await refresh(server, grant.refresh_token);
        expect(rotated.statusCode).toBe(200);
      },
    );
  });

  it('refuses the request past RATE_LIMIT_TOKEN_PER_MIN with 429 and Retry-After (NFR-S8)', async () => {
    await withServer(
      { RATE_LIMIT_ANON_PER_MIN: '30', RATE_LIMIT_TOKEN_PER_MIN: '3' },
      async (server) => {
        const grant = await signIn(server);
        const { refreshToken } = await rotate(server, grant.refresh_token, 3);

        const limited = await refresh(server, refreshToken);
        expect(limited.statusCode).toBe(429);
        expect(limited.json().error.type).toBe('too_many_requests');
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        expect(limited.headers['x-ratelimit-limit']).toBe('3');
        expect(limited.headers['x-ratelimit-remaining']).toBe('0');
        expect(limited.headers['x-ratelimit-reset']).toBeDefined();

        // Refused before the handler: the token it carried was not rotated, so
        // it is still the live one once the window has passed.
        await clearRateLimits(server.app);
        expect((await refresh(server, refreshToken)).statusCode).toBe(200);
      },
    );
  });

  it('leaves login, authorize, revoke and the widget token mint on the anonymous bucket', async () => {
    await withServer(
      { RATE_LIMIT_ANON_PER_MIN: '30', RATE_LIMIT_TOKEN_PER_MIN: '300' },
      async (server) => {
        // The new bucket is a route flag, and it is on one route. A flag that
        // spread to a password door would hand password guessing ten times the
        // budget; on the widget mint, every strayed request creates a visitor row.
        const answers = [
          await wrongPassword(server),
          await server.post(
            '/auth/authorize',
            {
              client_id: fx.a.clientId,
              redirect_uri: fx.a.redirectUri,
              code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
              email: fx.a.ownerEmail,
              password: 'not-it',
              license_id: fx.a.licenseId.toString(),
            },
            from(OFFICE),
          ),
          await server.post('/auth/revoke', { token: GARBAGE_REFRESH_TOKEN }, from(OFFICE)),
          await server.post(
            '/customer/token',
            { organization_id: fx.a.organizationId },
            { ...from(OFFICE), origin: `https://${fx.a.trustedDomain}` },
          ),
        ];
        expect(answers.map((a) => a.statusCode)).toEqual([401, 401, 200, 200]);
        expect(answers.map((a) => a.headers['x-ratelimit-limit'])).toEqual([
          '30',
          '30',
          '30',
          '30',
        ]);
        expect(answers.map((a) => a.headers['x-ratelimit-remaining'])).toEqual([
          '29',
          '28',
          '27',
          '26',
        ]);
      },
    );
  });

  it('meters by the route even when the caller also sends a bearer token', async () => {
    await withServer(
      {
        RATE_LIMIT_ANON_PER_MIN: '30',
        RATE_LIMIT_TOKEN_PER_MIN: '300',
        RATE_LIMIT_AGENT_PER_MIN: '180',
      },
      async (server) => {
        const grant = await signIn(server);
        const rotated = await refresh(server, grant.refresh_token, OFFICE, {
          authorization: `Bearer ${grant.access_token}`,
        });
        expect(rotated.statusCode).toBe(200);
        // Not the agent bucket the access token would otherwise have picked.
        expect(rotated.headers['x-ratelimit-limit']).toBe('300');
      },
    );
  });

  // =========================================================================
  // The failure budget it shares with every other credential
  // =========================================================================

  it('refuses an address that keeps presenting refresh tokens that do not work (NFR-S8)', async () => {
    await withServer(
      { RATE_LIMIT_AUTH_FAILURES_PER_MIN: '3', RATE_LIMIT_TOKEN_PER_MIN: '300' },
      async (server) => {
        const grant = await signIn(server);

        for (let i = 0; i < 3; i++) {
          const refused = await refresh(server, GARBAGE_REFRESH_TOKEN);
          expect(refused.statusCode).toBe(401);
          expect(refused.json().error.details.oauth_error).toBe('invalid_grant');
        }

        // The token bucket is nowhere near its ceiling; the failure budget is
        // spent, and that is the one that answers — even for a token that
        // would have worked.
        const limited = await refresh(server, grant.refresh_token);
        expect(limited.statusCode).toBe(429);
        expect(limited.json().error.type).toBe('too_many_requests');
        expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
        expect(limited.headers['x-ratelimit-limit']).toBe('3');

        // Turned away before the lookup: the good token was never read, let
        // alone rotated, so it still works once the window has passed.
        await clearRateLimits(server.app);
        expect((await refresh(server, grant.refresh_token)).statusCode).toBe(200);
      },
    );
  });

  it('shares that budget with bearer tokens: one ceiling for every credential an address presents', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '3' }, async (server) => {
      const grant = await signIn(server);

      expect((await garbageBearer(server)).statusCode).toBe(401);
      expect((await garbageBearer(server)).statusCode).toBe(401);
      expect((await refresh(server, GARBAGE_REFRESH_TOKEN)).statusCode).toBe(401);

      // Two kinds of failure, one budget: neither kind found a fresh allowance
      // by switching to the other door.
      expect((await refresh(server, grant.refresh_token)).statusCode).toBe(429);
      expect((await garbageBearer(server)).statusCode).toBe(429);
    });
  });

  it('cannot be routed around by also sending a working bearer token', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '3' }, async (server) => {
      // A trial account's own access token resolves fine, so it charges no
      // failure of its own — the refresh token in the body is still the
      // credential being tried, and it is what gets counted.
      const ownToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });
      const bearer = { authorization: `Bearer ${ownToken}` };

      for (let i = 0; i < 3; i++) {
        expect((await refresh(server, GARBAGE_REFRESH_TOKEN, OFFICE, bearer)).statusCode).toBe(401);
      }
      expect((await refresh(server, GARBAGE_REFRESH_TOKEN, OFFICE, bearer)).statusCode).toBe(429);
    });
  });

  it('holds the failure ceiling when the attempts arrive all at once', async () => {
    await withServer(
      { RATE_LIMIT_AUTH_FAILURES_PER_MIN: '3', RATE_LIMIT_TOKEN_PER_MIN: '300' },
      async (server) => {
        // Twenty bad refresh tokens in flight together. A budget that is only
        // read on the way in and charged on the way out lets every one of them
        // past the read before the first is charged; the reservation is what
        // makes the third the last one looked up.
        const answers = await Promise.all(
          Array.from({ length: 20 }, () => refresh(server, GARBAGE_REFRESH_TOKEN)),
        );
        const statuses = answers.map((a) => a.statusCode);
        expect(statuses.filter((s) => s === 401)).toHaveLength(3);
        expect(statuses.filter((s) => s === 429)).toHaveLength(17);
      },
    );
  });

  it('gives the slot back when the token request succeeds', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '2' }, async (server) => {
      const grant = await signIn(server);

      // Five good refreshes against a failure budget of two: each one holds a
      // slot only while its own outcome is unknown.
      await rotate(server, grant.refresh_token, 5);

      // Both slots are still there to be spent by failures.
      expect((await garbageBearer(server)).statusCode).toBe(401);
      expect((await garbageBearer(server)).statusCode).toBe(401);
      expect((await garbageBearer(server)).statusCode).toBe(429);
    });
  });

  it('gives the slot back when nothing was looked up (a malformed body)', async () => {
    await withServer({ RATE_LIMIT_AUTH_FAILURES_PER_MIN: '2' }, async (server) => {
      // No credential reached a lookup, so this is not a failed one — the same
      // line the bearer path draws for a header it cannot parse.
      for (let i = 0; i < 3; i++) {
        const malformed = await server.post(
          '/auth/token',
          { grant_type: 'refresh_token', client_id: fx.a.clientId },
          from(OFFICE),
        );
        expect(malformed.statusCode).toBe(400);
      }

      expect((await refresh(server, GARBAGE_REFRESH_TOKEN)).statusCode).toBe(401);
      expect((await refresh(server, GARBAGE_REFRESH_TOKEN)).statusCode).toBe(401);
      expect((await refresh(server, GARBAGE_REFRESH_TOKEN)).statusCode).toBe(429);
    });
  });

  // =========================================================================
  // Redis unreachable
  // =========================================================================

  it('fails open when the limiter cannot reach Redis, like every other bucket', async () => {
    await withServer(
      { RATE_LIMIT_AUTH_FAILURES_PER_MIN: '1', RATE_LIMIT_TOKEN_PER_MIN: '1' },
      async (server) => {
        const grant = await signIn(server);

        // Every budget — reserved, consumed or read — goes through one script
        // call, and a release is one ZREM: break both and nothing is metered.
        const away = new Error('Connection is closed.');
        vi.spyOn(server.app.redis, 'evalsha').mockRejectedValue(away);
        vi.spyOn(server.app.redis, 'zrem').mockRejectedValue(away);

        // Twice each against ceilings of one: an unmetered refresh is served...
        const { last } = await rotate(server, grant.refresh_token, 2);
        expect(last.headers['x-ratelimit-limit']).toBeUndefined();
        // ...and a bad token is still refused for what it is, not as a 500.
        for (let i = 0; i < 2; i++) {
          expect((await refresh(server, GARBAGE_REFRESH_TOKEN)).statusCode).toBe(401);
        }
      },
    );
  });
});
