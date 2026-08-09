/**
 * The scheduled-report sweep (07.9-sched-e) — the delivery half of PRD
 * §5.3-Reports.
 *
 * A sent e-mail cannot be recalled, so the properties proved here are the ones
 * that decide whether the feature is safe to run at all:
 *
 *   1. **A period is delivered at most once.** Running the sweep twice for the
 *      same instant leaves exactly one message in the mailbox and one run row;
 *      the second pass reports the definition as skipped. This is the whole
 *      point of claiming the period before mailing it.
 *   2. **A failure consumes the period rather than releasing it.** A mailer that
 *      throws leaves the run `failed` with its reason recorded — not deleted,
 *      not `pending` — and a later sweep still sends nothing. Releasing it would
 *      mean a second attempt that cannot tell "never sent" from "sent, then the
 *      bookkeeping failed".
 *   3. **One workspace's report reaches only that workspace.** Two licences with
 *      their own schedules deliver to their own recipients, and each CSV carries
 *      only its own data — the failure that would otherwise mail one company's
 *      figures to another's mailbox on a timer.
 *   4. **Nothing happens silently.** Every delivery, skip and failure is both in
 *      the returned report and (for the two that claim a period) in
 *      `scheduled_report_runs`; a disabled definition produces neither a mail
 *      nor a row, so turning a schedule off and on again does not find its
 *      periods already spent.
 *
 * `now` is fixed so the period is a known window: with `daily`, 2026-08-08
 * reports on 2026-08-07. The fixture is a thread assigned to each licence's own
 * agent and the `team-performance` group, because its CSV names the agent — that
 * makes "only its own data" something the test can read rather than infer from
 * a count.
 *
 * That fixed instant reaches only the in-process sweeps. The script block at the
 * bottom spawns a real process, which has its own clock and cannot be handed
 * one, so it seeds from the real date instead — see
 * `seedAssignedThreadInScriptPeriod`.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { FileMailer, type Mailer } from '../../src/services/mail/mailer.js';
import { periodFor, startOfUtcDay } from '../../src/services/reports/scheduled-report-period.js';
import { ScheduledReportSweeper } from '../../src/services/reports/scheduled-report-sweeper.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** A Saturday. The previous complete day is 2026-08-07. */
const NOW = new Date('2026-08-08T09:00:00.000Z');
const IN_PERIOD = new Date('2026-08-07T12:00:00.000Z');
const PERIOD_KEY = '2026-08-07';

/** Fails every send — the provider outage the failure path is about. */
class BrokenMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error('smtp: connection refused');
  }
}

/**
 * The two instants a fixture for the *spawned script* is written to, given the
 * moment the seed runs — see `seedAssignedThreadInScriptPeriod` for why there
 * are two of them rather than one.
 *
 * Pure and at module scope so the block at the bottom of this file can prove,
 * for calendar days the suite will not be run on, that at least one anchor
 * always lands inside the period the script picks. Without that the date
 * dependency this fixture removes would only have moved to a different date.
 */
function scriptPeriodAnchors(seededAt: Date): [Date, Date] {
  return [
    // Midday of the UTC day before the seed.
    new Date(startOfUtcDay(seededAt).getTime() - 12 * 3_600_000),
    // A minute before the seed.
    new Date(seededAt.getTime() - 60_000),
  ];
}

describe('scheduled report sweep (PRD §5.3-Reports)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;
  let seq = 0;

  const sweep = (mail: Mailer = mailer) =>
    new ScheduledReportSweeper(appRole, mail).run({ now: NOW });

  /** Only the scheduler's own mail — nothing else in the suite writes any. */
  const mailbox = async () =>
    (await mailer.outbox()).filter((message) => message.kind === 'scheduled_report');

  const runsOf = (t: TenantFixture) =>
    owner.scheduledReportRun.findMany({ where: { licenseId: t.licenseId } });

  async function defineSchedule(
    t: TenantFixture,
    options: {
      group?: string;
      frequency?: string;
      recipients?: string[];
      enabled?: boolean;
    } = {},
  ): Promise<string> {
    const row = await owner.scheduledReport.create({
      data: {
        licenseId: t.licenseId,
        groupId: options.group ?? 'team-performance',
        frequency: options.frequency ?? 'daily',
        format: 'csv',
        recipients: options.recipients ?? [t.agentEmail],
        enabled: options.enabled ?? true,
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * A closed, assigned thread inside the period — one `team-performance` row,
   * carrying the assignee's name.
   *
   * `at` is a parameter because the period a delivery covers is not the same for
   * every caller here: the in-process sweeps stand on the fixed `NOW`, while the
   * spawned script reads the real clock (see `seedAssignedThreadInScriptPeriod`).
   * The thread is what puts the agent's name in the CSV, so it has to be written
   * into whichever window the delivery under test will actually report on.
   */
  async function seedAssignedThread(
    t: TenantFixture,
    agentId: string,
    at: Date = IN_PERIOD,
  ): Promise<void> {
    seq += 1;
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `Visitor ${String(seq)}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: customer.id,
        active: false,
        createdAt: at,
      },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: t.licenseId,
        active: false,
        assigneeId: agentId,
        createdAt: at,
        closedAt: new Date(at.getTime() + 60_000),
      },
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-sched-'));
    mailer = new FileMailer(mailDir);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await rm(mailDir, { recursive: true, force: true });
    seq = 0;
  });

  // ==========================================================================
  // One period, end to end
  // ==========================================================================

  it('delivers the previous complete period and records the run', async () => {
    await defineSchedule(fx.a);
    await seedAssignedThread(fx.a, fx.a.agentAccountId);

    const report = await sweep();
    expect(report.totals).toMatchObject({ delivered: 1, skipped: 0, failed: 0 });

    const inbox = await mailbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.to).toBe(fx.a.agentEmail);
    // Subject names the group and the UTC period — the mail says what it is
    // without anyone parsing the CSV.
    expect(inbox[0]?.subject).toBe('Scheduled report: Team performance (2026-08-07 – 2026-08-07)');
    expect(inbox[0]?.body).toContain('Agent a');

    const [run] = await runsOf(fx.a);
    expect(run).toMatchObject({
      periodKey: PERIOD_KEY,
      status: 'sent',
      recipientCount: 1,
      rowCount: 1,
      error: null,
    });
    expect(run?.periodFrom.toISOString()).toBe('2026-08-07T00:00:00.000Z');
    expect(run?.periodTo.toISOString()).toBe('2026-08-07T23:59:59.999Z');

    // `last_run_at` is the "you are receiving these" signal the settings screen
    // reads, so it moves only on a delivery that happened.
    const definition = await owner.scheduledReport.findFirst({
      where: { licenseId: fx.a.licenseId },
    });
    expect(definition?.lastRunAt).not.toBeNull();
  });

  it('delivers a period with no data rather than skipping it silently', async () => {
    await defineSchedule(fx.a);

    const report = await sweep();
    expect(report.totals.delivered).toBe(1);

    const inbox = await mailbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.body).toContain('No rows for this period.');
    expect((await runsOf(fx.a))[0]).toMatchObject({ status: 'sent', rowCount: 0 });
  });

  it('mails each recipient separately and counts them', async () => {
    await defineSchedule(fx.a, { recipients: [fx.a.agentEmail, fx.a.ownerEmail] });

    await sweep();

    const inbox = await mailbox();
    expect(inbox.map((m) => m.to).sort()).toEqual([fx.a.agentEmail, fx.a.ownerEmail].sort());
    expect((await runsOf(fx.a))[0]?.recipientCount).toBe(2);
  });

  // ==========================================================================
  // Single delivery per period (the claim)
  // ==========================================================================

  it('sends nothing on a second sweep of the same period', async () => {
    await defineSchedule(fx.a);
    await seedAssignedThread(fx.a, fx.a.agentAccountId);

    const first = await sweep();
    const second = await sweep();

    expect(first.totals).toMatchObject({ delivered: 1, skipped: 0 });
    expect(second.totals).toMatchObject({ delivered: 0, skipped: 1 });
    // The point of the whole design: one message, one row, however many times
    // the job is triggered.
    expect(await mailbox()).toHaveLength(1);
    expect(await runsOf(fx.a)).toHaveLength(1);
  });

  it('claims the period once even when two sweeps run at the same time', async () => {
    await defineSchedule(fx.a);

    // Concurrent, not sequential: the unique constraint — not a prior read — is
    // what has to decide the winner, so both passes are in flight together.
    const [first, second] = await Promise.all([sweep(), sweep()]);

    const delivered = first.totals.delivered + second.totals.delivered;
    const skipped = first.totals.skipped + second.totals.skipped;
    expect(delivered).toBe(1);
    expect(skipped).toBe(1);
    expect(await mailbox()).toHaveLength(1);
    expect(await runsOf(fx.a)).toHaveLength(1);
  });

  // ==========================================================================
  // Failure keeps the period
  // ==========================================================================

  it('records a failed delivery and does not free the period for a retry', async () => {
    await defineSchedule(fx.a);

    const failing = await sweep(new BrokenMailer());
    expect(failing.totals).toMatchObject({ delivered: 0, failed: 1 });

    const [run] = await runsOf(fx.a);
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('smtp: connection refused');
    expect(run?.recipientCount).toBe(0);

    // A working mailer afterwards must still not deliver: the period is spent.
    const retry = await sweep();
    expect(retry.totals).toMatchObject({ delivered: 0, skipped: 1 });
    expect(await mailbox()).toHaveLength(0);
    expect(await runsOf(fx.a)).toHaveLength(1);
  });

  it('keeps sweeping the rest of the workspace after one definition fails', async () => {
    // A group that no longer exists in the catalogue — the CSV builder refuses
    // it — must not stop the schedules defined after it.
    await defineSchedule(fx.a, { group: 'retired-group' });
    await defineSchedule(fx.a);

    const report = await sweep();
    expect(report.totals).toMatchObject({ delivered: 1, failed: 1 });
    expect(await mailbox()).toHaveLength(1);

    const failed = (await runsOf(fx.a)).find((run) => run.status === 'failed');
    expect(failed?.error).toBeTruthy();
  });

  // ==========================================================================
  // Cross-tenant isolation (mandatory negative test)
  // ==========================================================================

  it('delivers each licence its own data, to its own recipients', async () => {
    await defineSchedule(fx.a);
    await defineSchedule(fx.b);
    await seedAssignedThread(fx.a, fx.a.agentAccountId);
    await seedAssignedThread(fx.b, fx.b.agentAccountId);

    const report = await sweep();
    expect(report.totals.delivered).toBe(2);

    const inbox = await mailbox();
    expect(inbox).toHaveLength(2);

    const toA = inbox.find((m) => m.to === fx.a.agentEmail);
    const toB = inbox.find((m) => m.to === fx.b.agentEmail);
    expect(toA).toBeDefined();
    expect(toB).toBeDefined();

    // The CSV names the assignee, so "only its own data" is readable rather
    // than inferred: neither report may mention the other workspace's agent.
    expect(toA?.body).toContain('Agent a');
    expect(toA?.body).not.toContain('Agent b');
    expect(toB?.body).toContain('Agent b');
    expect(toB?.body).not.toContain('Agent a');

    // And the run rows stay on their own licence.
    expect(await runsOf(fx.a)).toHaveLength(1);
    expect(await runsOf(fx.b)).toHaveLength(1);
  });

  it('a licence whose delivery fails does not consume the other licence’s period', async () => {
    await defineSchedule(fx.a, { group: 'retired-group' });
    await defineSchedule(fx.b);

    const report = await sweep();
    expect(report.totals).toMatchObject({ delivered: 1, failed: 1 });

    const inbox = await mailbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.to).toBe(fx.b.agentEmail);
    expect((await runsOf(fx.a))[0]?.status).toBe('failed');
    expect((await runsOf(fx.b))[0]?.status).toBe('sent');
  });

  // ==========================================================================
  // Disabled definitions
  // ==========================================================================

  it('never mails or claims a period for a disabled definition', async () => {
    await defineSchedule(fx.a, { enabled: false });
    await seedAssignedThread(fx.a, fx.a.agentAccountId);

    const report = await sweep();
    expect(report.totals).toMatchObject({ delivered: 0, skipped: 0, failed: 0 });
    expect(await mailbox()).toHaveLength(0);
    // No claim either — re-enabling must not find the period already spent.
    expect(await runsOf(fx.a)).toHaveLength(0);
  });

  it('delivers a re-enabled definition on the next sweep', async () => {
    const id = await defineSchedule(fx.a, { enabled: false });
    expect((await sweep()).totals.delivered).toBe(0);

    await owner.scheduledReport.update({ where: { id }, data: { enabled: true } });
    expect((await sweep()).totals.delivered).toBe(1);
    expect(await mailbox()).toHaveLength(1);
  });

  // ==========================================================================
  // Frequencies
  // ==========================================================================

  it('claims a different period per frequency, so three schedules never collide', async () => {
    await defineSchedule(fx.a, { frequency: 'daily' });
    await defineSchedule(fx.a, { frequency: 'weekly' });
    await defineSchedule(fx.a, { frequency: 'monthly' });

    const report = await sweep();
    expect(report.totals.delivered).toBe(3);

    const keys = (await runsOf(fx.a)).map((run) => run.periodKey).sort();
    expect(keys).toEqual(['2026-07', '2026-08-07', '2026-W31']);
  });

  // ==========================================================================
  // The operator script (07.9-sched-f) — spawned as a real process, exactly
  // how an operator or a host cron would invoke it. This is the only way to
  // prove its own claims: that its dry-run truly writes nothing (not merely
  // that the sweeper's `dryRun` flag would, since the sweeper has none), and
  // that a database it cannot reach fails the process rather than the assertion.
  // ==========================================================================

  describe('scheduled-reports:run script', () => {
    const run = promisify(execFile);
    // test/integration → test → api → apps → repo root.
    const repoRoot = resolve(import.meta.dirname, '../../../..');

    let scriptMailDir: string;

    async function runScript(
      args: string[] = [],
      envOverrides: Record<string, string> = {},
    ): Promise<{ stdout: string; stderr: string }> {
      return run(
        'pnpm',
        [
          '--filter',
          '@nexa/api',
          'run',
          'scheduled-reports:run',
          ...(args.length > 0 ? ['--', ...args] : []),
        ],
        {
          cwd: repoRoot,
          env: { ...process.env, MAIL_DIR: scriptMailDir, ...envOverrides },
          // `pnpm` is a shell shim, not an executable: where npm installed it
          // there is a `.cmd`, a `.ps1` and an extensionless script, and
          // `CreateProcess` searches PATH for `.exe` only. Without a shell the
          // spawn fails with ENOENT before the script runs, and five tests
          // about the operator script report a product failure that is really
          // a PATH one. Every argument below is a literal — nothing here comes
          // from a caller, so concatenation has nothing to quote wrongly.
          shell: true,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    }

    const scriptMailbox = async () =>
      (await new FileMailer(scriptMailDir).outbox()).filter((m) => m.kind === 'scheduled_report');

    /**
     * The fixture for a delivery made by the spawned process, which reports on
     * whatever period *its own* clock selects.
     *
     * `NOW` cannot reach it. The script is a real CLI with no clock input — it
     * calls `new Date()` — so a fixture written to the fixed `IN_PERIOD` sits
     * inside the delivered window on exactly one calendar day and outside it on
     * every other, which is how this block came to hold a test that only passed
     * on 2026-08-08. Seeding from the real date instead removes the dependency
     * rather than moving it to a different date.
     *
     * Two threads, not one, because the child starts seconds after the seed: if
     * UTC midnight falls in that gap, the script's "previous complete day" is
     * the day this seed ran in rather than the one before it. Those two days are
     * the only candidates, so anchoring a thread in each makes the assertion
     * independent of which side of midnight the child lands on. Both anchors are
     * derived with the UTC boundary the scheduler itself uses (`startOfUtcDay`);
     * reading the local calendar here — the machine is UTC+3 — would just
     * reintroduce the same rot three hours earlier. `team-performance` groups by
     * agent, so the pair is still a single CSV row even when both fall in one
     * period.
     */
    async function seedAssignedThreadInScriptPeriod(
      t: TenantFixture,
      agentId: string,
    ): Promise<void> {
      for (const at of scriptPeriodAnchors(new Date())) {
        await seedAssignedThread(t, agentId, at);
      }
    }

    beforeEach(async () => {
      scriptMailDir = await mkdtemp(join(tmpdir(), 'nexa-sched-run-'));
    });

    afterEach(async () => {
      await rm(scriptMailDir, { recursive: true, force: true });
    });

    it('dry-run lists the ready definition and claims or sends nothing', async () => {
      await defineSchedule(fx.a);
      await seedAssignedThreadInScriptPeriod(fx.a, fx.a.agentAccountId);

      const { stdout, stderr } = await runScript();
      const report = JSON.parse(stdout) as {
        dryRun: boolean;
        totals: { tenants: number; ready: number; alreadyClaimed: number };
        tenants: Array<{
          licenseId: string;
          definitions: Array<{ group: string; periodKey: string | null; alreadyClaimed: boolean }>;
        }>;
      };

      expect(report.dryRun).toBe(true);
      const tenantPreview = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
      expect(tenantPreview).toBeDefined();
      const definition = tenantPreview?.definitions.find((d) => d.group === 'team-performance');
      expect(definition).toMatchObject({ alreadyClaimed: false });
      expect(definition?.periodKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(stderr).toContain('dry-run');

      // The claim to verify: nothing was written or sent.
      expect(await runsOf(fx.a)).toHaveLength(0);
      expect(await scriptMailbox()).toHaveLength(0);
    }, 30_000);

    it('--apply delivers, and the report totals match the run table it wrote', async () => {
      await defineSchedule(fx.a);
      await seedAssignedThreadInScriptPeriod(fx.a, fx.a.agentAccountId);

      const { stdout, stderr } = await runScript(['--apply']);
      const report = JSON.parse(stdout) as {
        totals: { delivered: number; skipped: number; failed: number };
      };
      expect(report.totals).toMatchObject({ delivered: 1, skipped: 0, failed: 0 });
      expect(stderr).toContain('applied');

      const runs = await runsOf(fx.a);
      expect(runs).toHaveLength(1);
      // `rowCount` and not just `sent`: a period the script reports on but the
      // fixture missed still delivers — "No rows for this period" is a valid
      // mail — so the counts alone would pass with no data behind them. It is
      // the cheap guard that the seed and the script agree on which day this is.
      expect(runs[0]).toMatchObject({ status: 'sent', recipientCount: 1, rowCount: 1 });
      expect(await scriptMailbox()).toHaveLength(1);
    }, 30_000);

    it('the client the script itself constructs does not leak one licence into another', async () => {
      await defineSchedule(fx.a);
      await defineSchedule(fx.b);
      await seedAssignedThreadInScriptPeriod(fx.a, fx.a.agentAccountId);
      await seedAssignedThreadInScriptPeriod(fx.b, fx.b.agentAccountId);

      const { stdout } = await runScript(['--apply']);
      const report = JSON.parse(stdout) as { totals: { delivered: number } };
      expect(report.totals.delivered).toBe(2);

      const inbox = await scriptMailbox();
      expect(inbox).toHaveLength(2);
      const toA = inbox.find((m) => m.to === fx.a.agentEmail);
      const toB = inbox.find((m) => m.to === fx.b.agentEmail);
      expect(toA?.body).toContain('Agent a');
      expect(toA?.body).not.toContain('Agent b');
      expect(toB?.body).toContain('Agent b');
      expect(toB?.body).not.toContain('Agent a');
    }, 30_000);

    /**
     * The single-delivery guarantee, stated the way it will actually be
     * stressed: not "call the sweeper twice in one process" (proved above) but
     * "trigger the job three times", each an independent process with its own
     * Prisma client, its own connection and its own idea of `now`.
     *
     * That is the shape of the real hazard. A host cron that overlaps, an
     * operator who reruns after a failed-looking exit, a second instance started
     * during a deploy — none of them share memory with the first, so the only
     * thing that can decide the winner is the row in the database. The dry-run
     * is deliberately first: it is the pass most likely to have consumed the
     * period by accident, since it reads exactly the same candidates as a real
     * one and differs only in what it writes.
     */
    it('delivers once across three consecutive triggers, dry-run included', async () => {
      await defineSchedule(fx.a);
      await seedAssignedThreadInScriptPeriod(fx.a, fx.a.agentAccountId);

      const preview = JSON.parse((await runScript()).stdout) as {
        totals: { ready: number; alreadyClaimed: number };
      };
      expect(preview.totals).toMatchObject({ ready: 1, alreadyClaimed: 0 });
      // Still nothing written after the preview — the period is untouched, so
      // the delivery below is the first claim rather than a second one.
      expect(await runsOf(fx.a)).toHaveLength(0);

      const first = JSON.parse((await runScript(['--apply'])).stdout) as {
        totals: { delivered: number; skipped: number; failed: number };
      };
      const second = JSON.parse((await runScript(['--apply'])).stdout) as {
        totals: { delivered: number; skipped: number; failed: number };
      };

      expect(first.totals).toMatchObject({ delivered: 1, skipped: 0, failed: 0 });
      expect(second.totals).toMatchObject({ delivered: 0, skipped: 1, failed: 0 });

      // The claim: three triggers, one mail, one row. A second message here is
      // the regression this test exists to catch.
      expect(await scriptMailbox()).toHaveLength(1);
      const runs = await runsOf(fx.a);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: 'sent' });
    }, 120_000);

    /**
     * Pausing a schedule must not release the period it already delivered.
     *
     * The disabled filter lives in the sweep rather than in the claim, so
     * "off then on again" walks a path no other test covers: the middle run
     * sees no candidate at all, and the last one sees a candidate whose period
     * is already spent. If the claim were ever keyed on anything the enabled
     * flag touches — a `last_run_at` comparison, say — this is where a second
     * copy of last period's report would go out, to a workspace that had just
     * turned the schedule back on and would read it as normal.
     */
    it('does not re-deliver a period after the definition is switched off and back on', async () => {
      const id = await defineSchedule(fx.a);

      expect(
        (JSON.parse((await runScript(['--apply'])).stdout) as { totals: { delivered: number } })
          .totals.delivered,
      ).toBe(1);

      await owner.scheduledReport.update({ where: { id }, data: { enabled: false } });
      const paused = JSON.parse((await runScript(['--apply'])).stdout) as {
        totals: { delivered: number; skipped: number };
      };
      // A disabled definition is not even a candidate — neither delivered nor
      // skipped, because nothing looked at its period.
      expect(paused.totals).toMatchObject({ delivered: 0, skipped: 0 });

      await owner.scheduledReport.update({ where: { id }, data: { enabled: true } });
      const resumed = JSON.parse((await runScript(['--apply'])).stdout) as {
        totals: { delivered: number; skipped: number };
      };
      expect(resumed.totals).toMatchObject({ delivered: 0, skipped: 1 });

      expect(await scriptMailbox()).toHaveLength(1);
      expect(await runsOf(fx.a)).toHaveLength(1);
    }, 120_000);

    it('exits with a non-zero code and sends nothing when the database is unreachable', async () => {
      await expect(
        runScript([], {
          DATABASE_APP_URL: 'postgresql://nexa_app:wrong@127.0.0.1:1/nexa_unreachable',
        }),
      ).rejects.toMatchObject({ code: 1 });
      expect(await scriptMailbox()).toHaveLength(0);
    }, 30_000);
  });
});

/**
 * The script fixture, proved for the days this suite will not be run on.
 *
 * The tests above can only ever exercise today's date, which is how the defect
 * these anchors replace survived: a fixture pinned to 2026-08-07 read as correct
 * for as long as the calendar agreed with it, then failed every day afterwards
 * with nothing in the code having changed. Seeding from the real clock is only
 * an improvement if it holds on *every* date, so the rule is checked here
 * directly — no database, no process, just the arithmetic — against the instants
 * where a day-boundary rule is most likely to be wrong.
 *
 * The one thing the fixture cannot control is the gap between the seed and the
 * child process's own `new Date()`. It is seconds in practice (a `pnpm` start),
 * so the property is stated for any lag up to five minutes; beyond a day it is
 * false and no in-process fixture could make it true.
 */
describe('the script fixture lands in the script’s period on any calendar day', () => {
  const SEED_INSTANTS = [
    '2026-08-09T15:48:00.000Z', // an ordinary afternoon, the case that already worked
    '2026-08-09T00:00:00.000Z', // the first instant of a UTC day
    '2026-08-09T23:59:59.999Z', // the last one — a rollover mid-test is live here
    '2026-08-09T22:30:00.000Z', // 01:30 *tomorrow* in this machine's UTC+3: a local
    //                             reading of the calendar would pick the wrong day
    '2026-09-01T00:00:30.000Z', // month boundary
    '2027-01-01T00:00:30.000Z', // year boundary
    '2028-02-29T23:59:59.500Z', // leap day
    '2028-03-01T00:00:00.500Z', // …and the day after it
  ].map((iso) => new Date(iso));

  /** Seed → child `new Date()`. Zero, plausible, and generously beyond it. */
  const LAGS_MS = [0, 1, 2_500, 30_000, 5 * 60_000];

  it('covers the previous complete UTC day whichever side of midnight the child starts on', () => {
    for (const seededAt of SEED_INSTANTS) {
      for (const lag of LAGS_MS) {
        const period = periodFor('daily', new Date(seededAt.getTime() + lag));
        const covering = scriptPeriodAnchors(seededAt).filter(
          (anchor) => anchor >= period.from && anchor <= period.to,
        );
        expect(
          covering.length,
          `seeded ${seededAt.toISOString()}, child ${String(lag)}ms later → period ${period.periodKey}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('never writes a thread into the future, which would make the report unreadable', () => {
    for (const seededAt of SEED_INSTANTS) {
      for (const anchor of scriptPeriodAnchors(seededAt)) {
        expect(anchor.getTime()).toBeLessThan(seededAt.getTime());
      }
    }
  });
});
