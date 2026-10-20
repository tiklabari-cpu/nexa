/**
 * Team queues in routing (tm 305.2 · SiyahTuş analysis AU-01, K14, ADR-08a
 * `docs/adr/routing-team-queues.md` §2.1–§2.3, §2.6).
 *
 * The queue used to be one line per workspace, drained until the first
 * conversation nobody could take — so one Responsible Gambling chat waiting
 * for a trained agent held up every Finance chat behind it, and a drained chat
 * went to any member of any of its access teams, expertise or not. What is
 * tested here is the queue as a team:
 *
 *   1. positions are per team, and the player sees their own team's
 *      (acceptance: "Oyuncunun gördüğü sıra kendi ekip kuyruğuna göre");
 *   2. one team stuck does not stop another team's drain (acceptance: "Finans'ta
 *      boş ajan varken Sorumlu Oyun kuyruğunda bekleyen sohbet Finans atamasını
 *      engellemez");
 *   3. the Responsible Gambling queue has no fallback team and gives nothing to
 *      an untrained agent — routing, drain, same-day return (acceptance: "hiçbir
 *      koşulda başka ekibe ya da eğitimsiz ajana atanmaz");
 *   4. a team's required expertise holds in the drain, not only at routing;
 *   5. urgent goes to the front of its own queue only (acceptance: "Acil
 *      öncelikli sohbet kendi kuyruğunun başına geçer");
 *   6. concurrent drains and enqueues: a slot is given once, positions stay
 *      distinct — on separate connections, so the race is real;
 *   7. a queued connection with no live team (an old replica's, a deleted
 *      team's) is adopted rather than stranded;
 *   8. the queue-order index exists and is valid (Prisma does not see it).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import {
  RoutingService,
  type RoutingDecision,
} from '../../src/services/routing/routing-service.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** The send path's idempotency cache is the only Redis user here. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

describe('team queues in routing (AU-01 · ADR-08a)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;

  let financeId: bigint;
  let rgId: bigint;
  let supportId: bigint;
  let rgTrainingId: bigint;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
    routing = new RoutingService();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await seedDefaultBrand(owner, fx.a.licenseId);
    await clearRateLimits(server.app);

    const licenseId = fx.a.licenseId;
    // Responsible Gambling first: the drain goes team by team in id order, so
    // a stuck RG queue is met before Finance's — a drain that stopped the
    // workspace at one team's miss would never reach Finance.
    rgId = (
      await owner.group.create({
        data: { licenseId, name: 'Sorumlu Oyun', topicRole: 'responsible_gambling' },
        select: { id: true },
      })
    ).id;
    financeId = (
      await owner.group.create({
        data: { licenseId, name: 'Finans', topicRole: 'finance' },
        select: { id: true },
      })
    ).id;
    supportId = (
      await owner.group.create({ data: { licenseId, name: 'Destek' }, select: { id: true } })
    ).id;
    rgTrainingId = (
      await owner.expertise.create({
        data: {
          licenseId,
          name: 'Sorumlu oyun eğitimi',
          slug: `rg-${generateShortId()}`.toLowerCase(),
        },
        select: { id: true },
      })
    ).id;
    await owner.groupExpertise.create({
      data: { licenseId, groupId: rgId, expertiseId: rgTrainingId },
    });

    // Pages pick the team; everything else, and every overflow, goes to Destek.
    await owner.routingRule.createMany({
      data: [
        {
          licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/finance'] },
          targetGroupId: financeId,
          priority: 1,
        },
        {
          licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/rg'] },
          targetGroupId: rgId,
          priority: 2,
        },
        { licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
      ],
    });

    adminToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:rw', 'customers:rw'],
    });
  });

  // -------------------------------------------------------------------------

  /** A member of one or more teams; `trained` holds the RG training. */
  async function addAgent(options: {
    groupIds: bigint[];
    limit?: number;
    status?: string;
    trained?: boolean;
    expertiseIds?: bigint[];
  }): Promise<string> {
    const licenseId = fx.a.licenseId;
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@team-queue.test`.toLowerCase(), name: 'Agent' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId,
        agentId: account.id,
        role: 'agent',
        routingStatus: options.status ?? 'accepting_chats',
        concurrentChatsLimit: options.limit ?? 6,
      },
    });
    for (const groupId of options.groupIds) {
      await owner.groupAgent.create({
        data: { licenseId, groupId, agentId: account.id, priority: 'normal' },
      });
    }
    const expertise = [...(options.expertiseIds ?? []), ...(options.trained ? [rgTrainingId] : [])];
    for (const expertiseId of expertise) {
      await owner.agentExpertise.create({ data: { licenseId, agentId: account.id, expertiseId } });
    }
    return account.id;
  }

  /** A chat `agentId` already holds (seeded, not routed). Returns the chat id. */
  async function holdChat(agentId: string, groupId: bigint): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `held-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
    });
    await owner.chatAccess.create({ data: { chatId, groupId } });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        assigneeId: agentId,
        groupId,
      },
    });
    return chatId;
  }

  /** A routed chat from the agent API, opened on `url`. */
  async function openChat(url: string): Promise<{ chatId: string; threadId: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const response = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: false, routing: { url } },
      auth(adminToken),
    );
    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; thread: { id: string } };
    return { chatId: body.id, threadId: body.thread.id };
  }

  async function deactivate(chatId: string): Promise<void> {
    const response = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(adminToken));
    expect(response.statusCode).toBe(200);
  }

  const threadOf = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { assigneeId: true, queuePosition: true, queueGroupId: true, priority: true },
    });

  /** One team's queue, front first: [thread id, position]. */
  const queueOf = async (groupId: bigint) =>
    (
      await owner.thread.findMany({
        where: {
          licenseId: fx.a.licenseId,
          active: true,
          assigneeId: null,
          queuePosition: { not: null },
          queueGroupId: groupId,
        },
        orderBy: { queuePosition: 'asc' },
        select: { id: true, queuePosition: true },
      })
    ).map((t) => [t.id, t.queuePosition] as const);

  const activeLoad = (agentId: string) =>
    owner.thread.count({ where: { licenseId: fx.a.licenseId, assigneeId: agentId, active: true } });

  const drain = () => withTenant(owner, ctx(), (tx) => routing.drainQueue(tx, fx.a.licenseId));

  // =========================================================================
  // 1. Positions are a team's
  // =========================================================================

  describe('positions', () => {
    it('numbers each team from 1, and names the team the chat waits in (FR-MOD-08.6.1)', async () => {
      const f = await addAgent({ groupIds: [financeId], limit: 1 });
      await holdChat(f, financeId);
      const r = await addAgent({ groupIds: [rgId], limit: 1, trained: true });
      await holdChat(r, rgId);

      const f1 = await openChat('https://casino.test/finance/withdraw');
      const g1 = await openChat('https://casino.test/rg/limits');
      const f2 = await openChat('https://casino.test/finance/deposit');
      const g2 = await openChat('https://casino.test/rg/pause');

      expect(await queueOf(financeId)).toEqual([
        [f1.threadId, 1],
        [f2.threadId, 2],
      ]);
      expect(await queueOf(rgId)).toEqual([
        [g1.threadId, 1],
        [g2.threadId, 2],
      ]);
      // The queue record names the same team (RP-04 reads it).
      const stay = await owner.queueEntry.findFirstOrThrow({ where: { threadId: g2.threadId } });
      expect(stay.groupId).toBe(rgId);
    });

    it('shows the player their place in their own team’s queue (FR-MOD-08.6.1)', async () => {
      const f = await addAgent({ groupIds: [financeId], limit: 1 });
      await holdChat(f, financeId);
      const r = await addAgent({ groupIds: [rgId], limit: 1, trained: true });
      await holdChat(r, rgId);
      // Two Finance chats wait already; the player's is Responsible Gambling's first.
      await openChat('https://casino.test/finance/a');
      await openChat('https://casino.test/finance/b');

      const token = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      expect(token.statusCode).toBe(200);
      const player = auth((token.json() as { token: string }).token);
      const sent = await server.post(
        '/customer/chat/events',
        { text: 'Limit koymak istiyorum', url: 'https://casino.test/rg/help' },
        player,
      );
      expect(sent.statusCode).toBe(201);
      expect((sent.json() as { queue_position: number | null }).queue_position).toBe(1);

      const widget = await server.get('/customer/chat', player);
      expect(widget.statusCode).toBe(200);
      expect(
        (widget.json() as { chat: { queue_position: number | null } }).chat.queue_position,
      ).toBe(1);
    });
  });

  // =========================================================================
  // 2. One team stuck does not stop another
  // =========================================================================

  describe('head-of-line blocking', () => {
    it('drains Finance while a Responsible Gambling chat ahead of it waits for a trained agent (FR-MOD-08.6.1)', async () => {
      // RG's only trained agent is full; Finance's agent is full too, for now.
      const trained = await addAgent({ groupIds: [rgId], limit: 1, trained: true });
      await holdChat(trained, rgId);
      const financeAgent = await addAgent({ groupIds: [financeId], limit: 1 });
      const held = await holdChat(financeAgent, financeId);

      // The RG chat queued first — under one workspace-wide line it was the head.
      const rgChat = await openChat('https://casino.test/rg/self-exclusion');
      const financeChat = await openChat('https://casino.test/finance/withdraw');
      expect((await threadOf(rgChat.threadId)).queuePosition).toBe(1);
      expect((await threadOf(financeChat.threadId)).queuePosition).toBe(1);

      await deactivate(held);

      expect((await threadOf(financeChat.threadId)).assigneeId).toBe(financeAgent);
      const rg = await threadOf(rgChat.threadId);
      expect(rg).toMatchObject({ assigneeId: null, queuePosition: 1, queueGroupId: rgId });
    });

    it('stops a team at its first miss and renumbers what is left', async () => {
      const agent = await addAgent({ groupIds: [financeId], limit: 2 });
      const held = [await holdChat(agent, financeId), await holdChat(agent, financeId)];
      const waiting = [
        await openChat('https://casino.test/finance/1'),
        await openChat('https://casino.test/finance/2'),
        await openChat('https://casino.test/finance/3'),
      ];

      await deactivate(held[0]!); // one slot: the head takes it, the rest move up

      expect((await threadOf(waiting[0]!.threadId)).assigneeId).toBe(agent);
      expect(await queueOf(financeId)).toEqual([
        [waiting[1]!.threadId, 1],
        [waiting[2]!.threadId, 2],
      ]);
    });
  });

  // =========================================================================
  // 3. Responsible Gambling: no fallback, trained agents only
  // =========================================================================

  describe('the Responsible Gambling queue', () => {
    it('never overflows to the fallback team, and never reaches an untrained member (FR-MOD-08.6.1 · FR-MOD-08.6.3)', async () => {
      // Destek (the fallback) has a free agent; RG has a free but untrained
      // member and a trained one who is full.
      const spare = await addAgent({ groupIds: [supportId] });
      const untrained = await addAgent({ groupIds: [rgId] });
      const trained = await addAgent({ groupIds: [rgId], limit: 1, trained: true });
      const held = await holdChat(trained, rgId);

      const rgChat = await openChat('https://casino.test/rg/self-exclusion');
      expect(await threadOf(rgChat.threadId)).toMatchObject({
        assigneeId: null,
        queuePosition: 1,
        queueGroupId: rgId,
      });

      // The untrained member and the fallback agent both have room; the drain
      // passes them by.
      expect((await drain()).map((a) => a.threadId)).not.toContain(rgChat.threadId);
      expect(await activeLoad(untrained)).toBe(0);
      expect(await activeLoad(spare)).toBe(0);

      // The trained agent frees up: the chat is theirs.
      await deactivate(held);
      expect((await threadOf(rgChat.threadId)).assigneeId).toBe(trained);
    });

    it('still overflows an ordinary team to the fallback team (ADR-08 regression)', async () => {
      const financeAgent = await addAgent({ groupIds: [financeId], limit: 1 });
      await holdChat(financeAgent, financeId);
      const spare = await addAgent({ groupIds: [supportId] });

      const chat = await openChat('https://casino.test/finance/withdraw');
      expect((await threadOf(chat.threadId)).assigneeId).toBe(spare);
    });

    it('does not hand a returning player’s RG connection back to the untrained agent they had earlier (ID-02-S5 · FR-MOD-08.6.3)', async () => {
      const financeAgent = await addAgent({ groupIds: [financeId] });
      const trained = await addAgent({ groupIds: [rgId], limit: 1, trained: true });
      await holdChat(trained, rgId);

      const token = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const player = auth((token.json() as { token: string }).token);
      const first = await server.post(
        '/customer/chat/events',
        { text: 'Çekim bekliyorum', url: 'https://casino.test/finance/withdraw' },
        player,
      );
      expect(first.statusCode).toBe(201);
      const chatId = (first.json() as { chat_id: string }).chat_id;
      const firstThread = await owner.thread.findFirstOrThrow({ where: { chatId, active: true } });
      expect(firstThread.assigneeId).toBe(financeAgent);
      await deactivate(chatId);

      // The same day, from the Responsible Gambling page: Finance's agent is
      // free and had them earlier — and is not trained.
      const again = await server.post(
        '/customer/chat/events',
        { text: 'Hesabımı kapatmak istiyorum', url: 'https://casino.test/rg/self-exclusion' },
        player,
      );
      expect(again.statusCode).toBe(201);
      const second = await owner.thread.findFirstOrThrow({ where: { chatId, active: true } });
      expect(second.id).not.toBe(firstThread.id);
      expect(second).toMatchObject({ assigneeId: null, queueGroupId: rgId, queuePosition: 1 });
    });
  });

  // =========================================================================
  // 4. A team's required expertise holds in the drain
  // =========================================================================

  describe('the team’s required expertise', () => {
    it('drains a waiting chat only to a member holding every area the team requires (FR-MOD-08.6.3)', async () => {
      const vip = await owner.expertise.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'VIP',
          slug: `vip-${generateShortId()}`.toLowerCase(),
        },
        select: { id: true },
      });
      await owner.groupExpertise.create({
        data: { licenseId: fx.a.licenseId, groupId: financeId, expertiseId: vip.id },
      });
      const qualified = await addAgent({ groupIds: [financeId], limit: 1, expertiseIds: [vip.id] });
      const held = await holdChat(qualified, financeId);
      // No fallback overflow for this one: Destek has nobody.
      const waiting = await openChat('https://casino.test/finance/vip');
      expect((await threadOf(waiting.threadId)).queueGroupId).toBe(financeId);

      // A member without the area comes online with room: not theirs.
      const plain = await addAgent({ groupIds: [financeId], status: 'not_accepting_chats' });
      const plainToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: plain,
        scopes: ['agents--my:rw'],
      });
      const online = await server.put(
        '/agents/me/routing-status',
        { routing_status: 'accepting_chats' },
        auth(plainToken),
      );
      expect(online.statusCode).toBe(200);
      expect((await threadOf(waiting.threadId)).assigneeId).toBeNull();

      await deactivate(held);
      expect((await threadOf(waiting.threadId)).assigneeId).toBe(qualified);
    });
  });

  // =========================================================================
  // 5. Priority within the team
  // =========================================================================

  describe('priority', () => {
    it('puts an urgent hand-over at the front of its own team’s queue and no other (FR-MOD-08.6.1)', async () => {
      const financeAgent = await addAgent({ groupIds: [financeId], limit: 1 });
      const held = await holdChat(financeAgent, financeId);
      const r = await addAgent({ groupIds: [rgId], limit: 1, trained: true });
      await holdChat(r, rgId);
      const n1 = await openChat('https://casino.test/finance/1');
      const n2 = await openChat('https://casino.test/finance/2');
      const other = await openChat('https://casino.test/rg/1');

      // A connection the AI holds, in Finance, handed over as urgent.
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'urgent' },
        select: { id: true },
      });
      const chatId = generateShortId();
      const threadId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
      });
      await owner.chatAccess.create({ data: { chatId, groupId: financeId } });
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: fx.a.licenseId,
          active: true,
          groupId: financeId,
          aiMode: 'ai',
        },
      });
      const handed = await new ChatService(appRole, NO_REDIS).handOverFromAi(
        ctx(),
        { chatId, threadId },
        'ai_handoff',
        { priority: 'urgent' },
      );
      expect(handed).toBe(true);

      expect(await threadOf(threadId)).toMatchObject({ priority: 2, queueGroupId: financeId });
      expect(await queueOf(financeId)).toEqual([
        [threadId, 1],
        [n1.threadId, 2],
        [n2.threadId, 3],
      ]);
      expect(await queueOf(rgId)).toEqual([[other.threadId, 1]]);

      // The next free Finance slot is the urgent chat's.
      await deactivate(held);
      expect((await threadOf(threadId)).assigneeId).toBe(financeAgent);
      expect(await queueOf(financeId)).toEqual([
        [n1.threadId, 1],
        [n2.threadId, 2],
      ]);
    });

    it('raises a priority and never lowers it', async () => {
      const financeAgent = await addAgent({ groupIds: [financeId], limit: 1 });
      await holdChat(financeAgent, financeId);
      const chat = await openChat('https://casino.test/finance/1');

      await withTenant(owner, ctx(), (tx) =>
        routing.raisePriority(tx, fx.a.licenseId, chat.threadId, 'high'),
      );
      await withTenant(owner, ctx(), (tx) =>
        routing.raisePriority(tx, fx.a.licenseId, chat.threadId, 'normal'),
      );
      expect((await threadOf(chat.threadId)).priority).toBe(1);
    });
  });

  // =========================================================================
  // 6. Concurrency
  // =========================================================================

  describe('concurrency', () => {
    /** Clients with a connection each, warmed, so their transactions really overlap. */
    async function clients(n: number): Promise<PrismaClient[]> {
      const list = Array.from({ length: n }, () => new PrismaClient({ datasourceUrl: APP_URL }));
      await Promise.all(list.map((c) => c.$queryRaw`SELECT 1`));
      return list;
    }

    /** What the caller of `route()` writes: a chat and its connection, as decided. */
    async function writeRouted(tx: TenantClient, decision: RoutingDecision): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `r-${generateShortId()}` },
        select: { id: true },
      });
      const chatId = generateShortId();
      const threadId = generateShortId();
      await tx.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
      });
      await tx.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: fx.a.licenseId,
          active: true,
          assigneeId: decision.assigneeId,
          groupId: decision.groupIds[0] ?? null,
          ...(decision.queuePosition !== null
            ? {
                queuePosition: decision.queuePosition,
                queuedAt: new Date(),
                queueGroupId: decision.queueGroupId,
              }
            : {}),
        },
      });
      return threadId;
    }

    /** Until some backend waits on an advisory lock (the team queue's). */
    async function untilAdvisoryWait(): Promise<void> {
      for (let i = 0; i < 100; i++) {
        const [row] = await owner.$queryRaw<Array<{ n: number }>>`
          SELECT COUNT(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`;
        if ((row?.n ?? 0) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('nobody waited for the team queue lock');
    }

    it('never gives one agent’s last slot twice — a drain passes over an agent being given a chat (FR-MOD-08.6.1)', async () => {
      // One agent in two teams, one slot; a chat waits in Destek.
      const both = await addAgent({ groupIds: [financeId, supportId], limit: 1 });
      const waiting = await withTenant(owner, ctx(), async (tx) => {
        const id = generateShortId();
        const customer = await tx.customer.create({
          data: { organizationId: fx.a.organizationId, name: 'w' },
          select: { id: true },
        });
        const chatId = generateShortId();
        await tx.chat.create({
          data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
        });
        await tx.thread.create({
          data: {
            id,
            chatId,
            licenseId: fx.a.licenseId,
            active: true,
            queuePosition: 1,
            queuedAt: new Date(),
            queueGroupId: supportId,
            groupId: supportId,
          },
        });
        return id;
      });

      const [c1, c2] = await clients(2);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let routed!: () => void;
      const routedOnce = new Promise<void>((resolve) => (routed = resolve));
      try {
        // T1 gives the slot to a new Finance chat and holds its transaction open.
        const t1 = withTenant(c1!, ctx(), async (tx) => {
          const decision = await routing.route(tx, fx.a.licenseId, {
            requestedGroupId: financeId,
          });
          await writeRouted(tx, decision);
          routed();
          await gate;
          return decision;
        });
        await routedOnce;
        // T2 drains Destek meanwhile: the same agent, the same slot.
        const drained = await withTenant(c2!, ctx(), (tx) =>
          routing.drainQueue(tx, fx.a.licenseId, { freed: [] }),
        );
        release();
        expect((await t1).assigneeId).toBe(both);
        expect(drained).toEqual([]);
      } finally {
        release();
        await Promise.all([c1!.$disconnect(), c2!.$disconnect()]);
      }

      expect(await activeLoad(both)).toBe(1);
      expect((await threadOf(waiting)).assigneeId).toBeNull();
    });

    it('numbers two chats queued at once in one team 1 and 2, not 1 and 1 (FR-MOD-08.6.1)', async () => {
      const [c1, c2] = await clients(2);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let queued!: () => void;
      const queuedOnce = new Promise<void>((resolve) => (queued = resolve));
      try {
        // Finance has nobody: both chats queue there.
        const t1 = withTenant(c1!, ctx(), async (tx) => {
          const decision = await routing.route(tx, fx.a.licenseId, {
            requestedGroupId: financeId,
          });
          await writeRouted(tx, decision);
          queued();
          await gate;
          return decision.queuePosition;
        });
        await queuedOnce;
        const t2 = withTenant(c2!, ctx(), async (tx) => {
          const decision = await routing.route(tx, fx.a.licenseId, {
            requestedGroupId: financeId,
          });
          await writeRouted(tx, decision);
          return decision.queuePosition;
        });
        await untilAdvisoryWait(); // T2 waits for Finance's queue, not for nothing
        release();
        expect([await t1, await t2]).toEqual([1, 2]);
      } finally {
        release();
        await Promise.all([c1!.$disconnect(), c2!.$disconnect()]);
      }
      expect((await queueOf(financeId)).map(([, position]) => position)).toEqual([1, 2]);
    });

    it('assigns each waiting chat once when two agents free up at the same moment (FR-MOD-08.6.1)', async () => {
      const x = await addAgent({ groupIds: [financeId], limit: 1 });
      const y = await addAgent({ groupIds: [financeId], limit: 1 });
      const heldX = await holdChat(x, financeId);
      const heldY = await holdChat(y, financeId);
      const waiting = [
        await openChat('https://casino.test/finance/1'),
        await openChat('https://casino.test/finance/2'),
        await openChat('https://casino.test/finance/3'),
      ];

      await Promise.all([deactivate(heldX), deactivate(heldY)]);

      const assignees = await Promise.all(
        waiting.map(async (w) => (await threadOf(w.threadId)).assigneeId),
      );
      expect(new Set(assignees.slice(0, 2))).toEqual(new Set([x, y]));
      expect(assignees[2]).toBeNull();
      expect(await activeLoad(x)).toBe(1);
      expect(await activeLoad(y)).toBe(1);
      expect(await queueOf(financeId)).toEqual([[waiting[2]!.threadId, 1]]);
      // Each drained chat has exactly one agent present.
      for (const w of waiting.slice(0, 2)) {
        const agents = await owner.chatUser.count({
          where: { chatId: w.chatId, userType: 'agent' },
        });
        expect(agents).toBe(1);
      }
    });
  });

  // =========================================================================
  // 7. Queued connections with no live team
  // =========================================================================

  describe('a queued connection with no live team', () => {
    /** A waiting connection as an old replica writes it: a position, no queue team. */
    async function legacyQueued(groupId: bigint, queueGroupId: bigint | null): Promise<string> {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `legacy-${generateShortId()}` },
        select: { id: true },
      });
      const chatId = generateShortId();
      const threadId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
      });
      await owner.chatAccess.create({ data: { chatId, groupId } });
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: fx.a.licenseId,
          active: true,
          queuePosition: 7,
          queuedAt: new Date(),
          groupId,
          queueGroupId,
        },
      });
      return threadId;
    }

    it('adopts one an old replica queued without a team into the team routing gave it', async () => {
      const agent = await addAgent({ groupIds: [financeId], limit: 1 });
      const held = await holdChat(agent, financeId);
      const legacy = await legacyQueued(financeId, null);

      await drain();
      expect(await threadOf(legacy)).toMatchObject({ queueGroupId: financeId, queuePosition: 1 });

      await deactivate(held);
      expect((await threadOf(legacy)).assigneeId).toBe(agent);
    });

    it('moves a deleted team’s waiting chat to the fallback team', async () => {
      const gone = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Kapanan' },
        select: { id: true },
      });
      const stranded = await legacyQueued(gone.id, gone.id);
      await owner.group.delete({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: gone.id } },
      });
      const spare = await addAgent({ groupIds: [supportId] });

      await drain();
      expect(await threadOf(stranded)).toMatchObject({ assigneeId: spare, queuePosition: null });
    });
  });

  // =========================================================================
  // 8. The queue-order index
  // =========================================================================

  it('has the team queue index, partial and valid (20261020150000)', async () => {
    const rows = await owner.$queryRaw<Array<{ indexdef: string; valid: boolean }>>`
      SELECT pg_get_indexdef(i.indexrelid) AS indexdef, i.indisvalid AS valid
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'threads_team_queue_idx'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.valid).toBe(true);
    expect(rows[0]!.indexdef).toContain('(license_id, queue_group_id, priority DESC, queued_at)');
    expect(rows[0]!.indexdef).toContain('WHERE');
  });
});
