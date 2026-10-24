/**
 * `threads.assigned_at` and the other WG-03 columns (tm 340.1).
 *
 * The inactivity sweep (tm 340.2) asks "assigned, not answered, since when?",
 * so every way a connection gets an agent has to leave that moment behind. The
 * trigger `threads_assigned_at` stamps it on any write that changes
 * `assignee_id`; what has to hold, each on its own:
 *
 *   1. Every assignment path stamps it — opened to an agent, drained from the
 *      queue, transferred to an agent or a team, taken over, the AI handing a
 *      connection it opened AI-first to a person.
 *   2. Losing the assignee clears it (a team transfer nobody free can take
 *      waits in the queue); a write that sets it itself keeps its value.
 *   3. The AI handing over a connection its agent already held moves it to the
 *      hand-over: that agent's wait for a first reply starts there.
 *   4. The list row says a connection is inactive (`inactive_since`), and the
 *      database refuses a negative transfer count.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@siyahtus/types';
import type { TenantContext } from '../../src/lib/tenant.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const HOUR = 3_600_000;

const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

describe('threads.assigned_at (WG-03)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  let supportId: bigint;
  let adminToken: string;

  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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

    // The fixture's own agents are in no team, so they never take a routed chat.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    supportId = support.id;
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:rw', 'customers:rw'],
    });
  });

  /** A Support member with the given capacity and status. */
  async function addAgent(options: { limit?: number; status?: string } = {}): Promise<string> {
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@assigned.test`.toLowerCase(), name: 'Agent' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: account.id,
        role: 'agent',
        routingStatus: options.status ?? 'accepting_chats',
        concurrentChatsLimit: options.limit ?? 6,
      },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: supportId,
        agentId: account.id,
        priority: 'normal',
      },
    });
    return account.id;
  }

  /** A chat started from the agent API for a fresh customer, routed (not self-assigned). */
  async function startChat(): Promise<{ chatId: string; threadId: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const response = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: false },
      auth(adminToken),
    );
    expect([200, 201]).toContain(response.statusCode);
    const body = response.json() as { id: string; thread: { id: string } };
    return { chatId: body.id, threadId: body.thread.id };
  }

  /** A connection the AI holds in Support, optionally already someone's. */
  async function aiConnection(
    assignee: { id: string; at: Date } | null,
  ): Promise<{ chatId: string; threadId: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `ai-${generateShortId()}` },
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
        aiMode: 'ai',
        ...(assignee ? { assigneeId: assignee.id, assignedAt: assignee.at } : {}),
      },
    });
    return { chatId, threadId };
  }

  const threadOf = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { assigneeId: true, assignedAt: true, createdAt: true, queuePosition: true },
    });

  // --- 1. Every assignment path stamps it -----------------------------------

  it('stamps a connection opened to an agent with the moment it opened', async () => {
    const agent = await addAgent();
    const opened = await startChat();

    const thread = await threadOf(opened.threadId);
    expect(thread.assigneeId).toBe(agent);
    // The trigger reads the database's clock and `created_at` the API's (Prisma
    // fills it in), so the two agree to the clock skew, not to the microsecond.
    expect(Math.abs(thread.assignedAt!.getTime() - thread.createdAt.getTime())).toBeLessThan(5_000);
  });

  it('leaves a waiting connection unstamped, and stamps it when the queue hands it out', async () => {
    const agent = await addAgent({ limit: 1 });
    const live = await startChat();
    const waiting = await startChat();
    const queued = await threadOf(waiting.threadId);
    expect(queued.queuePosition).toBe(1);
    expect(queued.assignedAt).toBeNull();

    // Closing the live one frees the agent, and the drain gives them the next.
    const closed = await server.post(
      `/chats/${live.chatId}/deactivate`,
      undefined,
      auth(adminToken),
    );
    expect(closed.statusCode).toBe(200);

    const drained = await threadOf(waiting.threadId);
    expect(drained.assigneeId).toBe(agent);
    expect(drained.assignedAt!.getTime()).toBeGreaterThan(drained.createdAt.getTime());
  });

  it('restamps a transfer to a named agent', async () => {
    const first = await addAgent();
    const opened = await startChat();
    const before = await threadOf(opened.threadId);
    expect(before.assigneeId).toBe(first);

    const second = await addAgent();
    const moved = await server.post(
      `/chats/${opened.chatId}/transfer`,
      { agent_id: second },
      auth(adminToken),
    );
    expect(moved.statusCode).toBe(200);

    const after = await threadOf(opened.threadId);
    expect(after.assigneeId).toBe(second);
    expect(after.assignedAt!.getTime()).toBeGreaterThan(before.assignedAt!.getTime());
  });

  it('restamps a transfer to a team someone free in it takes', async () => {
    const first = await addAgent();
    const opened = await startChat();
    const before = await threadOf(opened.threadId);
    expect(before.assigneeId).toBe(first);

    const second = await addAgent();
    const moved = await server.post(
      `/chats/${opened.chatId}/transfer`,
      { group_id: Number(supportId) },
      auth(adminToken),
    );
    expect(moved.statusCode).toBe(200);

    const after = await threadOf(opened.threadId);
    expect(after.assigneeId).toBe(second);
    expect(after.assignedAt!.getTime()).toBeGreaterThan(before.assignedAt!.getTime());
  });

  it('restamps a takeover with the supervisor', async () => {
    await addAgent();
    const opened = await startChat();
    const before = await threadOf(opened.threadId);

    const seized = await server.post(
      `/chats/${opened.chatId}/takeover`,
      { reason: 'Coaching' },
      auth(adminToken),
    );
    expect(seized.statusCode).toBe(200);

    const after = await threadOf(opened.threadId);
    expect(after.assigneeId).toBe(fx.a.ownerAccountId);
    expect(after.assignedAt!.getTime()).toBeGreaterThan(before.assignedAt!.getTime());
  });

  it('stamps an AI-first connection when the AI hands it to a person', async () => {
    const agent = await addAgent();
    const ai = await aiConnection(null);
    expect((await threadOf(ai.threadId)).assignedAt).toBeNull();

    const handed = await new ChatService(appRole, NO_REDIS).handOverFromAi(ctx(), ai, 'ai_handoff');
    expect(handed).toBe(true);

    const after = await threadOf(ai.threadId);
    expect(after.assigneeId).toBe(agent);
    expect(after.assignedAt).not.toBeNull();
  });

  // --- 2. Clearing, and an explicit value -----------------------------------

  it('clears it when a team transfer nobody free can take sends the connection back to the queue', async () => {
    const only = await addAgent();
    const opened = await startChat();
    expect((await threadOf(opened.threadId)).assigneeId).toBe(only);

    // The person handing it on and whoever held it are both left out, so the
    // team's one member cannot take it back.
    const moved = await server.post(
      `/chats/${opened.chatId}/transfer`,
      { group_id: Number(supportId) },
      auth(adminToken),
    );
    expect(moved.statusCode).toBe(200);

    const after = await threadOf(opened.threadId);
    expect(after.assigneeId).toBeNull();
    expect(after.queuePosition).toBe(1);
    expect(after.assignedAt).toBeNull();
  });

  it('keeps a value the same write sets, and ignores writes that leave the assignee alone', async () => {
    await addAgent();
    const opened = await startChat();
    const other = await addAgent();
    const past = new Date(Date.now() - HOUR);

    await owner.thread.update({
      where: { id: opened.threadId },
      data: { assigneeId: other, assignedAt: past },
    });
    expect((await threadOf(opened.threadId)).assignedAt).toEqual(past);

    // Same assignee written again, and an unrelated column: nothing moves.
    await owner.thread.update({
      where: { id: opened.threadId },
      data: { assigneeId: other, summary: 'still theirs' },
    });
    expect((await threadOf(opened.threadId)).assignedAt).toEqual(past);
  });

  // --- 3. The AI handing over to the agent who already held it --------------

  it('moves it to the hand-over when the AI hands over a connection its agent already held', async () => {
    const agent = await addAgent();
    const long = new Date(Date.now() - HOUR);
    const ai = await aiConnection({ id: agent, at: long });

    const handed = await new ChatService(appRole, NO_REDIS).handOverFromAi(ctx(), ai, 'ai_handoff');
    expect(handed).toBe(true);

    const after = await threadOf(ai.threadId);
    expect(after.assigneeId).toBe(agent);
    // The wait starts at the hand-over, not an hour ago.
    expect(after.assignedAt!.getTime()).toBeGreaterThan(long.getTime() + HOUR / 2);
  });

  // --- 4. The list row, and the database's own rule -------------------------

  it('says on the list row whether the newest connection is inactive', async () => {
    await addAgent();
    const quiet = await startChat();
    const lively = await startChat();
    await owner.thread.update({
      where: { id: quiet.threadId },
      data: { inactiveSince: new Date() },
    });

    const list = await server.get('/chats?limit=50', auth(adminToken));
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { items: Array<{ id: string; inactive: boolean }> }).items;
    expect(rows.find((r) => r.id === quiet.chatId)?.inactive).toBe(true);
    expect(rows.find((r) => r.id === lively.chatId)?.inactive).toBe(false);

    // Closed, it is not "inactive" any more — it is over.
    await server.post(`/chats/${quiet.chatId}/deactivate`, undefined, auth(adminToken));
    const after = await server.get('/chats?limit=50', auth(adminToken));
    const closed = (after.json() as { items: Array<{ id: string; inactive: boolean }> }).items;
    expect(closed.find((r) => r.id === quiet.chatId)?.inactive ?? false).toBe(false);
  });

  it('starts every connection at zero unresponsive transfers and refuses a negative count', async () => {
    await addAgent();
    const opened = await startChat();
    const thread = await owner.thread.findUniqueOrThrow({ where: { id: opened.threadId } });
    expect(thread.unresponsiveTransfers).toBe(0);
    expect(thread.inactiveSince).toBeNull();

    await expect(
      owner.thread.update({ where: { id: opened.threadId }, data: { unresponsiveTransfers: -1 } }),
    ).rejects.toThrow(/threads_unresponsive_transfers_check/);
  });
});
