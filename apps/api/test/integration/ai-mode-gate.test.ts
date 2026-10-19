/**
 * Who answers a connection (tm 293.1 · SiyahTuş analysis AI-11; owner
 * decisions K9, K10), on real visitor messages through the real server and the
 * AI job worker.
 *
 * Until now the AI answered every visitor message whoever else was in the
 * chat. Each connection now has a mode (`threads.ai_mode`, mirrored on its
 * `ai_conversations` row), and what is pinned here is the part only the
 * running system can show:
 *
 *   - once a person has the connection — an agent wrote to the player, a
 *     supervisor took it over, it was transferred, the AI handed it over —
 *     every visitor message costs no model call and draws no bot message;
 *   - an agent who writes while the model is thinking wins: the connection
 *     turns `human` in the agent's own transaction and the AI's draft is not
 *     sent (the race, with the model held mid-answer);
 *   - an internal note takes nothing over; a connection the AI never spoke in
 *     changes hands without a line in the transcript;
 *   - the CHECK and `AI_CONVERSATION_MODES` are one list.
 *
 * The model is a fake the test can hold mid-answer, so "while the model was
 * thinking" is a moment the test chooses rather than a race it hopes to win.
 */
import type { PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { AI_BOT_ID, AI_CONVERSATION_MODES } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU.';
const MODEL_ANSWER = 'Delivery takes three to five working days.';
/** Matches the knowledge skill below: every one of these asks the model. */
const QUESTION = 'How long does delivery take?';

/** A one-shot latch: `open()` resolves `opened`. */
function latch(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe('the AI answers only a connection that is its own (AI-11)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let agentToken: string;
  let adminToken: string;
  /** Awaited inside the model's answer — set by a test that needs it to think for a while. */
  let thinking: (() => Promise<void>) | null = null;
  const model = new FakeLlmProvider({
    reply: MODEL_ANSWER,
    hold: async () => {
      if (thinking) await thinking();
    },
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const customerAuth = async (): Promise<Record<string, string>> => {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const { token } = response.json() as { token: string };
    return { authorization: `Bearer ${token}` };
  };

  /** One visitor message, answered: returns once the AI job it set off has run. */
  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  /** An agent's line in the chat, as the Inbox sends it. Not awaited on the AI jobs. */
  async function agentWrites(
    chatId: string,
    body: { text: string; recipients?: 'all' | 'agents' },
    token = agentToken,
  ): Promise<void> {
    const response = await server.app.inject({
      method: 'POST',
      url: server.url(`/chats/${chatId}/events`),
      payload: { type: 'message', recipients: 'all', ...body },
      headers: auth(token),
    });
    expect(response.statusCode).toBe(201);
  }

  async function seedKnowledgeSkill(): Promise<string> {
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

  const threadMode = async (threadId: string) =>
    (await owner.thread.findUniqueOrThrow({ where: { id: threadId }, select: { aiMode: true } }))
      .aiMode;
  const conversation = (threadId: string) =>
    owner.aiConversation.findFirst({ where: { threadId } });
  const botEvents = (chatId: string) =>
    owner.event.findMany({ where: { chatId, authorType: 'bot' }, select: { text: true } });
  const modeNotes = (threadId: string) =>
    owner.event.findMany({
      where: {
        threadId,
        type: 'system_message',
        properties: { path: ['system_event'], equals: 'ai_mode_changed' },
      },
      select: { text: true, recipients: true, authorType: true, authorId: true, properties: true },
      orderBy: { createdAt: 'asc' },
    });
  const decisions = () =>
    owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { decision: true, details: true },
      orderBy: { createdAt: 'asc' },
    });

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
    thinking = null;
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
    await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'Logistics' } });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--all:rw'],
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
  });

  it('keeps the CHECK and AI_CONVERSATION_MODES one list, and refuses any other mode', async () => {
    const [row] = await owner.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname = 'threads_ai_mode_check'`;
    const listed = [...row!.def.matchAll(/'([a-z]+)'::text/g)].map((m) => m[1]).sort();
    expect(listed).toEqual([...AI_CONVERSATION_MODES].sort());

    const headers = await customerAuth();
    const { threadId } = await send(headers, 'Hello');
    await expect(
      owner.$executeRaw`UPDATE threads SET ai_mode = 'bot' WHERE id = ${threadId}`,
    ).rejects.toThrow(/threads_ai_mode_check/);
  });

  it('turns the connection `ai` with the first turn the AI takes, and nothing before it', async () => {
    await seedKnowledgeSkill();
    const headers = await customerAuth();

    // No skill matched: the AI took no turn, the connection is nobody's yet.
    const first = await send(headers, 'Hello there');
    expect(await threadMode(first.threadId)).toBeNull();

    const second = await send(headers, QUESTION);
    expect(second.threadId).toBe(first.threadId);
    expect(await threadMode(first.threadId)).toBe('ai');
    expect(await botEvents(first.chatId)).toEqual([{ text: MODEL_ANSWER }]);
    // The start of the AI's part is not a change anybody needs told about.
    expect(await modeNotes(first.threadId)).toEqual([]);
  });

  it('falls silent once an agent writes to the player: no model call, no bot message, for every message after (AI-11 · K9)', async () => {
    await seedKnowledgeSkill();
    const headers = await customerAuth();
    const { chatId, threadId } = await send(headers, QUESTION);
    expect(model.calls).toHaveLength(1);
    const before = await conversation(threadId);
    expect(before).toMatchObject({ mode: 'ai', modeChangedBy: null });

    await agentWrites(chatId, { text: 'Let me check that for you.' });

    // The take-over, in the agent's own transaction: the connection, its
    // conversation row (whose version moved — the fence a running turn meets)
    // and the agents-only line that says so.
    expect(await threadMode(threadId)).toBe('human');
    const after = await conversation(threadId);
    expect(after).toMatchObject({
      mode: 'human',
      modeChangedBy: fx.a.agentAccountId,
      modeReason: 'agent_message',
    });
    expect(after!.modeChangedAt).toBeInstanceOf(Date);
    expect(after!.version).toBe(before!.version + 1);
    expect(await modeNotes(threadId)).toEqual([
      {
        text: 'AI stopped: an agent replied',
        recipients: 'agents',
        authorType: 'system',
        authorId: fx.a.agentAccountId,
        properties: {
          system_event: 'ai_mode_changed',
          ai_mode: 'human',
          previous_ai_mode: 'ai',
          reason: 'agent_message',
        },
      },
    ]);

    await send(headers, QUESTION);
    await send(headers, 'Is delivery faster for members?');

    expect(model.calls).toHaveLength(1);
    expect(await botEvents(chatId)).toEqual([{ text: MODEL_ANSWER }]);
    // A message the AI may not answer is not a turn: no record of one either.
    expect((await decisions()).map((row) => row.decision)).toEqual(['answered']);
    expect(await conversation(threadId)).toMatchObject({ version: after!.version });
  });

  it('takes nothing over with an internal note: the player never saw it', async () => {
    await seedKnowledgeSkill();
    const headers = await customerAuth();
    const { chatId, threadId } = await send(headers, QUESTION);

    await agentWrites(chatId, { text: 'VIP, be gentle', recipients: 'agents' });
    expect(await threadMode(threadId)).toBe('ai');

    await send(headers, QUESTION);
    expect(model.calls).toHaveLength(2);
    expect(await botEvents(chatId)).toHaveLength(2);
  });

  it('keeps a connection the AI never spoke in for the person who answered it, without a line in the transcript', async () => {
    const headers = await customerAuth();
    const { chatId, threadId } = await send(headers, 'Hello there');
    expect(await threadMode(threadId)).toBeNull();

    await agentWrites(chatId, { text: 'Hi, how can I help?' });
    expect(await threadMode(threadId)).toBe('human');
    expect(await modeNotes(threadId)).toEqual([]);
    // The AI never opened a conversation here, and a person answering does not.
    expect(await conversation(threadId)).toBeNull();

    // Skills arrive later in the day: this connection stays the person's.
    await seedKnowledgeSkill();
    await send(headers, QUESTION);
    expect(model.calls).toHaveLength(0);
    expect(await botEvents(chatId)).toEqual([]);
  });

  it('falls silent after a supervisor takes the chat over (AI-11 · takeover)', async () => {
    await seedKnowledgeSkill();
    const headers = await customerAuth();
    const { chatId, threadId } = await send(headers, QUESTION);

    const seized = await server.post(`/chats/${chatId}/takeover`, {}, auth(adminToken));
    expect(seized.statusCode).toBe(200);
    expect(await threadMode(threadId)).toBe('human');
    expect(await conversation(threadId)).toMatchObject({
      mode: 'human',
      modeChangedBy: fx.a.ownerAccountId,
      modeReason: 'takeover',
    });
    expect((await modeNotes(threadId)).map((note) => note.text)).toEqual([
      'AI stopped: chat taken over',
    ]);

    await send(headers, QUESTION);
    expect(model.calls).toHaveLength(1);
    expect(await botEvents(chatId)).toHaveLength(1);
  });

  it('falls silent after the AI hands the chat over itself, and stays silent (AI-11 · AI devri)', async () => {
    // Somebody accepting in the team, or the hand-over is refused for
    // stranding the player — a different rule from the one under test.
    const logistics = await owner.group.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, name: 'Logistics' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: logistics.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Hand over',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'complaint', phrases: ['complaint'] },
          { type: 'transfer_to_team', group: 'Logistics' },
        ] as object,
        active: true,
        updatedAt: new Date(),
      },
    });
    await seedKnowledgeSkill();
    const headers = await customerAuth();

    const { chatId, threadId } = await send(headers, 'I have a complaint');
    expect(await threadMode(threadId)).toBe('human');
    expect(await conversation(threadId)).toMatchObject({
      mode: 'human',
      modeChangedBy: AI_BOT_ID,
      modeReason: 'ai_handoff',
    });
    expect((await modeNotes(threadId)).map((note) => note.text)).toEqual([
      'AI handed the chat over',
    ]);

    // The hand-over's own sentence (tm 303.2 · AI-09), then nothing more.
    const handedOver = await botEvents(chatId);
    expect(handedOver).toHaveLength(1);
    await send(headers, QUESTION);
    expect(model.calls).toHaveLength(0);
    expect(await botEvents(chatId)).toEqual(handedOver);
  });

  it('turns `human` when an agent opens the chat by writing to the player', async () => {
    await seedKnowledgeSkill();
    const started = await server.post(
      '/chats',
      {
        customer_id: fx.a.customerId,
        assign_to_me: true,
        initial_event: { type: 'message', text: 'Hello from the team', recipients: 'all' },
      },
      auth(agentToken),
    );
    expect(started.statusCode).toBe(201);
    const chat = started.json() as { id: string; thread: { id: string } };
    expect(await threadMode(chat.thread.id)).toBe('human');
  });

  describe('a person who writes while the model is thinking', () => {
    /**
     * Sends `text` and, while the model is answering it, lets `meanwhile`
     * write; returns once the job has finished.
     */
    async function sendWhileThinking(
      headers: Record<string, string>,
      text: string,
      meanwhile: (ref: { chatId: string; threadId: string }) => Promise<void>,
    ) {
      const asked = latch();
      const answer = latch();
      thinking = async () => {
        asked.open();
        await answer.opened;
      };
      // Straight to `inject`: the response comes back while the job runs.
      const response = await server.app.inject({
        method: 'POST',
        url: server.url('/customer/chat/events'),
        payload: { text },
        headers,
      });
      expect(response.statusCode).toBe(201);
      const sent = response.json() as { chat_id: string; event: { thread_id: string } };
      await asked.opened;
      await meanwhile({ chatId: sent.chat_id, threadId: sent.event.thread_id });
      answer.open();
      await server.app.aiJobs.idle();
      thinking = null;
      return { chatId: sent.chat_id, threadId: sent.event.thread_id };
    }

    it('wins on the AI’s first turn: the draft is not sent and is on record as expired (AI-11 §4)', async () => {
      const skillId = await seedKnowledgeSkill();
      const headers = await customerAuth();

      const { chatId, threadId } = await sendWhileThinking(headers, QUESTION, async (ref) => {
        await agentWrites(ref.chatId, { text: 'I will take this one.' });
        expect(await threadMode(ref.threadId)).toBe('human');
      });

      expect(model.calls).toHaveLength(1);
      expect(await botEvents(chatId)).toEqual([]);
      expect(await threadMode(threadId)).toBe('human');
      // Nothing of the turn committed: no conversation opened, no run counted.
      expect(await conversation(threadId)).toBeNull();
      expect(await owner.skillRun.count({ where: { skillId } })).toBe(0);
      // Its spend is on record, as a turn overtaken before its reply went out.
      expect(await decisions()).toEqual([
        { decision: 'expired', details: expect.objectContaining({ reason: 'human_took_over' }) },
      ]);
    });

    it('wins on a later turn too, fencing the conversation row the turn read', async () => {
      const skillId = await seedKnowledgeSkill();
      const headers = await customerAuth();
      const first = await send(headers, QUESTION);
      const opened = await conversation(first.threadId);
      expect(opened).toMatchObject({ mode: 'ai', version: 1 });

      await sendWhileThinking(headers, 'And delivery to Norway?', async (ref) => {
        await agentWrites(ref.chatId, { text: 'Norway is outside the EU, let me check.' });
      });

      expect(model.calls).toHaveLength(2);
      expect(await botEvents(first.chatId)).toEqual([{ text: MODEL_ANSWER }]);
      expect(await conversation(first.threadId)).toMatchObject({
        mode: 'human',
        modeReason: 'agent_message',
        // The agent's write, and nothing of the lost turn: still one turn counted.
        version: 2,
        counters: { turns: 1 },
      });
      expect(await owner.skillRun.count({ where: { skillId } })).toBe(1);
      expect((await decisions()).map((row) => row.decision)).toEqual(['answered', 'expired']);
    });

    it('lets a reply that committed first stand, ahead of the agent’s line', async () => {
      await seedKnowledgeSkill();
      const headers = await customerAuth();
      const { chatId, threadId } = await send(headers, QUESTION);

      await agentWrites(chatId, { text: 'Anything else?' });
      const lines = await owner.event.findMany({
        where: { threadId, type: 'message' },
        orderBy: { createdAt: 'asc' },
        select: { authorType: true },
      });
      expect(lines.map((line) => line.authorType)).toEqual(['customer', 'bot', 'agent']);
      expect(await threadMode(threadId)).toBe('human');
    });
  });
});
