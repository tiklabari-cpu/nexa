/**
 * Copilot BI command — `POST /copilot/bi` (12.4-bi-c).
 *
 * Four properties, and every one of them is easy to break without any test
 * noticing:
 *
 *   1. **ADR-09.** The number in the answer is the number `GET /reports/overview`
 *      gives for the same window — not a second, independently-computed figure.
 *      The day this test fails is the day Copilot starts saying 12 while the
 *      Reports tab says 11, and nothing else in the suite would catch it.
 *   2. **Tenant isolation.** Another license's activity has no path into an
 *      answer (NFR-S4).
 *   3. **The boundary.** A customer token gets a 404 (never a 403 — the widget
 *      surface must not map the agent API), and the endpoint needs the *union*
 *      of the Copilot scope and `reports_read`, so holding either one alone is
 *      refused (NFR-S3/S5).
 *   4. **It does not guess.** A question it cannot place comes back as a 200
 *      `not_understood` with no number attached — never a fabricated figure,
 *      and never an error envelope.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BI_METRICS } from '@nexa/ai-mock';
import { grantToken, ownerClient, seedFixtures, type Fixtures, type TenantFixture } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DAY_MS = 86_400_000;

interface BiBody {
  answer: string;
  kind: string;
  metric: string | null;
  value: number | null;
  range: { from: string; to: string } | null;
}

describe('copilot BI command', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** Both halves of the union — the Copilot scope and the reports reader. */
  const agentToken = (
    tenant: TenantFixture,
    scopes: string[] = ['agents-bot--all:rw', 'reports_read', 'chats--all:rw'],
  ) =>
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

  /** One chat, started now, so a window that contains "now" has something in it. */
  async function startChat(tenant: TenantFixture, token: string): Promise<void> {
    const customer = await owner.customer.create({
      data: { organizationId: tenant.organizationId, name: 'Visitor' },
      select: { id: true },
    });
    const started = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: true },
      auth(token),
    );
    expect([200, 201]).toContain(started.statusCode);
  }

  const ask = (question: string, token: string) =>
    server.post('/copilot/bi', { question }, auth(token));

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

  // =========================================================================
  // Negatives first — the boundary, before anything is asked of it
  // =========================================================================

  it('is closed to a customer token — 404, not 403 (I4 boundary)', async () => {
    const token = await customerToken(fx.a);
    const res = await ask('how many chats did we have', token);
    // A 403 would confirm the endpoint exists to a credential that must not be
    // able to enumerate the agent API at all.
    expect(res.statusCode).toBe(404);
  });

  it('refuses a token holding the Copilot scope but not reports_read (403)', async () => {
    const token = await agentToken(fx.a, ['agents-bot--all:rw', 'chats--all:rw']);
    const res = await ask('how many chats did we have', token);
    expect(res.statusCode).toBe(403);
  });

  it('refuses a token holding reports_read but not the Copilot scope (403)', async () => {
    // The other half of the union. Both directions asserted because a route that
    // accepted *either* scope would still pass the test above.
    const token = await agentToken(fx.a, ['reports_read', 'chats--all:rw']);
    const res = await ask('how many chats did we have', token);
    expect(res.statusCode).toBe(403);
  });

  it('rejects a question over the published length cap (400, NFR-S8)', async () => {
    const token = await agentToken(fx.a);
    const res = await ask('a'.repeat(501), token);
    expect(res.statusCode).toBe(400);
  });

  it('rejects an empty question (400)', async () => {
    const token = await agentToken(fx.a);
    expect((await ask('   ', token)).statusCode).toBe(400);
    expect((await server.post('/copilot/bi', {}, auth(await agentToken(fx.a)))).statusCode).toBe(400);
  });

  // =========================================================================
  // ADR-09 — the same window, the same number
  // =========================================================================

  it('quotes exactly the figure GET /reports/overview gives for the same window (ADR-09)', async () => {
    const token = await agentToken(fx.a);
    await startChat(fx.a, token);
    await startChat(fx.a, token);
    await startChat(fx.a, token);

    const res = await ask('how many chats did we have', token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as BiBody;

    expect(body.kind).toBe('metric');
    expect(body.metric).toBe('totals.chats');
    expect(body.range).not.toBeNull();
    // Not just "both agree" — both agree on the number the fixtures actually
    // produced, so the assertion cannot be satisfied by two matching zeroes.
    expect(body.value).toBe(3);
    expect(body.answer).toContain('3');

    // The window the answer reports, handed straight back to Reports: the two
    // are then measuring the same span by construction, and the only thing left
    // that can differ is the figure itself.
    const range = body.range!;
    const overview = await server.get(
      `/reports/overview?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      auth(token),
    );
    expect(overview.statusCode).toBe(200);
    expect((overview.json() as { totals: { chats: number } }).totals.chats).toBe(body.value);
  });

  it('holds the same parity for a window the question named (this week)', async () => {
    const token = await agentToken(fx.a);
    await startChat(fx.a, token);
    await startChat(fx.a, token);

    const res = await ask('bu hafta kaç sohbet başladı', token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as BiBody;

    expect(body.kind).toBe('metric');
    expect(body.metric).toBe('totals.chats');
    expect(body.value).toBe(2);

    const range = body.range!;
    const overview = await server.get(
      `/reports/overview?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      auth(token),
    );
    expect((overview.json() as { totals: { chats: number } }).totals.chats).toBe(body.value);
  });

  it('names a field the Overview report actually has, for every metric it knows', async () => {
    // What keeps the dictionary honest as Reports evolves. A `metricSource`
    // pointing at a renamed field would otherwise surface as a permanent,
    // plausible "no data yet" — the worst possible failure for this endpoint,
    // because it looks like an answer.
    const token = await agentToken(fx.a);
    const overview = (await server.get('/reports/overview', auth(token))).json() as Record<
      string,
      unknown
    >;

    for (const metric of BI_METRICS) {
      let cursor: unknown = overview;
      for (const segment of metric.metricSource.split('.')) {
        expect(cursor, metric.metricSource).toBeTypeOf('object');
        expect(cursor, metric.metricSource).not.toBeNull();
        cursor = (cursor as Record<string, unknown>)[segment];
      }
      // A number, or an explicit null (nothing to report) — never undefined.
      expect(cursor === null || typeof cursor === 'number', metric.metricSource).toBe(true);
    }
  });

  // =========================================================================
  // Windows
  // =========================================================================

  it('answers over the window the question named, not the default', async () => {
    const token = await agentToken(fx.a);
    // Started now, so it belongs to today — never to yesterday, whatever hour
    // this suite happens to run at.
    await startChat(fx.a, token);

    const res = await ask('how many chats closed yesterday', token);
    expect(res.statusCode).toBe(200);
    const body = res.json() as BiBody;

    expect(body.kind).toBe('metric');
    expect(body.metric).toBe('totals.closed');
    expect(body.value).toBe(0);

    const from = new Date(body.range!.from);
    const to = new Date(body.range!.to);
    // Exactly one UTC calendar day, closed at both ends — the interval shape
    // every report aggregation uses.
    expect(from.toISOString()).toMatch(/T00:00:00\.000Z$/);
    expect(to.getTime() - from.getTime()).toBe(DAY_MS - 1);
    expect(to.getTime()).toBeLessThan(Date.now());
  });

  it('falls back to the 30-day report default and says so when no window was named', async () => {
    const token = await agentToken(fx.a);
    const res = await ask('how many chats did we have', token);
    const body = res.json() as BiBody;

    const span = new Date(body.range!.to).getTime() - new Date(body.range!.from).getTime();
    expect(span).toBe(30 * DAY_MS);
    // The window is stated in the sentence too, so a reader who was silently
    // given a default rather than the period they had in mind can see it.
    expect(body.answer).toContain('last 30 days');
  });

  // =========================================================================
  // It does not guess
  // =========================================================================

  it('returns kind: not_understood as a 200, with nothing attached (no error envelope)', async () => {
    const token = await agentToken(fx.a);
    const res = await ask('what is the meaning of life', token);
    expect(res.statusCode).toBe(200);

    const body = res.json() as BiBody;
    expect(body.kind).toBe('not_understood');
    expect(body.metric).toBeNull();
    expect(body.value).toBeNull();
    expect(body.range).toBeNull();
    // Nothing that could be read as a figure: an "I don't know" carrying a
    // number is not an "I don't know". (The sentence does name example windows,
    // so this looks for a *quantity*, not for digits.)
    expect(body.answer).not.toMatch(/\d+\s*(%|chats?)/);
    // And it says what it can answer, rather than only what it cannot.
    expect(body.answer).toContain('customer satisfaction');
  });

  it('refuses a question that fits two metrics equally well rather than picking one', async () => {
    const token = await agentToken(fx.a);
    // "resolved" is the word the manual/assisted/automated split shares; the
    // question has three defensible answers, so it gets none of them.
    const res = await ask('how many chats were resolved', token);
    expect(res.statusCode).toBe(200);
    expect((res.json() as BiBody).kind).toBe('not_understood');
  });

  it('reports no_data rather than a false zero when the metric has nothing to report', async () => {
    const token = await agentToken(fx.a);
    // Nothing in this tenant has ever been rated, so the satisfaction score is
    // null — unrated, not 0%, which would read as a catastrophe.
    const res = await ask('what is our customer satisfaction score', token);
    expect(res.statusCode).toBe(200);

    const body = res.json() as BiBody;
    expect(body.kind).toBe('no_data');
    expect(body.metric).toBe('satisfaction.score');
    expect(body.value).toBeNull();
    // Above all, no "0%" — the false zero this branch exists to avoid.
    expect(body.answer).not.toMatch(/\d+\s*%/);
    // The window is still named, so "no data" is anchored to a period.
    expect(body.answer).toContain('last 30 days');
  });

  it('answers the same question the same way every time', async () => {
    const token = await agentToken(fx.a);
    await startChat(fx.a, token);

    const first = (await ask('bu hafta kaç sohbet başladı', token)).json() as BiBody;
    const second = (await ask('bu hafta kaç sohbet başladı', token)).json() as BiBody;
    expect(second.kind).toBe(first.kind);
    expect(second.metric).toBe(first.metric);
    expect(second.value).toBe(first.value);
    expect(second.answer).toBe(first.answer);
  });

  // =========================================================================
  // Tenant isolation
  // =========================================================================

  it("never answers with another license's numbers (cross-tenant)", async () => {
    const tokenA = await agentToken(fx.a);
    await startChat(fx.a, tokenA);
    await startChat(fx.a, tokenA);
    await startChat(fx.a, tokenA);

    const tokenB = await agentToken(fx.b);
    const res = await ask('how many chats did we have', tokenB);
    expect(res.statusCode).toBe(200);

    const body = res.json() as BiBody;
    expect(body.kind).toBe('metric');
    // Tenant B started none of its own; tenant A's three must not appear here,
    // in the figure or in the sentence. (Anchored, because the window label
    // legitimately contains a "30".)
    expect(body.value).toBe(0);
    expect(body.answer).toMatch(/^0 chats started\b/);

    // And the figure still agrees with what Reports tells tenant B (ADR-09 is
    // a per-license property, not just a global one).
    const range = body.range!;
    const overview = await server.get(
      `/reports/overview?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      auth(tokenB),
    );
    expect((overview.json() as { totals: { chats: number } }).totals.chats).toBe(0);
  });
});
