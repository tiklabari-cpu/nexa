/**
 * E-mail forwarding addresses — the console half of FR-MOD-08.5.3.
 *
 * The acceptance criterion names two things this suite has to hold up:
 * "çoklu adres forward → ticket" and "test doğrulama". So the questions asked
 * here are the ones a workspace asks:
 *
 *  - Can I have a second mailbox, and does mail to it land separately?
 *  - Can somebody else end up with my address?
 *  - Does the address I just pasted into my mail provider actually work — and
 *    can I find that out without waiting for a customer to write in?
 *
 * The uniqueness question is asked twice on purpose: once of the endpoint, and
 * once of the database directly. An API-level refusal alone would leave the
 * guarantee resting on a code path that a future caller could go around.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DOMAIN = 'inbound.nexa.localhost';

interface AddressRow {
  id: string;
  label: string | null;
  address: string;
  is_default: boolean;
  ticket_count: number;
  last_received_at: string | null;
}

describe('e-mail forwarding addresses (FR-MOD-08.5.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let auth: Record<string, string>;

  const list = async (headers = auth): Promise<{ domain: string; items: AddressRow[] }> => {
    const response = await server.get('/channels/email/addresses', headers);
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  const define = (label: string, headers = auth) =>
    server.post('/channels/email/addresses', { label }, headers);

  const tokenFor = async (tenant: TenantFixture): Promise<Record<string, string>> => {
    const token = await grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['channels--all:rw'],
    });
    return { authorization: `Bearer ${token}` };
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
    auth = await tokenFor(fx.a);
    await clearRateLimits(server.app);
  });

  // --- The default address ---------------------------------------------------

  it('answers with the workspace default address before anything is defined', async () => {
    const body = await list();

    expect(body.domain).toBe(DOMAIN);
    expect(body.items).toHaveLength(1);
    const [row] = body.items;
    expect(row?.is_default).toBe(true);
    expect(row?.label).toBeNull();
    // The address the workspace has always had, unchanged.
    expect(row?.address).toBe(`${fx.a.organizationId}@${DOMAIN}`);
    expect(row?.ticket_count).toBe(0);
    expect(row?.last_received_at).toBeNull();
  });

  it('materialises exactly one default row however often it is asked', async () => {
    await list();
    await list();

    expect(
      await owner.inboundEmailAddress.count({ where: { licenseId: fx.a.licenseId, label: null } }),
    ).toBe(1);
  });

  it('refuses to delete the default address — every forwarding rule points at it', async () => {
    const [defaultRow] = (await list()).items;
    const response = await server.del(`/channels/email/addresses/${defaultRow?.id}`, auth);

    expect(response.statusCode).toBe(400);
    expect(await owner.inboundEmailAddress.count({ where: { label: null } })).toBe(1);
  });

  // --- Defining more ---------------------------------------------------------

  it('defines a labelled address and lists it beside the default', async () => {
    const created = await define('support');
    expect(created.statusCode).toBe(201);
    expect(created.json().address).toBe(`${fx.a.organizationId}+support@${DOMAIN}`);
    expect(created.json().is_default).toBe(false);

    const body = await list();
    expect(body.items.map((row) => row.label)).toEqual([null, 'support']);
  });

  it('rejects a label that is not a slug, before it can become an unaddressable mailbox', async () => {
    for (const label of ['Support', 'has space', 'trailing-', 'a'.repeat(33), 'wat!']) {
      const response = await define(label);
      expect(response.statusCode, label).toBe(400);
    }
    expect(await owner.inboundEmailAddress.count({ where: { label: { not: null } } })).toBe(0);
  });

  it('refuses a label the workspace already holds, without naming the holder', async () => {
    expect((await define('billing')).statusCode).toBe(201);

    const again = await define('billing');
    expect(again.statusCode).toBe(400);
    expect(again.json().error.message).not.toContain(fx.a.organizationId);
  });

  it('removes a labelled address and keeps the tickets it produced', async () => {
    const created = await define('returns');
    const addressId: string = created.json().id;
    await server.post('/channels/email/inbound', {
      to: `${fx.a.organizationId}+returns@${DOMAIN}`,
      from: 'writer@shopper.example',
      subject: 'Sending it back',
    });

    const removed = await server.del(`/channels/email/addresses/${addressId}`, auth);
    expect(removed.statusCode).toBe(204);

    // The mailbox is gone; the conversation it produced is not.
    const ticket = await owner.ticket.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } });
    expect(ticket.inboundAddressId).toBeNull();
    expect(await owner.inboundEmailAddress.count({ where: { id: addressId } })).toBe(0);
  });

  // --- Uniqueness ------------------------------------------------------------

  it('cannot hand two workspaces the same address — the database itself refuses', async () => {
    const created = await define('support');
    const localPart: string = `${fx.a.organizationId}+support`;
    expect(created.json().address).toBe(`${localPart}@${DOMAIN}`);

    // Not through the API: straight at the table, as a future caller might.
    await expect(
      owner.inboundEmailAddress.create({
        data: { licenseId: fx.b.licenseId, label: 'support', localPart },
      }),
    ).rejects.toThrow();

    expect(await owner.inboundEmailAddress.count({ where: { localPart } })).toBe(1);
  });

  it('allows the same label in another workspace — the address still differs', async () => {
    expect((await define('support')).statusCode).toBe(201);

    const other = await define('support', await tokenFor(fx.b));
    expect(other.statusCode).toBe(201);
    expect(other.json().address).toBe(`${fx.b.organizationId}+support@${DOMAIN}`);
  });

  it("never shows another workspace's addresses, and 404s on its ids", async () => {
    const mine = await define('support');
    const theirs = await list(await tokenFor(fx.b));

    expect(theirs.items.map((row) => row.label)).toEqual([null]);
    const reach = await server.del(
      `/channels/email/addresses/${mine.json().id as string}`,
      await tokenFor(fx.b),
    );
    expect(reach.statusCode).toBe(404);
  });

  // --- Verification ----------------------------------------------------------

  it('proves an address works by putting a test message through the real pipeline', async () => {
    const created = await define('support');
    const addressId: string = created.json().id;

    const tested = await server.post(`/channels/email/addresses/${addressId}/test`, {}, auth);
    expect(tested.statusCode).toBe(200);
    expect(tested.json().address).toBe(`${fx.a.organizationId}+support@${DOMAIN}`);

    // A real ticket on this licence, carrying this address — not a simulation.
    const ticket = await owner.ticket.findUniqueOrThrow({
      where: { id: tested.json().ticket_id as string },
    });
    expect(ticket.licenseId).toBe(fx.a.licenseId);
    expect(ticket.inboundAddressId).toBe(addressId);
    expect(ticket.subject).toBe('Nexa test message');

    // And the evidence is durable: the list reports it afterwards.
    const row = (await list()).items.find((item) => item.id === addressId);
    expect(row?.ticket_count).toBe(1);
    expect(row?.last_received_at).not.toBeNull();
  });

  it('reports each address’s own activity rather than the workspace total', async () => {
    await define('support');
    await define('billing');
    await server.post('/channels/email/inbound', {
      to: `${fx.a.organizationId}+support@${DOMAIN}`,
      from: 'one@shopper.example',
      subject: 'To support',
    });

    const rows = await list();
    const support = rows.items.find((row) => row.label === 'support');
    const billing = rows.items.find((row) => row.label === 'billing');
    expect(support?.ticket_count).toBe(1);
    expect(billing?.ticket_count).toBe(0);
    expect(billing?.last_received_at).toBeNull();
  });

  // --- The door --------------------------------------------------------------

  it('is closed to a caller without the channels scope', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    const headers = { authorization: `Bearer ${token}` };

    expect((await server.get('/channels/email/addresses', headers)).statusCode).toBe(403);
    expect(
      (await server.post('/channels/email/addresses', { label: 'x' }, headers)).statusCode,
    ).toBe(403);
  });

  it('lets the read scope list but not define', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:ro'],
    });
    const headers = { authorization: `Bearer ${token}` };

    expect((await server.get('/channels/email/addresses', headers)).statusCode).toBe(200);
    expect(
      (await server.post('/channels/email/addresses', { label: 'support' }, headers)).statusCode,
    ).toBe(403);
  });

  it('records an opened and a closed mailbox in the audit trail', async () => {
    const created = await define('support');
    await server.del(`/channels/email/addresses/${created.json().id as string}`, auth);

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: { startsWith: 'email_address.' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(entries.map((entry) => entry.action)).toEqual([
      'email_address.created',
      'email_address.deleted',
    ]);
    expect(entries[0]?.metadata).toMatchObject({
      address: `${fx.a.organizationId}+support@${DOMAIN}`,
    });
  });
});
