/**
 * Sign-ups per client network per hour (tm 257.14 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(2)).
 *
 * Sign-up is public in the pilot: every call creates a workspace and, with
 * verification on, mails an address from the deployment's own sender. The
 * anonymous per-minute bucket shapes traffic; this is an hourly allowance per
 * network — an IPv4 address, an IPv6 /64 — counted in the handler against
 * `request.ip`, so neither a malformed body nor a valid agent token buys a
 * way around it.
 *
 * The client address arrives the way it does behind the pilot's one edge:
 * `X-Forwarded-For` from a loopback peer with `TRUST_PROXY_HOPS=1` (the
 * default), which `trust-proxy.test.ts` proves is the visitor's address.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const LIMIT = 3;
const PASSWORD = 'a-long-enough-passphrase';

describe('sign-ups per network per hour (tm 257.14)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let sequence = 0;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({
      RATE_LIMIT_SIGNUP_PER_HOUR: String(LIMIT),
      // Out of the way: this file is about the hourly limit, not the
      // per-minute anonymous bucket every one of these requests also passes.
      RATE_LIMIT_ANON_PER_MIN: '1000',
    });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  const freshEmail = () => `founder-${Date.now().toString(36)}-${(sequence += 1)}@signup-rate.test`;

  const signupFrom = (ip: string, body: unknown, headers: Record<string, string> = {}) =>
    server.post('/auth/signup', body, { 'x-forwarded-for': ip, ...headers });

  const validBody = (email = freshEmail()) => ({
    email,
    password: PASSWORD,
    name: 'Founder',
    organization_name: 'Rate Co',
  });

  async function accountExists(email: string): Promise<boolean> {
    return (await owner.account.count({ where: { email } })) > 0;
  }

  /** Spend the network's whole hour with sign-ups that succeed. */
  async function spendHour(ip: string): Promise<void> {
    for (let i = 0; i < LIMIT; i += 1) {
      const response = await signupFrom(ip, validBody());
      expect(response.statusCode, response.body).toBe(201);
    }
  }

  it('refuses the sign-up past the hourly limit with 429 limit_reached, signup_rate and Retry-After, and creates nothing (NFR-S8)', async () => {
    await spendHour('203.0.113.10');

    const email = freshEmail();
    const refused = await signupFrom('203.0.113.10', validBody(email));

    expect(refused.statusCode).toBe(429);
    expect(refused.json().error).toMatchObject({
      type: 'limit_reached',
      details: { reason: 'signup_rate' },
    });
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(await accountExists(email)).toBe(false);
  });

  it('counts a malformed sign-up too: the body is read only after the limit', async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const malformed = await signupFrom('203.0.113.11', { email: 'not-an-address' });
      expect(malformed.statusCode).toBe(400);
    }

    const valid = await signupFrom('203.0.113.11', validBody());
    expect(valid.statusCode).toBe(429);
    expect(valid.json().error.details).toEqual({ reason: 'signup_rate' });
  });

  it('gives a different IPv4 address its own hour', async () => {
    await spendHour('203.0.113.12');
    expect((await signupFrom('203.0.113.12', validBody())).statusCode).toBe(429);

    expect((await signupFrom('203.0.113.13', validBody())).statusCode).toBe(201);
  });

  it('counts every address in one IPv6 /64 as one network, and another /64 separately', async () => {
    for (const ip of ['2001:db8:1:2::1', '2001:db8:1:2::2', '2001:db8:1:2:aaaa::3']) {
      expect((await signupFrom(ip, validBody())).statusCode).toBe(201);
    }

    // A fresh address in the same /64 — the rotation a /64 allows for free.
    const rotated = await signupFrom('2001:db8:1:2:ffff:ffff:ffff:fffe', validBody());
    expect(rotated.statusCode).toBe(429);
    expect(rotated.json().error.details).toEqual({ reason: 'signup_rate' });

    expect((await signupFrom('2001:db8:1:3::1', validBody())).statusCode).toBe(201);
  });

  it('counts an IPv4-mapped IPv6 address as the IPv4 client it carries', async () => {
    await spendHour('203.0.113.14');
    expect((await signupFrom('::ffff:203.0.113.14', validBody())).statusCode).toBe(429);
  });

  it('counts a sign-up that carries a valid agent token against the address, not the token', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
    const bearer = { authorization: `Bearer ${token}` };

    for (let i = 0; i < LIMIT; i += 1) {
      expect((await signupFrom('203.0.113.15', validBody(), bearer)).statusCode).toBe(201);
    }
    const refused = await signupFrom('203.0.113.15', validBody(), bearer);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.details).toEqual({ reason: 'signup_rate' });

    // And the same network without the token is the same spent hour.
    expect((await signupFrom('203.0.113.15', validBody())).statusCode).toBe(429);
  });

  it('lets sign-ups through when the budget store is unreachable (fails open, like every bucket)', async () => {
    // Every bucket, the anonymous one included, goes through this limiter.
    const consume = vi
      .spyOn(server.app.rateLimiter, 'consume')
      .mockRejectedValue(new Error('redis is away'));
    try {
      for (let i = 0; i < LIMIT + 1; i += 1) {
        expect((await signupFrom('203.0.113.16', validBody())).statusCode).toBe(201);
      }
      expect(consume).toHaveBeenCalledWith('rl:signup:203.0.113.16', LIMIT, 3_600_000);
    } finally {
      consume.mockRestore();
    }
  });
});

describe('sign-up closed: the 403 comes first and spends nothing (tm 257.14)', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      SIGNUP_ENABLED: 'false',
      RATE_LIMIT_SIGNUP_PER_HOUR: '1',
      RATE_LIMIT_ANON_PER_MIN: '1000',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await clearRateLimits(server.app);
  });

  it('answers every sign-up 403 signup_closed, never 429, and writes no sign-up bucket', async () => {
    for (let i = 0; i < 3; i += 1) {
      const closed = await server.post(
        '/auth/signup',
        { email: `closed-${i}@signup-rate.test` },
        { 'x-forwarded-for': '203.0.113.20' },
      );
      expect(closed.statusCode).toBe(403);
      expect(closed.json().error.details).toEqual({ reason: 'signup_closed' });
    }
    expect(await server.app.redis.keys('rl:signup:*')).toEqual([]);
  });
});
