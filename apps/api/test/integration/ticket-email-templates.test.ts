/**
 * Ticket e-mail templates — branded, variabled ticket mail (FR-MOD-08.7.5).
 *
 * The property that carries the requirement is the KK "Geçersiz değişken/format
 * engeli": a template naming a variable the product cannot fill, or carrying a
 * malformed `{{…}}`, is refused rather than stored. Around that sit the usual
 * guards — a valid template round-trips, an edit is re-validated, the read/write
 * scope split holds, and — the failure most easily shipped unseen — one tenant
 * never sees or edits another's templates.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface TicketEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

describe('ticket e-mail templates', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const createTemplate = (token: string, body: unknown) =>
    server.post('/settings/ticket-email-templates', body, auth(token));

  const listTemplates = async (token: string): Promise<TicketEmailTemplate[]> => {
    const response = await server.get('/settings/ticket-email-templates', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: TicketEmailTemplate[] }).items;
  };

  const validTemplate = {
    name: 'Ticket received',
    subject: 'We got your ticket {{ticket.id}}',
    body: 'Hi {{customer.name}}, {{agent.name}} from {{company.name}} is on “{{ticket.subject}}”.',
  };

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
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:rw'],
    });
  });

  // --- Validation: invalid variable / format rejected (KK) -------------------

  it('rejects a body that names an unknown variable', async () => {
    const response = await createTemplate(adminToken, {
      ...validTemplate,
      body: 'Hi {{customer.nickname}}',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown variable in the subject too', async () => {
    const response = await createTemplate(adminToken, {
      ...validTemplate,
      subject: 'Re: {{ticket.reference}}',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a malformed placeholder', async () => {
    const response = await createTemplate(adminToken, {
      ...validTemplate,
      body: 'Ticket {{ticket.id} is open', // unbalanced braces
    });
    expect(response.statusCode).toBe(400);
  });

  // --- The happy path: a valid template round-trips --------------------------

  it('creates and lists a template whose placeholders are all valid', async () => {
    const created = await createTemplate(adminToken, validTemplate);
    expect(created.statusCode).toBe(201);
    const template = created.json() as TicketEmailTemplate;
    expect(template.enabled).toBe(true);

    const listed = await listTemplates(adminToken);
    expect(listed.map((t) => t.id)).toContain(template.id);
  });

  // --- An edit is re-validated -----------------------------------------------

  it('re-validates the body on edit, refusing an invalid variable', async () => {
    const created = await createTemplate(adminToken, validTemplate);
    const { id } = created.json() as TicketEmailTemplate;

    const bad = await server.patch(
      `/settings/ticket-email-templates/${id}`,
      { body: 'Hi {{customer.unknown}}' },
      auth(adminToken),
    );
    expect(bad.statusCode).toBe(400);

    const ok = await server.patch(
      `/settings/ticket-email-templates/${id}`,
      { enabled: false },
      auth(adminToken),
    );
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as TicketEmailTemplate).enabled).toBe(false);
  });

  it('deletes a template', async () => {
    const created = await createTemplate(adminToken, validTemplate);
    const { id } = created.json() as TicketEmailTemplate;
    const removed = await server.del(`/settings/ticket-email-templates/${id}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);
    expect((await listTemplates(adminToken)).map((t) => t.id)).not.toContain(id);
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never shows one tenant another's templates", async () => {
    await createTemplate(adminToken, validTemplate);
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['tickets--all:rw'],
    });
    expect(await listTemplates(bToken)).toHaveLength(0);
  });

  it("refuses to edit another tenant's template", async () => {
    const created = await createTemplate(adminToken, validTemplate);
    const { id } = created.json() as TicketEmailTemplate;
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['tickets--all:rw'],
    });
    const denied = await server.patch(
      `/settings/ticket-email-templates/${id}`,
      { enabled: false },
      auth(bToken),
    );
    expect(denied.statusCode).toBe(404);
  });

  // --- Scope split -----------------------------------------------------------

  it('lets a read-only holder list but not create templates', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:ro'],
    });
    expect((await server.get('/settings/ticket-email-templates', auth(readToken))).statusCode).toBe(
      200,
    );
    expect((await createTemplate(readToken, validTemplate)).statusCode).toBe(403);
  });

  it('rejects a caller with no ticket scope', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    expect((await server.get('/settings/ticket-email-templates', auth(token))).statusCode).toBe(403);
  });
});
