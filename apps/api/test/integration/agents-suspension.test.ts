/**
 * Agent suspension and the Chatbots / Suspended tabs (FR-MOD-04.6).
 *
 * The acceptance criterion is short — "bot account is free; suspend/unsuspend" —
 * but it is really two invariants that must hold *end to end*, not just as a
 * flag flip:
 *
 *   - Suspending an agent stops their sessions and stops routing from assigning
 *     them work, from that moment, without re-issuing any token. The flag lives
 *     on the membership, which every request re-reads.
 *   - A bot is not an agent: it never occupies a billed seat, whereas a
 *     suspended agent frees the one they held.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { RoutingService } from '../../src/services/routing/routing-service.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('agent suspension (FR-MOD-04.6)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;
  let adminToken: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    routing = new RoutingService();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    // Owned by the owner account, so the caller has owner rank — enough to
    // suspend anyone the individual guards allow.
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:rw', 'agents--all:ro', 'billing_manage'],
    });
  });

  const auth = {
    get authorization() {
      return `Bearer ${adminToken}`;
    },
  };

  const suspend = (agentId: string, suspended: boolean, headers = auth) =>
    server.put(`/agents/${agentId}/suspension`, { suspended }, headers);

  // ==========================================================================
  // Listing: the Suspended tab
  // ==========================================================================

  describe('listing', () => {
    it('moves an agent between the active and suspended lists', async () => {
      const active = await server.get('/agents', auth);
      expect(active.statusCode).toBe(200);
      expect(active.json().items.map((a: { id: string }) => a.id)).toContain(fx.a.agentAccountId);
      expect(active.json().items.every((a: { suspended: boolean }) => a.suspended === false)).toBe(
        true,
      );

      const put = await suspend(fx.a.agentAccountId, true);
      expect(put.statusCode).toBe(200);
      expect(put.json()).toMatchObject({ id: fx.a.agentAccountId, suspended: true });

      // Gone from the default (active) list…
      const stillActive = await server.get('/agents', auth);
      expect(stillActive.json().items.map((a: { id: string }) => a.id)).not.toContain(
        fx.a.agentAccountId,
      );

      // …present under the Suspended tab…
      const suspended = await server.get('/agents?status=suspended', auth);
      const suspendedIds = suspended.json().items.map((a: { id: string }) => a.id);
      expect(suspendedIds).toEqual([fx.a.agentAccountId]);

      // …and visible in the combined view alongside the owner.
      const all = await server.get('/agents?status=all', auth);
      expect(
        all
          .json()
          .items.map((a: { id: string }) => a.id)
          .sort(),
      ).toEqual([fx.a.ownerAccountId, fx.a.agentAccountId].sort());
    });

    it('reinstates an agent back to the active list', async () => {
      await suspend(fx.a.agentAccountId, true);
      const put = await suspend(fx.a.agentAccountId, false);
      expect(put.statusCode).toBe(200);
      expect(put.json().suspended).toBe(false);

      const active = await server.get('/agents', auth);
      expect(active.json().items.map((a: { id: string }) => a.id)).toContain(fx.a.agentAccountId);
      const suspended = await server.get('/agents?status=suspended', auth);
      expect(suspended.json().items).toEqual([]);
    });

    it('rejects an unknown status filter', async () => {
      const res = await server.get('/agents?status=nonsense', auth);
      expect(res.statusCode).toBe(400);
    });

    it('records the change in the audit log, once per real transition', async () => {
      await suspend(fx.a.agentAccountId, true);
      await suspend(fx.a.agentAccountId, true); // no-op: already suspended
      await suspend(fx.a.agentAccountId, false);

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, target: `account:${fx.a.agentAccountId}` },
        orderBy: { createdAt: 'asc' },
      });
      expect(entries.map((e) => e.action)).toEqual(['member.suspended', 'member.unsuspended']);
    });
  });

  // ==========================================================================
  // Suspension stops the session
  // ==========================================================================

  describe('sessions', () => {
    it('kills a suspended agent’s existing tokens on their next request', async () => {
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--my:ro'],
      });
      const asAgent = { authorization: `Bearer ${agentToken}` };

      // The very token works before suspension…
      expect((await server.get('/agents', asAgent)).statusCode).toBe(200);

      await suspend(fx.a.agentAccountId, true);

      // …and is refused after, with no re-issue. The membership, not the token,
      // carries the state, and auth re-reads it every request.
      expect((await server.get('/agents', asAgent)).statusCode).toBe(401);
    });
  });

  // ==========================================================================
  // Suspension stops assignment
  // ==========================================================================

  describe('routing', () => {
    it('stops assigning a suspended agent and resumes on reinstatement', async () => {
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: {
          licenseId: fx.a.licenseId,
          groupId: group.id,
          agentId: fx.a.agentAccountId,
          priority: 'normal',
        },
      });

      const decide = () =>
        withTenant(
          owner,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
          (tx) => routing.route(tx, fx.a.licenseId, {}),
        );

      expect((await decide()).assigneeId).toBe(fx.a.agentAccountId);

      await suspend(fx.a.agentAccountId, true);
      const queued = await decide();
      expect(queued.assigneeId).toBeNull();
      expect(queued.reason).toBe('queued');

      await suspend(fx.a.agentAccountId, false);
      expect((await decide()).assigneeId).toBe(fx.a.agentAccountId);
    });
  });

  // ==========================================================================
  // Authorization and guards
  // ==========================================================================

  describe('authorization', () => {
    /** A second admin, distinct from the owner, for the guard cases. */
    async function seedAdmin(): Promise<{ accountId: string; token: string }> {
      const account = await owner.account.create({
        data: { email: `admin-${Date.now()}@example.test`, name: 'Second Admin' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: fx.a.licenseId, agentId: account.id, role: 'admin' },
      });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: account.id,
        scopes: ['agents--all:rw'],
      });
      return { accountId: account.id, token };
    }

    it('refuses an agent-role token even with the scope', async () => {
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--all:rw'],
      });
      const res = await suspend(fx.a.agentAccountId, true, {
        authorization: `Bearer ${agentToken}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('never lets the owner be suspended', async () => {
      const admin = await seedAdmin();
      const res = await suspend(fx.a.ownerAccountId, true, {
        authorization: `Bearer ${admin.token}`,
      });
      expect(res.statusCode).toBe(403);

      const owners = await owner.agentMembership.findFirst({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId },
      });
      expect(owners?.suspended).toBe(false);
    });

    it('does not let an admin suspend themselves', async () => {
      const admin = await seedAdmin();
      const res = await suspend(admin.accountId, true, {
        authorization: `Bearer ${admin.token}`,
      });
      expect(res.statusCode).toBe(403);
    });

    it('does not let an admin suspend someone above their rank', async () => {
      const admin = await seedAdmin();
      const viceOwner = await owner.account.create({
        data: { email: `vice-${Date.now()}@example.test`, name: 'Vice' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: fx.a.licenseId, agentId: viceOwner.id, role: 'viceowner' },
      });
      const res = await suspend(viceOwner.id, true, { authorization: `Bearer ${admin.token}` });
      expect(res.statusCode).toBe(403);
    });

    it('cannot reach an agent in another workspace', async () => {
      // RLS scopes the lookup to tenant A, so B's agent is simply not found —
      // a 404 that keeps ids un-enumerable across tenants (NFR-S5).
      const res = await suspend(fx.b.agentAccountId, true);
      expect(res.statusCode).toBe(404);

      const untouched = await owner.agentMembership.findFirst({
        where: { licenseId: fx.b.licenseId, agentId: fx.b.agentAccountId },
      });
      expect(untouched?.suspended).toBe(false);
    });
  });

  // ==========================================================================
  // Billing: bots are free, suspended agents free their seat
  // ==========================================================================

  describe('billing', () => {
    const seatFloor = async () =>
      (await server.get('/billing/subscription', auth)).json().min_seats as number;

    it('does not charge for a bot — it never occupies a seat', async () => {
      const before = await seatFloor();

      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Nexa Bot', kind: 'ai_agent', active: true },
      });

      expect(await seatFloor()).toBe(before);
    });

    it('frees a seat when an agent is suspended, and reclaims it on reinstatement', async () => {
      const before = await seatFloor();
      expect(before).toBe(2); // owner + agent

      await suspend(fx.a.agentAccountId, true);
      expect(await seatFloor()).toBe(before - 1);

      await suspend(fx.a.agentAccountId, false);
      expect(await seatFloor()).toBe(before);
    });
  });
});
