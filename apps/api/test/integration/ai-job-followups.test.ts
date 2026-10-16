/**
 * A visitor's follow-up on the durable AI job queue (tm 289.5 · ADR-11a ·
 * SiyahTuş analysis GV-02).
 *
 * `POST /customer/chat/events` writes the message's AI job in the message's
 * own transaction, and the AI job worker runs it: the rule bot, the AI Agent
 * and the assignee's notice, in that order, in one job. What this suite holds
 * the route to, through the real server:
 *
 *   1. The order. The rule bot has acted when the model is asked; the notice
 *      goes out after the answer, not before it.
 *   2. One answer, whichever responder gives it: a rule's reply carries the
 *      job's mark and settles the job, and the AI is not asked.
 *   3. A job that outlives its process is answered once, by the next one —
 *      the stopped process's late answer is refused.
 *   4. `/health` shows the queue's depth and the oldest job's age, to an
 *      admin only.
 *
 * Every server here runs its worker `in_process` (`helpers/server.ts`): it
 * answers what its own requests wrote, so the suite's second server is never
 * answered by the first.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma, PrismaClient } from '@prisma/client';
import { LEXICAL_EMBEDDING_SPACE, embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_JOB_OUTCOMES } from '../../src/services/ai/ai-job-worker.js';
import { FilePushProvider } from '../../src/services/push/push-provider.js';
import { AI_PASSAGE, AI_QUESTION } from '../helpers/ai-workspace.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Longer than any of these steps takes; far shorter than a model left waiting. */
const PROMPTLY_MS = 5_000;

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

describe('the visitor follow-up runs as a durable AI job (GV-02 · ADR-11a)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;
  let pushDir: string;
  let push: FilePushProvider;
  /** Whatever the test puts here runs inside the model call, before it answers. */
  let duringModelCall: (() => Promise<void>) | null = null;
  let held: Deferred | null = null;
  const model = new FakeLlmProvider({
    reply: (request) => `Answer to: ${request.messages.at(-1)?.content ?? ''}`,
    hold: async () => {
      await duringModelCall?.();
      await held?.promise;
    },
  });
  let server: TestServer;
  let supportGroupId: bigint;

  beforeAll(async () => {
    owner = ownerClient();
    pushDir = await mkdtemp(join(tmpdir(), 'siyahtus-ai-job-push-'));
    push = new FilePushProvider(pushDir);
    server = await startTestServer({}, { llm: model, push });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(pushDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(pushDir, { recursive: true, force: true });
    model.reset();
    duringModelCall = null;
    held = null;

    // Every chat goes to Support, where workspace A's agent takes it — the
    // assignee the notice is for, and the team the rule bot answers on.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    supportGroupId = support.id;
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
    await owner.deviceToken.create({
      data: {
        licenseId: fx.a.licenseId,
        accountId: fx.a.agentAccountId,
        token: 'apns-token-support-agent',
        platform: 'ios',
      },
    });
    await seedAiAgent(fx.a.licenseId);
  });

  afterEach(async () => {
    // A test that failed holding the model must not leave its job running
    // under the next test's reset.
    held?.resolve();
    await within(server.app.aiJobs.idle(), 'the jobs left by the test');
  });

  /** An AI Agent that answers delivery questions from one passage — `seedAiWorkspace`'s, on workspace A. */
  async function seedAiAgent(licenseId: bigint): Promise<void> {
    const aiAgent = await owner.aiAgent.create({
      data: {
        licenseId,
        kind: 'ai_agent',
        name: 'Ada',
        active: true,
        tone: 'formal',
        languages: ['en'],
      },
      select: { id: true },
    });
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId: aiAgent.id,
        licenseId,
        type: 'article',
        name: 'Delivery',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks
         (id, source_id, license_id, chunk_text, embedding, token_count, position, embedding_space)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0, $5)`,
      source.id,
      licenseId.toString(),
      AI_PASSAGE,
      toVectorLiteral(embed(AI_PASSAGE)),
      LEXICAL_EMBEDDING_SPACE,
    );
    await owner.skill.create({
      data: {
        licenseId,
        aiAgentId: aiAgent.id,
        name: 'Delivery',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
          { type: 'send_message', source: 'knowledge' },
        ],
        active: true,
        updatedAt: new Date(),
      },
    });
  }

  /** A rule bot on Support with one rule. */
  async function seedRuleBot(actions: Prisma.InputJsonObject): Promise<void> {
    const bot = await owner.bot.create({
      data: { licenseId: fx.a.licenseId, name: 'FAQ', enabled: true },
      select: { id: true },
    });
    await owner.botGroup.create({
      data: { licenseId: fx.a.licenseId, botId: bot.id, groupId: supportGroupId },
    });
    await owner.botRule.create({
      data: {
        licenseId: fx.a.licenseId,
        botId: bot.id,
        name: 'Delivery',
        conditions: { message_contains: 'delivery' },
        actions,
      },
    });
  }

  async function visitorToken(app = server.app): Promise<string> {
    const minted = await app.inject({
      method: 'POST',
      url: server.url('/customer/token'),
      headers: { origin: `https://${fx.a.trustedDomain}` },
      payload: { organization_id: fx.a.organizationId },
    });
    expect(minted.statusCode).toBe(200);
    return (minted.json() as { token: string }).token;
  }

  /** The send itself, through `inject`: the caller decides when to wait for the job. */
  async function send(token: string, text: string, app = server.app) {
    const sent = await app.inject({
      method: 'POST',
      url: server.url('/customer/chat/events'),
      headers: { authorization: `Bearer ${token}` },
      payload: { text },
    });
    expect(sent.statusCode).toBe(201);
    return sent.json() as { chat_id: string; event: { id: string } };
  }

  function messagesOf(chatId: string) {
    return owner.event.findMany({
      where: { chatId, type: 'message' },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true, properties: true },
    });
  }

  function tagsOf(chatId: string): Promise<string[]> {
    return owner.threadTag
      .findMany({ where: { thread: { chatId } }, select: { tag: { select: { name: true } } } })
      .then((rows) => rows.map((row) => row.tag.name));
  }

  it('runs the rule bot, then the AI Agent, then the assignee notice — one job, in that order', async () => {
    // A rule that only tags: an annotation, so the AI still answers.
    await seedRuleBot({ add_tag: 'shipping' });
    const token = await visitorToken();
    const seenByModel: { tags: string[]; pushes: number } = { tags: [], pushes: -1 };
    let chatId = '';
    duringModelCall = async () => {
      seenByModel.tags = await tagsOf(chatId);
      seenByModel.pushes = (await push.delivered()).length;
    };
    held = deferred();

    const sent = await send(token, AI_QUESTION);
    chatId = sent.chat_id;
    await within(
      (async () => {
        while (model.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 20));
      })(),
      'the model call',
    );
    // The answer is being written; the notice has not gone out yet.
    expect(await push.delivered()).toHaveLength(0);
    held.resolve();
    await within(server.app.aiJobs.idle(), 'the job');

    // The rule bot had tagged the conversation before the model was asked…
    expect(seenByModel.tags).toEqual(['shipping']);
    // …and the notice was not sent until the answer was.
    expect(seenByModel.pushes).toBe(0);
    const delivered = await push.delivered();
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ account_id: fx.a.agentAccountId, kind: 'new_chat' });

    const messages = await messagesOf(chatId);
    expect(messages.map(({ text, authorType }) => ({ text, authorType }))).toEqual([
      { text: AI_QUESTION, authorType: 'customer' },
      { text: `Answer to: ${AI_QUESTION}`, authorType: 'bot' },
    ]);
    // The reply names the message it answers — the mark a second answer is refused by.
    expect(messages[1]!.properties).toMatchObject({ reply_to_event_id: sent.event.id });
    const job = await owner.aiJob.findFirstOrThrow({ where: { triggerEventId: sent.event.id } });
    expect(job).toMatchObject({
      state: 'done',
      outcome: AI_JOB_OUTCOMES.replied,
      attempts: 1,
      openedConnection: true,
    });
    // The decision record names the job's request and the reply.
    const decision = await owner.aiDecisionLog.findFirstOrThrow({ where: { chatId } });
    expect(decision).toMatchObject({
      triggerEventId: sent.event.id,
      threadId: job.threadId,
      decision: 'answered',
    });
    expect(decision.requestId).toBe(job.requestId);
    expect(job.requestId).toBeTruthy();
  });

  it('a later message in the open connection is announced as a message, not a new chat', async () => {
    const token = await visitorToken();
    const first = await send(token, 'Hello');
    await within(server.app.aiJobs.idle(), 'the first job');
    const second = await send(token, 'Anyone there?');
    await within(server.app.aiJobs.idle(), 'the second job');

    expect(second.chat_id).toBe(first.chat_id);
    expect((await push.delivered()).map((d) => d.kind).sort()).toEqual(['message', 'new_chat']);
    const jobs = await owner.aiJob.findMany({
      where: { chatId: first.chat_id },
      orderBy: { createdAt: 'asc' },
      select: { openedConnection: true, state: true, outcome: true },
    });
    // Nothing matched either message: done, with no reply, and still announced.
    expect(jobs).toEqual([
      { openedConnection: true, state: 'done', outcome: AI_JOB_OUTCOMES.noReply },
      { openedConnection: false, state: 'done', outcome: AI_JOB_OUTCOMES.noReply },
    ]);
  });

  it("a rule's reply is the message's one answer: it settles the job, and the AI is not asked", async () => {
    await seedRuleBot({ send_message: 'Parcels ship within a day.' });
    const token = await visitorToken();

    const sent = await send(token, AI_QUESTION);
    await within(server.app.aiJobs.idle(), 'the job');

    expect(model.calls).toHaveLength(0);
    const messages = await messagesOf(sent.chat_id);
    expect(messages.map(({ text, authorType }) => ({ text, authorType }))).toEqual([
      { text: AI_QUESTION, authorType: 'customer' },
      { text: 'Parcels ship within a day.', authorType: 'bot' },
    ]);
    expect(messages[1]!.properties).toMatchObject({ reply_to_event_id: sent.event.id });
    expect(
      await owner.aiJob.findFirstOrThrow({ where: { triggerEventId: sent.event.id } }),
    ).toMatchObject({ state: 'done', outcome: AI_JOB_OUTCOMES.replied });
    // The notice still goes out after a rule's answer.
    expect((await push.delivered()).map((d) => d.kind)).toEqual(['new_chat']);
  });

  it('a job whose process stopped mid-answer is answered once, by the next process', async () => {
    // The first process: its model holds the answer until the test lets go.
    // The next process answers with the suite's model, which nothing holds.
    const stalledHold = deferred();
    const stalled = new FakeLlmProvider({
      reply: () => 'The stopped process’s late answer',
      hold: () => stalledHold.promise,
    });
    const first = await startTestServer({}, { llm: stalled, push });
    let next: TestServer | null = null;
    try {
      await clearRateLimits(first.app);
      const sent = await send(await visitorToken(first.app), AI_QUESTION, first.app);
      await within(
        (async () => {
          while (stalled.calls.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
        })(),
        'the first process’s model call',
      );

      // It stops without waiting: the job goes back to the queue.
      await within(first.app.aiJobs.stop({ drainMs: 0 }), 'the stop');
      expect(
        await owner.aiJob.findFirstOrThrow({ where: { triggerEventId: sent.event.id } }),
      ).toMatchObject({ state: 'pending', outcome: AI_JOB_OUTCOMES.workerStopped, attempts: 1 });

      // The next process takes it at once and answers.
      next = await startTestServer({}, { llm: model, push });
      next.app.aiJobs.wake();
      await within(next.app.aiJobs.idle(), 'the next process’s job');

      // The stopped process's model finally answers — and is refused.
      stalledHold.resolve();
      await within(first.app.aiJobs.idle(), 'the stopped process’s late run');

      const messages = await messagesOf(sent.chat_id);
      expect(messages.map(({ text, authorType }) => ({ text, authorType }))).toEqual([
        { text: AI_QUESTION, authorType: 'customer' },
        { text: `Answer to: ${AI_QUESTION}`, authorType: 'bot' },
      ]);
      expect(
        await owner.aiJob.findFirstOrThrow({ where: { triggerEventId: sent.event.id } }),
      ).toMatchObject({ state: 'done', outcome: AI_JOB_OUTCOMES.replied, attempts: 2 });
      // One answer, one notice: the stopped run never reached its notice.
      expect((await push.delivered()).map((d) => d.kind)).toEqual(['new_chat']);
    } finally {
      stalledHold.resolve();
      await first.close();
      await next?.close();
    }
  });

  describe('GET /health — the queue at a glance', () => {
    async function health(authorization?: string) {
      const response = await server.app.inject({
        method: 'GET',
        url: server.url('/health'),
        ...(authorization ? { headers: { authorization } } : {}),
      });
      expect(response.statusCode).toBe(200);
      return response.json() as Record<string, unknown>;
    }

    async function adminAuth(): Promise<string> {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: [],
      });
      return `Bearer ${token}`;
    }

    /** One job row on `at`'s connection, written as the table's owner. */
    async function seedJob(
      at: { licenseId: bigint; organizationId: string; chatId: string; threadId: string },
      state: 'pending' | 'running' | 'done',
      ageSeconds: number,
    ): Promise<void> {
      const createdAt = new Date(Date.now() - ageSeconds * 1000);
      await owner.aiJob.create({
        data: {
          licenseId: at.licenseId,
          organizationId: at.organizationId,
          chatId: at.chatId,
          threadId: at.threadId,
          triggerEventId: `evt-${state}-${ageSeconds}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'visitor_message',
          state,
          createdAt,
          ...(state === 'running'
            ? { attempts: 1, startedAt: createdAt, leaseUntil: new Date(Date.now() + 60_000) }
            : {}),
          ...(state === 'done' ? { attempts: 1, finishedAt: new Date(), outcome: 'replied' } : {}),
        },
      });
    }

    /** A connection in `tenant`, opened by a visitor, its own job already run. */
    async function connectionIn(tenant: Fixtures['a']) {
      const minted = await server.post(
        '/customer/token',
        { organization_id: tenant.organizationId },
        { origin: `https://${tenant.trustedDomain}` },
      );
      const token = (minted.json() as { token: string }).token;
      const sent = await server.post(
        '/customer/chat/events',
        { text: 'Hello' },
        { authorization: `Bearer ${token}` },
      );
      const chatId = (sent.json() as { chat_id: string }).chat_id;
      const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
      return {
        licenseId: tenant.licenseId,
        organizationId: tenant.organizationId,
        chatId,
        threadId: thread.id,
      };
    }

    it('shows an admin how many jobs wait and run, across every workspace, and how old the oldest is', async () => {
      const inA = await connectionIn(fx.a);
      const inB = await connectionIn(fx.b);
      // The two visitor jobs above ran: an empty queue has no age.
      expect((await health(await adminAuth()))['ai_jobs']).toEqual({
        pending: 0,
        running: 0,
        oldest_age_s: null,
      });

      await seedJob(inA, 'pending', 30);
      await seedJob(inB, 'pending', 5);
      await seedJob(inB, 'running', 12);
      // Finished jobs are history, not queue — however old.
      await seedJob(inA, 'done', 600);

      const body = await health(await adminAuth());
      const aiJobs = body['ai_jobs'] as { pending: number; running: number; oldest_age_s: number };
      expect(aiJobs).toMatchObject({ pending: 2, running: 1 });
      expect(aiJobs.oldest_age_s).toBeGreaterThanOrEqual(30);
      expect(aiJobs.oldest_age_s).toBeLessThan(60);
    });

    it('shows nobody else the queue', async () => {
      const inA = await connectionIn(fx.a);
      await seedJob(inA, 'pending', 30);
      const agent = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: [],
      });

      expect(await health()).toEqual({ status: 'ok', service: 'api' });
      expect(await health(`Bearer ${agent}`)).toEqual({ status: 'ok', service: 'api' });
    });
  });
});
