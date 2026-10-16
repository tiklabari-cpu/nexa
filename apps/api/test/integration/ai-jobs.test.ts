/**
 * The durable AI job queue's table and its two functions (tm 289.1 · ADR-11a ·
 * SiyahTuş analysis GV-02).
 *
 * What has to hold, each asserted on its own because each can fail alone:
 *
 *   1. Isolation — a workspace reads only its own jobs, and the runtime role
 *      can enqueue a new job into its own tenant and nothing else: not into
 *      another licence or organization, not a job that is already running,
 *      and it cannot edit or delete one (state moves through the functions).
 *   2. The table's own rules — one job per message, a known kind, a code as
 *      the outcome, a lease on every running job; rows go with their thread.
 *   3. `ai_jobs_claim` — leases due jobs across workspaces, one chat at a
 *      time in arrival order, never promotes a chat's next job past a head
 *      another worker holds, re-takes a job whose worker died, hands an
 *      exhausted job back once and then fails it by itself, and gives every
 *      job to exactly one of several concurrent workers.
 *   4. `ai_jobs_settle` — needs the job's tenant, is fenced by the claim's
 *      attempt number, finishes a job once, and can hand one back with a delay.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import {
  AI_JOB_MAX_ATTEMPTS,
  claimAiJobs,
  settleAiJob,
  type AiJobClaim,
  type AiJobResult,
} from '../../src/services/ai/ai-jobs.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const LEASE_MS = 30_000;

describe('ai_jobs (GV-02 · ADR-11a)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let seq = 0;

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  const nextId = (prefix: string): string => {
    seq += 1;
    return prefix + String(seq).padStart(11, '0');
  };

  /**
   * Inactive, so one customer can hold several (one active chat per customer
   * is the chat model's invariant). The queue does not look at activity —
   * eligibility is the worker's call.
   */
  async function seedChat(t: TenantFixture): Promise<{ chatId: string; threadId: string }> {
    const chatId = nextId('c');
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: t.customerId, active: false },
    });
    const threadId = nextId('t');
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: false, closedAt: new Date() },
    });
    return { chatId, threadId };
  }

  /**
   * Planted as the owner so a scenario can set any column. `createdAt` is
   * explicit so "oldest first" does not depend on insert timing.
   */
  async function seedJob(
    t: TenantFixture,
    chat: { chatId: string; threadId: string },
    data: {
      createdAt?: Date;
      availableAt?: Date;
      state?: string;
      attempts?: number;
      leaseUntil?: Date | null;
      startedAt?: Date | null;
    } = {},
  ): Promise<string> {
    const row = await owner.aiJob.create({
      data: {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        chatId: chat.chatId,
        threadId: chat.threadId,
        triggerEventId: nextId('e'),
        kind: 'visitor_message',
        ...data,
      },
      select: { id: true },
    });
    return row.id;
  }

  const job = (id: string) => owner.aiJob.findUniqueOrThrow({ where: { id } });
  const ago = (ms: number): Date => new Date(Date.now() - ms);

  const claim = (db: PrismaClient = appRole, limit = 10): Promise<AiJobClaim[]> =>
    claimAiJobs(db, { limit, leaseMs: LEASE_MS });

  const settle = (
    claimed: AiJobClaim,
    result: AiJobResult,
    db: PrismaClient = appRole,
  ): Promise<boolean> => withTenant(db, claimed.context, (tx) => settleAiJob(tx, claimed, result));

  /** Pre-connected runtime-role clients: one pool would drain a burst sequentially. */
  async function connectedClients(n: number): Promise<PrismaClient[]> {
    const clients = Array.from({ length: n }, () => new PrismaClient({ datasourceUrl: APP_URL }));
    await Promise.all(clients.map((c) => c.$queryRaw`SELECT 1`));
    return clients;
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

  // --- 1. Isolation ----------------------------------------------------------

  describe('isolation and write rules', () => {
    it("never shows one workspace another workspace's jobs (NFR-S4)", async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);

      const seenByB = await withTenant(appRole, ctx(fx.b), (tx) =>
        Promise.all([tx.aiJob.findUnique({ where: { id } }), tx.aiJob.count()]),
      );
      expect(seenByB).toEqual([null, 0]);

      const seenByA = await withTenant(appRole, ctx(fx.a), (tx) =>
        tx.aiJob.findUnique({ where: { id } }),
      );
      expect(seenByA?.chatId).toBe(chat.chatId);
    });

    it("enqueues a new job into the caller's own tenant and nowhere else (NFR-S4)", async () => {
      const chat = await seedChat(fx.a);
      const base = {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        chatId: chat.chatId,
        threadId: chat.threadId,
        kind: 'visitor_message',
      };
      const enqueue = (data: Record<string, unknown>) =>
        withTenant(appRole, ctx(fx.a), (tx) =>
          tx.aiJob.create({ data: { ...base, triggerEventId: nextId('e'), ...data } }),
        );

      const queued = await enqueue({});
      expect(queued.state).toBe('pending');
      expect(queued.attempts).toBe(0);
      // Expired at the door (the per-chat ceiling) is a new job too.
      await expect(
        enqueue({ state: 'expired', finishedAt: new Date(), outcome: 'too_many_pending' }),
      ).resolves.toMatchObject({ state: 'expired' });

      // The refusals go through `createMany`: it sends no RETURNING, so the
      // read policy cannot catch the row on its way out — these are the insert
      // policy's own.
      const enqueueBare = (data: Record<string, unknown>) =>
        withTenant(appRole, ctx(fx.a), (tx) =>
          tx.aiJob.createMany({ data: [{ ...base, triggerEventId: nextId('e'), ...data }] }),
        );
      await expect(enqueueBare({})).resolves.toEqual({ count: 1 });

      // Another workspace's licence, or the right licence under another organization.
      await expect(enqueueBare({ licenseId: fx.b.licenseId })).rejects.toThrow(
        /row-level security/,
      );
      await expect(enqueueBare({ organizationId: fx.b.organizationId })).rejects.toThrow(
        /row-level security/,
      );
      // A job that is already running, already attempted or already finished is not an enqueue.
      await expect(
        enqueueBare({
          state: 'running',
          leaseUntil: new Date(Date.now() + LEASE_MS),
          startedAt: new Date(),
        }),
      ).rejects.toThrow(/row-level security/);
      await expect(enqueueBare({ attempts: 1 })).rejects.toThrow(/row-level security/);
      for (const state of ['done', 'failed']) {
        await expect(
          enqueueBare({ state, finishedAt: new Date(), outcome: 'answered' }),
        ).rejects.toThrow(/row-level security/);
      }

      expect(await owner.aiJob.count()).toBe(3);
    });

    it('cannot move or delete a job except through the functions', async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);

      await expect(
        withTenant(appRole, ctx(fx.a), (tx) =>
          tx.aiJob.update({ where: { id }, data: { state: 'done', finishedAt: new Date() } }),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withTenant(appRole, ctx(fx.a), (tx) => tx.aiJob.delete({ where: { id } })),
      ).rejects.toThrow(/permission denied/i);

      expect((await job(id)).state).toBe('pending');
    });

    it('refuses a second job for one message, an unknown kind, prose as an outcome and a running job without a lease', async () => {
      const chat = await seedChat(fx.a);
      const row = {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        chatId: chat.chatId,
        threadId: chat.threadId,
        kind: 'visitor_message',
      };
      await owner.aiJob.create({ data: { ...row, triggerEventId: 'e-dup' } });
      await expect(
        owner.aiJob.create({ data: { ...row, triggerEventId: 'e-dup' } }),
      ).rejects.toThrow(/Unique constraint failed/);

      await expect(
        owner.aiJob.create({
          data: { ...row, triggerEventId: nextId('e'), kind: 'agent_message' },
        }),
      ).rejects.toThrow(/ai_jobs_kind_check/);
      await expect(
        owner.aiJob.create({
          data: {
            ...row,
            triggerEventId: nextId('e'),
            state: 'done',
            finishedAt: new Date(),
            outcome: 'Answered the player',
          },
        }),
      ).rejects.toThrow(/ai_jobs_outcome_check/);
      await expect(
        owner.aiJob.create({
          data: { ...row, triggerEventId: nextId('e'), state: 'running', startedAt: new Date() },
        }),
      ).rejects.toThrow(/ai_jobs_state_shape_check/);
      await expect(
        owner.aiJob.create({ data: { ...row, triggerEventId: nextId('e'), state: 'done' } }),
      ).rejects.toThrow(/ai_jobs_state_shape_check/);
    });

    it('goes with its thread', async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);
      const other = await seedJob(fx.a, await seedChat(fx.a));

      await owner.thread.delete({ where: { id: chat.threadId } });

      expect(await owner.aiJob.findUnique({ where: { id } })).toBeNull();
      expect(await owner.aiJob.findUnique({ where: { id: other } })).not.toBeNull();
    });

    it('stamps the insert time, not the transaction start, as the order', async () => {
      const chat = await seedChat(fx.a);
      const [first, second] = await withTenant(appRole, ctx(fx.a), async (tx) => {
        const make = () =>
          tx.aiJob.create({
            data: {
              licenseId: fx.a.licenseId,
              organizationId: fx.a.organizationId,
              chatId: chat.chatId,
              threadId: chat.threadId,
              triggerEventId: nextId('e'),
              kind: 'visitor_message',
            },
          });
        const a = await make();
        await tx.$executeRaw`SELECT pg_sleep(0.01)`;
        return [a, await make()];
      });
      expect(second!.createdAt.getTime()).toBeGreaterThan(first!.createdAt.getTime());
    });
  });

  // --- 2. ai_jobs_claim ------------------------------------------------------

  describe('ai_jobs_claim', () => {
    it('leases due jobs across workspaces and hands back each tenant', async () => {
      const chatA = await seedChat(fx.a);
      const chatB = await seedChat(fx.b);
      const idA = await seedJob(fx.a, chatA, { createdAt: ago(2000) });
      const idB = await seedJob(fx.b, chatB, { createdAt: ago(1000) });

      const before = Date.now();
      const claimed = await claim();

      expect(claimed.map((c) => c.id)).toEqual([idA, idB]);
      expect(claimed[0]).toMatchObject({
        context: ctx(fx.a),
        chatId: chatA.chatId,
        threadId: chatA.threadId,
        kind: 'visitor_message',
        attempts: 1,
        exhausted: false,
      });
      expect(claimed[1]!.context).toEqual(ctx(fx.b));

      const row = await job(idA);
      expect(row.state).toBe('running');
      expect(row.attempts).toBe(1);
      expect(row.startedAt).not.toBeNull();
      const lease = row.leaseUntil!.getTime() - before;
      expect(lease).toBeGreaterThan(LEASE_MS - 5000);
      expect(lease).toBeLessThan(LEASE_MS + 5000);

      // Nothing else is due.
      expect(await claim()).toEqual([]);
    });

    it('takes one job per chat, oldest first, and the next only once the first is settled', async () => {
      const chat = await seedChat(fx.a);
      const other = await seedChat(fx.a);
      const first = await seedJob(fx.a, chat, { createdAt: ago(3000) });
      const second = await seedJob(fx.a, chat, { createdAt: ago(2000) });
      const elsewhere = await seedJob(fx.a, other, { createdAt: ago(1000) });

      const round1 = await claim();
      expect(round1.map((c) => c.id)).toEqual([first, elsewhere]);

      // The chat's head is running under a live lease: nothing from it.
      expect(await claim()).toEqual([]);

      expect(await settle(round1[0]!, { state: 'done', outcome: 'answered' })).toBe(true);
      const round3 = await claim();
      expect(round3.map((c) => c.id)).toEqual([second]);
    });

    it('takes the oldest due jobs first when there are more than the limit', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        ids.push(await seedJob(fx.a, await seedChat(fx.a), { createdAt: ago(10_000 - i * 1000) }));
      }
      expect((await claim(appRole, 3)).map((c) => c.id)).toEqual(ids.slice(0, 3));
      expect((await claim(appRole, 3)).map((c) => c.id)).toEqual(ids.slice(3));
    });

    it("never promotes a chat's next job past a head another worker is holding", async () => {
      const chat = await seedChat(fx.a);
      const head = await seedJob(fx.a, chat, { createdAt: ago(2000) });
      await seedJob(fx.a, chat, { createdAt: ago(1000) });
      const other = await seedJob(fx.a, await seedChat(fx.a), { createdAt: ago(500) });

      // Another worker's claim is mid-flight on the head: the row is locked
      // and still reads `pending` to everyone else.
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = owner.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM ai_jobs WHERE id = ${head}::uuid FOR UPDATE`;
          locked();
          await released;
        },
        { timeout: 20_000 },
      );
      try {
        await isLocked;
        const claimed = await claim();
        expect(claimed.map((c) => c.id)).toEqual([other]);
      } finally {
        release();
        await holder;
      }

      // Released and still pending, the head is the chat's next job again.
      expect((await claim()).map((c) => c.id)).toEqual([head]);
    });

    it('leaves a job until its available_at, and its chat behind it', async () => {
      const chat = await seedChat(fx.a);
      const later = await seedJob(fx.a, chat, {
        createdAt: ago(2000),
        availableAt: new Date(Date.now() + 60_000),
      });
      await seedJob(fx.a, chat, { createdAt: ago(1000) });

      expect(await claim()).toEqual([]);

      await owner.aiJob.update({ where: { id: later }, data: { availableAt: ago(1) } });
      expect((await claim()).map((c) => c.id)).toEqual([later]);
    });

    it("re-takes a job whose worker died, and fences the dead worker's settle", async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);
      const [firstClaim] = await claim();
      expect(firstClaim!.attempts).toBe(1);

      // A live lease is not re-taken.
      expect(await claim()).toEqual([]);

      await owner.aiJob.update({ where: { id }, data: { leaseUntil: ago(1) } });
      const [secondClaim] = await claim();
      expect(secondClaim).toMatchObject({ id, attempts: 2, exhausted: false });

      // The first worker comes back late: its number is stale.
      expect(await settle(firstClaim!, { state: 'done', outcome: 'answered' })).toBe(false);
      expect((await job(id)).state).toBe('running');

      expect(await settle(secondClaim!, { state: 'done', outcome: 'answered' })).toBe(true);
      expect(await job(id)).toMatchObject({ state: 'done', attempts: 2, outcome: 'answered' });
    });

    it('hands an exhausted job back once for the hand-over, then fails it by itself', async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat, {
        createdAt: ago(5000),
        state: 'running',
        attempts: AI_JOB_MAX_ATTEMPTS,
        startedAt: ago(4000),
        leaseUntil: ago(1),
      });
      const next = await seedJob(fx.a, chat, { createdAt: ago(1000) });

      const [lastPass] = await claim();
      expect(lastPass).toMatchObject({ id, attempts: AI_JOB_MAX_ATTEMPTS + 1, exhausted: true });

      // The hand-over pass dies too: the next claim fails the job and moves on.
      await owner.aiJob.update({ where: { id }, data: { leaseUntil: ago(1) } });
      const claimed = await claim();
      expect(claimed.map((c) => c.id)).toEqual([next]);

      const failed = await job(id);
      expect(failed).toMatchObject({
        state: 'failed',
        outcome: 'attempts_exhausted',
        leaseUntil: null,
        attempts: AI_JOB_MAX_ATTEMPTS + 1,
      });
      expect(failed.finishedAt).not.toBeNull();
      expect(failed.lastError).toMatch(/stopped/);
    });

    it('gives one due job to exactly one of several workers racing for it', async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);
      const clients = await connectedClients(8);
      try {
        const results = await Promise.all(clients.map((c) => claim(c)));
        expect(results.flat().map((c) => c.id)).toEqual([id]);

        // And a job whose lease ran out, to exactly one again.
        await owner.aiJob.update({ where: { id }, data: { leaseUntil: ago(1) } });
        const retaken = await Promise.all(clients.map((c) => claim(c)));
        expect(retaken.flat()).toEqual([expect.objectContaining({ id, attempts: 2 })]);
      } finally {
        await Promise.all(clients.map((c) => c.$disconnect()));
      }
    });

    it('runs every job exactly once and each chat in order under concurrent workers', async () => {
      const chats = await Promise.all(
        Array.from({ length: 6 }, (_, i) => seedChat(i % 2 === 0 ? fx.a : fx.b)),
      );
      let n = 0;
      for (let round = 0; round < 4; round += 1) {
        for (const [i, chat] of chats.entries()) {
          n += 1;
          await seedJob(i % 2 === 0 ? fx.a : fx.b, chat, { createdAt: ago(60_000 - n * 100) });
        }
      }
      const total = n;

      const clients = await connectedClients(4);
      const claimedIds: string[] = [];
      try {
        await Promise.all(
          clients.map(async (client) => {
            for (let idle = 0; claimedIds.length < total && idle < 200;) {
              const batch = await claim(client, 3);
              if (batch.length === 0) {
                idle += 1;
                await new Promise((resolve) => setTimeout(resolve, 5));
                continue;
              }
              for (const c of batch) {
                claimedIds.push(c.id);
                expect(await settle(c, { state: 'done', outcome: 'answered' }, client)).toBe(true);
              }
            }
          }),
        );
      } finally {
        await Promise.all(clients.map((c) => c.$disconnect()));
      }

      expect(claimedIds).toHaveLength(total);
      expect(new Set(claimedIds).size).toBe(total);

      const rows = await owner.aiJob.findMany({
        orderBy: [{ chatId: 'asc' }, { createdAt: 'asc' }],
      });
      expect(rows.every((r) => r.state === 'done' && r.attempts === 1)).toBe(true);
      // Within a chat, each job started only after the one before it finished.
      for (const chat of chats) {
        const own = rows.filter((r) => r.chatId === chat.chatId);
        expect(own).toHaveLength(4);
        for (let k = 1; k < own.length; k += 1) {
          expect(own[k]!.startedAt!.getTime()).toBeGreaterThanOrEqual(
            own[k - 1]!.finishedAt!.getTime(),
          );
        }
      }
    });

    it('refuses arguments outside its bounds', async () => {
      await expect(claimAiJobs(appRole, { limit: 0, leaseMs: LEASE_MS })).rejects.toThrow(
        RangeError,
      );
      await expect(claimAiJobs(appRole, { limit: 1, leaseMs: 0 })).rejects.toThrow(RangeError);
      // The database's own check, past the wrapper.
      await expect(
        appRole.$queryRaw`SELECT * FROM ai_jobs_claim(${1000}::int, ${30}::int)`,
      ).rejects.toThrow(/invalid argument/);
      await expect(
        appRole.$queryRaw`SELECT * FROM ai_jobs_claim(${1}::int, ${0}::int)`,
      ).rejects.toThrow(/invalid argument/);
    });
  });

  // --- 3. ai_jobs_settle -----------------------------------------------------

  describe('ai_jobs_settle', () => {
    it("needs a tenant, and does not find another workspace's job (NFR-S4)", async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);
      const [claimed] = await claim();

      await expect(
        appRole.$queryRaw`SELECT ai_jobs_settle(${id}::uuid, ${1}::int, 'done', 'answered')`,
      ).rejects.toThrow(/needs a tenant context/);

      const byB = await withTenant(appRole, ctx(fx.b), (tx) =>
        settleAiJob(tx, claimed!, { state: 'done', outcome: 'answered' }),
      );
      expect(byB).toBe(false);
      expect((await job(id)).state).toBe('running');
    });

    it('finishes a job once', async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);
      const [claimed] = await claim();

      expect(await settle(claimed!, { state: 'expired', outcome: 'stale' })).toBe(true);
      const row = await job(id);
      expect(row).toMatchObject({ state: 'expired', outcome: 'stale', leaseUntil: null });
      expect(row.finishedAt).not.toBeNull();

      expect(await settle(claimed!, { state: 'done', outcome: 'answered' })).toBe(false);
      expect((await job(id)).state).toBe('expired');
    });

    it('hands a job back with a delay, keeping its attempt count', async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);
      const [claimed] = await claim();

      const before = Date.now();
      expect(
        await settle(claimed!, {
          state: 'pending',
          outcome: 'provider_unavailable',
          error: 'llm: 503',
          retryAfterMs: 60_000,
        }),
      ).toBe(true);
      const row = await job(id);
      expect(row).toMatchObject({
        state: 'pending',
        attempts: 1,
        leaseUntil: null,
        finishedAt: null,
      });
      expect(row.availableAt.getTime() - before).toBeGreaterThan(55_000);
      expect(await claim()).toEqual([]);

      await owner.aiJob.update({ where: { id }, data: { availableAt: ago(1) } });
      expect(await claim()).toEqual([expect.objectContaining({ id, attempts: 2 })]);
    });

    it('keeps the last error when a settle names none, and trims a long one', async () => {
      const chat = await seedChat(fx.a);
      const id = await seedJob(fx.a, chat);
      const [first] = await claim();
      await settle(first!, { state: 'pending', error: 'x'.repeat(5000) });
      expect((await job(id)).lastError).toHaveLength(1000);

      const [second] = await claim();
      await settle(second!, { state: 'done', outcome: 'answered' });
      expect((await job(id)).lastError).toHaveLength(1000);
    });

    it('refuses an outcome that is not a code', async () => {
      const chat = await seedChat(fx.a);
      await seedJob(fx.a, chat);
      const [claimed] = await claim();

      await expect(settle(claimed!, { state: 'done', outcome: 'Answered!' })).rejects.toThrow(
        RangeError,
      );
      await expect(
        withTenant(
          appRole,
          claimed!.context,
          (tx) =>
            tx.$queryRaw`SELECT ai_jobs_settle(${claimed!.id}::uuid, ${1}::int, 'done', 'not a code')`,
        ),
      ).rejects.toThrow(/invalid argument/);
      await expect(
        withTenant(
          appRole,
          claimed!.context,
          (tx) =>
            tx.$queryRaw`SELECT ai_jobs_settle(${claimed!.id}::uuid, ${1}::int, 'running', null)`,
        ),
      ).rejects.toThrow(/invalid argument/);
    });
  });
});
