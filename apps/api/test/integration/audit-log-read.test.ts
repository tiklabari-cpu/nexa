/**
 * Audit log read surface (NFR-S12, FR-MOD-08.9.7-a).
 *
 * The trail has had a writer since slice 23; this is its first reader, and it
 * is a security surface, so the rejections come first. Three properties are
 * worth more than the list itself and are tested against real Postgres + RLS,
 * not asserted on the handler:
 *
 *   - **Doubly gated.** `minimumRole: admin` *and* `audit_log--all:ro`. An
 *     ordinary agent is refused even holding the scope; an owner/admin is
 *     refused without it.
 *   - **One tenant only.** RLS — not a clause in the reader — confines the list
 *     to the caller's workspace; another tenant's entry is never returned.
 *   - **Last 30 days by default**, and paginated by keyset so a page never
 *     overlaps or skips.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('audit log read', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  // Owner role (≥ admin) with the scope — the happy path.
  let ownerReadToken: string;
  // Agent role, but *holding* the scope — isolates the role gate.
  let agentWithScopeToken: string;
  // Admin role, but *without* the scope — isolates the scope gate.
  let adminNoScopeToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;
  const itemsOf = (res: { json: () => unknown }) =>
    (res.json() as { items: Array<{ id: string; target: string | null }> }).items;

  /** Insert an entry straight through the owner connection (bypasses RLS). */
  async function seedEntry(
    tenant: TenantFixture,
    opts: {
      action?: string;
      target?: string | null;
      createdAt?: Date;
      metadata?: Record<string, unknown>;
      ip?: string | null;
    } = {},
  ): Promise<string> {
    const row = await owner.auditLogEntry.create({
      data: {
        licenseId: tenant.licenseId,
        actorId: tenant.ownerAccountId,
        actorType: 'agent',
        action: opts.action ?? 'auth.login',
        target: opts.target ?? null,
        metadata: (opts.metadata ?? {}) as Prisma.InputJsonObject,
        ip: opts.ip ?? null,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  /** A real admin-role principal (fixtures ship only owner + agent). */
  async function createAdmin(tenant: TenantFixture): Promise<string> {
    const account = await owner.account.create({
      data: { email: `admin-${tenant.licenseId}@example.test`, name: 'Admin', passwordHash: null },
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

    ownerReadToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['audit_log--all:ro'],
    });
    agentWithScopeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['audit_log--all:ro'],
    });
    const adminId = await createAdmin(fx.a);
    adminNoScopeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: adminId,
      scopes: [],
    });
  });

  // --- Rejections first: this is a security surface. -------------------------

  it('refuses an unauthenticated caller with 401', async () => {
    const res = await server.get('/audit-log');
    expect(res.statusCode).toBe(401);
  });

  it('refuses an agent — even one holding the scope (role gate)', async () => {
    await seedEntry(fx.a);
    const res = await server.get('/audit-log', auth(agentWithScopeToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  it('refuses an admin without the audit scope (scope gate)', async () => {
    await seedEntry(fx.a);
    const res = await server.get('/audit-log', auth(adminNoScopeToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never returns another tenant's entries", async () => {
    const mineNew = await seedEntry(fx.a, { action: 'member.suspended', target: 'token:a-1' });
    const mineOld = await seedEntry(fx.a, {
      action: 'pat.created',
      target: 'token:a-2',
      createdAt: new Date(Date.now() - 60_000),
    });
    // Two entries for B, one of them the newest of all — it must still not leak.
    await seedEntry(fx.b, { action: 'auth.login', target: 'token:b-only', ip: '198.51.100.7' });
    await seedEntry(fx.b, { action: 'pat.revoked', target: 'token:b-2' });

    const res = await server.get('/audit-log', auth(ownerReadToken));
    expect(res.statusCode).toBe(200);
    const ids = itemsOf(res).map((e) => e.id);
    const targets = itemsOf(res).map((e) => e.target);

    expect(ids).toEqual(expect.arrayContaining([mineNew, mineOld]));
    expect(ids).toHaveLength(2);
    expect(targets).not.toContain('token:b-only');
    expect(targets).not.toContain('token:b-2');
  });

  // --- The default 30-day window ---------------------------------------------

  it('defaults to the last 30 days — an older entry is not returned', async () => {
    const recent = await seedEntry(fx.a, { action: 'auth.login', target: 'token:recent' });
    // 31 days old: one day past the default window's edge.
    await seedEntry(fx.a, {
      action: 'auth.login',
      target: 'token:stale',
      createdAt: new Date(Date.now() - 31 * 86_400_000),
    });

    const res = await server.get('/audit-log', auth(ownerReadToken));
    expect(res.statusCode).toBe(200);
    const targets = itemsOf(res).map((e) => e.target);
    expect(targets).toContain('token:recent');
    expect(targets).not.toContain('token:stale');
    expect(itemsOf(res).map((e) => e.id)).toEqual([recent]);
  });

  // --- Keyset pagination and shape -------------------------------------------

  it('paginates by keyset — newest first, no overlap, no gap', async () => {
    // Four entries, staggered so the (created_at DESC, id DESC) order is total.
    const base = Date.now() - 60_000;
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(
        await seedEntry(fx.a, {
          action: 'settings.security_updated',
          target: `token:e${i}`,
          createdAt: new Date(base - i * 1000),
        }),
      );
    }
    // ids[0] is newest → expected DESC order is exactly ids as inserted.
    const expected = ids;

    const page1 = await server.get('/audit-log?limit=2', auth(ownerReadToken));
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json() as { items: Array<{ id: string }>; next_page_id?: string };
    expect(body1.items.map((e) => e.id)).toEqual(expected.slice(0, 2));
    expect(body1.next_page_id).toBeTruthy();

    const page2 = await server.get(
      `/audit-log?limit=2&page_id=${encodeURIComponent(body1.next_page_id!)}`,
      auth(ownerReadToken),
    );
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json() as { items: Array<{ id: string }>; next_page_id?: string };
    expect(body2.items.map((e) => e.id)).toEqual(expected.slice(2, 4));
    // Last page: no cursor.
    expect(body2.next_page_id).toBeUndefined();

    // Union covers every entry exactly once — no overlap, no skip.
    const seen = [...body1.items, ...body2.items].map((e) => e.id);
    expect(new Set(seen).size).toBe(4);
    expect(seen).toEqual(expected);
  });

  it('clamps an over-large limit instead of rejecting it', async () => {
    await seedEntry(fx.a, { action: 'auth.login' });
    // Well above the 100 maximum: a 200, not a 400 — the ceiling is a clamp.
    const res = await server.get('/audit-log?limit=100000', auth(ownerReadToken));
    expect(res.statusCode).toBe(200);
    expect(itemsOf(res).length).toBeGreaterThan(0);
    expect(itemsOf(res).length).toBeLessThanOrEqual(100);
  });

  it('rejects a zero or negative limit with 400', async () => {
    for (const bad of ['0', '-5', 'abc']) {
      const res = await server.get(`/audit-log?limit=${bad}`, auth(ownerReadToken));
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it('returns the full entry shape, metadata included', async () => {
    await seedEntry(fx.a, {
      action: 'member.suspended',
      target: 'token:shape',
      metadata: { role: 'agent', fields: ['suspended'] },
      ip: '203.0.113.9',
    });

    const res = await server.get('/audit-log', auth(ownerReadToken));
    const entry = (
      res.json() as {
        items: Array<{
          id: string;
          action: string;
          actor_type: string;
          target: string | null;
          metadata: Record<string, unknown>;
          ip: string | null;
          created_at: string;
        }>;
      }
    ).items[0]!;
    expect(entry.action).toBe('member.suspended');
    expect(entry.actor_type).toBe('agent');
    expect(entry.target).toBe('token:shape');
    expect(entry.metadata).toEqual({ role: 'agent', fields: ['suspended'] });
    expect(entry.ip).toBe('203.0.113.9');
    expect(typeof entry.created_at).toBe('string');
  });
});
