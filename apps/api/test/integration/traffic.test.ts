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
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import {
  SUPERVISION_LIVE_WINDOW_SECONDS,
  SupervisionService,
} from '../../src/services/traffic/supervision-service.js';
import { TrafficService } from '../../src/services/traffic/traffic-service.js';
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
  async function seedCustomer(
    t: TenantFixture,
    name: string,
    opts: { email?: string; countryCode?: string; isLead?: boolean } = {},
  ): Promise<string> {
    const customer = await owner.customer.create({
      data: {
        organizationId: t.organizationId,
        name,
        ...(opts.email ? { email: opts.email } : {}),
        ...(opts.countryCode ? { countryCode: opts.countryCode } : {}),
        ...(opts.isLead !== undefined ? { isLead: opts.isLead } : {}),
      },
      select: { id: true },
    });
    return customer.id;
  }

  /** A recent visit — what puts a browsing visitor on the board. */
  async function seedVisit(
    t: TenantFixture,
    customerId: string,
    startedAt: Date,
    opts: { urls?: string[]; cameFrom?: string } = {},
  ): Promise<void> {
    const urls = opts.urls ?? ['https://shop.example/pricing'];
    await owner.visit.create({
      data: {
        customerId,
        licenseId: t.licenseId,
        pages: urls.map((url) => ({ url, at: startedAt.toISOString() })),
        ...(opts.cameFrom ? { cameFrom: opts.cameFrom } : {}),
        startedAt,
      },
    });
  }

  /** A team, and the `chat_access` row that routes a conversation to it. */
  async function seedGroup(t: TenantFixture, name: string): Promise<bigint> {
    const group = await owner.group.create({
      data: { licenseId: t.licenseId, name },
      select: { id: true },
    });
    return group.id;
  }

  async function routeToGroup(chatId: string, groupId: bigint): Promise<void> {
    await owner.chatAccess.create({ data: { chatId, groupId } });
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
    const id = await seedCustomer(fx.a, 'Browser', { email: 'browser@example.test' });
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
      const id = await seedCustomer(fx.a, 'Invited', { email: 'invited@example.test' });
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

  // --- Match all filters + Add filter (FR-MOD-13.2) ---------------------------

  describe('filters', () => {
    /** Every condition the caller sent has to hold; an absent one restricts nothing. */

    // --- Negative, first: a filter that is not understood must not be ignored.

    it('rejects an unknown filter key', async () => {
      // The `campaigns.ts` rule, applied to the query string: a typo has to be
      // a 400. Ignored, `country_cod=TR` would leave every country on a board
      // the supervisor believes they narrowed.
      const response = await server.get('/traffic?country_cod=TR', auth(readToken));
      expect(response.statusCode).toBe(400);
    });

    it('rejects an activity outside the funnel dictionary', async () => {
      const response = await server.get('/traffic?activity=lurking', auth(readToken));
      expect(response.statusCode).toBe(400);
    });

    it('rejects an is_lead that is not a boolean', async () => {
      // `Boolean('no')` is `true`, so a coercing parser would answer this with
      // the leads — the exact opposite of what was asked.
      const response = await server.get('/traffic?is_lead=no', auth(readToken));
      expect(response.statusCode).toBe(400);
    });

    it('rejects a country code that is not two letters', async () => {
      const response = await server.get('/traffic?country_code=TUR', auth(readToken));
      expect(response.statusCode).toBe(400);
    });

    // --- Cross-tenant, second (NFR-S4/S5).

    it("returns nothing for a group id belonging to another tenant", async () => {
      const mine = await seedCustomer(fx.a, 'Mine, In A Team');
      const chatId = await seedActiveChat(fx.a, mine, { assigneeId: fx.a.agentAccountId });
      await routeToGroup(chatId, await seedGroup(fx.a, 'Sales'));

      const theirGroup = await seedGroup(fx.b, 'Their Sales');
      const items = await listTraffic(`?group_id=${theirGroup}`);

      // Empty, not 404: a foreign id and an id of ours nobody is chatting from
      // have to be indistinguishable, or the parameter counts another
      // license's teams. What must never happen is our own rows coming back
      // for a team we were not asked about.
      expect(items).toEqual([]);
      expect(items.map((v) => v.customer_id)).not.toContain(mine);
    });

    it('never lets an unvalidated group id reach the visitor query', async () => {
      await seedActiveChat(fx.a, await seedCustomer(fx.a, 'Mine'), {
        assigneeId: fx.a.agentAccountId,
      });
      const theirGroup = await seedGroup(fx.b, 'Their Sales');

      // "Validated before it joins the query" is the rule, and this is what it
      // means concretely: a foreign id is answered by the group lookup alone
      // and never handed to `chat_access`, which carries no license column of
      // its own to be filtered by. Asserting the empty board is not enough —
      // that stays true even with the gate removed.
      const calls = await countQueries({ limit: 50, groupId: theirGroup });
      expect(calls.map((call) => call.name)).toEqual(['group.findFirst']);
    });

    // --- Regression: no filter is still the old board.

    it('restricts nothing when no filter is sent', async () => {
      const chatting = await seedCustomer(fx.a, 'Chatting', { countryCode: 'DE' });
      await seedActiveChat(fx.a, chatting, { assigneeId: fx.a.agentAccountId });
      const invited = await seedCustomer(fx.a, 'Invited');
      await seedInvite(fx.a, invited);
      const browsing = await seedCustomer(fx.a, 'Browsing', { isLead: true });
      await seedVisit(fx.a, browsing, minutesAgo(2));

      const ids = (await listTraffic()).map((v) => v.customer_id);
      expect(ids).toEqual(expect.arrayContaining([chatting, invited, browsing]));
    });

    // --- Each condition, on its own, narrows the board.

    it('narrows to a single funnel state', async () => {
      const chatting = await seedCustomer(fx.a, 'Chatting');
      await seedActiveChat(fx.a, chatting, { assigneeId: fx.a.agentAccountId });
      const browsing = await seedCustomer(fx.a, 'Browsing');
      await seedVisit(fx.a, browsing, minutesAgo(2));

      const items = await listTraffic('?activity=browsing');
      expect(items.map((v) => v.customer_id)).toEqual([browsing]);
    });

    it('keeps a state that is still filling the page behind the conversations', async () => {
      // The trap a naive "filter the finished page" would fall into: the
      // conversations come first, so asking for `browsing` alone must not hand
      // back a page of chats with everything removed from it.
      for (let i = 0; i < 3; i += 1) {
        const id = await seedCustomer(fx.a, `Chatting ${i}`);
        await seedActiveChat(fx.a, id, {
          assigneeId: fx.a.agentAccountId,
          createdAt: minutesAgo(i + 1),
        });
      }
      const browsing = await seedCustomer(fx.a, 'Browsing');
      await seedVisit(fx.a, browsing, minutesAgo(9));

      const items = await listTraffic('?limit=2&activity=browsing');
      expect(items.map((v) => v.customer_id)).toEqual([browsing]);
    });

    it('removes a filtered-out visitor rather than relabelling them', async () => {
      // Both of these are in two sources at once. Their bucket is decided by
      // precedence (a conversation beats an invitation beats a visit), so
      // filtering that bucket out has to remove them from the board — not move
      // them down to the bucket they were excluded from.
      const chatting = await seedCustomer(fx.a, 'Chatting, Also Seen Browsing');
      await seedActiveChat(fx.a, chatting, { assigneeId: fx.a.agentAccountId });
      await seedVisit(fx.a, chatting, minutesAgo(2));

      const invited = await seedCustomer(fx.a, 'Invited, Also Seen Browsing');
      await seedInvite(fx.a, invited);
      await seedVisit(fx.a, invited, minutesAgo(3));

      const reallyBrowsing = await seedCustomer(fx.a, 'Only Browsing');
      await seedVisit(fx.a, reallyBrowsing, minutesAgo(4));

      const ids = (await listTraffic('?activity=browsing')).map((v) => v.customer_id);
      expect(ids).toEqual([reallyBrowsing]);
    });

    it('unions the states when activity is repeated', async () => {
      const queued = await seedCustomer(fx.a, 'Queued');
      await seedActiveChat(fx.a, queued, { queuePosition: 0, lastAuthor: 'customer' });
      const browsing = await seedCustomer(fx.a, 'Browsing');
      await seedVisit(fx.a, browsing, minutesAgo(2));
      const invited = await seedCustomer(fx.a, 'Invited');
      await seedInvite(fx.a, invited);

      const ids = (await listTraffic('?activity=queued&activity=browsing')).map(
        (v) => v.customer_id,
      );
      expect(ids).toEqual(expect.arrayContaining([queued, browsing]));
      expect(ids).not.toContain(invited);
    });

    it('narrows by page url — including a visitor mid-conversation', async () => {
      const chattingOnPricing = await seedCustomer(fx.a, 'Chatting On Pricing');
      await seedActiveChat(fx.a, chattingOnPricing, { assigneeId: fx.a.agentAccountId });
      await seedVisit(fx.a, chattingOnPricing, minutesAgo(2), {
        urls: ['https://shop.example/PRICING'],
      });

      const browsingOnPricing = await seedCustomer(fx.a, 'Browsing On Pricing');
      await seedVisit(fx.a, browsingOnPricing, minutesAgo(3), {
        urls: ['https://shop.example/blog', 'https://shop.example/pricing'],
      });

      const browsingElsewhere = await seedCustomer(fx.a, 'Browsing On Blog');
      await seedVisit(fx.a, browsingElsewhere, minutesAgo(4), {
        urls: ['https://shop.example/blog'],
      });

      const ids = (await listTraffic('?page_url_contains=/pricing')).map((v) => v.customer_id);
      // A page condition is not a browsing-only condition: filtering only the
      // visits bucket would make `activity=chatting&page_url_contains=…` a
      // combination nobody can ever match. Case-insensitive, like the campaign
      // trigger that reads the same JSON.
      expect(ids).toEqual(expect.arrayContaining([chattingOnPricing, browsingOnPricing]));
      expect(ids).not.toContain(browsingElsewhere);
    });

    it('drops a visitor with no live visit from a page-url filter', async () => {
      const invitedNoVisit = await seedCustomer(fx.a, 'Invited, Never Seen Browsing');
      await seedInvite(fx.a, invitedNoVisit);

      // Nothing about this row can answer "which page are they on", and a
      // condition a row cannot answer is a condition it fails. Waving it
      // through would turn AND into "AND, except where I did not look".
      const ids = (await listTraffic('?page_url_contains=/pricing')).map((v) => v.customer_id);
      expect(ids).not.toContain(invitedNoVisit);
    });

    it('narrows by referrer', async () => {
      const fromGoogle = await seedCustomer(fx.a, 'From Google');
      await seedVisit(fx.a, fromGoogle, minutesAgo(2), { cameFrom: 'https://www.google.com/' });
      const fromNewsletter = await seedCustomer(fx.a, 'From Newsletter');
      await seedVisit(fx.a, fromNewsletter, minutesAgo(3), { cameFrom: 'https://mail.example/' });

      const ids = (await listTraffic('?came_from_contains=google')).map((v) => v.customer_id);
      expect(ids).toEqual([fromGoogle]);
      expect(ids).not.toContain(fromNewsletter);
    });

    it('narrows by country, case-insensitively', async () => {
      const turkish = await seedCustomer(fx.a, 'In Turkey', { countryCode: 'TR' });
      await seedVisit(fx.a, turkish, minutesAgo(2));
      const german = await seedCustomer(fx.a, 'In Germany', { countryCode: 'DE' });
      await seedVisit(fx.a, german, minutesAgo(3));

      const ids = (await listTraffic('?country_code=tr')).map((v) => v.customer_id);
      expect(ids).toEqual([turkish]);
      expect(ids).not.toContain(german);
    });

    it('narrows by the lead flag in both directions', async () => {
      const lead = await seedCustomer(fx.a, 'A Lead', { isLead: true });
      await seedVisit(fx.a, lead, minutesAgo(2));
      const notALead = await seedCustomer(fx.a, 'Not A Lead', { isLead: false });
      await seedVisit(fx.a, notALead, minutesAgo(3));

      expect((await listTraffic('?is_lead=true')).map((v) => v.customer_id)).toEqual([lead]);
      const others = (await listTraffic('?is_lead=false')).map((v) => v.customer_id);
      expect(others).toContain(notALead);
      expect(others).not.toContain(lead);
    });

    it('narrows to the team a conversation is routed to', async () => {
      const sales = await seedGroup(fx.a, 'Sales');
      const support = await seedGroup(fx.a, 'Support');

      const withSales = await seedCustomer(fx.a, 'Talking To Sales');
      const salesChat = await seedActiveChat(fx.a, withSales, { assigneeId: fx.a.agentAccountId });
      await routeToGroup(salesChat, sales);

      const withSupport = await seedCustomer(fx.a, 'Talking To Support');
      const supportChat = await seedActiveChat(fx.a, withSupport, {
        assigneeId: fx.a.agentAccountId,
      });
      await routeToGroup(supportChat, support);

      const browsing = await seedCustomer(fx.a, 'Browsing, In No Team');
      await seedVisit(fx.a, browsing, minutesAgo(2));

      const ids = (await listTraffic(`?group_id=${sales}`)).map((v) => v.customer_id);
      expect(ids).toEqual([withSales]);
      // A team is a fact a conversation carries. Someone merely browsing has
      // no team, so they fail the condition rather than passing it by default.
      expect(ids).not.toContain(withSupport);
      expect(ids).not.toContain(browsing);
    });

    // --- Match all: two conditions are AND'ed.

    it('drops a visitor that satisfies only one of two conditions', async () => {
      const both = await seedCustomer(fx.a, 'Turkish Lead', { countryCode: 'TR', isLead: true });
      await seedVisit(fx.a, both, minutesAgo(2));
      const onlyCountry = await seedCustomer(fx.a, 'Turkish, Not A Lead', {
        countryCode: 'TR',
        isLead: false,
      });
      await seedVisit(fx.a, onlyCountry, minutesAgo(3));
      const onlyLead = await seedCustomer(fx.a, 'German Lead', {
        countryCode: 'DE',
        isLead: true,
      });
      await seedVisit(fx.a, onlyLead, minutesAgo(4));

      const ids = (await listTraffic('?country_code=TR&is_lead=true')).map((v) => v.customer_id);
      expect(ids).toEqual([both]);
    });

    it("AND's a funnel state with a page url", async () => {
      const chattingOnPricing = await seedCustomer(fx.a, 'Chatting On Pricing');
      await seedActiveChat(fx.a, chattingOnPricing, { assigneeId: fx.a.agentAccountId });
      await seedVisit(fx.a, chattingOnPricing, minutesAgo(2), {
        urls: ['https://shop.example/pricing'],
      });

      const browsingOnPricing = await seedCustomer(fx.a, 'Browsing On Pricing');
      await seedVisit(fx.a, browsingOnPricing, minutesAgo(3), {
        urls: ['https://shop.example/pricing'],
      });

      const chattingElsewhere = await seedCustomer(fx.a, 'Chatting On Blog');
      await seedActiveChat(fx.a, chattingElsewhere, { assigneeId: fx.a.agentAccountId });
      await seedVisit(fx.a, chattingElsewhere, minutesAgo(4), {
        urls: ['https://shop.example/blog'],
      });

      const ids = (await listTraffic('?activity=chatting&page_url_contains=/pricing')).map(
        (v) => v.customer_id,
      );
      expect(ids).toEqual([chattingOnPricing]);
    });

    // --- NFR-P2: filtering must not cost another round trip.

    it('asks the database no more times when filtered, inside a bounded take', async () => {
      const chatting = await seedCustomer(fx.a, 'Chatting On Pricing');
      await seedActiveChat(fx.a, chatting, { assigneeId: fx.a.agentAccountId });
      await seedVisit(fx.a, chatting, minutesAgo(2), { urls: ['https://shop.example/pricing'] });
      const invited = await seedCustomer(fx.a, 'Invited');
      await seedInvite(fx.a, invited);
      const browsing = await seedCustomer(fx.a, 'Browsing On Pricing');
      await seedVisit(fx.a, browsing, minutesAgo(3), { urls: ['https://shop.example/pricing'] });

      const unfiltered = await countQueries({ limit: 50 });
      const filtered = await countQueries({ limit: 50, pageUrlContains: '/pricing' });

      // A page condition needs visit rows for *every* bucket, so the naive fix
      // is a fourth read. Reusing the read the board already does for its third
      // source is what keeps this equal — a per-visitor lookup or an extra
      // source would show up here immediately.
      expect(filtered.map((call) => call.name).sort()).toEqual(
        unfiltered.map((call) => call.name).sort(),
      );
      expect(filtered.filter((call) => call.name === 'visit.findMany')).toHaveLength(1);

      // And every read that scans a source carries a take, so no filter turns
      // one page into an unbounded scan. (The three that do not — the group
      // check, the assignees and the watchers — are bounded by their own shape:
      // one row, or an `IN` list built from the page.)
      const scans = filtered.filter((call) =>
        ['chat.findMany', 'campaignSend.findMany', 'visit.findMany'].includes(call.name),
      );
      expect(scans).toHaveLength(3);
      for (const scan of scans) {
        expect(scan.take).toBeGreaterThan(0);
        expect(scan.take).toBeLessThanOrEqual(500);
      }
    });
  });

  /**
   * Every query `listLive` issues, with the `take` it issued it with.
   *
   * The service is called directly through a counting stand-in for the tenant
   * client, because "how many round trips did that cost" is not a fact any HTTP
   * response carries.
   */
  interface CountedQuery {
    name: string;
    take: number | undefined;
  }

  async function countQueries(
    options: Parameters<TrafficService['listLive']>[2],
  ): Promise<CountedQuery[]> {
    const calls: CountedQuery[] = [];
    const models = [
      'chat',
      'account',
      'aiAgent',
      'chatSupervision',
      'campaignSend',
      'visit',
      'group',
    ] as const;

    await withTenant(
      owner,
      { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
      async (tx) => {
        const counting: Record<string, unknown> = Object.create(tx);
        for (const model of models) {
          const delegate = tx[model] as unknown as Record<string, unknown>;
          counting[model] = new Proxy(delegate, {
            get(target, property) {
              const value = Reflect.get(target, property, target);
              if (typeof value !== 'function' || typeof property !== 'string') return value;
              return (...args: unknown[]) => {
                const take = (args[0] as { take?: number } | undefined)?.take;
                calls.push({ name: `${model}.${property}`, take });
                return (value as (...a: unknown[]) => unknown).apply(target, args);
              };
            },
          });
        }

        await new TrafficService().listLive(
          counting as TenantClient,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
          options,
        );
      },
    );

    return calls;
  }

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
