/**
 * The owner cancels the subscription (tm 384 · BL-03), end to end against
 * Postgres: the flag and its refusals, the period end that makes the
 * workspace read-only, the export window, the deletion date the retention
 * setting decides, the deletion itself and a new purchase in between.
 *
 * The period-close job's step (`SubscriptionPeriodEnd`) is run with a clock
 * from the future, the way the job would find the subscription days later.
 */
import type { PrismaClient } from '@prisma/client';
import { CANCEL_EXPORT_DAYS } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { activateIfPaid } from '../../src/services/billing/license-activation.js';
import { SubscriptionPeriodEnd } from '../../src/services/billing/subscription-cancel.js';
import { resolveRetentionPolicy } from '../../src/services/retention/policy.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DAY = 86_400_000;
const SCOPES = ['billing_manage', 'reports_read', 'tags--all:rw'];

describe('subscription cancellation (tm 384 · BL-03)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  const mailer = new MemoryMailer();
  let fx: Fixtures;
  let ownerToken: string;
  let adminToken: string;
  let workspaceName: string;
  let periodEnd: Date;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    mailer.clear();
    // A paying workspace: an active licence and a subscription paid through
    // ten days from now. The fixture's second member is its admin.
    periodEnd = new Date(Date.now() + 10 * DAY);
    await owner.license.update({
      where: { id: fx.a.licenseId },
      data: { status: 'active', trialEndsAt: null },
    });
    await owner.subscription.create({
      data: { licenseId: fx.a.licenseId, status: 'active', seats: 2, currentPeriodEnd: periodEnd },
    });
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      data: { role: 'admin' },
    });
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: SCOPES,
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: SCOPES,
    });
    workspaceName = (
      await owner.organization.findUniqueOrThrow({ where: { id: fx.a.organizationId } })
    ).name;
  });

  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  const cancel = (
    token: string,
    body: unknown = { reason: 'too_expensive', confirmation: workspaceName },
  ) => server.post('/billing/subscription/cancel', body, as(token));

  const periodEndStep = (now: Date) =>
    new SubscriptionPeriodEnd({
      db: owner,
      auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
      mailer,
      appUrl: 'https://panel.test',
    }).run({ now });

  async function subscription() {
    return owner.subscription.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } });
  }

  async function licenseStatus(): Promise<string> {
    return (await owner.license.findUniqueOrThrow({ where: { id: fx.a.licenseId } })).status;
  }

  async function auditActions(): Promise<string[]> {
    const rows = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: { startsWith: 'billing.' } },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    return rows.map((row) => row.action);
  }

  it('lets the owner cancel at the end of the period; the workspace keeps working until then', async () => {
    const response = await cancel(ownerToken);
    expect(response.statusCode).toBe(200);
    expect(response.json().cancellation).toMatchObject({
      scheduled: true,
      reason: 'too_expensive',
      takes_effect_at: periodEnd.toISOString(),
      ended_at: null,
      can_cancel: false,
      can_resume: true,
      workspace_name: workspaceName,
    });
    expect(response.json().access).toBe('active');
    const row = await subscription();
    expect(row).toMatchObject({ cancelAtPeriodEnd: true, cancelReason: 'too_expensive' });

    // Still writable: nothing changes before the period ends.
    const write = await server.post('/settings/tags', { name: 'vip' }, as(ownerToken));
    expect(write.statusCode).toBe(201);

    // The owner hears it once, with the date.
    const mails = mailer.sent.filter((m) => m.to === fx.a.ownerEmail);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toContain('ends on');

    // Cancelling again is the same cancellation: no second entry, no mail.
    expect((await cancel(ownerToken)).statusCode).toBe(200);
    expect(await auditActions()).toEqual(['billing.subscription_cancel_scheduled']);
    expect(mailer.sent).toHaveLength(1);

    // The period has not ended: the step leaves it alone.
    expect(await periodEndStep(new Date(periodEnd.getTime() - DAY))).toMatchObject({ ended: 0 });
    expect(await licenseStatus()).toBe('active');
  });

  it('refuses an admin (403) and a name that does not match', async () => {
    const admin = await cancel(adminToken);
    expect(admin.statusCode).toBe(403);
    const adminResume = await server.post(
      '/billing/subscription/resume',
      undefined,
      as(adminToken),
    );
    expect(adminResume.statusCode).toBe(403);

    const wrong = await cancel(ownerToken, { reason: 'other', confirmation: 'not the name' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.details.reason).toBe('confirmation_mismatch');
    const badReason = await cancel(ownerToken, { reason: 'because', confirmation: workspaceName });
    expect(badReason.statusCode).toBe(400);

    // Case and surrounding space do not matter.
    const loose = await cancel(ownerToken, {
      reason: 'other',
      confirmation: `  ${workspaceName.toUpperCase()} `,
    });
    expect(loose.statusCode).toBe(200);
    expect((await subscription()).cancelAtPeriodEnd).toBe(true);
  });

  it('refuses a trial: there is nothing to cancel', async () => {
    await owner.subscription.deleteMany({ where: { licenseId: fx.a.licenseId } });
    const response = await cancel(ownerToken);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.reason).toBe('no_subscription');
    expect(
      (await server.get('/billing/subscription', as(ownerToken))).json().cancellation,
    ).toMatchObject({ scheduled: false, can_cancel: false, can_resume: false });
  });

  it('takes the cancellation back before the period ends', async () => {
    await cancel(ownerToken);
    const resumed = await server.post('/billing/subscription/resume', undefined, as(ownerToken));
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().cancellation).toMatchObject({
      scheduled: false,
      reason: null,
      takes_effect_at: null,
      can_cancel: true,
      can_resume: false,
    });
    expect(await subscription()).toMatchObject({
      cancelAtPeriodEnd: false,
      canceledAt: null,
      cancelReason: null,
    });
    expect(await auditActions()).toEqual([
      'billing.subscription_cancel_scheduled',
      'billing.subscription_resumed',
    ]);

    // Nothing is due any more: the period ends and the subscription carries on.
    expect(await periodEndStep(new Date(periodEnd.getTime() + DAY))).toMatchObject({ ended: 0 });
    expect(await licenseStatus()).toBe('active');
    expect((await subscription()).status).toBe('active');
  });

  it('makes the workspace read-only at the period end; reads and exports still work for 30 days, then it closes', async () => {
    await cancel(ownerToken);
    mailer.clear();
    const endedAt = new Date(periodEnd.getTime() + 60_000);
    expect(await periodEndStep(endedAt)).toMatchObject({ ended: 1, closed: 0 });

    const row = await subscription();
    expect(row.status).toBe('canceled');
    expect(row.endedAt).toEqual(endedAt);
    expect(row.exportUntil!.getTime() - endedAt.getTime()).toBe(CANCEL_EXPORT_DAYS * DAY);
    // No retention chosen: the deletion is planned for the end of the export window.
    expect(row.dataDeletionAt).toEqual(row.exportUntil);
    expect(await licenseStatus()).toBe('read_only');

    // Read-only: a write is refused, a read and an export answer.
    const write = await server.post('/settings/tags', { name: 'late' }, as(ownerToken));
    expect(write.statusCode).toBe(402);
    expect(write.json().error.type).toBe('license_expired');
    const view = await server.get('/billing/subscription', as(ownerToken));
    expect(view.json()).toMatchObject({ status: 'read_only', access: 'read_only' });
    expect(view.json().cancellation).toMatchObject({
      scheduled: false,
      ended_at: endedAt.toISOString(),
      export_until: row.exportUntil!.toISOString(),
      data_deletion_at: row.dataDeletionAt!.toISOString(),
      can_cancel: false,
      can_resume: false,
    });
    const exported = await server.get('/reports/export?group=overview', as(ownerToken));
    expect(exported.statusCode).toBe(200);

    // Resuming after the end is a new purchase, not a resume.
    const late = await server.post('/billing/subscription/resume', undefined, as(ownerToken));
    expect(late.statusCode).toBe(400);
    expect(late.json().error.details.reason).toBe('subscription_ended');

    // The owner is told when the export window closes and when the data goes.
    const ended = mailer.sent.filter((m) => m.to === fx.a.ownerEmail);
    expect(ended).toHaveLength(1);
    expect(ended[0]!.subject).toContain('has ended');

    // A second pass the same moment changes nothing.
    expect(await periodEndStep(endedAt)).toMatchObject({ ended: 0, closed: 0 });

    // The export window passes: the workspace closes, the data is still there.
    const after = new Date(row.exportUntil!.getTime() + 60_000);
    expect(await periodEndStep(after)).toMatchObject({ ended: 0, closed: 1 });
    expect(await licenseStatus()).toBe('canceled');
    expect(await auditActions()).toEqual([
      'billing.subscription_cancel_scheduled',
      'billing.subscription_ended',
      'billing.license_status_changed',
      'billing.license_status_changed',
    ]);
  });

  it('ends a subscription with no term on file at the end of the month it was cancelled in', async () => {
    await owner.subscription.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { currentPeriodEnd: null },
    });
    const response = await cancel(ownerToken);
    const requested = new Date(response.json().cancellation.requested_at as string);
    const monthEnd = new Date(Date.UTC(requested.getUTCFullYear(), requested.getUTCMonth() + 1, 1));
    expect(response.json().cancellation.takes_effect_at).toBe(monthEnd.toISOString());

    // The database's own reading of the date agrees with the panel's.
    expect(await periodEndStep(new Date(monthEnd.getTime() - 1))).toMatchObject({ tenants: 0 });
    expect(await periodEndStep(monthEnd)).toMatchObject({ tenants: 1, ended: 1 });
  });

  it('keeps the data for the longer retention the workspace chose, and never for unlimited', async () => {
    await owner.license.update({
      where: { id: fx.a.licenseId },
      data: { retentionThreadWindow: '365d' },
    });
    await cancel(ownerToken);
    const endedAt = new Date(periodEnd.getTime() + 1000);
    await periodEndStep(endedAt);
    const row = await subscription();
    expect(row.dataDeletionAt!.getTime() - endedAt.getTime()).toBe(365 * DAY);
    // The export window is the same thirty days either way.
    expect(row.exportUntil!.getTime() - endedAt.getTime()).toBe(30 * DAY);

    // Workspace B, `unlimited`: ended, nothing planned.
    await owner.license.update({
      where: { id: fx.b.licenseId },
      data: { status: 'active', retentionThreadWindow: 'unlimited' },
    });
    await owner.subscription.create({
      data: {
        licenseId: fx.b.licenseId,
        status: 'active',
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
      },
    });
    await periodEndStep(endedAt);
    const b = await owner.subscription.findFirstOrThrow({ where: { licenseId: fx.b.licenseId } });
    expect(b.status).toBe('canceled');
    expect(b.dataDeletionAt).toBeNull();
  });

  it('deletes the workspace in the retention sweep once its deletion date has passed', async () => {
    await cancel(ownerToken);
    await periodEndStep(new Date(periodEnd.getTime() + 1000));
    const runner = new RetentionRunner(owner, {
      policy: resolveRetentionPolicy(testEnv()),
      mailDir: testEnv().MAIL_DIR,
      auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
    });

    // Planned, not yet due: the sweep keeps it.
    expect((await runner.run({ dryRun: false })).totals.canceledWorkspaces).toBe(0);
    expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(1);

    // The date passes (the purge reads the database's clock, so the row moves).
    await owner.subscription.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { dataDeletionAt: new Date(Date.now() - 60_000) },
    });
    expect((await runner.run({ dryRun: true })).totals.canceledWorkspaces).toBe(1);
    expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(1);
    expect((await runner.run({ dryRun: false })).totals.canceledWorkspaces).toBe(1);
    expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(0);
    // The other workspace is untouched.
    expect(await owner.license.count({ where: { id: fx.b.licenseId } })).toBe(1);
  });

  it('a new purchase after the end lifts the read-only state and drops the deletion date', async () => {
    await cancel(ownerToken);
    await periodEndStep(new Date(periodEnd.getTime() + 1000));
    expect(await licenseStatus()).toBe('read_only');

    // The mocked checkout: a plan and a card on file.
    await owner.paymentMethod.create({
      data: {
        licenseId: fx.a.licenseId,
        brand: 'visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
        holderName: 'Owner',
      },
    });
    await withTenant(owner, fx.a, (tx) => activateIfPaid(tx, fx.a));
    expect(await licenseStatus()).toBe('active');
    expect(await subscription()).toMatchObject({
      status: 'active',
      cancelAtPeriodEnd: false,
      endedAt: null,
      exportUntil: null,
      dataDeletionAt: null,
    });

    // Nothing is due for deletion any more, whatever the date.
    await owner.subscription.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { dataDeletionAt: null },
    });
    const due = await owner.$queryRaw<Array<{ license_id: bigint }>>`
      SELECT license_id FROM subscription_cancel_purge_due()`;
    expect(due).toEqual([]);
  });

  it('refuses to purge a workspace whose subscription has not ended', async () => {
    // Called straight, as the tenant role could: an active workspace with a
    // deletion date it should never have is still not deleted.
    await owner.$executeRaw`
      UPDATE subscriptions SET ended_at = now() - interval '2 days',
                               data_deletion_at = now() - interval '1 day'
       WHERE license_id = ${fx.a.licenseId}`;
    const [result] = await owner.$queryRaw<Array<{ purged: boolean }>>`
      SELECT subscription_cancel_purge(${fx.a.licenseId}::bigint) AS purged`;
    expect(result!.purged).toBe(false);
    expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(1);
  });
});
