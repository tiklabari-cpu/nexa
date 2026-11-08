/**
 * A widget's visitors are metered per visitor, not out of the anonymous
 * per-address bucket (tm 407).
 *
 * A customer token is checked by HMAC, with no lookup, so the pre-auth stage
 * of `plugins/rate-limit.ts` used to treat it like no credential at all: every
 * widget request was charged to `rl:anon:<ip>` — the 30 a minute sign-in and
 * the token mint live on — and then to its visitor's own bucket as well. Two
 * visitors behind one office NAT were enough to lock the widget for everybody
 * on it (pilot load test: `POST /customer/chat/events` refused on the 28th
 * request, `x-ratelimit-limit: 30`).
 *
 * What is pinned here, at the production defaults (set explicitly, because CI
 * raises the anonymous limit for every suite and would make the first test
 * vacuous):
 *   - many visitors behind one address send past 30 a minute without a 429,
 *     and none of it is taken from the anonymous budget;
 *   - one visitor is still stopped at its own limit, without spending its
 *     neighbours' share of the address;
 *   - the address as a whole answers to a wider ceiling, so minting visitor
 *     after visitor does not buy an open channel;
 *   - everything without a good token — none, forged — stays on the anonymous
 *     per-address bucket, and the mint, even when it is handed one, on its own
 *     per-network bucket (tm 429);
 *   - a public peer's own `X-Forwarded-For` buys no fresh budget of either kind.
 */
import { type PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

/** The production defaults this suite is about (env.ts), spelled out. */
const DEFAULTS = {
  RATE_LIMIT_ANON_PER_MIN: '30',
  RATE_LIMIT_CUSTOMER_PER_MIN: '60',
  RATE_LIMIT_CUSTOMER_IP_PER_MIN: '600',
  RATE_LIMIT_CUSTOMER_TOKEN_PER_MIN: '120',
};

/** A documentation address (RFC 5737): a public peer, so its own header is not believed. */
const PUBLIC_PEER = '203.0.113.7';

describe('widget visitors and the rate limiter (tm 407)', () => {
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
   * One server per test: the ceilings under test are what varies, and a low
   * one is the only way to reach it in a handful of requests. Buckets live in
   * Redis and outlive a server, hence the sweep at both ends.
   */
  async function withServer(
    overrides: Record<string, string>,
    body: (server: TestServer) => Promise<void>,
  ): Promise<void> {
    const server = await startTestServer({ ...DEFAULTS, TRUST_PROXY_HOPS: '1', ...overrides });
    try {
      await clearRateLimits(server.app);
      await body(server);
    } finally {
      await clearRateLimits(server.app);
      await server.close();
    }
  }

  function mint(server: TestServer, headers: Headers = {}): Promise<LightMyRequestResponse> {
    return server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}`, ...headers },
    );
  }

  /** A new visitor of workspace A, as the widget mints one. */
  async function visitor(server: TestServer): Promise<Headers> {
    const response = await mint(server);
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** The widget's poll, from `remoteAddress` rather than the loopback the helpers use. */
  function pollFrom(
    server: TestServer,
    remoteAddress: string,
    headers: Headers,
  ): Promise<LightMyRequestResponse> {
    return server.app.inject({
      method: 'GET',
      url: server.url('/customer/chat'),
      headers,
      remoteAddress,
    });
  }

  it('lets visitors behind one address send past 30 messages a minute, none of it anonymous (NFR-S8)', async () => {
    await withServer({}, async (server) => {
      const visitors = [];
      for (let i = 0; i < 4; i++) visitors.push(await visitor(server));

      // 4 × 8 = 32 messages from one address in well under a minute: past the
      // anonymous 30 by themselves, before the four polls and four mints.
      for (const headers of visitors) {
        for (let n = 0; n < 8; n++) {
          const sent = await server.post('/customer/chat/events', { text: `msg ${n}` }, headers);
          expect(sent.statusCode).toBe(201);
          // The visitor's own bucket is the one announced — the anonymous 30
          // used to be written first and then overwritten.
          expect(sent.headers['x-ratelimit-limit']).toBe('60');
        }
        const polled = await server.get('/customer/chat', headers);
        expect(polled.statusCode).toBe(200);
        expect(Number(polled.headers['x-ratelimit-remaining'])).toBe(60 - 9);
      }

      // The mint's own budget (tm 429) paid for the four mints and nothing
      // else, and the anonymous one for nothing at all.
      const fifth = await mint(server);
      expect(fifth.statusCode).toBe(200);
      expect(fifth.headers['x-ratelimit-limit']).toBe('120');
      expect(Number(fifth.headers['x-ratelimit-remaining'])).toBe(120 - 5);
      expect(await server.app.redis.keys('rl:anon:*')).toEqual([]);
    });
  });

  it('stops one visitor at its own limit and leaves the next visitor on the same address alone (NFR-S8)', async () => {
    await withServer({ RATE_LIMIT_CUSTOMER_PER_MIN: '5' }, async (server) => {
      const noisy = await visitor(server);
      const quiet = await visitor(server);

      for (let i = 0; i < 5; i++) {
        expect((await server.get('/customer/chat', noisy)).statusCode).toBe(200);
      }
      const limited = await server.get('/customer/chat', noisy);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.type).toBe('too_many_requests');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(limited.headers['x-ratelimit-limit']).toBe('5');
      expect(limited.headers['x-ratelimit-remaining']).toBe('0');

      const neighbour = await server.get('/customer/chat', quiet);
      expect(neighbour.statusCode).toBe(200);
      expect(neighbour.headers['x-ratelimit-limit']).toBe('5');
    });
  });

  it("does not let a visitor's refused requests spend the address's ceiling", async () => {
    await withServer(
      { RATE_LIMIT_CUSTOMER_PER_MIN: '3', RATE_LIMIT_CUSTOMER_IP_PER_MIN: '5' },
      async (server) => {
        const runaway = await visitor(server);
        const other = await visitor(server);

        // Three served, then ten refused by its own bucket. Only the three
        // reach the ceiling — otherwise a single script behind an office NAT
        // would lock out everyone else in the office.
        for (let i = 0; i < 13; i++) await server.get('/customer/chat', runaway);

        for (let i = 0; i < 2; i++) {
          expect((await server.get('/customer/chat', other)).statusCode).toBe(200);
        }
        // 3 + 2 = 5: now the address is out — while `other` still has a slot
        // of its own, so the refusal carries the ceiling's numbers.
        const refused = await server.get('/customer/chat', other);
        expect(refused.statusCode).toBe(429);
        expect(refused.headers['x-ratelimit-limit']).toBe('5');
      },
    );
  });

  it('caps every visitor from one address together, and hands the refused visitor its slot back', async () => {
    await withServer({ RATE_LIMIT_CUSTOMER_IP_PER_MIN: '4' }, async (server) => {
      const visitors = [await visitor(server), await visitor(server), await visitor(server)];

      for (const headers of visitors.slice(0, 2)) {
        expect((await server.get('/customer/chat', headers)).statusCode).toBe(200);
        expect((await server.get('/customer/chat', headers)).statusCode).toBe(200);
      }

      // A fresh visitor with its own budget untouched, refused all the same:
      // the ceiling is the address's. Minting more visitors does not buy more.
      const third = visitors[2]!;
      const refused = await server.get('/customer/chat', third);
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.type).toBe('too_many_requests');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      expect(refused.headers['x-ratelimit-limit']).toBe('4');
      expect(refused.headers['x-ratelimit-remaining']).toBe('0');

      // That request was not served, so it cost the visitor nothing: with the
      // address's window emptied, the visitor's next request is its first.
      const ceilingKeys = await server.app.redis.keys('rl:customerip:*');
      expect(ceilingKeys).toHaveLength(1);
      await server.app.redis.del(...ceilingKeys);
      const next = await server.get('/customer/chat', third);
      expect(next.statusCode).toBe(200);
      expect(Number(next.headers['x-ratelimit-remaining'])).toBe(60 - 1);
    });
  });

  it('keeps requests without a good token on the anonymous per-address bucket (NFR-S8)', async () => {
    await withServer({ RATE_LIMIT_ANON_PER_MIN: '3' }, async (server) => {
      const good = await visitor(server);
      const [body, signature] = good.authorization!.split('.').slice(1);
      // A real token's body with the signature edited, and a token with no
      // credential behind it at all: neither names a visitor, so neither is
      // given a visitor's budget.
      const forged = { authorization: `Bearer nxc1.${body}.${signature!.slice(1)}x` };

      expect((await server.get('/customer/chat')).statusCode).toBe(401);
      expect((await server.get('/customer/chat', forged)).statusCode).toBe(401);
      expect((await server.get('/customer/chat')).statusCode).toBe(401);

      // 3 refusals = 3 (the mint has its own bucket since tm 429): the address
      // is out, whichever way it asks next.
      const anonymous = await server.get('/customer/chat');
      expect(anonymous.statusCode).toBe(429);
      expect(anonymous.headers['x-ratelimit-limit']).toBe('3');
      expect((await server.get('/customer/chat', forged)).statusCode).toBe(429);

      // Neither the mint nor the visitor whose token is good is on that bucket.
      expect((await mint(server)).statusCode).toBe(200);
      expect((await server.get('/customer/chat', good)).statusCode).toBe(200);
    });
  });

  it('mints past the anonymous 30 from one address without touching sign-in, up to its own ceiling (tm 429 · NFR-S8)', async () => {
    await withServer({ RATE_LIMIT_CUSTOMER_TOKEN_PER_MIN: '40' }, async (server) => {
      // An office NAT's visitors opening pages: 31 mints in well under a minute.
      for (let i = 1; i <= 31; i++) {
        expect((await mint(server)).statusCode, `mint ${i}`).toBe(200);
      }
      // Sign-in still has its whole anonymous budget.
      const signIn = await server.post('/auth/login', {
        email: fx.a.agentEmail,
        password: fx.a.password,
      });
      expect(signIn.statusCode).toBe(200);
      expect(signIn.headers['x-ratelimit-limit']).toBe('30');
      expect(Number(signIn.headers['x-ratelimit-remaining'])).toBe(30 - 1);

      // The mint's own ceiling still holds.
      for (let i = 32; i <= 40; i++) expect((await mint(server)).statusCode, `mint ${i}`).toBe(200);
      const refused = await mint(server);
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.type).toBe('too_many_requests');
      expect(refused.headers['x-ratelimit-limit']).toBe('40');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  it('keeps the token mint on its own per-network bucket even when it is handed a good token (NFR-S8)', async () => {
    await withServer(
      { RATE_LIMIT_ANON_PER_MIN: '30', RATE_LIMIT_CUSTOMER_TOKEN_PER_MIN: '3' },
      async (server) => {
        const good = await visitor(server);

        // The mint does not admit customers, so a token there names no visitor
        // and buys no budget of its own: a held token is not a way to mint
        // visitors past the per-network limit (tm 429).
        for (let i = 0; i < 2; i++) {
          expect((await mint(server, good)).statusCode).not.toBe(429);
        }
        const limited = await mint(server, good);
        expect(limited.statusCode).toBe(429);
        expect(limited.headers['x-ratelimit-limit']).toBe('3');
        expect(await server.app.redis.keys('rl:anon:*')).toEqual([]);
      },
    );
  });

  it("buys no fresh budget with a public peer's own X-Forwarded-For (NFR-S8)", async () => {
    await withServer(
      { RATE_LIMIT_ANON_PER_MIN: '2', RATE_LIMIT_CUSTOMER_IP_PER_MIN: '2' },
      async (server) => {
        // Minted from loopback, so the mints spend loopback's mint budget, not
        // the public peer's below.
        const first = await visitor(server);
        const second = await visitor(server);
        const spoof = (n: number): Headers => ({ 'x-forwarded-for': `198.51.100.${n}` });

        // The ceiling is the peer's: rewriting the header names a new address
        // every time, and every one of them is read as the peer.
        expect((await pollFrom(server, PUBLIC_PEER, { ...first, ...spoof(1) })).statusCode).toBe(
          200,
        );
        expect((await pollFrom(server, PUBLIC_PEER, { ...second, ...spoof(2) })).statusCode).toBe(
          200,
        );
        expect((await pollFrom(server, PUBLIC_PEER, { ...second, ...spoof(3) })).statusCode).toBe(
          429,
        );

        // And the same for a caller without a token.
        expect((await pollFrom(server, PUBLIC_PEER, spoof(4))).statusCode).toBe(401);
        expect((await pollFrom(server, PUBLIC_PEER, spoof(5))).statusCode).toBe(401);
        expect((await pollFrom(server, PUBLIC_PEER, spoof(6))).statusCode).toBe(429);
      },
    );
  });
});
