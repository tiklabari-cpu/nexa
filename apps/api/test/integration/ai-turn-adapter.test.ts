/**
 * The live turn adapter (tm 292.2 · SiyahTuş analysis AI-01 §6, AI-19), on
 * real customer messages through the real server and the AI job worker.
 *
 * The engine decides a turn and writes nothing; `AiResponder` applies it. What
 * is pinned here is what only the adapter can get right:
 *
 *   - the conversation row is opened by the first turn the AI takes — not by a
 *     message no skill matched — and every turn is counted on it;
 *   - the reply, the saved state and the run row commit together, and a turn
 *     whose conversation moved on while the model was thinking commits none of
 *     them: no reply, no tags, no hand-over, no run, no decision record — the
 *     writer that moved it owns what happens next;
 *   - a turn with nothing to say still saves its state, in its own transaction.
 *
 * The model is a fake the test can hold mid-answer, so "while the model was
 * thinking" is a moment the test chooses rather than a race it hopes to win.
 */
import type { PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { DEFAULT_HANDOFF_MESSAGES } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { openConversation } from '../../src/services/ai/conversation/state-store.js';
import { emptyTurnState, toTurnState } from '../../src/services/ai/conversation/turn.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU.';
const MODEL_ANSWER = 'Delivery takes three to five working days.';

/** A one-shot latch: `open()` resolves `opened`. */
function latch(): { open: () => void; opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

describe('the live turn adapter (AI-01 · AI-19)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  /** Awaited inside the model's answer — set by a test that needs it to think for a while. */
  let thinking: (() => Promise<void>) | null = null;
  const model = new FakeLlmProvider({
    reply: MODEL_ANSWER,
    hold: async () => {
      if (thinking) await thinking();
    },
  });

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
    return response.json() as { chat_id: string; event: { thread_id: string } };
  }

  async function createSkill(steps: unknown[]): Promise<string> {
    const skill = await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Delivery',
        kind: 'ai_agent',
        steps: steps as object,
        active: true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    return skill.id;
  }

  async function seedPassage(): Promise<void> {
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
  }

  const conversations = () =>
    owner.aiConversation.findMany({ where: { licenseId: fx.a.licenseId } });
  const botEvents = (chatId: string) =>
    owner.event.findMany({ where: { chatId, authorType: 'bot' }, select: { text: true } });

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
  });

  it('opens the conversation on the first turn the AI takes and counts every turn, committing each with its reply and run', async () => {
    const skillId = await createSkill([{ type: 'send_message', source: 'text', text: 'On it.' }]);
    const headers = await customerAuth();

    const first = await send(headers, 'Where is my parcel?');
    const [opened] = await conversations();
    expect(opened).toMatchObject({
      chatId: first.chat_id,
      threadId: first.event.thread_id,
      mode: 'ai',
      counters: { turns: 1 },
      // Opened at 0, saved once by the turn's commit.
      version: 1,
      configVersionId: null,
    });

    const second = await send(headers, 'Any news?');
    expect(second.event.thread_id).toBe(first.event.thread_id);
    const rows = await conversations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: opened!.id, counters: { turns: 2 }, version: 2 });

    expect(await botEvents(first.chat_id)).toEqual([{ text: 'On it.' }, { text: 'On it.' }]);
    expect(await owner.skillRun.count({ where: { skillId } })).toBe(2);
    const skill = await owner.skill.findUnique({ where: { id: skillId } });
    expect(skill?.runsCount).toBe(2);
    const decisions = await owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { decision: true, configVersionId: true },
    });
    expect(decisions).toEqual([
      { decision: 'answered', configVersionId: null },
      { decision: 'answered', configVersionId: null },
    ]);
  });

  it('opens nothing for a message no skill matched, and nothing in a workspace without skills', async () => {
    const headers = await customerAuth();
    await send(headers, 'Hello there');
    expect(await conversations()).toHaveLength(0);

    await createSkill([
      { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
      { type: 'send_message', source: 'text', text: 'Refunds take 5 days.' },
    ]);
    await send(headers, 'Hello again');
    expect(await conversations()).toHaveLength(0);
    expect(await owner.skillRun.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('saves a turn with nothing to say in its own transaction, then applies the hand-over', async () => {
    const skillId = await createSkill([
      { type: 'tag', tag: 'shipping' },
      { type: 'transfer_to_team', group: 'Logistics' },
    ]);
    const headers = await customerAuth();

    const sent = await send(headers, 'I need help');

    // Nothing of the skill's — the hand-over's own sentence (tm 303.2 · AI-09).
    expect((await botEvents(sent.chat_id)).map((event) => event.text)).toEqual([
      DEFAULT_HANDOFF_MESSAGES.procedure_rule.tr,
    ]);
    expect(await conversations()).toEqual([
      expect.objectContaining({ counters: { turns: 1 }, version: 1 }),
    ]);
    expect(await owner.skillRun.count({ where: { skillId } })).toBe(1);
    const logistics = await owner.group.findFirst({
      where: { licenseId: fx.a.licenseId, name: 'Logistics' },
      select: { id: true },
    });
    const access = await owner.chatAccess.findMany({ where: { chatId: sent.chat_id } });
    expect(access.map((row) => row.groupId)).toContain(logistics!.id);
  });

  describe('a turn whose conversation moved on while the model was thinking', () => {
    const STEPS = [
      { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
      { type: 'tag', tag: 'delivery' },
      { type: 'send_message', source: 'knowledge' },
      { type: 'transfer_to_team', group: 'Logistics' },
    ];

    /** Where routing has the chat: its teams and the connection's team — what a hand-over moves. */
    async function routing(chatId: string) {
      const access = await owner.chatAccess.findMany({
        where: { chatId },
        select: { groupId: true },
      });
      const threads = await owner.thread.findMany({ where: { chatId }, select: { groupId: true } });
      return {
        access: access.map((row) => String(row.groupId)).sort(),
        threads: threads.map((row) => String(row.groupId)),
      };
    }

    /**
     * Sends `text` and, while the model is answering it, lets `meanwhile` write
     * to the conversation; returns once the job has finished.
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
      return sent;
    }

    it('sends nothing, applies nothing and records nothing when another writer saved first (AI-01 §6)', async () => {
      await seedPassage();
      const skillId = await createSkill(STEPS);
      // The first message meets another skill, which opens the conversation
      // and commits (version 1) without asking the model.
      await createSkill([
        { type: 'detect_intent', intent: 'parcel', phrases: ['parcel'] },
        { type: 'send_message', source: 'text', text: 'On it.' },
      ]);
      const headers = await customerAuth();
      const first = await send(headers, 'Where is my parcel?');
      expect(await botEvents(first.chat_id)).toEqual([{ text: 'On it.' }]);
      expect(await conversations()).toEqual([expect.objectContaining({ version: 1 })]);

      let routedBefore: Awaited<ReturnType<typeof routing>> | null = null;
      await sendWhileThinking(headers, 'How long does delivery take?', async ({ threadId }) => {
        routedBefore = await routing(first.chat_id);
        // Somebody else writes the conversation — an agent taking it over (AI-11)
        // would. The trigger bumps the version past the one the turn read.
        await owner.$executeRaw`
          UPDATE ai_conversations SET signals = '{"taken_over": true}'::jsonb
          WHERE thread_id = ${threadId}`;
      });

      // The model answered, and the answer went nowhere: no reply, no tag, no
      // hand-over, no run, no decision record beyond the first turn's.
      expect(model.calls).toHaveLength(1);
      expect(await botEvents(first.chat_id)).toEqual([{ text: 'On it.' }]);
      expect(await owner.threadTag.count({ where: { threadId: first.event.thread_id } })).toBe(0);
      expect(await routing(first.chat_id)).toEqual(routedBefore);
      expect(await owner.skillRun.count({ where: { skillId } })).toBe(0);
      expect(await owner.aiDecisionLog.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
      // The other writer's state stands; the lost turn is not counted.
      expect(await conversations()).toEqual([
        expect.objectContaining({
          signals: { taken_over: true },
          counters: { turns: 1 },
          version: 2,
        }),
      ]);
    });

    it('loses to a writer that opened the conversation first and wrote it, even though the turn found none', async () => {
      await seedPassage();
      const skillId = await createSkill(STEPS);
      const headers = await customerAuth();
      let routedBefore: Awaited<ReturnType<typeof routing>> | null = null;

      const sent = await sendWhileThinking(
        headers,
        'How long does delivery take?',
        async ({ chatId, threadId }) => {
          routedBefore = await routing(chatId);
          // The turn read no conversation; one is opened and written behind it.
          await owner.$executeRaw`
            INSERT INTO ai_conversations (id, license_id, chat_id, thread_id)
            VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${chatId}, ${threadId})`;
          await owner.$executeRaw`
            UPDATE ai_conversations SET mode = 'human' WHERE thread_id = ${threadId}`;
        },
      );

      expect(model.calls).toHaveLength(1);
      expect(await botEvents(sent.chat_id)).toEqual([]);
      expect(await owner.skillRun.count({ where: { skillId } })).toBe(0);
      expect(await owner.aiDecisionLog.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      expect(await owner.threadTag.count({ where: { threadId: sent.event.thread_id } })).toBe(0);
      expect(await routing(sent.chat_id)).toEqual(routedBefore);
      expect(await conversations()).toEqual([
        expect.objectContaining({ mode: 'human', counters: {}, version: 1 }),
      ]);
    });
  });

  it('opens a conversation the turn state reads as empty — the contract and the table agree', async () => {
    const headers = await customerAuth();
    const sent = await send(headers, 'Hello there');
    const row = await withTenant(
      owner,
      { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
      (tx) =>
        openConversation(
          tx,
          { chatId: sent.chat_id, threadId: sent.event.thread_id },
          { configVersionId: null },
        ),
    );
    expect(toTurnState(row)).toEqual(emptyTurnState());
  });
});
