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
  activity: 'browsing' | 'queued' | 'waiting' | 'chatting' | 'supervised' | 'invited';
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

  /**
   * A proactive invitation: one running campaign plus the send row the trigger
   * engine writes for a matched visitor. `engaged` false is "invited but has
   * not answered yet" — the state the board reports as `invited`.
   */
  async function seedInvite(
    t: TenantFixture,
    customerId: string,
    opts: { engaged?: boolean; createdAt?: Date } = {},
  ): Promise<void> {
    const campaign = await owner.campaign.create({
      data: { licenseId: t.licenseId, name: 'Need a hand?', status: 'ongoing' },
      select: { id: true },
    });
    await owner.campaignSend.create({
      data: {
        licenseId: t.licenseId,
        campaignId: campaign.id,
        customerId,
        engaged: opts.engaged ?? false,
        createdAt: opts.createdAt ?? minutesAgo(1),
      },
    });
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

    it("never surfaces another tenant's campaign invitations", async () => {
      const mineInvited = await seedCustomer(fx.a, 'Mine Invited');
      await seedInvite(fx.a, mineInvited);

      // Tenant B: an invitation with nothing else attached to it. The send row
      // is the only thing that could put this customer on a board, so if the
      // third source leaks the license filter, this is where it shows.
      const theirsInvited = await seedCustomer(fx.b, 'Theirs Invited');
      await seedInvite(fx.b, theirsInvited);

      const ids = (await listTraffic()).map((v) => v.customer_id);
      expect(ids).toContain(mineInvited);
      expect(ids).not.toContain(theirsInvited);
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

  // --- Invited (FR-MOD-03.3.2 → the funnel) ----------------------------------

  describe('invited', () => {
    it('ignores a send the visitor has already answered', async () => {
      const answered = await seedCustomer(fx.a, 'Already Replied');
      await seedInvite(fx.a, answered, { engaged: true });

      // Nothing else puts them on the board, so an engaged send must leave the
      // row out entirely rather than reporting a pending invitation.
      const ids = (await listTraffic()).map((v) => v.customer_id);
      expect(ids).not.toContain(answered);
    });

    it('ignores a send older than the live window', async () => {
      const stale = await seedCustomer(fx.a, 'Invited An Hour Ago');
      await seedInvite(fx.a, stale, { createdAt: minutesAgo(45) });

      const ids = (await listTraffic()).map((v) => v.customer_id);
      expect(ids).not.toContain(stale);
    });

    it('lists an invited visitor who has not answered yet', async () => {
      const id = await seedCustomer(fx.a, 'Invited', 'invited@example.test');
      await seedInvite(fx.a, id);

      const row = (await listTraffic()).find((v) => v.customer_id === id);
      expect(row).toMatchObject({
        activity: 'invited',
        chat_id: null,
        chatting_with: null,
        name: 'Invited',
        email: 'invited@example.test',
      });
    });

    it('shows a pending invitation ahead of plain browsing', async () => {
      const id = await seedCustomer(fx.a, 'Browsing And Invited');
      await seedVisit(fx.a, id, minutesAgo(3));
      await seedInvite(fx.a, id, { createdAt: minutesAgo(2) });

      const rows = (await listTraffic()).filter((v) => v.customer_id === id);
      // Still exactly one row per visitor — the invitation replaces the
      // browsing bucket, it does not add a second one.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.activity).toBe('invited');
    });

    it('lets an active conversation win over a pending invitation', async () => {
      await seedPersona(fx.a, 'Hazal');
      const id = await seedCustomer(fx.a, 'Invited Then Chatted');
      await seedActiveChat(fx.a, id, { assigneeId: fx.a.agentAccountId, lastAuthor: 'customer' });
      await seedInvite(fx.a, id);

      const rows = (await listTraffic()).filter((v) => v.customer_id === id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.activity).toBe('waiting');
      expect(rows[0]?.chatting_with).toMatchObject({ kind: 'human' });
      expect(rows[0]?.chat_id).not.toBeNull();
    });
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
