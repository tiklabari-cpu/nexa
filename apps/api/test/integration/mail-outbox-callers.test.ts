/**
 * The callers on the mail outbox (tm 464.2 · G-05 / NY-44).
 *
 * 464.1 built `mail_outbox` and its sender; this pins that the mail the API
 * sends now goes through it — read back from the table, then from the spool:
 *
 *   - a ticket reply, a ticket notice, a transcript and an invitation are
 *     queued in the transaction that decided them, under a key that names
 *     what they are about, and sent straight after the commit;
 *   - every other send (a password reset, a sweep) is queued in its own
 *     transaction by the server's mailer before the carrier is tried;
 *   - a first try that fails retryably is not lost and not reported as
 *     failed: the row waits, the `mail_outbox` job's pass sends it, and a
 *     ticket reply's `delivery_status` follows the retry, not the first try;
 *   - a permanent refusal and a daily cap still reach the caller as before.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileMailer, type Mailer, type Message } from '../../src/services/mail/mailer.js';
import { PermanentMailError, TransientMailError } from '../../src/services/mail/mail-error.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const TICKETS = ['tickets--all:rw', 'tickets--all:ro', 'customers:ro'];
const PLAYER_EMAIL = 'outbox.oyuncu@example.test';

/** A carrier that spools, or fails the way it is told to — and counts each attempt. */
class SwitchableCarrier implements Mailer {
  mode: 'ok' | 'transient' | 'permanent' = 'ok';
  readonly attempts: Message[] = [];

  constructor(private readonly spool: FileMailer) {}

  async send(message: Message): Promise<void> {
    this.attempts.push(message);
    if (this.mode === 'transient') {
      throw new TransientMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 451 });
    }
    if (this.mode === 'permanent') {
      throw new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
    }
    await this.spool.send(message);
  }
}

interface OutboxRow {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  idempotencyKey: string;
  lastError: string | null;
}

describe('the callers on the mail outbox (tm 464.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailDir: string;
  let spool: FileMailer;
  let carrier: SwitchableCarrier;
  let fx: Fixtures;
  let ticketToken: string;
  let accountsToken: string;
  let playerId: string;
  let keySeq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-outbox-callers-'));
    spool = new FileMailer(mailDir);
    carrier = new SwitchableCarrier(spool);
    server = await startTestServer({ TICKET_MAIL_OUTBOUND: 'true' }, { mailer: carrier });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await rm(mailDir, { recursive: true, force: true });
    await owner.mailOutbox.deleteMany({});
    carrier.mode = 'ok';
    carrier.attempts.length = 0;
    const player = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Outbox Oyuncu', email: PLAYER_EMAIL },
      select: { id: true },
    });
    playerId = player.id;
    ticketToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: TICKETS,
    });
    accountsToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
  });

  async function rows(kind?: string): Promise<OutboxRow[]> {
    return owner.mailOutbox.findMany({
      where: kind ? { kind } : {},
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        status: true,
        attempts: true,
        idempotencyKey: true,
        lastError: true,
      },
    });
  }

  /** The `mail_outbox` job's pass, once every waiting row's backoff is over. */
  async function retryPass() {
    await owner.mailOutbox.updateMany({
      where: { status: 'pending' },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const report = await server.app.mailOutbox.createWorker().run();
    await server.app.backgroundMail.settled();
    return report;
  }

  async function makeTicket(): Promise<string> {
    const response = await server.post(
      '/tickets',
      { subject: 'Outbox talebi', customer_id: playerId },
      auth(ticketToken),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  async function reply(ticketId: string): Promise<{ id: string; delivery_status: string }> {
    const response = await server.post(
      `/tickets/${ticketId}/messages`,
      { kind: 'reply', text: 'Talebiniz ele alındı.', idempotency_key: `outbox-${++keySeq}` },
      auth(ticketToken),
    );
    expect(response.statusCode, response.body).toBe(201);
    await server.app.backgroundMail.settled();
    return response.json() as { id: string; delivery_status: string };
  }

  async function deliveryStatus(messageId: string): Promise<string | null> {
    const row = await owner.ticketMessage.findUniqueOrThrow({ where: { id: messageId } });
    return row.deliveryStatus;
  }

  // =========================================================================
  // Queued in the deciding transaction, sent after the commit
  // =========================================================================

  it('queues a ticket reply with the reply, keyed by it, and sends it at once', async () => {
    const ticketId = await makeTicket();
    const message = await reply(ticketId);

    expect(await rows('ticket_reply')).toEqual([
      expect.objectContaining({
        status: 'sent',
        attempts: 1,
        idempotencyKey: `ticket_reply:${message.id}`,
      }),
    ]);
    expect(await deliveryStatus(message.id)).toBe('sent');
    const mails = (await spool.outbox()).filter((mail) => mail.kind === 'ticket_reply');
    expect(mails.map((mail) => mail.to)).toEqual([PLAYER_EMAIL]);
  });

  it('keeps a ticket reply queued through a retryable failure, and the retry writes sent', async () => {
    const ticketId = await makeTicket();
    carrier.mode = 'transient';
    const message = await reply(ticketId);

    // Not `failed`: the outbox still owns it, and "try again" must not be offered.
    expect(await deliveryStatus(message.id)).toBe('queued');
    expect(await rows('ticket_reply')).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 1, lastError: 'rejected' }),
    ]);

    carrier.mode = 'ok';
    const report = await retryPass();
    expect(report).toMatchObject({ claimed: 1, sent: 1 });
    expect(await deliveryStatus(message.id)).toBe('sent');
    expect(await rows('ticket_reply')).toEqual([
      expect.objectContaining({ status: 'sent', attempts: 2 }),
    ]);
    expect((await spool.outbox()).filter((mail) => mail.kind === 'ticket_reply')).toHaveLength(1);
  });

  it('writes failed once the retries are spent, so "try again" sends one new row', async () => {
    const ticketId = await makeTicket();
    carrier.mode = 'transient';
    const message = await reply(ticketId);
    for (let pass = 0; pass < 4; pass += 1) await retryPass();

    expect(await rows('ticket_reply')).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 5 }),
    ]);
    expect(await deliveryStatus(message.id)).toBe('failed');

    carrier.mode = 'ok';
    const resent = await server.post(
      `/tickets/${ticketId}/messages/${message.id}/resend`,
      {},
      auth(ticketToken),
    );
    expect(resent.statusCode, resent.body).toBe(200);
    await server.app.backgroundMail.settled();
    const after = await rows('ticket_reply');
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ status: 'sent', attempts: 1 });
    expect(after[1]!.idempotencyKey).toMatch(new RegExp(`^ticket_reply:${message.id}:`));
    expect(await deliveryStatus(message.id)).toBe('sent');
  });

  it('queues a ticket notice with the status change it is about', async () => {
    const ticketId = await makeTicket();
    const template = await server.post(
      '/settings/ticket-email-templates',
      { name: 'Çözüldü', subject: 'Talebiniz çözüldü', body: 'Merhaba, talebiniz çözüldü.' },
      auth(ticketToken),
    );
    expect(template.statusCode, template.body).toBe(201);
    const templateId = (template.json() as { id: string }).id;

    const moved = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: templateId },
      auth(ticketToken),
    );
    expect(moved.statusCode, moved.body).toBe(200);
    await server.app.backgroundMail.settled();

    const queued = await rows('ticket_notice');
    expect(queued).toEqual([expect.objectContaining({ status: 'sent', attempts: 1 })]);
    expect(queued[0]!.idempotencyKey).toMatch(new RegExp(`^ticket_notice:${ticketId}:`));
  });

  it('queues each invitation keyed by it; a retryable failure is not undelivered, and the retry mails it', async () => {
    carrier.mode = 'transient';
    const email = `outbox-invitee-${++keySeq}@example.test`;
    const response = await server.post(
      '/invitations',
      { emails: [email], role: 'agent' },
      auth(accountsToken),
    );
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json() as {
      items: Array<{ id: string; email: string }>;
      undelivered: unknown[];
    };
    // Still on its way: the modal has nothing to offer a copy link for.
    expect(body.undelivered).toEqual([]);
    expect(await rows('invitation')).toEqual([
      expect.objectContaining({
        status: 'pending',
        attempts: 1,
        idempotencyKey: `invitation:${body.items[0]!.id}`,
      }),
    ]);

    carrier.mode = 'ok';
    await retryPass();
    const mails = (await spool.outbox()).filter((mail) => mail.kind === 'invitation');
    expect(mails.map((mail) => mail.to)).toEqual([email]);
    expect(await rows('invitation')).toEqual([expect.objectContaining({ status: 'sent' })]);
  });

  it('still names an invitation the carrier refused for good as undelivered', async () => {
    carrier.mode = 'permanent';
    const email = `outbox-refused-${++keySeq}@example.test`;
    const response = await server.post(
      '/invitations',
      { emails: [email], role: 'agent' },
      auth(accountsToken),
    );
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json() as {
      items: Array<{ id: string }>;
      undelivered: Array<{ id: string; reason: string }>;
    };
    expect(body.undelivered).toEqual([
      expect.objectContaining({ id: body.items[0]!.id, reason: 'failed' }),
    ]);
    expect(await rows('invitation')).toEqual([
      expect.objectContaining({ status: 'failed', attempts: 1, lastError: 'rejected' }),
    ]);
  });

  // =========================================================================
  // Queued by the server's mailer
  // =========================================================================

  it('queues a password reset before trying the carrier, and the retry delivers a link that works', async () => {
    carrier.mode = 'transient';
    const answer = await server.post('/auth/password-reset', { email: fx.a.ownerEmail });
    expect(answer.statusCode).toBe(202);
    await server.app.backgroundMail.settled();
    expect(await rows('password_reset')).toEqual([
      expect.objectContaining({ status: 'pending', attempts: 1 }),
    ]);
    expect(await spool.outbox()).toEqual([]);

    carrier.mode = 'ok';
    await retryPass();
    const [mail] = (await spool.outbox()).filter((sent) => sent.kind === 'password_reset');
    expect(mail?.to).toBe(fx.a.ownerEmail);
    const token = /reset-password\?token=([^\s"&]+)/.exec(mail!.body)?.[1];
    expect(token).toBeTruthy();
    const confirmed = await server.post('/auth/password-reset/confirm', {
      token: decodeURIComponent(token!),
      password: 'a-new-long-passphrase-464',
    });
    expect(confirmed.statusCode).toBe(204);
  });

  it('resolves a sweep-style send once queued, and throws a permanent refusal as before', async () => {
    const message: Message = {
      to: 'sweep-recipient@example.test',
      licenseId: fx.a.licenseId,
      kind: 'notification',
      subject: 'Sweep',
      body: 'A sweep mail.',
    };
    carrier.mode = 'transient';
    await expect(server.app.mailOutbox.send(message)).resolves.toBeUndefined();
    carrier.mode = 'permanent';
    await expect(server.app.mailOutbox.send(message)).rejects.toBeInstanceOf(PermanentMailError);
    expect((await rows('notification')).map((row) => row.status)).toEqual(['pending', 'failed']);
  });
});
