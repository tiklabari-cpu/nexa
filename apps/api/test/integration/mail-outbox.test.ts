/**
 * The durable mail outbox (tm 464.1 · G-05 / NY-44): `enqueueMail` writes a
 * mail in its caller's transaction, the `mail_outbox` sender hands it to the
 * carrier and keeps trying what the carrier could not take.
 *
 * The three properties the task names, against the real functions:
 *
 *   1. The carrier fails twice and the third attempt sends — with the backoff
 *      between, so a retry is not due the moment it fails.
 *   2. A restart loses nothing: a mail queued before it is sent by the next
 *      process, and one a dead sender was holding is sent once its lease runs
 *      out.
 *   3. Two senders never send one row twice: a row another claim holds is
 *      skipped rather than waited for (`FOR UPDATE SKIP LOCKED`), and a burst
 *      of concurrent senders claims every row exactly once.
 *
 * Around them: the transactional write and its rollback, the idempotency key,
 * RLS (a workspace sees only its own rows; nobody updates or deletes), the
 * carrier's classification (permanent, `unconfirmed`, a daily cap, an error
 * that never reached a carrier), the five-attempt ceiling, a stopped pass, the
 * prune, and a log that never carries the recipient or the message.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import {
  MailCapError,
  PermanentMailError,
  TransientMailError,
} from '../../src/services/mail/mail-error.js';
import type { Mailer, Message } from '../../src/services/mail/mailer.js';
import {
  claimMailOutbox,
  enqueueMail,
  MailOutboxWorker,
  type MailOutboxReport,
} from '../../src/services/mail/outbox.js';
import { buildSchedulerJobs } from '../../src/services/scheduler/jobs.js';
import {
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { recordingLogger, silentLogger } from '../helpers/scheduler.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** A carrier whose answer per call the test decides. */
class ScriptedMailer implements Mailer {
  readonly calls: Message[] = [];
  readonly delivered: Message[] = [];

  constructor(
    private readonly script: (message: Message, call: number) => void | Promise<void> = () =>
      undefined,
    private readonly delayMs = 0,
  ) {}

  async send(message: Message): Promise<void> {
    this.calls.push(message);
    const call = this.calls.length;
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    await this.script(message, call);
    this.delivered.push(message);
  }
}

const transient = (): TransientMailError =>
  new TransientMailError({ code: 'connection', phase: 'connect' });

describe('the mail outbox (tm 464.1 · G-05)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  const extraClients: PrismaClient[] = [];

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  function mail(overrides: Partial<Message> = {}): Message {
    return {
      to: 'player@example.test',
      subject: 'Your ticket was answered',
      body: 'Hello — the answer is inside.',
      kind: 'ticket_notice',
      licenseId: fx.a.licenseId,
      ...overrides,
    };
  }

  /** Queue `message` in its workspace (or, for account mail, outside any). */
  async function queue(message: Message, key: string, db: PrismaClient = app): Promise<string> {
    const result =
      message.licenseId === null
        ? await enqueueMail(db, message, { idempotencyKey: key })
        : await withTenant(db, message.licenseId === fx.a.licenseId ? ctx(fx.a) : ctx(fx.b), (tx) =>
            enqueueMail(tx, message, { idempotencyKey: key }),
          );
    if (!result.enqueued) throw new Error(`not enqueued: ${key}`);
    return result.id;
  }

  const row = (id: string) => owner.mailOutbox.findUniqueOrThrow({ where: { id } });

  /** Time passes: every pending row's backoff or lease is over. */
  async function makeDue(): Promise<void> {
    await owner.$executeRaw`
      UPDATE mail_outbox SET next_attempt_at = clock_timestamp() - interval '1 second'
       WHERE status = 'pending'`;
  }

  /** Seconds from now until the row is due, by the database's clock. */
  async function dueInSeconds(id: string): Promise<number> {
    const rows = await owner.$queryRaw<Array<{ s: number }>>`
      SELECT EXTRACT(EPOCH FROM next_attempt_at - clock_timestamp())::float8 AS s
        FROM mail_outbox WHERE id = ${id}::uuid`;
    return rows[0]!.s;
  }

  /** A separate, already-connected application-role client — a second process. */
  async function client(): Promise<PrismaClient> {
    const db = new PrismaClient({ datasourceUrl: APP_URL });
    await db.$queryRaw`SELECT 1`;
    extraClients.push(db);
    return db;
  }

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    fx = await seedFixtures(owner);
  });

  beforeEach(async () => {
    await owner.mailOutbox.deleteMany();
  });

  afterEach(async () => {
    await Promise.all(extraClients.splice(0).map((db) => db.$disconnect()));
  });

  afterAll(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });

  describe('enqueueMail', () => {
    it("is written in the caller's transaction: committed it is queued, rolled back it is not", async () => {
      const id = await queue(
        mail({ html: '<p>Hello</p>', references: ['a@b.test'], locale: 'tr' }),
        'committed',
      );
      const queued = await row(id);
      expect(queued).toMatchObject({
        licenseId: fx.a.licenseId,
        kind: 'ticket_notice',
        recipient: 'player@example.test',
        status: 'pending',
        attempts: 0,
        lastError: null,
        settledAt: null,
        idempotencyKey: 'committed',
      });
      // The rest of the message — and not the three things that are columns.
      expect(queued.payload).toEqual({
        subject: 'Your ticket was answered',
        body: 'Hello — the answer is inside.',
        html: '<p>Hello</p>',
        references: ['a@b.test'],
        locale: 'tr',
      });

      await expect(
        withTenant(app, ctx(fx.a), async (tx) => {
          await enqueueMail(tx, mail(), { idempotencyKey: 'rolled-back' });
          throw new Error('the decision did not commit');
        }),
      ).rejects.toThrow('the decision did not commit');
      expect(await owner.mailOutbox.count({ where: { idempotencyKey: 'rolled-back' } })).toBe(0);
    });

    it('adds nothing for a key already queued — per workspace, with account mail its own key space', async () => {
      const inA = () =>
        withTenant(app, ctx(fx.a), (tx) => enqueueMail(tx, mail(), { idempotencyKey: 'invite:1' }));
      expect((await inA()).enqueued).toBe(true);
      expect((await inA()).enqueued).toBe(false);
      // The same key in another workspace is another mail.
      const inB = await withTenant(app, ctx(fx.b), (tx) =>
        enqueueMail(tx, mail({ licenseId: fx.b.licenseId }), { idempotencyKey: 'invite:1' }),
      );
      expect(inB.enqueued).toBe(true);
      // Account mail: one key space for the deployment (NULLS NOT DISTINCT).
      const account = () =>
        enqueueMail(app, mail({ licenseId: null, kind: 'password_reset' }), {
          idempotencyKey: 'invite:1',
        });
      expect((await account()).enqueued).toBe(true);
      expect((await account()).enqueued).toBe(false);
      expect(await owner.mailOutbox.count({ where: { idempotencyKey: 'invite:1' } })).toBe(3);

      await expect(enqueueMail(app, mail(), { idempotencyKey: '' })).rejects.toThrow(RangeError);
    });

    it('keeps a workspace to its own rows: no other workspace, no account mail, no update or delete', async () => {
      await queue(mail(), 'a-1');
      await queue(mail({ licenseId: fx.b.licenseId }), 'b-1');
      await queue(mail({ licenseId: null, kind: 'password_reset' }), 'account-1');

      const seenByA = await withTenant(app, ctx(fx.a), (tx) =>
        tx.mailOutbox.findMany({ select: { idempotencyKey: true } }),
      );
      expect(seenByA.map((r) => r.idempotencyKey)).toEqual(['a-1']);
      // Outside any workspace the application role sees nothing at all.
      expect(await app.mailOutbox.count()).toBe(0);

      // Another workspace's mail, from inside A — or a workspace's from outside.
      await expect(
        withTenant(app, ctx(fx.a), (tx) =>
          enqueueMail(tx, mail({ licenseId: fx.b.licenseId }), { idempotencyKey: 'b-from-a' }),
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(enqueueMail(app, mail(), { idempotencyKey: 'a-from-nowhere' })).rejects.toThrow(
        /row-level security/,
      );
      // Account mail from inside a workspace request is still account mail.
      const notice = await withTenant(app, ctx(fx.a), (tx) =>
        enqueueMail(tx, mail({ licenseId: null, kind: 'password_reset' }), {
          idempotencyKey: 'account-from-a',
        }),
      );
      expect(notice.enqueued).toBe(true);

      // State moves only through the functions.
      await expect(
        withTenant(app, ctx(fx.a), (tx) => tx.mailOutbox.updateMany({ data: { status: 'sent' } })),
      ).rejects.toThrow(/permission denied/);
      await expect(withTenant(app, ctx(fx.a), (tx) => tx.mailOutbox.deleteMany())).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('the sender', () => {
    it('sends a queued mail as it was written, records it sent and empties its payload', async () => {
      const original = mail({
        html: '<p>Hello</p>',
        attachments: [{ filename: 'r.csv', contentType: 'text/csv', content: 'a,b\n1,2\n' }],
        replyTo: 'reply+t1@example.test',
        fromName: 'Acme',
      });
      const id = await queue(original, 'send-1');
      const mailer = new ScriptedMailer();

      const report = await new MailOutboxWorker(app, { mailer }).run();

      expect(report).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0, lost: 0 });
      expect(mailer.delivered).toEqual([original]);
      const sent = await row(id);
      expect(sent).toMatchObject({ status: 'sent', attempts: 1, lastError: null, payload: {} });
      expect(sent.settledAt).not.toBeNull();
      // Nothing left to send.
      expect((await new MailOutboxWorker(app, { mailer }).run()).claimed).toBe(0);
    });

    it('retries what the carrier could not take: two failures, then the third attempt sends — 1 min, then 4 min apart', async () => {
      const id = await queue(mail(), 'flaky');
      const mailer = new ScriptedMailer((_message, call) => {
        if (call <= 2) throw transient();
      });
      const worker = new MailOutboxWorker(app, { mailer });

      expect(await worker.run()).toMatchObject({ claimed: 1, retried: 1, sent: 0 });
      expect(await row(id)).toMatchObject({
        status: 'pending',
        attempts: 1,
        lastError: 'connection',
      });
      expect(await dueInSeconds(id)).toBeGreaterThan(55);
      expect(await dueInSeconds(id)).toBeLessThanOrEqual(60);
      // Not due yet: a pass now takes nothing.
      expect((await worker.run()).claimed).toBe(0);
      expect(mailer.calls).toHaveLength(1);

      await makeDue();
      expect(await worker.run()).toMatchObject({ claimed: 1, retried: 1 });
      expect(await row(id)).toMatchObject({ status: 'pending', attempts: 2 });
      expect(await dueInSeconds(id)).toBeGreaterThan(235);
      expect(await dueInSeconds(id)).toBeLessThanOrEqual(240);

      await makeDue();
      expect(await worker.run()).toMatchObject({ claimed: 1, sent: 1 });
      expect(await row(id)).toMatchObject({
        status: 'sent',
        attempts: 3,
        lastError: null,
        payload: {},
      });
      expect(mailer.calls).toHaveLength(3);
      expect(mailer.delivered).toHaveLength(1);
    });

    it('gives up after five attempts, and never takes the row again', async () => {
      const id = await queue(mail(), 'dead-server');
      const mailer = new ScriptedMailer(() => {
        throw new TransientMailError({ code: 'timeout', phase: 'greeting' });
      });
      const worker = new MailOutboxWorker(app, { mailer });

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect(await worker.run(), `attempt ${attempt}`).toMatchObject({ retried: 1 });
        await makeDue();
      }
      expect(await worker.run()).toMatchObject({ failed: 1, retried: 0 });
      const failed = await row(id);
      expect(failed).toMatchObject({
        status: 'failed',
        attempts: 5,
        lastError: 'timeout',
        payload: {},
      });
      expect(failed.settledAt).not.toBeNull();

      await makeDue();
      expect((await worker.run()).claimed).toBe(0);
      expect(mailer.calls).toHaveLength(5);
    });

    it('never retries what the carrier says must not be sent again: a refusal, an unconfirmed hand-over, a daily cap', async () => {
      const refused = await queue(mail({ to: 'refused@example.test' }), 'refused');
      const unconfirmed = await queue(mail({ to: 'unconfirmed@example.test' }), 'unconfirmed');
      const capped = await queue(mail({ to: 'capped@example.test' }), 'capped');
      const mailer = new ScriptedMailer((message) => {
        if (message.to === 'refused@example.test') {
          throw new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
        }
        if (message.to === 'unconfirmed@example.test') {
          throw new PermanentMailError({ code: 'unconfirmed', phase: 'message' });
        }
        throw new MailCapError('workspace');
      });
      const worker = new MailOutboxWorker(app, { mailer });

      expect(await worker.run()).toMatchObject({
        claimed: 3,
        sent: 0,
        unconfirmed: 1,
        failed: 2,
        retried: 0,
      });
      expect(await row(refused)).toMatchObject({
        status: 'failed',
        attempts: 1,
        lastError: 'rejected',
      });
      expect(await row(unconfirmed)).toMatchObject({
        status: 'unconfirmed',
        attempts: 1,
        lastError: 'unconfirmed',
        payload: {},
      });
      expect(await row(capped)).toMatchObject({
        status: 'failed',
        attempts: 1,
        lastError: 'cap_reached',
      });

      await makeDue();
      expect((await worker.run()).claimed).toBe(0);
      expect(mailer.calls).toHaveLength(3);
    });

    it('tries again an error that never reached a carrier', async () => {
      const id = await queue(mail(), 'disk-full');
      const mailer = new ScriptedMailer(() => {
        throw new Error('ENOSPC: no space left on device');
      });

      expect(await new MailOutboxWorker(app, { mailer }).run()).toMatchObject({ retried: 1 });
      expect(await row(id)).toMatchObject({
        status: 'pending',
        attempts: 1,
        lastError: 'unexpected',
      });
    });

    it('fails a row whose payload is not a message without contacting the carrier, and takes the recipient from its column', async () => {
      // Written by the owner: the application role would have to go through
      // `enqueueMail`, which cannot produce either payload.
      const empty = await owner.mailOutbox.create({
        data: {
          licenseId: null,
          kind: 'password_reset',
          recipient: 'someone@example.test',
          payload: {},
          idempotencyKey: 'no-body',
        },
      });
      const redirected = await owner.mailOutbox.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'notification',
          recipient: 'column@example.test',
          payload: { subject: 's', body: 'b', to: 'payload@example.test', licenseId: null },
          idempotencyKey: 'redirect',
        },
      });
      const mailer = new ScriptedMailer();

      expect(await new MailOutboxWorker(app, { mailer }).run()).toMatchObject({
        claimed: 2,
        sent: 1,
        failed: 1,
      });
      expect(await row(empty.id)).toMatchObject({ status: 'failed', lastError: 'invalid_message' });
      expect(mailer.calls).toHaveLength(1);
      expect(mailer.calls[0]).toMatchObject({
        to: 'column@example.test',
        licenseId: fx.a.licenseId,
        kind: 'notification',
      });
      expect(await row(redirected.id)).toMatchObject({ status: 'sent' });
    });

    it('loses nothing to a restart: a queued mail goes with the next process, a held one once its lease runs out', async () => {
      const before = await client();
      const queuedFirst = await queue(mail({ to: 'first@example.test' }), 'restart-1', before);
      const queuedSecond = await queue(mail({ to: 'second@example.test' }), 'restart-2', before);
      // The old process's sender took the older row, with a one-second lease,
      // and died before sending it.
      const held = await claimMailOutbox(before, { limit: 1, leaseSeconds: 1, maxAttempts: 5 });
      expect(held.map((c) => c.id)).toEqual([queuedFirst]);
      await before.$disconnect();

      const after = await client();
      const mailer = new ScriptedMailer();
      const worker = new MailOutboxWorker(after, { mailer });
      // The row nobody holds goes at once; the held one is the dead sender's
      // until its lease ends.
      expect(await worker.run()).toMatchObject({ claimed: 1, sent: 1 });
      expect(mailer.delivered.map((m) => m.to)).toEqual(['second@example.test']);

      await new Promise((resolve) => setTimeout(resolve, 1_200));
      expect(await worker.run()).toMatchObject({ claimed: 1, sent: 1 });
      expect(mailer.delivered.map((m) => m.to)).toEqual([
        'second@example.test',
        'first@example.test',
      ]);
      expect(await row(queuedFirst)).toMatchObject({ status: 'sent', attempts: 2 });
      expect(await row(queuedSecond)).toMatchObject({ status: 'sent', attempts: 1 });
    });

    it('settles failed, without sending, a row whose sender died during its last attempt', async () => {
      const id = await queue(mail(), 'died-last');
      // The fifth claim, whose sender never came back: lease run out.
      await owner.$executeRaw`
        UPDATE mail_outbox SET attempts = 5, next_attempt_at = clock_timestamp() - interval '1 second'
         WHERE id = ${id}::uuid`;
      const mailer = new ScriptedMailer();

      expect((await new MailOutboxWorker(app, { mailer }).run()).claimed).toBe(0);
      expect(await row(id)).toMatchObject({
        status: 'failed',
        attempts: 5,
        lastError: 'attempts_exhausted',
        payload: {},
      });
      expect(mailer.calls).toHaveLength(0);
    });

    it('skips a row another claim is holding instead of waiting for it, and never sends it twice (FOR UPDATE SKIP LOCKED)', async () => {
      const ids: string[] = [];
      for (let i = 1; i <= 6; i += 1) {
        ids.push(await queue(mail({ to: `held-${i}@example.test` }), `held-${i}`));
      }
      const holder = await client();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let claimed!: (rows: Array<{ id: string }>) => void;
      const claimedRows = new Promise<Array<{ id: string }>>((resolve) => (claimed = resolve));
      // Another sender's claim, still inside its transaction: its three rows
      // are locked until it commits.
      const holding = holder.$transaction(
        async (tx) => {
          claimed(
            await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id::text AS id FROM mail_outbox_claim(3, 600, 5)`,
          );
          await gate;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );

      try {
        const heldIds = (await claimedRows).map((r) => r.id).sort();
        expect(heldIds).toEqual(ids.slice(0, 3).sort());

        const mailer = new ScriptedMailer();
        const sender = new MailOutboxWorker(await client(), { mailer });
        let timer: NodeJS.Timeout | undefined;
        const report = await Promise.race([
          sender.run(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error('the pass waited for the rows another claim holds')),
              5_000,
            );
          }),
        ]).finally(() => clearTimeout(timer));

        expect(report).toMatchObject({ claimed: 3, sent: 3, lost: 0 });
        expect(mailer.delivered.map((m) => m.to).sort()).toEqual([
          'held-4@example.test',
          'held-5@example.test',
          'held-6@example.test',
        ]);

        release();
        await holding;
        // The holder's rows are its own until their lease ends.
        expect((await sender.run()).claimed).toBe(0);
        expect(mailer.calls).toHaveLength(3);
      } finally {
        release();
        await holding.catch(() => undefined);
      }
    });

    it('claims every row exactly once when four senders run at once', async () => {
      const ROWS = 40;
      for (let i = 0; i < ROWS; i += 1) {
        await queue(
          mail({ licenseId: null, kind: 'password_reset', to: `burst-${i}@example.test` }),
          `burst-${i}`,
        );
      }
      const mailer = new ScriptedMailer(undefined, 3);
      const senders = await Promise.all(
        [1, 2, 3, 4].map(
          async () => new MailOutboxWorker(await client(), { mailer, batchSize: 5 }),
        ),
      );

      const reports: MailOutboxReport[] = await Promise.all(senders.map((s) => s.run()));

      const sentTo = mailer.delivered.map((m) => m.to);
      expect(sentTo).toHaveLength(ROWS);
      expect(new Set(sentTo).size).toBe(ROWS);
      expect(reports.reduce((n, r) => n + r.sent, 0)).toBe(ROWS);
      expect(reports.reduce((n, r) => n + r.lost, 0)).toBe(0);
      // No row was claimed twice: one attempt each.
      const attempts = await owner.mailOutbox.groupBy({
        by: ['status', 'attempts'],
        _count: { _all: true },
      });
      expect(attempts).toEqual([{ status: 'sent', attempts: 1, _count: { _all: ROWS } }]);
    });

    it('a claim whose lease ran out and was taken over neither sends nor records', async () => {
      const id = await queue(mail(), 'slow-sender');
      const slow = await claimMailOutbox(app, { limit: 1, leaseSeconds: 1, maxAttempts: 5 });
      expect(slow.map((c) => c.attempts)).toEqual([1]);
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      const mailer = new ScriptedMailer();
      expect(await new MailOutboxWorker(app, { mailer }).run()).toMatchObject({ sent: 1 });
      expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2 });

      // The slow sender comes back with its first claim.
      const [renewed] = await app.$queryRaw<Array<{ ok: boolean }>>`
        SELECT mail_outbox_renew(${id}::uuid, 1, 600) AS ok`;
      const [settled] = await app.$queryRaw<Array<{ ok: boolean }>>`
        SELECT mail_outbox_settle(${id}::uuid, 1, 'failed', 'timeout', 0) AS ok`;
      const [released] = await app.$queryRaw<Array<{ ok: boolean }>>`
        SELECT mail_outbox_release(${id}::uuid, 1) AS ok`;
      expect([renewed?.ok, settled?.ok, released?.ok]).toEqual([false, false, false]);
      expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    });

    it('hands back the rows a stopped pass had not tried', async () => {
      for (let i = 1; i <= 3; i += 1)
        await queue(mail({ to: `stop-${i}@example.test` }), `stop-${i}`);
      const stop = new AbortController();
      const mailer = new ScriptedMailer(() => stop.abort());

      const report = await new MailOutboxWorker(app, { mailer }).run({ signal: stop.signal });

      expect(report).toMatchObject({ claimed: 3, sent: 1, released: 2 });
      const rows = await owner.mailOutbox.findMany({ orderBy: { recipient: 'asc' } });
      expect(rows.map((r) => [r.recipient, r.status, r.attempts])).toEqual([
        ['stop-1@example.test', 'sent', 1],
        ['stop-2@example.test', 'pending', 0],
        ['stop-3@example.test', 'pending', 0],
      ]);
      // Due at once, not after a lease.
      expect(await new MailOutboxWorker(app, { mailer: new ScriptedMailer() }).run()).toMatchObject(
        { claimed: 2, sent: 2 },
      );
    });

    it('prunes settled rows past 30 days and never a pending one', async () => {
      const old = await queue(mail({ to: 'old@example.test' }), 'old');
      const recent = await queue(mail({ to: 'recent@example.test' }), 'recent');
      await new MailOutboxWorker(app, { mailer: new ScriptedMailer() }).run();
      const waiting = await queue(mail({ to: 'waiting@example.test' }), 'waiting');
      await owner.$executeRaw`
        UPDATE mail_outbox SET settled_at = clock_timestamp() - interval '31 days' WHERE id = ${old}::uuid`;
      await owner.$executeRaw`
        UPDATE mail_outbox SET settled_at = clock_timestamp() - interval '29 days' WHERE id = ${recent}::uuid`;
      await owner.$executeRaw`
        UPDATE mail_outbox SET created_at = clock_timestamp() - interval '90 days',
                               next_attempt_at = clock_timestamp() + interval '1 hour'
         WHERE id = ${waiting}::uuid`;

      const report = await new MailOutboxWorker(app, { mailer: new ScriptedMailer() }).run();

      expect(report).toMatchObject({ claimed: 0, pruned: 1 });
      const left = await owner.mailOutbox.findMany({ select: { id: true } });
      expect(left.map((r) => r.id).sort()).toEqual([recent, waiting].sort());
    });

    it('logs the row, the kind and the carrier’s classification — never the recipient or the message', async () => {
      await queue(mail({ to: 'retry.me@example.test', subject: 'Secret subject' }), 'log-retry');
      await queue(mail({ to: 'refuse.me@example.test', body: 'Private body text' }), 'log-fail');
      await queue(mail({ to: 'maybe.me@example.test' }), 'log-unconfirmed');
      const mailer = new ScriptedMailer((message) => {
        if (message.to.startsWith('retry')) throw transient();
        if (message.to.startsWith('refuse')) {
          throw new PermanentMailError({
            code: 'rejected',
            phase: 'rcpt_to',
            smtpCode: 550,
            enhancedCode: '5.1.1',
          });
        }
        throw new PermanentMailError({ code: 'unconfirmed', phase: 'message' });
      });
      const { lines, logger } = recordingLogger();

      await new MailOutboxWorker(app, { mailer, logger }).run();

      expect(lines.map((l) => [l.level, l.payload['outcome']]).sort()).toEqual([
        ['error', 'failed'],
        ['warn', 'retry'],
        ['warn', 'unconfirmed'],
      ]);
      const failed = lines.find((l) => l.payload['outcome'] === 'failed')!;
      expect(failed.payload).toMatchObject({
        event: 'mail.outbox',
        kind: 'ticket_notice',
        attempt: 1,
        license_id: fx.a.licenseId.toString(),
        code: 'rejected',
        mail: { code: 'rejected', phase: 'rcpt_to', smtpCode: 550, enhancedCode: '5.1.1' },
      });
      expect(typeof failed.payload['outbox_id']).toBe('string');
      const logged = JSON.stringify(lines);
      for (const secret of ['example.test', 'Secret subject', 'Private body text', 'Hello']) {
        expect(logged).not.toContain(secret);
      }
    });

    it('is the scheduler’s mail_outbox job, sending with the server’s mailer', async () => {
      const id = await queue(mail(), 'via-job');
      const mailer = new ScriptedMailer();
      const job = buildSchedulerJobs({ db: app, env: testEnv(), mailer }).find(
        (j) => j.name === 'mail_outbox',
      );

      const outcome = await job?.run({
        signal: new AbortController().signal,
        logger: silentLogger(),
      });

      expect(outcome?.counts).toMatchObject({ claimed: 1, sent: 1 });
      expect(mailer.delivered).toHaveLength(1);
      expect(await row(id)).toMatchObject({ status: 'sent' });
    });
  });
});
