/**
 * The inactivity sweep (WG-03 · tm 340.2): a connection its agent left
 * unanswered goes to someone else in the team, and a quiet one leaves its
 * agent's concurrent limit. What is pinned here:
 *
 *   1. The transfer: on time and not before, to someone else in the team, the
 *      transcript's `agent_unresponsive` line, the silent agent paused (or not,
 *      with the setting off), the pushes. What it leaves alone: an answered
 *      connection, one the AI is answering, one assigned before the column
 *      existed.
 *   2. The race: a reply that commits while the transfer waits for the chat's
 *      lock spares the connection; so does someone else taking it meanwhile.
 *   3. Nobody can take it: the front of the team's queue, the team's lead told
 *      (the admins and up for a team nobody leads); the required expertise
 *      kept; after two transfers it waits for the lead whoever is free.
 *   4. Inactive: a quiet connection leaves the limit — routing and the drain
 *      both count only lively ones — and its next message brings it back; the
 *      window turned off takes the mark back; a message racing the mark wins.
 *
 * Time: the sweep takes its own `now`, and connections are seeded with their
 * moments in the past, so a test puts it past (or short of) a window instead
 * of waiting three minutes.
 */
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { generateShortId, licenseChannel } from '@siyahtus/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '../../src/lib/tenant.js';
import { ChatInactivitySweeper } from '../../src/services/chat/chat-inactivity.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
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
/** The workspace's windows here: transfer after 3 minutes, inactive after 10. */
const TRANSFER_SECONDS = 180;
const INACTIVE_SECONDS = 600;

/** The send path's idempotency cache, unused here. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Envelope {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[]; customerId?: string; allAgents?: boolean };
  payload: Record<string, unknown>;
}

describe('the inactivity sweep (WG-03)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let chats: ChatService;
  let supportId: bigint;
  let adminToken: string;
  let listener: Redis;
  let pushes: Envelope[];

  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ago = (ms: number) => new Date(Date.now() - ms);

  /** One sweep pass, `ms` from now. */
  const sweep = (ms = 0) =>
    new ChatInactivitySweeper(appRole, chats).run({ now: new Date(Date.now() + ms) });

  const putWindows = (payload: Record<string, unknown>) =>
    server.app.inject({
      method: 'PUT',
      url: server.url('/settings/chat-timeout'),
      payload: { chat_timeout_seconds: null, ...payload },
      headers: auth(adminToken),
    });

  async function windows(payload: Record<string, unknown>): Promise<void> {
    const response = await putWindows(payload);
    expect(response.statusCode, response.body).toBe(200);
  }

  /** A Support member with the given capacity, status and expertise. */
  async function addAgent(
    options: { limit?: number; status?: string; lead?: boolean; expertiseId?: bigint } = {},
  ): Promise<string> {
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@inactivity.test`.toLowerCase(), name: 'Agent' },
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
        groupId: supportId,
        agentId: account.id,
        isLead: options.lead ?? false,
      },
    });
    if (options.expertiseId !== undefined) {
      await owner.agentExpertise.create({
        data: { licenseId: fx.a.licenseId, agentId: account.id, expertiseId: options.expertiseId },
      });
    }
    return account.id;
  }

  /**
   * A Support connection, seeded with its moments: an assignee given it at
   * `assignedAt`, or a place in the queue since `queuedAt`.
   */
  async function connection(
    options: {
      assignee?: string;
      assignedAt?: Date;
      createdAt?: Date;
      firstResponseAt?: Date;
      aiMode?: string;
      requiredExpertiseId?: bigint;
      transfers?: number;
      queuedAt?: Date;
    } = {},
  ): Promise<{ chatId: string; threadId: string; customerId: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
    });
    await owner.chatAccess.create({ data: { chatId, groupId: supportId } });
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        groupId: supportId,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        ...(options.assignee
          ? { assigneeId: options.assignee, assignedAt: options.assignedAt ?? new Date() }
          : {}),
        ...(options.queuedAt
          ? { queuePosition: 1, queuedAt: options.queuedAt, queueGroupId: supportId }
          : {}),
        ...(options.firstResponseAt ? { firstResponseAt: options.firstResponseAt } : {}),
        ...(options.aiMode ? { aiMode: options.aiMode } : {}),
        ...(options.requiredExpertiseId !== undefined
          ? { requiredExpertiseId: options.requiredExpertiseId }
          : {}),
        ...(options.transfers !== undefined ? { unresponsiveTransfers: options.transfers } : {}),
      },
    });
    if (options.assignee) {
      await owner.chatUser.create({
        data: { chatId, userId: options.assignee, userType: 'agent', present: true },
      });
    }
    return { chatId, threadId, customerId: customer.id };
  }

  const threadOf = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: {
        assigneeId: true,
        assignedAt: true,
        queuePosition: true,
        queueGroupId: true,
        queuedAt: true,
        unresponsiveTransfers: true,
        inactiveSince: true,
      },
    });
  const statusOf = async (agentId: string) =>
    (
      await owner.agentMembership.findUniqueOrThrow({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId } },
        select: { routingStatus: true },
      })
    ).routingStatus;
  const transferLines = (threadId: string) =>
    owner.event.findMany({
      where: { threadId, properties: { path: ['system_event'], equals: 'chat_transferred' } },
      orderBy: { createdAt: 'asc' },
      select: { authorType: true, authorId: true, recipients: true, properties: true },
    });

  /** The pushes so far, after the bus has had a moment to deliver them. */
  async function pushed(action: string): Promise<Envelope[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return pushes.filter((p) => p.action === action);
  }

  /** Wait until a statement matching `pattern` waits for a lock. */
  async function waitingOnLock(pattern: string): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      const [row] = await owner.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND query LIKE ${pattern}`;
      if ((row?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`nothing matching ${pattern} waited for a lock`);
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await seedDefaultBrand(owner, fx.a.licenseId);
    await clearRateLimits(server.app);

    // The fixture's own agents are in no team, so none of them takes a chat here.
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:rw', 'customers:rw', 'access_rules:rw'],
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
    await listener.subscribe(licenseChannel(fx.a.licenseId));
  });

  afterEach(async () => {
    await listener.quit();
  });

  // --- The setting -------------------------------------------------------------

  it('pauses a silent agent unless the workspace turns that off; a save that leaves it out keeps it', async () => {
    const read = async () =>
      (await server.get('/settings/chat-timeout', auth(adminToken))).json() as Record<
        string,
        unknown
      >;
    expect((await read())['pause_unresponsive_agents']).toBe(true);

    await windows({
      unanswered_transfer_seconds: TRANSFER_SECONDS,
      pause_unresponsive_agents: false,
    });
    expect(await read()).toMatchObject({
      unanswered_transfer_seconds: TRANSFER_SECONDS,
      pause_unresponsive_agents: false,
    });
    await windows({ unanswered_transfer_seconds: TRANSFER_SECONDS });
    expect((await read())['pause_unresponsive_agents']).toBe(false);

    const refused = await putWindows({ pause_unresponsive_agents: 'yes' });
    expect(refused.statusCode).toBe(400);
  });

  // --- 1. The transfer ------------------------------------------------------------

  it('passes an unanswered connection to someone else in the team once the window is over, and not before', async () => {
    await windows({
      unanswered_transfer_seconds: TRANSFER_SECONDS,
      inactive_after_seconds: INACTIVE_SECONDS,
    });
    const silent = await addAgent();
    const other = await addAgent();
    const { chatId, threadId, customerId } = await connection({
      assignee: silent,
      assignedAt: ago(150 * SECOND),
    });

    // 150 s into a 180 s window: nothing.
    expect((await sweep()).totals).toMatchObject({ transferred: 0, queued: 0 });
    expect((await threadOf(threadId)).assigneeId).toBe(silent);

    // One sweep interval and a little past the window: someone else has it.
    const report = await sweep(35 * SECOND);
    expect(report.totals).toMatchObject({ transferred: 1, queued: 0 });
    const moved = await threadOf(threadId);
    expect(moved).toMatchObject({
      assigneeId: other,
      queuePosition: null,
      unresponsiveTransfers: 1,
    });
    // The new agent's own wait starts now (the trigger's database clock).
    expect(Math.abs(moved.assignedAt!.getTime() - Date.now())).toBeLessThan(5 * SECOND);

    expect(await transferLines(threadId)).toEqual([
      {
        authorType: 'system',
        authorId: null,
        recipients: 'all',
        properties: {
          system_event: 'chat_transferred',
          reason: 'agent_unresponsive',
          outcome: 'assigned',
          group_id: Number(supportId),
          from_agent_id: silent,
          unresponsive_transfers: 1,
        },
      },
    ]);

    // The silent agent stops receiving chats, and the presence log says so.
    expect(await statusOf(silent)).toBe('not_accepting_chats');
    const presence = await owner.agentPresenceEvent.findMany({
      where: { licenseId: fx.a.licenseId, agentId: silent },
      select: { status: true },
    });
    expect(presence).toEqual([{ status: 'not_accepting_chats' }]);

    const [transferred] = await pushed('chat_transferred');
    expect(transferred?.payload).toMatchObject({
      chat_id: chatId,
      thread_id: threadId,
      requester_id: null,
      reason: 'agent_unresponsive',
      outcome: 'assigned',
      assignee_id: other,
      transferred_to: { group_ids: [Number(supportId)], agent_ids: [] },
    });
    expect(transferred?.audience.agentIds).toEqual(expect.arrayContaining([silent, other]));
    expect(transferred?.audience.customerId).toBe(customerId);
    const incoming = await pushed('incoming_chat');
    expect(incoming.map((p) => p.audience.agentIds)).toEqual([[other]]);
    const status = await pushed('routing_status_set');
    expect(status.map((p) => p.payload)).toEqual([
      { agent_id: silent, status: 'not_accepting_chats', reason: 'agent_unresponsive' },
    ]);
    expect(await pushed('chat_unanswered_alert')).toEqual([]);

    // The new agent's window starts over: the next pass leaves it.
    expect((await sweep(35 * SECOND)).totals.transferred).toBe(0);
    expect((await threadOf(threadId)).assigneeId).toBe(other);
  });

  it('keeps a silent agent available when the workspace turned pausing off', async () => {
    await windows({
      unanswered_transfer_seconds: TRANSFER_SECONDS,
      pause_unresponsive_agents: false,
    });
    const silent = await addAgent();
    const other = await addAgent();
    const { threadId } = await connection({ assignee: silent, assignedAt: ago(4 * MINUTE) });
    // The other agent is busier: least-loaded alone would give it back to the
    // silent one, who is still accepting chats — they are left out by name.
    for (let i = 0; i < 2; i += 1) {
      await connection({ assignee: other, firstResponseAt: new Date() });
    }

    expect((await sweep()).totals.transferred).toBe(1);
    expect((await threadOf(threadId)).assigneeId).toBe(other);
    expect(await statusOf(silent)).toBe('accepting_chats');
    expect(await owner.agentPresenceEvent.count({ where: { agentId: silent } })).toBe(0);
    expect(await pushed('routing_status_set')).toEqual([]);
  });

  it('leaves an answered connection, one the AI is answering, one assigned before the column existed — and does nothing with the window off', async () => {
    const silent = await addAgent();
    await addAgent();
    const stale = ago(30 * MINUTE);
    const answered = await connection({ assignee: silent, assignedAt: stale });
    const response = await server.post(
      `/chats/${answered.chatId}/events`,
      { type: 'message', text: 'Looking into it now.' },
      auth(adminToken),
    );
    expect(response.statusCode).toBe(201);
    const ai = await connection({ assignee: silent, assignedAt: stale, aiMode: 'ai' });
    const legacy = await connection({ assignee: silent, assignedAt: stale });
    await owner.$executeRaw`UPDATE threads SET assigned_at = NULL WHERE id = ${legacy.threadId}`;
    const waiting = await connection({ assignee: silent, assignedAt: stale });

    // Off: not even the one that qualifies.
    expect((await sweep()).totals.transferred).toBe(0);
    expect((await threadOf(waiting.threadId)).assigneeId).toBe(silent);

    await windows({
      unanswered_transfer_seconds: TRANSFER_SECONDS,
      pause_unresponsive_agents: false,
    });
    const report = await sweep();
    expect(report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString())).toMatchObject({
      unanswered: 1,
      transferred: 1,
    });
    for (const spared of [answered, ai, legacy]) {
      expect((await threadOf(spared.threadId)).assigneeId).toBe(silent);
      expect(await transferLines(spared.threadId)).toEqual([]);
    }
    expect((await threadOf(waiting.threadId)).assigneeId).not.toBe(silent);
  });

  // --- 2. The race -------------------------------------------------------------

  it('spares a connection whose first reply commits while the transfer waits for the chat lock', async () => {
    const silent = await addAgent();
    await addAgent();
    const { chatId, threadId } = await connection({
      assignee: silent,
      assignedAt: ago(4 * MINUTE),
    });
    const cutoff = ago(TRANSFER_SECONDS * SECOND);

    // The reply's transaction, by hand, in the order the send path writes:
    // the chat row, then the thread's counter, the event, the first reply.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const reply = owner.$transaction(
      async (tx) => {
        await tx.$executeRaw`UPDATE chats SET last_event_at = now() WHERE id = ${chatId}`;
        locked();
        await held;
        const [row] = await tx.$queryRaw<Array<{ event_sequence: number }>>`
          UPDATE threads SET event_sequence = event_sequence + 1 WHERE id = ${threadId}
          RETURNING event_sequence`;
        await tx.$executeRaw`
          INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_id, author_type, recipients)
          VALUES (${`${threadId}_${row!.event_sequence}`}, ${threadId}, ${chatId}, ${fx.a.licenseId},
                  'message', 'On it.', ${silent}, 'agent', 'all')`;
        await tx.$executeRaw`UPDATE threads SET first_response_at = now() WHERE id = ${threadId}`;
      },
      { timeout: 30_000 },
    );
    try {
      await lockTaken;
      const passOn = chats.passOnUnanswered(ctx(), { chatId, threadId, agentId: silent }, cutoff, {
        pauseAgent: true,
      });
      await waitingOnLock('%FOR NO KEY UPDATE%');
      release();
      await reply;
      expect(await passOn).toBeNull();
    } finally {
      release();
      await reply.catch(() => undefined);
    }
    expect((await threadOf(threadId)).assigneeId).toBe(silent);
    expect(await transferLines(threadId)).toEqual([]);
    expect(await statusOf(silent)).toBe('accepting_chats');
  });

  it('leaves a connection someone else took between the listing and the transfer', async () => {
    const silent = await addAgent();
    const taker = await addAgent();
    const { chatId, threadId } = await connection({
      assignee: silent,
      assignedAt: ago(4 * MINUTE),
    });
    await owner.thread.update({ where: { id: threadId }, data: { assigneeId: taker } });

    const passOn = await chats.passOnUnanswered(
      ctx(),
      { chatId, threadId, agentId: silent },
      ago(TRANSFER_SECONDS * SECOND),
      { pauseAgent: true },
    );
    expect(passOn).toBeNull();
    expect((await threadOf(threadId)).assigneeId).toBe(taker);
  });

  // --- 3. Nobody can take it -----------------------------------------------------

  it('puts it at the front of the team queue and tells the team lead when nobody else can take it', async () => {
    await windows({ unanswered_transfer_seconds: TRANSFER_SECONDS });
    const silent = await addAgent();
    const lead = await addAgent({ lead: true, status: 'not_accepting_chats' });
    const earlier = await connection({ queuedAt: ago(5 * MINUTE) });
    const { chatId, threadId } = await connection({
      assignee: silent,
      assignedAt: ago(4 * MINUTE),
    });

    const report = await sweep();
    expect(report.totals).toMatchObject({ transferred: 0, queued: 1 });

    const waiting = await threadOf(threadId);
    expect(waiting).toMatchObject({
      assigneeId: null,
      assignedAt: null,
      queueGroupId: supportId,
      queuePosition: 1,
      unresponsiveTransfers: 1,
    });
    // Ahead of the one that was waiting first.
    expect((await threadOf(earlier.threadId)).queuePosition).toBe(2);
    // Its stay starts now: the front is a place in the queue, not a wait.
    const stay = await owner.queueEntry.findFirstOrThrow({
      where: { threadId, leftAt: null },
      select: { enteredAt: true, groupId: true },
    });
    expect(stay.groupId).toBe(supportId);
    expect(Math.abs(stay.enteredAt.getTime() - Date.now())).toBeLessThan(5 * SECOND);
    expect(waiting.queuedAt!.getTime()).toBeLessThan(stay.enteredAt.getTime() - 4 * MINUTE);

    const [line] = await transferLines(threadId);
    expect(line?.properties).toMatchObject({ reason: 'agent_unresponsive', outcome: 'queued' });

    const alerts = await pushed('chat_unanswered_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.audience).toEqual({ agentIds: [lead] });
    expect(alerts[0]?.payload).toEqual({
      chat_id: chatId,
      thread_id: threadId,
      group_id: Number(supportId),
      agent_id: silent,
      reason: 'no_agent',
      transfers: 1,
      queue_position: 1,
    });
    const [transferred] = await pushed('chat_transferred');
    expect(transferred?.payload).toMatchObject({ outcome: 'queued', assignee_id: null });

    // Queued, it is no candidate: nobody holds it.
    expect((await sweep(10 * MINUTE)).totals.queued).toBe(0);
  });

  it("tells the workspace's admins and up when the team has no lead", async () => {
    await windows({ unanswered_transfer_seconds: TRANSFER_SECONDS });
    const silent = await addAgent();
    await connection({ assignee: silent, assignedAt: ago(4 * MINUTE) });

    expect((await sweep()).totals.queued).toBe(1);
    const [alert] = await pushed('chat_unanswered_alert');
    // The fixture's owner — not its plain agent, nor the silent one.
    expect(alert?.audience.agentIds).toContain(fx.a.ownerAccountId);
    expect(alert?.audience.agentIds).not.toContain(fx.a.agentAccountId);
    expect(alert?.audience.agentIds).not.toContain(silent);
  });

  it('keeps the expertise the connection requires: a trained agent or the queue, never anyone free', async () => {
    await windows({ unanswered_transfer_seconds: TRANSFER_SECONDS });
    const billing = await owner.expertise.create({
      data: { licenseId: fx.a.licenseId, name: 'Billing', slug: 'billing' },
      select: { id: true },
    });
    const silent = await addAgent({ expertiseId: billing.id });
    const untrained = await addAgent();
    const trained = await addAgent({ expertiseId: billing.id });
    const first = await connection({
      assignee: silent,
      assignedAt: ago(5 * MINUTE),
      requiredExpertiseId: billing.id,
    });
    const second = await connection({
      assignee: silent,
      assignedAt: ago(4 * MINUTE),
      requiredExpertiseId: billing.id,
    });
    // The trained agent has room for one more.
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: trained } },
      data: { concurrentChatsLimit: 1 },
    });

    expect((await sweep()).totals).toMatchObject({ transferred: 1, queued: 1 });
    // Longest waiting first: the first gets the trained agent's one slot.
    expect(await threadOf(first.threadId)).toMatchObject({ assigneeId: trained });
    expect(await threadOf(second.threadId)).toMatchObject({ assigneeId: null, queuePosition: 1 });
    expect(await owner.thread.count({ where: { assigneeId: untrained } })).toBe(0);
  });

  it('passes a connection on at most twice; the third time it waits for the lead whoever is free', async () => {
    await windows({ unanswered_transfer_seconds: TRANSFER_SECONDS });
    const agents = [await addAgent(), await addAgent(), await addAgent(), await addAgent()];
    const lead = await addAgent({ lead: true, status: 'not_accepting_chats' });
    const { threadId } = await connection({ assignee: agents[0], assignedAt: ago(4 * MINUTE) });

    const holders = [agents[0]];
    for (const pass of [1, 2]) {
      // Each holder's window runs from their own assignment.
      expect((await sweep((pass - 1) * 4 * MINUTE)).totals.transferred).toBe(1);
      const now = await threadOf(threadId);
      expect(now.unresponsiveTransfers).toBe(pass);
      expect(holders).not.toContain(now.assigneeId);
      holders.push(now.assigneeId!);
    }

    // A fourth agent is still free, and still does not get it.
    const report = await sweep(2 * 4 * MINUTE);
    expect(report.totals).toMatchObject({ transferred: 0, queued: 1 });
    expect(await threadOf(threadId)).toMatchObject({
      assigneeId: null,
      queuePosition: 1,
      unresponsiveTransfers: 3,
    });
    const free = agents.find((id) => !holders.includes(id))!;
    expect(await statusOf(free)).toBe('accepting_chats');
    const alerts = await pushed('chat_unanswered_alert');
    expect(alerts.map((a) => a.payload['reason'])).toEqual(['transfer_limit']);
    expect(alerts[0]?.audience).toEqual({ agentIds: [lead] });
    expect(alerts[0]?.payload).toMatchObject({ agent_id: holders[2], transfers: 3 });
  });

  // --- 4. Inactive -----------------------------------------------------------------

  it('takes a quiet connection off its agent’s limit until its next message', async () => {
    await windows({ inactive_after_seconds: INACTIVE_SECONDS });
    const agent = await addAgent({ limit: 1 });
    const quiet = await connection({
      assignee: agent,
      assignedAt: ago(20 * MINUTE),
      createdAt: ago(20 * MINUTE),
      firstResponseAt: ago(19 * MINUTE),
    });

    const report = await sweep();
    expect(report.totals).toMatchObject({ markedInactive: 1, clearedInactive: 0 });
    const marked = await threadOf(quiet.threadId);
    expect(marked.inactiveSince).not.toBeNull();
    expect(marked.assigneeId).toBe(agent);
    const [changed] = await pushed('chat_inactivity_changed');
    expect(changed?.payload).toEqual({
      chat_id: quiet.chatId,
      thread_id: quiet.threadId,
      inactive: true,
    });
    // The agents who see it; never the player.
    expect(changed?.audience).toEqual({ groupIds: [Number(supportId)], agentIds: [agent] });

    const list = await server.get('/chats?limit=50', auth(adminToken));
    const rows = (list.json() as { items: Array<{ id: string; inactive: boolean }> }).items;
    expect(rows.find((r) => r.id === quiet.chatId)?.inactive).toBe(true);

    // At a limit of one, the agent still takes the next chat: the quiet one
    // does not count. The second pass marks nothing new.
    const open = async () => {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `n-${generateShortId()}` },
        select: { id: true },
      });
      const response = await server.post(
        '/chats',
        { customer_id: customer.id, assign_to_me: false },
        auth(adminToken),
      );
      expect([200, 201]).toContain(response.statusCode);
      return (response.json() as { thread: { id: string } }).thread.id;
    };
    expect((await threadOf(await open())).assigneeId).toBe(agent);
    expect((await sweep()).totals.markedInactive).toBe(0);

    // A message makes it lively again, and it counts: the next chat waits.
    const message = await server.post(
      `/chats/${quiet.chatId}/events`,
      { type: 'message', text: 'Still there?' },
      auth(adminToken),
    );
    expect(message.statusCode).toBe(201);
    expect((await threadOf(quiet.threadId)).inactiveSince).toBeNull();
    const next = await threadOf(await open());
    expect(next).toMatchObject({ assigneeId: null, queuePosition: 1 });
  });

  it('hands the slot a quiet connection frees to the queue at once', async () => {
    await windows({ inactive_after_seconds: INACTIVE_SECONDS });
    const agent = await addAgent({ limit: 1 });
    const quiet = await connection({
      assignee: agent,
      assignedAt: ago(20 * MINUTE),
      createdAt: ago(20 * MINUTE),
      firstResponseAt: ago(19 * MINUTE),
    });
    const waiting = await connection({ queuedAt: ago(2 * MINUTE) });

    expect((await sweep()).totals.markedInactive).toBe(1);
    expect((await threadOf(quiet.threadId)).inactiveSince).not.toBeNull();
    expect(await threadOf(waiting.threadId)).toMatchObject({
      assigneeId: agent,
      queuePosition: null,
    });
    const incoming = await pushed('incoming_chat');
    expect(incoming.map((p) => p.payload['chat'])).toEqual([
      { id: waiting.chatId, thread: { id: waiting.threadId } },
    ]);
  });

  it('takes the mark back when the window is turned off or grows past the quiet', async () => {
    await windows({ inactive_after_seconds: INACTIVE_SECONDS });
    const agent = await addAgent();
    const longQuiet = await connection({
      assignee: agent,
      createdAt: ago(40 * MINUTE),
      firstResponseAt: ago(39 * MINUTE),
    });
    const shortQuiet = await connection({
      assignee: agent,
      createdAt: ago(15 * MINUTE),
      firstResponseAt: ago(14 * MINUTE),
    });
    expect((await sweep()).totals.markedInactive).toBe(2);

    // 30 minutes: the 15-minute quiet is no longer inactive, the 40-minute one still is.
    await windows({ inactive_after_seconds: 30 * 60 });
    expect((await sweep()).totals).toMatchObject({ markedInactive: 0, clearedInactive: 1 });
    expect((await threadOf(shortQuiet.threadId)).inactiveSince).toBeNull();
    expect((await threadOf(longQuiet.threadId)).inactiveSince).not.toBeNull();

    await windows({ inactive_after_seconds: null });
    expect((await sweep()).totals).toMatchObject({ markedInactive: 0, clearedInactive: 1 });
    expect((await threadOf(longQuiet.threadId)).inactiveSince).toBeNull();
    const changes = (await pushed('chat_inactivity_changed')).map((p) => p.payload);
    expect(changes.filter((p) => p['inactive'] === false)).toEqual([
      { chat_id: shortQuiet.chatId, thread_id: shortQuiet.threadId, inactive: false },
      { chat_id: longQuiet.chatId, thread_id: longQuiet.threadId, inactive: false },
    ]);
  });

  it('leaves unmarked a connection whose message commits while the mark waits for its row', async () => {
    const agent = await addAgent();
    const { chatId, threadId } = await connection({
      assignee: agent,
      createdAt: ago(20 * MINUTE),
      firstResponseAt: ago(19 * MINUTE),
    });

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const message = owner.$transaction(
      async (tx) => {
        const [row] = await tx.$queryRaw<Array<{ event_sequence: number }>>`
          UPDATE threads SET event_sequence = event_sequence + 1 WHERE id = ${threadId}
          RETURNING event_sequence`;
        locked();
        await held;
        await tx.$executeRaw`
          INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_id, author_type, recipients)
          VALUES (${`${threadId}_${row!.event_sequence}`}, ${threadId}, ${chatId}, ${fx.a.licenseId},
                  'message', 'Hello?', NULL, 'customer', 'all')`;
      },
      { timeout: 30_000 },
    );
    try {
      await lockTaken;
      const settle = chats.settleInactivity(ctx(), ago(INACTIVE_SECONDS * SECOND));
      await waitingOnLock('%inactive_since = now()%');
      release();
      await message;
      expect(await settle).toEqual({ marked: 0, cleared: 0 });
    } finally {
      release();
      await message.catch(() => undefined);
    }
    expect((await threadOf(threadId)).inactiveSince).toBeNull();
  });
});
