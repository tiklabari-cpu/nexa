/**
 * Chat topics report (FR-MOD-07.6) — the contract-first skeleton (07.6-a).
 *
 * This window settles the endpoint's shape and its "not enough conversations
 * yet" gate; the clustering itself lands in 07.6-c. So every assertion here is
 * about the gate and its isolation, not about topic contents (which stay empty):
 *
 *   - below `min_conversations` clusterable chats → `sufficient_data: false`,
 *     `topics: []`, a 200 state and not an error ("yeterli veri yoksa empty");
 *   - `analyzed` counts exactly the clusterable conversations, and only this
 *     tenant's (NFR-S4).
 *
 * A thread is clusterable once it has text to cluster — an AI summary, or
 * failing that a customer message — the same rule the route's count uses.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('chat topics report (07.6)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;

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

    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });
  });

  const auth = {
    get authorization() {
      return `Bearer ${token}`;
    },
  };

  // Seeding runs as the owner (RLS-exempt) so a scenario can place exactly the
  // conversations it wants to probe the threshold with.

  /** A closed chat whose thread carries an AI summary — clusterable via summary. */
  async function seedSummaryThread(t: TenantFixture, summary: string, at = new Date()): Promise<void> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: t.customerId, active: false, createdAt: at },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: t.licenseId,
        active: false,
        summary,
        createdAt: at,
        closedAt: at,
      },
    });
  }

  /** `count` summary-clusterable threads, so a suite can straddle the threshold. */
  async function seedSummaryThreads(t: TenantFixture, count: number, at = new Date()): Promise<void> {
    for (let i = 0; i < count; i++) await seedSummaryThread(t, `Topic summary ${i}`, at);
  }

  /**
   * A closed chat with **no** summary but a customer message — clusterable via
   * the message, proving the count's second branch.
   */
  async function seedCustomerMessageThread(t: TenantFixture, text: string, at = new Date()): Promise<void> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: t.customerId, active: false, createdAt: at },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: false,
        summary: null,
        createdAt: at,
        closedAt: at,
      },
    });
    await owner.event.create({
      data: {
        id: `${threadId}_10`,
        threadId,
        chatId,
        licenseId: t.licenseId,
        type: 'message',
        text,
        authorType: 'customer',
        recipients: 'all',
        createdAt: at,
      },
    });
  }

  /** A closed chat with neither a summary nor a customer message — not clusterable. */
  async function seedBareThread(t: TenantFixture, at = new Date()): Promise<void> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: t.customerId, active: false, createdAt: at },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: t.licenseId,
        active: false,
        summary: null,
        createdAt: at,
        closedAt: at,
      },
    });
  }

  // --- negatives first ------------------------------------------------------

  it('requires the reports_read scope', async () => {
    const weak = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    const response = await server.get('/reports/topics', { authorization: `Bearer ${weak}` });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a backwards date range', async () => {
    const response = await server.get('/reports/topics?from=2026-08-01&to=2026-07-01', auth);
    expect(response.statusCode).toBe(400);
  });

  // --- the gate: "yeterli veri yoksa empty" ---------------------------------

  it('an empty tenant is insufficient, not an error', async () => {
    const response = await server.get('/reports/topics', auth);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.analyzed).toBe(0);
    expect(body.sufficient_data).toBe(false);
    expect(body.topics).toEqual([]);
    // The floor is surfaced so a client can say how many more are needed.
    expect(body.min_conversations).toBeGreaterThan(0);
  });

  it('stays insufficient below the threshold and counts what it has', async () => {
    const floor = (await server.get('/reports/topics', auth)).json().min_conversations as number;
    await seedSummaryThreads(fx.a, floor - 1);

    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.analyzed).toBe(floor - 1);
    expect(body.sufficient_data).toBe(false);
    expect(body.topics).toEqual([]);
  });

  it('flips to sufficient at the threshold (topics still empty in the skeleton)', async () => {
    const floor = (await server.get('/reports/topics', auth)).json().min_conversations as number;
    await seedSummaryThreads(fx.a, floor);

    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.analyzed).toBe(floor);
    expect(body.sufficient_data).toBe(true);
    // 07.6-a settles the gate; clustering (and non-empty topics) lands in 07.6-c.
    expect(body.topics).toEqual([]);
  });

  // --- what counts as clusterable -------------------------------------------

  it('counts a thread clusterable through a customer message, not only a summary', async () => {
    await seedCustomerMessageThread(fx.a, 'Where is my order?');
    const body = (await server.get('/reports/topics', auth)).json();
    expect(body.analyzed).toBe(1);
  });

  it('does not count a thread with neither a summary nor a customer message', async () => {
    await seedSummaryThread(fx.a, 'Delivery question');
    await seedBareThread(fx.a);
    const body = (await server.get('/reports/topics', auth)).json();
    // Two threads exist; only the one with clustering text is analyzed.
    expect(body.analyzed).toBe(1);
  });

  // --- shape ----------------------------------------------------------------

  it('reports the equal-length window immediately before as previous_period', async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 10 * 86_400_000);
    const body = (
      await server.get(`/reports/topics?from=${from.toISOString()}&to=${to.toISOString()}`, auth)
    ).json();

    // The previous window ends one ms before this one begins (no shared instant)
    // and is exactly as long — the trend comparison in 07.6-c compares like spans.
    expect(Date.parse(body.previous_period.range.to)).toBe(Date.parse(body.range.from) - 1);
    const span = Date.parse(body.range.to) - Date.parse(body.range.from);
    const prevSpan =
      Date.parse(body.previous_period.range.to) - Date.parse(body.previous_period.range.from);
    expect(span - prevSpan).toBe(1);
  });

  // --- isolation (NFR-S4) ---------------------------------------------------

  it('never counts another tenant toward analyzed', async () => {
    // Enough of tenant A's conversations to be sufficient on their own.
    const floor = (await server.get('/reports/topics', auth)).json().min_conversations as number;
    await seedSummaryThreads(fx.a, floor);

    const theirToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['reports_read'],
    });
    const theirs = (await server.get('/reports/topics', { authorization: `Bearer ${theirToken}` })).json();
    expect(theirs.analyzed).toBe(0);
    expect(theirs.sufficient_data).toBe(false);
    expect(theirs.topics).toEqual([]);
  });
});
