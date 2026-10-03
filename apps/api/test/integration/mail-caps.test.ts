/**
 * The daily outgoing-mail caps, at the counter (tm 257.14 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(4)).
 *
 * `CappedMailer` in front of a real spool, over the application role, against
 * the `mail_budget_*` functions in a real Postgres: the four counts (workspace,
 * external, global short of the security reserve, per recipient), the check
 * and the increment holding under concurrency, the refund of a mail the
 * carrier refused, the scheduled report that keeps its period when the cap
 * refuses it, and a command-line job sending through the same caps. What the
 * routes do with a refusal is `mail-caps-routes.test.ts`.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { generateShortId } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import {
  CappedMailer,
  SECURITY_MAIL_PER_RECIPIENT,
  recipientHash,
  type MailDailyCaps,
} from '../../src/services/mail/mail-caps.js';
import {
  MailCapError,
  PermanentMailError,
  type MailCapScope,
} from '../../src/services/mail/mail-error.js';
import { FileMailer, type Mailer, type Message } from '../../src/services/mail/mailer.js';
import {
  MAIL_CAP_DEFERRED,
  ScheduledReportSweeper,
} from '../../src/services/reports/scheduled-report-sweeper.js';
import {
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const NOW = new Date('2026-08-08T09:00:00.000Z');
const DAY = utcDayKey(NOW);

const CAPS: MailDailyCaps = {
  workspace: 200,
  external: 50,
  global: 400,
  reserve: 50,
  recipient: SECURITY_MAIL_PER_RECIPIENT,
};

interface Warning {
  details: Record<string, unknown>;
  message: string;
}

describe('daily mail caps at the counter (tm 257.14)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let mailDir: string;
  let spool: FileMailer;
  let fx: Fixtures;
  let warnings: Warning[];
  let errors: Warning[];

  const logger = {
    warn: (details: Record<string, unknown>, message: string) =>
      warnings.push({ details, message }),
    error: (details: Record<string, unknown>, message: string) => errors.push({ details, message }),
  };

  const capped = (caps: Partial<MailDailyCaps> = {}, carrier: Mailer = spool) =>
    new CappedMailer(carrier, appRole, { ...CAPS, ...caps }, { logger, now: () => NOW });

  const mail = (
    kind: Message['kind'],
    licenseId: bigint | null,
    to = 'someone@example.test',
  ): Message => ({ to, licenseId, kind, subject: `${kind} subject`, body: `${kind} body` });

  /** Send, and report what happened: `sent` or the cap that refused it. */
  async function attempt(mailer: Mailer, message: Message): Promise<'sent' | MailCapScope> {
    try {
      await mailer.send(message);
      return 'sent';
    } catch (error) {
      if (error instanceof MailCapError) return error.scope;
      throw error;
    }
  }

  async function counter(
    meter: string,
    licenseId: bigint | null,
    day = DAY,
    hash: string | null = null,
  ): Promise<number> {
    const rows = await owner.$queryRaw<Array<{ sent: number }>>`
      SELECT sent FROM mail_daily_usage
       WHERE day = ${day} AND meter = ${meter}
         AND license_id IS NOT DISTINCT FROM ${licenseId}::bigint
         AND recipient_hash IS NOT DISTINCT FROM ${hash}::text`;
    return rows[0]?.sent ?? 0;
  }

  /** Put a counter where a scenario needs it, as the table owner. */
  async function fill(
    meter: string,
    licenseId: bigint | null,
    sent: number,
    day = DAY,
  ): Promise<void> {
    await owner.$executeRaw`
      INSERT INTO mail_daily_usage (id, license_id, day, meter, recipient_hash, sent, updated_at)
      VALUES (gen_random_uuid(), ${licenseId}::bigint, ${day}, ${meter}, NULL, ${sent}, now())
      ON CONFLICT (license_id, day, meter, recipient_hash) DO UPDATE SET sent = EXCLUDED.sent`;
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-mail-caps-'));
    spool = new FileMailer(mailDir);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await rm(mailDir, { recursive: true, force: true });
    warnings = [];
    errors = [];
  });

  // ==========================================================================
  // The four counts
  // ==========================================================================

  it('stops a workspace at its daily cap, and logs each refusal once, without the recipient', async () => {
    const mailer = capped({ workspace: 2 });

    expect(await attempt(mailer, mail('notification', fx.a.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('scheduled_report', fx.a.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('notification', fx.a.licenseId, 'victim@example.test'))).toBe(
      'workspace',
    );
    // Another workspace has its own allowance.
    expect(await attempt(mailer, mail('notification', fx.b.licenseId))).toBe('sent');

    expect(await spool.outbox()).toHaveLength(3);
    expect(await counter('workspace', fx.a.licenseId)).toBe(2);
    expect(await counter('global', null)).toBe(3);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.details).toEqual({
      event: 'mail.cap_reached',
      kind: 'notification',
      license_id: fx.a.licenseId.toString(),
      scope: 'workspace',
    });
    expect(JSON.stringify(warnings)).not.toContain('victim@example.test');
  });

  it('counts mail leaving a workspace against the external cap, and leaves internal mail alone', async () => {
    const mailer = capped({ external: 2 });

    expect(await attempt(mailer, mail('invitation', fx.a.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('chat_transcript', fx.a.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('ticket_notice', fx.a.licenseId))).toBe('external');
    expect(await attempt(mailer, mail('invitation', fx.a.licenseId))).toBe('external');

    // The workspace's own people are still reachable.
    expect(await attempt(mailer, mail('notification', fx.a.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('scheduled_report', fx.a.licenseId))).toBe('sent');

    expect(await counter('external', fx.a.licenseId)).toBe(2);
    // A refusal at the external row hands back the workspace count it took.
    expect(await counter('workspace', fx.a.licenseId)).toBe(4);
    expect((await spool.outbox()).map((m) => m.kind).sort()).toEqual(
      ['chat_transcript', 'invitation', 'notification', 'scheduled_report'].sort(),
    );
  });

  it('holds two workspaces to the global cap together, short of the reserve, which account mail can still use', async () => {
    // Global 4, reserve 1: workspace mail stops at 3, account mail at 4.
    const mailer = capped({ global: 4, reserve: 1 });

    expect(await attempt(mailer, mail('invitation', fx.a.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('notification', fx.b.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('notification', fx.a.licenseId))).toBe('sent');
    expect(await attempt(mailer, mail('notification', fx.b.licenseId))).toBe('global');

    // The tenants filled everything they may: the reserve is still there.
    expect(await attempt(mailer, mail('password_reset', null, 'owner@example.test'))).toBe('sent');
    // And then the global cap itself holds for account mail too.
    expect(await attempt(mailer, mail('email_verification', null, 'new@example.test'))).toBe(
      'global',
    );

    expect(await counter('global', null)).toBe(4);
    // Each refusal at the global row handed back what it took on the way.
    expect(await counter('workspace', fx.b.licenseId)).toBe(1);
    expect(await counter('recipient', null, DAY, recipientHash('new@example.test'))).toBe(0);
  });

  it('caps the account mail an anonymous caller can cause per address, case-insensitively, across the three kinds', async () => {
    const mailer = capped();
    const kinds: Message['kind'][] = [
      'password_reset',
      'email_verification',
      'account_exists_notice',
      'password_reset',
      'password_reset',
    ];
    for (const kind of kinds) {
      expect(await attempt(mailer, mail(kind, null, 'victim@example.test'))).toBe('sent');
    }
    expect(SECURITY_MAIL_PER_RECIPIENT).toBe(kinds.length);

    // The sixth, under another spelling of the same mailbox, is refused.
    expect(await attempt(mailer, mail('password_reset', null, ' Victim@Example.TEST '))).toBe(
      'recipient',
    );
    // Another address is not affected; the two-factor notice (signed-in only)
    // has no per-address count.
    expect(await attempt(mailer, mail('password_reset', null, 'other@example.test'))).toBe('sent');
    for (let i = 0; i < SECURITY_MAIL_PER_RECIPIENT + 1; i += 1) {
      expect(await attempt(mailer, mail('notification', null, 'victim@example.test'))).toBe('sent');
    }

    expect(await counter('recipient', null, DAY, recipientHash('victim@example.test'))).toBe(5);
    // The table holds a digest, never the address.
    const stored = await owner.$queryRaw<Array<{ recipient_hash: string | null }>>`
      SELECT recipient_hash FROM mail_daily_usage WHERE meter = 'recipient'`;
    expect(JSON.stringify(stored)).not.toContain('victim');
  });

  it('counts exactly the cap when twenty mails race for it', async () => {
    // Twenty processes' worth of senders, each on a connection of its own and
    // already open: one pooled client would let its first warm connection
    // drain the burst one by one, and a read-then-write counter would pass.
    const clients = Array.from({ length: 10 }, () => new PrismaClient({ datasourceUrl: APP_URL }));
    try {
      await Promise.all(clients.map((client) => client.$queryRaw`SELECT 1`));
      const mailers = clients.map(
        (client) =>
          new CappedMailer(spool, client, { ...CAPS, workspace: 5 }, { logger, now: () => NOW }),
      );

      const outcomes = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          attempt(
            mailers[i % mailers.length]!,
            mail('notification', fx.a.licenseId, `agent-${i}@example.test`),
          ),
        ),
      );

      expect(outcomes.filter((o) => o === 'sent')).toHaveLength(5);
      expect(outcomes.filter((o) => o === 'workspace')).toHaveLength(15);
      expect(await spool.outbox()).toHaveLength(5);
      expect(await counter('workspace', fx.a.licenseId)).toBe(5);
      expect(await counter('global', null)).toBe(5);
    } finally {
      await Promise.all(clients.map((client) => client.$disconnect()));
    }
  });

  it('gives back a mail the carrier refused for good, and keeps one whose acceptance was never confirmed', async () => {
    const refusing = capped(
      {},
      {
        send: async () => {
          throw new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
        },
      },
    );
    await expect(refusing.send(mail('ticket_notice', fx.a.licenseId))).rejects.toBeInstanceOf(
      PermanentMailError,
    );
    await expect(
      refusing.send(mail('password_reset', null, 'x@example.test')),
    ).rejects.toBeInstanceOf(PermanentMailError);
    expect(await counter('workspace', fx.a.licenseId)).toBe(0);
    expect(await counter('external', fx.a.licenseId)).toBe(0);
    expect(await counter('recipient', null, DAY, recipientHash('x@example.test'))).toBe(0);
    expect(await counter('global', null)).toBe(0);

    const unconfirmed = capped(
      {},
      {
        send: async () => {
          throw new PermanentMailError({ code: 'unconfirmed', phase: 'data' });
        },
      },
    );
    await expect(unconfirmed.send(mail('ticket_notice', fx.a.licenseId))).rejects.toBeInstanceOf(
      PermanentMailError,
    );
    expect(await counter('external', fx.a.licenseId)).toBe(1);
    expect(await counter('global', null)).toBe(1);
  });

  it("keeps the counter out of the application role's hands: it can read its own rows, never write one", async () => {
    await fill('workspace', fx.a.licenseId, 3);
    await expect(appRole.$executeRaw`UPDATE mail_daily_usage SET sent = 0`).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      appRole.$executeRaw`
        INSERT INTO mail_daily_usage (id, license_id, day, meter, sent, updated_at)
        VALUES (gen_random_uuid(), NULL, ${DAY}, 'global', 0, now())`,
    ).rejects.toThrow(/permission denied/i);
    expect(await counter('workspace', fx.a.licenseId)).toBe(3);
  });

  // ==========================================================================
  // The scheduled report keeps its period
  // ==========================================================================

  describe('a scheduled report refused by the cap', () => {
    const IN_PERIOD = new Date('2026-08-07T12:00:00.000Z');

    async function defineDailyReport(t: TenantFixture): Promise<string> {
      const row = await owner.scheduledReport.create({
        data: {
          licenseId: t.licenseId,
          groupId: 'team-performance',
          frequency: 'daily',
          format: 'csv',
          recipients: [t.agentEmail, t.ownerEmail],
          enabled: true,
        },
        select: { id: true },
      });
      return row.id;
    }

    async function seedClosedThread(t: TenantFixture): Promise<void> {
      const customer = await owner.customer.create({
        data: { organizationId: t.organizationId, name: 'Visitor' },
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
          assigneeId: t.agentAccountId,
          createdAt: IN_PERIOD,
          closedAt: new Date(IN_PERIOD.getTime() + 60_000),
        },
      });
    }

    const sweep = () => new ScheduledReportSweeper(appRole, capped()).run({ now: NOW });
    const reports = async () => (await spool.outbox()).filter((m) => m.kind === 'scheduled_report');

    it('keeps its period, and the next sweep delivers it once the allowance is back', async () => {
      const definitionId = await defineDailyReport(fx.a);
      await seedClosedThread(fx.a);
      await fill('workspace', fx.a.licenseId, CAPS.workspace);

      const deferred = await sweep();
      expect(deferred.totals).toMatchObject({ delivered: 0, failed: 0, deferred: 1 });
      expect(await reports()).toEqual([]);
      const [held] = await owner.scheduledReportRun.findMany({
        where: { scheduledReportId: definitionId },
      });
      expect(held).toMatchObject({ status: 'failed', recipientCount: 0, error: MAIL_CAP_DEFERRED });
      // One refusal, one line: the loop stops at the cap.
      expect(warnings.filter((w) => w.details['event'] === 'mail.cap_reached')).toHaveLength(1);

      // Still capped: deferred again, not skipped and not consumed.
      expect((await sweep()).totals).toMatchObject({ deferred: 1, skipped: 0 });

      // The allowance is back (a new day, or an operator raising it).
      await owner.$executeRaw`DELETE FROM mail_daily_usage`;
      const delivered = await sweep();
      expect(delivered.totals).toMatchObject({ delivered: 1, deferred: 0 });
      expect((await reports()).map((m) => m.to).sort()).toEqual(
        [fx.a.agentEmail, fx.a.ownerEmail].sort(),
      );
      const runs = await owner.scheduledReportRun.findMany({
        where: { scheduledReportId: definitionId },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: 'sent', recipientCount: 2, error: null });

      // And it is delivered once.
      expect((await sweep()).totals).toMatchObject({ delivered: 0, skipped: 1 });
      expect(await reports()).toHaveLength(2);
    });

    it('consumes the period like any failure when the cap stops it after a recipient may have it', async () => {
      const definitionId = await defineDailyReport(fx.a);
      await seedClosedThread(fx.a);
      // Room for exactly one of the two recipients.
      await fill('workspace', fx.a.licenseId, CAPS.workspace - 1);

      const report = await sweep();
      expect(report.totals).toMatchObject({ delivered: 0, failed: 1, deferred: 0 });
      expect(await reports()).toHaveLength(1);
      const [run] = await owner.scheduledReportRun.findMany({
        where: { scheduledReportId: definitionId },
      });
      expect(run).toMatchObject({ status: 'failed', recipientCount: 1 });
      expect(run!.error).toMatch(/after 1 of 2 recipients/);

      await owner.$executeRaw`DELETE FROM mail_daily_usage`;
      // Not re-sent: the first recipient already has it.
      expect((await sweep()).totals).toMatchObject({ delivered: 0, skipped: 1 });
      expect(await reports()).toHaveLength(1);
    });
  });

  // ==========================================================================
  // A command-line job sends through the same caps
  // ==========================================================================

  describe('chat-timeout:run', () => {
    const run = promisify(execFile);
    // test/integration → test → api → apps → repo root.
    const repoRoot = resolve(import.meta.dirname, '../../../..');

    async function idleChatWithVisitorEmail(t: TenantFixture, email: string): Promise<string> {
      const brand = await owner.brand.findFirstOrThrow({
        where: { licenseId: t.licenseId, isDefault: true },
        select: { id: true },
      });
      await owner.inboxSettings.upsert({
        where: { licenseId_brandId: { licenseId: t.licenseId, brandId: brand.id } },
        create: { licenseId: t.licenseId, brandId: brand.id, chatTimeoutSeconds: 3600 },
        update: { chatTimeoutSeconds: 3600 },
      });
      const lastActivity = new Date(Date.now() - 2 * 3_600_000);
      const customer = await owner.customer.create({
        data: { organizationId: t.organizationId, name: 'Vic', email },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: {
          id: chatId,
          licenseId: t.licenseId,
          customerId: customer.id,
          active: true,
          createdAt: lastActivity,
        },
      });
      const threadId = generateShortId();
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: t.licenseId,
          active: true,
          closedAt: null,
          createdAt: lastActivity,
        },
      });
      await owner.event.create({
        data: {
          id: `e${generateShortId()}`.padEnd(40, '0'),
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          authorType: 'customer',
          text: 'Anyone there?',
          recipients: 'all',
          createdAt: lastActivity,
        },
      });
      return chatId;
    }

    it(
      "drops a capped workspace's transcript and sends another workspace's",
      { timeout: 120_000 },
      async () => {
        await Promise.all([
          seedDefaultBrand(owner, fx.a.licenseId),
          seedDefaultBrand(owner, fx.b.licenseId),
        ]);
        const cappedChat = await idleChatWithVisitorEmail(fx.a, 'capped-visitor@example.test');
        const openChat = await idleChatWithVisitorEmail(fx.b, 'open-visitor@example.test');
        // Workspace A has used its whole day — today's and, should the job start
        // after midnight UTC, tomorrow's.
        const today = new Date();
        for (const at of [today, new Date(today.getTime() + 86_400_000)]) {
          await fill('workspace', fx.a.licenseId, 1, utcDayKey(at));
        }

        const scriptMailDir = await mkdtemp(join(tmpdir(), 'siyahtus-mail-caps-cli-'));
        try {
          await run('pnpm', ['--filter', '@siyahtus/api', 'run', 'chat-timeout:run'], {
            cwd: repoRoot,
            env: {
              ...process.env,
              MAIL_PROVIDER: 'file',
              MAIL_DIR: scriptMailDir,
              MAIL_DAILY_PER_WORKSPACE: '1',
            },
            // `pnpm` is a shell shim on Windows (see scheduled-reports-sweep.test.ts).
            shell: true,
            maxBuffer: 4 * 1024 * 1024,
          });

          // Both chats closed — the cap drops the courtesy mail, never the close.
          const closed = await owner.chat.findMany({
            where: { id: { in: [cappedChat, openChat] } },
            select: { id: true, active: true },
          });
          expect(closed.every((chat) => !chat.active)).toBe(true);

          const sent = await new FileMailer(scriptMailDir).outbox();
          expect(sent.map((m) => `${m.kind} → ${m.to}`)).toEqual([
            'chat_transcript → open-visitor@example.test',
          ]);
          expect(sent[0]!.licenseId).toBe(fx.b.licenseId);
        } finally {
          await rm(scriptMailDir, { recursive: true, force: true });
        }
      },
    );
  });
});
