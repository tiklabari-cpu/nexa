/**
 * A player's judgement outside the panel (AU-03 · tm 374): the `chat_rated`
 * delivery — once per judgement, comment masked, only to the workspace it
 * happened in — and, for a bad vote, the brand's automation (05 AU-03 karar
 * 1): the team's leads are told, the AI's own connection goes to the QA
 * queue, a follow-up ticket opens only when chosen.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_BOT_ID, DEFAULT_BAD_RATING_ACTIONS, licenseChannel } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const SCOPES = ['webhooks--all:rw', 'access_rules:rw', 'access_rules:ro', 'tickets--all:rw'];

interface Delivery {
  host: string;
  action: string;
  data: Record<string, unknown>;
}

describe('chat_rated and the bad-rating automation (AU-03 · tm 374)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;
  let received: Delivery[] = [];
  let pushes: Array<Record<string, unknown>> = [];
  let listener: ReturnType<TestServer['app']['redis']['duplicate']>;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const deliveries = (action: string, host = 'a') =>
    received.filter((d) => d.action === action && d.host === host);
  const pushed = async (action: string) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return pushes.filter((p) => p['action'] === action);
  };

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer(
      {},
      {
        webhookSender: async (target, request) => {
          const body = JSON.parse(request.body) as {
            action: string;
            data: Record<string, unknown>;
          };
          received.push({ host: target.url.pathname.split('/')[1]!, ...body });
          return { ok: true, statusCode: 200 };
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    received = [];
    pushes = [];
    const token = (t: TenantFixture) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes: SCOPES,
      });
    [tokenA, tokenB] = await Promise.all([token(fx.a), token(fx.b)]);
    await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', active: true },
    });
    listener?.disconnect();
    listener = server.app.redis.duplicate();
    await listener.subscribe(licenseChannel(fx.a.licenseId));
    listener.on('message', (_channel, raw) => {
      pushes.push(JSON.parse(raw) as Record<string, unknown>);
    });
  });

  async function subscribe(token: string, host: string, action: string): Promise<void> {
    const response = await server.post(
      '/webhooks',
      { url: `https://93.184.216.34/${host}/${action}`, action },
      auth(token),
    );
    expect(response.statusCode, response.body).toBe(201);
  }

  /** A team of `t` with one lead; the lead's account id. */
  async function teamWithLead(t: TenantFixture): Promise<{ groupId: bigint; leadId: string }> {
    const group = await owner.group.create({
      data: { licenseId: t.licenseId, name: `Finans ${Date.now()}` },
      select: { id: true },
    });
    const lead = await owner.account.create({
      data: { email: `lead-${group.id}-${t.licenseId}@example.test`, name: 'Lider' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: t.licenseId, agentId: lead.id, role: 'team_lead' },
    });
    await owner.groupAgent.create({
      data: { licenseId: t.licenseId, groupId: group.id, agentId: lead.id, isLead: true },
    });
    return { groupId: group.id, leadId: lead.id };
  }

  /**
   * A visitor's connection in `t`, closed, in `groupId`'s team; `ai` makes it
   * one the AI answered alone, `agent` adds a person's message.
   */
  async function ratedConversation(
    t: TenantFixture,
    options: { groupId?: bigint; ai?: boolean; agent?: boolean } = {},
  ) {
    const minted = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    const headers = { authorization: `Bearer ${(minted.json() as { token: string }).token}` };
    const sent = await server.post('/customer/chat/events', { text: 'Çekimim nerede?' }, headers);
    expect(sent.statusCode, sent.body).toBe(201);
    const body = sent.json() as { chat_id: string; event: { thread_id: string } };
    const chatId = body.chat_id;
    const threadId = body.event.thread_id;
    if (options.ai) {
      await owner.aiConversation.create({ data: { licenseId: t.licenseId, chatId, threadId } });
      await owner.event.create({
        data: {
          id: `${threadId}_ai1`,
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          recipients: 'all',
          text: 'Çekimler 24 saat içinde işlenir.',
          authorType: 'bot',
          authorId: AI_BOT_ID,
        },
      });
    }
    if (options.agent) {
      await owner.event.create({
        data: {
          id: `${threadId}_ag1`,
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          recipients: 'all',
          text: 'Kontrol ediyorum.',
          authorType: 'agent',
          authorId: t.agentAccountId,
        },
      });
    }
    await owner.thread.update({
      where: { id: threadId },
      data: {
        active: false,
        closedAt: new Date(),
        ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
      },
    });
    await owner.chat.update({ where: { id: chatId }, data: { active: false } });
    const rate = async (value: 'good' | 'bad', comment?: string) => {
      const response = await server.post(
        '/customer/chat/rating',
        { value, thread_id: threadId, ...(comment !== undefined ? { comment } : {}) },
        headers,
      );
      expect(response.statusCode, response.body).toBeLessThan(300);
    };
    return { chatId, threadId, rate };
  }

  it('a bad vote is delivered once, tells the team lead and queues the AI connection for QA (FR-MOD-09.4)', async () => {
    await subscribe(tokenA, 'a', 'chat_rated');
    await subscribe(tokenB, 'b', 'chat_rated');
    const { groupId, leadId } = await teamWithLead(fx.a);
    const c = await ratedConversation(fx.a, { groupId, ai: true });

    await c.rate('bad');
    // The comment, sent after the vote, writes onto it: no second judgement.
    await c.rate('bad', 'Param hâlâ gelmedi');

    expect(deliveries('chat_rated').map((d) => d.data)).toEqual([
      expect.objectContaining({
        chat_id: c.chatId,
        thread_id: c.threadId,
        value: 'bad',
        comment: null,
        group_id: Number(groupId),
      }),
    ]);
    expect(deliveries('chat_rated', 'b')).toEqual([]);

    const alerts = await pushed('chat_bad_rating_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!['payload']).toEqual({
      chat_id: c.chatId,
      thread_id: c.threadId,
      rating_id: expect.any(String),
      group_id: Number(groupId),
      ticket_id: null,
    });
    expect((alerts[0]!['audience'] as { agentIds: string[] }).agentIds).toEqual([leadId]);

    const review = await owner.qaReview.findFirstOrThrow({ where: { threadId: c.threadId } });
    expect(review.reasons).toEqual(['low_bsat']);
    expect(review.teamId).toBe(groupId);
    expect(await owner.ticket.count({ where: { sourceChatId: c.chatId } })).toBe(0);
  });

  it('the comment sent with the vote leaves masked; a good vote sets nothing off', async () => {
    await subscribe(tokenA, 'a', 'chat_rated');
    const { groupId } = await teamWithLead(fx.a);
    const bad = await ratedConversation(fx.a, { groupId });
    await bad.rate('bad', 'Kartım 4111 1111 1111 1111 ile yatırdım');
    const [delivery] = deliveries('chat_rated');
    expect(delivery!.data['comment']).toEqual(expect.stringContaining('yatırdım'));
    expect(JSON.stringify(received)).not.toContain('4111 1111 1111 1111');

    received = [];
    pushes = [];
    const good = await ratedConversation(fx.a, { groupId, ai: true });
    await good.rate('good');
    expect(deliveries('chat_rated').map((d) => d.data['value'])).toEqual(['good']);
    expect(await pushed('chat_bad_rating_alert')).toEqual([]);
    expect(await owner.qaReview.count({ where: { threadId: good.threadId } })).toBe(0);

    // Changing the vote to bad is a judgement of its own.
    await good.rate('bad');
    expect(deliveries('chat_rated').map((d) => d.data['value'])).toEqual(['good', 'bad']);
    expect(await pushed('chat_bad_rating_alert')).toHaveLength(1);
  });

  it('a connection a person answered is no AI review; the brand may open a ticket and silence the leads', async () => {
    await seedDefaultBrand(owner, fx.a.licenseId);
    await seedDefaultBrand(owner, fx.b.licenseId);
    const defaults = await server.get('/settings/chat-timeout', auth(tokenA));
    expect(defaults.json()).toMatchObject({ bad_rating_actions: DEFAULT_BAD_RATING_ACTIONS });
    const saved = await server.put(
      '/settings/chat-timeout',
      {
        chat_timeout_seconds: null,
        bad_rating_actions: { open_ticket: true, notify_team_leads: false },
      },
      auth(tokenA),
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      bad_rating_actions: { notify_team_leads: false, add_to_qa_queue: true, open_ticket: true },
    });
    const strict = await server.put(
      '/settings/chat-timeout',
      { chat_timeout_seconds: null, bad_rating_actions: { send_webhook: true } },
      auth(tokenA),
    );
    expect(strict.statusCode).toBe(400);

    await subscribe(tokenA, 'a', 'ticket_created');
    const { groupId } = await teamWithLead(fx.a);
    const c = await ratedConversation(fx.a, { groupId, ai: true, agent: true });
    await c.rate('bad');

    expect(await owner.qaReview.count({ where: { threadId: c.threadId } })).toBe(0);
    expect(await pushed('chat_bad_rating_alert')).toEqual([]);
    const ticket = await owner.ticket.findFirstOrThrow({ where: { sourceChatId: c.chatId } });
    expect(ticket).toMatchObject({
      status: 'open',
      sourceThreadId: c.threadId,
      groupId,
      customerId: expect.any(String),
    });
    expect(deliveries('ticket_created').map((d) => d.data['ticket_id'])).toEqual([ticket.id]);
    // The team hears of the new ticket as of any other.
    expect((await pushed('incoming_ticket')).map((p) => p['payload'])).toEqual([
      expect.objectContaining({ ticket_id: ticket.id }),
    ]);

    // A second bad vote on the same conversation's other connection would find
    // the unresolved ticket: no second one.
    await c.rate('good');
    await c.rate('bad');
    expect(await owner.ticket.count({ where: { sourceChatId: c.chatId } })).toBe(1);

    // The other workspace's setting is its own.
    const theirs = await server.get('/settings/chat-timeout', auth(tokenB));
    expect(theirs.json()).toMatchObject({ bad_rating_actions: DEFAULT_BAD_RATING_ACTIONS });
  });
});
