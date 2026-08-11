/**
 * Inbound email → ticket (FR-MOD-08.5.3).
 *
 * Three properties carry this suite, each silent when broken:
 *
 *  - Routing: a message to `<org>@inbound…` becomes a ticket on *that* org's
 *    licence and no other. Proved across the A/B fixtures, not trusted to a
 *    WHERE clause.
 *  - No duplicate customer: a sender already known by email is reused. A second
 *    record would split one person's history — and the match must not reach
 *    across tenants, so the same address in another org is a different person.
 *  - Spam: with the workspace filter on (the default), a flagged message makes
 *    no ticket; with it off, the same message does. The negative is written
 *    first, because "always creates a ticket" would pass every positive test.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedDefaultBrand, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DOMAIN = 'inbound.nexa.localhost';

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
