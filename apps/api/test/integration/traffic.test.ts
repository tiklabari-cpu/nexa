/**
 * Real-time traffic — the live-visitor board (FR-MOD-03.1.3).
 *
 * The property that carries the feature is the **Chatting with** column: a live
 * visitor's row must name the human agent or the AI persona currently answering,
 * with a human winning over the persona exactly as the widget header resolves it.
 * Everything else here exists to keep that honest — the funnel `activity`, the
 * live window, and (first, because it is easiest to break unseen) tenant
 * isolation across the org/license boundary.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures, type TenantFixture } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface TrafficVisitor {
  customer_id: string;
  name: string | null;
  email: string | null;
  activity: 'browsing' | 'queued' | 'waiting' | 'chatting';
  chat_id: string | null;
  chatting_with: { kind: 'human' | 'ai'; name: string; avatar_url: string | null } | null;
  last_activity_at: string | null;
}

describe('traffic', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let readToken: string;
  let seq = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const nextId = (prefix: string, width: number): string => {
    seq += 1;
    return prefix + String(seq).padStart(width - 1, '0');
  };
  const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);

  /** A customer in the given tenant's organization. */
  async function seedCustomer(t: TenantFixture, name: string, email?: string): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name, ...(email ? { email } : {}) },
      select: { id: true },
    });
    return customer.id;
  }

  /** A recent visit — what puts a browsing visitor on the board. */
  async function seedVisit(t: TenantFixture, customerId: string, startedAt: Date): Promise<void> {
    await owner.visit.create({
      data: {
        customerId,
        licenseId: t.licenseId,
        pages: [{ url: 'https://shop.example/pricing', at: startedAt.toISOString() }],
        startedAt,
      },
    });
  }

  /**
   * An active conversation with a single active thread. `assigneeId` names the
   * human agent; `lastAuthor` plants one event so the waiting/chatting split can
   * be exercised; `queuePosition` puts it back in the queue.
   */
  async function seedActiveChat(
    t: TenantFixture,
    customerId: string,
    opts: {
      assigneeId?: string;
      queuePosition?: number;
      lastAuthor?: 'customer' | 'agent';
      createdAt?: Date;
    } = {},
  ): Promise<string> {
    const createdAt = opts.createdAt ?? minutesAgo(2);
    const chatId = nextId('c', 12);
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId, active: true, createdAt },
    });
    const threadId = nextId('t', 12);
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: true,
        createdAt,
        ...(opts.assigneeId ? { assigneeId: opts.assigneeId } : {}),
        ...(opts.queuePosition != null ? { queuePosition: opts.queuePosition } : {}),
      },
    });
    if (opts.lastAuthor) {
      await owner.event.create({
        data: {
          id: nextId('e', 40),
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          authorType: opts.lastAuthor,
          text: 'hello',
          createdAt,
        },
      });
    }
    return chatId;
  }

  async function seedPersona(t: TenantFixture, name: string): Promise<void> {
    await owner.aiAgent.create({
      data: { licenseId: t.licenseId, kind: 'ai_agent', name, active: true },
    });
  }

  const listTraffic = async (query = ''): Promise<TrafficVisitor[]> => {
    const response = await server.get(`/traffic${query}`, auth(readToken));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: TrafficVisitor[] }).items;
  };

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
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:ro'],
    });
  });

  // --- Tenant isolation ------------------------------------------------------

  describe('tenant isolation', () => {
    it("never surfaces another tenant's live visitors", async () => {
      const mineChatting = await seedCustomer(fx.a, 'Mine Chatting');
      await seedActiveChat(fx.a, mineChatting, { assigneeId: fx.a.agentAccountId });
      const mineBrowsing = await seedCustomer(fx.a, 'Mine Browsing');
      await seedVisit(fx.a, mineBrowsing, minutesAgo(1));

      // Tenant B: an active chat and a recent visit, both of which must be invisible.
      const theirsChatting = await seedCustomer(fx.b, 'Theirs Chatting');
      await seedActiveChat(fx.b, theirsChatting, { assigneeId: fx.b.agentAccountId });
      const theirsBrowsing = await seedCustomer(fx.b, 'Theirs Browsing');
      await seedVisit(fx.b, theirsBrowsing, minutesAgo(1));

      const ids = (await listTraffic()).map((v) => v.customer_id);
      expect(ids).toEqual(expect.arrayContaining([mineChatting, mineBrowsing]));
      expect(ids).not.toContain(theirsChatting);
      expect(ids).not.toContain(theirsBrowsing);
    });
  });

  // --- Scope enforcement -----------------------------------------------------

  it('rejects a caller without a customer scope', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    const response = await server.get('/traffic', auth(token));
    expect(response.statusCode).toBe(403);
  });

  // --- Who is on the board ---------------------------------------------------

  it('lists a browsing visitor with no conversation', async () => {
    const id = await seedCustomer(fx.a, 'Browser', 'browser@example.test');
    await seedVisit(fx.a, id, minutesAgo(3));

    const row = (await listTraffic()).find((v) => v.customer_id === id);
    expect(row).toMatchObject({
      activity: 'browsing',
      chat_id: null,
      chatting_with: null,
      name: 'Browser',
      email: 'browser@example.test',
    });
  });

  it('drops a visit older than the live window', async () => {
    const stale = await seedCustomer(fx.a, 'Left An Hour Ago');
    await seedVisit(fx.a, stale, minutesAgo(45));

    const ids = (await listTraffic()).map((v) => v.customer_id);
    expect(ids).not.toContain(stale);
  });

  // --- Chatting with ---------------------------------------------------------

  it('names the human agent a visitor is chatting with', async () => {
    const id = await seedCustomer(fx.a, 'With A Human');
    await seedActiveChat(fx.a, id, { assigneeId: fx.a.agentAccountId, lastAuthor: 'agent' });

    const row = (await listTraffic()).find((v) => v.customer_id === id);
    expect(row?.activity).toBe('chatting');
    expect(row?.chatting_with).toMatchObject({ kind: 'human', name: `Agent a` });
    expect(row?.chat_id).not.toBeNull();
  });

  it('names the AI persona when no human is assigned (e.g. "Hazal")', async () => {
    await seedPersona(fx.a, 'Hazal');
    const id = await seedCustomer(fx.a, 'With The AI');
    await seedActiveChat(fx.a, id, { lastAuthor: 'customer' });

    const row = (await listTraffic()).find((v) => v.customer_id === id);
    // Last word came from the customer, so the ball is in the AI's court.
    expect(row?.activity).toBe('waiting');
    expect(row?.chatting_with).toMatchObject({ kind: 'ai', name: 'Hazal' });
  });

  it('lets a human assignee win over the AI persona', async () => {
    await seedPersona(fx.a, 'Hazal');
    const id = await seedCustomer(fx.a, 'Human Over AI');
    await seedActiveChat(fx.a, id, { assigneeId: fx.a.agentAccountId });

    const row = (await listTraffic()).find((v) => v.customer_id === id);
    expect(row?.chatting_with?.kind).toBe('human');
  });

  it('shows a queued visitor as queued with nobody answering yet', async () => {
    await seedPersona(fx.a, 'Hazal');
    const id = await seedCustomer(fx.a, 'Still Queued');
    await seedActiveChat(fx.a, id, { queuePosition: 0, lastAuthor: 'customer' });

    const row = (await listTraffic()).find((v) => v.customer_id === id);
    expect(row?.activity).toBe('queued');
    // Nobody has picked it up, so the persona is not yet "chatting with" them.
    expect(row?.chatting_with).toBeNull();
  });

  // --- Shape -----------------------------------------------------------------

  it('honours the limit', async () => {
    for (let i = 0; i < 3; i += 1) {
      const id = await seedCustomer(fx.a, `Visitor ${i}`);
      await seedVisit(fx.a, id, minutesAgo(i + 1));
    }
    const items = await listTraffic('?limit=1');
    expect(items).toHaveLength(1);
  });
});
