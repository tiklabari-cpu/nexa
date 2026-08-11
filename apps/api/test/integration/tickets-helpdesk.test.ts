/**
 * HelpDesk layer on the ticket core (FR-MOD-13.6 · task 13.6-a).
 *
 * The ticket core (slice 11) proved create/list/get/update, visibility and the
 * "one unresolved ticket per chat" rule. This file proves the omnichannel
 * HelpDesk layer added on top: merge/unmerge with its data-integrity invariants,
 * followers, priority, and that every one of those writes the append-only audit
 * trail. The merge is the reason this slice is `[MAX]` — a merge that could not
 * be cleanly undone, or that let two tickets point at each other, is a data
 * corruption you only notice once a customer's follow-up has vanished.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ADMIN = ['tickets--all:rw', 'tickets--all:ro'];
const READONLY = ['tickets--all:ro'];

describe('tickets — HelpDesk layer (merge/followers/priority)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  let adminToken: string;
  let readonlyToken: string;
  let otherTenantToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
      scopes: ADMIN,
    });
    readonlyToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: READONLY,
    });
    otherTenantToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ADMIN,
    });
  });

  /** Create a standalone ticket (no chat, so no one-per-chat constraint). */
  async function makeTicket(token: string, subject: string, customerId = fx.a.customerId) {
    const response = await server.post(
      '/tickets',
      { subject, customer_id: customerId },
      auth(token),
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  }

  async function auditEntries(licenseId: bigint, action: string) {
    return owner.auditLogEntry.findMany({ where: { licenseId, action } });
  }

  // =========================================================================
  // Merge / unmerge invariant — the headline of this slice
  // =========================================================================

  describe('merge / unmerge', () => {
    it('folds the secondary under the primary and audits it', async () => {
      const primary = await makeTicket(adminToken, 'Broken checkout');
      const secondary = await makeTicket(adminToken, 'Also broken checkout');

      const merge = await server.post(
        `/tickets/${secondary.id}/merge`,
        { into: primary.id },
        auth(adminToken),
      );
      expect(merge.statusCode, merge.body).toBe(200);
      expect(merge.json()).toMatchObject({ id: secondary.id, merged_into_id: primary.id });

      // The secondary drops out of the lists...
      const list = await server.get('/tickets?view=all', auth(adminToken));
      const ids = (list.json() as { items: Array<{ id: string }> }).items.map((t) => t.id);
      expect(ids).toContain(primary.id);
      expect(ids).not.toContain(secondary.id);

      // ...and reappears under the primary's children.
      const primaryDetail = await server.get(`/tickets/${primary.id}`, auth(adminToken));
      expect((primaryDetail.json() as { merged_ticket_ids: string[] }).merged_ticket_ids).toEqual([
        secondary.id,
      ]);

      const audits = await auditEntries(fx.a.licenseId, 'ticket.merged');
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        target: `ticket:${secondary.id}`,
        metadata: { into: primary.id },
      });
    });

    it('unmerge is an exact inverse — the ticket returns and the primary empties', async () => {
      const primary = await makeTicket(adminToken, 'Primary');
      const secondary = await makeTicket(adminToken, 'Secondary');
      await server.post(`/tickets/${secondary.id}/merge`, { into: primary.id }, auth(adminToken));

      const unmerge = await server.del(`/tickets/${secondary.id}/merge`, auth(adminToken));
      expect(unmerge.statusCode, unmerge.body).toBe(200);
      expect((unmerge.json() as { merged_into_id: string | null }).merged_into_id).toBeNull();

      // Back in the list, and the primary has no children again.
      const list = await server.get('/tickets?view=all', auth(adminToken));
      const ids = (list.json() as { items: Array<{ id: string }> }).items.map((t) => t.id);
      expect(ids).toContain(secondary.id);

      const primaryDetail = await server.get(`/tickets/${primary.id}`, auth(adminToken));
      expect((primaryDetail.json() as { merged_ticket_ids: string[] }).merged_ticket_ids).toEqual(
        [],
      );

      expect(await auditEntries(fx.a.licenseId, 'ticket.unmerged')).toHaveLength(1);
    });

    it('refuses to merge a ticket into itself', async () => {
      const ticket = await makeTicket(adminToken, 'Lonely');
      const response = await server.post(
        `/tickets/${ticket.id}/merge`,
        { into: ticket.id },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { type: string } }).error.type).toBe('validation');
    });

    it('refuses to merge into a ticket that is itself merged (no chains)', async () => {
      const a = await makeTicket(adminToken, 'A');
      const b = await makeTicket(adminToken, 'B');
      const c = await makeTicket(adminToken, 'C');
      await server.post(`/tickets/${b.id}/merge`, { into: a.id }, auth(adminToken));

      // b is now a secondary of a; merging c into b would make a chain.
      const response = await server.post(
        `/tickets/${c.id}/merge`,
        { into: b.id },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('refuses to merge a ticket that already has tickets merged into it', async () => {
      const a = await makeTicket(adminToken, 'A');
      const b = await makeTicket(adminToken, 'B');
      const c = await makeTicket(adminToken, 'C');
      await server.post(`/tickets/${b.id}/merge`, { into: a.id }, auth(adminToken));

      // a is a primary; it cannot itself become a secondary of c.
      const response = await server.post(
        `/tickets/${a.id}/merge`,
        { into: c.id },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('refuses to merge an already-merged ticket again', async () => {
      const a = await makeTicket(adminToken, 'A');
      const b = await makeTicket(adminToken, 'B');
      const c = await makeTicket(adminToken, 'C');
      await server.post(`/tickets/${b.id}/merge`, { into: a.id }, auth(adminToken));

      const response = await server.post(
        `/tickets/${b.id}/merge`,
        { into: c.id },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('cannot merge across tenants — the other tenant’s ticket is 404', async () => {
      const mine = await makeTicket(adminToken, 'Mine');
      const theirs = await makeTicket(otherTenantToken, 'Theirs', fx.b.customerId);

      const response = await server.post(
        `/tickets/${mine.id}/merge`,
        { into: theirs.id },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(404);

      // And no merge, no audit row leaked into either tenant.
      expect(await auditEntries(fx.a.licenseId, 'ticket.merged')).toHaveLength(0);
    });

    it('refuses to edit a merged ticket until it is unmerged', async () => {
      const primary = await makeTicket(adminToken, 'Primary');
      const secondary = await makeTicket(adminToken, 'Secondary');
      await server.post(`/tickets/${secondary.id}/merge`, { into: primary.id }, auth(adminToken));

      const patch = await server.patch(
        `/tickets/${secondary.id}`,
        { status: 'pending' },
        auth(adminToken),
      );
      expect(patch.statusCode).toBe(400);
    });

    it('requires a write scope', async () => {
      const primary = await makeTicket(adminToken, 'Primary');
      const secondary = await makeTicket(adminToken, 'Secondary');
      const response = await server.post(
        `/tickets/${secondary.id}/merge`,
        { into: primary.id },
        auth(readonlyToken),
      );
      expect(response.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // Followers
  // =========================================================================

  describe('followers', () => {
    it('adds and removes a follower, auditing each, and is idempotent', async () => {
      const ticket = await makeTicket(adminToken, 'Watch me');

      const add = await server.post(
        `/tickets/${ticket.id}/followers`,
        { account_id: fx.a.agentAccountId },
        auth(adminToken),
      );
      expect(add.statusCode, add.body).toBe(200);
      expect((add.json() as { followers: Array<{ account_id: string }> }).followers).toEqual([
        { account_id: fx.a.agentAccountId, name: expect.any(String) },
      ]);

      // Following again is a no-op: no duplicate, no second audit row.
      const again = await server.post(
        `/tickets/${ticket.id}/followers`,
        { account_id: fx.a.agentAccountId },
        auth(adminToken),
      );
      expect(again.statusCode).toBe(200);
      expect((again.json() as { followers: unknown[] }).followers).toHaveLength(1);
      expect(await auditEntries(fx.a.licenseId, 'ticket.follower_added')).toHaveLength(1);

      const remove = await server.del(
        `/tickets/${ticket.id}/followers/${fx.a.agentAccountId}`,
        auth(adminToken),
      );
      expect(remove.statusCode).toBe(200);
      expect((remove.json() as { followers: unknown[] }).followers).toHaveLength(0);
      expect(await auditEntries(fx.a.licenseId, 'ticket.follower_removed')).toHaveLength(1);
    });

    it('rejects a follower who is not a member of the licence', async () => {
      const ticket = await makeTicket(adminToken, 'Watch me');
      // fx.b.agentAccountId is a real account, but in the other tenant.
      const response = await server.post(
        `/tickets/${ticket.id}/followers`,
        { account_id: fx.b.agentAccountId },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('cannot add a follower to another tenant’s ticket', async () => {
      const theirs = await makeTicket(otherTenantToken, 'Theirs', fx.b.customerId);
      const response = await server.post(
        `/tickets/${theirs.id}/followers`,
        { account_id: fx.a.agentAccountId },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // Priority + lifecycle audit
  // =========================================================================

  describe('priority and lifecycle audit', () => {
    it('defaults priority to 0 and records a change', async () => {
      const ticket = await makeTicket(adminToken, 'Normal');
      const detail = await server.get(`/tickets/${ticket.id}`, auth(adminToken));
      expect((detail.json() as { priority: number }).priority).toBe(0);

      const patch = await server.patch(`/tickets/${ticket.id}`, { priority: 50 }, auth(adminToken));
      expect(patch.statusCode, patch.body).toBe(200);
      expect((patch.json() as { priority: number }).priority).toBe(50);

      const audits = await auditEntries(fx.a.licenseId, 'ticket.priority_changed');
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ metadata: { from: 0, to: 50 } });
    });

    it('rejects an out-of-range priority', async () => {
      const ticket = await makeTicket(adminToken, 'Normal');
      const response = await server.patch(
        `/tickets/${ticket.id}`,
        { priority: 9999 },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('audits a status transition but not a no-op', async () => {
      const ticket = await makeTicket(adminToken, 'Lifecycle');

      await server.patch(`/tickets/${ticket.id}`, { status: 'pending' }, auth(adminToken));
      let audits = await auditEntries(fx.a.licenseId, 'ticket.status_changed');
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ metadata: { from: 'open', to: 'pending' } });

      // Setting it to what it already is writes nothing.
      await server.patch(`/tickets/${ticket.id}`, { status: 'pending' }, auth(adminToken));
      audits = await auditEntries(fx.a.licenseId, 'ticket.status_changed');
      expect(audits).toHaveLength(1);
    });
  });
});
