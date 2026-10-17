/**
 * One answer to what the visitor said (tm 292.4 · SiyahTuş analysis AI-01
 * §4–§7), on real customer messages, the real AI job worker and Postgres.
 *
 *   - **The batch window.** Three messages written within the window get one
 *     reply, sent once the visitor has been quiet for it; the conversation
 *     marks the third processed and the jobs of the other two do nothing.
 *   - **The check before sending.** A message written while the model is
 *     thinking drops the draft; the turn is taken again with both messages —
 *     once: the second draft goes out whatever arrives meanwhile, and what
 *     arrived is the next turn's.
 *   - **Two engines on one connection** — two API copies, or a job whose lease
 *     ran out mid-answer — both think, one sends. Nothing but the optimistic
 *     lock stands between them here: the job's own fence is left out.
 *
 * The model is a fake each call of which the test may hold, so "while the
 * model is thinking" is a moment the test chooses, not a race it hopes to win.
 */
import { PrismaClient } from '@prisma/client';
import { parseEventId } from '@siyahtus/types';
import type { FastifyBaseLogger, FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { AiResponder } from '../../src/services/ai/ai-responder.js';
import { ConversationEngine } from '../../src/services/ai/conversation/conversation-engine.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { MockEmbeddingProvider } from '../../src/services/ai/provider/mock-embedding-provider.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import type { TurnLogger, VisitorTurn } from '../../src/services/chat/visitor-turn.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import { AI_QUESTION, seedAiWorkspace, type AiWorkspace } from '../helpers/ai-workspace.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { auditContextFor, ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Questions the seeded passage answers, alone and merged (lexical similarity ≥ 0.5 merged). */
const SECOND_QUESTION = 'Is standard delivery across the EU tracked?';
const THIRD_QUESTION = 'How many working days does standard delivery across the EU take?';

const PROMPTLY_MS = 5_000;
const APP_URL = process.env['DATABASE_APP_URL'];

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * A model whose first `hold(n)` calls wait until the test releases them. The
 * reply names what it answers — the request's last message — so a test can
 * tell which messages a reply covers.
 */
function heldModel() {
  let held = 0;
  const started: Deferred[] = [];
  const released: Deferred[] = [];
  const at = (list: Deferred[], call: number): Deferred => (list[call] ??= deferred());
  const fake = new FakeLlmProvider({
    reply: (request) => `Answer to: ${request.messages.at(-1)?.content ?? ''}`,
    hold: async (_request, call) => {
      at(started, call).resolve();
      if (call < held) await at(released, call).promise;
    },
  });
  return {
    fake,
    /** Hold the first `n` calls from here on. */
    hold: (n: number) => {
      held = n;
    },
    /** Resolves once call `n` (0-based) has reached the model. */
    started: (call: number) => at(started, call).promise,
    release: (call: number) => at(released, call).resolve(),
    releaseAll: () => {
      for (let call = 0; call < held; call += 1) at(released, call).resolve();
    },
    reset: () => {
      fake.reset();
      held = 0;
      started.length = 0;
      released.length = 0;
    },
  };
}

/** `promise`, or a failure naming `what` if it has not settled within `ms`. */
async function within<T>(promise: Promise<T>, what: string, ms = PROMPTLY_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not finish in ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The `event_sequence` an event id carries. */
function sequenceOf(eventId: string): number {
  const parsed = parseEventId(eventId);
  if (!parsed) throw new Error(`not an event id: ${eventId}`);
  return parsed.sequence;
}

describe('one answer to what the visitor said (AI-01 §4–§7 · tm 292.4)', () => {
  let owner: PrismaClient;
  const model = heldModel();
  let server: TestServer;

  beforeAll(async () => {
    owner = ownerClient();
    // AI_BATCH_WINDOW_MS is 0 here (`testEnv`): the window gets its own server below.
    server = await startTestServer({}, { llm: model.fake });
  });

  afterAll(async () => {
    model.releaseAll();
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    model.releaseAll();
    await seedFixtures(owner);
    await clearRateLimits(server.app);
    model.reset();
  });

  async function visitorToken(app: FastifyInstance, ws: AiWorkspace): Promise<string> {
    const minted = await app.inject({
      method: 'POST',
      url: server.url('/customer/token'),
      headers: { origin: `https://${ws.trustedDomain}` },
      payload: { organization_id: ws.organizationId },
    });
    expect(minted.statusCode).toBe(200);
    return (minted.json() as { token: string }).token;
  }

  /** The visitor's send, not waited on: its answer runs after the response. */
  async function send(app: FastifyInstance, token: string, text: string) {
    const response: LightMyRequestResponse = await app.inject({
      method: 'POST',
      url: server.url('/customer/chat/events'),
      headers: { authorization: `Bearer ${token}` },
      payload: { text },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { chat_id: string; event: { id: string } };
    return { chatId: body.chat_id, eventId: body.event.id };
  }

  const botReplies = async (chatId: string) =>
    (
      await owner.$queryRaw<Array<{ text: string }>>`
        SELECT text FROM events
         WHERE chat_id = ${chatId} AND author_type = 'bot' AND type = 'message'
         ORDER BY event_sequence`
    ).map((event) => event.text);

  const conversationOf = (chatId: string) =>
    owner.aiConversation.findFirstOrThrow({ where: { chatId } });

  const jobsOf = async (chatId: string) =>
    (
      await owner.aiJob.findMany({
        where: { chatId },
        orderBy: { createdAt: 'asc' },
        select: { state: true, outcome: true },
      })
    ).map((job) => `${job.state}:${job.outcome}`);

  const decisionsOf = (ws: AiWorkspace) =>
    owner.aiDecisionLog.findMany({
      where: { licenseId: ws.licenseId },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, details: true, replyEventId: true },
    });

  it('answers three messages written within the window with one reply, once the visitor is quiet, and marks the third processed (AI-01 §5)', async () => {
    const windowed = heldModel();
    const busy = await startTestServer({ AI_BATCH_WINDOW_MS: '3000' }, { llm: windowed.fake });
    try {
      const ws = await seedAiWorkspace(owner);
      await clearRateLimits(busy.app);
      const token = await visitorToken(busy.app, ws);
      const texts = ['Hi', 'about my delivery', 'how many working days across the EU?'];

      const first = await send(busy.app, token, texts[0]!);
      await sleep(400);
      await send(busy.app, token, texts[1]!);
      await sleep(400);
      const third = await send(busy.app, token, texts[2]!);
      await within(busy.app.aiJobs.idle(), 'the batch', 15_000);

      // One reply, to all three, from one model call.
      expect(await botReplies(first.chatId)).toEqual([`Answer to: ${texts.join('\n')}`]);
      expect(windowed.fake.calls).toHaveLength(1);
      // Sent once the visitor had been quiet for the window — no sooner.
      const [reply, lastMessage] = await owner.$queryRaw<Array<{ created_at: Date }>>`
        SELECT created_at FROM events
         WHERE chat_id = ${first.chatId} AND type = 'message'
         ORDER BY event_sequence DESC LIMIT 2`;
      expect(
        reply!.created_at.getTime() - lastMessage!.created_at.getTime(),
      ).toBeGreaterThanOrEqual(2_900);

      const conversation = await conversationOf(first.chatId);
      expect(conversation.lastProcessedEventSeq).toBe(sequenceOf(third.eventId));
      expect(conversation.counters).toEqual({ turns: 1 });
      // The first job answered; the other two found their message answered.
      expect(await jobsOf(first.chatId)).toEqual([
        'done:replied',
        'done:no_reply',
        'done:no_reply',
      ]);
      const decisions = await decisionsOf(ws);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({
        decision: 'answered',
        details: expect.objectContaining({ messages_answered: 3 }),
      });
      expect(await owner.skillRun.count({ where: { skillId: ws.skillId } })).toBe(1);

      // A message after the window is a turn of its own, on top of the first.
      const fourth = await send(busy.app, token, SECOND_QUESTION);
      await within(busy.app.aiJobs.idle(), 'the next turn', 15_000);
      expect(await botReplies(first.chatId)).toEqual([
        `Answer to: ${texts.join('\n')}`,
        `Answer to: ${SECOND_QUESTION}`,
      ]);
      expect((await conversationOf(first.chatId)).lastProcessedEventSeq).toBe(
        sequenceOf(fourth.eventId),
      );
    } finally {
      windowed.releaseAll();
      await busy.close();
    }
  });

  it('holds no message for the window where the AI has nothing to run', async () => {
    const windowed = heldModel();
    const busy = await startTestServer({ AI_BATCH_WINDOW_MS: '3000' }, { llm: windowed.fake });
    try {
      const ws = await seedAiWorkspace(owner);
      // Switched off: no skill of an active agent, so no turn could come of a wait.
      await owner.aiAgent.update({ where: { id: ws.aiAgentId }, data: { active: false } });
      await clearRateLimits(busy.app);
      const token = await visitorToken(busy.app, ws);

      const startedAt = Date.now();
      const sent = await send(busy.app, token, 'about my delivery');
      await within(busy.app.aiJobs.idle(), 'the job, without the window', 2_000);
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(windowed.fake.calls).toHaveLength(0);
      expect(await jobsOf(sent.chatId)).toEqual(['done:no_reply']);
    } finally {
      await busy.close();
    }
  });

  it('drops a draft the visitor overtook and answers both messages in one reply (AI-01 §7)', async () => {
    const ws = await seedAiWorkspace(owner);
    const token = await visitorToken(server.app, ws);
    model.hold(1);

    const first = await send(server.app, token, AI_QUESTION);
    await within(model.started(0), 'the first draft');
    // The visitor writes again while the model is answering the first message.
    const second = await send(server.app, token, SECOND_QUESTION);
    model.release(0);
    await within(server.app.aiJobs.idle(), 'the follow-ups');

    expect(model.fake.calls.map((call) => call.messages.at(-1)?.content)).toEqual([
      AI_QUESTION,
      `${AI_QUESTION}\n${SECOND_QUESTION}`,
    ]);
    // The first draft never went out; the second answers both.
    expect(await botReplies(first.chatId)).toEqual([
      `Answer to: ${AI_QUESTION}\n${SECOND_QUESTION}`,
    ]);
    expect((await conversationOf(first.chatId)).lastProcessedEventSeq).toBe(
      sequenceOf(second.eventId),
    );
    expect(await jobsOf(first.chatId)).toEqual(['done:replied', 'done:no_reply']);
    // The dropped draft is on record as overtaken; the turn that replied names its reply.
    const decisions = await decisionsOf(ws);
    expect(decisions).toEqual([
      expect.objectContaining({
        decision: 'expired',
        replyEventId: null,
        details: expect.objectContaining({ reason: 'visitor_wrote_again' }),
      }),
      expect.objectContaining({
        decision: 'answered',
        details: expect.objectContaining({ drafts: 2, messages_answered: 2 }),
      }),
    ]);
    expect(decisions[1]!.replyEventId).not.toBeNull();
    expect(await owner.skillRun.count({ where: { skillId: ws.skillId } })).toBe(1);
  });

  it('takes the turn again once only: the second draft goes out, and what arrived meanwhile is the next turn (AI-01 §7)', async () => {
    const ws = await seedAiWorkspace(owner);
    const token = await visitorToken(server.app, ws);
    model.hold(2);

    const first = await send(server.app, token, AI_QUESTION);
    await within(model.started(0), 'the first draft');
    await send(server.app, token, SECOND_QUESTION);
    model.release(0);
    await within(model.started(1), 'the second draft');
    // …and again while the second draft is being written.
    const third = await send(server.app, token, THIRD_QUESTION);
    model.release(1);
    await within(server.app.aiJobs.idle(), 'the follow-ups');

    expect(model.fake.calls).toHaveLength(3);
    expect(await botReplies(first.chatId)).toEqual([
      `Answer to: ${AI_QUESTION}\n${SECOND_QUESTION}`,
      `Answer to: ${THIRD_QUESTION}`,
    ]);
    // The third message's turn read the second draft as what the AI had said.
    expect(model.fake.calls[2]!.messages.map((message) => message.role).slice(-3)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect((await conversationOf(first.chatId)).lastProcessedEventSeq).toBe(
      sequenceOf(third.eventId),
    );
    expect(await jobsOf(first.chatId)).toEqual(['done:replied', 'done:no_reply', 'done:replied']);
    expect((await decisionsOf(ws)).map((row) => row.decision)).toEqual([
      'expired',
      'answered',
      'answered',
    ]);
  });

  describe('two engines on one connection', () => {
    let appRole: PrismaClient;

    beforeAll(() => {
      if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
      appRole = new PrismaClient({ datasourceUrl: APP_URL });
    });

    afterAll(async () => {
      await appRole.$disconnect();
    });

    const quiet: TurnLogger = { info: () => {}, warn: () => {}, error: () => {} };

    /** An engine as an API copy builds one, over its own services. */
    function engine(batchWindowMs = 0): AiResponder {
      const silent = { warn: () => {}, info: () => {}, error: () => {} };
      return new AiResponder(
        new ChatService(appRole, {
          set: async () => null,
          get: async () => null,
        }),
        new RealtimePublisher(
          { publish: async () => 0 } as unknown as Redis,
          silent as unknown as FastifyBaseLogger,
        ),
        new ConversationEngine({
          llm: model.fake,
          knowledge: new KnowledgeService({ embeddings: new MockEmbeddingProvider() }),
          maxOutputTokens: 400,
          timeoutMs: 20_000,
          maxPromptChars: 16_000,
        }),
        { batchWindowMs },
      );
    }

    /**
     * The visitor's messages, written without a job — so nobody answers them
     * but the engines this test runs.
     */
    async function writeMessages(ws: AiWorkspace, texts: string[]) {
      const tenant: TenantContext = { licenseId: ws.licenseId, organizationId: ws.organizationId };
      const { id: customerId } = await owner.customer.create({
        data: { organizationId: ws.organizationId, name: 'Visitor' },
        select: { id: true },
      });
      const chats = new ChatService(appRole, { set: async () => null, get: async () => null });
      const written: Array<{ chatId: string; threadId: string; eventId: string }> = [];
      for (const text of texts) {
        const result = await chats.openOrContinueConnection(
          tenant,
          {
            kind: 'customer',
            customerId,
            organizationId: ws.organizationId,
            licenseId: ws.licenseId,
          },
          {
            customerId,
            event: { type: 'message', text, recipients: 'all' },
            audit: auditContextFor(tenant, { actorId: customerId, actorType: 'customer' }),
          },
        );
        written.push({
          chatId: result.chat.id,
          threadId: parseEventId(result.event.id)!.threadId,
          eventId: result.event.id,
        });
      }
      return { tenant, customerId, written };
    }

    /** The turn a job would hand over, minus the job's fence. */
    function visitorTurn(
      tenant: TenantContext,
      customerId: string,
      message: { chatId: string; threadId: string; eventId: string },
    ): VisitorTurn {
      return {
        tenant,
        chatId: message.chatId,
        threadId: message.threadId,
        customerId,
        triggerEventId: message.eventId,
        requestId: null,
        log: quiet,
        withTenant: (fn) => withTenant(appRole, tenant, fn),
        requireAiInference: async () => {},
        requireAiBudget: async () => {},
        replyProperties: { reply_to_event_id: message.eventId },
        replyOutbox: async () => {},
      };
    }

    it.each([
      ['two messages, one engine each — two API copies', [0, 1]],
      ['one message, twice — a job taken again after its lease ran out', [0, 0]],
    ] as const)(
      'sends at most one reply when both think at once: %s (AI-01 §6)',
      async (_case, triggers) => {
        const ws = await seedAiWorkspace(owner);
        const { tenant, customerId, written } = await writeMessages(ws, [
          AI_QUESTION,
          SECOND_QUESTION,
        ]);
        model.hold(2);

        const turns = triggers.map((index) =>
          engine().handle(visitorTurn(tenant, customerId, written[index]!), 'unused'),
        );
        // Both have read the conversation and are waiting on the model.
        await within(Promise.all([model.started(0), model.started(1)]), 'both drafts');
        model.release(0);
        model.release(1);
        const results = await within(Promise.all(turns), 'both turns');

        const chatId = written[0]!.chatId;
        expect(await botReplies(chatId)).toHaveLength(1);
        // One engine's turn is the conversation's; the other's left no trace.
        expect(results.filter((result) => result?.reply)).toHaveLength(1);
        expect(results.filter((result) => result === null)).toHaveLength(1);
        const conversation = await conversationOf(chatId);
        expect(conversation).toMatchObject({ version: 1, counters: { turns: 1 } });
        expect(conversation.lastProcessedEventSeq).toBe(sequenceOf(written[1]!.eventId));
        expect(await owner.skillRun.count({ where: { skillId: ws.skillId } })).toBe(1);
        expect(await decisionsOf(ws)).toHaveLength(1);
      },
    );

    it('sends nothing once its window is over if another engine answered the message meanwhile (AI-01 §5 · §6)', async () => {
      const ws = await seedAiWorkspace(owner);
      const { tenant, customerId, written } = await writeMessages(ws, [AI_QUESTION]);

      // One engine waits for the visitor to stop typing…
      const waiting = engine(1_500).handle(visitorTurn(tenant, customerId, written[0]!), '');
      await sleep(300);
      // …while another, with no window, answers at once.
      const answered = await engine().handle(visitorTurn(tenant, customerId, written[0]!), '');
      expect(answered?.reply).toBe(`Answer to: ${AI_QUESTION}`);

      expect(await within(waiting, 'the waiting turn')).toBeNull();
      expect(model.fake.calls).toHaveLength(1);
      expect(await botReplies(written[0]!.chatId)).toHaveLength(1);
      expect((await conversationOf(written[0]!.chatId)).version).toBe(1);
    });

    it('does nothing for a message an earlier turn answered — not even the gates (AI-01 §5)', async () => {
      const ws = await seedAiWorkspace(owner);
      const { tenant, customerId, written } = await writeMessages(ws, [
        AI_QUESTION,
        SECOND_QUESTION,
      ]);
      const answered = await engine().handle(visitorTurn(tenant, customerId, written[0]!), '');
      expect(answered?.reply).toBe(`Answer to: ${AI_QUESTION}\n${SECOND_QUESTION}`);

      let gated = 0;
      const late = {
        ...visitorTurn(tenant, customerId, written[1]!),
        requireAiBudget: async () => {
          gated += 1;
        },
      };
      expect(await engine().handle(late, '')).toBeNull();
      expect(gated).toBe(0);
      expect(model.fake.calls).toHaveLength(1);
      expect(await botReplies(written[0]!.chatId)).toHaveLength(1);
      expect(await decisionsOf(ws)).toHaveLength(1);
    });
  });
});
