/**
 * IP allow-list management (FR-MOD-08.9.6-d).
 *
 * The write surface for the list of sources a workspace trusts to reach its
 * agent/admin panel. Two properties are worth more than the CRUD itself and are
 * tested against real Postgres + RLS rather than asserted on the handler:
 *
 *   - A saved list can never exclude the address it is saved from. The
 *     self-lockout guard is what stops a first typo from locking a workspace out
 *     of its own console once enforcement (08.9.6-e) is switched on.
 *   - The stored entry is canonical, so two spellings of one range cannot both
 *     sit in the list and a duplicate is actually caught by the unique index.
 *
 * Enforcement — refusing a request — is a separate slice; this surface only
 * manages the list, so nothing here should refuse a caller for their address.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('ip allow-list', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let readToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  // `trustProxy` is on, so `X-Forwarded-For` sets the address the request appears
  // to come from — how a test controls whether the self-lockout guard admits it.
  const from = (token: string, ip: string) => ({ ...auth(token), 'x-forwarded-for': ip });

  const message = (res: { json: () => unknown }) =>
    (res.json() as { error: { message: string } }).error.message;

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
      scopes: ['access_rules:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
  });

  // --- Rejections first: this is a security surface. -------------------------

  it('rejects an entry that is not an address or CIDR range', async () => {
    for (const bad of ['999.1.1.1', 'nonsense', '10.0.0.0/33', '10.0.0.0/24/8']) {
      const res = await server.post('/settings/ip-allowlist', { entry: bad }, auth(adminToken));
      expect(res.statusCode, bad).toBe(400);
    }
    // Nothing malformed was stored.
    expect(await owner.ipAllowlistEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('refuses a first entry that would lock the caller out', async () => {
    // The caller connects from 127.0.0.1 (no forwarded address); an entry that
    // does not cover it would, once enforced, shut them out of their own console.
    const res = await server.post(
      '/settings/ip-allowlist',
      { entry: '10.0.0.0/24' },
      auth(adminToken),
    );
    expect(res.statusCode).toBe(400);
    expect(message(res)).toMatch(/lock you out/i);
    expect(await owner.ipAllowlistEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('requires write scope to add or remove an entry', async () => {
    const added = await server.post(
      '/settings/ip-allowlist',
      { entry: '203.0.113.5' },
      from(readToken, '203.0.113.5'),
    );
    expect(added.statusCode).toBe(403);

    const seeded = await owner.ipAllowlistEntry.create({
      data: {
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        entry: '203.0.113.0/24',
      },
    });
    const removed = await server.del(`/settings/ip-allowlist/${seeded.id}`, auth(readToken));
    expect(removed.statusCode).toBe(403);
    expect(await owner.ipAllowlistEntry.count({ where: { id: seeded.id } })).toBe(1);
  });

  it('refuses a duplicate, even spelled as a different form of the same range', async () => {
    const first = await server.post(
      '/settings/ip-allowlist',
      { entry: '203.0.113.0/24' },
      from(adminToken, '203.0.113.5'),
    );
    expect(first.statusCode).toBe(201);

    // Host bits set, same network: canonicalises to the entry already stored, so
    // the unique index — not a string compare on the raw input — catches it.
    const again = await server.post(
      '/settings/ip-allowlist',
      { entry: '203.0.113.55/24' },
      from(adminToken, '203.0.113.5'),
    );
    expect(again.statusCode).toBe(403);
    expect(await owner.ipAllowlistEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never shows or deletes another tenant's entry", async () => {
    await owner.ipAllowlistEntry.create({
      data: {
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        entry: '10.1.0.0/16',
      },
    });
    const theirs = await owner.ipAllowlistEntry.create({
      data: {
        organizationId: fx.b.organizationId,
        licenseId: fx.b.licenseId,
        entry: '198.51.100.0/24',
      },
    });

    const list = await server.get('/settings/ip-allowlist', auth(readToken));
    const entries = (list.json() as { items: Array<{ entry: string }> }).items.map((e) => e.entry);
    expect(entries).toContain('10.1.0.0/16');
    expect(entries).not.toContain('198.51.100.0/24');

    // A cross-tenant id must 404, not 403 — a 403 confirms the id is real
    // (NFR-S5 enumeration protection) — and the row must survive.
    const res = await server.del(`/settings/ip-allowlist/${theirs.id}`, auth(adminToken));
    expect(res.statusCode).toBe(404);
    expect(await owner.ipAllowlistEntry.count({ where: { id: theirs.id } })).toBe(1);
  });

  // --- The full lifecycle, canonical storage and the audit trail -------------

  it('adds, lists and removes an entry, storing it canonically and auditing both writes', async () => {
    // Host bits set on input; the caller (203.0.113.5) is inside the range, so
    // the guard admits the save.
    const added = await server.post(
      '/settings/ip-allowlist',
      { entry: '203.0.113.55/24', label: 'Office VPN' },
      from(adminToken, '203.0.113.5'),
    );
    expect(added.statusCode).toBe(201);
    const created = added.json() as { id: string; entry: string; label: string | null };
    expect(created.entry).toBe('203.0.113.0/24'); // canonical: host bits masked
    expect(created.label).toBe('Office VPN');

    const list = await server.get('/settings/ip-allowlist', auth(readToken));
    expect((list.json() as { items: Array<{ id: string }> }).items.map((e) => e.id)).toContain(
      created.id,
    );

    const addedAudit = await owner.auditLogEntry.findFirst({
      where: { licenseId: fx.a.licenseId, action: 'settings.ip_allowlist_added' },
      orderBy: { createdAt: 'desc' },
    });
    expect((addedAudit!.metadata as { entry?: string }).entry).toBe('203.0.113.0/24');

    const removed = await server.del(`/settings/ip-allowlist/${created.id}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);
    expect(await owner.ipAllowlistEntry.count({ where: { id: created.id } })).toBe(0);

    const removedAudit = await owner.auditLogEntry.findFirst({
      where: { licenseId: fx.a.licenseId, action: 'settings.ip_allowlist_removed' },
      orderBy: { createdAt: 'desc' },
    });
    expect((removedAudit!.metadata as { entry?: string }).entry).toBe('203.0.113.0/24');
  });

  it('404s when removing an entry that does not exist', async () => {
    const res = await server.del(
      '/settings/ip-allowlist/00000000-0000-0000-0000-000000000000',
      auth(adminToken),
    );
    expect(res.statusCode).toBe(404);
  });
});
