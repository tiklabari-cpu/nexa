/**
 * A person gives a connection back to the AI, or holds the AI back on it
 * (tm 293.3 · SiyahTuş analysis AI-11 §1, §6; AI-11-S3), on real visitor
 * messages through the real server and the AI job worker.
 *
 * Until now nothing could undo a hand-over: once a person had the connection
 * the AI stayed silent for good, and there was no way to stop the AI short of
 * taking the conversation. What is pinned here:
 *
 *   - `return-to-ai`: the AI answers again from the next visitor message, and
 *     the person's note reaches the model with the conversation (an internal
 *     note still does not); `resume: 'fresh'` ends the procedure the AI was in
 *     and keeps what it collected; already the AI's is a no-op;
 *   - `pause-ai`: no model call and no bot message until it is given back;
 *     a connection the AI is not answering cannot be paused;
 *   - who may: the assignee, or an admin or owner — a team member who can see
 *     a colleague's chat cannot hand it to the AI (403), a bot token is not a
 *     person (404, the agent-only gate); nothing is written on a refusal;
 *   - the risk flags that keep a connection with a person (409, whoever asks);
 *   - AI-first: the hand-back leaves the assignee and the queue, frees the
 *     agent's slot for the queue, and makes the caller its supervisor.
 */
import type { PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU.';
const MODEL_ANSWER = 'Delivery takes three to five working days.';
/** Matches the knowledge skill below: every one of these asks the model. */
const QUESTION = 'How long does delivery take?';
const HAND_BACK_NOTE = 'Order 4411 is verified; quote the EU delivery window.';

describe('giving a connection back to the AI, and holding the AI back (AI-11 §1, §6)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let supportId: bigint;
  /** The workspace owner: `chats--all`, any chat. In Logistics. */
  let adminToken: string;
  /** The agent routing gives Support's chats to. */
  let agentToken: string;
  /** A second Support member, not accepting chats: sees the agent's chats, holds none. */
  let colleagueId: string;
  let colleagueToken: string;
  const model = new FakeLlmProvider({ reply: MODEL_ANSWER });

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

  async function writes(
    chatId: string,
    text: string,
    token = agentToken,
    recipients: 'all' | 'agents' = 'all',
  ): Promise<void> {
    const response = await server.post(
      `/chats/${chatId}/events`,
      { type: 'message', text, recipients },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
  }

  const returnToAi = (chatId: string, body: object = {}, token = agentToken) =>
    server.post(`/chats/${chatId}/return-to-ai`, body, auth(token));
  const pauseAi = (chatId: string, body: object = {}, token = agentToken) =>
    server.post(`/chats/${chatId}/pause-ai`, body, auth(token));

  async function knowledgeSkill(): Promise<string> {
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
        type: 'article',
        name: 'Delivery',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
      source.id,
      fx.a.licenseId.toString(),
      PASSAGE,
      toVectorLiteral(embed(PASSAGE)),
    );
    const skill = await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Delivery',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
          { type: 'send_message', source: 'knowledge' },
        ] as object,
        active: true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    return skill.id;
  }

  async function aiFirst(): Promise<void> {
    const response = await server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
      payload: { assignment_mode: 'ai_first' },
      headers: auth(adminToken),
    });
    expect(response.statusCode).toBe(200);
  }

  /** A parallel-mode connection the agent took from the AI by writing to the player. */
  async function takenByAgent() {
    await knowledgeSkill();
    const headers = await visitor();
    const opened = await send(headers, QUESTION);
    expect(model.calls).toHaveLength(1);
    await writes(opened.chatId, 'Let me check your order.');
    expect((await thread(opened.threadId)).aiMode).toBe('human');
    return { ...opened, headers };
  }

  const thread = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { assigneeId: true, queuePosition: true, aiMode: true },
    });
  const botTexts = async (chatId: string) =>
    (
      await owner.event.findMany({
        where: { chatId, authorType: 'bot' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      })
    ).map((e) => e.text);
  const modeNotes = (threadId: string) =>
    owner.event.findMany({
      where: {
        threadId,
        type: 'system_message',
        properties: { path: ['system_event'], equals: 'ai_mode_changed' },
      },
      orderBy: { createdAt: 'asc' },
      select: { text: true, recipients: true, authorType: true, authorId: true, properties: true },
    });
  const audits = (action: string) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action },
      select: { actorId: true, target: true, metadata: true },
    });
  const viewIds = async (view: string, token: string): Promise<string[]> => {
    const response = await server.get(`/chats?view=${view}`, auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);
  };
  const flag = (threadId: string, flags: string[]) =>
    owner.$executeRaw`
      UPDATE ai_conversations SET signals = jsonb_build_object('risk_flags', ${JSON.stringify(flags)}::jsonb)
       WHERE thread_id = ${threadId}`;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { llm: model });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    model.reset();
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    // Support (the first team by id, where `route()` sends a visitor) has the
    // agent and the colleague; the owner is Logistics'.
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    const logistics = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Logistics' },
      select: { id: true },
    });
    colleagueId = (
      await owner.account.create({
        data: { email: `colleague-${Date.now()}@example.test`, name: 'Colleague' },
        select: { id: true },
      })
    ).id;
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: colleagueId,
        role: 'agent',
        routingStatus: 'not_accepting_chats',
      },
    });
    await owner.groupAgent.createMany({
      data: [
        { licenseId: fx.a.licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
        { licenseId: fx.a.licenseId, groupId: supportId, agentId: colleagueId },
        { licenseId: fx.a.licenseId, groupId: logistics.id, agentId: fx.a.ownerAccountId },
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
    colleagueToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: colleagueId,
      scopes: ['chats--access:rw'],
    });
  });

  // --- return-to-ai -----------------------------------------------------------

  describe('return-to-ai', () => {
    it('gives the connection back: the AI answers the next message, with the person’s note and without the internal one', async () => {
      const { chatId, threadId, headers } = await takenByAgent();
      // Handed over, the AI stays silent (tm 293.1).
      await send(headers, QUESTION);
      expect(model.calls).toHaveLength(1);
      await writes(chatId, 'Internal: refund pending', agentToken, 'agents');

      const response = await returnToAi(chatId, { note: HAND_BACK_NOTE });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        chat_id: chatId,
        thread_id: threadId,
        ai_mode: 'ai',
        previous_ai_mode: 'human',
        changed: true,
        // Parallel: the agent keeps the chat beside the AI, as on open.
        assignee_id: fx.a.agentAccountId,
      });
      expect(await thread(threadId)).toMatchObject({
        aiMode: 'ai',
        assigneeId: fx.a.agentAccountId,
      });
      expect(await owner.aiConversation.findFirst({ where: { threadId } })).toMatchObject({
        mode: 'ai',
        modeReason: 'return_to_ai',
        modeChangedBy: fx.a.agentAccountId,
      });
      const notes = await modeNotes(threadId);
      expect(notes.at(-1)).toEqual({
        text: `AI answering again. Note: ${HAND_BACK_NOTE}`,
        recipients: 'agents',
        authorType: 'system',
        authorId: fx.a.agentAccountId,
        properties: {
          system_event: 'ai_mode_changed',
          ai_mode: 'ai',
          previous_ai_mode: 'human',
          reason: 'return_to_ai',
          resume: 'continue',
        },
      });
      expect(await audits('chat.ai_returned')).toEqual([
        {
          actorId: fx.a.agentAccountId,
          target: `chat:${chatId}`,
          metadata: {
            thread_id: threadId,
            previous_ai_mode: 'human',
            resume: 'continue',
            request_id: expect.any(String),
          },
        },
      ]);
      // Parallel: nobody is made a supervisor — the agent is still the assignee.
      expect(await owner.chatSupervision.count()).toBe(0);

      await send(headers, QUESTION);
      expect(model.calls).toHaveLength(2);
      expect(await botTexts(chatId)).toEqual([MODEL_ANSWER, MODEL_ANSWER]);
      const prompt = JSON.stringify(model.calls[1]);
      expect(prompt).toContain(HAND_BACK_NOTE);
      expect(prompt).not.toContain('refund pending');
    });

    it('ends the procedure the AI was in on `fresh`, keeping what it collected; `continue` keeps both', async () => {
      const skillId = await knowledgeSkill();
      const headers = await visitor();
      const procedure = {
        active_skill_id: skillId,
        step_id: 'ask_order',
        step_status: 'awaiting_answer',
      };
      const setProcedure = (threadId: string) =>
        owner.$executeRaw`
          UPDATE ai_conversations
             SET active_skill_id = ${procedure.active_skill_id}::uuid, step_id = ${procedure.step_id},
                 step_status = ${procedure.step_status}, slots = '{"order": "4411"}'::jsonb
           WHERE thread_id = ${threadId}`;
      const state = (threadId: string) =>
        owner.aiConversation.findFirstOrThrow({
          where: { threadId },
          select: { activeSkillId: true, stepId: true, stepStatus: true, slots: true },
        });

      const { chatId, threadId } = await send(headers, QUESTION);
      await setProcedure(threadId);
      await writes(chatId, 'One moment.');
      expect((await returnToAi(chatId, { resume: 'continue' })).statusCode).toBe(200);
      expect(await state(threadId)).toEqual({
        activeSkillId: skillId,
        stepId: 'ask_order',
        stepStatus: 'awaiting_answer',
        slots: { order: '4411' },
      });

      await writes(chatId, 'Another moment.');
      const fresh = await returnToAi(chatId, { resume: 'fresh' });
      expect(fresh.statusCode).toBe(200);
      expect(await state(threadId)).toEqual({
        activeSkillId: null,
        stepId: null,
        stepStatus: null,
        slots: { order: '4411' },
      });
      expect((await modeNotes(threadId)).at(-1)?.properties).toMatchObject({ resume: 'fresh' });
    });

    it('changes nothing on a connection that is already the AI’s', async () => {
      await knowledgeSkill();
      const { chatId, threadId } = await send(await visitor(), QUESTION);
      const before = await owner.aiConversation.findFirstOrThrow({ where: { threadId } });

      const response = await returnToAi(chatId);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ai_mode: 'ai',
        previous_ai_mode: 'ai',
        changed: false,
      });
      expect(await modeNotes(threadId)).toEqual([]);
      expect(await audits('chat.ai_returned')).toEqual([]);
      const after = await owner.aiConversation.findFirstOrThrow({ where: { threadId } });
      expect(after.version).toBe(before.version);
    });

    it('validates the body: an unknown resume and an over-long note are 400s', async () => {
      const { chatId, threadId } = await takenByAgent();
      expect((await returnToAi(chatId, { resume: 'later' })).statusCode).toBe(400);
      expect((await returnToAi(chatId, { note: 'x'.repeat(501) })).statusCode).toBe(400);
      expect((await thread(threadId)).aiMode).toBe('human');
    });
  });

  // --- pause-ai ---------------------------------------------------------------

  describe('pause-ai', () => {
    it('holds the AI back — no model call, no bot message — until it is given back', async () => {
      await knowledgeSkill();
      const headers = await visitor();
      const { chatId, threadId } = await send(headers, QUESTION);
      expect(model.calls).toHaveLength(1);

      const paused = await pauseAi(chatId, { note: 'Checking with finance first' });

      expect(paused.statusCode).toBe(200);
      expect(paused.json()).toEqual({
        chat_id: chatId,
        thread_id: threadId,
        ai_mode: 'paused',
        previous_ai_mode: 'ai',
        changed: true,
        assignee_id: fx.a.agentAccountId,
      });
      // Nobody is routed and the assignment stays.
      expect(await thread(threadId)).toMatchObject({
        aiMode: 'paused',
        assigneeId: fx.a.agentAccountId,
      });
      expect((await modeNotes(threadId)).map((n) => n.text)).toEqual([
        'AI paused. Note: Checking with finance first',
      ]);
      expect(await audits('chat.ai_paused')).toEqual([
        {
          actorId: fx.a.agentAccountId,
          target: `chat:${chatId}`,
          metadata: { thread_id: threadId, previous_ai_mode: 'ai', request_id: expect.any(String) },
        },
      ]);

      await send(headers, QUESTION);
      await send(headers, 'Hello? Still there?');
      expect(model.calls).toHaveLength(1);
      expect(await botTexts(chatId)).toEqual([MODEL_ANSWER]);

      // A second pause is a no-op.
      const again = await pauseAi(chatId);
      expect(again.json()).toMatchObject({ ai_mode: 'paused', changed: false });
      expect(await modeNotes(threadId)).toHaveLength(1);

      // A paused connection goes back like a human one.
      const back = await returnToAi(chatId);
      expect(back.json()).toMatchObject({ ai_mode: 'ai', previous_ai_mode: 'paused' });
      await send(headers, QUESTION);
      expect(model.calls).toHaveLength(2);
    });

    it('refuses to pause a connection the AI is not answering (409)', async () => {
      const { chatId, threadId } = await takenByAgent();
      const human = await pauseAi(chatId);
      expect(human.statusCode).toBe(409);
      expect(human.json()).toMatchObject({ error: { type: 'ai_mode_transition_refused' } });
      expect((await thread(threadId)).aiMode).toBe('human');

      // One the AI has not spoken in yet.
      const quiet = await send(await visitor(), 'Hello there');
      expect((await thread(quiet.threadId)).aiMode).toBeNull();
      const none = await pauseAi(quiet.chatId);
      expect(none.statusCode).toBe(409);
      expect(none.json()).toMatchObject({ error: { type: 'ai_mode_transition_refused' } });
      expect(await audits('chat.ai_paused')).toEqual([]);
    });
  });

  // --- Who may ----------------------------------------------------------------

  describe('who may (AI-11-S3)', () => {
    it('refuses a team member another agent’s chat (403), and writes nothing', async () => {
      const { chatId, threadId } = await takenByAgent();
      const notesBefore = (await modeNotes(threadId)).length;
      // The colleague can see it — the refusal is about whose it is.
      expect((await server.get(`/chats/${chatId}`, auth(colleagueToken))).statusCode).toBe(200);

      const refused = await returnToAi(chatId, { note: HAND_BACK_NOTE }, colleagueToken);
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: { type: 'authorization' } });
      expect((await pauseAi(chatId, {}, colleagueToken)).statusCode).toBe(403);

      expect((await thread(threadId)).aiMode).toBe('human');
      expect(await modeNotes(threadId)).toHaveLength(notesBefore);
      expect(await audits('chat.ai_returned')).toEqual([]);
    });

    it('lets an admin or owner give back any chat they can reach', async () => {
      const { chatId, threadId } = await takenByAgent();
      const response = await returnToAi(chatId, {}, adminToken);
      expect(response.statusCode).toBe(200);
      expect((await thread(threadId)).aiMode).toBe('ai');
      expect((await audits('chat.ai_returned'))[0]?.actorId).toBe(fx.a.ownerAccountId);
    });

    it('refuses a bot token, a chat of another workspace and a closed chat', async () => {
      const { chatId, threadId } = await takenByAgent();
      const botToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: aiAgentId,
        scopes: ['chats--all:rw'],
        kind: 'bot',
      });
      // Not a person: the agent-only gate answers as for any route it may not reach.
      expect((await returnToAi(chatId, {}, botToken)).statusCode).toBe(404);
      expect((await pauseAi(chatId, {}, botToken)).statusCode).toBe(404);

      const elsewhere = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      expect((await returnToAi(chatId, {}, elsewhere)).statusCode).toBe(404);
      expect((await thread(threadId)).aiMode).toBe('human');

      const closed = await server.post(`/chats/${chatId}/deactivate`, {}, auth(adminToken));
      expect(closed.statusCode).toBe(200);
      const late = await returnToAi(chatId, {}, adminToken);
      expect(late.statusCode).toBe(409);
      expect(late.json()).toMatchObject({ error: { type: 'chat_inactive' } });
    });
  });

  // --- The risk flags ---------------------------------------------------------

  describe('the risk flags that keep a connection with a person', () => {
    it('refuses each of them with 409 ai_return_blocked, whoever asks; another flag does not block', async () => {
      const { chatId, threadId } = await takenByAgent();

      for (const blocking of [
        'rg_signal',
        'self_exclusion_request',
        'underage_suspected',
        'self_harm',
      ]) {
        await flag(threadId, ['complaint_formal', blocking]);
        for (const token of [agentToken, adminToken]) {
          const refused = await returnToAi(chatId, {}, token);
          expect(refused.statusCode, blocking).toBe(409);
          expect(refused.json()).toMatchObject({
            error: { type: 'ai_return_blocked', details: { risk_flags: [blocking] } },
          });
        }
      }
      expect((await thread(threadId)).aiMode).toBe('human');
      expect(await audits('chat.ai_returned')).toEqual([]);

      // Not one of them: the hand-back goes through.
      await flag(threadId, ['complaint_formal']);
      expect((await returnToAi(chatId)).statusCode).toBe(200);
      expect((await thread(threadId)).aiMode).toBe('ai');
    });

    it('answers 403 before 409: a refused caller learns nothing about the flags', async () => {
      const { chatId, threadId } = await takenByAgent();
      await flag(threadId, ['self_harm']);
      const refused = await returnToAi(chatId, {}, colleagueToken);
      expect(refused.statusCode).toBe(403);
      expect(JSON.stringify(refused.json())).not.toContain('self_harm');
    });
  });

  // --- AI-first ---------------------------------------------------------------

  describe('in an AI-first workspace', () => {
    /**
     * The agent (limit 1) holds one AI-first connection they took by writing,
     * and the AI's hand-over of a second visitor waits in Support's queue.
     */
    async function fullAgentAndQueued() {
      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { concurrentChatsLimit: 1 },
      });
      await knowledgeSkill();
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          name: 'Human',
          kind: 'ai_agent',
          steps: [
            { type: 'detect_intent', intent: 'human', phrases: ['human'] },
            { type: 'transfer_to_team', group: 'Support' },
          ] as object,
          active: true,
          updatedAt: new Date(),
        },
      });
      await aiFirst();

      const held = await send(await visitor(), QUESTION);
      await writes(held.chatId, 'Let me check your order.');
      expect((await thread(held.threadId)).assigneeId).toBe(fx.a.agentAccountId);
      const waiting = await send(await visitor(), 'I want a human please');
      expect(await thread(waiting.threadId)).toMatchObject({
        assigneeId: null,
        queuePosition: 1,
        aiMode: 'human',
      });
      return { held, waiting };
    }

    it('takes the connection off its assignee and makes the caller its supervisor; the next hand-over routes it again', async () => {
      await knowledgeSkill();
      await aiFirst();
      const headers = await visitor();
      const { chatId, threadId } = await send(headers, QUESTION);
      await writes(chatId, 'Let me check your order.');
      expect(await thread(threadId)).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        aiMode: 'human',
      });

      const response = await returnToAi(chatId, { note: HAND_BACK_NOTE });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ai_mode: 'ai', changed: true, assignee_id: null });
      expect(await thread(threadId)).toEqual({
        assigneeId: null,
        queuePosition: null,
        aiMode: 'ai',
      });
      expect(
        await owner.chatUser.findUniqueOrThrow({
          where: { chatId_userId: { chatId, userId: fx.a.agentAccountId } },
          select: { present: true },
        }),
      ).toEqual({ present: false });
      expect(
        await owner.chatSupervision.findMany({ where: { chatId }, select: { agentId: true } }),
      ).toEqual([{ agentId: fx.a.agentAccountId }]);
      expect((await audits('chat.ai_returned'))[0]?.metadata).toEqual({
        thread_id: threadId,
        previous_ai_mode: 'human',
        resume: 'continue',
        previous_assignee_id: fx.a.agentAccountId,
        request_id: expect.any(String),
      });
      expect(await viewIds('ai', agentToken)).toEqual([chatId]);
      expect(await viewIds('supervised', agentToken)).toEqual([chatId]);
      expect(await viewIds('my', agentToken)).toEqual([]);
      expect(await viewIds('unassigned', adminToken)).not.toContain(chatId);

      await send(headers, QUESTION);
      expect(model.calls).toHaveLength(2);

      // The next hand-over routes it as any AI-first connection's (tm 293.2).
      await writes(chatId, 'Back again.', adminToken);
      expect(await thread(threadId)).toMatchObject({
        assigneeId: fx.a.ownerAccountId,
        aiMode: 'human',
      });
    });

    it('frees the agent’s slot: a chat waiting in the queue goes to them', async () => {
      const { held, waiting } = await fullAgentAndQueued();

      expect((await returnToAi(held.chatId)).statusCode).toBe(200);

      expect(await thread(waiting.threadId)).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        queuePosition: null,
      });
      expect((await thread(held.threadId)).assigneeId).toBeNull();
    });

    it('takes a queued connection out of the queue, closing its stay', async () => {
      const {
        waiting: { chatId, threadId },
      } = await fullAgentAndQueued();

      const response = await returnToAi(chatId, {}, adminToken);

      expect(response.statusCode).toBe(200);
      expect(await thread(threadId)).toEqual({
        assigneeId: null,
        queuePosition: null,
        aiMode: 'ai',
      });
      expect(
        await owner.queueEntry.findMany({ where: { threadId }, select: { outcome: true } }),
      ).toEqual([{ outcome: 'transferred' }]);
      expect(await viewIds('queued', adminToken)).not.toContain(chatId);
      expect(await viewIds('ai', adminToken)).toContain(chatId);
      expect(
        await owner.chatSupervision.findMany({ where: { chatId }, select: { agentId: true } }),
      ).toEqual([{ agentId: fx.a.ownerAccountId }]);
    });
  });
});
