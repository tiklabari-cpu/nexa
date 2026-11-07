/**
 * The visitor's unsent draft, on the server (tm 417.2 · K3–K6).
 *
 * `POST /customer/chat/typing` is where a draft the visitor has not chosen to
 * send leaves the API, so the privacy boundary lives here: who the frame is
 * addressed to, when nothing is published at all, what the text looks like on
 * the way out, and that nothing of it stays behind — not in a table, not in
 * Redis, not in a log line, not even in a query's parameters.
 *
 * Envelopes are read off the licence channel the RTM gateway subscribes to
 * (`sub.subscribe(licenseChannel(...))`), so the audience asserted here is the
 * one the gateway would fan out to.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { LineSink } from '../helpers/ai-workspace.js';

/** Letters only: digits near a word like "kod" would be masked (AI-26). */
const SENTINEL = 'ZZ-PREVIEW-SENTINEL-ABC';

type Envelope = Record<string, unknown> & {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[]; customerId?: string };
  payload: Record<string, unknown>;
};

describe('visitor typing preview — the server gate', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let brandA: string;
  let adminToken: string;
  /** In the chat's team, not accepting chats, so routing never picks them. */
  let teammateId: string;
  let teammateToken: string;

  const sink = new LineSink();
  const statements: Prisma.QueryEvent[] = [];

  beforeAll(async () => {
    owner = ownerClient();
    // Trace level, so a line that carried the draft at any level would be seen.
    server = await startTestServer(
      { LOG_LEVEL: 'trace' },
      {
        logStream: sink as unknown as NodeJS.WritableStream,
        onQuery: (event) => statements.push(event),
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    [brandA] = await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const teammate = await owner.account.create({
      data: { email: `teammate-${Date.now().toString(36)}@example.test`, name: 'Teammate' },
      select: { id: true },
    });
    teammateId = teammate.id;
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: teammateId,
        role: 'agent',
        routingStatus: 'not_accepting_chats',
      },
    });
    await owner.groupAgent.createMany({
      data: [fx.a.agentAccountId, teammateId].map((agentId) => ({
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId,
        priority: 'normal',
      })),
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw'],
    });
    teammateToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: teammateId,
      scopes: ['chats--all:rw'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function widgetToken(tenant: TenantFixture = fx.a) {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  /** A visitor whose first message routed to `fx.a`'s agent: a person holds it. */
  async function humanChat(tenant: TenantFixture = fx.a) {
    const { token, customer_id: customerId } = await widgetToken(tenant);
    const started = await server.post('/customer/chat/events', { text: 'Merhaba' }, auth(token));
    expect(started.statusCode).toBe(201);
    const chatId = started.json().chat_id as string;
    const thread = await owner.thread.findFirstOrThrow({
      where: { chatId, active: true },
      select: { id: true, assigneeId: true },
    });
    return { token, customerId, chatId, threadId: thread.id, assigneeId: thread.assigneeId };
  }

  /** The realtime envelopes published on the licences' channels while `run` executes. */
  async function captureBus(
    run: () => Promise<void>,
    licenseIds: bigint[] = [fx.a.licenseId],
  ): Promise<Envelope[]> {
    const sub = server.app.redis.duplicate();
    const seen: Envelope[] = [];
    const channels = licenseIds.map((id) => licenseChannel(id));
    await sub.subscribe(...channels);
    sub.on('message', (_channel, raw) => {
      seen.push(JSON.parse(raw) as Envelope);
    });
    try {
      await run();
      // The publish completes before the response; the subscriber hears it a tick later.
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await sub.unsubscribe(...channels);
      sub.disconnect();
    }
    return seen;
  }

  const typing = (token: string, body: Record<string, unknown>) =>
    server.post('/customer/chat/typing', body, auth(token));

  const previewsIn = (envelopes: Envelope[]) =>
    envelopes.filter(
      (e) => e.action === 'incoming_sneak_peek' || e.action === 'incoming_typing_indicator',
    );

  // ===========================================================================

  describe('who receives a draft', () => {
    it('sends one sneak-peek to the assigned agent only, with the seq (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      expect(chat.assigneeId).toBe(fx.a.agentAccountId);
      // The teammate opens the conversation: `#advanceSeen` gives them a
      // present chat_users row — present is not the same as responsible.
      const seen = await server.post(
        `/chats/${chat.chatId}/seen`,
        { seen_up_to: new Date().toISOString() },
        auth(teammateToken),
      );
      expect(seen.statusCode).toBeLessThan(300);
      expect(
        await owner.chatUser.findUnique({
          where: { chatId_userId: { chatId: chat.chatId, userId: teammateId } },
          select: { present: true },
        }),
      ).toEqual({ present: true });

      const envelopes = await captureBus(async () => {
        const response = await typing(chat.token, {
          is_typing: true,
          text: 'kargom nerede',
          seq: 7,
        });
        expect(response.statusCode).toBe(204);
      });

      // One frame, the draft itself — no typing indicator beside it (K6).
      expect(previewsIn(envelopes).map((e) => e.action)).toEqual(['incoming_sneak_peek']);
      const [peek] = envelopes;
      expect(peek!.audience).toEqual({ groupIds: [], agentIds: [fx.a.agentAccountId] });
      expect(peek!.audience.customerId).toBeUndefined();
      expect(peek!.payload).toMatchObject({
        chat_id: chat.chatId,
        thread_id: chat.threadId,
        sneak_peek: {
          author_id: chat.customerId,
          author_type: 'customer',
          recipients: 'agents',
          text: 'kargom nerede',
          seq: 7,
        },
      });
    });

    it('sends a clear as one typing indicator, to the same audience (FR-MOD-02.9)', async () => {
      const chat = await humanChat();
      const envelopes = await captureBus(async () => {
        const response = await typing(chat.token, { is_typing: false, seq: 8 });
        expect(response.statusCode).toBe(204);
      });

      expect(previewsIn(envelopes).map((e) => e.action)).toEqual(['incoming_typing_indicator']);
      expect(envelopes[0]!.audience).toEqual({ groupIds: [], agentIds: [fx.a.agentAccountId] });
      expect(envelopes[0]!.payload['typing_indicator']).toMatchObject({
        is_typing: false,
        seq: 8,
      });
    });

    it('treats a draft the cleaning empties as a clear (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      const envelopes = await captureBus(async () => {
        await typing(chat.token, { is_typing: true, text: '‮\u0007  ', seq: 3 });
      });
      expect(previewsIn(envelopes).map((e) => e.action)).toEqual(['incoming_typing_indicator']);
      expect(envelopes[0]!.payload['typing_indicator']).toMatchObject({ is_typing: false, seq: 3 });
    });

    it('adds a supervisor watching live, and drops one whose watch went stale (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      const watch = await server.post(
        `/chats/${chat.chatId}/supervise`,
        undefined,
        auth(adminToken),
      );
      expect(watch.statusCode).toBeLessThan(300);

      const live = await captureBus(async () => {
        await typing(chat.token, { is_typing: true, text: 'izliyor musun' });
      });
      expect(new Set(live[0]!.audience.agentIds)).toEqual(
        new Set([fx.a.agentAccountId, fx.a.ownerAccountId]),
      );

      // A tab closed without releasing: past the 90-second window, not watching.
      await owner.chatSupervision.updateMany({
        where: { chatId: chat.chatId },
        data: { lastSeenAt: new Date(Date.now() - 5 * 60_000) },
      });
      const stale = await captureBus(async () => {
        await typing(chat.token, { is_typing: true, text: 'hala orada misin' });
      });
      expect(stale[0]!.audience.agentIds).toEqual([fx.a.agentAccountId]);
    });

    it('stops reaching the agent a supervisor took the chat from (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      const seized = await server.post(`/chats/${chat.chatId}/takeover`, {}, auth(adminToken));
      expect(seized.statusCode).toBeLessThan(300);
      // The agent it was taken from stays on the chat, not present.
      expect(
        await owner.chatUser.findUnique({
          where: { chatId_userId: { chatId: chat.chatId, userId: fx.a.agentAccountId } },
          select: { present: true },
        }),
      ).toEqual({ present: false });

      const envelopes = await captureBus(async () => {
        await typing(chat.token, { is_typing: true, text: 'yeni biri mi geldi' });
      });
      expect(previewsIn(envelopes)).toHaveLength(1);
      expect(envelopes[0]!.audience).toEqual({ groupIds: [], agentIds: [fx.a.ownerAccountId] });
    });

    it('stops reaching the old team and agent once the chat is transferred to another team (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      const sales = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      });
      const seller = await owner.account.create({
        data: { email: `seller-${Date.now().toString(36)}@example.test`, name: 'Seller' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: seller.id,
          role: 'agent',
          routingStatus: 'accepting_chats',
        },
      });
      await owner.groupAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          groupId: sales.id,
          agentId: seller.id,
          priority: 'normal',
        },
      });

      const moved = await server.post(
        `/chats/${chat.chatId}/transfer`,
        { group_id: sales.id.toString() },
        auth(adminToken),
      );
      expect(moved.statusCode, moved.body).toBeLessThan(300);
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: chat.threadId },
        select: { assigneeId: true },
      });
      expect(thread.assigneeId).toBe(seller.id);

      const envelopes = await captureBus(async () => {
        await typing(chat.token, { is_typing: true, text: 'satis ekibi mi' });
      });
      expect(previewsIn(envelopes)).toHaveLength(1);
      expect(envelopes[0]!.audience).toEqual({ groupIds: [], agentIds: [seller.id] });
    });
  });

  // ===========================================================================

  describe('when nothing is published', () => {
    /** A visitor's connection put in each owner state the widget can see. */
    const STATES: Array<{
      name: string;
      setup: (chat: Awaited<ReturnType<typeof humanChat>>) => Promise<void>;
      open: boolean;
    }> = [
      { name: 'a person assigned', setup: async () => {}, open: true },
      {
        // AI-11: `parallel` assignment — the agent waits beside the AI.
        name: 'the AI answering, an agent waiting beside it',
        setup: async (chat) => {
          await owner.thread.update({ where: { id: chat.threadId }, data: { aiMode: 'ai' } });
        },
        open: false,
      },
      {
        name: 'waiting in the queue, someone accepting chats',
        setup: async (chat) => {
          await owner.thread.update({
            where: { id: chat.threadId },
            data: { assigneeId: null, queuePosition: 1 },
          });
        },
        open: false,
      },
      {
        name: 'waiting in the queue, nobody accepting chats',
        setup: async (chat) => {
          await owner.thread.update({
            where: { id: chat.threadId },
            data: { assigneeId: null, queuePosition: 1 },
          });
          await owner.agentMembership.updateMany({
            where: { licenseId: fx.a.licenseId },
            data: { routingStatus: 'offline' },
          });
        },
        open: false,
      },
      {
        name: 'unassigned, the AI about to join',
        setup: async (chat) => {
          await owner.thread.update({ where: { id: chat.threadId }, data: { assigneeId: null } });
          await owner.aiAgent.create({
            data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
          });
        },
        open: false,
      },
    ];

    for (const state of STATES) {
      it(`${state.name}: the poll and the route agree — ${state.open ? 'open' : 'closed'} (FR-MOD-02.9)`, async () => {
        const chat = await humanChat();
        await state.setup(chat);

        const poll = await server.get('/customer/chat', auth(chat.token));
        expect(poll.statusCode).toBe(200);
        expect(poll.json().typing_preview).toBe(state.open);

        const envelopes = await captureBus(async () => {
          const response = await typing(chat.token, { is_typing: true, text: 'bir sorum var' });
          if (state.open) {
            expect(response.statusCode).toBe(204);
          } else {
            expect(response.statusCode).toBe(200);
            expect(response.json()).toEqual({ typing_preview: false });
          }
        });
        expect(previewsIn(envelopes)).toHaveLength(state.open ? 1 : 0);
      });
    }

    it('with no open conversation: the poll says false and a draft goes nowhere (FR-MOD-02.9)', async () => {
      const { token } = await widgetToken();
      expect((await server.get('/customer/chat', auth(token))).json().typing_preview).toBe(false);
      const envelopes = await captureBus(async () => {
        const draft = await typing(token, { is_typing: true, text: 'kimse yok mu' });
        expect(draft.statusCode).toBe(200);
        expect(draft.json()).toEqual({ typing_preview: false });
        const clear = await typing(token, { is_typing: false });
        expect(clear.statusCode).toBe(204);
      });
      expect(previewsIn(envelopes)).toEqual([]);
    });

    it('still clears a draft once the chat went back to the AI (FR-MOD-02.9)', async () => {
      const chat = await humanChat();
      await owner.thread.update({ where: { id: chat.threadId }, data: { aiMode: 'ai' } });
      const envelopes = await captureBus(async () => {
        expect((await typing(chat.token, { is_typing: false, seq: 2 })).statusCode).toBe(204);
      });
      expect(previewsIn(envelopes).map((e) => e.action)).toEqual(['incoming_typing_indicator']);
    });

    it('when the workspace switched the preview off for the brand (FR-MOD-02.9)', async () => {
      const chat = await humanChat();
      await owner.widgetSettings.create({
        data: { licenseId: fx.a.licenseId, brandId: brandA, sneakPeekEnabled: false },
      });

      expect((await server.get('/customer/chat', auth(chat.token))).json().typing_preview).toBe(
        false,
      );
      const envelopes = await captureBus(async () => {
        const response = await typing(chat.token, { is_typing: true, text: 'kapali mi' });
        expect(response.json()).toEqual({ typing_preview: false });
      });
      expect(previewsIn(envelopes)).toEqual([]);
    });

    it('in a HIPAA-scoped workspace, whatever the switch says (FR-MOD-02.9)', async () => {
      // HIPAA cover needs a US-hosted workspace (a database check, and a region
      // never changes), served by the US build: a small one of its own.
      const organization = await owner.organization.create({
        data: { name: 'Org US preview', region: 'us' },
        select: { id: true },
      });
      const license = await owner.license.create({
        data: {
          organizationId: organization.id,
          plan: 'growth',
          status: 'trialing',
          trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
        },
        select: { id: true },
      });
      const agent = await owner.account.create({
        data: { email: `agent-us-${Date.now().toString(36)}@example.test`, name: 'Agent US' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: license.id, agentId: agent.id, role: 'agent' },
      });
      const usBrand = await seedDefaultBrand(owner, license.id);
      const domain = 'shop-us-preview.example.test';
      await owner.trustedDomain.create({
        data: { organizationId: organization.id, licenseId: license.id, domain },
      });

      const usServer = await startTestServer({ SIYAHTUS_REGION: 'us' });
      try {
        const minted = await usServer.post(
          '/customer/token',
          { organization_id: organization.id },
          { origin: `https://${domain}` },
        );
        expect(minted.statusCode).toBe(200);
        const token = minted.json().token as string;
        const started = await usServer.post(
          '/customer/chat/events',
          { text: 'Merhaba' },
          auth(token),
        );
        expect(started.statusCode).toBe(201);
        await owner.thread.updateMany({
          where: { chatId: started.json().chat_id, active: true },
          data: { assigneeId: agent.id, queuePosition: null },
        });

        const draft = () =>
          usServer.post('/customer/chat/typing', { is_typing: true, text: 'randevu' }, auth(token));

        // Not covered yet: the draft reaches the agent.
        expect((await usServer.get('/customer/chat', auth(token))).json().typing_preview).toBe(
          true,
        );
        const before = await captureBus(async () => {
          expect((await draft()).statusCode).toBe(204);
        }, [license.id]);
        expect(previewsIn(before)).toHaveLength(1);

        // Signed — and the switch left on: closed all the same.
        await owner.license.update({
          where: { id: license.id },
          data: { hipaaBaaSignedAt: new Date() },
        });
        await owner.widgetSettings.create({
          data: { licenseId: license.id, brandId: usBrand, sneakPeekEnabled: true },
        });
        expect((await usServer.get('/customer/chat', auth(token))).json().typing_preview).toBe(
          false,
        );
        const after = await captureBus(async () => {
          const response = await draft();
          expect(response.statusCode).toBe(200);
          expect(response.json()).toEqual({ typing_preview: false });
        }, [license.id]);
        expect(previewsIn(after)).toEqual([]);
      } finally {
        await usServer.close();
      }
    });
  });

  // ===========================================================================

  /**
   * The widget opens its gate the moment a person takes the chat, without the
   * socket's 30-second poll (tm 417.5): on a team or system `incoming_event`,
   * or — since neither hand-over below pushes one to the visitor — on
   * `chat_taken_over` / `chat_transferred`. These pin what reaches the visitor.
   * A queue drain's assignment pushes the visitor nothing at all; there the
   * next poll (or the agent's first reply) opens the gate.
   */
  describe('how the visitor hears the gate open', () => {
    const toVisitor = (envelopes: Envelope[], customerId: string) =>
      envelopes.filter((e) => e.audience.customerId === customerId);

    it('a takeover from the AI reaches the visitor as `chat_taken_over`, not as an event (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      await owner.thread.update({ where: { id: chat.threadId }, data: { aiMode: 'ai' } });
      expect((await server.get('/customer/chat', auth(chat.token))).json().typing_preview).toBe(
        false,
      );

      const envelopes = await captureBus(async () => {
        const seized = await server.post(`/chats/${chat.chatId}/takeover`, {}, auth(adminToken));
        expect(seized.statusCode, seized.body).toBeLessThan(300);
      });
      const heard = toVisitor(envelopes, chat.customerId);
      expect(heard.filter((e) => e.action === 'incoming_event')).toEqual([]);
      expect(heard.filter((e) => e.action === 'chat_taken_over')).toEqual([
        expect.objectContaining({ payload: expect.objectContaining({ chat_id: chat.chatId }) }),
      ]);
      expect((await server.get('/customer/chat', auth(chat.token))).json().typing_preview).toBe(
        true,
      );
    });

    it('an assignment by transfer reaches the visitor as `chat_transferred`, not as an event (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      await owner.thread.update({ where: { id: chat.threadId }, data: { aiMode: 'ai' } });
      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId, agentId: teammateId },
        data: { routingStatus: 'accepting_chats' },
      });

      const envelopes = await captureBus(async () => {
        const moved = await server.post(
          `/chats/${chat.chatId}/transfer`,
          { agent_id: teammateId },
          auth(adminToken),
        );
        expect(moved.statusCode, moved.body).toBeLessThan(300);
      });
      const heard = toVisitor(envelopes, chat.customerId);
      // The transcript's "Chat transferred" line is for everyone, but no push
      // carries it: the visitor's socket hears the transfer itself.
      expect(heard.filter((e) => e.action === 'incoming_event')).toEqual([]);
      expect(heard.filter((e) => e.action === 'chat_transferred')).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ chat_id: chat.chatId, assignee_id: teammateId }),
        }),
      ]);
      expect((await server.get('/customer/chat', auth(chat.token))).json().typing_preview).toBe(
        true,
      );
    });
  });

  // ===========================================================================

  describe('isolation', () => {
    it("never reaches another workspace's chat (FR-MOD-11.8)", async () => {
      // Tenant B has a live conversation a person holds.
      const theirs = await humanChat(fx.b);
      await owner.thread.update({
        where: { id: theirs.threadId },
        data: { assigneeId: fx.b.agentAccountId, queuePosition: null },
      });

      const visitor = await widgetToken(fx.a);
      const ours = await humanChat(fx.a);
      const envelopes = await captureBus(async () => {
        const none = await typing(visitor.token, { is_typing: true, text: 'yabanci' });
        expect(none.json()).toEqual({ typing_preview: false });
        await typing(ours.token, { is_typing: true, text: 'bizim sohbet' });
      }, [fx.a.licenseId, fx.b.licenseId]);

      const previews = previewsIn(envelopes);
      expect(previews).toHaveLength(1);
      expect(previews[0]!['licenseId']).toBe(fx.a.licenseId.toString());
      expect(previews[0]!.payload['chat_id']).toBe(ours.chatId);
    });

    it("never reaches another visitor's chat in the same workspace (FR-MOD-11.8)", async () => {
      const someoneElse = await humanChat();
      const visitor = await widgetToken();

      const envelopes = await captureBus(async () => {
        const response = await typing(visitor.token, { is_typing: true, text: 'baskasinin' });
        expect(response.json()).toEqual({ typing_preview: false });
        await typing(visitor.token, { is_typing: false });
      });
      expect(previewsIn(envelopes)).toEqual([]);
      expect(someoneElse.chatId).toBeTruthy();
    });

    it('masks a half-typed card before it leaves (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      const envelopes = await captureBus(async () => {
        await typing(chat.token, { is_typing: true, text: 'kartim 4111 1111 11' });
      });
      expect(envelopes[0]!.payload['sneak_peek']).toMatchObject({
        text: 'kartim •••• •••• ••',
      });
    });
  });

  // ===========================================================================

  describe('what it costs and leaves behind', () => {
    it('leaves no trace in the tables, Redis, the log or a query parameter (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      const before = {
        events: await owner.event.count(),
        audit: await owner.auditLogEntry.count(),
      };
      sink.lines.length = 0;
      statements.length = 0;

      const envelopes = await captureBus(async () => {
        await typing(chat.token, { is_typing: true, text: `${SENTINEL} taslak`, seq: 1 });
        await typing(chat.token, { is_typing: true, text: `${SENTINEL} taslak devam`, seq: 2 });
        await typing(chat.token, { is_typing: false, seq: 3 });
      });
      // The draft did travel — this is not a test of a gate that stayed shut.
      expect(JSON.stringify(envelopes)).toContain(SENTINEL);

      expect(await owner.event.count()).toBe(before.events);
      expect(await owner.auditLogEntry.count()).toBe(before.audit);
      expect(await owner.event.count({ where: { text: { contains: SENTINEL } } })).toBe(0);

      // Every key in this run's Redis database, read by its type.
      const redis = server.app.redis;
      let cursor = '0';
      const values: string[] = [];
      do {
        const [next, keys] = await redis.scan(cursor, 'COUNT', 500);
        cursor = next;
        for (const key of keys) {
          const type = await redis.type(key);
          values.push(key);
          if (type === 'string') values.push((await redis.get(key)) ?? '');
          else if (type === 'hash') values.push(JSON.stringify(await redis.hgetall(key)));
          else if (type === 'list') values.push(...(await redis.lrange(key, 0, -1)));
          else if (type === 'set') values.push(...(await redis.smembers(key)));
          else if (type === 'zset') values.push(...(await redis.zrange(key, 0, -1)));
          else if (type === 'stream')
            values.push(JSON.stringify(await redis.xrange(key, '-', '+')));
        }
      } while (cursor !== '0');
      expect(values.length).toBeGreaterThan(0);
      expect(values.some((value) => value.includes(SENTINEL))).toBe(false);

      // The server logged these requests at trace level — and not the draft.
      expect(sink.text).toContain('/customer/chat/typing');
      expect(sink.text).not.toContain(SENTINEL);

      // Nothing the database was asked carried it either.
      expect(statements.length).toBeGreaterThan(0);
      expect(statements.some((s) => `${s.query} ${s.params}`.includes(SENTINEL))).toBe(false);
    });

    it('costs at most four statements a request, transaction bookkeeping aside (FR-MOD-11.8)', async () => {
      const chat = await humanChat();
      await server.post(`/chats/${chat.chatId}/supervise`, undefined, auth(adminToken));
      const bookkeeping = /^(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT set_config\()/i;

      const cost = async (body: Record<string, unknown>) => {
        statements.length = 0;
        const response = await server.app.inject({
          method: 'POST',
          url: server.url('/customer/chat/typing'),
          headers: auth(chat.token),
          payload: body,
        });
        expect(response.statusCode).toBeLessThan(300);
        // Query events are emitted after the statement settles.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return statements.filter((s) => !bookkeeping.test(s.query.trim())).map((s) => s.query);
      };

      const draft = await cost({ is_typing: true, text: 'kac sorgu', seq: 1 });
      expect(draft.length, draft.join('\n')).toBeLessThanOrEqual(4);
      const clear = await cost({ is_typing: false, seq: 2 });
      expect(clear.length, clear.join('\n')).toBeLessThanOrEqual(4);

      // Closed by the AI: the licence gate's read, the connection, nothing else.
      await owner.thread.update({ where: { id: chat.threadId }, data: { aiMode: 'ai' } });
      const closed = await cost({ is_typing: true, text: 'kac sorgu', seq: 3 });
      expect(closed.length, closed.join('\n')).toBeLessThanOrEqual(2);
    });
  });
});
