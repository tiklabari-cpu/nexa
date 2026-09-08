/**
 * Sending a ticket e-mail from a stored template (FR-MOD-08.7.5 — the
 * consuming half).
 *
 * The authoring half has been proven since tm 50 (`ticket-email-templates.test.ts`):
 * a template with a bad placeholder cannot be stored. What was never proven —
 * because it did not exist — is that a stored template is ever *used*. Until
 * tm 227 `renderTemplate` was called by nothing but its own unit test, so an
 * admin could author branded, variabled mail and no customer would ever receive
 * a word of it.
 *
 * Proven against a real `FileMailer` in a temp directory, reading the spool
 * back, for the reason `chat-transcript.test.ts` does the same: the claim is
 * about *what left the building*, and a mock's call log would only prove that a
 * function was invoked. The delivery provider stays mocked (CLAUDE.md's
 * boundary — no real SMTP); the evidence this file offers is not "mail was
 * delivered" but "the body that went out came from the template and its
 * variables were resolved".
 *
 * The negatives carry the weight, and each is a distinct way the feature could
 * look alive while being dead or dangerous:
 *
 *   1. A stored template that stopped being renderable is refused, and refused
 *      *before* the transition — raw `{{…}}` never reaches an inbox, and the
 *      ticket does not quietly move while the agent is told nothing was sent.
 *   2. A patch with no template behaves exactly as it did before this feature.
 *   3. Another tenant's template id is not found — never rendered, never sent.
 *   4. The trail and the log carry the template id and the variable *names*;
 *      the resolved body appears in neither.
 */
import type { PrismaClient } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FileMailer } from '../../src/services/mail/mailer.js';

const ADMIN = ['tickets--all:rw', 'tickets--all:ro', 'customers:ro'];
/** What `DEFAULT_AGENT_SCOPES` actually hands the role that works the inbox. */
const SCOPED_AGENT = ['tickets--access:rw'];

const SUBJECT = '[{{company.name}}] Ticket {{ticket.id}} is now {{ticket.status}}';
const BODY =
  'Hi {{customer.name}},\n\n{{agent.name}} has updated "{{ticket.subject}}".\n' +
  'Priority: {{ticket.priority}}. Reply to this mail at {{customer.email}}.\n';

interface SentMessage {
  to: string;
  subject: string;
  body: string;
  kind: string;
}

describe('ticket e-mail templates — the consuming half (FR-MOD-08.7.5)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;
  let adminToken: string;
  let agentToken: string;
  let customerId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-ticket-mail-'));
    mailer = new FileMailer(mailDir);
    server = await startTestServer({}, { mailer });
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

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN,
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: SCOPED_AGENT,
    });

    // The seeded customer carries no address; a ticket notice needs one.
    const customer = await owner.customer.create({
      data: {
        organizationId: fx.a.organizationId,
        name: 'Ada Lovelace',
        email: 'ada@example.test',
      },
      select: { id: true },
    });
    customerId = customer.id;
  });

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  /** Author a template the way an admin does — through the endpoint that validates it. */
  async function createTemplate(
    body: Partial<{ name: string; subject: string; body: string; enabled: boolean }> = {},
  ): Promise<string> {
    const response = await server.post(
      '/settings/ticket-email-templates',
      { name: 'Status update', subject: SUBJECT, body: BODY, ...body },
      auth(adminToken),
    );
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
  }

  async function createTicket(token = adminToken): Promise<string> {
    const response = await server.post(
      '/tickets',
      { subject: 'Withdrawal is stuck', customer_id: customerId },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
  }

  const outbox = async (): Promise<SentMessage[]> =>
    (await mailer.outbox()) as unknown as SentMessage[];

  const auditEntries = (action: string) =>
    owner.auditLogEntry.findMany({ where: { licenseId: fx.a.licenseId, action } });

  // =========================================================================
  // 1 — the body that went out came from the template
  // =========================================================================

  it('mails the customer a body rendered from the template, variables resolved', async () => {
    const templateId = await createTemplate();
    const ticketId = await createTicket();

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: templateId },
      auth(adminToken),
    );
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { status: string }).status).toBe('solved');

    const sent = await outbox();
    expect(sent).toHaveLength(1);
    const message = sent[0]!;

    expect(message.kind).toBe('ticket_notice');
    expect(message.to).toBe('ada@example.test');
    // Every variable resolved — the workspace's name, the ticket's own id, and
    // the status the ticket has just moved *to*, not the one it left.
    expect(message.subject).toBe(`[Org A] Ticket ${ticketId} is now solved`);
    expect(message.body).toContain('Hi Ada Lovelace,');
    expect(message.body).toContain('Owner a has updated "Withdrawal is stuck".');
    expect(message.body).toContain('Priority: Normal.');
    expect(message.body).toContain('ada@example.test');
    // The property that makes this a rendered template rather than a template:
    // nothing placeholder-shaped survives into the customer's inbox.
    expect(message.subject + message.body).not.toContain('{{');
    expect(message.subject + message.body).not.toContain('}}');
  });

  it('lets the role that actually works the inbox send one', async () => {
    // `DEFAULT_AGENT_SCOPES` carries `tickets--access:rw` and nothing
    // tenant-wide. Before tm 227 the template list was gated on
    // `tickets--all:ro`, so the picker this feature adds would have been empty
    // for exactly the person expected to use it.
    const templateId = await createTemplate();
    // Assigned to them, because a group-scoped agent only sees the tickets that
    // are theirs — the visibility rule this feature rides rather than bypasses.
    const created = await server.post(
      '/tickets',
      {
        subject: 'Withdrawal is stuck',
        customer_id: customerId,
        assignee_id: fx.a.agentAccountId,
      },
      auth(adminToken),
    );
    expect(created.statusCode).toBe(201);
    const ticketId = (created.json() as { id: string }).id;

    const list = await server.get('/settings/ticket-email-templates', auth(agentToken));
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'pending', email_template_id: templateId },
      auth(agentToken),
    );
    expect(patched.statusCode).toBe(200);
    expect(await outbox()).toHaveLength(1);

    // Reading the library is not curating it: authoring stays admin-only.
    const authored = await server.post(
      '/settings/ticket-email-templates',
      { name: 'Nope', subject: 'x', body: 'y' },
      auth(agentToken),
    );
    expect(authored.statusCode).toBe(403);
  });

  // =========================================================================
  // 2 — fail-closed: a template that cannot be rendered sends nothing
  // =========================================================================

  it('refuses a stored template naming a variable the product cannot fill', async () => {
    // Written straight to the table, because the endpoint will not store one —
    // which is exactly how this row appears in the wild: a template authored
    // against a catalogue that has since lost a variable.
    const stale = await owner.ticketEmailTemplate.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Stale',
        subject: 'Ticket {{ticket.titel}}',
        body: 'Hello {{customer.name}}.',
        enabled: true,
      },
      select: { id: true },
    });
    const ticketId = await createTicket();

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: stale.id },
      auth(adminToken),
    );
    expect(patched.statusCode).toBe(400);

    // Nothing sent — and, critically, nothing sent with raw braces in it.
    expect(await outbox()).toHaveLength(0);
    // And the transition did not happen either: the agent asked to solve *and*
    // notify, and a half-done request that reports failure is how a customer
    // ends up never hearing about a ticket everyone believes is closed.
    const after = await server.get(`/tickets/${ticketId}`, auth(adminToken));
    expect((after.json() as { status: string }).status).toBe('open');
  });

  it('refuses a template the workspace has switched off', async () => {
    const templateId = await createTemplate({ enabled: false });
    const ticketId = await createTicket();

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: templateId },
      auth(adminToken),
    );
    expect(patched.statusCode).toBe(400);
    expect(await outbox()).toHaveLength(0);
  });

  it('refuses when the ticket has nobody to write to', async () => {
    const templateId = await createTemplate();
    const anonymous = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Walk-in' },
      select: { id: true },
    });
    const created = await server.post(
      '/tickets',
      { subject: 'No address', customer_id: anonymous.id },
      auth(adminToken),
    );
    expect(created.statusCode).toBe(201);
    const ticketId = (created.json() as { id: string }).id;

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: templateId },
      auth(adminToken),
    );
    // A refusal rather than a silent skip: an agent who asked for a notice and
    // silently got none is back where this requirement started.
    expect(patched.statusCode).toBe(400);
    expect(await outbox()).toHaveLength(0);
  });

  it('refuses a template with no status change to be about', async () => {
    const templateId = await createTemplate();
    const ticketId = await createTicket();

    // No status at all — the notice would assert a transition that is not
    // happening, and `{{ticket.status}}` would print the old one as news.
    const bare = await server.patch(
      `/tickets/${ticketId}`,
      { subject: 'Renamed', email_template_id: templateId },
      auth(adminToken),
    );
    expect(bare.statusCode).toBe(400);

    // A status equal to the one it already has is the same problem wearing a
    // status field, and it is what would let this endpoint be used as a mailer.
    const noop = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'open', email_template_id: templateId },
      auth(adminToken),
    );
    expect(noop.statusCode).toBe(400);

    expect(await outbox()).toHaveLength(0);
  });

  // =========================================================================
  // 3 — regression: without a template, nothing about the endpoint changed
  // =========================================================================

  it('changes a status with no template exactly as it did before', async () => {
    await createTemplate();
    const ticketId = await createTicket();

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved' },
      auth(adminToken),
    );
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { status: string }).status).toBe('solved');

    // An enabled template exists and is *not* used: no default template, no
    // "first one wins", no mail a workspace did not ask for.
    expect(await outbox()).toHaveLength(0);
    expect(await auditEntries('ticket.email_sent')).toHaveLength(0);
    // The lifecycle entry the transition has always written is untouched.
    expect(await auditEntries('ticket.status_changed')).toHaveLength(1);
  });

  // =========================================================================
  // 4 — cross-tenant
  // =========================================================================

  it("never sends with another workspace's template", async () => {
    const foreignAdmin = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ADMIN,
    });
    const foreign = await server.post(
      '/settings/ticket-email-templates',
      { name: 'B only', subject: 'From {{company.name}}', body: 'Hello {{customer.name}}.' },
      auth(foreignAdmin),
    );
    expect(foreign.statusCode).toBe(201);
    const foreignId = (foreign.json() as { id: string }).id;

    const ticketId = await createTicket();
    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: foreignId },
      auth(adminToken),
    );
    // Absent, not forbidden (NFR-S5) — a 403 would confirm the id names a real
    // template somewhere.
    expect(patched.statusCode).toBe(404);
    expect(await outbox()).toHaveLength(0);

    const after = await server.get(`/tickets/${ticketId}`, auth(adminToken));
    expect((after.json() as { status: string }).status).toBe('open');
  });

  // =========================================================================
  // 5 — the trail records that it happened, never what it said
  // =========================================================================

  it('audits the template and the variable names, and no resolved value', async () => {
    const templateId = await createTemplate();
    const ticketId = await createTicket();

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: templateId },
      auth(adminToken),
    );
    expect(patched.statusCode).toBe(200);

    const entries = await auditEntries('ticket.email_sent');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.target).toBe(`ticket:${ticketId}`);

    const metadata = entry.metadata as { template_id?: string; variables?: string[] };
    expect(metadata.template_id).toBe(templateId);
    expect([...(metadata.variables ?? [])].sort()).toEqual([
      'agent.name',
      'company.name',
      'customer.email',
      'customer.name',
      'ticket.id',
      'ticket.priority',
      'ticket.status',
      'ticket.subject',
    ]);

    // The leak this guards: the message is the customer's data, and an
    // append-only log is the one place it could never be erased from. The
    // *names* are the workspace's own template and safe to keep.
    const serialised = JSON.stringify(entry.metadata);
    expect(serialised).not.toContain('Ada Lovelace');
    expect(serialised).not.toContain('ada@example.test');
    expect(serialised).not.toContain('Withdrawal is stuck');
    expect(serialised).not.toContain('{{');
  });
});

/**
 * Its own server because a log stream has to be installed at construction:
 * `server.ts` disables request logging in tests unless one is supplied.
 */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
}

describe('ticket notice — the rendered body stays out of the log (FR-MOD-08.7.5)', () => {
  let owner: PrismaClient;
  let server: TestServer | undefined;
  let mailDir: string;

  beforeAll(async () => {
    owner = ownerClient();
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-ticket-mail-log-'));
  });

  afterAll(async () => {
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('never writes the customer-facing text, at trace level, with request logging on', async () => {
    const sink = new LineSink();
    const mailer = new FileMailer(mailDir);
    server = await startTestServer(
      { LOG_LEVEL: 'trace' },
      { logStream: sink as unknown as NodeJS.WritableStream, mailer },
    );
    const fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN,
    });
    const auth = { authorization: `Bearer ${token}` };

    const customer = await owner.customer.create({
      data: {
        organizationId: fx.a.organizationId,
        name: 'Grace Hopper',
        email: 'grace@example.test',
      },
      select: { id: true },
    });

    const template = await server.post(
      '/settings/ticket-email-templates',
      { name: 'Solved', subject: 'Ticket {{ticket.id}}', body: 'Hi {{customer.name}}, all done.' },
      auth,
    );
    expect(template.statusCode).toBe(201);
    const templateId = (template.json() as { id: string }).id;

    const created = await server.post(
      '/tickets',
      { subject: 'Bug report', customer_id: customer.id },
      auth,
    );
    expect(created.statusCode).toBe(201);
    const ticketId = (created.json() as { id: string }).id;

    const patched = await server.patch(
      `/tickets/${ticketId}`,
      { status: 'solved', email_template_id: templateId },
      auth,
    );
    expect(patched.statusCode).toBe(200);

    const written = sink.lines.join('\n');
    // The request is there — path, method, status, all still debuggable.
    expect(written).toContain('/tickets/');
    // The message is not. Nothing renders the body into a log line, and this is
    // what would notice if something started to.
    expect(written).not.toContain('Grace Hopper');
    expect(written).not.toContain('all done');

    await rm(mailDir, { recursive: true, force: true });
  });
});
