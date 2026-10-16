/**
 * The outbox: the AI job a visitor's message is owed is written in the
 * message's own transaction (tm 289.2 · ADR-11a §2.1 · SiyahTuş analysis
 * GV-02).
 *
 * The one property, from both sides — a committed message has its job, and a
 * message that did not commit has none:
 *
 *   1. Each way a message lands — the day's first, one continuing the open
 *      connection, a return the same day; `sendEvent`; `start`'s opening
 *      line — commits exactly one job naming it, in the writer's tenant.
 *   2. A failure after the job was written takes the job down with the
 *      message, and a job that cannot be written takes the message down.
 *   3. A replay writes nothing; two tabs racing the day's first message
 *      leave one job per message.
 *   4. Jobs of one chat are created in the order their messages were, under
 *      real concurrency — the per-chat order the claim reads.
 *   5. A chat already holding 20 unfinished jobs gets its next one `expired`
 *      at the door; the message itself still commits.
 */
import { PrismaClient } from '@prisma/client';
import { buildEventId } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import type { AgentPrincipal, CustomerPrincipal } from '../../src/services/auth/principal.js';
import {
  AI_JOB_BACKLOG_OUTCOME,
  AI_JOB_MAX_UNFINISHED_PER_CHAT,
  aiJobOutbox,
} from '../../src/services/ai/ai-jobs.js';
import {
  ChatService,
  type ConnectionResult,
  type EventOutbox,
  type OutboxEvent,
} from '../../src/services/chat/chat-service.js';
import {
  auditContextFor,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const REQUEST_ID = 'req-outbox-0001';
const RACERS = 6;

/** The send path's idempotency cache, unused unless a test needs a replay. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

/** An idempotency cache that remembers, for the replay. */
function memoryRedis() {
  const values = new Map<string, string>();
  return {
    set: async (key: string, value: string): Promise<string | null> => {
      if (values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    get: async (key: string): Promise<string | null> => values.get(key) ?? null,
  };
}

interface Member {
  customerId: string;
  principal: CustomerPrincipal;
}

describe('the AI job outbox (GV-02 · ADR-11a §2.1)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let seq = 0;

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  const agent = (t: TenantFixture): AgentPrincipal => ({
    kind: 'agent',
    accountId: t.agentAccountId,
    licenseId: t.licenseId,
    organizationId: t.organizationId,
    role: 'agent',
    scopes: ['chats--all:rw', 'chats--all:ro'],
    tokenId: 'test-token',
    tokenKind: 'pat',
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

  /** A visitor's message, the way the widget's route sends one. */
  function send(
    who: Member,
    text: string,
    options: {
      outbox?: EventOutbox | null;
      service?: ChatService;
      idempotencyKey?: string;
      t?: TenantFixture;
    } = {},
  ): Promise<ConnectionResult> {
    const t = options.t ?? fx.a;
    const outbox =
      options.outbox === null
        ? undefined
        : (options.outbox ?? aiJobOutbox({ requestId: REQUEST_ID }));
    return (options.service ?? new ChatService(appRole, NO_REDIS)).openOrContinueConnection(
      ctx(t),
      who.principal,
      {
        customerId: who.customerId,
        event: {
          type: 'message',
          text,
          recipients: 'all',
          ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        },
        audit: auditContextFor(t, { actorId: who.customerId, actorType: 'customer' }),
        ...(outbox ? { outbox } : {}),
      },
    );
  }

  /** Records what the service handed the outbox, then writes the job. */
  function recordingOutbox(seen: OutboxEvent[]): EventOutbox {
    const write = aiJobOutbox({ requestId: REQUEST_ID });
    return async (tx, written) => {
      seen.push(written);
      await write(tx, written);
    };
  }

  /** Writes the job, then fails — anything after the job in the same transaction. */
  const failingAfterTheJob: EventOutbox = async (tx, written) => {
    await aiJobOutbox()(tx, written);
    throw new Error('after the job');
  };

  const jobsOf = (chatId: string) =>
    owner.aiJob.findMany({ where: { chatId }, orderBy: { createdAt: 'asc' } });

  /** In the order they were written (`event_sequence` is not in the Prisma model). */
  const visitorMessagesOf = (chatId: string) =>
    owner.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM events
       WHERE chat_id = ${chatId} AND author_type = 'customer'
       ORDER BY created_at, event_sequence`;

  /** Planted as the owner, so a scenario can fill a chat's queue in any state. */
  async function plantJob(
    t: TenantFixture,
    at: { chatId: string; threadId: string },
    data: { state?: string; triggerEventId?: string } = {},
  ): Promise<void> {
    seq += 1;
    const state = data.state ?? 'pending';
    const now = new Date();
    await owner.aiJob.create({
      data: {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        chatId: at.chatId,
        threadId: at.threadId,
        triggerEventId: data.triggerEventId ?? `planted-${seq}`,
        kind: 'visitor_message',
        state,
        ...(state === 'running'
          ? { attempts: 1, startedAt: now, leaseUntil: new Date(now.getTime() + 60_000) }
          : {}),
        ...(state === 'done'
          ? { attempts: 1, startedAt: now, finishedAt: now, outcome: 'answered' }
          : {}),
      },
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  // --- 1. One job per committed message ---------------------------------------

  describe('a committed message has its job', () => {
    it("files the day's first message, a continuing one and a same-day return each with one job", async () => {
      const who = await member();
      const seen: OutboxEvent[] = [];
      const outbox = recordingOutbox(seen);

      const first = await send(who, 'Hello', { outbox });
      const second = await send(who, 'Anyone there?', { outbox });
      await new ChatService(appRole, NO_REDIS).deactivate(
        ctx(fx.a),
        who.principal,
        first.chat.id,
        auditContextFor(fx.a),
      );
      const back = await send(who, 'Me again', { outbox });

      expect(back.chat.id).toBe(first.chat.id);
      expect(seen.map((s) => s.openedVia)).toEqual(['first_of_day', null, 'same_day_return']);
      expect(seen.map((s) => s.event.id)).toEqual([first.event.id, second.event.id, back.event.id]);

      const jobs = await jobsOf(first.chat.id);
      expect(
        jobs.map((j) => ({
          triggerEventId: j.triggerEventId,
          threadId: j.threadId,
          kind: j.kind,
          state: j.state,
          attempts: j.attempts,
          requestId: j.requestId,
          leaseUntil: j.leaseUntil,
          startedAt: j.startedAt,
          finishedAt: j.finishedAt,
        })),
      ).toEqual(
        [first, second, back].map((r) => ({
          triggerEventId: r.event.id,
          threadId: r.event.thread_id,
          kind: 'visitor_message',
          state: 'pending',
          attempts: 0,
          requestId: REQUEST_ID,
          leaseUntil: null,
          startedAt: null,
          finishedAt: null,
        })),
      );
      // The return opened a connection of its own, and its job names it.
      expect(back.event.thread_id).not.toBe(first.event.thread_id);
    });

    it("files the job under the writer's tenant, invisible to another workspace (NFR-S4)", async () => {
      const who = await member();
      const sent = await send(who, 'Hello');

      const [job] = await jobsOf(sent.chat.id);
      expect(job).toMatchObject({
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
      });
      const counts = await Promise.all(
        [fx.a, fx.b].map((t) => withTenant(appRole, ctx(t), (tx) => tx.aiJob.count())),
      );
      expect(counts).toEqual([1, 0]);
    });

    it('commits a job with an event sendEvent writes', async () => {
      const who = await member();
      const opened = await send(who, 'Hello', { outbox: null });

      const sent = await new ChatService(appRole, NO_REDIS).sendEvent(
        ctx(fx.a),
        who.principal,
        opened.chat.id,
        { type: 'message', text: 'Over the other door', recipients: 'all' },
        { outbox: aiJobOutbox({ requestId: REQUEST_ID }) },
      );

      const jobs = await jobsOf(opened.chat.id);
      expect(jobs.map((j) => [j.triggerEventId, j.threadId])).toEqual([
        [sent.event.id, opened.event.thread_id],
      ]);
    });

    it("commits a job with start's opening line, and calls nothing without one", async () => {
      const service = new ChatService(appRole, NO_REDIS);
      const seen: OutboxEvent[] = [];
      const outbox = recordingOutbox(seen);
      const quiet = await member();
      const greeted = await member();

      const silent = await service.start(ctx(fx.a), agent(fx.a), {
        customerId: quiet.customerId,
        assignToMe: true,
        audit: auditContextFor(fx.a),
        outbox,
      });
      const started = await service.start(ctx(fx.a), agent(fx.a), {
        customerId: greeted.customerId,
        assignToMe: true,
        initialEvent: { type: 'message', text: 'Hi, following up', recipients: 'all' },
        audit: auditContextFor(fx.a),
        outbox,
      });

      expect(seen.map((s) => [s.chatId, s.openedVia])).toEqual([[started.chat.id, 'agent_start']]);
      expect(await jobsOf(silent.chat.id)).toEqual([]);
      const jobs = await jobsOf(started.chat.id);
      expect(jobs.map((j) => j.triggerEventId)).toEqual([seen[0]!.event.id]);
      expect(seen[0]!.threadId).toBe(started.chat.thread?.id);
    });

    it('leaves out a request id that is not one, and still commits both', async () => {
      const who = await member();
      const sent = await send(who, 'Hello', {
        outbox: aiJobOutbox({ requestId: 'x'.repeat(65) }),
      });

      const jobs = await jobsOf(sent.chat.id);
      expect(jobs.map((j) => [j.triggerEventId, j.requestId])).toEqual([[sent.event.id, null]]);
    });
  });

  // --- 2. Both or neither -------------------------------------------------------

  describe('a message that did not commit has no job', () => {
    it("rolls the job back with the day's first message when the transaction fails after it", async () => {
      const who = await member();

      await expect(send(who, 'Hello', { outbox: failingAfterTheJob })).rejects.toThrow(
        'after the job',
      );

      expect(await owner.chat.count({ where: { customerId: who.customerId } })).toBe(0);
      expect(await owner.event.count({ where: { authorId: who.customerId } })).toBe(0);
      expect(await owner.aiJob.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('rolls the job back with a continuing message, and the sequence with it', async () => {
      const who = await member();
      const first = await send(who, 'Hello');
      const sequence = async () =>
        (
          await owner.thread.findUniqueOrThrow({
            where: { id: first.event.thread_id },
            select: { eventSequence: true },
          })
        ).eventSequence;
      const before = await sequence();

      await expect(send(who, 'Second', { outbox: failingAfterTheJob })).rejects.toThrow(
        'after the job',
      );

      expect(await sequence()).toBe(before);
      expect((await visitorMessagesOf(first.chat.id)).map((e) => e.id)).toEqual([first.event.id]);
      expect((await jobsOf(first.chat.id)).map((j) => j.triggerEventId)).toEqual([first.event.id]);
    });

    it('rolls the message back when its job cannot be written', async () => {
      const who = await member();
      const first = await send(who, 'Hello');
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: first.event.thread_id },
        select: { eventSequence: true },
      });
      // The next message's id is already taken in the queue — one job per
      // message and kind, so this job's insert is refused.
      const nextEventId = buildEventId(first.event.thread_id, thread.eventSequence + 1);
      await plantJob(
        fx.a,
        { chatId: first.chat.id, threadId: first.event.thread_id },
        { triggerEventId: nextEventId },
      );

      await expect(send(who, 'Second')).rejects.toThrow();

      expect((await visitorMessagesOf(first.chat.id)).map((e) => e.id)).toEqual([first.event.id]);
      expect(
        await owner.event.count({ where: { id: nextEventId, threadId: first.event.thread_id } }),
      ).toBe(0);
    });

    it('rolls the job back with an event sendEvent fails to commit', async () => {
      const who = await member();
      const opened = await send(who, 'Hello', { outbox: null });

      await expect(
        new ChatService(appRole, NO_REDIS).sendEvent(
          ctx(fx.a),
          who.principal,
          opened.chat.id,
          { type: 'message', text: 'Lost', recipients: 'all' },
          { outbox: failingAfterTheJob },
        ),
      ).rejects.toThrow('after the job');

      expect((await visitorMessagesOf(opened.chat.id)).map((e) => e.id)).toEqual([opened.event.id]);
      expect(await jobsOf(opened.chat.id)).toEqual([]);
    });
  });

  // --- 3. Replays and races -----------------------------------------------------

  describe('replays and races', () => {
    it('writes no second job for a replayed message', async () => {
      const who = await member();
      const service = new ChatService(appRole, memoryRedis());

      const first = await send(who, 'Hello', { service, idempotencyKey: 'tab-retry-1' });
      const again = await send(who, 'Hello', { service, idempotencyKey: 'tab-retry-1' });

      expect(again.replayed).toBe(true);
      expect(again.event.id).toBe(first.event.id);
      expect((await jobsOf(first.chat.id)).map((j) => j.triggerEventId)).toEqual([first.event.id]);
    });

    describe('over separate connections', () => {
      let clients: PrismaClient[];

      beforeAll(async () => {
        // One client serialises a burst on its warm connection; separate,
        // pre-connected clients are what make the transactions overlap.
        clients = Array.from(
          { length: RACERS },
          () => new PrismaClient({ datasourceUrl: APP_URL }),
        );
        await Promise.all(clients.map((c) => c.$queryRaw`SELECT 1`));
      });

      afterAll(async () => {
        await Promise.all(clients.map((c) => c.$disconnect()));
      });

      const race = (who: Member, label: string) =>
        Promise.all(
          clients.map((client, i) =>
            send(who, `${label} ${i}`, { service: new ChatService(client, NO_REDIS) }),
          ),
        );

      it("leaves one job per message when tabs race the day's first message", async () => {
        const who = await member();
        const results = await race(who, 'first');

        const chatId = results[0]!.chat.id;
        const messages = await visitorMessagesOf(chatId);
        expect(messages).toHaveLength(RACERS);
        const jobs = await jobsOf(chatId);
        expect(jobs.map((j) => j.triggerEventId).sort()).toEqual(messages.map((e) => e.id).sort());
      });

      it('creates the jobs of one chat in the order its messages were written', async () => {
        const who = await member();
        const first = await send(who, 'Opening');

        for (let round = 0; round < 3; round += 1) await race(who, `round ${round}`);

        // The thread's sequence is the order the chat row's lock let them in.
        const messages = await owner.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM events
           WHERE thread_id = ${first.event.thread_id} AND author_type = 'customer'
           ORDER BY event_sequence`;
        expect(messages).toHaveLength(1 + 3 * RACERS);
        const jobs = await jobsOf(first.chat.id);
        expect(jobs.map((j) => j.triggerEventId)).toEqual(messages.map((e) => e.id));
      });
    });
  });

  // --- 4. The per-chat ceiling ------------------------------------------------

  describe('a chat too far behind', () => {
    it(`expires the job at the door once ${AI_JOB_MAX_UNFINISHED_PER_CHAT} are unfinished, and keeps the message`, async () => {
      const who = await member();
      const first = await send(who, 'Hello');
      const at = { chatId: first.chat.id, threadId: first.event.thread_id };
      // With the first message's own job: 19 unfinished, one of them running.
      // Finished jobs do not count.
      for (let i = 0; i < AI_JOB_MAX_UNFINISHED_PER_CHAT - 3; i += 1) await plantJob(fx.a, at);
      await plantJob(fx.a, at, { state: 'running' });
      for (let i = 0; i < 3; i += 1) await plantJob(fx.a, at, { state: 'done' });

      const last = await send(who, 'Twentieth');
      const over = await send(who, 'Twenty-first');
      const overAgain = await send(who, 'Twenty-second');

      const byTrigger = new Map((await jobsOf(at.chatId)).map((j) => [j.triggerEventId, j]));
      expect(byTrigger.get(last.event.id)).toMatchObject({ state: 'pending', outcome: null });
      for (const sent of [over, overAgain]) {
        const job = byTrigger.get(sent.event.id);
        expect(job).toMatchObject({
          state: 'expired',
          outcome: AI_JOB_BACKLOG_OUTCOME,
          attempts: 0,
          leaseUntil: null,
          startedAt: null,
          requestId: REQUEST_ID,
        });
        expect(job?.finishedAt).toBeInstanceOf(Date);
      }
      expect((await visitorMessagesOf(at.chatId)).map((e) => e.id)).toEqual(
        expect.arrayContaining([last.event.id, over.event.id, overAgain.event.id]),
      );
    });

    it("counts only the chat's own jobs", async () => {
      const busy = await member();
      const busyChat = await send(busy, 'Hello');
      const at = { chatId: busyChat.chat.id, threadId: busyChat.event.thread_id };
      for (let i = 0; i < AI_JOB_MAX_UNFINISHED_PER_CHAT; i += 1) await plantJob(fx.a, at);

      const other = await send(await member(), 'Hello');

      expect((await jobsOf(other.chat.id)).map((j) => j.state)).toEqual(['pending']);
    });
  });
});
