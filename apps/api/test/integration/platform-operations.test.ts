/**
 * The root panel's Operations page (tm 389.14 · FR-ADMIN-20 · docs/platform-admin/design.md §A, §C).
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a requirement tag
 * (CONVENTIONS §7.3); the letters (a)–(k) are the task's acceptance list.
 *
 * Two real processes' worth of wiring in one test: a platform server that publishes, and — for
 * "run now" — a scheduler with an `OpsChannel` on its own Redis connection that listens, exactly
 * what the tenant API's scheduler plugin builds when `SCHEDULER_ENABLED` is on. The tenant test
 * server runs its scheduler off (every suite's default), so the listener is built here rather than
 * by switching on all fourteen real jobs' timers.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  OPS_COMPONENTS_KEY,
  reportComponentStatus,
} from '../../src/services/ops/component-status.js';
import { OPS_JOB_RUNS_KEY, OPS_SCHEDULER_KEY } from '../../src/services/ops/health-keys.js';
import { OpsChannel } from '../../src/services/ops/ops-channel.js';
import { runningKey } from '../../src/services/scheduler/lock.js';
import { Scheduler } from '../../src/services/scheduler/scheduler.js';
import { ownerClient, platformClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { recordingLogger } from '../helpers/scheduler.js';
import { startTestServer, type TestServer } from '../helpers/server.js';
import { ageSignup, seedUnverifiedSignup } from '../helpers/unverified-signups.js';

const HOUR = 3_600_000;
const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

async function waitFor(check: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('the platform Operations page (tm 389.14)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  let tokens: Record<'superadmin' | 'support' | 'readonly' | 'billing', string>;
  let redis: Redis;

  const as = (role: keyof typeof tokens = 'superadmin') => bearer(tokens[role]);
  const get = (path: string, role: keyof typeof tokens = 'superadmin') =>
    platform.app.inject({ method: 'GET', url: `${PLATFORM_PREFIX}${path}`, headers: as(role) });
  const post = (
    path: string,
    body: Record<string, unknown> = { reason: 'operations test' },
    role: keyof typeof tokens = 'superadmin',
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method: 'POST',
      url: `${PLATFORM_PREFIX}${path}`,
      headers: as(role),
      payload: body,
    });

  const auditRows = (action: string) =>
    owner.platformAuditLog.findMany({ where: { action }, orderBy: { chainSeq: 'asc' } });

  // --- The "scheduler" the listener drives -------------------------------------------------------
  let probeRuns = 0;
  let offRuns = 0;
  let gate: Promise<void> | null = null;
  let scheduler: Scheduler;
  let subscriber: Redis;
  let channel: OpsChannel;

  /** What the health leader publishes for `scheduler`, the way `HealthSnapshotPublisher` does. */
  async function publishJobTable(at = clock.now): Promise<void> {
    await redis.set(
      OPS_SCHEDULER_KEY,
      JSON.stringify({ generated_at: new Date(at).toISOString(), scheduler: scheduler.detail() }),
      'EX',
      90,
    );
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer({}, { now: clock.read });
    tenant = await startTestServer();
    redis = platform.app.redis;

    scheduler = new Scheduler({
      enabled: false,
      redis,
      logger: recordingLogger().logger,
      jitterPct: 0,
    });
    scheduler.register({
      name: 'ops_probe',
      intervalMs: 3_600_000,
      run: async () => {
        probeRuns += 1;
        if (gate) await gate;
        return { counts: { probed: 1 } };
      },
    });
    scheduler.register({
      name: 'ops_off',
      intervalMs: 3_600_000,
      enabled: false,
      run: async () => {
        offRuns += 1;
      },
    });
    scheduler.register({
      name: 'ops_broken',
      intervalMs: 3_600_000,
      run: async () => {
        throw new RangeError('postgres://user:hunter2@db/siyahtus is unreachable');
      },
    });
    scheduler.start();
    subscriber = redis.duplicate({ connectionName: 'ops-channel-test' });
    channel = new OpsChannel({
      subscriber,
      redis,
      scheduler,
      logger: recordingLogger().logger,
    });
  });

  afterAll(async () => {
    await channel?.stop();
    await subscriber?.quit().catch(() => subscriber.disconnect());
    await scheduler?.stop();
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    clock.now = Date.now();
    const operators = await Promise.all(
      (['superadmin', 'support', 'readonly', 'billing'] as const).map(async (role) => {
        const operator = await createOperator(db, { role, clock });
        return [role, await openActiveSession(db, operator, clock)] as const;
      }),
    );
    tokens = Object.fromEntries(operators) as typeof tokens;
    probeRuns = 0;
    offRuns = 0;
    gate = null;
    await redis.del(
      OPS_SCHEDULER_KEY,
      OPS_JOB_RUNS_KEY,
      OPS_COMPONENTS_KEY,
      runningKey('ops_probe'),
      runningKey('ops_broken'),
    );
  });

  afterEach(async () => {
    // A test that left a job blocked on its gate must not hold the next one's marker.
    await redis.del(runningKey('ops_probe'));
  });

  describe('(a) the scheduler table', () => {
    it('answers stale and empty while no tenant API has published, never an error', async () => {
      const response = await get('/operations/scheduler');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ stale: true, generated_at: null, enabled: null, jobs: [] });
    });

    it('lists the tenant API’s real jobs — nine or more — with run, duration and next-run columns', async () => {
      await tenant.app.opsHealth.publish();

      const body = (await get('/operations/scheduler')).json() as {
        stale: boolean;
        enabled: boolean;
        jobs: Array<Record<string, unknown>>;
      };

      expect(body.stale).toBe(false);
      expect(body.jobs.length).toBeGreaterThanOrEqual(9);
      const names = body.jobs.map((job) => job['name']);
      expect(names).toEqual(expect.arrayContaining(['chat_timeout', 'sla', 'siem', 'retention']));
      for (const job of body.jobs) {
        expect(Object.keys(job).sort()).toEqual(
          [
            'enabled',
            'interval_ms',
            'last_duration_ms',
            'last_manual',
            'last_run_at',
            'last_status',
            'name',
            'next_run_at',
            'running',
          ].sort(),
        );
        expect(job['running']).toBe(false);
        expect(job['last_manual']).toBeNull();
      }
    });

    it('marks a publication older than ninety seconds stale but still shows its jobs', async () => {
      await publishJobTable(clock.now - 120_000);
      const body = (await get('/operations/scheduler')).json() as {
        stale: boolean;
        jobs: unknown[];
      };
      expect(body.stale).toBe(true);
      expect(body.jobs).toHaveLength(3);
    });

    it('shows a job as running while its marker is held', async () => {
      await publishJobTable();
      await redis.set(runningKey('ops_probe'), 'someone', 'PX', 30_000);
      const jobs = (
        (await get('/operations/scheduler')).json() as {
          jobs: Array<{ name: string; running: boolean }>;
        }
      ).jobs;
      expect(jobs.find((job) => job.name === 'ops_probe')?.running).toBe(true);
      expect(jobs.find((job) => job.name === 'ops_off')?.running).toBe(false);
    });
  });

  describe('(b) run now', () => {
    it('says no_listener when no scheduler is subscribed, and starts nothing', async () => {
      await publishJobTable();
      const response = await post('/operations/scheduler/ops_probe/run');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ name: 'ops_probe', result: 'no_listener' });
      expect(probeRuns).toBe(0);
    });

    describe('with a listener', () => {
      beforeAll(async () => {
        await channel.start();
      });

      it('runs the job once and leaves the outcome in the table', async () => {
        await publishJobTable();
        const response = await post('/operations/scheduler/ops_probe/run');
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json()).toMatchObject({ name: 'ops_probe', result: 'queued' });
        expect((response.json() as { request_id: string }).request_id).toMatch(/^[0-9a-f-]{36}$/);

        await waitFor(async () => (await redis.hlen(OPS_JOB_RUNS_KEY)) > 0, 'the run to settle');
        expect(probeRuns).toBe(1);

        await publishJobTable();
        const jobs = (
          (await get('/operations/scheduler')).json() as {
            jobs: Array<{
              name: string;
              last_status: string;
              last_manual: Record<string, unknown> | null;
            }>;
          }
        ).jobs;
        const row = jobs.find((job) => job.name === 'ops_probe')!;
        expect(row.last_status).toBe('ok');
        expect(row.last_manual).toMatchObject({
          result: 'finished',
          status: 'ok',
          error_class: null,
          duration_ms: expect.any(Number),
        });
        // The marker went back with the pass.
        expect(await redis.exists(runningKey('ops_probe'))).toBe(0);
      });

      it('records a job that throws by its class and never by its message', async () => {
        await publishJobTable();
        await post('/operations/scheduler/ops_broken/run');
        await waitFor(
          async () => (await redis.hexists(OPS_JOB_RUNS_KEY, 'ops_broken')) === 1,
          'the failure',
        );

        const raw = (await redis.hget(OPS_JOB_RUNS_KEY, 'ops_broken'))!;
        expect(JSON.parse(raw)).toMatchObject({ status: 'error', error_class: 'RangeError' });
        expect(raw).not.toContain('hunter2');
      });

      it('(c) does not start a job that is already running — the second call is already_running', async () => {
        let release!: () => void;
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await publishJobTable();

        expect((await post('/operations/scheduler/ops_probe/run')).json()).toMatchObject({
          result: 'queued',
        });
        await waitFor(
          async () => probeRuns === 1 && (await redis.exists(runningKey('ops_probe'))) === 1,
          'the job to start',
        );

        const second = await post('/operations/scheduler/ops_probe/run');
        expect(second.statusCode, second.body).toBe(200);
        expect(second.json()).toMatchObject({ result: 'already_running' });

        // The table shows it executing, too.
        const jobs = (
          (await get('/operations/scheduler')).json() as {
            jobs: Array<{ name: string; running: boolean }>;
          }
        ).jobs;
        expect(jobs.find((job) => job.name === 'ops_probe')?.running).toBe(true);

        release();
        await waitFor(
          async () => (await redis.exists(runningKey('ops_probe'))) === 0,
          'the job to finish',
        );
        expect(probeRuns).toBe(1);

        // And once it has finished, the next request runs.
        await post('/operations/scheduler/ops_probe/run');
        await waitFor(() => probeRuns === 2, 'the second run');
      });

      it('answers disabled for a switched-off job without running it', async () => {
        await publishJobTable();
        const response = await post('/operations/scheduler/ops_off/run');
        expect(response.json()).toMatchObject({ name: 'ops_off', result: 'disabled' });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(offRuns).toBe(0);
      });
    });

    it('is 404 for a job the leader does not list, and for a name that cannot be one', async () => {
      await publishJobTable();
      expect((await post('/operations/scheduler/nope/run')).statusCode).toBe(404);
      expect((await post('/operations/scheduler/Not-A-Job/run')).statusCode).toBe(404);
    });
  });

  describe('(d) who may', () => {
    it('lets support run a job and readonly only look', async () => {
      await publishJobTable();
      expect((await get('/operations/scheduler', 'readonly')).statusCode).toBe(200);
      expect((await get('/operations/scheduler', 'support')).statusCode).toBe(200);
      expect(
        (await post('/operations/scheduler/ops_off/run', undefined, 'support')).statusCode,
      ).toBe(200);

      const refused = await post('/operations/scheduler/ops_off/run', undefined, 'readonly');
      expect(refused.statusCode).toBe(403);
      expect((refused.json() as { error: { type: string } }).error.type).toBe('authorization');
    });

    it('keeps billing out of the page altogether', async () => {
      for (const path of [
        '/operations/scheduler',
        '/operations/webhooks',
        '/operations/components',
      ]) {
        expect((await get(path, 'billing')).statusCode, path).toBe(403);
      }
    });

    it('asks every mutation why', async () => {
      await publishJobTable();
      for (const [path, body] of [
        ['/operations/scheduler/ops_off/run', {}],
        ['/operations/partitions/ensure', {}],
        ['/operations/unverified-signups/purge', {}],
      ] as const) {
        const response = await post(path, body);
        expect(response.statusCode, path).toBe(400);
        expect((response.json() as { error: { type: string } }).error.type).toBe(
          'platform_reason_required',
        );
      }
    });

    it('records a run request in the platform chain with the reason and the result — not in a tenant’s', async () => {
      await publishJobTable();
      await post('/operations/scheduler/ops_off/run', { reason: 'checking the switch' });

      const [row] = await auditRows('operations.job_run_requested');
      expect(row).toMatchObject({
        targetType: 'job',
        targetId: 'ops_off',
        reason: 'checking the switch',
        licenseId: null,
      });
      expect(row?.payload).toMatchObject({ result: 'disabled' });
      expect(
        await owner.auditLogEntry.count({
          where: { action: { startsWith: 'platform.operations' } },
        }),
      ).toBe(0);
      expect((await platform.app.platformAuditLog.verify()).ok).toBe(true);
    });
  });

  describe('(e) webhook backlog', () => {
    it('counts deliveries across workspaces and names none of them', async () => {
      const make = async (licenseId: bigint) =>
        owner.webhook.create({
          data: {
            licenseId,
            url: 'https://hooks.example.test/in',
            action: 'chat_started',
            secretKey: 'whsec_test',
          },
        });
      const a = await make(fx.a.licenseId);
      const b = await make(fx.b.licenseId);
      const now = Date.now();
      const row = (
        webhookId: string,
        licenseId: bigint,
        state: 'pending' | 'delivered' | 'failed' | 'exhausted',
        extra: Record<string, unknown> = {},
      ) => ({
        licenseId,
        webhookId,
        action: 'chat_started',
        attempt: 1,
        ok: state === 'delivered',
        state,
        permanent: state === 'exhausted',
        ...extra,
      });
      await owner.webhookDelivery.createMany({
        data: [
          row(a.id, fx.a.licenseId, 'delivered'),
          row(a.id, fx.a.licenseId, 'delivered'),
          row(a.id, fx.a.licenseId, 'failed'),
          row(b.id, fx.b.licenseId, 'exhausted'),
          // Owed a retry, due an hour ago: overdue.
          row(b.id, fx.b.licenseId, 'pending', {
            eventId: '11111111-1111-4111-8111-111111111111',
            payload: '{"secret":"customer text"}',
            nextAttemptAt: new Date(now - HOUR),
            createdAt: new Date(now - 2 * HOUR),
          }),
          // Owed a retry, due in a minute: queued, not overdue.
          row(a.id, fx.a.licenseId, 'pending', {
            eventId: '22222222-2222-4222-8222-222222222222',
            payload: '{}',
            nextAttemptAt: new Date(now + 60_000),
          }),
          // Older than the window: not counted as a recent outcome.
          row(a.id, fx.a.licenseId, 'failed', { createdAt: new Date(now - 48 * HOUR) }),
        ],
      });

      const response = await get('/operations/webhooks');
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as Record<string, any>;
      expect(body).toMatchObject({
        window_hours: 24,
        pending: 2,
        overdue: 1,
        last_window: {
          delivered: 2,
          failed: 1,
          exhausted: 1,
          // two bad of four terminal
          failure_rate: 0.5,
          workspaces_failing: 2,
        },
      });
      expect(body['oldest_pending_age_s']).toBeGreaterThan(2 * 3600 - 60);
      // Counts only: no payload, URL or workspace anywhere in the body.
      expect(response.body).not.toContain('customer text');
      expect(response.body).not.toContain('hooks.example.test');
    });

    it('is zero and has no rate on an empty log', async () => {
      const body = (await get('/operations/webhooks')).json() as Record<string, any>;
      expect(body).toMatchObject({
        pending: 0,
        overdue: 0,
        oldest_pending_age_s: null,
        last_window: {
          delivered: 0,
          failed: 0,
          exhausted: 0,
          failure_rate: null,
          workspaces_failing: 0,
        },
      });
    });
  });

  describe('(f) SIEM', () => {
    it('summarises the export cursors: enabled, stalled, last run and shipped total', async () => {
      const recent = new Date(Date.now() - HOUR);
      await owner.siemExportCursor.createMany({
        data: [
          // Delivering.
          {
            licenseId: fx.a.licenseId,
            target: 'file',
            enabled: true,
            lastRunAt: recent,
            lastExportedId: randomUUID(),
            lastExportedAt: new Date(recent.getTime() - 60_000),
            exportedCount: 40n,
          },
          // On, but silent for two days: stalled.
          {
            licenseId: fx.b.licenseId,
            target: 'file',
            enabled: true,
            lastRunAt: new Date(Date.now() - 48 * HOUR),
            exportedCount: 2n,
          },
        ],
      });

      const response = await get('/operations/siem');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        provider: 'file',
        workspaces_enabled: 2,
        workspaces_stalled: 1,
        last_run_at: recent.toISOString(),
        exported_total: 42,
      });
    });

    it('is quiet with no export configured anywhere', async () => {
      expect((await get('/operations/siem')).json()).toMatchObject({
        workspaces_enabled: 0,
        workspaces_stalled: 0,
        last_run_at: null,
        last_exported_at: null,
        exported_total: 0,
      });
    });
  });

  describe('(g) events partitions', () => {
    /** The month three ahead of now: inside the runtime window, and in nobody’s way. */
    const ahead = (() => {
      const d = new Date();
      const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1));
      return {
        key: m.toISOString().slice(0, 7),
        table: `events_${m.toISOString().slice(0, 7).replace('-', '_')}`,
      };
    })();

    afterEach(async () => {
      await platform.app.platformDb
        .$queryRaw`SELECT events_ensure_partition(${new Date(`${ahead.key}-01T00:00:00Z`)}::timestamptz)`;
    });

    it('lists the partitions and, with every month of the window open, misses none', async () => {
      const response = await get('/operations/partitions');
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as {
        window: { behind: number; ahead: number };
        partitions: Array<{ name: string; month: string | null; default: boolean }>;
        missing_months: string[];
        default_has_rows: boolean | null;
      };
      expect(body.window).toEqual({ behind: 1, ahead: 3 });
      expect(body.partitions.some((row) => row.default && row.name === 'events_default')).toBe(
        true,
      );
      expect(body.partitions.find((row) => row.month === ahead.key)).toBeDefined();
      expect(body.missing_months).toEqual([]);
      expect(body.default_has_rows).toBe(false);
    });

    it('sees a missing month and opens it on request', async () => {
      await owner.$executeRawUnsafe(`DROP TABLE ${ahead.table}`);

      const before = (await get('/operations/partitions')).json() as { missing_months: string[] };
      expect(before.missing_months).toEqual([ahead.key]);

      const response = await post('/operations/partitions/ensure', {
        reason: 'closing the gap before the runbook says to',
        month: ahead.key,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({
        ensured: [{ month: ahead.key, name: ahead.table }],
        failed: [],
      });

      const after = (await get('/operations/partitions')).json() as { missing_months: string[] };
      expect(after.missing_months).toEqual([]);

      const [row] = (await auditRows('operations.partition_ensured')).slice(-1);
      expect(row).toMatchObject({ targetType: 'partition', targetId: ahead.key });
      expect(row?.payload).toMatchObject({ ensured: [ahead.key], failed: [] });
    });

    it('opens the whole window when no month is named, and a month already open is a no-op', async () => {
      const response = await post('/operations/partitions/ensure');
      const body = response.json() as { ensured: unknown[]; failed: unknown[] };
      expect(response.statusCode, response.body).toBe(200);
      expect(body.ensured).toHaveLength(5);
      expect(body.failed).toEqual([]);
    });

    it('reports a month the database refuses by its SQLSTATE, and still opens the rest', async () => {
      // 60 months is the function’s limit either way.
      const response = await post('/operations/partitions/ensure', {
        reason: 'too far ahead',
        month: '2999-01',
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as {
        ensured: unknown[];
        failed: Array<{ month: string; error_code: string }>;
      };
      expect(body.ensured).toEqual([]);
      expect(body.failed).toEqual([{ month: '2999-01', error_code: '22023' }]);
    });

    it('is 400 for a month that is not YYYY-MM', async () => {
      for (const month of ['2026-13', '26-01', 'next', '2026-1']) {
        const response = await post('/operations/partitions/ensure', {
          reason: 'bad month',
          month,
        });
        expect(response.statusCode, month).toBe(400);
      }
    });
  });

  describe('(h) unverified sign-ups', () => {
    async function signUps() {
      const old = await seedUnverifiedSignup(owner, 'old-unverified@signup.test');
      await ageSignup(owner, old, 8 * 24);
      const young = await seedUnverifiedSignup(owner, 'young-unverified@signup.test');
      await ageSignup(owner, young, 6 * 24);
      return { old, young };
    }
    const exists = (accountId: string) => owner.account.count({ where: { id: accountId } });

    it('counts the unverified accounts and those past the seven-day floor', async () => {
      await signUps();
      const response = await get('/operations/unverified-signups');
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as Record<string, any>;
      // The environment says 72 h; a panel purge never goes under seven days.
      expect(body['ttl_hours']).toBe(168);
      expect(body['total']).toBeGreaterThanOrEqual(2);
      expect(body['older_than_ttl']).toBeGreaterThanOrEqual(1);
      expect(body['oldest_age_s']).toBeGreaterThanOrEqual(8 * 24 * 3600 - 60);
    });

    it('purges the eight-day-old sign-up, keeps the six-day-old one, and records it', async () => {
      const { old, young } = await signUps();

      const response = await post('/operations/unverified-signups/purge', {
        reason: 'clearing a bot wave',
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ purged: 1, batches: 1, ttl_hours: 168 });
      expect(await exists(old.accountId)).toBe(0);
      expect(await exists(young.accountId)).toBe(1);

      const [row] = await auditRows('security.unverified_signups_purged');
      expect(row).toMatchObject({ targetType: 'signup', reason: 'clearing a bot wave' });
      expect(row?.payload).toMatchObject({ purged: 1 });

      // Nothing left to purge: the second call deletes nothing.
      expect((await post('/operations/unverified-signups/purge')).json()).toMatchObject({
        purged: 0,
      });
    });

    it('needs a code younger than five minutes, and a superadmin', async () => {
      await signUps();
      expect(
        (await post('/operations/unverified-signups/purge', undefined, 'support')).statusCode,
      ).toBe(403);
      expect(
        (await post('/operations/unverified-signups/purge', undefined, 'readonly')).statusCode,
      ).toBe(403);

      clock.advance(6 * 60_000);
      const stale = await post('/operations/unverified-signups/purge');
      expect(stale.statusCode, stale.body).toBe(403);
      expect((stale.json() as { error: { type: string } }).error.type).toBe(
        'platform_recent_totp_required',
      );
      // Nothing was purged by the refused calls.
      expect(await owner.account.count({ where: { email: 'old-unverified@signup.test' } })).toBe(1);
    });
  });

  describe('(i) job queues', () => {
    it('counts ai_jobs rows by state and reports tables that do not exist as not_installed', async () => {
      const chatId = 'c00000000900';
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: fx.a.customerId, active: false },
      });
      const threadId = 't00000000900';
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: fx.a.licenseId,
          active: false,
          closedAt: new Date(),
        },
      });
      for (const [index, age] of [3 * HOUR, HOUR].entries()) {
        await owner.aiJob.create({
          data: {
            licenseId: fx.a.licenseId,
            organizationId: fx.a.organizationId,
            chatId,
            threadId,
            triggerEventId: `e0000000090${index}`,
            kind: 'visitor_message',
            createdAt: new Date(Date.now() - age),
          },
        });
      }

      const response = await get('/operations/jobs');
      expect(response.statusCode, response.body).toBe(200);
      const { queues } = response.json() as {
        queues: Array<{
          key: string;
          state: string;
          counts: Record<string, number> | null;
          oldest_unfinished_age_s: number | null;
        }>;
      };
      expect(queues.map((queue) => queue.key)).toEqual(['ai_jobs', 'knowledge_jobs', 'doc_worker']);
      expect(queues[0]).toMatchObject({ state: 'ok', counts: { pending: 2 } });
      expect(queues[0]!.oldest_unfinished_age_s).toBeGreaterThan(3 * 3600 - 60);
      expect(queues[1]).toEqual({
        key: 'knowledge_jobs',
        state: 'not_installed',
        counts: null,
        oldest_unfinished_age_s: null,
      });
      expect(queues[2]).toMatchObject({ key: 'doc_worker', state: 'not_installed' });
    });

    it('counts a queue table once it exists', async () => {
      await owner.$executeRawUnsafe(
        `CREATE TABLE knowledge_jobs (id serial PRIMARY KEY, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
      );
      try {
        await owner.$executeRawUnsafe(
          `INSERT INTO knowledge_jobs (state, created_at) VALUES ('pending', now() - interval '2 hours'), ('pending', now()), ('done', now())`,
        );
        const { queues } = (await get('/operations/jobs')).json() as {
          queues: Array<{
            key: string;
            state: string;
            counts: Record<string, number> | null;
            oldest_unfinished_age_s: number | null;
          }>;
        };
        const knowledge = queues.find((queue) => queue.key === 'knowledge_jobs')!;
        expect(knowledge).toMatchObject({ state: 'ok', counts: { pending: 2, done: 1 } });
        expect(knowledge.oldest_unfinished_age_s).toBeGreaterThan(2 * 3600 - 60);
      } finally {
        await owner.$executeRawUnsafe('DROP TABLE knowledge_jobs');
      }
    });

    it('calls a table it cannot read unreadable instead of failing the page', async () => {
      await owner.$executeRawUnsafe(
        `CREATE TABLE knowledge_jobs (id serial PRIMARY KEY, note text)`,
      );
      try {
        const { queues } = (await get('/operations/jobs')).json() as {
          queues: Array<{ key: string; state: string }>;
        };
        expect(queues.find((queue) => queue.key === 'knowledge_jobs')?.state).toBe('unreadable');
      } finally {
        await owner.$executeRawUnsafe('DROP TABLE knowledge_jobs');
      }
    });
  });

  describe('(j) components', () => {
    it('lists every component, unknown where nothing has reported, in the dashboard’s order', async () => {
      const body = (await get('/operations/components')).json() as {
        components: Array<{ key: string; state: string }>;
      };
      expect(body.components).toHaveLength(12);
      expect(body.components.every((component) => component.state === 'unknown')).toBe(true);
    });

    it('carries what the modules reported, including the leader’s probes', async () => {
      await reportComponentStatus(redis, 'channel_whatsapp', {
        state: 'ok',
        detail: 'last webhook 2 minutes ago',
      });
      await tenant.app.opsHealth.publish();

      const { components } = (await get('/operations/components')).json() as {
        components: Array<{ key: string; state: string; detail: string | null }>;
      };
      const byKey = Object.fromEntries(components.map((component) => [component.key, component]));
      // The leader judged these for itself …
      expect(byKey['db']!.state).toBe('ok');
      expect(byKey['redis']!.state).toBe('ok');
      expect(byKey['ai_jobs']!.state).toBe('ok');
      expect(byKey['webhooks']!.state).toBe('ok');
      expect(byKey['captcha']!.state).not.toBe('unknown');
      // … the modules this build has not got are marked so, and nothing it wrote
      // replaced what a module had said for itself.
      for (const key of ['knowledge_jobs', 'doc_worker', 'channel_meta']) {
        expect(byKey[key]!.state, key).toBe('not_installed');
      }
      expect(byKey['channel_whatsapp']).toMatchObject({
        state: 'ok',
        detail: 'last webhook 2 minutes ago',
      });
      // The test server has no GeoIP file, and says so rather than staying silent.
      expect(byKey['geoip']).toMatchObject({ state: 'not_installed' });
    });
  });

  describe('(k) the tenant API does not serve it', () => {
    it('answers 404 for the operations paths', async () => {
      const direct = await tenant.app.inject({
        method: 'GET',
        url: '/platform/v1/operations/scheduler',
      });
      expect([401, 404]).toContain(direct.statusCode);
      expect(direct.body).not.toContain('"jobs"');
    });
  });
});
