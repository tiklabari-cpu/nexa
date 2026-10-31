/**
 * The permission matrix's store, cache and endpoints (tm 325.2 · SiyahTuş
 * analysis RL-02, owner decision K7; migration 20261022210000_permission_matrix).
 *
 * The sessions do not read the matrix yet (tm 325.3); what is pinned here is
 * what they will lean on:
 *
 *   - **Who.** A Yönetici reads the matrix, only the Kurucu changes it; an
 *     Ekip Üyesi reads their own capabilities on `/auth/me`.
 *   - **What may be stored.** A change the catalogue refuses — a locked cell,
 *     a role below the row's floor, an unknown name — refuses the whole
 *     request, and nothing is written.
 *   - **How it is stored.** One row per cell that differs from the default; a
 *     cell set back loses its row; the version moves with the rows and only
 *     with them; two saves queue on the licence, so the trail's `from` is true.
 *   - **What a change owes.** An audit entry with every moved cell and the
 *     reason; a mail to every active Yönetici.
 *   - **Where it reaches.** Another process drops its cached copy when the
 *     change is announced — after the commit — and another workspace sees
 *     nothing of it.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPABILITIES,
  MATRIX_ROLES,
  PERMISSIONS_CACHE_TTL_MS,
  capabilitiesForRole,
  capabilityLock,
  defaultScopesForRole,
  type CapabilityDefinition,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const CATALOGUE = CAPABILITIES as readonly CapabilityDefinition[];
const REASON = 'Ekip Üyeleri vardiya raporunu görsün';

interface CellBody {
  role: string;
  value: string;
  default: string;
  lock: string | null;
}

interface MatrixBody {
  version: number;
  roles: string[];
  capabilities: Array<{
    key: string;
    group: string;
    values: string[];
    floor_role: string;
    owner_only: boolean;
    cells: CellBody[];
  }>;
}

interface ErrorBody {
  error: { type: string; message: string; details?: Record<string, unknown> };
}

function cell(body: MatrixBody, capability: string, role: string): CellBody {
  const row = body.capabilities.find((c) => c.key === capability);
  const found = row?.cells.find((c) => c.role === role);
  if (!found) throw new Error(`no cell ${role} · ${capability}`);
  return found;
}

describe('the permission matrix — store, cache and the Founder’s PUT (RL-02 · tm 325.2)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let mailer: MemoryMailer;
  let server: TestServer;
  /** A second API process — what the announcement is for. */
  let other: TestServer;
  let fx: Fixtures;
  let seq = 0;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    mailer = new MemoryMailer();
    server = await startTestServer({}, { mailer });
    other = await startTestServer();
  });

  afterAll(async () => {
    await Promise.all([server.close(), other.close()]);
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    seq = 0;
    // `seedFixtures` hands the next test the same licence ids; a process's
    // cached matrix must not outlive the workspace it was read for.
    server.app.permissionMatrix.cache.invalidate();
    other.app.permissionMatrix.cache.invalidate();
    mailer.clear();
    await clearRateLimits(server.app);
  });

  afterEach(async () => {
    // The admins' mail is sent beside the response; the next reset must not
    // truncate under it.
    await server.app.backgroundMail.settled();
    vi.restoreAllMocks();
  });

  async function member(
    t: TenantFixture,
    role: string,
    options: { locale?: string; suspended?: boolean; notifyEmail?: boolean } = {},
  ) {
    const email = `${role}-${(seq += 1)}-${t.licenseId}@example.test`;
    const account = await owner.account.create({
      data: { email, name: `${role} ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: t.licenseId,
        agentId: account.id,
        role,
        ...(options.locale ? { locale: options.locale } : {}),
        ...(options.suspended ? { suspended: true } : {}),
        ...(options.notifyEmail === false ? { notifyEmail: false } : {}),
      },
    });
    return { id: account.id, email };
  }

  /** A signed-in panel session for `accountId`, holding its role's set. */
  async function session(t: TenantFixture, accountId: string, role: string): Promise<string> {
    const token = await grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      scopes: defaultScopesForRole(role),
    });
    return `Bearer ${token}`;
  }

  const ownerSession = (t: TenantFixture) => session(t, t.ownerAccountId, 'owner');
  const agentSession = (t: TenantFixture) => session(t, t.agentAccountId, 'agent');
  const tenantOf = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  const put = (auth: string, changes: unknown[], reason: unknown = REASON) =>
    server.put('/settings/permissions', { changes, reason }, { authorization: auth });

  async function version(t: TenantFixture): Promise<number> {
    const licence = await owner.license.findUniqueOrThrow({
      where: { id: t.licenseId },
      select: { permissionsVersion: true },
    });
    return licence.permissionsVersion;
  }

  const storedRows = (t: TenantFixture) =>
    owner.roleCapabilityOverride.findMany({
      where: { licenseId: t.licenseId },
      orderBy: [{ role: 'asc' }, { capability: 'asc' }],
    });

  const auditEntries = (t: TenantFixture) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: t.licenseId, action: 'permissions.changed' },
      orderBy: [{ chainSeq: 'asc' }],
    });

  // =========================================================================
  // Who
  // =========================================================================

  describe('who reads it and who changes it', () => {
    it('shows a Yönetici the catalogue, every default, lock and floor, at version 0 (FR-MOD-04.RBAC)', async () => {
      const admin = await member(fx.a, 'admin');
      const res = await server.get('/settings/permissions', {
        authorization: await session(fx.a, admin.id, 'admin'),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<MatrixBody>();
      expect(body.version).toBe(0);
      expect(body.roles).toEqual([...MATRIX_ROLES]);
      expect(body.capabilities.map((c) => c.key)).toEqual(CATALOGUE.map((d) => d.key));
      for (const definition of CATALOGUE) {
        const row = body.capabilities.find((c) => c.key === definition.key)!;
        expect(row).toMatchObject({
          group: definition.group,
          values: [...definition.values],
          floor_role: definition.floorRole,
          owner_only: definition.ownerOnly === true,
        });
        expect(row.cells).toEqual(
          MATRIX_ROLES.map((role) => ({
            role,
            value: definition.defaults[role],
            default: definition.defaults[role],
            lock: capabilityLock(definition, role),
          })),
        );
      }
    });

    it('refuses the matrix to an Ekip Üyesi and its change to everyone but the Kurucu (FR-MOD-04.RBAC · NFR-S3)', async () => {
      const agent = await agentSession(fx.a);
      expect((await server.get('/settings/permissions', { authorization: agent })).statusCode).toBe(
        403,
      );

      const change = [{ role: 'agent', capability: 'reports.view', value: 'all' }];
      const admin = await member(fx.a, 'admin');
      const viceowner = await member(fx.a, 'viceowner');
      const lead = await member(fx.a, 'team_lead');
      for (const auth of [
        agent,
        await session(fx.a, admin.id, 'admin'),
        await session(fx.a, viceowner.id, 'viceowner'),
        await session(fx.a, lead.id, 'team_lead'),
      ]) {
        expect((await put(auth, change)).statusCode).toBe(403);
      }
      // The Kurucu's own credential without the security scope is refused too:
      // a narrow personal token stays narrow.
      const narrow = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        kind: 'pat',
        scopes: ['access_rules:ro', 'reports_read'],
      });
      expect((await put(`Bearer ${narrow}`, change)).statusCode).toBe(403);

      expect(await storedRows(fx.a)).toEqual([]);
      expect(await version(fx.a)).toBe(0);
      expect(await auditEntries(fx.a)).toEqual([]);
    });
  });

  // =========================================================================
  // What may be stored
  // =========================================================================

  describe('what the PUT refuses', () => {
    const valid = { role: 'agent', capability: 'reports.view', value: 'all' };

    it.each([
      ['below_floor', { role: 'agent', capability: 'customers.erase', value: 'on' }],
      ['below_floor', { role: 'team_lead', capability: 'settings.webhooks', value: 'on' }],
      ['locked', { role: 'owner', capability: 'reports.view', value: 'none' }],
      ['locked', { role: 'admin', capability: 'settings.sso', value: 'on' }],
      ['locked', { role: 'admin', capability: 'settings.permissions', value: 'on' }],
      ['unknown_role', { role: 'viceowner', capability: 'reports.view', value: 'all' }],
      ['unknown_capability', { role: 'agent', capability: 'reports.export', value: 'on' }],
      ['invalid_value', { role: 'agent', capability: 'reports.view', value: 'own' }],
      ['duplicate_change', valid],
    ])(
      'refuses %s whole, naming the cell, and stores nothing (FR-MOD-04.RBAC)',
      async (reason, bad) => {
        const res = await put(await ownerSession(fx.a), [valid, bad]);
        expect(res.statusCode).toBe(400);
        expect(res.json<ErrorBody>().error.details).toEqual({
          reason,
          role: bad.role,
          capability: bad.capability,
        });
        expect(await storedRows(fx.a)).toEqual([]);
        expect(await version(fx.a)).toBe(0);
        expect(await auditEntries(fx.a)).toEqual([]);
      },
    );

    it('asks why, and takes no empty or oversized list', async () => {
      const auth = await ownerSession(fx.a);
      for (const [changes, reason] of [
        [[valid], undefined],
        [[valid], '   '],
        [[valid], 'x'.repeat(501)],
        [[], REASON],
        [Array.from({ length: 201 }, () => valid), REASON],
      ] as const) {
        const res = await server.put(
          '/settings/permissions',
          { changes, ...(reason === undefined ? {} : { reason }) },
          { authorization: auth },
        );
        expect(res.statusCode).toBe(400);
      }
      expect(await storedRows(fx.a)).toEqual([]);
    });

    it('stores only the columns the Founder may change — the database refuses the rest', async () => {
      const [check] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'role_capability_overrides_role_check'`;
      const roles = [...check!.def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!).sort();
      expect(roles).toEqual(MATRIX_ROLES.filter((role) => role !== 'owner').sort());

      for (const role of ['owner', 'viceowner', 'Agent']) {
        await expect(
          owner.roleCapabilityOverride.create({
            data: { licenseId: fx.a.licenseId, role, capability: 'reports.view', value: 'all' },
          }),
        ).rejects.toThrow(/role_capability_overrides_role_check/);
      }
    });
  });

  // =========================================================================
  // How it is stored
  // =========================================================================

  describe('how a change is stored', () => {
    it('stores a choice, bumps the version, and GET and /auth/me answer from it', async () => {
      const auth = await ownerSession(fx.a);
      const res = await put(auth, [{ role: 'agent', capability: 'reports.view', value: 'all' }]);
      expect(res.statusCode).toBe(200);
      const body = res.json<MatrixBody>();
      expect(body.version).toBe(1);
      expect(cell(body, 'reports.view', 'agent')).toEqual({
        role: 'agent',
        value: 'all',
        default: 'none',
        lock: null,
      });

      const rows = await storedRows(fx.a);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        role: 'agent',
        capability: 'reports.view',
        value: 'all',
        updatedBy: fx.a.ownerAccountId,
      });
      expect(await version(fx.a)).toBe(1);

      const read = await server.get('/settings/permissions', { authorization: auth });
      expect(read.json<MatrixBody>()).toEqual(body);

      // "Yetkilerim": the agent's own capabilities carry the choice; the
      // Founder's are the catalogue's, whatever was stored.
      const overrides = [{ role: 'agent', capability: 'reports.view', value: 'all' }];
      const agentMe = await server.get('/auth/me', { authorization: await agentSession(fx.a) });
      expect(agentMe.json<{ capabilities: unknown }>().capabilities).toEqual(
        capabilitiesForRole('agent', overrides),
      );
      expect(agentMe.json<{ capabilities: Record<string, string> }>().capabilities).toMatchObject({
        'reports.view': 'all',
      });
      const ownerMe = await server.get('/auth/me', { authorization: auth });
      expect(ownerMe.json<{ capabilities: unknown }>().capabilities).toEqual(
        capabilitiesForRole('owner', []),
      );
    });

    it('drops a cell set back to its default, and a request that moves nothing writes nothing', async () => {
      const auth = await ownerSession(fx.a);
      await member(fx.a, 'admin');
      expect(
        (await put(auth, [{ role: 'agent', capability: 'reports.view', value: 'all' }])).statusCode,
      ).toBe(200);
      await server.app.backgroundMail.settled();
      expect(mailer.sent).toHaveLength(1);

      const back = await put(auth, [{ role: 'agent', capability: 'reports.view', value: 'none' }]);
      expect(back.json<MatrixBody>().version).toBe(2);
      expect(await storedRows(fx.a)).toEqual([]);
      await server.app.backgroundMail.settled();
      expect(mailer.sent).toHaveLength(2);

      // Its default again, a locked cell's own value, the Founder's own column:
      // nothing moves, so the version, the trail and the admins' inbox stay.
      const noop = await put(auth, [
        { role: 'agent', capability: 'reports.view', value: 'none' },
        { role: 'agent', capability: 'customers.erase', value: 'off' },
        { role: 'owner', capability: 'billing.manage', value: 'on' },
        { role: 'admin', capability: 'settings.sso', value: 'off' },
      ]);
      expect(noop.statusCode).toBe(200);
      expect(noop.json<MatrixBody>().version).toBe(2);
      expect(await version(fx.a)).toBe(2);
      expect(await storedRows(fx.a)).toEqual([]);
      expect(await auditEntries(fx.a)).toHaveLength(2);
      await server.app.backgroundMail.settled();
      expect(mailer.sent).toHaveLength(2);
    });

    it('trails a save that only removed a row the resolution was ignoring (NFR-S12)', async () => {
      // A value `reports.view` does not take, written around the PUT: the
      // resolution ignores it, so the cell reads its default.
      await owner.roleCapabilityOverride.create({
        data: {
          licenseId: fx.a.licenseId,
          role: 'agent',
          capability: 'reports.view',
          value: 'own',
        },
      });
      await member(fx.a, 'admin');
      const auth = await ownerSession(fx.a);
      const read = await server.get('/settings/permissions', { authorization: auth });
      expect(cell(read.json<MatrixBody>(), 'reports.view', 'agent').value).toBe('none');

      const res = await put(auth, [{ role: 'agent', capability: 'reports.view', value: 'none' }]);
      expect(res.json<MatrixBody>().version).toBe(1);
      expect(await storedRows(fx.a)).toEqual([]);

      // The table and the version moved, no cell did: in the trail, not in
      // the admins' inbox.
      const entries = await auditEntries(fx.a);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.metadata).toMatchObject({
        version: 1,
        changes: [],
        rows_written: 0,
        rows_removed: 1,
        reason: REASON,
      });
      await server.app.backgroundMail.settled();
      expect(mailer.sent).toEqual([]);
    });

    it('queues two saves of one workspace on its licence: each trail entry starts where the other ended', async () => {
      const auth = await ownerSession(fx.a);
      // Both away from the default, so both store a row whichever runs first.
      const [first, second] = await Promise.all([
        put(auth, [{ role: 'agent', capability: 'chats.view', value: 'all' }]),
        put(auth, [{ role: 'agent', capability: 'chats.view', value: 'own' }]),
      ]);
      expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
      expect([first.json<MatrixBody>().version, second.json<MatrixBody>().version].sort()).toEqual([
        1, 2,
      ]);

      const entries = await auditEntries(fx.a);
      expect(entries).toHaveLength(2);
      const [earlier, later] = entries.map(
        (entry) => (entry.metadata as { changes: Array<{ from: string; to: string }> }).changes[0]!,
      );
      expect(earlier!.from).toBe('team');
      // Without the lock both saves read the empty table and both say "from team".
      expect(later!.from).toBe(earlier!.to);
      const [row] = await storedRows(fx.a);
      expect(row?.value).toBe(later!.to);
    });
  });

  // =========================================================================
  // What a change owes
  // =========================================================================

  describe('what a change owes the trail and the Yöneticiler', () => {
    it('audits every moved cell, from and to, with the reason (NFR-S12)', async () => {
      const res = await put(await ownerSession(fx.a), [
        { role: 'team_lead', capability: 'customers.edit', value: 'on' },
        { role: 'agent', capability: 'reports.view', value: 'all' },
        // Its own value: not a move, not in the trail.
        { role: 'admin', capability: 'chats.view', value: 'all' },
      ]);
      expect(res.statusCode).toBe(200);

      const entries = await auditEntries(fx.a);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: fx.a.ownerAccountId,
        target: `permissions:${fx.a.licenseId.toString()}`,
      });
      expect(entries[0]!.metadata).toMatchObject({
        version: 1,
        reason: REASON,
        // Catalogue order, then column order — not the order they were sent.
        changes: [
          { role: 'team_lead', capability: 'customers.edit', from: 'off', to: 'on' },
          { role: 'agent', capability: 'reports.view', from: 'none', to: 'all' },
        ],
      });
    });

    it('mails every active Yönetici in their language — not the Kurucu, not the others', async () => {
      const turkish = await member(fx.a, 'admin', { locale: 'tr' });
      const english = await member(fx.a, 'admin', { locale: 'en' });
      const vice = await member(fx.a, 'viceowner');
      const suspended = await member(fx.a, 'admin', { suspended: true });
      const muted = await member(fx.a, 'admin', { notifyEmail: false });
      const lead = await member(fx.a, 'team_lead');
      await member(fx.b, 'admin');

      expect(
        (
          await put(await ownerSession(fx.a), [
            { role: 'agent', capability: 'reports.view', value: 'all' },
          ])
        ).statusCode,
      ).toBe(200);
      await server.app.backgroundMail.settled();

      const to = mailer.sent.map((m) => m.to).sort();
      expect(to).toEqual([turkish.email, english.email, vice.email].sort());
      for (const absent of [suspended, muted, lead]) expect(to).not.toContain(absent.email);
      expect(to).not.toContain(fx.a.ownerEmail);
      expect(to).not.toContain(fx.a.agentEmail);

      const tr = mailer.sent.find((m) => m.to === turkish.email)!;
      expect(tr.licenseId).toBe(fx.a.licenseId);
      expect(tr.subject).toContain('izinler değişti');
      expect(tr.body).toContain('Ekip Üyesi · Raporları görme');
      expect(tr.body).toContain('Yok → Tümü');
      expect(tr.body).toContain(REASON);
      expect(tr.body).toContain('/app/settings/permissions');
      const en = mailer.sent.find((m) => m.to === english.email)!;
      expect(en.subject).toContain('permissions changed');
      expect(en.body).toContain('Agent · View reports');
      expect(en.body).toContain('None → All');
    });
  });

  // =========================================================================
  // Where it reaches
  // =========================================================================

  describe('where a change reaches', () => {
    it('drops another process’s cached matrix when announced — well inside the minute', async () => {
      const tenant = tenantOf(fx.a);
      expect((await other.app.permissionMatrix.cache.get(tenant)).version).toBe(0);
      expect(PERMISSIONS_CACHE_TTL_MS).toBe(60_000);

      expect(
        (
          await put(await ownerSession(fx.a), [
            { role: 'agent', capability: 'reports.view', value: 'all' },
          ])
        ).statusCode,
      ).toBe(200);

      // No version given: only the announcement can make the other process
      // read again before its minute is up.
      const deadline = Date.now() + 5_000;
      let seen = 0;
      while (Date.now() < deadline) {
        seen = (await other.app.permissionMatrix.cache.get(tenant)).version;
        if (seen === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(seen).toBe(1);
      const snapshot = await other.app.permissionMatrix.cache.get(tenant);
      expect(snapshot.overrides).toEqual([
        { role: 'agent', capability: 'reports.view', value: 'all' },
      ]);
    });

    it('announces only after the commit — a second connection already sees the version', async () => {
      const seenAtAnnounce: number[] = [];
      const original = server.app.permissionMatrix.announce.bind(server.app.permissionMatrix);
      vi.spyOn(server.app.permissionMatrix, 'announce').mockImplementation(
        async (licenseId, announced) => {
          // Not in the request's transaction: an uncommitted bump is invisible.
          seenAtAnnounce.push(await version(fx.a));
          expect(licenseId).toBe(fx.a.licenseId);
          expect(announced).toBe(1);
          await original(licenseId, announced);
        },
      );
      expect(
        (
          await put(await ownerSession(fx.a), [
            { role: 'agent', capability: 'reports.view', value: 'all' },
          ])
        ).statusCode,
      ).toBe(200);
      expect(seenAtAnnounce).toEqual([1]);

      // A request that moved nothing announces nothing.
      await put(await ownerSession(fx.a), [
        { role: 'agent', capability: 'reports.view', value: 'all' },
      ]);
      expect(seenAtAnnounce).toEqual([1]);
    });

    it('a stale cached copy is not served to a reader that knows the version', async () => {
      const tenant = tenantOf(fx.a);
      // Cache version 0 here, then change the matrix behind the process's back
      // (no announcement — a write it never heard of).
      await server.app.permissionMatrix.cache.get(tenant);
      await owner.$transaction([
        owner.roleCapabilityOverride.create({
          data: {
            licenseId: fx.a.licenseId,
            role: 'agent',
            capability: 'reports.view',
            value: 'all',
          },
        }),
        owner.license.update({
          where: { id: fx.a.licenseId },
          data: { permissionsVersion: { increment: 1 } },
        }),
      ]);
      // `/auth/me` reads the version with the profile, so it is not fooled.
      const me = await server.get('/auth/me', { authorization: await agentSession(fx.a) });
      expect(me.json<{ capabilities: Record<string, string> }>().capabilities['reports.view']).toBe(
        'all',
      );
    });

    it('leaves another workspace’s matrix unread and untouched (NFR-S4)', async () => {
      await put(await ownerSession(fx.a), [
        { role: 'agent', capability: 'reports.view', value: 'all' },
      ]);

      const theirs = await server.get('/settings/permissions', {
        authorization: await ownerSession(fx.b),
      });
      expect(theirs.json<MatrixBody>().version).toBe(0);
      expect(cell(theirs.json<MatrixBody>(), 'reports.view', 'agent').value).toBe('none');
      const theirAgent = await server.get('/auth/me', { authorization: await agentSession(fx.b) });
      expect(
        theirAgent.json<{ capabilities: Record<string, string> }>().capabilities['reports.view'],
      ).toBe('none');
      expect(await version(fx.b)).toBe(0);

      // Under RLS, from B's side: A's row is invisible, and one cannot be
      // planted in A's matrix.
      await withTenant(appRole, tenantOf(fx.b), async (tx) => {
        expect(await tx.roleCapabilityOverride.findMany()).toEqual([]);
      });
      await expect(
        withTenant(appRole, tenantOf(fx.b), (tx) =>
          tx.roleCapabilityOverride.create({
            data: {
              licenseId: fx.a.licenseId,
              role: 'agent',
              capability: 'billing.manage',
              value: 'on',
            },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        withTenant(appRole, tenantOf(fx.b), (tx) =>
          tx.roleCapabilityOverride.updateMany({
            where: { licenseId: fx.a.licenseId },
            data: { value: 'none' },
          }),
        ),
      ).resolves.toEqual({ count: 0 });
      expect((await storedRows(fx.a)).map((r) => r.value)).toEqual(['all']);

      // B's Founder changes only B.
      await put(await ownerSession(fx.b), [
        { role: 'agent', capability: 'chats.view', value: 'own' },
      ]);
      expect(await version(fx.a)).toBe(1);
      expect((await storedRows(fx.a)).map((r) => r.capability)).toEqual(['reports.view']);
    });
  });
});
