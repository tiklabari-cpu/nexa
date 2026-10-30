/**
 * Manual assignment mode (WG-07 · tm 346): a team whose members choose their
 * conversations instead of routing choosing for them. What is pinned here:
 *
 *   1. The setting: `assignment_mode` on the team, `auto` by default; the
 *      Responsible Gambling team is never manual — the API refuses it with a
 *      400 whichever field moves, and a CHECK holds it under the API.
 *   2. Routing: a manual team's new conversation goes to nobody, free agents
 *      or not, and overflows nowhere; every member hears of it (`incoming_chat`
 *      to the team); the drain leaves the queue alone; a hand-off to the team
 *      queues it there.
 *   3. "Take" (`POST /chats/{id}/claim`): the first teammate has it — the
 *      assignment, the queue stay closed, `assigned_at`, the pushes; a second
 *      gets 409 `claimed`, also when the two race (the second waits on the
 *      first's row and loses); at the limit 409 `limit` with nothing written,
 *      also when one agent races two conversations for their last slot; not a
 *      member → 404; an automatic team's queue → 409 `not_waiting`.
 *   4. The sweep: a conversation nobody has taken for the unanswered window is
 *      reported to the team's leads once per stay, and stays where it is; a
 *      taken but unanswered one is not passed on.
 */
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { GROUP_ASSIGNMENT_MODES, generateShortId, licenseChannel } from '@siyahtus/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { ChatInactivitySweeper } from '../../src/services/chat/chat-inactivity.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import { RoutingService } from '../../src/services/routing/routing-service.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { silentLogger } from '../helpers/scheduler.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const WINDOW_SECONDS = 180;

const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Envelope {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[]; customerId?: string; allAgents?: boolean };
  payload: Record<string, unknown>;
}

describe('manual assignment mode (WG-07)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;
  let chats: ChatService;
  let bonusId: bigint;
  let supportId: bigint;
  let rgId: bigint;
  let adminToken: string;
  let listener: Redis;
  let pushes: Envelope[];

  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const patchGroup = (groupId: bigint, payload: Record<string, unknown>) =>
    server.app.inject({
      method: 'PATCH',
      url: server.url(`/groups/${groupId}`),
      payload,
      headers: auth(adminToken),
    });

  /** A member of `groupId` with their own token. */
  async function addAgent(
    groupId: bigint,
    options: { limit?: number; status?: string; lead?: boolean } = {},
  ): Promise<{ id: string; token: string }> {
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@manual.test`.toLowerCase(), name: 'Agent' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: account.id,
        role: options.lead ? 'team_lead' : 'agent',
        routingStatus: options.status ?? 'accepting_chats',
        concurrentChatsLimit: options.limit ?? 6,
      },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId,
        agentId: account.id,
        isLead: options.lead ?? false,
      },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: ['chats--access:rw'],
    });
    return { id: account.id, token };
  }

  /** A chat `agentId` already holds in `groupId` (seeded, not routed). */
  async function holdChat(agentId: string, groupId: bigint): Promise<void> {
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
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json() as { id: string; thread: { id: string } };
    return { chatId: body.id, threadId: body.thread.id };
  }

  const claim = (chatId: string, token: string) =>
    server.post(`/chats/${chatId}/claim`, undefined, auth(token));

  const threadOf = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: {
        assigneeId: true,
        assignedAt: true,
        groupId: true,
        queuePosition: true,
        queueGroupId: true,
        queuedAt: true,
        unclaimedAlertedAt: true,
      },
    });

  async function pushed(action: string): Promise<Envelope[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return pushes.filter((p) => p.action === action);
  }

  /** Wait until a statement matching `pattern` waits for a lock. */
  async function waitingOnLock(pattern: string): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const [row] = await owner.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database() AND query LIKE ${pattern}`;
      if ((row?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const seen = await owner.$queryRaw<
      Array<{ q: string; w: string | null }>
    >`SELECT left(query, 200) AS q, wait_event AS w FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle'`;
    throw new Error(`nothing matching ${pattern} waited for a lock: ${JSON.stringify(seen)}`);
  }

  /**
   * Take `threadId` for `agentId` in a transaction of its own, and hold it
   * open — locks and all — until `release()` is called.
   */
  function holdClaim(threadId: string, agentId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let taken!: (outcome: string) => void;
    const claimed = new Promise<string>((resolve) => (taken = resolve));
    const done = withTenant(
      appRole,
      ctx(),
      async (tx) => {
        const outcome = await routing.claim(tx, fx.a.licenseId, threadId, agentId);
        taken(outcome.outcome);
        await gate;
      },
      { timeoutMs: 20_000 },
    );
    return { claimed, release, done };
  }

  const sweep = (ms = 0) =>
    new ChatInactivitySweeper(appRole, chats).run({ now: new Date(Date.now() + ms) });

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

    bonusId = (
      await owner.group.create({
        data: { licenseId, name: 'Bonus', topicRole: 'bonus', assignmentMode: 'manual' },
        select: { id: true },
      })
    ).id;
    supportId = (
      await owner.group.create({ data: { licenseId, name: 'Destek' }, select: { id: true } })
    ).id;
    rgId = (
      await owner.group.create({
        data: { licenseId, name: 'Sorumlu Oyun', topicRole: 'responsible_gambling' },
        select: { id: true },
      })
    ).id;
    const training = await owner.expertise.create({
      data: { licenseId, name: 'RG', slug: `rg-${generateShortId()}`.toLowerCase() },
      select: { id: true },
    });
    await owner.groupExpertise.create({
      data: { licenseId, groupId: rgId, expertiseId: training.id },
    });
    await owner.routingRule.createMany({
      data: [
        {
          licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/bonus'] },
          targetGroupId: bonusId,
          priority: 1,
        },
        { licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
      ],
    });
    adminToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [
        'chats--all:rw',
        'agents--all:rw',
        'groups--all:rw',
        'customers:rw',
        'access_rules:rw',
      ],
    });
    chats = new ChatService(
      appRole,
      NO_REDIS,
      new RealtimePublisher(server.app.redis, silentLogger()),
    );
    pushes = [];
    listener = server.app.redis.duplicate();
    listener.on('message', (_channel: string, message: string) => {
      pushes.push(JSON.parse(message) as Envelope);
    });
    await listener.subscribe(licenseChannel(licenseId));
  });

  afterEach(async () => {
    await listener.quit();
  });

  // --- 1. The setting ---------------------------------------------------------

  describe('the setting', () => {
    it('is auto by default, saves manual and back, and records the change', async () => {
      const created = await server.post('/groups', { name: 'VIP' }, auth(adminToken));
      expect(created.statusCode, created.body).toBe(201);
      const team = created.json() as { id: number; assignment_mode: string };
      expect(team.assignment_mode).toBe('auto');

      const manual = await patchGroup(BigInt(team.id), { assignment_mode: 'manual' });
      expect(manual.statusCode, manual.body).toBe(200);
      expect((manual.json() as { assignment_mode: string }).assignment_mode).toBe('manual');
      const listed = (await server.get('/groups', auth(adminToken))).json() as {
        items: Array<{ id: number; assignment_mode: string }>;
      };
      expect(listed.items.find((g) => g.id === team.id)?.assignment_mode).toBe('manual');
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { action: 'group.updated', target: `group:${team.id}` },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry.metadata).toMatchObject({ assignment_mode: 'manual' });

      const back = await patchGroup(BigInt(team.id), { assignment_mode: 'auto' });
      expect((back.json() as { assignment_mode: string }).assignment_mode).toBe('auto');
      expect((await patchGroup(BigInt(team.id), { assignment_mode: 'first' })).statusCode).toBe(
        400,
      );
    });

    it('never makes the Responsible Gambling team manual, whichever field moves', async () => {
      const refused = await patchGroup(rgId, { assignment_mode: 'manual' });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        error: { type: 'validation', details: { reason: 'assignment_mode' } },
      });
      expect(
        (
          await owner.group.findUniqueOrThrow({
            where: { licenseId_id: { licenseId: fx.a.licenseId, id: rgId } },
          })
        ).assignmentMode,
      ).toBe('auto');

      // A manual team is not given the role either — nor is one made that way.
      const vip = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'VIP', assignmentMode: 'manual' },
        select: { id: true },
      });
      await owner.group.update({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: rgId } },
        data: { topicRole: null },
      });
      const training = await owner.groupExpertise.findFirstOrThrow({ where: { groupId: rgId } });
      const role = await patchGroup(vip.id, {
        topic_role: 'responsible_gambling',
        required_expertise_ids: [Number(training.expertiseId)],
      });
      expect(role.statusCode).toBe(400);
      expect(role.json()).toMatchObject({ error: { details: { reason: 'assignment_mode' } } });
      const create = await server.post(
        '/groups',
        {
          name: 'RG 2',
          topic_role: 'responsible_gambling',
          assignment_mode: 'manual',
          required_expertise_ids: [Number(training.expertiseId)],
        },
        auth(adminToken),
      );
      expect(create.statusCode).toBe(400);
    });

    it('holds both rules in the database too', async () => {
      const values = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'groups_assignment_mode_check'`;
      for (const mode of GROUP_ASSIGNMENT_MODES) expect(values[0]?.def).toContain(`'${mode}'`);
      await expect(
        owner.$executeRaw`UPDATE groups SET assignment_mode = 'first' WHERE id = ${supportId}`,
      ).rejects.toThrow(/groups_assignment_mode_check/);
      await expect(
        owner.$executeRaw`UPDATE groups SET assignment_mode = 'manual' WHERE id = ${rgId}`,
      ).rejects.toThrow(/groups_rg_assignment_mode_check/);
    });
  });

  // --- 2. Routing ---------------------------------------------------------------

  describe('routing', () => {
    it('gives a manual team’s conversation to nobody and tells every member', async () => {
      const a = await addAgent(bonusId);
      await addAgent(bonusId);
      // The fallback team has someone free: nothing overflows there.
      await addAgent(supportId);

      const { chatId, threadId } = await openChat('https://casino.test/bonus/claim');
      expect(await threadOf(threadId)).toMatchObject({
        assigneeId: null,
        queuePosition: 1,
        queueGroupId: bonusId,
      });
      const incoming = (await pushed('incoming_chat')).filter(
        (p) => (p.payload['chat'] as { id?: string } | undefined)?.id === chatId,
      );
      expect(incoming).toHaveLength(1);
      expect(incoming[0]!.audience.groupIds).toEqual([Number(bonusId)]);

      // Capacity frees up and the queue drains: a manual queue is left alone.
      await withTenant(owner, ctx(), (tx) =>
        routing.drainQueue(tx, fx.a.licenseId, { freed: [a.id] }),
      );
      expect((await threadOf(threadId)).assigneeId).toBeNull();
    });

    it('queues a hand-off to a manual team rather than choosing a member', async () => {
      await addAgent(bonusId);
      await addAgent(supportId);
      const { threadId } = await openChat('https://casino.test/home');
      const before = await threadOf(threadId);
      expect(before.assigneeId).not.toBeNull();

      const handOff = await withTenant(owner, ctx(), (tx) =>
        routing.assignWithinGroup(tx, fx.a.licenseId, bonusId, threadId),
      );
      expect(handOff.outcome).toBe('queued');
      expect(await threadOf(threadId)).toMatchObject({
        assigneeId: null,
        queueGroupId: bonusId,
        queuePosition: 1,
      });
    });
  });

  // --- 3. Take --------------------------------------------------------------------

  describe('take', () => {
    it('gives the conversation to the first teammate and refuses the second (FR-MOD-08.6.1)', async () => {
      const a = await addAgent(bonusId);
      const b = await addAgent(bonusId);
      const { chatId, threadId } = await openChat('https://casino.test/bonus/a');
      const behind = await openChat('https://casino.test/bonus/b');

      const taken = await claim(chatId, a.token);
      expect(taken.statusCode, taken.body).toBe(200);
      const after = await threadOf(threadId);
      expect(after).toMatchObject({
        assigneeId: a.id,
        groupId: bonusId,
        queuePosition: null,
        queueGroupId: null,
      });
      expect(after.assignedAt).not.toBeNull();
      // The one behind it moved up.
      expect((await threadOf(behind.threadId)).queuePosition).toBe(1);
      const stay = await owner.queueEntry.findFirstOrThrow({ where: { threadId } });
      expect(stay).toMatchObject({ outcome: 'assigned', groupId: bonusId });
      expect(stay.leftAt).not.toBeNull();

      const incoming = (await pushed('incoming_chat')).filter(
        (p) => (p.payload['chat'] as { id?: string } | undefined)?.id === chatId,
      );
      expect(incoming.some((p) => p.audience.agentIds?.includes(a.id))).toBe(true);
      const moved = (await pushed('chat_transferred')).find((p) => p.payload['chat_id'] === chatId);
      expect(moved?.payload).toMatchObject({
        reason: 'manual',
        outcome: 'assigned',
        assignee_id: a.id,
        requester_id: a.id,
      });
      expect(moved?.audience.groupIds).toContain(Number(bonusId));

      const second = await claim(chatId, b.token);
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        error: { type: 'chat_claim_refused', details: { reason: 'claimed' } },
      });
      expect((await threadOf(threadId)).assigneeId).toBe(a.id);
    });

    it('lets exactly one of two agents taking it at once have it (FR-MOD-08.6.1)', async () => {
      const a = await addAgent(bonusId);
      const b = await addAgent(bonusId);
      const { chatId, threadId } = await openChat('https://casino.test/bonus/race');

      // A has taken it and not committed; B's take waits on the row.
      const held = holdClaim(threadId, a.id);
      try {
        expect(await held.claimed).toBe('claimed');
        const racing = claim(chatId, b.token);
        await waitingOnLock('%UPDATE threads%assignee_id%');
        held.release();
        await held.done;
        const loser = await racing;
        expect(loser.statusCode).toBe(409);
        expect(loser.json()).toMatchObject({ error: { details: { reason: 'claimed' } } });
      } finally {
        held.release();
        await held.done.catch(() => undefined);
      }
      expect((await threadOf(threadId)).assigneeId).toBe(a.id);
      expect(await owner.queueEntry.count({ where: { threadId, outcome: 'assigned' } })).toBe(1);
    });

    it('refuses an agent at their limit and writes nothing — not accepting chats does not matter', async () => {
      const full = await addAgent(bonusId, { limit: 1, status: 'not_accepting_chats' });
      await holdChat(full.id, supportId);
      const { chatId, threadId } = await openChat('https://casino.test/bonus/full');

      const refused = await claim(chatId, full.token);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        error: { type: 'chat_claim_refused', details: { reason: 'limit' } },
      });
      expect(await threadOf(threadId)).toMatchObject({
        assigneeId: null,
        queuePosition: 1,
        queueGroupId: bonusId,
      });
      expect(await owner.queueEntry.count({ where: { threadId, leftAt: null } })).toBe(1);

      // One slot free, and they are not accepting chats: they may still choose.
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: full.id } },
        data: { concurrentChatsLimit: 2 },
      });
      expect((await claim(chatId, full.token)).statusCode).toBe(200);
    });

    it('gives an agent racing two conversations for their last slot only one', async () => {
      // Two manual teams, so the first take's renumber does not touch the
      // second conversation's row: the race is the agent's membership row.
      const licenseId = fx.a.licenseId;
      const vipId = (
        await owner.group.create({
          data: { licenseId, name: 'VIP', assignmentMode: 'manual' },
          select: { id: true },
        })
      ).id;
      await owner.routingRule.create({
        data: {
          licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/vip'] },
          targetGroupId: vipId,
          priority: 2,
        },
      });
      const agent = await addAgent(bonusId, { limit: 1 });
      await owner.groupAgent.create({ data: { licenseId, groupId: vipId, agentId: agent.id } });
      const first = await openChat('https://casino.test/bonus/one');
      const second = await openChat('https://casino.test/vip/two');

      // The first take holds the agent's membership row; the second waits on it.
      const held = holdClaim(first.threadId, agent.id);
      try {
        expect(await held.claimed).toBe('claimed');
        const racing = claim(second.chatId, agent.token);
        await waitingOnLock('%agent_memberships%FOR UPDATE%');
        held.release();
        await held.done;
        const refused = await racing;
        expect(refused.statusCode).toBe(409);
        expect(refused.json()).toMatchObject({ error: { details: { reason: 'limit' } } });
      } finally {
        held.release();
        await held.done.catch(() => undefined);
      }
      expect((await threadOf(second.threadId)).assigneeId).toBeNull();
      expect(await owner.thread.count({ where: { assigneeId: agent.id, active: true } })).toBe(1);
    });

    it('answers someone outside the team as for an unseen chat, and an automatic queue as not waiting', async () => {
      await addAgent(bonusId);
      const outsider = await addAgent(supportId, { limit: 1 });
      const { chatId } = await openChat('https://casino.test/bonus/x');
      expect((await claim(chatId, outsider.token)).statusCode).toBe(404);

      // Destek is automatic: its only member is full, so the chat waits there.
      await holdChat(outsider.id, supportId);
      const waiting = await openChat('https://casino.test/home');
      const automatic = await claim(waiting.chatId, adminToken);
      expect(automatic.statusCode).toBe(409);
      expect(automatic.json()).toMatchObject({ error: { details: { reason: 'not_waiting' } } });
    });
  });

  // --- 4. The sweep -------------------------------------------------------------

  describe('the sweep', () => {
    async function windows(): Promise<void> {
      const response = await server.app.inject({
        method: 'PUT',
        url: server.url('/settings/chat-timeout'),
        payload: { chat_timeout_seconds: null, unanswered_transfer_seconds: WINDOW_SECONDS },
        headers: auth(adminToken),
      });
      expect(response.statusCode, response.body).toBe(200);
    }

    it('tells the leads once when nobody took a conversation in time, and leaves it in place', async () => {
      await windows();
      const lead = await addAgent(bonusId, { lead: true });
      await addAgent(bonusId);
      const { chatId, threadId } = await openChat('https://casino.test/bonus/slow');

      expect((await sweep(2 * MINUTE)).totals).toMatchObject({ unclaimed: 0 });
      const report = await sweep(WINDOW_SECONDS * SECOND + 30 * SECOND);
      expect(report.totals).toMatchObject({ unclaimed: 1, transferred: 0, queued: 0 });
      const after = await threadOf(threadId);
      expect(after).toMatchObject({ assigneeId: null, queuePosition: 1, queueGroupId: bonusId });
      expect(after.unclaimedAlertedAt).not.toBeNull();

      const alerts = (await pushed('chat_unanswered_alert')).filter(
        (p) => p.payload['chat_id'] === chatId,
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.audience.agentIds).toEqual([lead.id]);
      expect(alerts[0]!.payload).toMatchObject({
        reason: 'unclaimed',
        agent_id: null,
        group_id: Number(bonusId),
        queue_position: 1,
      });

      // The same stay is not reported twice.
      expect((await sweep(10 * MINUTE)).totals).toMatchObject({ unclaimed: 0 });
    });

    it('does not pass on a conversation someone took and has not answered', async () => {
      await windows();
      const a = await addAgent(bonusId);
      await addAgent(bonusId);
      const { chatId, threadId } = await openChat('https://casino.test/bonus/taken');
      expect((await claim(chatId, a.token)).statusCode).toBe(200);
      await owner.thread.update({
        where: { id: threadId },
        data: { assignedAt: new Date(Date.now() - 10 * MINUTE) },
      });

      expect((await sweep(MINUTE)).totals).toMatchObject({
        transferred: 0,
        queued: 0,
        unclaimed: 0,
      });
      expect((await threadOf(threadId)).assigneeId).toBe(a.id);
    });
  });
});
