/**
 * The AI job worker (tm 289.3 · ADR-11a · SiyahTuş analysis GV-02).
 *
 * Every scenario runs the real queue — the outbox writes the job with the
 * visitor's message, `ai_jobs_claim` / `ai_jobs_settle` move it, the worker
 * runs as the application role — with a stand-in for the handler tm 289.5
 * wires (rule bot, AI, notice): one bot reply written the way the worker asks,
 * with `run.replyProperties` and `run.replyOutbox`.
 *
 *   1. A message is answered once; the job settles `done` with the reply.
 *   2. Two workers on one queue never answer a message twice, keep each
 *      chat's replies in its messages' order, and answer each tenant in its
 *      own tenant.
 *   3. A worker whose lease ran out mid-answer cannot send; the next claim
 *      answers. A process that hung (or died) after claiming loses its job to
 *      the restarted one, which answers once, inside the 120 s window.
 *   4. Shutdown waits for a job in flight, and hands back the one it cannot
 *      wait for — the next worker takes it at once.
 *   5. Before the handler: a stale job (> 120 s) is handed to a person — an
 *      internal note, `expired`, a decision record — so is one whose every
 *      attempt died; an answered message and a closed connection are not
 *      answered (again).
 *   6. A handler that throws is tried once more, then handed over.
 *   7. The doorbell (`LISTEN ai_jobs`) wakes a worker at once; a rolled-back
 *      enqueue rings nothing; a doorbell that cannot connect costs a warning.
 *   8. Write → start latency, p95 under a second.
 */
import { PrismaClient } from '@prisma/client';
import { AI_BOT_ID } from '@siyahtus/types';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '../../src/lib/tenant.js';
import type { BotPrincipal, CustomerPrincipal } from '../../src/services/auth/principal.js';
import {
  AI_JOB_HANDOVER_EVENT,
  AI_JOB_OUTCOMES,
  AiJobReplyRefusedError,
  AiJobWorker,
  type AiJobHandler,
  type AiJobLogger,
  type AiJobRun,
  type AiJobWorkerOptions,
} from '../../src/services/ai/ai-job-worker.js';
import {
  AI_JOBS_CHANNEL,
  type AiJobWakeups,
  listenConnectionString,
  pgWakeups,
} from '../../src/services/ai/ai-job-wakeups.js';
import { aiJobOutbox } from '../../src/services/ai/ai-jobs.js';
import { ChatService, type ConnectionResult } from '../../src/services/chat/chat-service.js';
import {
  auditContextFor,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Member {
  customerId: string;
  principal: CustomerPrincipal;
}

interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  object: Record<string, unknown>;
}

/** A logger that keeps what it was told. */
function recordingLogger(lines: LogLine[] = []): AiJobLogger & { lines: LogLine[] } {
  const make = (bindings: Record<string, unknown>): AiJobLogger => ({
    child: (more) => make({ ...bindings, ...more }),
    debug: (object, message) =>
      lines.push({ level: 'debug', message, object: { ...bindings, ...object } }),
    info: (object, message) =>
      lines.push({ level: 'info', message, object: { ...bindings, ...object } }),
    warn: (object, message) =>
      lines.push({ level: 'warn', message, object: { ...bindings, ...object } }),
    error: (object, message) =>
      lines.push({ level: 'error', message, object: { ...bindings, ...object } }),
  });
  return Object.assign(make({}), { lines });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(
  what: string,
  check: () => Promise<boolean> | boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
}

/** A promise a test opens when it chooses. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

function botPrincipal(tenant: TenantContext): BotPrincipal {
  return {
    kind: 'bot',
    botId: AI_BOT_ID,
    licenseId: tenant.licenseId,
    organizationId: tenant.organizationId,
    scopes: ['chats--all:rw'],
    tokenId: AI_BOT_ID,
    tokenKind: 'bot',
  };
}

describe('the AI job worker (GV-02 · ADR-11a)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let chats: ChatService;
  /** Every worker a test started, stopped after it (a running worker would race the reset). */
  let workers: AiJobWorker[] = [];
  /** Gates a test left closed, opened after it so no handler outlives its test. */
  let gates: Array<() => void> = [];
  const extraClients: PrismaClient[] = [];

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  async function member(t: TenantFixture = fx.a): Promise<Member> {
    const { id } = await owner.customer.create({
      data: { organizationId: t.organizationId, name: 'Visitor' },
      select: { id: true },
    });
    return {
      customerId: id,
      principal: {
        kind: 'customer',
        customerId: id,
        organizationId: t.organizationId,
        licenseId: t.licenseId,
      },
    };
  }

  /** A visitor's message, with its job — the way the widget's route will send one (tm 289.5). */
  function send(
    who: Member,
    text: string,
    options: { t?: TenantFixture; outbox?: boolean } = {},
  ): Promise<ConnectionResult> {
    const t = options.t ?? fx.a;
    return chats.openOrContinueConnection(ctx(t), who.principal, {
      customerId: who.customerId,
      event: { type: 'message', text, recipients: 'all' },
      audit: auditContextFor(t, { actorId: who.customerId, actorType: 'customer' }),
      ...(options.outbox === false
        ? {}
        : { outbox: aiJobOutbox({ requestId: 'req-worker-0001' }) }),
    });
  }

  /** The stand-in handler: one bot reply, written the way the worker asks. */
  function replying(
    options: {
      calls?: AiJobRun[];
      before?: (run: AiJobRun) => Promise<void>;
      service?: ChatService;
    } = {},
  ): AiJobHandler {
    return async (run) => {
      options.calls?.push(run);
      await options.before?.(run);
      await (options.service ?? chats).sendEvent(
        run.job.context,
        botPrincipal(run.job.context),
        run.job.chatId,
        {
          type: 'message',
          text: `Answer to ${run.job.triggerEventId}`,
          recipients: 'all',
          properties: { ...run.replyProperties },
        },
        { outbox: run.replyOutbox },
      );
    };
  }

  function worker(
    options: Partial<AiJobWorkerOptions> & { handler: AiJobHandler; service?: ChatService },
  ): AiJobWorker {
    const { handler, service, ...rest } = options;
    const w = new AiJobWorker({ db: appRole, logger: recordingLogger(), ...rest });
    w.start({ handler, notes: service ?? chats });
    workers.push(w);
    return w;
  }

  /** A second process's connection pool. */
  function anotherProcess(): PrismaClient {
    const client = new PrismaClient({ datasourceUrl: APP_URL });
    extraClients.push(client);
    return client;
  }

  const jobFor = (triggerEventId: string) =>
    owner.aiJob.findFirstOrThrow({ where: { triggerEventId } });

  const repliesTo = (triggerEventId: string) =>
    owner.$queryRaw<
      Array<{ id: string; chat_id: string; author_type: string; license_id: bigint }>
    >`
      SELECT id, chat_id, author_type, license_id FROM events
       WHERE properties @> jsonb_build_object('reply_to_event_id', ${triggerEventId}::text)`;

  /** A chat's replies in transcript order, as the triggers they answer. */
  const answeredInOrder = async (chatId: string): Promise<string[]> => {
    const rows = await owner.$queryRaw<Array<{ trigger: string }>>`
      SELECT properties->>'reply_to_event_id' AS trigger FROM events
       WHERE chat_id = ${chatId} AND properties ? 'reply_to_event_id'
       ORDER BY created_at, event_sequence`;
    return rows.map((r) => r.trigger);
  };

  const unfinished = () => owner.aiJob.count({ where: { state: { in: ['pending', 'running'] } } });

  const notesOf = (chatId: string) =>
    owner.$queryRaw<
      Array<{
        type: string;
        author_type: string;
        recipients: string;
        text: string;
        properties: Record<string, unknown>;
      }>
    >`SELECT type, author_type, recipients, text, properties FROM events
       WHERE chat_id = ${chatId} AND properties->>'system_event' = ${AI_JOB_HANDOVER_EVENT}`;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([
      owner.$disconnect(),
      appRole.$disconnect(),
      ...extraClients.map((c) => c.$disconnect()),
    ]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    chats = new ChatService(appRole, NO_REDIS);
  });

  afterEach(async () => {
    for (const open of gates) open();
    await Promise.all(workers.map((w) => w.stop({ drainMs: 5_000 })));
    workers = [];
    gates = [];
  });

  // --- 1. Once ------------------------------------------------------------------

  it('answers a message once, in its own tenant, and settles the job with the reply', async () => {
    const who = await member();
    const calls: AiJobRun[] = [];
    const w = worker({ handler: replying({ calls }) });

    const sent = await send(who, 'What are your opening hours?');
    await w.idle();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.customerId).toBe(who.customerId);
    expect(calls[0]!.job.context).toEqual(ctx(fx.a));
    expect(calls[0]!.job.requestId).toBe('req-worker-0001');
    const replies = await repliesTo(sent.event.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ chat_id: sent.chat.id, author_type: 'bot' });
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'done',
      outcome: AI_JOB_OUTCOMES.replied,
      attempts: 1,
      leaseUntil: null,
    });
  });

  it('settles a run that wrote no reply as done / no_reply', async () => {
    const who = await member();
    const w = worker({ handler: async () => undefined });
    const sent = await send(who, 'Just an attachment');
    await w.idle();
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'done',
      outcome: AI_JOB_OUTCOMES.noReply,
    });
    expect(await repliesTo(sent.event.id)).toHaveLength(0);
  });

  // --- 2. Two workers, order, tenants -------------------------------------------

  it('two workers on one queue answer every message exactly once, in each chat in order, each in its tenant (NFR-S4)', async () => {
    const running = new Map<string, number>();
    let overlap = 0;
    const handlerFor = (service: ChatService): AiJobHandler =>
      replying({
        service,
        before: async (run) => {
          const now = (running.get(run.job.chatId) ?? 0) + 1;
          running.set(run.job.chatId, now);
          if (now > 1) overlap += 1;
          await sleep(5 + Math.floor(Math.random() * 25));
          running.set(run.job.chatId, now - 1);
        },
      });
    const second = anotherProcess();
    const secondChats = new ChatService(second, NO_REDIS);

    const visitors = [
      await member(fx.a),
      await member(fx.a),
      await member(fx.a),
      await member(fx.b),
    ];
    const tenantOf = (i: number): TenantFixture => (i === 3 ? fx.b : fx.a);
    const triggers: Array<{ chatId: string; eventId: string; license: bigint }> = [];
    // Interleaved, so both workers see several chats with several jobs each.
    for (let round = 0; round < 4; round += 1) {
      for (let i = 0; i < visitors.length; i += 1) {
        const sent = await send(visitors[i]!, `Message ${round}`, { t: tenantOf(i) });
        triggers.push({
          chatId: sent.chat.id,
          eventId: sent.event.id,
          license: tenantOf(i).licenseId,
        });
      }
    }

    worker({ handler: handlerFor(chats) });
    worker({ db: second, handler: handlerFor(secondChats), service: secondChats });
    await waitFor('every job to finish', async () => (await unfinished()) === 0, 20_000);

    for (const trigger of triggers) {
      const replies = await repliesTo(trigger.eventId);
      expect(replies, `replies to ${trigger.eventId}`).toHaveLength(1);
      expect(replies[0]!.chat_id).toBe(trigger.chatId);
      expect(replies[0]!.license_id).toBe(trigger.license);
    }
    for (const chatId of new Set(triggers.map((t) => t.chatId))) {
      expect(await answeredInOrder(chatId)).toEqual(
        triggers.filter((t) => t.chatId === chatId).map((t) => t.eventId),
      );
    }
    expect(overlap).toBe(0);
  });

  // --- 3. Leases, a hung process, a restart ---------------------------------------

  it('a worker whose lease ran out cannot send: the next claim answers and the late reply rolls back', async () => {
    const who = await member();
    const held = gate();
    gates.push(held.open);
    const late: { error: unknown; run: AiJobRun | null } = { error: null, run: null };
    // One job at a time, so the first worker cannot re-claim the job itself.
    worker({
      concurrency: 1,
      leaseMs: 1_000,
      handler: async (run) => {
        late.run = run;
        await held.wait;
        try {
          await replying()(run);
        } catch (error) {
          late.error = error;
          throw error;
        }
      },
    });
    const sent = await send(who, 'Hello?');
    await waitFor('the first claim', () => late.run !== null);
    await waitFor('its lease to run out', () => late.run!.signal.aborted, 5_000);

    // The next worker takes it once the database's lease has run out too, and
    // is still thinking when the first one's late reply arrives — so nothing
    // has answered the message yet, and only the fence stands in the way.
    const thinking = gate();
    gates.push(thinking.open);
    let nextRun: AiJobRun | null = null;
    const next = worker({
      handler: replying({
        before: async (run) => {
          nextRun = run;
          await thinking.wait;
        },
      }),
    });
    await waitFor('the next claim', () => nextRun !== null);
    expect(await jobFor(sent.event.id)).toMatchObject({ state: 'running', attempts: 2 });

    held.open();
    await waitFor('the late reply to be refused', () => late.error !== null);
    expect(late.error).toBeInstanceOf(AiJobReplyRefusedError);
    expect((late.error as AiJobReplyRefusedError).reason).toBe('claim_lost');
    expect(await repliesTo(sent.event.id)).toHaveLength(0);

    thinking.open();
    await waitFor(
      'the next claim to answer',
      async () => (await repliesTo(sent.event.id)).length > 0,
    );
    await next.idle();
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'done',
      outcome: AI_JOB_OUTCOMES.replied,
      attempts: 2,
    });
  });

  it('a process that hung right after claiming loses the job to the restarted one, which answers once inside 120 s', async () => {
    const who = await member();
    const dying = anotherProcess();
    const hung = gate();
    gates.push(hung.open);
    let claimed = false;
    // The hung process: its handler never returns, and it holds no free slot.
    worker({
      db: dying,
      concurrency: 1,
      leaseMs: 1_000,
      handler: async () => {
        claimed = true;
        await hung.wait;
      },
    });
    const sent = await send(who, 'Is anyone there?');
    await waitFor('the doomed claim', () => claimed);
    expect(await jobFor(sent.event.id)).toMatchObject({ state: 'running', attempts: 1 });

    // The process that comes up after it — a fresh pool, a fresh worker.
    const restarted = worker({ db: anotherProcess(), handler: replying() });
    await waitFor(
      'the restarted worker to answer',
      async () => (await repliesTo(sent.event.id)).length > 0,
    );
    await restarted.idle();

    const job = await jobFor(sent.event.id);
    expect(job).toMatchObject({ state: 'done', outcome: AI_JOB_OUTCOMES.replied, attempts: 2 });
    expect(job.finishedAt!.getTime() - job.createdAt.getTime()).toBeLessThan(120_000);
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
  });

  // --- 4. Shutdown ----------------------------------------------------------------

  it('stop() waits for a job in flight to finish', async () => {
    const who = await member();
    let started = false;
    const w = worker({
      handler: replying({
        before: async () => {
          started = true;
          await sleep(300);
        },
      }),
    });
    const sent = await send(who, 'Quick question');
    await waitFor('the job to start', () => started);
    await w.stop();
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'done',
      outcome: AI_JOB_OUTCOMES.replied,
    });
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
  });

  it('stop() hands back a job it cannot wait for; the next worker takes it at once and the late reply is refused', async () => {
    const who = await member();
    const held = gate();
    gates.push(held.open);
    let first: AiJobRun | null = null;
    const w = worker({
      handler: async (run) => {
        first = run;
        await held.wait;
        await replying()(run);
      },
    });
    const sent = await send(who, 'Hello');
    await waitFor('the job to start', () => first !== null);

    const stopping = Date.now();
    await w.stop({ drainMs: 200 });
    expect(Date.now() - stopping).toBeLessThan(5_000);
    expect(first!.signal.aborted).toBe(true);
    const handedBack = await jobFor(sent.event.id);
    expect(handedBack).toMatchObject({
      state: 'pending',
      attempts: 1,
      outcome: AI_JOB_OUTCOMES.workerStopped,
      leaseUntil: null,
    });
    expect(handedBack.availableAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

    const next = worker({ handler: replying() });
    await next.idle();
    held.open();
    await waitFor('the first run to give up', () => w.inFlight === 0);
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
    expect(await jobFor(sent.event.id)).toMatchObject({ state: 'done', attempts: 2 });
  });

  // --- 5. Before the handler --------------------------------------------------------

  it('a job older than 120 s is not answered: expired, an internal note for the agents, a decision record', async () => {
    const who = await member();
    const calls: AiJobRun[] = [];
    const w = worker({
      handler: replying({ calls }),
      now: () => new Date(Date.now() + 121_000),
    });
    const sent = await send(who, 'Anyone?');
    await w.idle();

    expect(calls).toHaveLength(0);
    expect(await repliesTo(sent.event.id)).toHaveLength(0);
    const job = await jobFor(sent.event.id);
    expect(job).toMatchObject({ state: 'expired', outcome: AI_JOB_OUTCOMES.stale, attempts: 1 });

    const notes = await notesOf(sent.chat.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'system_message',
      author_type: 'system',
      recipients: 'agents',
      properties: {
        system_event: AI_JOB_HANDOVER_EVENT,
        reason: 'stale',
        trigger_event_id: sent.event.id,
      },
    });
    // The visitor never sees it.
    const visible = await chats.listEvents(ctx(fx.a), who.principal, sent.chat.id, { limit: 50 });
    expect(visible.items.map((e) => e.properties['system_event'])).not.toContain(
      AI_JOB_HANDOVER_EVENT,
    );

    const decisions = await owner.aiDecisionLog.findMany({ where: { jobId: job.id } });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      decision: 'expired',
      handoffReason: 'stale',
      triggerEventId: sent.event.id,
      chatId: sent.chat.id,
      threadId: sent.event.thread_id,
      customerId: who.customerId,
      requestId: 'req-worker-0001',
    });
  });

  it('a job just inside 120 s is still answered', async () => {
    const who = await member();
    const w = worker({ handler: replying(), now: () => new Date(Date.now() + 115_000) });
    const sent = await send(who, 'Hello');
    await w.idle();
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
    expect(await notesOf(sent.chat.id)).toHaveLength(0);
  });

  it('a job every attempt of which died is handed to a person without running the handler', async () => {
    const who = await member();
    const sent = await send(who, 'Hello', { outbox: false });
    const past = new Date(Date.now() - 5_000);
    await owner.aiJob.create({
      data: {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        chatId: sent.chat.id,
        threadId: sent.event.thread_id,
        triggerEventId: sent.event.id,
        kind: 'visitor_message',
        state: 'running',
        attempts: 2,
        startedAt: past,
        leaseUntil: past,
      },
    });
    const calls: AiJobRun[] = [];
    const w = worker({ handler: replying({ calls }) });
    await w.idle();

    expect(calls).toHaveLength(0);
    const job = await jobFor(sent.event.id);
    expect(job).toMatchObject({
      state: 'failed',
      outcome: AI_JOB_OUTCOMES.attemptsExhausted,
      attempts: 3,
    });
    expect((await notesOf(sent.chat.id))[0]?.properties).toMatchObject({
      reason: 'attempts_exhausted',
    });
    expect(await owner.aiDecisionLog.findMany({ where: { jobId: job.id } })).toMatchObject([
      { decision: 'handoff', handoffReason: 'attempts_exhausted' },
    ]);
  });

  it('a message that has its answer already is not answered again', async () => {
    const who = await member();
    const sent = await send(who, 'Hello');
    // An answer that got out without the job hearing of it.
    await chats.sendEvent(ctx(fx.a), botPrincipal(ctx(fx.a)), sent.chat.id, {
      type: 'message',
      text: 'Earlier answer',
      recipients: 'all',
      properties: { reply_to_event_id: sent.event.id },
    });
    const calls: AiJobRun[] = [];
    const w = worker({ handler: replying({ calls }) });
    await w.idle();

    expect(calls).toHaveLength(0);
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'done',
      outcome: AI_JOB_OUTCOMES.alreadyAnswered,
    });
  });

  it('the reply guard refuses a second answer written inside one run', async () => {
    const who = await member();
    let second: unknown = null;
    const w = worker({
      handler: async (run) => {
        await replying()(run);
        try {
          await replying()(run);
        } catch (error) {
          second = error;
        }
      },
    });
    const sent = await send(who, 'Hello');
    await w.idle();
    expect(second).toBeInstanceOf(AiJobReplyRefusedError);
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
    expect(await jobFor(sent.event.id)).toMatchObject({ state: 'done', outcome: 'replied' });
  });

  it('an answer that arrives while the handler runs is not doubled', async () => {
    const who = await member();
    let refused: unknown = null;
    const w = worker({
      handler: async (run) => {
        // Somebody else answers the message after the worker's own check.
        await chats.sendEvent(run.job.context, botPrincipal(run.job.context), run.job.chatId, {
          type: 'message',
          text: 'Answered elsewhere',
          recipients: 'all',
          properties: { ...run.replyProperties },
        });
        try {
          await replying()(run);
        } catch (error) {
          refused = error;
        }
      },
    });
    const sent = await send(who, 'Hello');
    await w.idle();
    expect((refused as AiJobReplyRefusedError).reason).toBe('already_answered');
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'done',
      outcome: AI_JOB_OUTCOMES.alreadyAnswered,
    });
  });

  it('a reply that would land on a newer connection is refused, and that connection gets its own answer', async () => {
    const who = await member();
    let refused: unknown = null;
    let newer: ConnectionResult | null = null;
    const w = worker({
      handler: async (run) => {
        if (!newer) {
          // While the model thinks, the connection closes and the visitor
          // writes again: the chat's open connection is a new one now.
          await chats.deactivate(ctx(fx.a), who.principal, run.job.chatId, auditContextFor(fx.a));
          newer = await send(who, 'Me again');
        }
        try {
          await replying()(run);
        } catch (error) {
          refused = error;
          throw error;
        }
      },
    });
    const sent = await send(who, 'Hello');
    await waitFor('both jobs to finish', async () => (await unfinished()) === 0);
    await w.idle();

    expect((refused as AiJobReplyRefusedError).reason).toBe('connection_closed');
    expect(await repliesTo(sent.event.id)).toHaveLength(0);
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'expired',
      outcome: AI_JOB_OUTCOMES.connectionClosed,
    });
    const answered = newer as ConnectionResult | null;
    expect(answered!.event.thread_id).not.toBe(sent.event.thread_id);
    expect(await repliesTo(answered!.event.id)).toHaveLength(1);
  });

  it('a reply without the mark is refused outright', async () => {
    const who = await member();
    let refused: unknown = null;
    const w = worker({
      handler: async (run) => {
        try {
          await chats.sendEvent(
            run.job.context,
            botPrincipal(run.job.context),
            run.job.chatId,
            { type: 'message', text: 'Unmarked', recipients: 'all' },
            { outbox: run.replyOutbox },
          );
        } catch (error) {
          refused = error;
        }
      },
    });
    const sent = await send(who, 'Hello');
    await w.idle();
    expect(String(refused)).toMatch(/must carry run\.replyProperties/);
    const events = await owner.event.count({ where: { chatId: sent.chat.id, authorType: 'bot' } });
    expect(events).toBe(0);
  });

  it('a closed connection is not answered and gets no note', async () => {
    const who = await member();
    const sent = await send(who, 'Bye');
    await chats.deactivate(ctx(fx.a), who.principal, sent.chat.id, auditContextFor(fx.a));
    const calls: AiJobRun[] = [];
    const w = worker({ handler: replying({ calls }) });
    await w.idle();

    expect(calls).toHaveLength(0);
    const job = await jobFor(sent.event.id);
    expect(job).toMatchObject({ state: 'expired', outcome: AI_JOB_OUTCOMES.connectionClosed });
    expect(await notesOf(sent.chat.id)).toHaveLength(0);
    expect(await owner.aiDecisionLog.findMany({ where: { jobId: job.id } })).toMatchObject([
      { decision: 'expired' },
    ]);
  });

  // --- 6. A handler that throws ------------------------------------------------------

  it('a handler that throws is tried once more and answers then', async () => {
    const who = await member();
    let calls = 0;
    const w = worker({
      retryAfterMs: 0,
      handler: async (run) => {
        calls += 1;
        if (calls === 1) throw new TypeError('first try fails');
        await replying()(run);
      },
    });
    const sent = await send(who, 'Hello');
    await waitFor('the job to finish', async () => (await unfinished()) === 0);
    // The decision record is written just after the job settles.
    await w.idle();
    expect(calls).toBe(2);
    expect(await repliesTo(sent.event.id)).toHaveLength(1);
    expect(await jobFor(sent.event.id)).toMatchObject({
      state: 'done',
      attempts: 2,
      lastError: 'TypeError',
    });
  });

  it('a handler that throws on its last attempt hands the message to a person', async () => {
    const who = await member();
    let calls = 0;
    const w = worker({
      retryAfterMs: 0,
      handler: async () => {
        calls += 1;
        throw new RangeError('never works');
      },
    });
    const sent = await send(who, 'Hello');
    await waitFor('the job to finish', async () => (await unfinished()) === 0);
    // The decision record is written just after the job settles.
    await w.idle();
    expect(calls).toBe(2);
    const job = await jobFor(sent.event.id);
    expect(job).toMatchObject({
      state: 'failed',
      outcome: AI_JOB_OUTCOMES.handlerFailed,
      attempts: 2,
      lastError: 'RangeError',
    });
    expect((await notesOf(sent.chat.id))[0]?.properties).toMatchObject({
      reason: 'handler_failed',
    });
    expect(await owner.aiDecisionLog.findMany({ where: { jobId: job.id } })).toMatchObject([
      { decision: 'handoff', handoffReason: 'handler_failed', errorType: 'RangeError' },
    ]);
  });

  // --- 7. The doorbell -----------------------------------------------------------------

  describe('the doorbell (LISTEN ai_jobs)', () => {
    it('wakes a worker at once — its poll is a minute away', async () => {
      const lines: LogLine[] = [];
      const bell = pgWakeups({
        connectionString: listenConnectionString(APP_URL!)!,
        logger: recordingLogger(lines),
      });
      let rung = 0;
      const counting: AiJobWakeups = {
        start: (onWake) =>
          bell.start(() => {
            rung += 1;
            onWake();
          }),
        stop: () => bell.stop(),
      };
      const calls: AiJobRun[] = [];
      worker({ pollMs: 60_000, wakeups: counting, handler: replying({ calls }) });
      await waitFor('the doorbell to connect', () => rung >= 1);

      const who = await member();
      const sentAt = Date.now();
      const sent = await send(who, 'Ring ring');
      await waitFor('the job to run', () => calls.length === 1, 5_000);
      expect(Date.now() - sentAt).toBeLessThan(3_000);
      await waitFor('the reply', async () => (await repliesTo(sent.event.id)).length === 1);
      expect(lines.filter((l) => l.level === 'warn')).toEqual([]);
    });

    it('rings when an enqueue commits and not when it rolls back', async () => {
      const listener = new pg.Client({ connectionString: listenConnectionString(APP_URL!)! });
      const heard: string[] = [];
      listener.on('notification', (message) => heard.push(message.channel));
      await listener.connect();
      try {
        await listener.query(`LISTEN ${AI_JOBS_CHANNEL}`);
        const who = await member();

        await expect(
          chats.openOrContinueConnection(ctx(fx.a), who.principal, {
            customerId: who.customerId,
            event: { type: 'message', text: 'Rolled back', recipients: 'all' },
            audit: auditContextFor(fx.a, { actorId: who.customerId, actorType: 'customer' }),
            outbox: async (tx, written) => {
              await aiJobOutbox()(tx, written);
              throw new Error('after the job');
            },
          }),
        ).rejects.toThrow('after the job');
        await sleep(300);
        expect(heard).toEqual([]);

        await send(who, 'Committed');
        await waitFor('the notification', () => heard.length > 0, 5_000);
        expect(heard).toEqual([AI_JOBS_CHANNEL]);
      } finally {
        await listener.end();
      }
    });

    it('a doorbell that cannot connect is one warning, and the poll still answers', async () => {
      const lines: LogLine[] = [];
      const unreachable = new URL(APP_URL!);
      unreachable.port = '1';
      const w = worker({
        wakeups: pgWakeups({
          connectionString: listenConnectionString(unreachable.toString())!,
          logger: recordingLogger(lines),
          reconnectMs: 50,
          maxReconnectMs: 100,
        }),
        handler: replying(),
      });
      await waitFor('the warning', () => lines.some((l) => l.level === 'warn'));
      const who = await member();
      const sent = await send(who, 'Polling');
      await waitFor('the reply', async () => (await repliesTo(sent.event.id)).length === 1);
      await w.stop();
      await sleep(300);
      expect(lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    });
  });

  // --- 8. Latency -------------------------------------------------------------------------

  it('starts a job within a second of its message, p95 (GV-02 acceptance)', async () => {
    const bell = pgWakeups({
      connectionString: listenConnectionString(APP_URL!)!,
      logger: recordingLogger(),
    });
    const w = worker({ wakeups: bell, handler: replying() });
    await w.idle();
    const sent: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const who = await member();
      sent.push((await send(who, `Message ${i}`)).event.id);
      await sleep(25);
    }
    await waitFor('every job to finish', async () => (await unfinished()) === 0, 20_000);

    const waits = (await owner.aiJob.findMany({ where: { triggerEventId: { in: sent } } }))
      .map((job) => job.startedAt!.getTime() - job.createdAt.getTime())
      .sort((a, b) => a - b);
    const p95 = waits[Math.ceil(waits.length * 0.95) - 1]!;
    expect(waits).toHaveLength(20);
    expect(p95).toBeLessThan(1_000);
  });
});
