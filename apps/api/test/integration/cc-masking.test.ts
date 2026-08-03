/**
 * Card masking at write time (FR-MOD-08.9.5 · NFR-C5/S9 · PCI SAQ A).
 *
 * The unit tests pin the detector; this suite pins the *boundary* — that a raw
 * PAN a visitor or agent types never comes to rest anywhere it could be read
 * back: `events.text`, a ticket subject, a rating comment, a contact custom
 * field, the transcript e-mail spool, or an audit row. It is proven end to end
 * through the real routes and read back straight from Postgres and the mail
 * spool, because "masked in the response" would pass even if the database still
 * held the raw number.
 *
 * The negative — a Luhn-invalid order number is left intact — is here too: a
 * privacy control that also destroyed order numbers would be its own incident.
 */
import { PrismaClient } from '@prisma/client';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileMailer } from '../../src/services/mail/mailer.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures, type TenantFixture } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PAN = '4111111111111111';
const PAN_SPACED = '4111 1111 1111 1111';
const MASKED = '**** **** **** 1111';
/** 16 digits, but not a card — must survive untouched (the false-positive line). */
const ORDER_NO = '1234567890123456';
const DOMAIN = 'inbound.nexa.localhost';

describe('card masking at write time (FR-MOD-08.9.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let mailDir: string;
  let adminToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  // Routing so a first widget message is assigned to the tenant's agent — the
  // same fallback rule the customer-chat suite uses, extracted so both A and B
  // can send.
  async function setupRouting(t: TenantFixture): Promise<void> {
    const group = await owner.group.create({
      data: { licenseId: t.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: { licenseId: t.licenseId, groupId: group.id, agentId: t.agentAccountId, priority: 'normal' },
    });
    await owner.routingRule.create({
      data: { licenseId: t.licenseId, kind: 'chat', isFallback: true, targetGroupId: group.id },
    });
  }

  async function widgetToken(t: TenantFixture): Promise<{ token: string; customerId: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; customer_id: string };
    return { token: body.token, customerId: body.customer_id };
  }

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-ccmask-'));
    // A real FileMailer so the transcript side-channel can be read back from the
    // spool; the default test mailer is a NullMailer that keeps nothing.
    server = await startTestServer({}, { mailer: new FileMailer(mailDir) });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await setupRouting(fx.a);
    await setupRouting(fx.b);
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'customers:rw'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'chats--all:ro'],
    });
  });

  /** The raw PAN must appear in no event's text, for the whole licence. */
  async function rawPanEventCount(licenseId: bigint): Promise<number> {
    return owner.event.count({ where: { licenseId, text: { contains: PAN } } });
  }

  // --- The message write paths ---------------------------------------------

  it('masks a card in a widget message before it reaches the database', async () => {
    const { token } = await widgetToken(fx.a);

    const response = await server.post(
      '/customer/chat/events',
      { text: `please charge ${PAN_SPACED}` },
      auth(token),
    );
    expect(response.statusCode).toBe(201);

    // The value the widget/agent sees over the wire is already masked…
    expect(response.json().event.text).toBe(`please charge ${MASKED}`);

    // …and, the point of the requirement, so is the row in Postgres.
    const chatId = response.json().chat_id as string;
    const event = await owner.event.findFirstOrThrow({
      where: { chatId, type: 'message' },
      select: { text: true },
    });
    expect(event.text).toBe(`please charge ${MASKED}`);
    expect(await rawPanEventCount(fx.a.licenseId)).toBe(0);
  });

  it('masks a card in an agent message', async () => {
    const { token: customer } = await widgetToken(fx.a);
    const opened = await server.post('/customer/chat/events', { text: 'hello' }, auth(customer));
    const chatId = opened.json().chat_id as string;

    const response = await server.post(
      `/chats/${chatId}/events`,
      { text: `card on file: ${PAN}` },
      auth(agentToken),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().text).toBe(`card on file: ${MASKED}`);
    expect(await rawPanEventCount(fx.a.licenseId)).toBe(0);
  });

  it('leaves a Luhn-invalid order number in a message untouched', async () => {
    const { token } = await widgetToken(fx.a);

    const response = await server.post(
      '/customer/chat/events',
      { text: `order ${ORDER_NO} shipped` },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    // Not a card → stored verbatim. The Luhn boundary holds through the route.
    expect(response.json().event.text).toBe(`order ${ORDER_NO} shipped`);
  });

  it('applies in any tenant, not just the first (cross-tenant)', async () => {
    const { token } = await widgetToken(fx.b);
    const response = await server.post(
      '/customer/chat/events',
      { text: `pay with ${PAN}` },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    expect(response.json().event.text).toBe(`pay with ${MASKED}`);
    expect(await rawPanEventCount(fx.b.licenseId)).toBe(0);
  });

  // --- The adjacent free-text write paths ----------------------------------

  it('masks a card in a pre-chat custom field', async () => {
    const field = await server.post(
      '/settings/custom-fields',
      { entity: 'contact', label: 'Card', type: 'text' },
      auth(adminToken),
    );
    expect(field.statusCode).toBe(201);
    const fieldId = field.json().id as string;

    const { token, customerId } = await widgetToken(fx.a);
    const send = await server.post(
      '/customer/chat/events',
      { text: 'hi', custom_fields: { [fieldId]: PAN } },
      auth(token),
    );
    expect(send.statusCode).toBe(201);

    const detail = await server.get(`/customers/${customerId}`, auth(adminToken));
    const stored = (detail.json().custom_fields as Array<{ definition_id: string; value: string }>).find(
      (f) => f.definition_id === fieldId,
    );
    expect(stored?.value).toBe(MASKED);
    // And nothing raw in the values table.
    expect(await owner.customFieldValue.count({ where: { value: { contains: PAN } } })).toBe(0);
  });

  it('masks a card in a rating comment', async () => {
    const { token } = await widgetToken(fx.a);
    await server.post('/customer/chat/events', { text: 'thanks' }, auth(token));

    const rated = await server.post(
      '/customer/chat/rating',
      { value: 'good', comment: `you can keep ${PAN}` },
      auth(token),
    );
    expect(rated.statusCode).toBe(201);

    const rating = await owner.rating.findFirstOrThrow({ select: { comment: true } });
    expect(rating.comment).toBe(`you can keep ${MASKED}`);
    expect(await owner.rating.count({ where: { comment: { contains: PAN } } })).toBe(0);
  });

  it('masks a card in an inbound email subject', async () => {
    const response = await server.post('/channels/email/inbound', {
      to: `${fx.a.organizationId}@${DOMAIN}`,
      from: 'buyer@shopper.example',
      subject: `refund my card ${PAN}`,
      text: 'see subject',
    });
    expect(response.statusCode).toBe(200);
    const ticketId = response.json().ticket_id as string;

    const ticket = await owner.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { subject: true } });
    expect(ticket.subject).toBe(`refund my card ${MASKED}`);
    expect(await owner.ticket.count({ where: { subject: { contains: PAN } } })).toBe(0);
  });

  // --- The side channels ----------------------------------------------------

  it('never writes a raw card to the transcript e-mail (agent-archive path)', async () => {
    // An e-mail on the customer means the visitor copy of the transcript sends,
    // rendered from the stored (already masked) events.
    const { token } = await widgetToken(fx.a);
    const opened = await server.post(
      '/customer/chat/events',
      { text: `my card is ${PAN}`, email: 'buyer@example.test' },
      auth(token),
    );
    const chatId = opened.json().chat_id as string;

    // The agent archive path is the one wired with the mailer.
    const archived = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(agentToken));
    expect(archived.statusCode).toBe(200);

    const names = await readdir(mailDir);
    const spool = (
      await Promise.all(names.map((n) => readFile(join(mailDir, n), 'utf8')))
    ).join('\n');
    // The transcript carries the conversation — masked — and no copy anywhere in
    // the spool carries the raw number.
    expect(spool).not.toContain(PAN);
    expect(spool).toContain(MASKED);
  });

  it('leaves no raw card in the audit log after a card passes through', async () => {
    const { token } = await widgetToken(fx.a);
    await server.post('/customer/chat/events', { text: `charge ${PAN}` }, auth(token));

    const rows = await owner.auditLogEntry.findMany({ select: { metadata: true } });
    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(PAN);
  });

  // --- The read paths (MCP summarize_chat, FR-MOD-08.8.3-f) ------------------

  it('masks a card in the summarize_chat tool response (read-path defence)', async () => {
    // Seed a chat whose transcript holds a RAW PAN straight in the database,
    // bypassing the write-time mask — the case the read-path mask exists for. A
    // tool that dumps transcript text to an LLM client must re-mask, so a PAN
    // that reached the DB by any path never leaves through the tool response.
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'CC read-path visitor' },
      select: { id: true },
    });
    const chatId = 'cc-sum-chat';
    const threadId = 'cc-sum-thr';
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
    });
    await owner.thread.create({ data: { id: threadId, chatId, licenseId: fx.a.licenseId, active: true } });
    await owner.event.create({
      data: {
        id: `${threadId}_10`,
        threadId,
        chatId,
        licenseId: fx.a.licenseId,
        type: 'message',
        text: `my card is ${PAN}`,
        authorType: 'customer',
        recipients: 'all',
      },
    });

    // agentToken carries chats--all:ro, the scope summarize_chat requires.
    const res = await server.post('/mcp/tools/summarize_chat', { arguments: { chat_id: chatId } }, auth(agentToken));
    expect(res.statusCode).toBe(200);

    const summary = (res.json() as { result: { summary: string } }).result.summary;
    expect(summary).toContain(MASKED);
    expect(summary).not.toContain(PAN);
    // Nowhere in the whole response envelope, not just the parsed field.
    expect(res.payload).not.toContain(PAN);
  });
});
