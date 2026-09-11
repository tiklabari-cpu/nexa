/**
 * Bulk actions over a ticket selection (PRD §5.2 "Ticketing (gelişmiş)" ·
 * FR-13-EK.3 · FR-MOD-02.7.1).
 *
 * `POST /tickets/bulk` is the multi-row counterpart of `PATCH /tickets/{id}`,
 * and the whole risk of such an endpoint is that it becomes a cheaper door into
 * a ticket than the single one: a batch write is tempting to do in raw SQL "for
 * speed", and raw SQL is exactly what walks around row level security and the
 * caller's team visibility. So the tests that matter most here are the negative
 * ones — another workspace's ids, and ids this agent cannot see — and they
 * assert the rows are *unchanged*, not merely that the response looked polite.
 *
 * The second theme is partial success. The endpoint answers 200 when some rows
 * were skipped, which is a decision that has to be pinned from both sides: the
 * skipped row must be reported by name and reason, and the rows that succeeded
 * must still be written. A test that only checked the status code would pass
 * against an all-or-nothing implementation and against a silent one alike.
 */
import type { PrismaClient } from '@prisma/client';
import { generateShortId, TICKET_BULK_MAX } from '@nexa/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import { TicketService } from '../../src/services/tickets/ticket-service.js';
import type { Principal } from '../../src/services/auth/principal.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ADMIN = ['tickets--all:rw', 'tickets--all:ro'];
const READONLY = ['tickets--all:ro'];
const SCOPED_AGENT = ['tickets--access:rw', 'tickets--access:ro'];

const CHAIN_SECRET = testEnv().AUDIT_CHAIN_SECRET;

interface BulkRow {
  ticket_id: string;
  status: 'updated' | 'skipped';
  reason: string | null;
}
interface BulkReport {
  updated: number;
  failed: number;
  results: BulkRow[];
}

describe('tickets — bulk actions (FR-13-EK.3)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  let adminToken: string;
  let readonlyToken: string;
  let agentToken: string;
  let otherTenantToken: string;
  let supportGroupId: bigint;
  let salesGroupId: bigint;

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

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const sales = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Sales' },
      select: { id: true },
    });
    supportGroupId = support.id;
    salesGroupId = sales.id;

    // The scoped agent belongs to Support only, so "can this selection reach a
    // Sales ticket" is a real question rather than a vacuous one.
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });

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
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: SCOPED_AGENT,
    });
    otherTenantToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ADMIN,
    });
  });

  /**
   * Seed a ticket straight into the database. The write path is not what these
   * tests are about, and `POST /tickets` fires the ticket rules, which would put
   * a second author on the rows the assertions below read.
   */
  async function seedTicket(
    licenseId: bigint,
    subject: string,
    extra: {
      status?: string;
      priority?: number;
      assigneeId?: string | null;
      groupId?: bigint | null;
      customerId?: string;
    } = {},
  ): Promise<string> {
    const id = generateShortId();
    await owner.ticket.create({
      data: {
        id,
        licenseId,
        subject,
        status: extra.status ?? 'open',
        priority: extra.priority ?? 0,
        assigneeId: extra.assigneeId ?? null,
        groupId: extra.groupId ?? null,
        customerId: extra.customerId ?? null,
        lastMessageAt: new Date('2026-09-01T09:00:00.000Z'),
      },
    });
    return id;
  }

  const bulk = (token: string, body: Record<string, unknown>) =>
    server.post('/tickets/bulk', body, auth(token));

  const statusOf = async (id: string): Promise<string | null> =>
    (await owner.ticket.findUnique({ where: { id }, select: { status: true } }))?.status ?? null;

  const auditEntries = (action: string, licenseId = fx.a.licenseId) =>
    owner.auditLogEntry.findMany({ where: { licenseId, action } });

  // =========================================================================
  // The happy path, and the report's shape
  // =========================================================================

  describe('applying one change to a selection', () => {
    it('writes every named ticket and reports each one', async () => {
      const ids = [
        await seedTicket(fx.a.licenseId, 'One'),
        await seedTicket(fx.a.licenseId, 'Two'),
        await seedTicket(fx.a.licenseId, 'Three'),
      ];

      const response = await bulk(adminToken, { ticket_ids: ids, status: 'solved' });
      expect(response.statusCode, response.body).toBe(200);

      const report = response.json() as BulkReport;
      expect(report).toMatchObject({ updated: 3, failed: 0 });
      // Request order, so a console can line the report up against the rows the
      // agent ticked without sorting anything.
      expect(report.results.map((row) => row.ticket_id)).toEqual(ids);
      expect(report.results.every((row) => row.status === 'updated' && row.reason === null)).toBe(
        true,
      );

      for (const id of ids) expect(await statusOf(id)).toBe('solved');
    });

    it('leaves a field alone when its key is absent, and clears it on an explicit null', async () => {
      const assigned = await seedTicket(fx.a.licenseId, 'Assigned', {
        assigneeId: fx.a.agentAccountId,
      });

      // Absent key: a priority sweep must not quietly unassign the queue.
      await bulk(adminToken, { ticket_ids: [assigned], priority: 50 });
      expect(
        await owner.ticket.findUnique({
          where: { id: assigned },
          select: { assigneeId: true, priority: true },
        }),
      ).toMatchObject({ assigneeId: fx.a.agentAccountId, priority: 50 });

      await bulk(adminToken, { ticket_ids: [assigned], assignee_id: null });
      expect(
        (await owner.ticket.findUnique({ where: { id: assigned }, select: { assigneeId: true } }))
          ?.assigneeId,
      ).toBeNull();
    });
  });

  // =========================================================================
  // Partial success — the decision this endpoint is built around
  // =========================================================================

  describe('partial success', () => {
    it('skips a merged ticket by name and still writes the rest', async () => {
      const primary = await seedTicket(fx.a.licenseId, 'Primary');
      const secondary = await seedTicket(fx.a.licenseId, 'Secondary');
      const merge = await server.post(
        `/tickets/${secondary}/merge`,
        { into: primary },
        auth(adminToken),
      );
      expect(merge.statusCode, merge.body).toBe(200);

      const other = await seedTicket(fx.a.licenseId, 'Untouched by the merge');

      const response = await bulk(adminToken, {
        ticket_ids: [secondary, other],
        status: 'solved',
      });
      // A skipped row is not an error envelope: the request was understood.
      expect(response.statusCode, response.body).toBe(200);

      const report = response.json() as BulkReport;
      expect(report).toMatchObject({ updated: 1, failed: 1 });
      expect(report.results).toEqual([
        { ticket_id: secondary, status: 'skipped', reason: 'merged' },
        { ticket_id: other, status: 'updated', reason: null },
      ]);

      // The two halves of the assertion that all-or-nothing would fail: the
      // skipped row is untouched, and the successful one is NOT rolled back.
      expect(await statusOf(secondary)).toBe('open');
      expect(await statusOf(other)).toBe('solved');
    });

    it('reports an id that never existed as not_found, without inventing a row', async () => {
      const real = await seedTicket(fx.a.licenseId, 'Real');
      const ghost = generateShortId();

      const report = (
        await bulk(adminToken, { ticket_ids: [ghost, real], priority: 50 })
      ).json() as BulkReport;

      expect(report).toMatchObject({ updated: 1, failed: 1 });
      expect(report.results[0]).toEqual({
        ticket_id: ghost,
        status: 'skipped',
        reason: 'not_found',
      });
      expect(await owner.ticket.findUnique({ where: { id: ghost } })).toBeNull();
    });
  });

  // =========================================================================
  // Tenant isolation and visibility — the negatives
  // =========================================================================

  describe('isolation', () => {
    it("never touches another workspace's tickets, and does not admit they exist", async () => {
      const ours = await seedTicket(fx.a.licenseId, 'Ours');
      const theirs = await seedTicket(fx.b.licenseId, 'Theirs');

      const report = (
        await bulk(adminToken, { ticket_ids: [ours, theirs], status: 'closed' })
      ).json() as BulkReport;

      // `not_found` and not a `forbidden` verdict: telling the two apart would
      // confirm that the id is a real ticket somewhere (NFR-S5).
      expect(report.results).toEqual([
        { ticket_id: ours, status: 'updated', reason: null },
        { ticket_id: theirs, status: 'skipped', reason: 'not_found' },
      ]);

      expect(await statusOf(ours)).toBe('closed');
      // The assertion the whole file exists for: row level security means the
      // foreign row is not merely unreported, it is unwritten.
      expect(await statusOf(theirs)).toBe('open');
    });

    it('refuses a ticket outside the calling agent’s teams, and leaves it as it was', async () => {
      const salesTicket = await seedTicket(fx.a.licenseId, 'Sales only', {
        groupId: salesGroupId,
      });
      const supportTicket = await seedTicket(fx.a.licenseId, 'Support', {
        groupId: supportGroupId,
      });

      const report = (
        await bulk(agentToken, { ticket_ids: [salesTicket, supportTicket], status: 'pending' })
      ).json() as BulkReport;

      expect(report).toMatchObject({ updated: 1, failed: 1 });
      expect(report.results[0]).toEqual({
        ticket_id: salesTicket,
        status: 'skipped',
        reason: 'not_found',
      });

      // Same visibility rule as `GET /tickets/{id}`, and enforced on the write:
      // a bulk sweep is not a way to edit a queue you cannot read.
      expect(await statusOf(salesTicket)).toBe('open');
      expect(await statusOf(supportTicket)).toBe('pending');
    });

    it('refuses a read-only token before anything is written', async () => {
      const ticket = await seedTicket(fx.a.licenseId, 'Not yours to change');

      const response = await bulk(readonlyToken, { ticket_ids: [ticket], status: 'solved' });
      expect(response.statusCode).toBe(403);
      expect(await statusOf(ticket)).toBe('open');
    });

    it('refuses a customer token outright', async () => {
      const ticket = await seedTicket(fx.a.licenseId, 'Internal work');
      const tokenResponse = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, customer_id: fx.a.customerId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const { token } = tokenResponse.json() as { token: string };

      const response = await bulk(token, { ticket_ids: [ticket], status: 'solved' });
      expect([401, 403, 404]).toContain(response.statusCode);
      expect(await statusOf(ticket)).toBe('open');
    });

    it('never lets one tenant’s bulk write show up in another’s', async () => {
      const theirs = await seedTicket(fx.b.licenseId, 'Theirs');
      const ours = await seedTicket(fx.a.licenseId, 'Ours');

      await bulk(otherTenantToken, { ticket_ids: [theirs, ours], priority: 100 });

      expect(
        (await owner.ticket.findUnique({ where: { id: ours }, select: { priority: true } }))
          ?.priority,
      ).toBe(0);
    });
  });

  // =========================================================================
  // The request itself
  // =========================================================================

  describe('validation', () => {
    it('refuses more ids than one action may hold', async () => {
      const ids = Array.from({ length: TICKET_BULK_MAX + 1 }, () => generateShortId());
      const response = await bulk(adminToken, { ticket_ids: ids, status: 'solved' });
      expect(response.statusCode).toBe(400);
    });

    it('accepts exactly the ceiling', async () => {
      // The boundary matters on this side too: the console's "select the whole
      // page" gesture is sized from the same constant, so a server that refused
      // 50 would 400 on the flagship action.
      const ids = await Promise.all(
        Array.from({ length: TICKET_BULK_MAX }, (_, i) =>
          seedTicket(fx.a.licenseId, `Page row ${String(i)}`),
        ),
      );
      const response = await bulk(adminToken, { ticket_ids: ids, status: 'solved' });
      expect(response.statusCode, response.body).toBe(200);
      expect((response.json() as BulkReport).updated).toBe(TICKET_BULK_MAX);
    });

    it('refuses a duplicate id rather than applying it twice', async () => {
      const ticket = await seedTicket(fx.a.licenseId, 'Twice');
      const response = await bulk(adminToken, {
        ticket_ids: [ticket, ticket],
        status: 'solved',
      });
      expect(response.statusCode).toBe(400);
      expect(await statusOf(ticket)).toBe('open');
    });

    it('refuses a request that changes nothing', async () => {
      const ticket = await seedTicket(fx.a.licenseId, 'No-op');
      expect((await bulk(adminToken, { ticket_ids: [ticket] })).statusCode).toBe(400);
    });

    it('refuses an empty selection', async () => {
      expect((await bulk(adminToken, { ticket_ids: [], status: 'solved' })).statusCode).toBe(400);
    });

    it('refuses a bad assignment target as a whole request, writing nothing', async () => {
      const ids = [await seedTicket(fx.a.licenseId, 'A'), await seedTicket(fx.a.licenseId, 'B')];

      // An agent from another licence names the *request*, not a row — every
      // row would fail it identically, so the refusal is a 400 and not fifty
      // per-row verdicts.
      const response = await bulk(adminToken, {
        ticket_ids: ids,
        assignee_id: fx.b.ownerAccountId,
      });
      expect(response.statusCode).toBe(400);

      for (const id of ids) {
        expect(
          (await owner.ticket.findUnique({ where: { id }, select: { assigneeId: true } }))
            ?.assigneeId,
        ).toBeNull();
      }
    });

    it('refuses a team from another licence the same way', async () => {
      const ticket = await seedTicket(fx.a.licenseId, 'Misroutable');
      const foreign = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Their team' },
        select: { id: true },
      });

      const response = await bulk(adminToken, {
        ticket_ids: [ticket],
        group_id: Number(foreign.id),
      });
      expect(response.statusCode).toBe(400);
      expect(
        (await owner.ticket.findUnique({ where: { id: ticket }, select: { groupId: true } }))
          ?.groupId,
      ).toBeNull();
    });
  });

  // =========================================================================
  // The audit trail
  // =========================================================================

  describe('audit', () => {
    it('records every ticket that actually changed, one entry each', async () => {
      const ids = [
        await seedTicket(fx.a.licenseId, 'One'),
        await seedTicket(fx.a.licenseId, 'Two'),
        await seedTicket(fx.a.licenseId, 'Three'),
      ];

      await bulk(adminToken, { ticket_ids: ids, status: 'solved' });

      const entries = await auditEntries('ticket.status_changed');
      // Being done in bulk is not a reason to collapse three decisions into one
      // summary line: the trail answers "what happened to THIS ticket", and a
      // ticket with no row of its own has no answer.
      expect(entries).toHaveLength(3);
      expect(entries.map((entry) => entry.target).sort()).toEqual(
        ids.map((id) => `ticket:${id}`).sort(),
      );
      expect(entries[0]).toMatchObject({ metadata: { from: 'open', to: 'solved' } });
    });

    it('writes nothing for a ticket that was already in the target state', async () => {
      const already = await seedTicket(fx.a.licenseId, 'Already solved', { status: 'solved' });
      const open = await seedTicket(fx.a.licenseId, 'Still open');

      await bulk(adminToken, { ticket_ids: [already, open], status: 'solved' });

      // "Solve these fifty" over a queue where forty were already solved must
      // add ten entries, not fifty — an append-only log full of no-ops is a log
      // nobody reads.
      const entries = await auditEntries('ticket.status_changed');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.target).toBe(`ticket:${open}`);
    });

    it('records a reassignment, and records the same thing on the single endpoint', async () => {
      const viaBulk = await seedTicket(fx.a.licenseId, 'Assigned in bulk');
      const viaPatch = await seedTicket(fx.a.licenseId, 'Assigned singly');

      await bulk(adminToken, {
        ticket_ids: [viaBulk],
        assignee_id: fx.a.agentAccountId,
      });
      await server.patch(
        `/tickets/${viaPatch}`,
        { assignee_id: fx.a.agentAccountId },
        auth(adminToken),
      );

      // A trail that says different things about the same product action
      // depending on which control the agent used is not a trail anybody can
      // reason from — both paths go through one writer for exactly this reason.
      const entries = await auditEntries('ticket.assigned');
      expect(entries.map((entry) => entry.target).sort()).toEqual(
        [`ticket:${viaBulk}`, `ticket:${viaPatch}`].sort(),
      );
      for (const entry of entries) {
        expect(entry.metadata).toMatchObject({
          from_assignee: null,
          to_assignee: fx.a.agentAccountId,
        });
      }
    });

    it('leaves no trail for a selection it refused', async () => {
      const theirs = await seedTicket(fx.b.licenseId, 'Theirs');

      await bulk(adminToken, { ticket_ids: [theirs], status: 'solved' });

      expect(await auditEntries('ticket.status_changed')).toHaveLength(0);
      expect(await auditEntries('ticket.status_changed', fx.b.licenseId)).toHaveLength(0);
    });
  });

  // =========================================================================
  // NFR-P2 — the row work does not grow with the selection
  // =========================================================================

  describe('query budget (NFR-P2)', () => {
    /**
     * Count the `ticket` reads and writes one bulk call makes.
     *
     * Driven against the service rather than the route so the proxy can sit on
     * the tenant client itself. What is being pinned is the *shape*: an
     * implementation that loaded or wrote one ticket at a time would pass every
     * other test in this file and quietly turn a fifty-row sweep into a hundred
     * round trips.
     */
    async function ticketCalls(ids: string[]): Promise<string[]> {
      const calls: string[] = [];
      const principal: Principal = {
        kind: 'agent',
        accountId: fx.a.ownerAccountId,
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        role: 'owner',
        scopes: ADMIN,
        tokenId: 'budget-probe',
        tokenKind: 'pat',
      };

      await withTenant(
        owner,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => {
          const counting: Record<string, unknown> = Object.create(tx);
          const delegate = tx.ticket as unknown as Record<string, unknown>;
          counting['ticket'] = new Proxy(delegate, {
            get(target, property) {
              const value = Reflect.get(target, property, target);
              if (typeof value !== 'function' || typeof property !== 'string') return value;
              return (...args: unknown[]) => {
                calls.push(`ticket.${property}`);
                return (value as (...a: unknown[]) => unknown).apply(target, args);
              };
            },
          });

          await new TicketService().bulkUpdate(
            counting as TenantClient,
            { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
            principal,
            { licenseId: fx.a.licenseId, chainSecret: CHAIN_SECRET },
            ids,
            { priority: 50 },
          );
        },
      );

      return calls;
    }

    it('asks the database the same number of times for two tickets as for twelve', async () => {
      const few = await Promise.all(
        Array.from({ length: 2 }, (_, i) => seedTicket(fx.a.licenseId, `Few ${String(i)}`)),
      );
      const many = await Promise.all(
        Array.from({ length: 12 }, (_, i) => seedTicket(fx.a.licenseId, `Many ${String(i)}`)),
      );

      expect(await ticketCalls(few)).toEqual(await ticketCalls(many));
      // And it is the batched shape, not an accidentally equal pair of numbers.
      expect(await ticketCalls(many)).toEqual(['ticket.findMany', 'ticket.updateMany']);
    });
  });
});
