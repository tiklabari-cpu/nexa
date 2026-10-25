/**
 * A ticket reply by e-mail (SiyahTuş analysis HD-01 · tm 356.3) — and the
 * switch that keeps it off (K23). The write itself is `ticket-messages.test.ts`;
 * what is pinned here is the mail path on top of it, read back from a spool:
 *
 *   - a reply goes out after its commit as `ticket_reply`, `[#<id>]` in the
 *     subject, under the workspace's name, with the `Message-ID` the reply
 *     stored — and the thread says `sent`;
 *   - the next reply threads on what came before (`In-Reply-To`, `References`),
 *     the player's own mail included;
 *   - an internal note never reaches the mail path at all;
 *   - a retried request is one mail;
 *   - a carrier that refuses leaves the reply `failed`; "try again" sends the
 *     same message once, however often it is pressed;
 *   - with the switch off a reply is stored `suppressed` and nothing is mailed.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { licenseChannel } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { FileMailer, type Mailer, type Message } from '../../src/services/mail/mailer.js';
import { PermanentMailError } from '../../src/services/mail/mail-error.js';
import { TicketMessageService } from '../../src/services/tickets/ticket-message-service.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ADMIN = ['tickets--all:rw', 'tickets--all:ro'];
const PLAYER_EMAIL = 'ayse.oyuncu@example.test';
const CARD = '4111 1111 1111 1111';

interface ThreadMessage {
  id: string;
  ticket_id: string;
  kind: string;
  body_text: string;
  delivery_status: string | null;
}

/** A carrier that hands every message to a spool, or refuses it — and counts each attempt. */
class SwitchableCarrier implements Mailer {
  refuse = false;
  /** Hands the message over and never hears it was accepted (§D178). */
  unconfirmed = false;
  readonly attempts: Message[] = [];

  constructor(private readonly spool: FileMailer) {}

  async send(message: Message): Promise<void> {
    this.attempts.push(message);
    if (this.refuse) {
      throw new PermanentMailError({ code: 'rejected', phase: 'rcpt_to', smtpCode: 550 });
    }
    await this.spool.send(message);
    if (this.unconfirmed) {
      throw new PermanentMailError({ code: 'unconfirmed', phase: 'message' });
    }
  }
}

describe('ticket replies by e-mail (HD-01 · K23)', () => {
  let owner: PrismaClient;
  /** `TICKET_MAIL_OUTBOUND=true`. */
  let on: TestServer;
  /** The default: ticket e-mail off. */
  let off: TestServer;
  let mailDir: string;
  let spool: FileMailer;
  let carrier: SwitchableCarrier;
  let offCarrier: SwitchableCarrier;
  let fx: Fixtures;
  let adminToken: string;
  let otherTenantToken: string;
  let playerId: string;
  let workspaceName: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  let keySeq = 0;
  const freshKey = () => `mail-${Date.now()}-${++keySeq}`;

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'siyahtus-ticket-reply-mail-'));
    spool = new FileMailer(mailDir);
    carrier = new SwitchableCarrier(spool);
    offCarrier = new SwitchableCarrier(spool);
    on = await startTestServer({ TICKET_MAIL_OUTBOUND: 'true' }, { mailer: carrier });
    off = await startTestServer({}, { mailer: offCarrier });
  });

  afterAll(async () => {
    await on.close();
    await off.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(on.app);
    await clearRateLimits(off.app);
    await rm(mailDir, { recursive: true, force: true });
    carrier.refuse = false;
    carrier.unconfirmed = false;
    carrier.attempts.length = 0;
    offCarrier.attempts.length = 0;

    const player = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Ayşe Oyuncu', email: PLAYER_EMAIL },
      select: { id: true },
    });
    playerId = player.id;
    workspaceName = (
      await owner.organization.findUniqueOrThrow({
        where: { id: fx.a.organizationId },
        select: { name: true },
      })
    ).name;

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN,
    });
    otherTenantToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ADMIN,
    });
  });

  async function makeTicket(server: TestServer = on): Promise<string> {
    const response = await server.post(
      '/tickets',
      { subject: 'Çekim talebim bekliyor', customer_id: playerId },
      auth(adminToken),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  /** Writes, then waits for the mail that write set off — and its status write — to settle. */
  async function write(
    ticketId: string,
    body: Record<string, unknown>,
    server: TestServer = on,
  ): Promise<{ statusCode: number; message: ThreadMessage; body: string }> {
    const response = await server.post(`/tickets/${ticketId}/messages`, body, auth(adminToken));
    await server.app.backgroundMail.settled();
    return {
      statusCode: response.statusCode,
      message: response.json() as ThreadMessage,
      body: response.body,
    };
  }

  async function reply(ticketId: string, text: string, server: TestServer = on) {
    const written = await write(
      ticketId,
      { kind: 'reply', text, idempotency_key: freshKey() },
      server,
    );
    expect(written.statusCode, written.body).toBe(201);
    return written.message;
  }

  async function resend(
    ticketId: string,
    messageId: string,
    server: TestServer = on,
    token = adminToken,
  ) {
    const response = await server.post(
      `/tickets/${ticketId}/messages/${messageId}/resend`,
      {},
      auth(token),
    );
    await server.app.backgroundMail.settled();
    return response;
  }

  async function statusOf(messageId: string): Promise<string | null> {
    const row = await owner.ticketMessage.findUniqueOrThrow({ where: { id: messageId } });
    return row.deliveryStatus;
  }

  async function replies(): Promise<Array<Message & { sent_at: string }>> {
    return (await spool.outbox()).filter((mail) => mail.kind === 'ticket_reply');
  }

  // =========================================================================
  // The switch on
  // =========================================================================

  it('mails a reply to the player as ticket_reply, [#id] in the subject, and the thread says sent (HD-01)', async () => {
    const ticketId = await makeTicket();
    const written = await write(ticketId, {
      kind: 'reply',
      text: `Kartınız ${CARD} ile ödeme alındı.`,
      idempotency_key: freshKey(),
    });
    expect(written.statusCode, written.body).toBe(201);
    // The answer does not wait for the mail server.
    expect(written.message.delivery_status).toBe('queued');

    const mails = await replies();
    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    expect(mail.to).toBe(PLAYER_EMAIL);
    expect(mail.licenseId).toBe(fx.a.licenseId);
    expect(mail.subject).toBe(`[#${ticketId}] Çekim talebim bekliyor`);
    expect(mail.fromName).toBe(workspaceName);
    // The stored, masked text — never the card in clear, in either part.
    expect(mail.body).toBe(written.message.body_text);
    expect(mail.body).not.toContain(CARD);
    expect(mail.html).not.toContain(CARD);

    const row = await owner.ticketMessage.findUniqueOrThrow({ where: { id: written.message.id } });
    expect(row.deliveryStatus).toBe('sent');
    expect(row.emailMessageId).toMatch(/^[0-9a-f-]{36}@siyahtus\.invalid$/);
    expect(mail.messageId).toBe(row.emailMessageId);
    // The first reply answers nothing that went by mail.
    expect(row.inReplyTo).toBeNull();
    expect(mail.inReplyTo).toBeUndefined();

    const thread = await on.get(`/tickets/${ticketId}/messages`, auth(adminToken));
    const items = (thread.json() as { items: ThreadMessage[] }).items;
    expect(items.map((item) => item.delivery_status)).toEqual(['sent']);
  });

  it('threads the next reply on the earlier mail, the player’s own included', async () => {
    const ticketId = await makeTicket();
    const first = await reply(ticketId, 'İlk yanıt.');
    const firstId = (await owner.ticketMessage.findUniqueOrThrow({ where: { id: first.id } }))
      .emailMessageId!;

    // The player answers by e-mail (the inbound path's entry point, HD-03);
    // their server kept the id with its brackets.
    const tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    await withTenant(on.app.db, tenant, (tx) =>
      new TicketMessageService().recordCustomerMessage(
        tx,
        tenant,
        {
          licenseId: fx.a.licenseId,
          chainSecret: testEnv().AUDIT_CHAIN_SECRET,
          actorId: null,
          actorType: 'system',
        },
        { ticketId, text: 'Teşekkürler, bekliyorum.', emailMessageId: '<p1@mail.example.test>' },
      ),
    );

    const second = await reply(ticketId, 'İkinci yanıt.');
    const row = await owner.ticketMessage.findUniqueOrThrow({ where: { id: second.id } });
    expect(row.inReplyTo).toBe('p1@mail.example.test');

    const mail = (await replies()).find((m) => m.messageId === row.emailMessageId)!;
    expect(mail.inReplyTo).toBe('p1@mail.example.test');
    expect(mail.references).toEqual([firstId, 'p1@mail.example.test']);
  });

  it('never sends an internal note down the mail path (HD-01)', async () => {
    const ticketId = await makeTicket();
    const send = vi.spyOn(on.app.backgroundMail, 'send');
    try {
      const written = await write(ticketId, {
        kind: 'note',
        text: 'Gizli iç not: oyuncunun hesabı inceleniyor.',
        idempotency_key: freshKey(),
      });
      expect(written.statusCode, written.body).toBe(201);
      expect(written.message.delivery_status).toBeNull();
      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
    expect(carrier.attempts).toHaveLength(0);
    expect(await spool.outbox()).toHaveLength(0);
    const row = await owner.ticketMessage.findFirstOrThrow({ where: { ticketId } });
    expect(row).toMatchObject({ deliveryStatus: null, emailMessageId: null, inReplyTo: null });
  });

  it('mails a retried request once', async () => {
    const ticketId = await makeTicket();
    const body = { kind: 'reply', text: 'Tek yanıt.', idempotency_key: freshKey() };
    const first = await write(ticketId, body);
    const again = await write(ticketId, body);
    expect([first.statusCode, again.statusCode]).toEqual([201, 200]);
    expect(again.message.id).toBe(first.message.id);
    expect(await replies()).toHaveLength(1);
  });

  it('marks a refused send failed, and "try again" sends the same message once', async () => {
    const ticketId = await makeTicket();
    carrier.refuse = true;
    const failed = await reply(ticketId, 'Gönderilemeyecek yanıt.');
    expect(await statusOf(failed.id)).toBe('failed');
    expect(await replies()).toHaveLength(0);
    const { emailMessageId } = await owner.ticketMessage.findUniqueOrThrow({
      where: { id: failed.id },
    });

    carrier.refuse = false;
    carrier.attempts.length = 0;
    // Two presses at once: the reply's `failed` moves once, under the lock.
    const presses = await Promise.all([
      on.post(`/tickets/${ticketId}/messages/${failed.id}/resend`, {}, auth(adminToken)),
      on.post(`/tickets/${ticketId}/messages/${failed.id}/resend`, {}, auth(adminToken)),
    ]);
    await on.app.backgroundMail.settled();
    // The second press reads the first one's `queued` — or, if the first send
    // already settled, `sent`. Neither sends again.
    for (const press of presses) {
      expect(press.statusCode, press.body).toBe(200);
      expect(['queued', 'sent']).toContain((press.json() as ThreadMessage).delivery_status);
    }

    expect(carrier.attempts).toHaveLength(1);
    const mails = await replies();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.messageId).toBe(emailMessageId);
    expect(await statusOf(failed.id)).toBe('sent');

    // Once sent, "try again" answers as it is and mails nothing.
    const later = await resend(ticketId, failed.id);
    expect(later.statusCode, later.body).toBe(200);
    expect((later.json() as ThreadMessage).delivery_status).toBe('sent');
    expect(carrier.attempts).toHaveLength(1);
    // One message, not two.
    expect(await owner.ticketMessage.count({ where: { ticketId } })).toBe(1);
  });

  it('counts a send the carrier never confirmed as sent, so "try again" cannot mail it twice', async () => {
    const ticketId = await makeTicket();
    carrier.unconfirmed = true;
    const message = await reply(ticketId, 'Belki ulaştı.');
    expect(await statusOf(message.id)).toBe('sent');
    await resend(ticketId, message.id);
    expect(carrier.attempts).toHaveLength(1);
  });

  it('lets only a queued reply be settled — a late outcome does not overwrite a newer status', async () => {
    const ticketId = await makeTicket();
    const message = await reply(ticketId, 'Gönderildi.');
    expect(await statusOf(message.id)).toBe('sent');

    const tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    const push = await withTenant(on.app.db, tenant, (tx) =>
      new TicketMessageService().recordDelivery(tx, message.id, 'failed'),
    );
    expect(push).toBeNull();
    expect(await statusOf(message.id)).toBe('sent');
  });

  it('announces each delivery status to the people working the ticket, with ids only', async () => {
    const listener: Redis = on.app.redis.duplicate();
    const pushes: Array<{ action: string; payload: Record<string, unknown> }> = [];
    listener.on('message', (_channel: string, raw: string) => {
      const envelope = JSON.parse(raw) as { action: string; payload: Record<string, unknown> };
      if (envelope.action === 'ticket_message_delivery_changed') pushes.push(envelope);
    });
    await listener.subscribe(licenseChannel(fx.a.licenseId));
    try {
      const response = await on.post(
        '/tickets',
        {
          subject: 'Bildirim',
          customer_id: playerId,
          assignee_id: fx.a.ownerAccountId,
        },
        auth(adminToken),
      );
      const ticketId = (response.json() as { id: string }).id;
      carrier.refuse = true;
      const failed = await reply(ticketId, 'Durum bildirimi.');
      carrier.refuse = false;
      await resend(ticketId, failed.id);

      await vi.waitFor(() => expect(pushes).toHaveLength(3));
      expect(pushes.map((push) => push.payload)).toEqual([
        { ticket_id: ticketId, message_id: failed.id, delivery_status: 'failed' },
        { ticket_id: ticketId, message_id: failed.id, delivery_status: 'queued' },
        { ticket_id: ticketId, message_id: failed.id, delivery_status: 'sent' },
      ]);
    } finally {
      await listener.quit();
    }
  });

  it('refuses "try again" on a note, on another workspace’s message and when the player lost the address', async () => {
    const ticketId = await makeTicket();
    const note = await write(ticketId, { kind: 'note', text: 'Not.', idempotency_key: freshKey() });
    expect((await resend(ticketId, note.message.id)).statusCode).toBe(400);

    carrier.refuse = true;
    const failed = await reply(ticketId, 'Yanıt.');
    carrier.refuse = false;

    expect((await resend(ticketId, failed.id, on, otherTenantToken)).statusCode).toBe(404);
    expect((await resend(ticketId, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await resend(ticketId, 'not-a-uuid')).statusCode).toBe(400);

    await owner.customer.update({ where: { id: playerId }, data: { email: null } });
    const orphaned = await resend(ticketId, failed.id);
    expect(orphaned.statusCode, orphaned.body).toBe(409);
    expect((orphaned.json() as { error: { type: string } }).error.type).toBe('ticket_no_recipient');
    expect(await statusOf(failed.id)).toBe('failed');
    expect(carrier.attempts.filter((m) => m.kind === 'ticket_reply')).toHaveLength(1);
  });

  // =========================================================================
  // The switch off (K23)
  // =========================================================================

  it('stores a reply suppressed and mails nothing while ticket e-mail is off (K23)', async () => {
    const ticketId = await makeTicket(off);
    const send = vi.spyOn(off.app.backgroundMail, 'send');
    try {
      const message = await reply(ticketId, 'Pilotta gitmeyen yanıt.', off);
      expect(message.delivery_status).toBe('suppressed');
      expect(send).not.toHaveBeenCalled();

      // The reply still counts: the ticket waits on the player.
      const ticket = await owner.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(ticket.status).toBe('pending');
      expect(ticket.firstResponseAt).not.toBeNull();

      // Nothing to try again: answered as it is.
      const again = await resend(ticketId, message.id, off);
      expect(again.statusCode, again.body).toBe(200);
      expect((again.json() as ThreadMessage).delivery_status).toBe('suppressed');
      expect(send).not.toHaveBeenCalled();

      const row = await owner.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(row).toMatchObject({ deliveryStatus: 'suppressed', emailMessageId: null });
    } finally {
      send.mockRestore();
    }
    expect(offCarrier.attempts).toHaveLength(0);
    expect(await spool.outbox()).toHaveLength(0);
  });

  it('keeps a reply that failed before the switch was turned off from going out after (K23)', async () => {
    const ticketId = await makeTicket();
    carrier.refuse = true;
    const failed = await reply(ticketId, 'Kapanmadan önce gönderilemedi.');
    carrier.refuse = false;
    expect(await statusOf(failed.id)).toBe('failed');

    const response = await resend(ticketId, failed.id, off);
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as ThreadMessage).delivery_status).toBe('suppressed');
    expect(offCarrier.attempts).toHaveLength(0);
    expect(await statusOf(failed.id)).toBe('suppressed');
  });
});
