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
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { FileMailer, type Mailer } from '../../src/services/mail/mailer.js';
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
   */
  async function seedAssignedThread(t: TenantFixture, agentId: string): Promise<void> {
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
        createdAt: IN_PERIOD,
      },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: t.licenseId,
        active: false,
        assigneeId: agentId,
        createdAt: IN_PERIOD,
        closedAt: new Date(IN_PERIOD.getTime() + 60_000),
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
});
