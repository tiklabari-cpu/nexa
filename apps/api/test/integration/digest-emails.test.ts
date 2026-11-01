/**
 * The summary e-mails (RP-05 · tm 372) — the delivery half of "yöneticiler
 * panele girmeden günün özetini alsın".
 *
 * A sent e-mail cannot be recalled, so what is proved here is what decides
 * whether it is safe to run on a timer:
 *
 *   1. **A period is mailed to a member at most once.** Sweeping the same instant
 *      twice — or two sweeps at once — leaves one message and one claimed row
 *      (KK1). The claim is written before the mail.
 *   2. **Each reader gets their own reach.** A Team Lead's summary counts only the
 *      teams they lead (KK2); a lead of no team gets none; the workspace's figures
 *      never reach another workspace.
 *   3. **No player data in the body** (KK3). A player named "Zeynep Gizli" who
 *      wrote "kart no 4111…" is in the data and nowhere in the mail.
 *   4. **Switches mean what they say.** Own choice beats the workspace default;
 *      `notify_email` off, a suspended member and a member who joined after the
 *      summary was due get nothing.
 *   5. **A failure consumes the period, a refused cap does not.**
 *
 * `NOW` is Monday 2026-11-02 08:30 in Istanbul (UTC+3): the daily summary for
 * Sunday 2026-11-01 and the weekly one for 2026-10-26 – 2026-11-01 are both due.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@siyahtus/types';
import { FileMailer, type Mailer, type Message } from '../../src/services/mail/mailer.js';
import { withTenant } from '../../src/lib/tenant.js';
import { MailCapError } from '../../src/services/mail/mail-error.js';
import {
  DIGEST_CAP_DEFERRED,
  DigestSweeper,
} from '../../src/services/notifications/digest-sweeper.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** Monday 08:30 in Istanbul. */
const NOW = new Date('2026-11-02T05:30:00.000Z');
/** Sunday 2026-11-01 noon in Istanbul — inside the daily period. */
const YESTERDAY = new Date('2026-11-01T09:00:00.000Z');
/** Saturday 2026-10-31 — the day before, the comparison period. */
const DAY_BEFORE = new Date('2026-10-31T09:00:00.000Z');
const DAILY_KEY = 'D2026-11-01';
const WEEKLY_KEY = 'W2026-10-26';
/** Long before any summary was due. */
const LONG_AGO = new Date('2026-01-01T00:00:00.000Z');

class BrokenMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error('smtp: connection refused');
  }
}

class CappedOut implements Mailer {
  async send(): Promise<void> {
    throw new MailCapError('workspace');
  }
}

describe('summary e-mails (RP-05)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;

  const sweep = (mail: Mailer = mailer, now: Date = NOW) =>
    new DigestSweeper(appRole, mail, { appUrl: 'https://panel.example.test' }).run({ now });

  const mailbox = async (): Promise<Message[]> =>
    (await mailer.outbox()).filter((message) => message.kind === 'digest');

  const rowsOf = (t: TenantFixture) =>
    owner.digestDelivery.findMany({
      where: { licenseId: t.licenseId },
      orderBy: [{ periodKey: 'asc' }, { createdAt: 'asc' }],
    });

  /** Every membership in the fixtures joined long before the summaries were due. */
  async function backdateMemberships(): Promise<void> {
    await owner.agentMembership.updateMany({ data: { createdAt: LONG_AGO } });
  }

  async function company(t: TenantFixture, timezone = 'Europe/Istanbul'): Promise<void> {
    await owner.organization.update({ where: { id: t.organizationId }, data: { timezone } });
  }

  async function team(t: TenantFixture, name: string): Promise<bigint> {
    return (
      await owner.group.create({
        data: { licenseId: t.licenseId, name },
        select: { id: true },
      })
    ).id;
  }

  async function member(
    t: TenantFixture,
    role: string,
    options: { leads?: bigint[]; email?: string } = {},
  ): Promise<{ id: string; email: string }> {
    const email = options.email ?? `${role}-${t.licenseId}-${generateShortId()}@example.test`;
    const account = await owner.account.create({
      data: { email, name: `Kişi ${role}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: t.licenseId,
        agentId: account.id,
        role,
        routingStatus: 'accepting_chats',
        createdAt: LONG_AGO,
      },
    });
    for (const groupId of options.leads ?? []) {
      await owner.groupAgent.create({
        data: { licenseId: t.licenseId, groupId, agentId: account.id, isLead: true },
      });
    }
    return { id: account.id, email };
  }

  /** A closed connection in a team, with a first reply a minute in. */
  async function connection(
    t: TenantFixture,
    at: Date,
    options: { teams?: bigint[]; customerName?: string; text?: string } = {},
  ): Promise<string> {
    const customer = await owner.customer.create({
      data: {
        organizationId: t.organizationId,
        name: options.customerName ?? 'Oyuncu',
        email: options.customerName ? 'zeynep.gizli@example.test' : null,
      },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active: false },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: false,
        assigneeId: t.agentAccountId,
        createdAt: at,
        closedAt: new Date(at.getTime() + 600_000),
        firstResponseAt: new Date(at.getTime() + 60_000),
      },
    });
    for (const groupId of options.teams ?? []) {
      await owner.chatAccess.create({ data: { chatId, groupId } });
    }
    if (options.text !== undefined) {
      await owner.event.create({
        data: {
          id: `${threadId}_101`,
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          authorType: 'customer',
          recipients: 'all',
          text: options.text,
          createdAt: at,
        },
      });
    }
    return threadId;
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-digest-'));
    mailer = new FileMailer(mailDir);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await rm(mailDir, { recursive: true, force: true });
    await backdateMemberships();
    await company(fx.a);
    await company(fx.b);
    // Workspace B is a bystander unless a test says otherwise: nobody in it
    // gets a summary, so the mailbox and the sweep's totals are A's alone.
    await owner.digestSettings.create({
      data: { licenseId: fx.b.licenseId, dailyRoles: [], weeklyRoles: [] },
    });
  });

  /** Put workspace B back on the shipped default, for the tests about it. */
  async function switchOnWorkspaceB(): Promise<void> {
    await owner.digestSettings.deleteMany({ where: { licenseId: fx.b.licenseId } });
  }

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // KK1 — once
  // ==========================================================================

  it('mails the Founder one daily summary after 08:00, and not again on a second sweep (KK1)', async () => {
    await connection(fx.a, YESTERDAY);

    const first = await sweep();
    expect(first.totals).toMatchObject({ delivered: 1, skipped: 0, failed: 0 });
    const inbox = await mailbox();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.to).toBe(fx.a.ownerEmail);
    expect(inbox[0]?.subject).toBe(
      'Daily summary: ' + (await workspaceName(fx.a)) + ' · 2026-11-01',
    );

    const second = await sweep();
    expect(second.totals).toMatchObject({ delivered: 0, failed: 0 });
    expect(await mailbox()).toHaveLength(1);

    const [row] = await rowsOf(fx.a);
    expect(row).toMatchObject({
      agentId: fx.a.ownerAccountId,
      frequency: 'daily',
      periodKey: DAILY_KEY,
      status: 'sent',
      error: null,
    });
    expect(row?.periodFrom.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    expect(row?.periodTo.toISOString()).toBe('2026-11-01T20:59:59.999Z');
  });

  async function workspaceName(t: TenantFixture): Promise<string> {
    const org = await owner.organization.findUniqueOrThrow({ where: { id: t.organizationId } });
    return org.name;
  }

  it('two sweeps at the same moment send one message (the claim is the guard)', async () => {
    await connection(fx.a, YESTERDAY);
    await Promise.all([sweep(), sweep(), sweep()]);
    expect(await mailbox()).toHaveLength(1);
    expect(await rowsOf(fx.a)).toHaveLength(1);
  });

  it('sends nothing before the summary is due for the day it belongs to, and the next day’s once it is', async () => {
    // 04:59Z is 07:59 in Istanbul on the Monday: the Sunday-08:00 summary is
    // still the latest due, so it goes out (late) under its own key…
    await sweep(mailer, new Date('2026-11-02T04:59:00.000Z'));
    expect((await rowsOf(fx.a)).map((r) => r.periodKey)).toEqual(['D2026-10-31']);
    // …and at 08:00 sharp the Monday one is claimed as a second, separate period.
    await sweep(mailer, new Date('2026-11-02T05:00:00.000Z'));
    expect((await rowsOf(fx.a)).map((r) => r.periodKey)).toEqual(['D2026-10-31', DAILY_KEY]);
    // Later in the day: nothing new.
    await sweep(mailer, new Date('2026-11-02T18:00:00.000Z'));
    expect(await rowsOf(fx.a)).toHaveLength(2);
  });

  it('is the company’s clock that decides, not UTC’s', async () => {
    await switchOnWorkspaceB();
    await company(fx.a, 'Pacific/Auckland'); // UTC+13: 18:30 on Monday, long past 08:00
    await sweep();
    expect((await rowsOf(fx.a))[0]?.periodKey).toBe(DAILY_KEY);
    await company(fx.b, 'America/Los_Angeles'); // UTC-8: 21:30 Sunday, the Monday 08:00 is hours away
    await sweep();
    // Sunday 08:00 Pacific passed, so Saturday’s summary is the one due there.
    expect((await rowsOf(fx.b))[0]?.periodKey).toBe('D2026-10-31');
  });

  // ==========================================================================
  // Content
  // ==========================================================================

  it('states the period’s figures and the change against the day before', async () => {
    await connection(fx.a, YESTERDAY);
    await connection(fx.a, YESTERDAY);
    await connection(fx.a, YESTERDAY);
    await connection(fx.a, DAY_BEFORE);

    await sweep();
    const [message] = await mailbox();
    expect(message?.body).toContain('Chats: 3 (+2)');
    expect(message?.body).toContain('First reply (average): 1 min');
    expect(message?.body).toContain('Missed chats: 0 (±0)');
    expect(message?.html).toContain('https://panel.example.test/app/reports');
  });

  it('writes in the member’s panel language', async () => {
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId } },
      data: { locale: 'tr' },
    });
    await sweep();
    const [message] = await mailbox();
    expect(message?.subject).toMatch(/^Günlük özet: /);
    expect(message?.body).toContain('Kaçan sohbet');
  });

  it('carries no player data: no name, address or message text (KK3)', async () => {
    await connection(fx.a, YESTERDAY, {
      customerName: 'Zeynep Gizli',
      text: 'kart no 4111 1111 1111 1111 ve şifrem hunter2',
    });

    await sweep();
    const [message] = await mailbox();
    expect(message).toBeDefined();
    const whole = [message?.subject, message?.body, message?.html].join('\n');
    for (const secret of ['Zeynep', 'Gizli', 'zeynep.gizli', '4111', 'hunter2', 'kart no']) {
      expect(whole).not.toContain(secret);
    }
    expect(whole).toContain('Chats: 1');
  });

  // ==========================================================================
  // KK2 — each reader's reach
  // ==========================================================================

  it('gives a Team Lead only their own teams’ numbers (KK2)', async () => {
    const mine = await team(fx.a, 'Finans');
    const other = await team(fx.a, 'Teknik');
    const lead = await member(fx.a, 'team_lead', { leads: [mine] });
    await connection(fx.a, YESTERDAY, { teams: [mine] });
    await connection(fx.a, YESTERDAY, { teams: [mine] });
    await connection(fx.a, YESTERDAY, { teams: [other] });
    await connection(fx.a, YESTERDAY, { teams: [other] });
    await connection(fx.a, YESTERDAY, { teams: [other] });

    await sweep();
    const inbox = await mailbox();
    const toLead = inbox.find((m) => m.to === lead.email);
    const toOwner = inbox.find((m) => m.to === fx.a.ownerEmail);
    expect(toLead?.body).toContain('Chats: 2');
    expect(toLead?.body).toContain('only the teams you lead');
    expect(toOwner?.body).toContain('Chats: 5');
    // The link names the team by id and carries nothing else.
    expect(toLead?.html).toContain(`group_id=${mine.toString()}`);
    expect(toLead?.html).not.toContain(`group_id=${other.toString()}`);
  });

  it('sends a Team Lead of no team nothing — never the workspace’s figures', async () => {
    const lead = await member(fx.a, 'team_lead');
    await connection(fx.a, YESTERDAY);
    await sweep();
    expect((await mailbox()).map((m) => m.to)).not.toContain(lead.email);
    expect((await rowsOf(fx.a)).filter((r) => r.agentId === lead.id)).toHaveLength(0);
  });

  it('keeps one workspace’s figures out of another’s mail', async () => {
    await switchOnWorkspaceB();
    await connection(fx.a, YESTERDAY);
    await connection(fx.a, YESTERDAY);
    await connection(fx.b, YESTERDAY);

    await sweep();
    const inbox = await mailbox();
    const toA = inbox.find((m) => m.to === fx.a.ownerEmail);
    const toB = inbox.find((m) => m.to === fx.b.ownerEmail);
    expect(toA?.body).toContain('Chats: 2');
    expect(toB?.body).toContain('Chats: 1');
    expect((await rowsOf(fx.a)).every((r) => r.licenseId === fx.a.licenseId)).toBe(true);
  });

  it('gives a plain Agent nothing by default, and nothing even if they switch it on without report access', async () => {
    await sweep();
    expect((await mailbox()).map((m) => m.to)).not.toContain(fx.a.agentEmail);

    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { notifyDigestDaily: true },
    });
    await sweep();
    // `reports.view` is `none` for an Agent: a switch cannot grant figures.
    expect((await mailbox()).map((m) => m.to)).not.toContain(fx.a.agentEmail);
  });

  // ==========================================================================
  // The switches
  // ==========================================================================

  it('lets a member’s own switch beat the workspace default, both ways', async () => {
    const off = { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId } };
    await owner.agentMembership.update({ where: off, data: { notifyDigestDaily: false } });
    await sweep();
    expect(await mailbox()).toHaveLength(0);

    // Back to following the default (null): the Founder is on it.
    await owner.agentMembership.update({ where: off, data: { notifyDigestDaily: null } });
    await sweep();
    expect(await mailbox()).toHaveLength(1);
  });

  it('follows the workspace default by role, and the weekly one is off until a workspace turns it on', async () => {
    await sweep();
    expect((await rowsOf(fx.a)).map((r) => r.frequency)).toEqual(['daily']);

    await owner.digestSettings.create({
      data: { licenseId: fx.a.licenseId, dailyRoles: [], weeklyRoles: ['owner'] },
    });
    await sweep();
    // Daily was already sent for the period; the weekly one now goes out.
    expect((await rowsOf(fx.a)).map((r) => r.periodKey)).toEqual([DAILY_KEY, WEEKLY_KEY].sort());
    const weekly = (await mailbox()).find((m) => m.subject.startsWith('Weekly summary'));
    expect(weekly?.subject).toMatch(/2026-10-26 – 2026-11-01$/);
  });

  it('sends nothing to a member who turned e-mail off, is suspended, or joined after it was due', async () => {
    const quiet = await member(fx.a, 'admin');
    const suspended = await member(fx.a, 'admin');
    const newcomer = await member(fx.a, 'admin');
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: quiet.id } },
      data: { notifyEmail: false },
    });
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: suspended.id } },
      data: { suspended: true },
    });
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: newcomer.id } },
      data: { createdAt: new Date('2026-11-02T05:10:00.000Z') },
    });

    await sweep();
    const to = (await mailbox()).map((m) => m.to);
    expect(to).toContain(fx.a.ownerEmail);
    for (const gone of [quiet.email, suspended.email, newcomer.email]) {
      expect(to).not.toContain(gone);
    }
  });

  // ==========================================================================
  // Failure
  // ==========================================================================

  it('keeps a failed delivery’s period consumed, with the reason on the row', async () => {
    const report = await sweep(new BrokenMailer());
    expect(report.totals).toMatchObject({ delivered: 0, failed: 1 });
    const [row] = await rowsOf(fx.a);
    expect(row).toMatchObject({ status: 'failed' });
    expect(row?.error).toContain('connection refused');

    await sweep();
    expect(await mailbox()).toHaveLength(0);
    expect(await rowsOf(fx.a)).toHaveLength(1);
  });

  it('hands a period the daily mail cap refused to the next sweep, and sends it then', async () => {
    const refused = await sweep(new CappedOut());
    expect(refused.totals).toMatchObject({ delivered: 0, deferred: 1, failed: 0 });
    expect((await rowsOf(fx.a))[0]).toMatchObject({ status: 'failed', error: DIGEST_CAP_DEFERRED });

    const retried = await sweep();
    expect(retried.totals).toMatchObject({ delivered: 1, deferred: 0 });
    expect(await mailbox()).toHaveLength(1);
    expect((await rowsOf(fx.a))[0]).toMatchObject({ status: 'sent', error: null });
  });

  it('leaves a workspace with no recipients alone', async () => {
    await sweep();
    expect(await rowsOf(fx.b)).toHaveLength(0);
  });

  // ==========================================================================
  // The tables
  // ==========================================================================

  describe('schema', () => {
    const claim = (t: TenantFixture, agentId: string, over: Record<string, unknown> = {}) =>
      owner.digestDelivery.create({
        data: {
          licenseId: t.licenseId,
          agentId,
          frequency: 'daily',
          periodKey: DAILY_KEY,
          periodFrom: new Date('2026-10-31T21:00:00.000Z'),
          periodTo: new Date('2026-11-01T20:59:59.999Z'),
          ...over,
        },
      });

    it('turns a second claim for the same member and period into a constraint violation', async () => {
      await claim(fx.a, fx.a.ownerAccountId);
      await expect(claim(fx.a, fx.a.ownerAccountId)).rejects.toMatchObject({ code: 'P2002' });
      // Another member, another period: free.
      await claim(fx.a, fx.a.agentAccountId);
      await claim(fx.a, fx.a.ownerAccountId, { periodKey: WEEKLY_KEY, frequency: 'weekly' });
    });

    it('refuses a period key, frequency, status or range the sweep would never write', async () => {
      const bad: Array<Record<string, unknown>> = [
        { periodKey: '2026-11-01' },
        { periodKey: 'X2026-11-01' },
        { frequency: 'monthly' },
        { status: 'done' },
        { periodFrom: new Date('2026-11-02T00:00:00.000Z') },
      ];
      for (const over of bad) {
        await expect(claim(fx.a, fx.a.ownerAccountId, over)).rejects.toThrow();
      }
      expect(await rowsOf(fx.a)).toHaveLength(0);
    });

    it('refuses a role the workspace default cannot name', async () => {
      await expect(
        owner.digestSettings.create({
          data: { licenseId: fx.a.licenseId, dailyRoles: ['janitor'] },
        }),
      ).rejects.toThrow();
    });

    it('cannot file a delivery for another workspace’s member (composite key)', async () => {
      await expect(claim(fx.a, fx.b.ownerAccountId)).rejects.toThrow();
    });

    it('shows a workspace only its own deliveries and default (RLS)', async () => {
      await claim(fx.a, fx.a.ownerAccountId);
      await claim(fx.b, fx.b.ownerAccountId);
      await owner.digestSettings.create({
        data: { licenseId: fx.a.licenseId, dailyRoles: [], weeklyRoles: [] },
      });

      const seen = await withTenant(
        appRole,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => ({
          deliveries: await tx.digestDelivery.findMany({ select: { licenseId: true } }),
          settings: await tx.digestSettings.findMany({ select: { licenseId: true } }),
        }),
      );
      expect(seen.deliveries.map((r) => r.licenseId)).toEqual([fx.a.licenseId]);
      expect(seen.settings.map((r) => r.licenseId)).toEqual([fx.a.licenseId]);

      const other = await withTenant(
        appRole,
        { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
        (tx) => tx.digestSettings.findMany(),
      );
      // …and workspace B, with a default of its own, sees that and nothing of A's.
      expect(other.map((r) => r.licenseId)).toEqual([fx.b.licenseId]);
    });

    it('goes with the member: removing a membership removes its deliveries', async () => {
      await claim(fx.a, fx.a.agentAccountId);
      await owner.agentMembership.delete({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      });
      expect(await rowsOf(fx.a)).toHaveLength(0);
    });
  });
});
