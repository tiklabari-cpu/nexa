/**
 * Role changes and the privilege ceiling (PUT /agents/{agentId}/role, NFR-S12).
 *
 * The endpoint exists so the "rol değişimi" the audit requirement names by hand
 * is a real, producible event — but the reason it is an OPUS-MAX slice is the
 * escalation boundary around it. These tests pin the ceiling *end to end*, as
 * one reasoning unit: who may move whom, how the owner is protected, and that a
 * caller can never grant more power than they hold. The audit proof itself (one
 * `member.role_changed` entry with from/to) lives in audit-log.test.ts; here we
 * prove the guards and that the membership actually moves.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('agent role change (NFR-S12)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Owner-rank caller — enough to move anyone the individual guards allow. */
  let ownerToken: string;

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
      scopes: ['agents--all:rw', 'agents--all:ro'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const setRole = (agentId: string, role: string, token = ownerToken) =>
    server.put(`/agents/${agentId}/role`, { role }, auth(token));

  const roleOf = async (agentId: string, licenseId = fx.a.licenseId) =>
    (await owner.agentMembership.findFirst({ where: { licenseId, agentId } }))?.role;

  const roleChanges = (agentId: string, licenseId = fx.a.licenseId) =>
    owner.auditLogEntry.count({
      where: { licenseId, action: 'member.role_changed', target: `account:${agentId}` },
    });

  /** A second teammate, distinct from the owner, for the guard cases. */
  let seq = 0;
  async function seedTeammate(role: 'admin' | 'team_lead' | 'agent' | 'viceowner') {
    const account = await owner.account.create({
      data: { email: `${role}-${(seq += 1)}-${Date.now()}@example.test`, name: role },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: ['agents--all:rw'],
    });
    return { accountId: account.id, token };
  }

  // ==========================================================================
  // The privilege ceiling — every guard refuses with 403 and writes nothing
  // ==========================================================================

  describe('guards', () => {
    it('refuses an agent-role token even with the scope', async () => {
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--all:rw'],
      });
      const res = await setRole(fx.a.ownerAccountId, 'admin', agentToken);
      expect(res.statusCode).toBe(403);
      expect(await roleOf(fx.a.ownerAccountId)).toBe('owner');
      expect(await roleChanges(fx.a.ownerAccountId)).toBe(0);
    });

    it('does not let an admin change their own role', async () => {
      const admin = await seedTeammate('admin');
      const res = await setRole(admin.accountId, 'agent', admin.token);
      expect(res.statusCode).toBe(403);
      expect(await roleOf(admin.accountId)).toBe('admin');
      expect(await roleChanges(admin.accountId)).toBe(0);
    });

    it("never lets the owner's role be changed", async () => {
      const admin = await seedTeammate('admin');
      const res = await setRole(fx.a.ownerAccountId, 'agent', admin.token);
      expect(res.statusCode).toBe(403);
      expect(await roleOf(fx.a.ownerAccountId)).toBe('owner');
      expect(await roleChanges(fx.a.ownerAccountId)).toBe(0);
    });

    it('refuses to promote anyone to owner — ownership transfer is out of scope', async () => {
      // Even the owner cannot mint a second owner here; this is a transfer, not a
      // role change, and belongs to a separate operation with the last-owner rule.
      const res = await setRole(fx.a.agentAccountId, 'owner');
      expect(res.statusCode).toBe(403);
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
      expect(await roleChanges(fx.a.agentAccountId)).toBe(0);
    });

    it('does not let an admin grant a role above their own rank', async () => {
      const admin = await seedTeammate('admin');
      // agent → viceowner would put the target above the admin: refused.
      const res = await setRole(fx.a.agentAccountId, 'viceowner', admin.token);
      expect(res.statusCode).toBe(403);
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
      expect(await roleChanges(fx.a.agentAccountId)).toBe(0);
    });

    it('does not let an admin change a teammate above their own rank', async () => {
      const admin = await seedTeammate('admin');
      const vice = await seedTeammate('viceowner');
      const res = await setRole(vice.accountId, 'agent', admin.token);
      expect(res.statusCode).toBe(403);
      expect(await roleOf(vice.accountId)).toBe('viceowner');
      expect(await roleChanges(vice.accountId)).toBe(0);
    });

    it('cannot reach an agent in another workspace', async () => {
      // RLS scopes the lookup to tenant A, so B's agent is simply not found — a
      // 404 that keeps ids un-enumerable across tenants (NFR-S5), and no entry is
      // written into either log.
      const res = await setRole(fx.b.agentAccountId, 'admin');
      expect(res.statusCode).toBe(404);
      expect(await roleOf(fx.b.agentAccountId, fx.b.licenseId)).toBe('agent');
      expect(await roleChanges(fx.b.agentAccountId, fx.a.licenseId)).toBe(0);
      expect(await roleChanges(fx.b.agentAccountId, fx.b.licenseId)).toBe(0);
    });

    it('rejects an unknown role value with a 400', async () => {
      const res = await setRole(fx.a.agentAccountId, 'superuser');
      expect(res.statusCode).toBe(400);
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
    });
  });

  // ==========================================================================
  // The change itself — no-op writes nothing, a real move writes exactly one
  // ==========================================================================

  describe('applying the change', () => {
    it('treats a change to the same role as a no-op — 200 and no entry', async () => {
      const res = await setRole(fx.a.agentAccountId, 'agent');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: fx.a.agentAccountId, role: 'agent' });
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
      expect(await roleChanges(fx.a.agentAccountId)).toBe(0);
    });

    it('promotes agent → admin: the membership moves and one entry is written', async () => {
      const res = await setRole(fx.a.agentAccountId, 'admin');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: fx.a.agentAccountId, role: 'admin' });
      expect(await roleOf(fx.a.agentAccountId)).toBe('admin');
      expect(await roleChanges(fx.a.agentAccountId)).toBe(1);
    });

    it('demotes admin → agent as well', async () => {
      const admin = await seedTeammate('admin');
      const res = await setRole(admin.accountId, 'agent');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: admin.accountId, role: 'agent' });
      expect(await roleOf(admin.accountId)).toBe('agent');
      expect(await roleChanges(admin.accountId)).toBe(1);
    });

    it('offers the vice owner to nobody new, the owner included — 400 role_retired (K6)', async () => {
      // It used to be the owner's to grant; its powers are an admin's, and its
      // holders become admins (tm 324.3).
      const res = await setRole(fx.a.agentAccountId, 'viceowner');
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { details: unknown } }).error.details).toEqual({
        reason: 'role_retired',
      });
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
      expect(await roleChanges(fx.a.agentAccountId)).toBe(0);

      // A vice owner who stays one is still a no-op, not a refusal.
      const vice = await seedTeammate('viceowner');
      expect((await setRole(vice.accountId, 'viceowner')).statusCode).toBe(200);
      expect((await setRole(vice.accountId, 'admin')).statusCode).toBe(200);
      expect(await roleOf(vice.accountId)).toBe('admin');
    });
  });

  // ==========================================================================
  // The Team Lead (RL-01 · tm 324.2) — ranked under admin
  // ==========================================================================

  describe('the Team Lead', () => {
    it('is a role an admin assigns and takes back (FR-MOD-04.RBAC)', async () => {
      const admin = await seedTeammate('admin');
      const promoted = await setRole(fx.a.agentAccountId, 'team_lead', admin.token);
      expect(promoted.statusCode, promoted.payload).toBe(200);
      expect(promoted.json()).toMatchObject({ id: fx.a.agentAccountId, role: 'team_lead' });
      expect(await roleOf(fx.a.agentAccountId)).toBe('team_lead');

      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'member.role_changed' },
      });
      expect(entry?.metadata).toMatchObject({ from: 'agent', to: 'team_lead' });
      expect(entry?.metadata).not.toHaveProperty('lead_cleared_group_ids');

      expect((await setRole(fx.a.agentAccountId, 'agent', admin.token)).statusCode).toBe(200);
      expect(await roleChanges(fx.a.agentAccountId)).toBe(2);
    });

    it("changes nobody's role, holding the scope or not (FR-MOD-04.RBAC)", async () => {
      const lead = await seedTeammate('team_lead');
      for (const [target, role] of [
        [fx.a.agentAccountId, 'team_lead'],
        [fx.a.agentAccountId, 'admin'],
        [lead.accountId, 'admin'],
      ] as const) {
        const res = await setRole(target, role, lead.token);
        expect(res.statusCode).toBe(403);
      }
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
      expect(await roleOf(lead.accountId)).toBe('team_lead');
      expect(await roleChanges(fx.a.agentAccountId)).toBe(0);
    });

    it('loses every lead mark with the role, in the same change and its one entry', async () => {
      const lead = await seedTeammate('team_lead');
      const sales = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      });
      const support = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      await owner.groupAgent.createMany({
        data: [
          { licenseId: fx.a.licenseId, groupId: sales.id, agentId: lead.accountId, isLead: true },
          { licenseId: fx.a.licenseId, groupId: support.id, agentId: lead.accountId },
        ],
      });

      const res = await setRole(lead.accountId, 'agent');
      expect(res.statusCode).toBe(200);
      // Still on both teams — a Team Member who no longer leads either.
      const rows = await owner.groupAgent.findMany({
        where: { agentId: lead.accountId },
        select: { groupId: true, isLead: true },
        orderBy: { groupId: 'asc' },
      });
      expect(rows).toEqual([
        { groupId: sales.id, isLead: false },
        { groupId: support.id, isLead: false },
      ]);
      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'member.role_changed' },
      });
      expect(entry?.metadata).toMatchObject({
        from: 'team_lead',
        to: 'agent',
        lead_cleared_group_ids: [Number(sales.id)],
      });
    });
  });
});
