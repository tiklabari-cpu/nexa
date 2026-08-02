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
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** The application role — RLS-enforced, the way a console reads its own trail. */
const APP_URL = process.env['DATABASE_APP_URL'];

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

/**
 * IP allow-list *enforcement* (FR-MOD-08.9.6-e).
 *
 * The management surface above stores the list; this is the gate that makes it
 * bite. Enforcement lives in one place — the auth `onRequest` hook — so it cannot
 * be forgotten per route, and `GET /auth/me` is the probe: it authenticates,
 * needs no scope, and answers all three principal kinds, so a 403 here is the
 * allow-list talking and nothing else.
 *
 * `trustProxy` is narrowed to a single hop (server.ts), so `request.ip` is the
 * address our own proxy attested — the right-most `X-Forwarded-For` entry — and a
 * client cannot prepend an allowed address to walk through. The negative tests
 * come first: this is a security boundary.
 */
describe('ip allow-list enforcement', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentA: string;
  let agentB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  // `trustProxy` honours `X-Forwarded-For`, so this is how a test presents the
  // address the request appears to come from.
  const from = (token: string, xff: string) => ({ ...auth(token), 'x-forwarded-for': xff });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;

  /** Turn enforcement on for a tenant and seed its list, straight through RLS. */
  async function enforce(tenant: TenantFixture, entries: string[]): Promise<void> {
    await owner.securitySettings.upsert({
      where: { licenseId: tenant.licenseId },
      create: { licenseId: tenant.licenseId, ipAllowlistEnforced: true },
      update: { ipAllowlistEnforced: true },
    });
    for (const entry of entries) {
      await owner.ipAllowlistEntry.create({
        data: { organizationId: tenant.organizationId, licenseId: tenant.licenseId, entry },
      });
    }
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    agentA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [],
    });
    agentB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: [],
    });
  });

  // --- Rejections first ------------------------------------------------------

  it('refuses an agent whose address is not on the list — 403 not_allowed', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    const res = await server.get('/auth/me', from(agentA, '198.51.100.7'));
    expect(res.statusCode).toBe(403);
    // ADR-06 envelope: the existing 403 type is reused, no new error was added.
    expect(errorType(res)).toBe('not_allowed');
  });

  it('cannot be bypassed with a spoofed X-Forwarded-For', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    // The proxy appends the real client (198.51.100.7, denied) as the right-most
    // entry; the attacker prepends an allowed address hoping to be read as the
    // client. With one trusted hop the right-most entry wins, so the header is
    // ignored and the denial stands. Under `trustProxy: true` this would let them
    // in — that is the regression this pins.
    const res = await server.get('/auth/me', from(agentA, '203.0.113.9, 198.51.100.7'));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('not_allowed');
  });

  it('reads the right-most forwarded hop as the client — a trailing allowed address is admitted', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    // The mirror of the spoof test, and together they pin `request.ip` to exactly
    // the right-most `X-Forwarded-For` entry under `trustProxy: 1`. There the
    // right-most hop was the denied real client and a prepended allowed address
    // could not sneak in front; here the right-most hop — the one our single
    // trusted proxy attests — is the allowed address, and it is honoured. So the
    // gate reads neither the left-most (spoofable) nor a fixed index, but the one
    // hop we trust: end-to-end proof the proxy-IP decision from 08.9.6-e holds.
    const res = await server.get('/auth/me', from(agentA, '198.51.100.7, 203.0.113.9'));
    expect(res.statusCode).toBe(200);
  });

  it('denies a caller that presents no address the non-empty list can match', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    // No forwarded address: `request.ip` falls back to the loopback peer, which
    // the list does not cover. A restrictive list treats "no proof you are inside"
    // as out — fail closed.
    const res = await server.get('/auth/me', auth(agentA));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('not_allowed');
  });

  // --- The audit trail -------------------------------------------------------

  it('records a denial as auth.ip_denied and never stores the raw address', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    const res = await server.get('/auth/me', from(agentA, '198.51.100.7'));
    expect(res.statusCode).toBe(403);

    const entry = await owner.auditLogEntry.findFirst({
      where: { licenseId: fx.a.licenseId, action: 'auth.ip_denied' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
    expect(entry!.actorType).toBe('agent');
    // Who acted and with which credential — the `<kind>:<id>` target convention.
    expect(entry!.target).toMatch(/^token:/);
    // The address is PII (NFR-C1/C2): neither the ip column nor the metadata holds
    // it, only the principal kind.
    expect(entry!.ip).toBeNull();
    const metadata = entry!.metadata as Record<string, unknown>;
    expect(metadata.principal_kind).toBe('agent');
    expect(JSON.stringify(metadata)).not.toContain('198.51.100.7');
  });

  it('surfaces the denial through the audit read path (RLS) — scoped to the tenant, no raw address', async () => {
    // The test above reads the row as the owner, which bypasses RLS. This proves
    // the denial is visible the way a console actually reads its trail — through
    // the application role under row-level security, one tenant at a time. There
    // is no GET /audit-log endpoint; the trail is queried through the app role +
    // RLS exactly as here, so this is that read surface, end to end.
    const contextOf = (t: TenantFixture) => ({
      licenseId: t.licenseId,
      organizationId: t.organizationId,
    });

    await enforce(fx.a, ['203.0.113.0/24']);
    const res = await server.get('/auth/me', from(agentA, '198.51.100.7'));
    expect(res.statusCode).toBe(403);

    // Visible to the tenant it belongs to.
    const visibleToA = await withTenant(appRole, contextOf(fx.a), (tx) =>
      tx.auditLogEntry.findMany({ where: { action: 'auth.ip_denied' } }),
    );
    expect(visibleToA.length).toBeGreaterThan(0);

    // And nothing a reader receives carries the address (NFR-C1/C2): not the `ip`
    // column, not the metadata — only the principal kind and the token target.
    const asRead = JSON.stringify(
      visibleToA.map((e) => ({ ip: e.ip, target: e.target, metadata: e.metadata })),
    );
    expect(asRead).not.toContain('198.51.100.7');
    expect(visibleToA.every((e) => e.ip === null)).toBe(true);

    // Invisible to the other tenant — one workspace never reads another's denials.
    const visibleToB = await withTenant(appRole, contextOf(fx.b), (tx) =>
      tx.auditLogEntry.findMany({ where: { action: 'auth.ip_denied' } }),
    );
    expect(visibleToB).toHaveLength(0);
  });

  it('admits a matching address and writes no denial', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    const res = await server.get('/auth/me', from(agentA, '203.0.113.9'));
    expect(res.statusCode).toBe(200);
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'auth.ip_denied' },
      }),
    ).toBe(0);
  });

  // --- Exemptions and the "off" path (regression) ----------------------------

  it('checks nothing while enforcement is off, even with entries present', async () => {
    // The flag governs enforcement, not the presence of rows: a list saved but not
    // switched on restricts no one.
    await owner.ipAllowlistEntry.create({
      data: {
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        entry: '203.0.113.0/24',
      },
    });

    const res = await server.get('/auth/me', from(agentA, '198.51.100.7'));
    expect(res.statusCode).toBe(200);
  });

  it('imposes no restriction when enforced with an empty list', async () => {
    // Enabling enforcement with nothing in the list is "no restriction", never
    // "admit nobody" — the guard against a self-inflicted lockout.
    await enforce(fx.a, []);

    const res = await server.get('/auth/me', from(agentA, '198.51.100.7'));
    expect(res.statusCode).toBe(200);
  });

  it("never lets one workspace's list gate another workspace's agents", async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    // B has no list. B's agent, from an address A's list would reject, is
    // unaffected — enforcement reads through RLS, one license at a time.
    const res = await server.get('/auth/me', from(agentB, '198.51.100.7'));
    expect(res.statusCode).toBe(200);
  });

  it('exempts customer/widget tokens from the agent allow-list', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    const customerToken = (minted.json() as { token: string }).token;

    // From an address the agent list rejects. The widget surface has its own
    // control (the ban-list of 08.9.2); the agent allow-list must not touch it.
    const res = await server.get('/auth/me', from(customerToken, '198.51.100.7'));
    expect(res.statusCode).toBe(200);
    expect((res.json() as { kind: string }).kind).toBe('customer');
  });

  it('leaves a public route reachable from a denied address', async () => {
    await enforce(fx.a, ['203.0.113.0/24']);

    // Minting a widget token is public (a recovery/entry path). Enforcement must
    // skip it, or a workspace could lock its own visitors out. Called from an
    // address the agent list would reject.
    const res = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}`, 'x-forwarded-for': '198.51.100.7' },
    );
    expect(res.statusCode).toBe(200);
  });
});
