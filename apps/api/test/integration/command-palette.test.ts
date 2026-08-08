/**
 * Command palette AI query (FR-MOD-01.1.3-ai-e).
 *
 * The property that matters: the number in the answer is never a second,
 * independently-computed figure — it is read from the exact same report
 * builder `GET /reports/overview` uses (ADR-09), so the two can never drift.
 * Everything else follows the same boundary shape as Copilot's chat assists:
 * `reports_read`-gated, tenant-scoped, closed to a customer token.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures, type TenantFixture } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('command palette AI query', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const agentToken = (tenant: TenantFixture, scopes: string[] = ['reports_read', 'chats--all:rw']) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes,
    });

  async function customerToken(tenant: TenantFixture): Promise<string> {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  async function startChat(token: string): Promise<void> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Visitor' },
      select: { id: true },
    });
    const started = await server.post('/chats', { customer_id: customer.id, assign_to_me: true }, auth(token));
    expect([200, 201]).toContain(started.statusCode);
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
  });

  it("answers a team-activity question with the same number GET /reports/overview reports (ADR-09)", async () => {
    const token = await agentToken(fx.a);
    await startChat(token);
    await startChat(token);

    const ai = await server.post('/palette/ai-query', { query: "Summarize my team's activity" }, auth(token));
    expect(ai.statusCode).toBe(200);
    const body = ai.json() as { answer: string; kind: string; metric_source?: string };
    expect(body.kind).toBe('summary');
    expect(body.metric_source).toBe('totals.chats');

    const overview = await server.get('/reports/overview', auth(token));
    const totals = (overview.json() as { totals: { chats: number } }).totals;
    expect(totals.chats).toBe(2);
    expect(body.answer).toContain('2');
  });

  it('returns kind: not_understood (200, not an error) for an unmatched query', async () => {
    const token = await agentToken(fx.a);
    const res = await server.post('/palette/ai-query', { query: 'what is the meaning of life' }, auth(token));
    expect(res.statusCode).toBe(200);
    const body = res.json() as { kind: string; metric_source?: string };
    expect(body.kind).toBe('not_understood');
    expect(body.metric_source).toBeUndefined();
  });

  it('returns kind: no_data when a topic is understood but nothing has been recorded yet', async () => {
    const token = await agentToken(fx.a);
    // No chat has ever been rated in this tenant, so the satisfaction score is
    // null (unrated, not zero — see satisfactionScore in report-csv.ts).
    const res = await server.post(
      '/palette/ai-query',
      { query: 'What is our customer satisfaction score?' },
      auth(token),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as { kind: string; metric_source?: string };
    expect(body.kind).toBe('no_data');
    expect(body.metric_source).toBe('satisfaction.score');
  });

  it('rejects a token without reports_read (403)', async () => {
    const token = await agentToken(fx.a, ['chats--all:rw']);
    const res = await server.post('/palette/ai-query', { query: 'team activity' }, auth(token));
    expect(res.statusCode).toBe(403);
  });

  it('is closed to a customer token — 404, not 403 (I4 boundary)', async () => {
    const token = await customerToken(fx.a);
    const res = await server.post('/palette/ai-query', { query: 'team activity' }, auth(token));
    expect(res.statusCode).toBe(404);
  });

  it('rejects a query over the length cap (400, NFR-S8)', async () => {
    const token = await agentToken(fx.a);
    const res = await server.post('/palette/ai-query', { query: 'a'.repeat(501) }, auth(token));
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty query (400)', async () => {
    const token = await agentToken(fx.a);
    const res = await server.post('/palette/ai-query', { query: '   ' }, auth(token));
    expect(res.statusCode).toBe(400);
  });

  it("never answers with another tenant's numbers (cross-tenant isolation)", async () => {
    const tokenA = await agentToken(fx.a);
    await startChat(tokenA);
    await startChat(tokenA);
    await startChat(tokenA);

    const tokenB = await agentToken(fx.b);
    const res = await server.post(
      '/palette/ai-query',
      { query: "Summarize my team's activity" },
      auth(tokenB),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as { kind: string; answer: string };
    expect(body.kind).toBe('summary');
    // Tenant B started no chats of its own — tenant A's three must not leak in.
    expect(body.answer).toContain('0 chats');
  });

  it('is deterministic — the same query resolves to the same topic every time', async () => {
    const token = await agentToken(fx.a);
    const first = await server.post('/palette/ai-query', { query: 'team activity' }, auth(token));
    const second = await server.post('/palette/ai-query', { query: 'team activity' }, auth(token));
    expect((first.json() as { metric_source?: string }).metric_source).toBe(
      (second.json() as { metric_source?: string }).metric_source,
    );
  });
});
