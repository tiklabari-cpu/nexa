/**
 * The visitor's draft preview has buckets of its own (tm 417.3).
 *
 * `POST /customer/chat/typing` used to spend the visitor's 60 a minute — the
 * budget the message send and the poll live on — so typing steadily could get
 * the visitor's next message refused. It now answers to three buckets of its
 * own (`plugins/rate-limit.ts`, "The visitor's draft"):
 *   - per visitor, `rl:customertyping:<org>:<customer>`, charged before
 *     authentication like every visitor bucket (the stage-one key and the
 *     stage-two key are the same, so one request is one charge);
 *   - per address, `rl:customertypingip:<ip>`, over every visitor behind it;
 *   - per conversation, `rl:customertypingchat:<chat>`, charged by the route
 *     once it has found the chat and before anything reaches an agent.
 *
 * Each server runs with the ceiling under test lowered to 3, and every other
 * limit spelled out so CI's raised defaults cannot make a test vacuous.
 */
import { type PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, type Region } from '@siyahtus/types';
import { ownerClient, seedDefaultBrand, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

/** Generous everywhere, so only the ceiling a test lowers can refuse. */
const ROOMY = {
  RATE_LIMIT_ANON_PER_MIN: '100',
  RATE_LIMIT_CUSTOMER_PER_MIN: '100',
  RATE_LIMIT_CUSTOMER_IP_PER_MIN: '1000',
  RATE_LIMIT_CUSTOMER_TYPING_PER_MIN: '100',
  RATE_LIMIT_CUSTOMER_TYPING_IP_PER_MIN: '1000',
  RATE_LIMIT_CUSTOMER_TYPING_CHAT_PER_MIN: '100',
};

/** Letters only: digits near a word like "kod" would be masked (AI-26). */
const DRAFT = { is_typing: true, text: 'Merhaba yaziyorum' };

describe('visitor typing preview — its own rate limit buckets (tm 417.3)', () => {
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
    await seedDefaultBrand(owner, fx.a.licenseId);
    // A person takes the first message, so a draft has an agent to reach and
    // the route gets as far as the conversation's own bucket.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });
  });

  /** One server per test: the lowered ceiling is what varies. */
  async function withServer(
    overrides: Record<string, string>,
    body: (server: TestServer) => Promise<void>,
  ): Promise<void> {
    const server = await startTestServer({ ...ROOMY, ...overrides });
    try {
      await clearRateLimits(server.app);
      await body(server);
    } finally {
      await clearRateLimits(server.app);
      await server.close();
    }
  }

  async function visitor(server: TestServer): Promise<{ headers: Headers; token: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const { token } = response.json() as { token: string };
    return { token, headers: { authorization: `Bearer ${token}` } };
  }

  /** A visitor whose first message a person picked up. */
  async function humanChat(server: TestServer) {
    const who = await visitor(server);
    const started = await server.post('/customer/chat/events', { text: 'Merhaba' }, who.headers);
    expect(started.statusCode).toBe(201);
    const chatId = started.json().chat_id as string;
    const thread = await owner.thread.findFirstOrThrow({
      where: { chatId, active: true },
      select: { assigneeId: true },
    });
    expect(thread.assigneeId).toBe(fx.a.agentAccountId);
    return { ...who, chatId };
  }

  const typing = (
    server: TestServer,
    headers: Headers,
    body: Record<string, unknown> = DRAFT,
  ): Promise<LightMyRequestResponse> => server.post('/customer/chat/typing', body, headers);

  function expectRefusal(response: LightMyRequestResponse, limit: string): void {
    expect(response.statusCode).toBe(429);
    expect(response.json().error.type).toBe('too_many_requests');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(response.headers['x-ratelimit-limit']).toBe(limit);
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    expect(Number(response.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
  }

  async function windowSize(server: TestServer, pattern: string): Promise<number[]> {
    const keys = (await server.app.redis.keys(pattern)).sort();
    return Promise.all(keys.map((key) => server.app.redis.zcard(key)));
  }

  it("refuses the visitor's 4th draft and leaves its messages and poll alone (FR-MOD-11.8)", async () => {
    await withServer(
      { RATE_LIMIT_CUSTOMER_TYPING_PER_MIN: '3', RATE_LIMIT_CUSTOMER_PER_MIN: '3' },
      async (server) => {
        // Spends 1 of the 3 messages-and-poll slots.
        const chat = await humanChat(server);

        for (let i = 0; i < 3; i++) {
          const sent = await typing(server, chat.headers, { ...DRAFT, seq: i });
          expect(sent.statusCode).toBe(204);
          expect(sent.headers['x-ratelimit-limit']).toBe('3');
        }
        expectRefusal(await typing(server, chat.headers, { ...DRAFT, seq: 3 }), '3');

        // The other two slots are still the visitor's: had typing spent them,
        // the message would be the 5th request of a budget of 3.
        const message = await server.post(
          '/customer/chat/events',
          { text: 'Siparisim nerede' },
          chat.headers,
        );
        expect(message.statusCode).toBe(201);
        const poll = await server.get('/customer/chat', chat.headers);
        expect(poll.statusCode).toBe(200);
        expect(poll.headers['x-ratelimit-remaining']).toBe('0');
      },
    );
  });

  it('charges one request once: one entry in each typing bucket, none in the visitor bucket (FR-MOD-11.8)', async () => {
    await withServer({}, async (server) => {
      const chat = await humanChat(server);
      const before = await windowSize(server, 'rl:customer:*');
      expect(before).toEqual([1]);

      expect((await typing(server, chat.headers, { ...DRAFT, seq: 0 })).statusCode).toBe(204);

      // Stage one and stage two picked the same key, so the visitor's typing
      // window holds one entry, not two — and its message window is untouched.
      expect(await windowSize(server, 'rl:customertyping:*')).toEqual([1]);
      expect(await windowSize(server, 'rl:customertypingip:*')).toEqual([1]);
      expect(await server.app.redis.zcard(`rl:customertypingchat:${chat.chatId}`)).toBe(1);
      expect(await windowSize(server, 'rl:customer:*')).toEqual(before);
      // The mint is on its own bucket (tm 429), and nothing on the anonymous one.
      expect(await server.app.redis.keys('rl:custtoken:*')).toHaveLength(1);
      expect(await server.app.redis.keys('rl:anon:*')).toEqual([]);
    });
  });

  it('keeps a draft without a good token on the anonymous bucket', async () => {
    await withServer({ RATE_LIMIT_ANON_PER_MIN: '3' }, async (server) => {
      // The mint has its own bucket (tm 429): none of the address's anonymous 3.
      const good = await visitor(server);
      const [body, signature] = good.token.split('.').slice(1);
      const forged = { authorization: `Bearer nxc1.${body}.${signature!.slice(1)}x` };

      expect((await typing(server, forged)).statusCode).toBe(401);
      expect((await typing(server, {})).statusCode).toBe(401);
      expect((await typing(server, forged)).statusCode).toBe(401);
      expectRefusal(await typing(server, forged), '3');

      // A forged token names nobody, so it bought no typing budget of its own.
      expect(await server.app.redis.keys('rl:customertyping*')).toEqual([]);
      // The good token is not on the anonymous bucket at all.
      expect((await typing(server, good.headers)).statusCode).toBe(200);
    });
  });

  it("caps an address's visitors together, and hands the refused visitor its slot back", async () => {
    await withServer({ RATE_LIMIT_CUSTOMER_TYPING_IP_PER_MIN: '3' }, async (server) => {
      const [first, second, third] = [
        await visitor(server),
        await visitor(server),
        await visitor(server),
      ];
      // No conversation yet: the route answers 200 `typing_preview: false`,
      // and the request has been charged all the same.
      for (const who of [first!, first!, second!]) {
        expect((await typing(server, who.headers)).statusCode).toBe(200);
      }

      expectRefusal(await typing(server, third!.headers), '3');

      // Its own window is empty again: the refused request was not served.
      const own = await windowSize(server, 'rl:customertyping:*');
      expect(own.sort()).toEqual([1, 2]);
      // And the visitor's messages and poll never met the typing ceiling.
      expect((await server.get('/customer/chat', third!.headers)).statusCode).toBe(200);
    });
  });

  it('bounds what reaches the agent of one chat, however many tokens speak for it (FR-MOD-11.8)', async () => {
    await withServer({ RATE_LIMIT_CUSTOMER_TYPING_CHAT_PER_MIN: '3' }, async (server) => {
      const chat = await humanChat(server);
      // Ten tokens for the same visitor, as ten tabs or ten mints would hold:
      // signed by the server's own key, so authentication takes every one.
      // A token naming another organisation cannot reach this chat at all —
      // the tenant is the token's — so the conversation is reachable only
      // through tokens of its own visitor.
      const claims = JSON.parse(
        Buffer.from(chat.token.split('.')[1]!, 'base64url').toString('utf8'),
      ) as { sub: string; org: string; lic: string; rgn: Region; brd?: string };
      const identities = Array.from({ length: 10 }, () => {
        const { token } = server.app.customerTokens.issue({
          customerId: claims.sub,
          organizationId: claims.org,
          licenseId: BigInt(claims.lic),
          region: claims.rgn,
          ...(claims.brd ? { brandId: claims.brd } : {}),
        });
        return { authorization: `Bearer ${token}` };
      });

      const sub = server.app.redis.duplicate();
      const envelopes: { action: string }[] = [];
      await sub.subscribe(licenseChannel(fx.a.licenseId));
      sub.on('message', (_channel, raw) => envelopes.push(JSON.parse(raw) as { action: string }));
      const statuses: number[] = [];
      let last: LightMyRequestResponse | undefined;
      try {
        for (const [n, headers] of identities.entries()) {
          last = await typing(server, headers, { ...DRAFT, seq: n });
          statuses.push(last.statusCode);
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      } finally {
        await sub.unsubscribe();
        sub.disconnect();
      }

      expect(statuses).toEqual([204, 204, 204, 429, 429, 429, 429, 429, 429, 429]);
      expectRefusal(last!, '3');
      // The visitor's own bucket let all ten through; the conversation's
      // ceiling is what stopped them, before anything was published.
      expect(await windowSize(server, 'rl:customertyping:*')).toEqual([10]);
      expect(envelopes.filter((e) => e.action === 'incoming_sneak_peek')).toHaveLength(3);
    });
  });
});
