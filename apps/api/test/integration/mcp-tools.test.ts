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
 * `search_tickets` is the only tool wired in this slice; `list_chats`,
 * `get_report` and `summarize_chat` arrive in 08.8.3-d/-e/-f, and the end-to-end
 * flow across all four is 08.8.3-h.
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

interface ToolCallResult {
  tool: string;
  result: { items: Array<{ id: string; subject: string }>; total: number; next_page_id?: string };
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

    readTokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:ro'],
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
      scopes: ['tickets--all:ro'],
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
    // list_chats is in the manifest but wired by 08.8.3-d; until then it is not
    // callable and 404s, the same as an unknown name.
    const res = await callTool('list_chats', readTokenA, {});
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
});
