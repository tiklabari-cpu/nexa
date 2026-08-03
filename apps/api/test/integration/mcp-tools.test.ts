/**
 * MCP tool-call surface — FR-MOD-08.8.3-c. `POST /mcp/tools/{tool}` is the single
 * generic endpoint every catalogued tool is invoked through, and it is the whole
 * security core of the MCP feature: per-tool scope gate, tenant isolation,
 * un-enumerable 404s, and an audit entry that records the call without its
 * arguments.
 *
 * The boundary properties lead, as negatives, because a leak here is silent — a
 * positive test still passes while the surface hands one workspace's tickets to
 * another, or lets a token past a scope it does not hold. Only then the happy
 * path (the `search_tickets` reference tool), the cross-tenant property proven
 * from both licenses, and the audit trail.
 *
 * `search_tickets` (08.8.3-c), `list_chats` (08.8.3-d) and `get_report`
 * (08.8.3-e) are wired in this file; `summarize_chat` arrives in 08.8.3-f, and
 * the end-to-end flow across all four is 08.8.3-h.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

// Both subjects share the search term, so a query that returns another license's
// ticket would be a visible isolation failure rather than a silent one.
const PROBE = 'Isolation probe';
const SUBJECT_A = `${PROBE} A ticket`;
const SUBJECT_B = `${PROBE} B ticket`;

// Two chats in license A (for the list_chats pagination test) and one in B
// (for isolation). VARCHAR(12) is the id column's actual width.
const CHAT_A_1 = 'iso-chat-a-1';
const CHAT_A_2 = 'iso-chat-a-2';
const CHAT_B_1 = 'iso-chat-b-1';

interface ToolCallResult {
  tool: string;
  result: { items: Array<{ id: string; subject: string }>; total: number; next_page_id?: string };
}

interface ChatListResult {
  tool: string;
  result: { items: Array<{ id: string; customer_id: string }>; next_page_id?: string };
}

describe('MCP tool call (FR-MOD-08.8.3-c)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Owner A PAT with ticket read — may search. */
  let readTokenA: string;
  /** Owner A PAT with no scopes — gated at the tool's scope check (403). */
  let noScopeTokenA: string;
  /** Owner A PAT, revoked — rejected at authentication (401). */
  let revokedTokenA: string;
  /** Owner B PAT with ticket read — proves the other license sees only its own. */
  let readTokenB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** Call a tool with a JSON `arguments` body (omit `args` to send no body). */
  const callTool = (tool: string, token: string, args?: Record<string, unknown>) =>
    server.post(`/mcp/tools/${tool}`, args === undefined ? undefined : { arguments: args }, auth(token));

  /** A short-lived customer (widget) token for a license, minted the real way. */
  async function widgetToken(tenant = fx.a): Promise<string> {
    const res = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(res.statusCode).toBe(200);
    return (res.json() as { token: string }).token;
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

    // One distinctly-named ticket in each license, seeded as the owner (not
    // subject to RLS), so a cross-tenant query has something real to fail on.
    await owner.ticket.createMany({
      data: [
        { id: 'iso-a-1', licenseId: fx.a.licenseId, subject: SUBJECT_A, lastMessageAt: new Date() },
        { id: 'iso-b-1', licenseId: fx.b.licenseId, subject: SUBJECT_B, lastMessageAt: new Date() },
      ],
    });

    // Two chats in A (distinct `createdAt` so newest-first pagination is
    // deterministic) and one in B, for the list_chats tests below. A second
    // customer for A: an active chat is unique per (license, customer), so
    // two chats in the same license need two customers.
    const chatCustomerA2 = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Isolation probe A2 customer' },
      select: { id: true },
    });
    const now = new Date();
    await owner.chat.createMany({
      data: [
        {
          id: CHAT_A_1,
          licenseId: fx.a.licenseId,
          customerId: fx.a.customerId,
          active: true,
          createdAt: new Date(now.getTime() - 2000),
        },
        {
          id: CHAT_A_2,
          licenseId: fx.a.licenseId,
          customerId: chatCustomerA2.id,
          active: true,
          createdAt: new Date(now.getTime() - 1000),
        },
        { id: CHAT_B_1, licenseId: fx.b.licenseId, customerId: fx.b.customerId, active: true, createdAt: now },
      ],
    });

    readTokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:ro', 'chats--all:ro'],
    });
    noScopeTokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [],
    });
    revokedTokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:ro'],
      revokedAt: new Date(),
    });
    readTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['tickets--all:ro', 'chats--all:ro'],
    });
  });

  // --- Boundaries (negative first) -------------------------------------------

  it('refuses an unauthenticated caller with 401', async () => {
    const res = await server.post('/mcp/tools/search_tickets', { arguments: { query: PROBE } });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a revoked token with 401', async () => {
    const res = await callTool('search_tickets', revokedTokenA, { query: PROBE });
    expect(res.statusCode).toBe(401);
  });

  it('answers 404 (not 403/400) for an unknown tool name', async () => {
    // Un-enumerable: probing a name must not reveal whether it exists, so this is
    // a 404 even for a caller who holds every scope.
    const res = await callTool('no_such_tool', readTokenA, { query: PROBE });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { type: string } }).error.type).toBe('not_found');
  });

  it('answers 404 for a catalogued tool not yet served', async () => {
    // summarize_chat is in the manifest but wired by 08.8.3-f; until then it is
    // not callable and 404s, the same as an unknown name.
    const res = await callTool('summarize_chat', readTokenA, {});
    expect(res.statusCode).toBe(404);
  });

  it('refuses a token missing the tool scope with 403', async () => {
    const res = await callTool('search_tickets', noScopeTokenA, { query: PROBE });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { type: string } }).error.type).toBe('authorization');
  });

  it('rejects a missing required argument with 400', async () => {
    // search_tickets requires a `query`; an empty arguments object is a 400
    // (validation, ADR-06), not a 500 or a silent all-results search.
    const res = await callTool('search_tickets', readTokenA, {});
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { type: string } }).error.type).toBe('validation');
  });

  it('rejects a malformed argument with 400', async () => {
    const res = await callTool('search_tickets', readTokenA, { query: '' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { type: string } }).error.type).toBe('validation');
  });

  it('hides the tool surface from a customer (widget) token behind a 404', async () => {
    // The principal-kind gate: a widget credential must not confirm the agent
    // tool surface exists (NFR-S5), so 404 rather than 403.
    const res = await callTool('search_tickets', await widgetToken(), { query: PROBE });
    expect(res.statusCode).toBe(404);
  });

  // --- Reference tool (happy path) -------------------------------------------

  it('runs search_tickets and returns the ticket page', async () => {
    const res = await callTool('search_tickets', readTokenA, { query: PROBE });
    expect(res.statusCode).toBe(200);

    const body = res.json() as ToolCallResult;
    expect(body.tool).toBe('search_tickets');
    expect(body.result.total).toBe(1);
    expect(body.result.items).toHaveLength(1);
    expect(body.result.items[0]?.subject).toBe(SUBJECT_A);
  });

  // --- Tenant isolation ------------------------------------------------------

  it('returns only the caller license tickets, never another license row', async () => {
    // The query matches both licenses' subjects; isolation is the only reason B's
    // ticket does not come back under A's token.
    const res = await callTool('search_tickets', readTokenA, { query: PROBE });
    expect(res.statusCode).toBe(200);

    const body = res.json() as ToolCallResult;
    expect(body.result.items.map((t) => t.id)).toEqual(['iso-a-1']);
    expect(body.result.items.map((t) => t.subject)).not.toContain(SUBJECT_B);

    // And nothing tenant-specific rides along in the response envelope.
    const raw = res.payload;
    expect(raw).not.toContain('license_id');
    expect(raw).not.toContain('organization_id');
    expect(raw).not.toContain('iso-b-1');
    expect(raw).not.toContain(fx.b.organizationId);
    expect(raw).not.toContain(String(fx.b.licenseId));
  });

  it('gives each license only its own ticket for the same query', async () => {
    const [resA, resB] = await Promise.all([
      callTool('search_tickets', readTokenA, { query: PROBE }),
      callTool('search_tickets', readTokenB, { query: PROBE }),
    ]);
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    expect((resA.json() as ToolCallResult).result.items.map((t) => t.id)).toEqual(['iso-a-1']);
    expect((resB.json() as ToolCallResult).result.items.map((t) => t.id)).toEqual(['iso-b-1']);
  });

  // --- Audit -----------------------------------------------------------------

  it('records mcp.tool_called on a successful call, without the argument text', async () => {
    const res = await callTool('search_tickets', readTokenA, { query: PROBE });
    expect(res.statusCode).toBe(200);

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'mcp.tool_called' },
    });
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(entry.actorType).toBe('agent');
    expect(entry.actorId).toBe(fx.a.ownerAccountId);
    expect(entry.target).toBe('mcp_tool:search_tickets');

    const metadata = entry.metadata as { tool?: string; scope_used?: string };
    expect(metadata.tool).toBe('search_tickets');
    expect(metadata.scope_used).toBe('tickets--all:ro');

    // The search term is user content and must never reach the append-only log.
    expect(JSON.stringify(entry.metadata)).not.toContain(PROBE);
  });

  it('does not write an audit entry when the call is refused', async () => {
    const res = await callTool('search_tickets', noScopeTokenA, { query: PROBE });
    expect(res.statusCode).toBe(403);

    const count = await owner.auditLogEntry.count({
      where: { licenseId: fx.a.licenseId, action: 'mcp.tool_called' },
    });
    expect(count).toBe(0);
  });

  // --- Read-only licence (ADR-10) --------------------------------------------

  it('keeps working while the licence is read-only', async () => {
    // MCP tools only read, so an expired trial (read-only mode) must not refuse
    // them with license_expired the way it refuses a real write.
    await owner.license.update({
      where: { id: fx.a.licenseId },
      data: { status: 'read_only' },
    });

    const res = await callTool('search_tickets', readTokenA, { query: PROBE });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ToolCallResult).result.items.map((t) => t.id)).toEqual(['iso-a-1']);
  });

  // --- list_chats (FR-MOD-08.8.3-d) -------------------------------------------

  it('refuses list_chats for a token missing the chats scope with 403', async () => {
    const res = await callTool('list_chats', noScopeTokenA, {});
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { type: string } }).error.type).toBe('authorization');
  });

  it('rejects an invalid view argument for list_chats with 400', async () => {
    const res = await callTool('list_chats', readTokenA, { view: 'not_a_real_view' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { type: string } }).error.type).toBe('validation');
  });

  it('rejects an out-of-range limit for list_chats with 400', async () => {
    const res = await callTool('list_chats', readTokenA, { limit: 0 });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { type: string } }).error.type).toBe('validation');
  });

  it('runs list_chats and returns the caller license chat page', async () => {
    const res = await callTool('list_chats', readTokenA, {});
    expect(res.statusCode).toBe(200);

    const body = res.json() as ChatListResult;
    expect(body.tool).toBe('list_chats');
    expect(body.result.items.map((c) => c.id).sort()).toEqual([CHAT_A_1, CHAT_A_2].sort());
  });

  it('paginates list_chats with next_page_id', async () => {
    const first = await callTool('list_chats', readTokenA, { limit: 1 });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as ChatListResult;
    expect(firstBody.result.items).toHaveLength(1);
    expect(firstBody.result.next_page_id).toBeDefined();

    const second = await callTool('list_chats', readTokenA, {
      limit: 1,
      page_id: firstBody.result.next_page_id,
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as ChatListResult;
    expect(secondBody.result.items).toHaveLength(1);

    // Together the two pages cover both of A's chats, each exactly once.
    expect(
      [firstBody.result.items[0]?.id, secondBody.result.items[0]?.id].sort(),
    ).toEqual([CHAT_A_1, CHAT_A_2].sort());
  });

  it('returns only the caller license chats, never another license row', async () => {
    const res = await callTool('list_chats', readTokenA, {});
    expect(res.statusCode).toBe(200);

    const body = res.json() as ChatListResult;
    expect(body.result.items.map((c) => c.id)).not.toContain(CHAT_B_1);

    // And nothing tenant-specific rides along in the response envelope.
    const raw = res.payload;
    expect(raw).not.toContain('license_id');
    expect(raw).not.toContain('organization_id');
    expect(raw).not.toContain(CHAT_B_1);
    expect(raw).not.toContain(fx.b.organizationId);
    expect(raw).not.toContain(String(fx.b.licenseId));
  });

  it('gives each license only its own chats for list_chats', async () => {
    const [resA, resB] = await Promise.all([
      callTool('list_chats', readTokenA, {}),
      callTool('list_chats', readTokenB, {}),
    ]);
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    expect(
      (resA.json() as ChatListResult).result.items.map((c) => c.id).sort(),
    ).toEqual([CHAT_A_1, CHAT_A_2].sort());
    expect((resB.json() as ChatListResult).result.items.map((c) => c.id)).toEqual([CHAT_B_1]);
  });

  it('records mcp.tool_called for a successful list_chats call', async () => {
    const res = await callTool('list_chats', readTokenA, {});
    expect(res.statusCode).toBe(200);

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'mcp.tool_called', target: 'mcp_tool:list_chats' },
    });
    expect(entries).toHaveLength(1);

    const metadata = entries[0]!.metadata as { tool?: string; scope_used?: string };
    expect(metadata.tool).toBe('list_chats');
    expect(metadata.scope_used).toBe('chats--all:ro');
  });

  // --- get_report (FR-MOD-08.8.3-e) -------------------------------------------

  describe('get_report', () => {
    interface ReportResult {
      tool: string;
      result: Record<string, unknown>;
    }

    let reportsTokenA: string;
    let reportsTokenB: string;

    beforeEach(async () => {
      // One extra ticket in A only, so overview's `totals.tickets` differs
      // between the two licenses for the same call — proof the count is truly
      // isolated per tenant, not just that B's row is absent from A's payload.
      await owner.ticket.create({
        data: {
          id: 'iso-a-2',
          licenseId: fx.a.licenseId,
          subject: 'Report isolation extra A ticket',
          lastMessageAt: new Date(),
        },
      });

      reportsTokenA = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['reports_read'],
      });
      reportsTokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['reports_read'],
      });
    });

    it('refuses get_report for a token missing the reports scope with 403', async () => {
      const res = await callTool('get_report', noScopeTokenA, { report: 'overview' });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { type: string } }).error.type).toBe('authorization');
    });

    it('rejects an unknown report enum value with 400', async () => {
      const res = await callTool('get_report', reportsTokenA, { report: 'topics' });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { type: string } }).error.type).toBe('validation');
    });

    it('rejects a missing report argument with 400', async () => {
      const res = await callTool('get_report', reportsTokenA, {});
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { type: string } }).error.type).toBe('validation');
    });

    it('rejects a reversed date range with 400', async () => {
      const res = await callTool('get_report', reportsTokenA, {
        report: 'overview',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-07-01T00:00:00.000Z',
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { type: string } }).error.type).toBe('validation');
    });

    it.each(['overview', 'breakdown', 'ai-agent', 'reviews'] as const)(
      'runs get_report(%s) and returns a populated report',
      async (report) => {
        const res = await callTool('get_report', reportsTokenA, { report });
        expect(res.statusCode).toBe(200);

        const body = res.json() as ReportResult;
        expect(body.tool).toBe('get_report');
        expect(body.result).toHaveProperty('range');
      },
    );

    it('returns different overview ticket totals for two licenses (no cross-tenant mixing)', async () => {
      const [resA, resB] = await Promise.all([
        callTool('get_report', reportsTokenA, { report: 'overview' }),
        callTool('get_report', reportsTokenB, { report: 'overview' }),
      ]);
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);

      const totalsA = (resA.json() as ReportResult).result.totals as { tickets: number };
      const totalsB = (resB.json() as ReportResult).result.totals as { tickets: number };
      expect(totalsA.tickets).toBe(2);
      expect(totalsB.tickets).toBe(1);
    });

    it('returns only the caller license figures, nothing tenant-specific in the envelope', async () => {
      const res = await callTool('get_report', reportsTokenA, { report: 'overview' });
      expect(res.statusCode).toBe(200);

      const raw = res.payload;
      expect(raw).not.toContain('license_id');
      expect(raw).not.toContain('organization_id');
      expect(raw).not.toContain(fx.b.organizationId);
      expect(raw).not.toContain(String(fx.b.licenseId));
    });

    it('records mcp.tool_called for a successful get_report call', async () => {
      const res = await callTool('get_report', reportsTokenA, { report: 'overview' });
      expect(res.statusCode).toBe(200);

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'mcp.tool_called', target: 'mcp_tool:get_report' },
      });
      expect(entries).toHaveLength(1);

      const metadata = entries[0]!.metadata as { tool?: string; scope_used?: string };
      expect(metadata.tool).toBe('get_report');
      expect(metadata.scope_used).toBe('reports_read');
    });
  });
});
