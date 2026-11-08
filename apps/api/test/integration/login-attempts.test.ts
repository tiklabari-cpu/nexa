/**
 * The password doors' budget per sign-in address, and the anonymous bucket per
 * client network (tm 422 · audit F05).
 *
 * The anonymous bucket was keyed by the full address, so every address of one
 * IPv6 /64 had a budget of its own, and nothing counted guesses at one
 * person's password spread over many addresses. What is pinned here, at the
 * production default of ten failures per fifteen minutes:
 *   - the eleventh wrong password at one address is a 429, from eleven
 *     networks as from one, and an unknown address is answered the same way;
 *   - the spent budget refuses the networks that spent it, not the person:
 *     a network that has not tried gets one attempt, and the network the
 *     account last signed in from keeps its own allowance whatever the
 *     guessers spend;
 *   - both password doors spend and answer to the one budget, a right password
 *     takes its slot back, and a burst cannot outrun the count;
 *   - a wrong password is recorded in each of the account's workspaces, with
 *     no address and no password in the entry;
 *   - without Redis the tenant doors still fail open.
 */
import { type PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** The production default (env.ts), spelled out: the test fixture raises it for every other suite. */
const LIMIT = 10;
const WRONG = 'not-the-password-at-all';

/** RFC 5737 / RFC 3849 documentation networks: public peers, each its own network. */
const guesser = (n: number) => `198.51.100.${n}`;
const elsewhere = (n: number) => `203.0.113.${n}`;

describe('the password budget per sign-in address (tm 422)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({
      RATE_LIMIT_LOGIN_ACCOUNT_FAILURES: String(LIMIT),
      RATE_LIMIT_LOGIN_ACCOUNT_WINDOW_SECONDS: '900',
      // Per network, and not what this suite is about.
      RATE_LIMIT_ANON_PER_MIN: '1000',
    });
  });

  afterAll(async () => {
    await clearRateLimits(server.app);
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  /** `POST /auth/login` from `from` — the peer itself, so no header can rename it. */
  async function login(from: string, email: string, password: string) {
    const response = await server.app.inject({
      method: 'POST',
      url: server.url('/auth/login'),
      payload: { email, password },
      remoteAddress: from,
    });
    await server.app.loginFailures.idle();
    return response;
  }

  function authorize(from: string, email: string, password: string) {
    return server.app.inject({
      method: 'POST',
      url: server.url('/auth/authorize'),
      payload: {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email,
        password,
        license_id: fx.a.licenseId.toString(),
      },
      remoteAddress: from,
    });
  }

  /** `LIMIT` wrong passwords at `email`, one from each of `LIMIT` networks — all 401. */
  async function spendBudget(email: string, first = 1): Promise<void> {
    for (let n = first; n < first + LIMIT; n++) {
      expect((await login(guesser(n), email, WRONG)).statusCode, guesser(n)).toBe(401);
    }
  }

  function expectRefused(response: LightMyRequestResponse): void {
    expect(response.statusCode).toBe(429);
    expect(response.json().error.type).toBe('too_many_requests');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(900);
    expect(response.headers['x-ratelimit-limit']).toBe(String(LIMIT));
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
  }

  it('refuses the eleventh wrong password at one address from eleven networks (NFR-S8)', async () => {
    await spendBudget(fx.a.agentEmail);
    expectRefused(await login(guesser(LIMIT + 1), fx.a.agentEmail, WRONG));

    // A network that guessed is refused before the password is looked at —
    // the right one included.
    expectRefused(await login(guesser(3), fx.a.agentEmail, fx.a.password));
    // Another address is untouched.
    expect((await login(guesser(3), fx.b.agentEmail, fx.b.password)).statusCode).toBe(200);
  });

  it('answers an unknown address exactly as a registered one (NFR-S8)', async () => {
    const unknown = `nobody-${generateToken(6).toLowerCase()}@example.test`;
    const asked = async (email: string, first: number) => {
      const answers = [];
      for (let n = first; n <= first + LIMIT; n++)
        answers.push(await login(guesser(n), email, WRONG));
      return answers.map((answer) => ({
        status: answer.statusCode,
        type: answer.json().error.type,
        message: answer.json().error.message,
      }));
    };

    const forUnknown = await asked(unknown, 1);
    const forKnown = await asked(fx.a.agentEmail, 101);
    expect(forUnknown.map((answer) => answer.status)).toEqual([...Array(LIMIT).fill(401), 429]);
    expect(forUnknown).toEqual(forKnown);
  });

  it('lets the person in from a network that has not guessed, once the guessers spent the budget (NFR-S8)', async () => {
    await spendBudget(fx.a.agentEmail);
    expectRefused(await login(guesser(1), fx.a.agentEmail, fx.a.password));

    const signedIn = await login(elsewhere(10), fx.a.agentEmail, fx.a.password);
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json().account.id).toBe(fx.a.agentAccountId);
  });

  it('gives a network that has not guessed one attempt — a wrong one is a 429 (NFR-S8)', async () => {
    await spendBudget(fx.a.agentEmail);

    // Fresh, so its one attempt is checked; wrong, so it is told to wait —
    // which is what its next attempt would hear, even with the password.
    expectRefused(await login(elsewhere(20), fx.a.agentEmail, WRONG));
    expectRefused(await login(elsewhere(20), fx.a.agentEmail, fx.a.password));
  });

  it('keeps the network the account last signed in from open, whatever the guessers spend (NFR-S8)', async () => {
    // Home: an IPv6 subscriber, and its /64 is what is remembered.
    expect((await login('2001:db8:aa:bb::1', fx.a.agentEmail, fx.a.password)).statusCode).toBe(200);

    // The guessers spend the budget, then the fresh-network allowance too:
    // twice the limit, every one from a network of its own.
    await spendBudget(fx.a.agentEmail);
    for (let n = LIMIT + 1; n <= 2 * LIMIT; n++) {
      expectRefused(await login(guesser(n), fx.a.agentEmail, WRONG));
    }
    // So a network that never tried is now refused as well…
    expectRefused(await login(elsewhere(30), fx.a.agentEmail, fx.a.password));

    // …and home is not: a typo there is an ordinary 401, not a lockout, and
    // another address of the same /64 is the same home.
    const typo = await login('2001:db8:aa:bb::2', fx.a.agentEmail, WRONG);
    expect(typo.statusCode).toBe(401);
    expect(typo.json().error.type).toBe('authentication');
    expect((await login('2001:db8:aa:bb::3', fx.a.agentEmail, fx.a.password)).statusCode).toBe(200);
  });

  it('counts both password doors against one budget (NFR-S8)', async () => {
    // Spent at the workspace list…
    await spendBudget(fx.a.ownerEmail);
    // …closes the authorization to the networks that spent it…
    expectRefused(await authorize(guesser(2), fx.a.ownerEmail, fx.a.password));
    // …and not to the person somewhere else.
    expect((await authorize(elsewhere(40), fx.a.ownerEmail, fx.a.password)).statusCode).toBe(200);

    // And the other way round: wrong passwords at the authorization spend it.
    await clearRateLimits(server.app);
    for (let n = 1; n <= LIMIT; n++) {
      expect((await authorize(guesser(n), fx.a.ownerEmail, WRONG)).statusCode).toBe(401);
    }
    expectRefused(await login(guesser(1), fx.a.ownerEmail, fx.a.password));
  });

  it('hands a right password its slot back (NFR-S8)', async () => {
    const from = elsewhere(50);
    for (let i = 0; i < LIMIT - 1; i++) {
      expect((await login(from, fx.a.agentEmail, WRONG)).statusCode).toBe(401);
    }
    expect((await login(from, fx.a.agentEmail, fx.a.password)).statusCode).toBe(200);
    // Nine failures, not ten: one more is still an ordinary refusal…
    expect((await login(from, fx.a.agentEmail, WRONG)).statusCode).toBe(401);
    // …and that one spent it.
    expectRefused(await login(from, fx.a.agentEmail, WRONG));
  });

  it('lets no more than the limit through a burst — each attempt is counted before it is checked (NFR-S8)', async () => {
    const burst = await Promise.all(
      Array.from({ length: LIMIT + 5 }, () => login(guesser(9), fx.a.agentEmail, WRONG)),
    );
    const statuses = burst.map((response) => response.statusCode).sort();
    expect(statuses.filter((status) => status === 401)).toHaveLength(LIMIT);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });

  it('records a wrong password in each of the account’s workspaces, naming neither the address nor the password', async () => {
    // A person in two workspaces: a guess at their password threatens both.
    await owner.agentMembership.create({
      data: { licenseId: fx.b.licenseId, agentId: fx.a.agentAccountId, role: 'agent' },
    });
    const failed = () =>
      owner.auditLogEntry.findMany({
        where: { action: 'auth.login_failed' },
        orderBy: { licenseId: 'asc' },
      });
    expect(await failed()).toEqual([]);

    const secret = `typed-by-mistake-${generateToken(6)}`;
    expect((await login(elsewhere(60), fx.a.agentEmail, secret)).statusCode).toBe(401);

    const entries = await failed();
    expect(entries.map((entry) => entry.licenseId)).toEqual(
      [fx.a.licenseId, fx.b.licenseId].sort((x, y) => (x < y ? -1 : 1)),
    );
    for (const entry of entries) {
      expect(entry.target).toBe(`account:${fx.a.agentAccountId}`);
      expect(entry.actorType).toBe('system');
      expect(entry.actorId).toBeNull();
      expect(entry.metadata).toEqual({
        reason: 'invalid_credentials',
        request_id: expect.any(String),
      });
      expect(entry.ip).toBe(elsewhere(60));
      const text = JSON.stringify(entry, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(text).not.toContain(fx.a.agentEmail);
      expect(text).not.toContain(secret);
    }

    // An unknown address has no workspace to be recorded in, and a right
    // password is not a failure.
    expect((await login(elsewhere(61), 'nobody@example.test', secret)).statusCode).toBe(401);
    expect((await login(elsewhere(62), fx.a.agentEmail, fx.a.password)).statusCode).toBe(200);
    expect(await failed()).toHaveLength(2);
  });

  it('fails open without Redis, like every tenant bucket (NFR-S8)', async () => {
    const down = vi
      .spyOn(server.app.redis, 'evalsha')
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6380'));
    try {
      expect((await login(elsewhere(70), fx.a.agentEmail, WRONG)).statusCode).toBe(401);
      expect((await login(elsewhere(70), fx.a.agentEmail, fx.a.password)).statusCode).toBe(200);
    } finally {
      down.mockRestore();
    }
  });
});

describe('the anonymous bucket per client network (tm 422)', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({ RATE_LIMIT_ANON_PER_MIN: '2' });
  });

  afterAll(async () => {
    await clearRateLimits(server.app);
    await server.close();
  });

  beforeEach(async () => {
    await clearRateLimits(server.app);
  });

  const anonymous = (remoteAddress: string) =>
    server.app.inject({ method: 'GET', url: server.url('/auth/me'), remoteAddress });

  it('counts every address of one IPv6 /64 as one caller (NFR-S8)', async () => {
    expect((await anonymous('2001:db8:1:2::a')).statusCode).toBe(401);
    expect((await anonymous('2001:db8:1:2::b')).statusCode).toBe(401);
    const third = await anonymous('2001:db8:1:2:ffff:ffff:ffff:fffe');
    expect(third.statusCode).toBe(429);
    expect(third.headers['x-ratelimit-limit']).toBe('2');

    // The next /64 is another subscriber.
    expect((await anonymous('2001:db8:1:3::a')).statusCode).toBe(401);
  });

  it('keeps an IPv4 address its own caller (NFR-S8)', async () => {
    expect((await anonymous('192.0.2.1')).statusCode).toBe(401);
    expect((await anonymous('192.0.2.1')).statusCode).toBe(401);
    expect((await anonymous('192.0.2.1')).statusCode).toBe(429);
    expect((await anonymous('192.0.2.2')).statusCode).toBe(401);
  });
});
