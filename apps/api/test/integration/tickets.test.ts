/**
 * Tickets — the asynchronous half of the inbox (PRD FR-MOD-02.1.3, 02.6).
 *
 * The rule doing the most work here is "one unresolved ticket per chat". It is
 * a partial unique index rather than a service check, so the test that matters
 * is the concurrent one: an application-level check is precisely what two
 * simultaneous requests slip between, and the failure mode — the same follow-up
 * split across two tickets, one of which nobody opens — is invisible until a
 * customer asks why nobody got back to them.
 *
 * After that, visibility. A ticket carries its own assignee and team, so the
 * chat module's access rules do not automatically apply and have to be proven
 * again from scratch.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ADMIN = ['tickets--all:rw', 'tickets--all:ro', 'chats--all:rw', 'customers:ro'];
const SCOPED_AGENT = ['tickets--access:rw', 'tickets--access:ro', 'chats--access:rw'];

describe('tickets', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  let adminToken: string;
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

    // The ordinary agent belongs to Support only, so "sees Sales tickets" is a
    // real question rather than a vacuous one.
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

  async function createTicket(token: string, body: Record<string, unknown>) {
    return server.post('/tickets', body, auth(token));
  }

  async function startChat(token: string, groupIds?: number[]) {
    const response = await server.post(
      '/chats',
      {
        customer_id: fx.a.customerId,
        ...(groupIds ? { group_ids: groupIds } : {}),
      },
      auth(token),
    );
    expect([200, 201]).toContain(response.statusCode);
    return response.json() as { id: string };
  }

  // =========================================================================
  // One unresolved ticket per chat
  // =========================================================================

  describe('one unresolved ticket per chat', () => {
    it('refuses a second ticket and points at the first', async () => {
      const chat = await startChat(adminToken);

      const first = await createTicket(adminToken, {
        subject: 'Refund not received',
        source_chat_id: chat.id,
      });
      expect(first.statusCode).toBe(201);
      const firstId = (first.json() as { id: string }).id;

      const second = await createTicket(adminToken, {
        subject: 'Refund not received (again)',
        source_chat_id: chat.id,
      });
      expect(second.statusCode).toBe(409);

      const error = second.json() as {
        error: { type: string; details?: { existing_ticket_id?: string } };
      };
      expect(error.error.type).toBe('ticket_exists');
      // The id is what lets the UI offer "open the existing one" instead of a
      // dead end.
      expect(error.error.details?.existing_ticket_id).toBe(firstId);
    });

    it('survives concurrent creation', async () => {
      const chat = await startChat(adminToken);

      const attempts = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          createTicket(adminToken, { subject: `Attempt ${i}`, source_chat_id: chat.id }),
        ),
      );

      const created = attempts.filter((r) => r.statusCode === 201);
      const conflicted = attempts.filter((r) => r.statusCode === 409);
      expect(created).toHaveLength(1);
      expect(conflicted).toHaveLength(5);

      const stored = await owner.ticket.count({ where: { sourceChatId: chat.id } });
      expect(stored).toBe(1);
    });

    it('allows a new ticket once the previous one is solved', async () => {
      const chat = await startChat(adminToken);
      const first = await createTicket(adminToken, {
        subject: 'First contact',
        source_chat_id: chat.id,
      });
      const firstId = (first.json() as { id: string }).id;

      await server.patch(`/tickets/${firstId}`, { status: 'solved' }, auth(adminToken));

      // A customer who comes back months later legitimately earns a new ticket.
      const second = await createTicket(adminToken, {
        subject: 'Came back about the same order',
        source_chat_id: chat.id,
      });
      expect(second.statusCode).toBe(201);
    });

    it('does not constrain standalone tickets', async () => {
      // The index is scoped to `source_chat_id IS NOT NULL`; two tickets for the
      // same customer with no chat behind them are ordinary.
      for (const subject of ['Invoice query', 'Address change']) {
        const response = await createTicket(adminToken, {
          subject,
          customer_id: fx.a.customerId,
        });
        expect(response.statusCode).toBe(201);
      }
    });
  });

  // =========================================================================
  // Creating from a chat
  // =========================================================================

  describe('creating from a chat', () => {
    it('carries the customer and team across', async () => {
      const chat = await startChat(adminToken, [Number(salesGroupId)]);

      const response = await createTicket(adminToken, {
        subject: 'Follow up on pricing',
        source_chat_id: chat.id,
      });

      expect(response.statusCode).toBe(201);
      const ticket = response.json() as {
        customer_id: string;
        group_id: number;
        source_chat: { id: string } | null;
      };
      expect(ticket.customer_id).toBe(fx.a.customerId);
      expect(ticket.group_id).toBe(Number(salesGroupId));
      // The transcript context an agent picking this up would otherwise hunt for.
      expect(ticket.source_chat?.id).toBe(chat.id);
    });

    it("reports another tenant's chat as absent, not forbidden", async () => {
      const chat = await startChat(adminToken);

      const response = await createTicket(otherTenantToken, {
        subject: 'Fishing',
        source_chat_id: chat.id,
      });

      // 403 would confirm the id is real and make short ids enumerable (NFR-S5).
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error: { type: string } }).error.type).toBe('not_found');
    });

    it('refuses a chat the caller cannot see', async () => {
      // Started in Sales; the ordinary agent is only in Support.
      const chat = await startChat(adminToken, [Number(salesGroupId)]);

      const response = await createTicket(agentToken, {
        subject: 'Peeking',
        source_chat_id: chat.id,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // =========================================================================
  // Assignment
  // =========================================================================

  describe('assignment', () => {
    it('refuses an agent from another licence', async () => {
      const response = await createTicket(adminToken, {
        subject: 'Misrouted',
        customer_id: fx.a.customerId,
        assignee_id: fx.b.ownerAccountId,
      });

      // Nothing in the schema stops this — `assignee_id` has no foreign key —
      // so it would be stored happily and sit in a queue nobody reads.
      expect(response.statusCode).toBe(400);
    });

    it('refuses a suspended agent', async () => {
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });

      const response = await createTicket(adminToken, {
        subject: 'To someone who cannot sign in',
        customer_id: fx.a.customerId,
        assignee_id: fx.a.agentAccountId,
      });
      expect(response.statusCode).toBe(400);
    });

    it('refuses a team from another licence', async () => {
      const foreign = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Their team' },
        select: { id: true },
      });

      const response = await createTicket(adminToken, {
        subject: 'Misrouted team',
        customer_id: fx.a.customerId,
        group_id: Number(foreign.id),
      });
      expect(response.statusCode).toBe(400);
    });

    it('clears the assignee with an explicit null, and leaves it alone when absent', async () => {
      const created = await createTicket(adminToken, {
        subject: 'Assigned then unassigned',
        customer_id: fx.a.customerId,
        assignee_id: fx.a.agentAccountId,
      });
      const id = (created.json() as { id: string }).id;

      // Absent key: assignment survives an unrelated edit.
      const renamed = await server.patch(
        `/tickets/${id}`,
        { subject: 'Renamed' },
        auth(adminToken),
      );
      expect((renamed.json() as { assignee_id: string | null }).assignee_id).toBe(
        fx.a.agentAccountId,
      );

      const cleared = await server.patch(`/tickets/${id}`, { assignee_id: null }, auth(adminToken));
      expect((cleared.json() as { assignee_id: string | null }).assignee_id).toBeNull();
    });
  });

  // =========================================================================
  // Visibility
  // =========================================================================

  describe('visibility', () => {
    it('shows a scoped agent only their team and their own tickets', async () => {
      await createTicket(adminToken, {
        subject: 'Sales work',
        customer_id: fx.a.customerId,
        group_id: Number(salesGroupId),
      });
      await createTicket(adminToken, {
        subject: 'Support work',
        customer_id: fx.a.customerId,
        group_id: Number(supportGroupId),
      });
      await createTicket(adminToken, {
        subject: 'Personally mine',
        customer_id: fx.a.customerId,
        assignee_id: fx.a.agentAccountId,
      });

      const response = await server.get('/tickets?limit=100', auth(agentToken));
      const body = response.json() as { items: Array<{ subject: string }>; total: number };
      const subjects = body.items.map((t) => t.subject).sort();

      expect(subjects).toEqual(['Personally mine', 'Support work']);
      // The count has to agree with the filter, or the UI shows "3 tickets"
      // above a list of two.
      expect(body.total).toBe(2);
    });

    it('reflects team removal immediately', async () => {
      await createTicket(adminToken, {
        subject: 'Support work',
        customer_id: fx.a.customerId,
        group_id: Number(supportGroupId),
      });

      await owner.groupAgent.deleteMany({
        where: { groupId: supportGroupId, agentId: fx.a.agentAccountId },
      });

      // Read from the database each request, not trusted from the token —
      // otherwise access lingers until the token next rotates.
      const response = await server.get('/tickets?limit=100', auth(agentToken));
      expect((response.json() as { items: unknown[] }).items).toHaveLength(0);
    });

    it('hides a single ticket the caller may not see, as 404', async () => {
      const created = await createTicket(adminToken, {
        subject: 'Sales only',
        customer_id: fx.a.customerId,
        group_id: Number(salesGroupId),
      });
      const id = (created.json() as { id: string }).id;

      expect((await server.get(`/tickets/${id}`, auth(agentToken))).statusCode).toBe(404);
      expect((await server.get(`/tickets/${id}`, auth(otherTenantToken))).statusCode).toBe(404);
    });

    it("never lists another tenant's tickets", async () => {
      await createTicket(adminToken, { subject: 'Ours', customer_id: fx.a.customerId });

      const response = await server.get('/tickets?limit=100', auth(otherTenantToken));
      expect(response.statusCode).toBe(200);
      expect((response.json() as { items: unknown[] }).items).toHaveLength(0);
    });

    it('refuses a customer token outright', async () => {
      const tokenResponse = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, customer_id: fx.a.customerId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const { token } = tokenResponse.json() as { token: string };

      // Tickets are internal. The service has no customer branch at all, so
      // this cannot later widen by accident.
      const response = await server.get('/tickets', auth(token));
      expect([401, 403, 404]).toContain(response.statusCode);
    });
  });

  // =========================================================================
  // Views and ordering
  // =========================================================================

  describe('views and ordering', () => {
    it('filters each view to what its name promises', async () => {
      await createTicket(adminToken, { subject: 'Nobody has this', customer_id: fx.a.customerId });
      const mine = await createTicket(adminToken, {
        subject: 'Mine and open',
        customer_id: fx.a.customerId,
        assignee_id: fx.a.ownerAccountId,
      });
      const done = await createTicket(adminToken, {
        subject: 'Finished',
        customer_id: fx.a.customerId,
        assignee_id: fx.a.ownerAccountId,
      });
      await server.patch(
        `/tickets/${(done.json() as { id: string }).id}`,
        { status: 'solved' },
        auth(adminToken),
      );

      const subjectsFor = async (view: string) => {
        const response = await server.get(`/tickets?view=${view}&limit=100`, auth(adminToken));
        return (response.json() as { items: Array<{ subject: string }> }).items.map(
          (t) => t.subject,
        );
      };

      expect(await subjectsFor('unassigned')).toEqual(['Nobody has this']);
      expect(await subjectsFor('my_open')).toEqual(['Mine and open']);
      expect(await subjectsFor('solved')).toEqual(['Finished']);
      expect((await subjectsFor('all')).sort()).toEqual([
        'Finished',
        'Mine and open',
        'Nobody has this',
      ]);

      // A solved ticket leaves `my_open` but is not deleted.
      expect(await subjectsFor('my_open')).not.toContain('Finished');
      void mine;
    });

    it('paginates without dropping or repeating a ticket', async () => {
      const total = 11;
      for (let i = 0; i < total; i++) {
        const response = await createTicket(adminToken, {
          subject: `Ticket ${String(i).padStart(2, '0')}`,
          customer_id: fx.a.customerId,
        });
        expect(response.statusCode).toBe(201);
      }

      const seen: string[] = [];
      let pageId: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const url = `/tickets?limit=4${pageId ? `&page_id=${encodeURIComponent(pageId)}` : ''}`;
        const body = (await server.get(url, auth(adminToken))).json() as {
          items: Array<{ id: string }>;
          total: number;
          next_page_id?: string;
        };
        expect(body.total).toBe(total);
        seen.push(...body.items.map((t) => t.id));
        if (!body.next_page_id) break;
        pageId = body.next_page_id;
      }

      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    });

    it('puts the most recently active ticket first', async () => {
      const older = await createTicket(adminToken, {
        subject: 'Older',
        customer_id: fx.a.customerId,
      });
      await createTicket(adminToken, { subject: 'Newer', customer_id: fx.a.customerId });

      // Touching the old one makes it the most recent activity.
      await server.patch(
        `/tickets/${(older.json() as { id: string }).id}`,
        { status: 'pending' },
        auth(adminToken),
      );

      const body = (await server.get('/tickets?limit=100', auth(adminToken))).json() as {
        items: Array<{ subject: string }>;
      };
      expect(body.items[0]?.subject).toBe('Older');
    });

    it('searches subject and customer', async () => {
      await createTicket(adminToken, {
        subject: 'Broken widget',
        customer_id: fx.a.customerId,
      });
      await createTicket(adminToken, { subject: 'Something else', customer_id: fx.a.customerId });

      const body = (await server.get('/tickets?query=broken', auth(adminToken))).json() as {
        items: Array<{ subject: string }>;
      };
      expect(body.items.map((t) => t.subject)).toEqual(['Broken widget']);
    });
  });

  // =========================================================================
  // Validation and knock-on effects
  // =========================================================================

  describe('validation', () => {
    it('refuses a blank subject', async () => {
      const response = await createTicket(adminToken, {
        subject: '   ',
        customer_id: fx.a.customerId,
      });
      expect(response.statusCode).toBe(400);
    });

    it('requires a chat or a customer', async () => {
      const response = await createTicket(adminToken, { subject: 'Orphan' });
      expect(response.statusCode).toBe(400);
    });

    it('refuses an unknown status', async () => {
      const response = await createTicket(adminToken, {
        subject: 'Bad status',
        customer_id: fx.a.customerId,
        status: 'urgent',
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects a read-only token for writes', async () => {
      const readOnly = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['tickets--all:ro'],
      });

      expect(
        (await createTicket(readOnly, { subject: 'Nope', customer_id: fx.a.customerId }))
          .statusCode,
      ).toBe(403);
      expect((await server.get('/tickets', auth(readOnly))).statusCode).toBe(200);
    });
  });

  describe('knock-on effects', () => {
    it('makes the customer ticket count non-zero', async () => {
      // Before this module existed the field was structurally always 0, and
      // looked authoritative doing it.
      const before = (
        await server.get(`/customers/${fx.a.customerId}`, auth(adminToken))
      ).json() as {
        tickets_count: number;
      };
      expect(before.tickets_count).toBe(0);

      await createTicket(adminToken, { subject: 'Counted', customer_id: fx.a.customerId });

      const after = (
        await server.get(`/customers/${fx.a.customerId}`, auth(adminToken))
      ).json() as {
        tickets_count: number;
      };
      expect(after.tickets_count).toBe(1);
    });

    it('counts tickets in the reports total_cases figure', async () => {
      const reportToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read', 'tickets--all:rw'],
      });

      const before = (await server.get('/reports/overview', auth(reportToken))).json() as {
        totals: { chats: number; tickets: number; total_cases: number };
      };

      await createTicket(reportToken, { subject: 'In the report', customer_id: fx.a.customerId });

      const after = (await server.get('/reports/overview', auth(reportToken))).json() as {
        totals: { chats: number; tickets: number; total_cases: number };
      };

      expect(after.totals.tickets).toBe(before.totals.tickets + 1);
      // PRD §3.3: total cases is chats plus tickets.
      expect(after.totals.total_cases).toBe(after.totals.chats + after.totals.tickets);
    });
  });
});
