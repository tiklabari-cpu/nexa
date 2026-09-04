/**
 * Company details (FR-MOD-08.3 · M-CO-a).
 *
 * PRD §8.4 calls sector/address/timezone the billing/branding/report basis,
 * which is why `sector` is the interesting field here: a closed list, not
 * free text, enforced twice — the zod schema and `organizations_sector_check`
 * — and the database attack below proves the second half actually holds, not
 * just the first. Unlike most of `/settings/*` the row this reads and writes
 * always exists (`organizations` is created at signup), so there is no
 * "no row yet" default state to test — only the real one from signup.
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

describe('company details (FR-MOD-08.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  let ownerToken: string;
  let agentWithScopeToken: string;
  let adminNoScopeToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;

  /** Fixtures ship only owner + agent; company details is admin+. */
  async function createAdmin(tenant: TenantFixture): Promise<string> {
    const account = await owner.account.create({
      data: {
        email: `admin-${tenant.licenseId}@example.test`,
        name: 'Admin',
        passwordHash: null,
      },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: tenant.licenseId,
        agentId: account.id,
        role: 'admin',
        routingStatus: 'accepting_chats',
      },
    });
    return account.id;
  }

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

    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['organization--my:rw'],
    });
    // Isolates the role gate: an agent holding the scope must still be refused.
    agentWithScopeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['organization--my:rw'],
    });
    // Isolates the scope gate: an admin without the scope must still be refused.
    const adminId = await createAdmin(fx.a);
    adminNoScopeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: adminId,
      scopes: [],
    });
  });

  // =========================================================================
  // Rejections first — this is admin-only workspace configuration.
  // =========================================================================

  it('refuses an unauthenticated caller with 401', async () => {
    expect((await server.get('/settings/company')).statusCode).toBe(401);
    expect((await server.patch('/settings/company', { timezone: 'UTC' })).statusCode).toBe(401);
  });

  it('refuses an agent — even one holding the scope (role gate)', async () => {
    const res = await server.get('/settings/company', auth(agentWithScopeToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  it('refuses an admin without the scope (scope gate)', async () => {
    const res = await server.get('/settings/company', auth(adminNoScopeToken));
    expect(res.statusCode).toBe(403);
  });

  // =========================================================================
  // Reading
  // =========================================================================

  it('reads the signup name, null sector/address, and UTC for a fresh workspace', async () => {
    const res = await server.get('/settings/company', auth(ownerToken));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ name: 'Org A', sector: null, address: null, timezone: 'UTC' });
  });

  // =========================================================================
  // Writing
  // =========================================================================

  it('saves every field and reads them back, from both the API and the row', async () => {
    const res = await server.patch(
      '/settings/company',
      {
        name: 'Acme Inc',
        sector: 'saas_technology',
        address: '1 Infinite Loop',
        timezone: 'Europe/Istanbul',
      },
      auth(ownerToken),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'Acme Inc',
      sector: 'saas_technology',
      address: '1 Infinite Loop',
      timezone: 'Europe/Istanbul',
    });

    const stored = await owner.organization.findUniqueOrThrow({
      where: { id: fx.a.organizationId },
      select: { name: true, sector: true, address: true, timezone: true },
    });
    expect(stored).toEqual({
      name: 'Acme Inc',
      sector: 'saas_technology',
      address: '1 Infinite Loop',
      timezone: 'Europe/Istanbul',
    });
  });

  it('is a real patch — a field left out of the body survives untouched', async () => {
    await server.patch('/settings/company', { sector: 'healthcare' }, auth(ownerToken));

    const res = await server.patch('/settings/company', { address: 'Somewhere' }, auth(ownerToken));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sector: 'healthcare',
      address: 'Somewhere',
      timezone: 'UTC',
    });
  });

  it('clears sector and address with an explicit null', async () => {
    await server.patch(
      '/settings/company',
      { sector: 'healthcare', address: 'X' },
      auth(ownerToken),
    );

    const res = await server.patch(
      '/settings/company',
      { sector: null, address: null },
      auth(ownerToken),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sector: null, address: null });
  });

  it('lets an admin write, not just the owner', async () => {
    const adminId = await createAdmin(fx.b);
    const adminToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: adminId,
      scopes: ['organization--my:rw'],
    });

    const res = await server.patch(
      '/settings/company',
      { timezone: 'America/New_York' },
      auth(adminToken),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ timezone: 'America/New_York' });
  });

  // =========================================================================
  // Validation
  // =========================================================================

  it('refuses an empty body', async () => {
    const res = await server.patch('/settings/company', {}, auth(ownerToken));
    expect(res.statusCode).toBe(400);
  });

  it('refuses a sector outside the closed list', async () => {
    const res = await server.patch('/settings/company', { sector: 'crypto' }, auth(ownerToken));
    expect(res.statusCode).toBe(400);
  });

  it('refuses a misspelled timezone', async () => {
    const res = await server.patch(
      '/settings/company',
      { timezone: 'Europe/Istambul' },
      auth(ownerToken),
    );
    expect(res.statusCode).toBe(400);
  });

  it('refuses null for timezone — there is nothing to unset, only replace', async () => {
    const res = await server.patch('/settings/company', { timezone: null }, auth(ownerToken));
    expect(res.statusCode).toBe(400);
  });

  it('refuses an unknown field', async () => {
    const res = await server.patch('/settings/company', { size: 'large' }, auth(ownerToken));
    expect(res.statusCode).toBe(400);
  });

  it('refuses the value in the database too, not only at the endpoint', async () => {
    // Attacked as the table owner, which bypasses RLS and every
    // application-level guard — the CHECK is what still stops it.
    await expect(
      owner.organization.update({
        where: { id: fx.a.organizationId },
        data: { sector: 'crypto' },
      }),
    ).rejects.toThrow(/organizations_sector_check/);
  });

  // =========================================================================
  // Tenancy and audit
  // =========================================================================

  it('never touches another workspace', async () => {
    await server.patch('/settings/company', { sector: 'healthcare' }, auth(ownerToken));

    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['organization--my:rw'],
    });
    const bRes = await server.get('/settings/company', auth(bToken));

    expect(bRes.json()).toMatchObject({ sector: null });
  });

  it('records the change in the audit trail, naming the fields', async () => {
    await server.patch(
      '/settings/company',
      { sector: 'healthcare', address: 'X' },
      auth(ownerToken),
    );

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'settings.company_updated' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorId).toBe(fx.a.ownerAccountId);
    expect(entries[0]?.metadata).toMatchObject({ fields: ['sector', 'address'] });
  });
});
