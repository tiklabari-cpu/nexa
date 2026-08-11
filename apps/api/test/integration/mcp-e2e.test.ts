/**
 * MCP end-to-end client flow — FR-MOD-08.8.3-h.
 *
 * The per-tool surface is proven in `mcp-tools.test.ts`; this file proves the
 * three cross-cutting properties that only show up when an MCP *client* drives
 * the whole feature the way Claude/ChatGPT would — discover, then call several
 * tools in one authenticated session:
 *
 *   1. End-to-end flow. One PAT authenticates, `GET /mcp/manifest` lists the
 *      four tools, and all four are then called in sequence and return their
 *      result envelopes — the shape an MCP client consumes.
 *
 *   2. Rate-limit coverage (NFR-S8 / ADR-07). The MCP surfaces are ordinary
 *      routes, so the global rate-limit preHandler already covers them — this
 *      asserts that (the standard agent budget headers ride on both the GET
 *      manifest and the POST tool call) and that the bucket, once spent, answers
 *      429 with the ADR-06 envelope. Open question 5 is decided here: a sequential
 *      LLM caller reuses the **existing per-PAT agent bucket** — there is no
 *      separate MCP quota, because `bucketFor` already keys by token, so a runaway
 *      tool loop is throttled exactly like any other automated PAT client, and no
 *      new bucket parameter is introduced.
 *
 *   3. Audit trail (NFR-S12). Each of the four calls drops exactly one
 *      `mcp.tool_called` entry whose metadata is only `{tool, scope_used}` — the
 *      arguments (a search query is user content / possible PII) never reach the
 *      append-only log.
 *
 * And, as always for a security surface, the boundary properties lead as
 * negatives: a scope-narrowed PAT is refused mid-flow with 403, a revoked PAT at
 * 401, and the whole flow is run under two licences with no crossover.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

// Both licences share the search term, so a query that returned the other
// licence's ticket would be a visible isolation failure, not a silent one.
const PROBE = 'Isolation probe';
const SUBJECT_A = `${PROBE} A ticket`;
const SUBJECT_B = `${PROBE} B ticket`;

// VARCHAR(12) is the id column's actual width.
const TICKET_A = 'e2e-tkt-a-1';
const TICKET_B = 'e2e-tkt-b-1';
const CHAT_A = 'e2e-chat-a';
const CHAT_B = 'e2e-chat-b';

const ALL_TOOLS = ['get_report', 'list_chats', 'search_tickets', 'summarize_chat'];

interface Envelope {
  tool: string;
  result: Record<string, unknown>;
}

describe('MCP end-to-end client flow (FR-MOD-08.8.3-h)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Owner A PAT holding every scope the four tools need. */
  let fullTokenA: string;
  /** Owner B PAT holding every scope — proves the other licence sees only its own. */
  let fullTokenB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** Call a tool with a JSON `arguments` body (omit `args` to send no body). */
  const callTool = (tool: string, token: string, args?: Record<string, unknown>) =>
    server.post(
      `/mcp/tools/${tool}`,
      args === undefined ? undefined : { arguments: args },
      auth(token),
    );

  const grantAll = (t: Fixtures['a']) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes: ['tickets--all:ro', 'chats--all:ro', 'reports_read'],
    });

  /** Attach one customer message to a chat (as owner, bypassing the routes) so the
   * transcript has something for summarize_chat to quote. */
  async function seedMessage(chatId: string, licenseId: bigint, text: string): Promise<void> {
    // Thread id is VARCHAR(12); derive a short, chat-unique one (chat ids end in
    // a distinct letter) rather than embedding the whole chat id.
    const threadId = `thr-${chatId.slice(-1)}`;
    await owner.thread.create({ data: { id: threadId, chatId, licenseId, active: true } });
    await owner.event.create({
      data: {
        id: `${threadId}_10`,
        threadId,
        chatId,
        licenseId,
        type: 'message',
        text,
        authorType: 'customer',
        recipients: 'all',
      },
    });
  }

  /**
   * Discover, then call all four tools in one PAT-authenticated session — the
   * flow an MCP client runs. Returns each response plus the raw payloads, so a
   * caller can assert both the envelopes and (for isolation) the concatenated
   * bytes.
   */
  async function runFullFlow(token: string, chatId: string) {
    const manifest = await server.get('/mcp/manifest', auth(token));
    expect(manifest.statusCode).toBe(200);
    const tools = (manifest.json() as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect([...tools].sort()).toEqual(ALL_TOOLS);

    const search = await callTool('search_tickets', token, { query: PROBE });
    expect(search.statusCode).toBe(200);
    expect((search.json() as Envelope).tool).toBe('search_tickets');

    const chats = await callTool('list_chats', token, {});
    expect(chats.statusCode).toBe(200);
    expect((chats.json() as Envelope).tool).toBe('list_chats');

    const report = await callTool('get_report', token, { report: 'overview' });
    expect(report.statusCode).toBe(200);
    const reportBody = report.json() as Envelope;
    expect(reportBody.tool).toBe('get_report');
    expect(reportBody.result).toHaveProperty('range');

    const summary = await callTool('summarize_chat', token, { chat_id: chatId });
    expect(summary.statusCode).toBe(200);
    const summaryBody = summary.json() as { tool: string; result: { summary: string } };
    expect(summaryBody.tool).toBe('summarize_chat');
    expect(typeof summaryBody.result.summary).toBe('string');
    expect(summaryBody.result.summary.length).toBeGreaterThan(0);

    return {
      search,
      chats,
      report,
      summary,
      payloads: [search.payload, chats.payload, report.payload, summary.payload].join('\n'),
    };
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

    // A matching ticket in each licence, so a cross-tenant search has something
    // real to (fail to) leak.
    await owner.ticket.createMany({
      data: [
        { id: TICKET_A, licenseId: fx.a.licenseId, subject: SUBJECT_A, lastMessageAt: new Date() },
        { id: TICKET_B, licenseId: fx.b.licenseId, subject: SUBJECT_B, lastMessageAt: new Date() },
      ],
    });

    // One active chat with a transcript in each licence, for list_chats + summarize_chat.
    await owner.chat.createMany({
      data: [
        { id: CHAT_A, licenseId: fx.a.licenseId, customerId: fx.a.customerId, active: true },
        { id: CHAT_B, licenseId: fx.b.licenseId, customerId: fx.b.customerId, active: true },
      ],
    });
    await seedMessage(CHAT_A, fx.a.licenseId, 'My order has not arrived yet.');
    await seedMessage(CHAT_B, fx.b.licenseId, 'Where is my refund?');

    fullTokenA = await grantAll(fx.a);
    fullTokenB = await grantAll(fx.b);
  });

  // --- Boundaries (negative first) -------------------------------------------

  it('rejects a revoked PAT at authentication with 401', async () => {
    const revoked = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:ro'],
      revokedAt: new Date(),
    });
    const res = await callTool('search_tickets', revoked, { query: PROBE });
    expect(res.statusCode).toBe(401);
  });

  it('refuses a tool outside the PAT scopes with 403 mid-flow', async () => {
    // A tickets-only PAT: search_tickets runs, but the three tools whose scopes
    // it does not hold are each refused — the gate is per tool, not per session.
    const ticketsOnly = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['tickets--all:ro'],
    });

    expect((await callTool('search_tickets', ticketsOnly, { query: PROBE })).statusCode).toBe(200);

    for (const [tool, args] of [
      ['list_chats', {}],
      ['get_report', { report: 'overview' }],
      ['summarize_chat', { chat_id: CHAT_A }],
    ] as const) {
      const res = await callTool(tool, ticketsOnly, args);
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { type: string } }).error.type).toBe('authorization');
    }
  });

  // --- End-to-end flow -------------------------------------------------------

  it('drives manifest + all four tools in one PAT-authenticated session', async () => {
    const { search, chats } = await runFullFlow(fullTokenA, CHAT_A);

    // The whole flow returns only licence A's rows.
    const searchIds = (
      search.json() as { result: { items: Array<{ id: string }> } }
    ).result.items.map((t) => t.id);
    expect(searchIds).toEqual([TICKET_A]);

    const chatIds = (chats.json() as { result: { items: Array<{ id: string }> } }).result.items.map(
      (c) => c.id,
    );
    expect(chatIds).toContain(CHAT_A);
    expect(chatIds).not.toContain(CHAT_B);
  });

  // --- Tenant isolation across the whole flow --------------------------------

  it('keeps the two licences fully isolated across the whole flow', async () => {
    const a = await runFullFlow(fullTokenA, CHAT_A);
    const b = await runFullFlow(fullTokenB, CHAT_B);

    // Neither licence's combined flow output contains the other's identifiers —
    // ticket id, chat id, or organization id (all collision-free, unlike a bare
    // bigint licence id that could coincide with a report total).
    expect(a.payloads).not.toContain(TICKET_B);
    expect(a.payloads).not.toContain(CHAT_B);
    expect(a.payloads).not.toContain(fx.b.organizationId);
    expect(a.payloads).not.toContain(SUBJECT_B);

    expect(b.payloads).not.toContain(TICKET_A);
    expect(b.payloads).not.toContain(CHAT_A);
    expect(b.payloads).not.toContain(fx.a.organizationId);
    expect(b.payloads).not.toContain(SUBJECT_A);
  });

  // --- Audit trail -----------------------------------------------------------

  it('records exactly one mcp.tool_called per call, arguments excluded', async () => {
    await runFullFlow(fullTokenA, CHAT_A);

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'mcp.tool_called' },
    });
    // Four calls, four entries — no more (a double write inflates the trail), no
    // fewer (a missing write erases the evidence). The manifest GET is not audited.
    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.target).sort()).toEqual([
      'mcp_tool:get_report',
      'mcp_tool:list_chats',
      'mcp_tool:search_tickets',
      'mcp_tool:summarize_chat',
    ]);

    for (const entry of entries) {
      expect(entry.actorType).toBe('agent');
      expect(entry.actorId).toBe(fx.a.ownerAccountId);

      // Metadata is exactly {tool, scope_used, request_id} — proof no argument or
      // PII field rides along. `request_id` is a uniform request correlation id
      // (a UUID, explicitly exempt from the writer's credential filter), not user
      // content; the search term and the chat id are, and must never reach the
      // append-only log.
      const metadata = entry.metadata as Record<string, unknown>;
      expect(Object.keys(metadata).sort()).toEqual(['request_id', 'scope_used', 'tool']);
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain(PROBE);
      expect(serialized).not.toContain(CHAT_A);
    }
  });

  it('gives each licence its own four audit entries, never the other licence', async () => {
    await runFullFlow(fullTokenA, CHAT_A);
    await runFullFlow(fullTokenB, CHAT_B);

    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'mcp.tool_called' },
      }),
    ).toBe(4);
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.b.licenseId, action: 'mcp.tool_called' },
      }),
    ).toBe(4);
  });

  // --- Rate-limit coverage (NFR-S8 / ADR-07) ---------------------------------

  it('applies the standard agent budget to both MCP surfaces — one shared PAT bucket', async () => {
    // Coverage proof: the global rate-limit preHandler runs on the GET manifest
    // and the POST tool call alike (the budget headers are present), and both
    // draw down the same agent bucket — there is no separate MCP quota.
    const manifest = await server.get('/mcp/manifest', auth(fullTokenA));
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers['x-ratelimit-limit']).toBe('180');
    const afterManifest = Number(manifest.headers['x-ratelimit-remaining']);
    expect(afterManifest).toBeLessThan(180);

    const tool = await callTool('search_tickets', fullTokenA, { query: PROBE });
    expect(tool.statusCode).toBe(200);
    expect(tool.headers['x-ratelimit-limit']).toBe('180');
    // The tool call spends from the same bucket the manifest already drew on.
    expect(Number(tool.headers['x-ratelimit-remaining'])).toBeLessThan(afterManifest);
  });

  it('returns 429 with the ADR-06 envelope once the shared agent bucket is spent', async () => {
    // A dedicated low-budget server so the exhaustion is a couple of calls, not
    // 180 (mirrors the auth suite's rate-limit test).
    const limited = await startTestServer({ RATE_LIMIT_AGENT_PER_MIN: '2' });
    try {
      await clearRateLimits(limited.app);
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['tickets--all:ro'],
      });
      const call = () =>
        limited.post('/mcp/tools/search_tickets', { arguments: { query: PROBE } }, auth(token));

      expect((await call()).statusCode).toBe(200);
      expect((await call()).statusCode).toBe(200);

      const throttled = await call();
      expect(throttled.statusCode).toBe(429);
      expect((throttled.json() as { error: { type: string } }).error.type).toBe(
        'too_many_requests',
      );
      // Every 429 carries a Retry-After the source platform omitted.
      expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await clearRateLimits(limited.app);
      await limited.close();
    }
  });
});
