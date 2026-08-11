/**
 * Custom fields for tickets and contacts (FR-MOD-08.7.6).
 *
 * The property the feature turns on is the KK "Tip/zorunluluk; Details+CRM'de
 * görünür": a workspace defines fields with a type and a required flag, and a
 * value written against one shows up on the ticket detail (the Details pane) and
 * the customer detail (the CRM). Around that sit the guards that keep it honest:
 * a value of the wrong type or a blank on a required field is refused, deleting
 * a field takes its values with it, the scope split holds, and — the failure
 * most easily shipped unseen — one tenant never sees or writes another's.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface CustomFieldDefinition {
  id: string;
  entity: 'ticket' | 'contact';
  label: string;
  type: 'text' | 'number' | 'boolean' | 'date';
  required: boolean;
  created_at: string;
  updated_at: string;
}

interface CustomFieldValue {
  definition_id: string;
  label: string;
  type: string;
  required: boolean;
  value: string | null;
}

describe('custom fields (tickets/contacts)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const define = (token: string, body: unknown) =>
    server.post('/settings/custom-fields', body, auth(token));

  const createDefinition = async (token: string, body: unknown): Promise<CustomFieldDefinition> => {
    const response = await define(token, body);
    expect(response.statusCode).toBe(201);
    return response.json() as CustomFieldDefinition;
  };

  // A ticket to hang ticket-scoped fields off, attached to the seeded customer.
  const openTicket = async (token: string): Promise<string> => {
    const response = await server.post(
      '/tickets',
      { subject: 'Follow-up', customer_id: fx.a.customerId },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
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
      // Broad enough to define fields (access_rules) and to write values on both
      // a contact (customers) and a ticket (tickets).
      scopes: ['access_rules:rw', 'customers:rw', 'tickets--all:rw'],
    });
  });

  // --- The requirement: write a field, read it in Details and the CRM --------

  it('writes a contact field value and reads it back in the CRM', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'Player ID',
      type: 'text',
    });

    const put = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: 'P-42' } },
      auth(adminToken),
    );
    expect(put.statusCode).toBe(200);

    const detail = await server.get(`/customers/${fx.a.customerId}`, auth(adminToken));
    expect(detail.statusCode).toBe(200);
    const fields = (detail.json() as { custom_fields: CustomFieldValue[] }).custom_fields;
    const stored = fields.find((f) => f.definition_id === field.id);
    expect(stored?.value).toBe('P-42');
    expect(stored?.label).toBe('Player ID');
  });

  it('writes a ticket field value and reads it back in the Details', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'ticket',
      label: 'Balance',
      type: 'number',
    });
    const ticketId = await openTicket(adminToken);

    const put = await server.put(
      `/tickets/${ticketId}/custom-fields`,
      { values: { [field.id]: '1250.50' } },
      auth(adminToken),
    );
    expect(put.statusCode).toBe(200);
    const applied = (put.json() as { custom_fields: CustomFieldValue[] }).custom_fields;
    expect(applied.find((f) => f.definition_id === field.id)?.value).toBe('1250.5');

    const detail = await server.get(`/tickets/${ticketId}`, auth(adminToken));
    const fields = (detail.json() as { custom_fields: CustomFieldValue[] }).custom_fields;
    expect(fields.find((f) => f.definition_id === field.id)?.value).toBe('1250.5');
  });

  it('shows a defined-but-unset field as null rather than omitting it', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'KYC done',
      type: 'boolean',
    });
    const detail = await server.get(`/customers/${fx.a.customerId}`, auth(adminToken));
    const fields = (detail.json() as { custom_fields: CustomFieldValue[] }).custom_fields;
    const entry = fields.find((f) => f.definition_id === field.id);
    expect(entry).toBeDefined();
    expect(entry?.value).toBeNull();
  });

  // --- Type + requiredness (KK "Tip/zorunluluk") -----------------------------

  it('rejects a value of the wrong type', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'Balance',
      type: 'number',
    });
    const bad = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: 'lots' } },
      auth(adminToken),
    );
    expect(bad.statusCode).toBe(400);
  });

  it('rejects a blank value on a required field, and accepts a present one', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'Player ID',
      type: 'text',
      required: true,
    });
    const blank = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: '' } },
      auth(adminToken),
    );
    expect(blank.statusCode).toBe(400);

    const ok = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: 'P-7' } },
      auth(adminToken),
    );
    expect(ok.statusCode).toBe(200);
  });

  it('rejects a value for a field that is not this entity’s', async () => {
    const ticketField = await createDefinition(adminToken, {
      entity: 'ticket',
      label: 'Balance',
      type: 'number',
    });
    // A ticket field cannot be written onto a contact.
    const wrong = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [ticketField.id]: '10' } },
      auth(adminToken),
    );
    expect(wrong.statusCode).toBe(400);
  });

  // --- Definition lifecycle --------------------------------------------------

  it('refuses a duplicate label on the same entity', async () => {
    await createDefinition(adminToken, { entity: 'contact', label: 'Player ID', type: 'text' });
    const dup = await define(adminToken, { entity: 'contact', label: 'Player ID', type: 'number' });
    expect(dup.statusCode).toBe(400);
    // The same label on the *other* entity is fine.
    const other = await define(adminToken, { entity: 'ticket', label: 'Player ID', type: 'text' });
    expect(other.statusCode).toBe(201);
  });

  it('deleting a field removes its stored values', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'Player ID',
      type: 'text',
    });
    await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: 'P-42' } },
      auth(adminToken),
    );

    const removed = await server.del(`/settings/custom-fields/${field.id}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);

    const detail = await server.get(`/customers/${fx.a.customerId}`, auth(adminToken));
    const fields = (detail.json() as { custom_fields: CustomFieldValue[] }).custom_fields;
    expect(fields.find((f) => f.definition_id === field.id)).toBeUndefined();
  });

  it('clears a value when the field is set to null', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'Player ID',
      type: 'text',
    });
    await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: 'P-42' } },
      auth(adminToken),
    );
    await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: null } },
      auth(adminToken),
    );
    const detail = await server.get(`/customers/${fx.a.customerId}`, auth(adminToken));
    const fields = (detail.json() as { custom_fields: CustomFieldValue[] }).custom_fields;
    expect(fields.find((f) => f.definition_id === field.id)?.value).toBeNull();
  });

  // --- Scope split -----------------------------------------------------------

  it('lets a read-only admin list but not define fields', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
    expect((await server.get('/settings/custom-fields', auth(readToken))).statusCode).toBe(200);
    expect(
      (await define(readToken, { entity: 'contact', label: 'X', type: 'text' })).statusCode,
    ).toBe(403);
  });

  it('refuses a contact value write without customers:rw', async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'Player ID',
      type: 'text',
    });
    const roToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:ro'],
    });
    const denied = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: 'P-1' } },
      auth(roToken),
    );
    expect(denied.statusCode).toBe(403);
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never shows one tenant another's field definitions", async () => {
    await createDefinition(adminToken, { entity: 'contact', label: 'Player ID', type: 'text' });
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
    const listed = await server.get('/settings/custom-fields', auth(bToken));
    expect((listed.json() as { items: CustomFieldDefinition[] }).items).toHaveLength(0);
  });

  it("refuses to write a value using another tenant's field", async () => {
    const field = await createDefinition(adminToken, {
      entity: 'contact',
      label: 'Player ID',
      type: 'text',
    });
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['customers:rw'],
    });
    // Tenant B cannot even see tenant A's customer, so its own custom-field
    // write against A's field is refused (404 for the customer, or 400 for the
    // unknown field) — never a 200.
    const denied = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [field.id]: 'P-9' } },
      auth(bToken),
    );
    expect(denied.statusCode).not.toBe(200);
  });
});
