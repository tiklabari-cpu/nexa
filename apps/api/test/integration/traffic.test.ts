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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUPERVISION_LIVE_WINDOW_SECONDS,
  SupervisionService,
} from '../../src/services/traffic/supervision-service.js';
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
  const secondsAgo = (n: number): Date => new Date(Date.now() - n * 1000);

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

  /**
   * A watch on a conversation — the row `POST /chats/{id}/supervise` writes.
   * Seeded directly so the funnel can be exercised at every heartbeat age, and
   * (the case that matters) with a licence that does not own the chat.
   */
  async function seedSupervision(
    t: TenantFixture,
    chatId: string,
    agentId: string,
    lastSeenAt: Date = new Date(),
  ): Promise<void> {
    await owner.chatSupervision.create({
      data: { chatId, agentId, licenseId: t.licenseId, startedAt: lastSeenAt, lastSeenAt },
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

  afterEach(() => {
    vi.restoreAllMocks();
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

    it("never lets another workspace's supervision colour one of our rows", async () => {
      const id = await seedCustomer(fx.a, 'Mine, Watched By Nobody');
      const chatId = await seedActiveChat(fx.a, id, {
        assigneeId: fx.a.agentAccountId,
        lastAuthor: 'agent',
      });

      // The trap 13.2-c wrote a note about: the three foreign keys are checked
      // by the table owner, which is exempt from RLS, so a row may legitimately
      // point at *our* chat while carrying tenant B's licence. Nothing stops
      // such a row existing — what must hold is that reading the board under
      // A's session never sees it.
      await seedSupervision(fx.b, chatId, fx.b.agentAccountId);

      const row = (await listTraffic()).find((v) => v.customer_id === id);
      expect(row?.activity).toBe('chatting');
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

  // --- Supervised (13.2-d's rows → the funnel) -------------------------------

  describe('supervised', () => {
    it('ignores a watch whose heartbeat has gone stale', async () => {
      const id = await seedCustomer(fx.a, 'Watched By A Closed Tab');
      const chatId = await seedActiveChat(fx.a, id, {
        assigneeId: fx.a.agentAccountId,
        lastAuthor: 'agent',
      });
      await seedSupervision(
        fx.a,
        chatId,
        fx.a.agentAccountId,
        secondsAgo(SUPERVISION_LIVE_WINDOW_SECONDS + 30),
      );

      // The row is still there — an abandoned tab is not a watcher, and the
      // board must say so rather than claim someone is looking on forever.
      const row = (await listTraffic()).find((v) => v.customer_id === id);
      expect(row?.activity).toBe('chatting');
    });

    it('reports a watched conversation as supervised', async () => {
      const id = await seedCustomer(fx.a, 'Being Watched');
      const chatId = await seedActiveChat(fx.a, id, {
        assigneeId: fx.a.agentAccountId,
        lastAuthor: 'agent',
      });
      await seedSupervision(fx.a, chatId, fx.a.ownerAccountId);

      const rows = (await listTraffic()).filter((v) => v.customer_id === id);
      // One visitor, one bucket — supervision recolours the row, it never adds
      // a second one.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.activity).toBe('supervised');
      expect(rows[0]?.chat_id).toBe(chatId);
    });

    it('puts supervised ahead of waiting', async () => {
      const id = await seedCustomer(fx.a, 'Waiting And Watched');
      const chatId = await seedActiveChat(fx.a, id, {
        assigneeId: fx.a.agentAccountId,
        lastAuthor: 'customer',
      });
      await seedSupervision(fx.a, chatId, fx.a.ownerAccountId);

      // Without the watch this row reads `waiting`; being watched is the rarer
      // fact and nothing else on the row carries it.
      const row = (await listTraffic()).find((v) => v.customer_id === id);
      expect(row?.activity).toBe('supervised');
    });

    it('leaves a queued conversation queued while it is watched', async () => {
      await seedPersona(fx.a, 'Hazal');
      const id = await seedCustomer(fx.a, 'Queued And Watched');
      const chatId = await seedActiveChat(fx.a, id, { queuePosition: 0, lastAuthor: 'customer' });
      await seedSupervision(fx.a, chatId, fx.a.ownerAccountId);

      // Reading over the queue's shoulder does not answer anybody: the chat is
      // still unclaimed, and hiding it from the queue bucket would hide it from
      // the exact list a supervisor scans.
      const row = (await listTraffic()).find((v) => v.customer_id === id);
      expect(row?.activity).toBe('queued');
      expect(row?.chatting_with).toBeNull();
    });

    it('keeps naming who is actually answering while a supervisor watches', async () => {
      await seedPersona(fx.a, 'Hazal');
      const withHuman = await seedCustomer(fx.a, 'Watched, Human Answering');
      const humanChat = await seedActiveChat(fx.a, withHuman, {
        assigneeId: fx.a.agentAccountId,
        lastAuthor: 'agent',
      });
      await seedSupervision(fx.a, humanChat, fx.a.ownerAccountId);

      const withAi = await seedCustomer(fx.a, 'Watched, AI Answering');
      const aiChat = await seedActiveChat(fx.a, withAi, { lastAuthor: 'customer' });
      await seedSupervision(fx.a, aiChat, fx.a.ownerAccountId);

      // Watching is not answering, so the Chatting-with column is untouched by
      // this slice: the human still wins over the persona, and an unassigned
      // watched chat still names the persona.
      const rows = await listTraffic();
      expect(rows.find((v) => v.customer_id === withHuman)?.chatting_with).toMatchObject({
        kind: 'human',
        name: 'Agent a',
      });
      expect(rows.find((v) => v.customer_id === withAi)?.chatting_with).toMatchObject({
        kind: 'ai',
        name: 'Hazal',
      });
    });

    it('puts nobody on the board for a watch on a conversation that has ended', async () => {
      const id = await seedCustomer(fx.a, 'Watched After Closing');
      const chatId = await seedActiveChat(fx.a, id, { assigneeId: fx.a.agentAccountId });
      await owner.chat.update({ where: { id: chatId }, data: { active: false } });
      await seedSupervision(fx.a, chatId, fx.a.ownerAccountId);

      // Traffic is the *live* board. A supervisor reading an archived chat is
      // not a visitor on the site, and a supervision row must not resurrect one.
      const ids = (await listTraffic()).map((v) => v.customer_id);
      expect(ids).not.toContain(id);
    });

    it('reads every watch on the board in a single query (NFR-P2)', async () => {
      const liveByChat = vi.spyOn(SupervisionService.prototype, 'liveByChat');

      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const customerId = await seedCustomer(fx.a, `Watched ${i}`);
        const chatId = await seedActiveChat(fx.a, customerId, {
          assigneeId: fx.a.agentAccountId,
          lastAuthor: 'agent',
          createdAt: minutesAgo(i + 1),
        });
        await seedSupervision(fx.a, chatId, fx.a.ownerAccountId);
        ids.push(customerId);
      }

      const rows = await listTraffic();
      expect(rows.filter((v) => ids.includes(v.customer_id)).map((v) => v.activity)).toEqual([
        'supervised',
        'supervised',
        'supervised',
      ]);
      // One call carrying all three chat ids — a per-visitor lookup would show
      // up here as three calls of one id each.
      expect(liveByChat).toHaveBeenCalledTimes(1);
      expect(liveByChat.mock.calls[0]?.[2]).toHaveLength(3);
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
