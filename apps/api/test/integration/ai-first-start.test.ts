/**
 * "Önce AI" — the AI answers before anyone is assigned (tm 293.2 · SiyahTuş
 * analysis AI-11 §3, §7; owner decision K9), on real visitor messages through
 * the real server and the AI job worker.
 *
 * Until now routing assigned a visitor's connection the moment it opened. An
 * AI agent set to `ai_first` (`ai_handoff_settings.assignment_mode`) opens it
 * instead unassigned, outside the queue and in `ai` mode, and a person is
 * routed to it only when it leaves the AI. What is pinned here:
 *
 *   - the setting: its default (`parallel`, today's behaviour), its writes,
 *     and that it belongs to a customer-facing agent of the caller's own
 *     workspace; the CHECK and `AI_ASSIGNMENT_MODES` are one list;
 *   - the open: no assignee, no queue position or queue stay, no agent's
 *     concurrent-chat slot spent, the team kept, the AI view rather than the
 *     unassigned or queued ones;
 *   - the hand-over: the agent who writes to the player gets it; the AI's own
 *     hand-off and a rule bot's answer route it by today's `route()`, into the
 *     queue when nobody is free — and the wait starts then;
 *   - what does not change: a `parallel` agent's conversations, and a channel
 *     message no AI turn follows.
 */
import { PrismaClient } from '@prisma/client';
import {
  AI_ASSIGNMENT_MODES,
  readHandoffAfterHours,
  readHandoffMessages,
  readHandoffTriggers,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatService } from '../../src/services/chat/chat-service.js';
import {
  auditContextFor,
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const AI_ANSWER = 'The AI answered.';

/** The send path's idempotency cache, unused here. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

describe('the AI answers first, and a person is routed at the hand-over (AI-11 · K9)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let supportId: bigint;
  let logisticsId: bigint;
  /** The workspace owner: `chats--all`, settings, bots. In Logistics. */
  let adminToken: string;
  /** The agent: Support's one member, seeing only its team's chats. */
  let agentToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  /** One visitor message; returns once the AI job it set off has run. */
  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  /** The customer-facing agent's skills: one that answers everything, unless told otherwise. */
  async function skill(
    steps: object[] = [{ type: 'send_message', source: 'text', text: AI_ANSWER }],
  ) {
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Skill',
        kind: 'ai_agent',
        steps: steps as object,
        active: true,
        updatedAt: new Date(),
      },
    });
  }

  const putMode = (mode: string, token = adminToken, id = aiAgentId) =>
    server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${id}/handoff-settings`),
      payload: { assignment_mode: mode },
      headers: auth(token),
    });

  async function aiFirst(): Promise<void> {
    const response = await putMode('ai_first');
    expect(response.statusCode).toBe(200);
  }

  const thread = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: {
        assigneeId: true,
        queuePosition: true,
        queuedAt: true,
        aiMode: true,
        groupId: true,
      },
    });
  const viewIds = async (view: string, token = adminToken): Promise<string[]> => {
    const response = await server.get(`/chats?view=${view}`, auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);
  };
  const botTexts = async (chatId: string) =>
    (
      await owner.event.findMany({
        where: { chatId, authorType: 'bot' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      })
    ).map((e) => e.text);
  const modeNotes = async (threadId: string) =>
    (
      await owner.event.findMany({
        where: { threadId, properties: { path: ['system_event'], equals: 'ai_mode_changed' } },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      })
    ).map((e) => e.text);
  const lastAssignedAt = async (agentId: string) =>
    (
      await owner.agentMembership.findUniqueOrThrow({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId } },
        select: { lastAssignedAt: true },
      })
    ).lastAssignedAt;

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
    await clearRateLimits(server.app);
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
    // Two teams and no routing rules: `route()` takes the first team (by id),
    // Support, whose one member is the agent; the owner is Logistics'.
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    logisticsId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Logistics' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.createMany({
      data: [
        { licenseId: fx.a.licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
        { licenseId: fx.a.licenseId, groupId: logisticsId, agentId: fx.a.ownerAccountId },
      ],
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents-bot--all:rw'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:rw'],
    });
  });

  // --- The setting ------------------------------------------------------------

  describe('the assignment mode setting', () => {
    it('keeps the CHECK and AI_ASSIGNMENT_MODES one list', async () => {
      const [row] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'ai_handoff_settings_assignment_mode_check'`;
      const listed = [...row!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort();
      expect(listed).toEqual([...AI_ASSIGNMENT_MODES].sort());
    });

    it('reads `parallel` for an agent nobody configured, and keeps what is written', async () => {
      const read = () => server.get(`/ai-agents/${aiAgentId}/handoff-settings`, auth(adminToken));
      expect((await read()).json()).toEqual({
        ai_agent_id: aiAgentId,
        assignment_mode: 'parallel',
        ai_stall_timeout_seconds: 60,
        no_answer: {
          policy_by_category: {
            money: 'handoff',
            account: 'handoff',
            bonus: 'handoff',
            rg: 'handoff',
            other: 'ask',
          },
          text: null,
        },
        // The hand-over triggers, messages and after-hours text (tm 303.1): the defaults.
        triggers: readHandoffTriggers(null),
        messages: readHandoffMessages(null),
        after_hours: readHandoffAfterHours(null),
        // The default "resolved" criteria (tm 303.4): none, the platform's.
        resolution_criteria: null,
      });

      const written = await putMode('ai_first');
      expect(written.statusCode).toBe(200);
      expect(written.json()).toEqual({
        ai_agent_id: aiAgentId,
        assignment_mode: 'ai_first',
        ai_stall_timeout_seconds: 60,
        no_answer: {
          policy_by_category: {
            money: 'handoff',
            account: 'handoff',
            bonus: 'handoff',
            rg: 'handoff',
            other: 'ask',
          },
          text: null,
        },
        // The hand-over triggers, messages and after-hours text (tm 303.1): the defaults.
        triggers: readHandoffTriggers(null),
        messages: readHandoffMessages(null),
        after_hours: readHandoffAfterHours(null),
        // The default "resolved" criteria (tm 303.4): none, the platform's.
        resolution_criteria: null,
      });
      expect((await read()).json()).toMatchObject({ assignment_mode: 'ai_first' });

      // A second write updates the one row; the database keeps the time.
      const before = await owner.aiHandoffSettings.findUniqueOrThrow({
        where: { aiAgentId },
      });
      expect((await putMode('parallel')).json()).toMatchObject({ assignment_mode: 'parallel' });
      const after = await owner.aiHandoffSettings.findUniqueOrThrow({ where: { aiAgentId } });
      expect(after.assignmentMode).toBe('parallel');
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
      expect(await owner.aiHandoffSettings.count()).toBe(1);
    });

    it('refuses a mode that does not exist, and a field it does not know', async () => {
      expect((await putMode('later')).statusCode).toBe(400);
      const extra = await server.app.inject({
        method: 'PUT',
        url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
        payload: { assignment_mode: 'ai_first', stall_seconds: 5 },
        headers: auth(adminToken),
      });
      expect(extra.statusCode).toBe(400);
      expect(await owner.aiHandoffSettings.count()).toBe(0);
    });

    it('belongs to a customer-facing agent of the caller’s own workspace', async () => {
      const copilot = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Copilot', kind: 'copilot', active: true },
        select: { id: true },
      });
      const elsewhere = await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, name: 'Other', kind: 'ai_agent', active: true },
        select: { id: true },
      });
      for (const id of [copilot.id, elsewhere.id]) {
        expect((await putMode('ai_first', adminToken, id)).statusCode).toBe(404);
        expect(
          (await server.get(`/ai-agents/${id}/handoff-settings`, auth(adminToken))).statusCode,
        ).toBe(404);
      }
      expect(await owner.aiHandoffSettings.count()).toBe(0);

      // Nor can a write under one licence name another licence's agent — the
      // trigger holds the row to its own workspace, past the foreign key.
      // Raw, so the database's own message survives (Prisma's model API reports
      // any 23503 as a bare "foreign key constraint violated").
      await expect(
        owner.$executeRaw`
          INSERT INTO ai_handoff_settings (ai_agent_id, license_id, assignment_mode)
          VALUES (${elsewhere.id}::uuid, ${fx.a.licenseId}, 'ai_first')`,
      ).rejects.toThrow(/is not this workspace's/);
    });

    it('is written only with the agents write scope', async () => {
      const reader = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents-bot--all:ro'],
      });
      expect(
        (await server.get(`/ai-agents/${aiAgentId}/handoff-settings`, auth(reader))).statusCode,
      ).toBe(200);
      expect((await putMode('ai_first', reader)).statusCode).toBe(403);
    });
  });

  // --- The open ---------------------------------------------------------------

  describe('a visitor’s connection opening AI-first', () => {
    it('opens unassigned, outside the queue, in `ai` mode and in its team — the AI view’s, not a person’s', async () => {
      await skill();
      await aiFirst();

      const { chatId, threadId } = await send(await visitor(), 'Hello there');

      expect(await botTexts(chatId)).toEqual([AI_ANSWER]);
      expect(await thread(threadId)).toEqual({
        assigneeId: null,
        queuePosition: null,
        queuedAt: null,
        aiMode: 'ai',
        groupId: supportId,
      });
      // Nobody is waiting for a person, so no wait is on record, and no agent
      // was chosen — not even by the tie-break's clock.
      expect(await owner.queueEntry.count({ where: { threadId } })).toBe(0);
      expect(await lastAssignedAt(fx.a.agentAccountId)).toBeNull();
      // Its team can see it: the access row is written as on any open.
      expect(
        (await owner.chatAccess.findMany({ where: { chatId }, select: { groupId: true } })).map(
          (a) => a.groupId,
        ),
      ).toEqual([supportId]);

      expect(await viewIds('ai')).toEqual([chatId]);
      expect(await viewIds('ai', agentToken)).toEqual([chatId]);
      expect(await viewIds('unassigned')).not.toContain(chatId);
      expect(await viewIds('queued')).not.toContain(chatId);
      expect(await viewIds('my', agentToken)).not.toContain(chatId);
    });

    it('is in the AI view from the moment it opens, and stays there while the AI asks whether to hand over', async () => {
      // A skill that matches nothing here: no skill answers, the knowledge
      // base is empty, and the AI says so — asking, for a question about
      // nothing in particular, whether to hand over (tm 298 · AI-06-S1).
      await skill([
        { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
        { type: 'send_message', source: 'text', text: AI_ANSWER },
      ]);
      await aiFirst();

      const { chatId, threadId } = await send(await visitor(), 'Hello there');

      expect(await botTexts(chatId)).toEqual([
        'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarayım mı?',
      ]);
      expect((await thread(threadId)).aiMode).toBe('ai');
      expect(await viewIds('ai')).toEqual([chatId]);
      expect(await viewIds('unassigned')).not.toContain(chatId);
    });

    it('spends no concurrent-chat slot: an agent at a limit of one still takes the next routed chat', async () => {
      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { concurrentChatsLimit: 1 },
      });
      await skill();
      await aiFirst();

      const opened = [await send(await visitor(), 'One'), await send(await visitor(), 'Two')];
      for (const { threadId } of opened) {
        expect((await thread(threadId)).assigneeId).toBeNull();
      }

      // Back to assigning on open: the agent's one slot is still free.
      expect((await putMode('parallel')).statusCode).toBe(200);
      const routed = await send(await visitor(), 'Three');
      expect((await thread(routed.threadId)).assigneeId).toBe(fx.a.agentAccountId);
    });

    it('opens as it always has for a `parallel` agent — the default', async () => {
      await skill();

      const { chatId, threadId } = await send(await visitor(), 'Hello there');

      expect(await botTexts(chatId)).toEqual([AI_ANSWER]);
      expect(await thread(threadId)).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        queuePosition: null,
        // The AI's first turn made it `ai`, beside the agent routing gave it.
        aiMode: 'ai',
        groupId: supportId,
      });
      expect(await viewIds('my', agentToken)).toEqual([chatId]);
    });

    it('routes on open when no agent would answer, whatever the setting says', async () => {
      // An agent with nothing to run answers nobody; holding the chat back
      // from a person for it would leave the visitor alone.
      await aiFirst();

      const { threadId } = await send(await visitor(), 'Hello there');

      expect(await thread(threadId)).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        aiMode: null,
      });
    });

    it('routes a channel message on open: no AI turn follows it', async () => {
      await skill();
      await aiFirst();
      const appRole = new PrismaClient({
        datasources: { db: { url: process.env['DATABASE_APP_URL']! } },
      });
      try {
        const customer = await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: 'From WhatsApp' },
          select: { id: true },
        });
        // The channel path's call (`channel-service.ts`): no `aiAnswers`.
        const opened = await new ChatService(appRole, NO_REDIS).openOrContinueConnection(
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
          {
            kind: 'customer',
            customerId: customer.id,
            organizationId: fx.a.organizationId,
            licenseId: fx.a.licenseId,
          },
          {
            customerId: customer.id,
            event: { type: 'message', text: 'Hello from the phone', recipients: 'all' },
            audit: auditContextFor(fx.a, { actorId: customer.id, actorType: 'customer' }),
          },
        );
        expect(await thread(opened.event.thread_id)).toMatchObject({
          assigneeId: fx.a.agentAccountId,
          aiMode: null,
        });
      } finally {
        await appRole.$disconnect();
      }
    });
  });

  // --- The hand-over ----------------------------------------------------------

  describe('routing at the hand-over', () => {
    it('gives the connection to the agent who writes to the player, and the AI falls silent (AI-11-S2)', async () => {
      await skill();
      await aiFirst();
      const headers = await visitor();
      const { chatId, threadId } = await send(headers, 'Hello there');

      // An internal note is not writing to the player: nothing moves.
      const note = await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'Watching this one', recipients: 'agents' },
        auth(adminToken),
      );
      expect(note.statusCode).toBe(201);
      expect(await thread(threadId)).toMatchObject({ assigneeId: null, aiMode: 'ai' });

      const reply = await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'Hi, Dana here.', recipients: 'all' },
        auth(adminToken),
      );
      expect(reply.statusCode).toBe(201);

      // The writer has it — not whoever routing would have picked (the agent).
      expect(await thread(threadId)).toMatchObject({
        assigneeId: fx.a.ownerAccountId,
        queuePosition: null,
        aiMode: 'human',
      });
      expect(await lastAssignedAt(fx.a.ownerAccountId)).not.toBeNull();
      expect(await modeNotes(threadId)).toEqual(['AI stopped: an agent replied']);
      expect(await viewIds('ai')).not.toContain(chatId);
      expect(await viewIds('my')).toEqual([chatId]);

      await send(headers, 'Thanks!');
      expect(await botTexts(chatId)).toEqual([AI_ANSWER]);
    });

    it('routes the AI’s own hand-off to someone in the team it named', async () => {
      await skill([
        { type: 'detect_intent', intent: 'human', phrases: ['human'] },
        { type: 'transfer_to_team', group: 'Logistics' },
      ]);
      await aiFirst();

      const { chatId, threadId } = await send(await visitor(), 'I want a human please');

      expect(await thread(threadId)).toMatchObject({
        assigneeId: fx.a.ownerAccountId,
        queuePosition: null,
        aiMode: 'human',
        groupId: logisticsId,
      });
      expect(await modeNotes(threadId)).toEqual(['AI handed the chat over']);
      expect(await viewIds('my')).toEqual([chatId]);
      expect(await viewIds('ai')).not.toContain(chatId);
    });

    it('routes a connection a rule bot answered, by the rules it opened under', async () => {
      await skill();
      await aiFirst();
      const bot = await server.post(
        '/settings/bots',
        { name: 'FAQ', groups: [{ group_id: Number(supportId), priority: 'normal' }] },
        auth(adminToken),
      );
      expect(bot.statusCode).toBe(201);
      const rule = await server.post(
        `/settings/bots/${(bot.json() as { id: string }).id}/rules`,
        {
          name: 'Hours',
          conditions: { message_word: 'hours' },
          actions: { send_message: 'We are open 09:00-18:00.' },
        },
        auth(adminToken),
      );
      expect(rule.statusCode).toBe(201);

      const headers = await visitor();
      const { chatId, threadId } = await send(headers, 'Hello there');
      expect((await thread(threadId)).assigneeId).toBeNull();

      await send(headers, 'what are your hours?');

      expect(await botTexts(chatId)).toEqual([AI_ANSWER, 'We are open 09:00-18:00.']);
      expect(await thread(threadId)).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        aiMode: 'human',
        groupId: supportId,
      });
    });

    it('queues a hand-over nobody can take, and the wait starts at the hand-over (RP-04)', async () => {
      // The owner is Logistics' only member and is full.
      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId },
        },
        data: { concurrentChatsLimit: 1 },
      });
      const busy = await server.post(
        '/chats',
        {
          customer_id: fx.a.customerId,
          assign_to_me: true,
          initial_event: { type: 'message', text: 'Following up.' },
        },
        auth(adminToken),
      );
      expect(busy.statusCode).toBe(201);
      await skill([
        { type: 'detect_intent', intent: 'human', phrases: ['human'] },
        { type: 'transfer_to_team', group: 'Logistics' },
      ]);
      await aiFirst();

      const headers = await visitor();
      const { chatId, threadId } = await send(headers, 'Hello there');
      const handedOverAfter = new Date();
      await send(headers, 'A human please');

      const handedOver = await thread(threadId);
      expect(handedOver).toMatchObject({
        assigneeId: null,
        queuePosition: 1,
        aiMode: 'human',
        groupId: logisticsId,
      });
      const [stay] = await owner.queueEntry.findMany({
        where: { threadId },
        select: { groupId: true, enteredAt: true, leftAt: true },
      });
      expect(stay).toMatchObject({ groupId: logisticsId, leftAt: null });
      expect(stay!.enteredAt.getTime()).toBeGreaterThanOrEqual(handedOverAfter.getTime());
      expect(await viewIds('queued')).toContain(chatId);
      expect(await viewIds('ai')).not.toContain(chatId);
    });
  });
});
