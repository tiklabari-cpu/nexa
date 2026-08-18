/**
 * The scheduler, end to end (M-SCHED-c · §D113/K1).
 *
 * Every one of the five sweeps was already tested — `chat-timeout.test.ts`,
 * `sla.test.ts`, `siem-sink.test.ts`, `scheduled-reports-sweep.test.ts` and
 * `retention.test.ts` each construct their sweeper and call `run()`. All five
 * were green, and all five were also completely inert in a Nexa brought up with
 * `make dev`: nothing started them. That is the exact shape of §D113/K1 — the
 * parts were proved, the seam between them was not — and no suite could catch
 * it, because every suite was on the far side of the seam.
 *
 * So this file asserts the one thing none of them can: **that a running server
 * sweeps on its own**. It boots the real `buildServer`, with the real plugin
 * chain, against the run's own Postgres and Redis, sets the intervals to a few
 * hundred milliseconds, and then does nothing at all — no sweeper is
 * constructed here and no `run()` is called. What the tests wait for is the
 * effect a person would notice: the idle chat is closed, the breach is marked,
 * the NDJSON file is on disk, the report is in the mailbox. Remove the wiring
 * in `plugins/scheduler.ts` and every wait below times out; register a sweep
 * whose `run` does nothing and the effect never appears. Neither failure is
 * visible from a snapshot, which is why `/health` is checked *last* here and
 * never instead.
 *
 * Three properties, three servers:
 *
 *   1. The four unconditional sweeps produce their effects, and `/health`
 *      reports what happened.
 *   2. Two instances sharing one Redis run each interval once, not twice — the
 *      claim `lock.ts` exists for, at the level a deployment actually has it
 *      (two servers, not two `Scheduler`s: `scheduler-lock.test.ts` already
 *      proves the lock itself).
 *   3. Retention deletes only when `RETENTION_ENABLED` says so — silent and
 *      irreversible is the one combination this repo will not ship.
 *
 * Waiting is done by polling for the effect rather than sleeping a fixed
 * amount: a slow machine should make this suite late, not red, and a fixed
 * sleep tuned on a fast one is a flake waiting for CI.
 *
 * Two seeding rules keep the scenarios from measuring each other. The tenants
 * are split — the idle chat, the SIEM feed and the report definition live in A,
 * the unanswered thread and the retention canary in B — because the chat
 * timeout sweep archives threads while the SLA sweep only judges threads that
 * are still open, so a single tenant would have the first sweep quietly
 * deciding whether the second had anything to find. And every fixture is
 * written before the server boots, so no sweep can tick against a half-built
 * one.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { startOfUtcDay } from '../../src/services/reports/scheduled-report-period.js';
import type { SchedulerSnapshot } from '../../src/services/scheduler/types.js';
import {
  ownerClient,
  resetDatabase,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { startTestServer, type TestServer } from '../helpers/server.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The interval every job under test ticks at.
 *
 * Short enough that a pass lands well inside the suite's patience, and still
 * comfortably above the floor the lock's TTL clamps to (`MIN_LOCK_TTL_MS`, 50
 * ms): at 200 ms a holder keeps its key for 180 ms, a long time next to a
 * loopback Redis round trip. Much below this and the lock would start expiring
 * inside the call that took it, and the suite would be measuring the clamp
 * rather than the scheduler.
 */
const TICK_MS = '200';

/** Long enough that a job cannot tick during a test that is not about it. */
const NEVER_MS = '600000';

/**
 * The sweeps that run unconditionally. Retention is the one that is
 * deliberately not among them: it only runs when a deployment opts in.
 *
 * `webhook_redelivery` is here despite being the one job that talks to the
 * outside world — with nothing queued there is nothing for it to send, so what
 * a tick proves is that it is scheduled and resolves, not that it can post.
 * The delivering is `webhook-redelivery.test.ts`'s.
 */
const UNCONDITIONAL = ['chat_timeout', 'sla', 'siem', 'scheduled_reports', 'webhook_redelivery'];

/**
 * Jitter off wherever a status is asserted.
 *
 * A lock is held for 90% of the interval and is never handed back, so a single
 * instance whose next tick lands early — which is exactly what a negative
 * jitter draw does — can find its *own* previous lock still alive and report
 * `skipped`. That is correct behaviour and completely uninteresting here, but
 * it would make `last_status` a coin flip. At zero jitter the next tick is a
 * full interval after the last acquire, so a lone instance always takes its own
 * interval back.
 */
const NO_JITTER = '0';

/** What a job reported for its last pass, straight from the running server. */
function lastStatus(server: TestServer, job: string): string | null {
  return server.app.scheduler.snapshot().jobs.find((row) => row.name === job)?.last_status ?? null;
}

interface SchedulerJobBody {
  name: string;
  interval_ms: number;
  enabled: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_error_class?: string;
}

interface HealthBody {
  scheduler: { enabled: boolean; jobs: SchedulerJobBody[] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until every named condition holds.
 *
 * One deadline for the whole set rather than one per condition, because the
 * jobs tick concurrently and per-condition timeouts would add up past vitest's
 * hook budget while measuring nothing extra. Whatever is still outstanding goes
 * into the failure message — "the scheduler never: closed the idle chat" is a
 * diagnosis; "timed out" is a shrug.
 */
async function waitForAll(
  checks: Record<string, () => Promise<boolean>>,
  timeoutMs = 20_000,
): Promise<void> {
  const pending = new Set(Object.keys(checks));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const name of [...pending]) {
      if (await checks[name]!()) pending.delete(name);
    }
    if (pending.size === 0) return;
    if (Date.now() > deadline) {
      throw new Error(`the scheduler never: ${[...pending].join(' · ')}`);
    }
    await sleep(25);
  }
}

/** Owner connection: RLS-exempt, so a fixture can be placed in either tenant. */
let owner: PrismaClient;
let seq = 0;

beforeAll(async () => {
  if (!process.env['DATABASE_APP_URL']) throw new Error('DATABASE_APP_URL must be set');
  owner = ownerClient();
});

afterAll(async () => {
  await owner.$disconnect();
});

/**
 * A conversation placed exactly where a scenario needs it in time.
 *
 * A fresh customer every call: one customer may hold only one active chat, so
 * reusing the fixture's would make the second seeded chat fail an invariant
 * rather than test one.
 */
async function seedConversation(
  t: TenantFixture,
  options: { at: Date; active: boolean; closedAt?: Date; assigneeId?: string },
): Promise<{ chatId: string; threadId: string }> {
  seq += 1;
  const customer = await owner.customer.create({
    data: { organizationId: t.organizationId, name: `sched-visitor-${String(seq)}` },
    select: { id: true },
  });
  const chatId = generateShortId();
  await owner.chat.create({
    data: {
      id: chatId,
      licenseId: t.licenseId,
      customerId: customer.id,
      active: options.active,
      createdAt: options.at,
    },
  });
  const threadId = generateShortId();
  await owner.thread.create({
    data: {
      id: threadId,
      chatId,
      licenseId: t.licenseId,
      active: options.active,
      closedAt: options.closedAt ?? null,
      createdAt: options.at,
      ...(options.assigneeId === undefined ? {} : { assigneeId: options.assigneeId }),
    },
  });
  return { chatId, threadId };
}

// ===========================================================================
// 1 · The server sweeps on its own
// ===========================================================================

describe('a running server sweeps without anyone asking it to (§D113/K1)', () => {
  let server: TestServer;
  let mailer: FileMailer;
  let mailDir: string;
  let siemDir: string;
  let fx: Fixtures;
  let idleChatId: string;
  let unansweredThreadId: string;
  let retentionCanaryId: string;
  let health: HealthBody;

  const ndjsonFiles = async (t: TenantFixture): Promise<string[]> => {
    try {
      return (await readdir(join(siemDir, t.licenseId.toString()))).filter((name) =>
        name.endsWith('.ndjson'),
      );
    } catch {
      // The sink creates the directory when it first delivers; "not there yet"
      // is the normal state of this check until the first pass lands.
      return [];
    }
  };

  const scheduledReportMail = async (): Promise<Array<{ subject: string; to: string }>> =>
    (await mailer.outbox()).filter((message) => message.kind === 'scheduled_report');

  beforeAll(async () => {
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-sched-mail-'));
    siemDir = await mkdtemp(join(tmpdir(), 'nexa-sched-siem-'));
    mailer = new FileMailer(mailDir);

    // Enterprise on both: the SIEM sink refuses to deliver for a plan without
    // `siem_export`, and the SLA sweep will not measure a workspace without
    // `sla`. Those refusals are proved in `entitlements.test.ts`; here they
    // would only mean the sweeps ran and correctly found nothing, which is
    // indistinguishable from a scheduler that never ticked.
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);

    const now = Date.now();

    // A — an idle chat, and a workspace that asked for idle chats to be closed.
    const brandA = await owner.brand.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, isDefault: true },
      select: { id: true },
    });
    await owner.inboxSettings.create({
      data: { licenseId: fx.a.licenseId, brandId: brandA.id, chatTimeoutSeconds: 60 },
    });
    idleChatId = (await seedConversation(fx.a, { at: new Date(now - 2 * HOUR), active: true }))
      .chatId;

    // A — a switched-on SIEM feed with one entry waiting to be shipped. Seeded
    // an hour back so it is outside any export horizon, and stamped from this
    // process's clock rather than the database's for the reason
    // `siem-sink.test.ts` gives: the horizon is measured here.
    await owner.siemExportCursor.create({
      data: { licenseId: fx.a.licenseId, target: 'file', enabled: true },
    });
    await owner.auditLogEntry.create({
      data: {
        licenseId: fx.a.licenseId,
        actorId: fx.a.ownerAccountId,
        actorType: 'agent',
        action: 'auth.login',
        target: null,
        metadata: {} as Prisma.InputJsonObject,
        createdAt: new Date(now - HOUR),
      },
    });

    // A — a daily report, with one closed thread inside the period it will
    // cover. A `daily` schedule reports on the previous complete UTC day, so
    // midday of that day is inside the window whatever hour this suite runs at.
    await owner.scheduledReport.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: 'team-performance',
        frequency: 'daily',
        format: 'csv',
        recipients: [fx.a.agentEmail],
        enabled: true,
      },
    });
    const inPeriod = new Date(startOfUtcDay(new Date(now)).getTime() - 12 * HOUR);
    await seedConversation(fx.a, {
      at: inPeriod,
      active: false,
      closedAt: new Date(inPeriod.getTime() + 60_000),
      assigneeId: fx.a.agentAccountId,
    });

    // B — a customer who has been waiting two hours for a first reply, against
    // a one-minute target. B has no inbox timeout, so the chat timeout sweep
    // leaves this thread open for the SLA sweep to judge.
    await owner.slaPolicy.create({
      data: {
        licenseId: fx.b.licenseId,
        firstResponseMinutes: 1,
        resolutionMinutes: null,
        businessHoursOnly: false,
      },
    });
    unansweredThreadId = (
      await seedConversation(fx.b, { at: new Date(now - 2 * HOUR), active: true })
    ).threadId;

    // B — the canary: a thread far past the retention window. Nothing in this
    // server may delete it, because `RETENTION_ENABLED` is not set.
    retentionCanaryId = (
      await seedConversation(fx.b, {
        at: new Date(now - 400 * DAY),
        active: false,
        closedAt: new Date(now - 400 * DAY),
      })
    ).threadId;

    server = await startTestServer(
      {
        SCHEDULER_ENABLED: 'true',
        SCHEDULE_JITTER_PCT: NO_JITTER,
        SCHEDULE_CHAT_TIMEOUT_MS: TICK_MS,
        SCHEDULE_SLA_MS: TICK_MS,
        SCHEDULE_SIEM_MS: TICK_MS,
        SCHEDULE_SCHEDULED_REPORTS_MS: TICK_MS,
        SCHEDULE_RETENTION_MS: TICK_MS,
        SCHEDULE_WEBHOOK_REDELIVERY_MS: TICK_MS,
        SIEM_DIR: siemDir,
        // The retention sweep prunes the mail spool by path, so even a pass
        // that is not supposed to happen is pointed at a temporary directory
        // rather than the developer's `.data/mail`.
        MAIL_DIR: mailDir,
      },
      { mailer },
    );

    await waitForAll({
      'closed the idle chat': async () =>
        (await owner.chat.findUnique({ where: { id: idleChatId }, select: { active: true } }))
          ?.active === false,
      'marked the SLA breach': async () =>
        (await owner.slaBreach.count({ where: { licenseId: fx.b.licenseId } })) > 0,
      'wrote a SIEM file': async () => (await ndjsonFiles(fx.a)).length > 0,
      'delivered the scheduled report': async () => (await scheduledReportMail()).length > 0,
      // Waited for separately, and last in spirit: a sweep's effect lands when
      // its transaction commits, while the pass is recorded only once `run`
      // returns. Reading `/health` on the strength of the four effects alone
      // caught `chat_timeout` in exactly that gap — closed chat, `last_status`
      // still null — which is a race in the test, not in the scheduler.
      'recorded a completed pass for every sweep': async () =>
        UNCONDITIONAL.every((job) => lastStatus(server, job) === 'ok'),
    });

    // Read while the server is still up: this is the body an operator curls
    // after `make dev`, and the point is that it agrees with the four effects
    // already observed above.
    health = (await server.get('/health')).json() as HealthBody;
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([
      rm(mailDir, { recursive: true, force: true }),
      rm(siemDir, { recursive: true, force: true }),
    ]);
  });

  it('closes a chat that has gone idle past its window (FR-MOD-08.7.3)', async () => {
    const chat = await owner.chat.findUniqueOrThrow({ where: { id: idleChatId } });
    expect(chat.active).toBe(false);

    // Not merely flagged: the thread is archived and the close is on the
    // transcript as a system event, the same close a hand-archive produces.
    const thread = await owner.thread.findFirstOrThrow({ where: { chatId: idleChatId } });
    expect(thread.active).toBe(false);
    expect(thread.closedAt).not.toBeNull();

    const events = await owner.event.findMany({ where: { threadId: thread.id } });
    expect(events.some((event) => event.text === 'Chat closed after inactivity')).toBe(true);
  });

  it('marks a first-response breach nobody would have asked about (11.5-d)', async () => {
    const breaches = await owner.slaBreach.findMany({ where: { licenseId: fx.b.licenseId } });
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({
      subjectType: 'thread',
      subjectId: unansweredThreadId,
      target: 'first_response',
      targetMinutes: 1,
    });
    // The thread is still open — this is the clock no request will ever stop,
    // which is the whole reason the sweep has to run on a timer.
    const thread = await owner.thread.findUniqueOrThrow({ where: { id: unansweredThreadId } });
    expect(thread.active).toBe(true);
    expect(thread.firstResponseAt).toBeNull();
  });

  it('ships the audit trail to the SIEM destination and moves the cursor (C6-d)', async () => {
    expect(await ndjsonFiles(fx.a)).not.toHaveLength(0);

    const cursor = await owner.siemExportCursor.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId },
    });
    expect(cursor.lastExportedId).not.toBeNull();
    expect(cursor.lastRunAt).not.toBeNull();
    expect(Number(cursor.exportedCount)).toBeGreaterThan(0);

    // B never configured a destination, so its trail stayed where it was — the
    // sweep walks every tenant, and "every tenant" must not come to mean "every
    // tenant's data leaves".
    expect(await ndjsonFiles(fx.b)).toHaveLength(0);
  });

  it('delivers the scheduled report and records the run (07.9)', async () => {
    const inbox = await scheduledReportMail();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.to).toBe(fx.a.agentEmail);
    expect(inbox[0]?.subject).toContain('Scheduled report: Team performance');

    const runs = await owner.scheduledReportRun.findMany({ where: { licenseId: fx.a.licenseId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: 'sent', recipientCount: 1 });
  });

  it('leaves retention alone: registered, never run, nothing deleted (NFR-C8)', async () => {
    // The canary is 400 days past a 365-day window. A retention pass would have
    // taken it on the first tick; `RETENTION_ENABLED` is unset, so none ran.
    expect(await owner.thread.findUnique({ where: { id: retentionCanaryId } })).not.toBeNull();

    const retention = health.scheduler.jobs.find((job) => job.name === 'retention');
    expect(retention).toMatchObject({ enabled: false, last_status: 'disabled' });
    expect(retention?.last_run_at).toBeNull();
    // No `data.retention_pruned` entry either — the sweep did not run, and did
    // not quietly count what it would have deleted.
    expect(await owner.auditLogEntry.count({ where: { action: 'data.retention_pruned' } })).toBe(0);
  });

  it("says so on /health — enabled, six jobs, and what each one's last pass did", () => {
    expect(health.scheduler.enabled).toBe(true);
    expect(health.scheduler.jobs.map((job) => job.name)).toEqual([
      'chat_timeout',
      'sla',
      'siem',
      'scheduled_reports',
      'retention',
      'webhook_redelivery',
    ]);

    for (const name of UNCONDITIONAL) {
      const job = health.scheduler.jobs.find((row) => row.name === name);
      expect(job?.interval_ms, name).toBe(Number(TICK_MS));
      expect(job?.enabled, name).toBe(true);
      // `ok`, not merely "ran": a sweep that throws every pass still moves
      // `last_run_at`, so the timestamp alone is not the assertion.
      expect(job?.last_status, name).toBe('ok');
      expect(job?.last_run_at, name).not.toBeNull();
      expect(job?.last_error_class, name).toBeUndefined();
    }
  });
});

// ===========================================================================
// 2 · Two instances, one interval
// ===========================================================================

describe('two API instances sharing one Redis', () => {
  let first: TestServer;
  let second: TestServer;
  let snapshots: SchedulerSnapshot[];

  /** Every job the two instances race for; retention is off, so it is not one. */
  const RACED = UNCONDITIONAL;

  const tickedEverything = (server: TestServer): boolean =>
    server.app.scheduler
      .snapshot()
      .jobs.filter((job) => RACED.includes(job.name))
      .every((job) => job.last_status !== null);

  beforeAll(async () => {
    // No tenants: a pass then costs one enumerator query, which keeps this
    // scenario about who was allowed to run rather than about how long a sweep
    // takes.
    await resetDatabase(owner);

    // Jitter off, so each instance ticks a fixed interval after its own boot
    // instead of at a random phase. With a lock that outlives 90% of the
    // interval, the second instance's first tick then lands squarely inside the
    // first instance's lock, and "did the lock hold?" has a deterministic
    // answer instead of a probability.
    const options = {
      SCHEDULER_ENABLED: 'true',
      SCHEDULE_JITTER_PCT: NO_JITTER,
      SCHEDULE_CHAT_TIMEOUT_MS: '1500',
      SCHEDULE_SLA_MS: '1500',
      SCHEDULE_SIEM_MS: '1500',
      SCHEDULE_SCHEDULED_REPORTS_MS: '1500',
      SCHEDULE_WEBHOOK_REDELIVERY_MS: '1500',
    };
    // Booted together so the gap between the two `scheduler.start()` calls is
    // as small as two concurrent boots allow — it has to be under the lock's
    // 1 350 ms TTL for the second instance to find the interval taken.
    [first, second] = await Promise.all([startTestServer(options), startTestServer(options)]);

    // Wait until both have ticked every raced job, then read. Waiting on the
    // instances rather than on a wall-clock deadline is what makes this about
    // the interval they shared instead of about how fast the machine is.
    const deadline = Date.now() + 20_000;
    while (!(tickedEverything(first) && tickedEverything(second))) {
      if (Date.now() > deadline) throw new Error('an instance never ticked');
      await sleep(25);
    }
    snapshots = [first.app.scheduler.snapshot(), second.app.scheduler.snapshot()];
  });

  afterAll(async () => {
    await Promise.all([first.close(), second.close()]);
  });

  it('runs each job once for the interval, not once per instance', () => {
    for (const name of RACED) {
      const statuses = snapshots
        .map((snapshot) => snapshot.jobs.find((job) => job.name === name)?.last_status)
        .sort();
      // One instance did the work, the other was told the interval was taken.
      // Both `ok` would mean the fleet sweeps once per instance — two retention
      // passes deleting the same rows, two copies of the same report in a
      // customer's mailbox.
      expect(statuses, name).toEqual(['ok', 'skipped']);
    }
  });

  it('keeps both instances scheduled and healthy, whichever one won', () => {
    // A skipped pass is not a broken one: the instance that lost the interval
    // is still scheduled, still reporting, and takes the next interval its
    // neighbour misses.
    for (const snapshot of snapshots) {
      expect(snapshot.enabled).toBe(true);
      for (const name of RACED) {
        const job = snapshot.jobs.find((row) => row.name === name);
        expect(job?.last_run_at, name).not.toBeNull();
        expect(job?.last_error_class, name).toBeUndefined();
      }
    }
  });
});

// ===========================================================================
// 3 · Retention, only when it is asked for
// ===========================================================================

describe('retention deletes only once a deployment has said so', () => {
  let server: TestServer;
  let mailDir: string;
  let fx: Fixtures;
  let expiredThreadId: string;
  let freshThreadId: string;

  beforeAll(async () => {
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-sched-retention-'));
    fx = await seedFixtures(owner);

    const now = Date.now();
    expiredThreadId = (
      await seedConversation(fx.a, {
        at: new Date(now - 400 * DAY),
        active: false,
        closedAt: new Date(now - 400 * DAY),
      })
    ).threadId;
    // Inside the window: the pass has to be a window, not a truncate.
    freshThreadId = (
      await seedConversation(fx.a, {
        at: new Date(now - DAY),
        active: false,
        closedAt: new Date(now - DAY),
      })
    ).threadId;

    server = await startTestServer({
      SCHEDULER_ENABLED: 'true',
      RETENTION_ENABLED: 'true',
      SCHEDULE_JITTER_PCT: NO_JITTER,
      SCHEDULE_RETENTION_MS: TICK_MS,
      // The other four are left far out of reach: this scenario is about the
      // one sweep that deletes, and a chat timeout pass in the background would
      // only add noise to what was removed.
      SCHEDULE_CHAT_TIMEOUT_MS: NEVER_MS,
      SCHEDULE_SLA_MS: NEVER_MS,
      SCHEDULE_SIEM_MS: NEVER_MS,
      SCHEDULE_SCHEDULED_REPORTS_MS: NEVER_MS,
      SCHEDULE_WEBHOOK_REDELIVERY_MS: NEVER_MS,
      MAIL_DIR: mailDir,
    });

    await waitForAll({
      'pruned the expired thread': async () =>
        (await owner.thread.findUnique({ where: { id: expiredThreadId } })) === null,
      // Same gap as above: the delete commits before the pass is recorded.
      'recorded a completed retention pass': async () => lastStatus(server, 'retention') === 'ok',
    });
  });

  afterAll(async () => {
    await server.close();
    await rm(mailDir, { recursive: true, force: true });
  });

  it('prunes what is past the window and keeps what is inside it', async () => {
    expect(await owner.thread.findUnique({ where: { id: expiredThreadId } })).toBeNull();
    expect(await owner.thread.findUnique({ where: { id: freshThreadId } })).not.toBeNull();
  });

  it('records the pass in the audit trail it just pruned', async () => {
    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'data.retention_pruned' },
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.metadata).toMatchObject({ dry_run: false });
  });

  it('reports itself enabled and running on /health', async () => {
    const body = (await server.get('/health')).json() as HealthBody;
    const retention = body.scheduler.jobs.find((job) => job.name === 'retention');
    expect(retention).toMatchObject({ enabled: true, last_status: 'ok' });
    expect(retention?.last_run_at).not.toBeNull();
  });
});
