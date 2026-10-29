/**
 * The player's rating and its comment (tm 337 · SiyahTuş analysis AR-03 ·
 * WG-11): `POST /customer/chat/rating`, the chat's `thread.rating`, the
 * archive's rating, `GET /reports/reviews/comments` and `chat_rated`.
 *
 * What the analysis' acceptance asks of the API half:
 *   - a comment written after a bad rating lands on that rating, and the
 *     rating still counts once; a second vote replaces the first;
 *   - the rating goes to the connection the widget names, also after the
 *     player opened a new one — and never to another player's;
 *   - a card number in the comment is stored masked;
 *   - by default an Ekip Üyesi does not see the rating of a connection that
 *     is not theirs — not on the row, not in the detail, not in the Inbox,
 *     not through the rating filter — and an Ekip Lideri and up see it;
 *   - the Reviews comments list pages newest first inside the same reach;
 *   - the chat's agents are told, with ids only.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultScopesForRole, licenseChannel } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

interface Envelope {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[] };
  payload: Record<string, unknown>;
}

const PAN = '4111111111111111';
const MASKED = '**** **** **** 1111';
const COMMENT = 'Çekimim üç gündür bekliyor, kimse dönmedi.';

describe('rating and comment (AR-03 · WG-11 · tm 337)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let sales: bigint;
  let ownerAuth: Headers;
  let leadAuth: Headers;
  let agentAuth: Headers;
  let pushes: Envelope[];
  let listener: Redis;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
    sales = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: sales, agentId: fx.a.agentAccountId },
    });
    const lead = await owner.account.create({
      data: { email: `lead-${fx.a.licenseId}@example.test`, name: 'The lead' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: lead.id, role: 'team_lead' },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: sales, agentId: lead.id, isLead: true },
    });
    ownerAuth = await session(fx.a, fx.a.ownerAccountId, 'owner');
    leadAuth = await session(fx.a, lead.id, 'team_lead');
    agentAuth = await session(fx.a, fx.a.agentAccountId, 'agent');

    pushes = [];
    listener = server.app.redis.duplicate();
    listener.on('message', (_channel: string, message: string) => {
      pushes.push(JSON.parse(message) as Envelope);
    });
    await listener.subscribe(licenseChannel(fx.a.licenseId));
  });

  afterEach(async () => {
    await listener.quit();
    await server.app.backgroundMail.settled();
  });

  async function session(t: TenantFixture, accountId: string, role: string): Promise<Headers> {
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      // The panel's own sign-in client: the session follows the matrix both ways.
      clientId: t.clientId,
      scopes: defaultScopesForRole(role),
    });
    return { authorization: `Bearer ${token}` };
  }

  async function visitor(): Promise<Headers> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode, response.body).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** The player writes; their chat goes to Sales. Returns the chat and its newest connection. */
  async function say(
    headers: Headers,
    text: string,
  ): Promise<{ chatId: string; threadId: string }> {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode, response.body).toBe(201);
    const chatId = (response.json() as { chat_id: string }).chat_id;
    await owner.chatAccess.upsert({
      where: { chatId_groupId: { chatId, groupId: sales } },
      create: { chatId, groupId: sales },
      update: {},
    });
    const thread = await owner.thread.findFirstOrThrow({
      where: { chatId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return { chatId, threadId: thread.id };
  }

  async function end(headers: Headers): Promise<void> {
    const response = await server.post('/customer/chat/close', undefined, headers);
    expect(response.statusCode, response.body).toBeLessThan(300);
  }

  function rate(
    headers: Headers,
    body: { value: 'good' | 'bad'; comment?: string; thread_id?: string },
  ) {
    return server.post('/customer/chat/rating', body, headers);
  }

  describe('writing it (WG-11)', () => {
    it('writes a comment after a bad rating onto that rating, which still counts once; a second vote replaces the first', async () => {
      const player = await visitor();
      const { threadId } = await say(player, 'Merhaba');
      await end(player);

      const first = await rate(player, { value: 'bad', thread_id: threadId });
      expect(first.statusCode, first.body).toBe(201);
      expect(first.json()).toMatchObject({ value: 'bad', thread_id: threadId, has_comment: false });

      const commented = await rate(player, { value: 'bad', comment: COMMENT, thread_id: threadId });
      expect(commented.statusCode, commented.body).toBe(200);
      expect(commented.json()).toMatchObject({ id: first.json().id, has_comment: true });
      expect(await owner.rating.count({ where: { threadId } })).toBe(1);

      const changed = await rate(player, { value: 'good', thread_id: threadId });
      expect(changed.statusCode).toBe(200);
      const rows = await owner.rating.findMany({ where: { threadId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first.json().id, value: 'good', comment: COMMENT });

      const reviews = await server.get('/reports/reviews', ownerAuth);
      expect(reviews.statusCode, reviews.body).toBe(200);
      expect(reviews.json().csat).toMatchObject({ good: 1, bad: 0 });
    });

    it('rates the connection the widget names after the player opened a new one, and refuses another player’s (AR-03)', async () => {
      const player = await visitor();
      const morning = await say(player, 'Merhaba');
      await end(player);
      const evening = await say(player, 'Yine ben');
      expect(evening.chatId).toBe(morning.chatId);
      expect(evening.threadId).not.toBe(morning.threadId);

      const old = await rate(player, {
        value: 'bad',
        comment: COMMENT,
        thread_id: morning.threadId,
      });
      expect(old.statusCode, old.body).toBe(201);
      expect(old.json().thread_id).toBe(morning.threadId);
      expect(await owner.rating.count({ where: { threadId: evening.threadId } })).toBe(0);

      // Without a name, the newest connection, as before.
      const newest = await rate(player, { value: 'good' });
      expect(newest.json().thread_id).toBe(evening.threadId);

      const stranger = await visitor();
      await say(stranger, 'Selam');
      const refused = await rate(stranger, { value: 'bad', thread_id: morning.threadId });
      expect(refused.statusCode).toBe(404);
      expect(await owner.rating.count({ where: { threadId: morning.threadId } })).toBe(1);
    });

    it('stores a card number in the comment masked (WG-11 · AI-26)', async () => {
      const player = await visitor();
      const { threadId } = await say(player, 'Merhaba');
      await rate(player, { value: 'bad', thread_id: threadId });
      await rate(player, {
        value: 'bad',
        comment: `kartım ${PAN} reddedildi`,
        thread_id: threadId,
      });

      const row = await owner.rating.findFirstOrThrow({ where: { threadId } });
      expect(row.comment).toBe(`kartım ${MASKED} reddedildi`);
      expect(await owner.rating.count({ where: { comment: { contains: PAN } } })).toBe(0);
    });

    it('tells the chat’s agents and team, with ids only', async () => {
      const player = await visitor();
      const { chatId, threadId } = await say(player, 'Merhaba');
      pushes = [];
      await rate(player, { value: 'bad', comment: COMMENT, thread_id: threadId });

      const rated = pushes.filter((push) => push.action === 'chat_rated');
      expect(rated).toHaveLength(1);
      expect(rated[0]!.payload).toEqual({ chat_id: chatId, thread_id: threadId });
      expect(rated[0]!.audience.groupIds).toContain(Number(sales));
    });
  });

  describe('who sees it (AR-03-S1)', () => {
    /** Two closed, rated, commented conversations in Sales: one the Ekip Üyesi had, one not. */
    async function twoConversations() {
      const ownPlayer = await visitor();
      const own = await say(ownPlayer, 'Merhaba');
      const otherPlayer = await visitor();
      const other = await say(otherPlayer, 'Selam');
      // Routing hands both to the only agent online; the other goes back to the queue.
      await owner.thread.update({
        where: { id: own.threadId },
        data: { assigneeId: fx.a.agentAccountId },
      });
      await owner.thread.update({ where: { id: other.threadId }, data: { assigneeId: null } });
      await end(ownPlayer);
      await end(otherPlayer);
      await rate(ownPlayer, { value: 'bad', comment: 'yavaştı', thread_id: own.threadId });
      await rate(otherPlayer, { value: 'bad', comment: COMMENT, thread_id: other.threadId });
      return { own, other };
    }

    it('shows an Ekip Üyesi the rating of their own connection only — row, detail, Inbox and filter agree', async () => {
      const { own, other } = await twoConversations();

      const list = await server.get('/archive/conversations', agentAuth);
      expect(list.statusCode, list.body).toBe(200);
      const rows = list.json().items as Array<{ thread_id: string; rating: unknown }>;
      expect(rows.find((row) => row.thread_id === own.threadId)?.rating).toEqual({
        value: 'bad',
        has_comment: true,
      });
      expect(rows.find((row) => row.thread_id === other.threadId)?.rating).toBeNull();

      const bad = await server.get('/archive/conversations?rating=bad', agentAuth);
      expect((bad.json().items as Array<{ thread_id: string }>).map((r) => r.thread_id)).toEqual([
        own.threadId,
      ]);
      const unrated = await server.get('/archive/conversations?rating=not_rated', agentAuth);
      expect(
        (unrated.json().items as Array<{ thread_id: string }>).map((r) => r.thread_id),
      ).toContain(other.threadId);

      const detail = await server.get(`/archive/conversations/${other.threadId}`, agentAuth);
      expect(detail.statusCode).toBe(200);
      expect(detail.json().rating).toBeNull();
      expect(detail.body).not.toContain(COMMENT);
      const ownDetail = await server.get(`/archive/conversations/${own.threadId}`, agentAuth);
      expect(ownDetail.json().rating).toMatchObject({ value: 'bad', comment: 'yavaştı' });

      const inboxOther = await server.get(`/chats/${other.chatId}`, agentAuth);
      expect(inboxOther.statusCode).toBe(200);
      expect(inboxOther.json().thread.rating).toBeNull();
      const inboxOwn = await server.get(`/chats/${own.chatId}`, agentAuth);
      expect(inboxOwn.json().thread.rating).toMatchObject({
        value: 'bad',
        has_comment: true,
        comment: 'yavaştı',
      });
    });

    it('shows an Ekip Lideri and the Kurucu every rating; the matrix can narrow the lead to none', async () => {
      const { other } = await twoConversations();

      for (const headers of [leadAuth, ownerAuth]) {
        const inbox = await server.get(`/chats/${other.chatId}`, headers);
        expect(inbox.statusCode, inbox.body).toBe(200);
        expect(inbox.json().thread.rating).toMatchObject({ value: 'bad', comment: COMMENT });
        const detail = await server.get(`/archive/conversations/${other.threadId}`, headers);
        expect(detail.json().rating).toMatchObject({ value: 'bad', comment: COMMENT });
      }

      await owner.roleCapabilityOverride.create({
        data: {
          licenseId: fx.a.licenseId,
          role: 'team_lead',
          capability: 'ratings.view',
          value: 'none',
        },
      });
      server.app.permissionMatrix.cache.invalidate();
      const narrowed = await server.get(`/chats/${other.chatId}`, leadAuth);
      expect(narrowed.json().thread.rating).toBeNull();
    });
  });

  describe('the Reviews comments (WG-11)', () => {
    it('lists commented ratings newest first, a page at a time, by value, inside ratings.view', async () => {
      const players = [await visitor(), await visitor(), await visitor()];
      const conversations = [];
      for (const player of players) conversations.push(await say(player, 'Merhaba'));
      // Routing hands all three to the only agent online; two go back to the queue.
      await owner.thread.updateMany({
        where: { id: { in: [conversations[1]!.threadId, conversations[2]!.threadId] } },
        data: { assigneeId: null },
      });
      await rate(players[0]!, {
        value: 'bad',
        comment: 'birinci',
        thread_id: conversations[0]!.threadId,
      });
      await rate(players[1]!, {
        value: 'good',
        comment: 'ikinci',
        thread_id: conversations[1]!.threadId,
      });
      // Rated, no comment: not listed.
      await rate(players[2]!, { value: 'bad', thread_id: conversations[2]!.threadId });

      const first = await server.get('/reports/reviews/comments?limit=1', ownerAuth);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().items.map((item: { comment: string }) => item.comment)).toEqual([
        'ikinci',
      ]);
      expect(first.json().items[0]).toMatchObject({
        value: 'good',
        chat_id: conversations[1]!.chatId,
        thread_id: conversations[1]!.threadId,
      });
      const second = await server.get(
        `/reports/reviews/comments?limit=1&page_id=${first.json().next_page_id as string}`,
        ownerAuth,
      );
      expect(second.json().items.map((item: { comment: string }) => item.comment)).toEqual([
        'birinci',
      ]);
      expect(second.json().next_page_id).toBeUndefined();

      const bad = await server.get('/reports/reviews/comments?value=bad', ownerAuth);
      expect(bad.json().items.map((item: { comment: string }) => item.comment)).toEqual([
        'birinci',
      ]);

      // An Ekip Üyesi given the reports reads only their own connection's comment.
      await owner.roleCapabilityOverride.create({
        data: {
          licenseId: fx.a.licenseId,
          role: 'agent',
          capability: 'reports.view',
          value: 'all',
        },
      });
      server.app.permissionMatrix.cache.invalidate();
      const member = await session(fx.a, fx.a.agentAccountId, 'agent');
      const mine = await server.get('/reports/reviews/comments', member);
      expect(mine.statusCode, mine.body).toBe(200);
      expect(mine.json().items.map((item: { comment: string }) => item.comment)).toEqual([
        'birinci',
      ]);

      expect(
        (await server.get('/reports/reviews/comments?page_id=nope', ownerAuth)).statusCode,
      ).toBe(400);
    });
  });
});
