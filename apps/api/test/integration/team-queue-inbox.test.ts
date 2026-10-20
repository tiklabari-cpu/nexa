/**
 * The inbox's team queue tabs (tm 305.4 · SiyahTuş analysis AU-01, K14,
 * ADR-08a §2.1).
 *
 * A conversation waits in one team's queue (`threads.queue_group_id`, tm
 * 305.2); the inbox's "Queued" view splits by that team. What the console
 * needs from `GET /chats` for it:
 *
 *   1. `queue_group_id` narrows to one team's waiting conversations — the
 *      queue's team, not a team that merely grants access — and `total`
 *      counts the same set, so a tab's number and its rows agree;
 *   2. each row names the team it waits in and how pressing it is, and a row
 *      no longer waiting names no team even though the column is still set;
 *   3. visibility and the tenant boundary still hold under the filter.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Row {
  id: string;
  queue_position: number | null;
  queue_group_id: number | null;
  priority: string;
}

describe('team queue tabs in the chat list (AU-01 · ADR-08a)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  let financeId: bigint;
  let rgId: bigint;
  let supportId: bigint;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
    const licenseId = fx.a.licenseId;
    const team = async (name: string, topicRole: string | null) =>
      (await owner.group.create({ data: { licenseId, name, topicRole }, select: { id: true } })).id;
    financeId = await team('Finans', 'finance');
    rgId = await team('Sorumlu Oyun', 'responsible_gambling');
    supportId = await team('Destek', null);

    adminToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
  });

  /** One chat with one connection, reachable through `access`. */
  async function connection(
    t: TenantFixture,
    access: bigint[],
    thread: Record<string, unknown>,
  ): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id },
    });
    await owner.thread.create({
      data: { id: generateShortId(), chatId, licenseId: t.licenseId, ...thread },
    });
    if (access.length > 0) {
      await owner.chatAccess.createMany({
        data: access.map((groupId) => ({ chatId, groupId })),
      });
    }
    return chatId;
  }

  const waiting = (groupId: bigint, position: number, priority = 0) => ({
    queuePosition: position,
    queuedAt: new Date(),
    queueGroupId: groupId,
    priority,
  });

  async function list(token: string, query: string): Promise<{ items: Row[]; total: number }> {
    const res = await server.get(`/chats?${query}`, auth(token));
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  it("lists one team's queue — not the teams that can see it — and counts the same set (FR-MOD-08.6.1)", async () => {
    // Waits in Finance's queue, though Support can see it too: the tab is the queue's.
    const financeNormal = await connection(fx.a, [supportId, financeId], waiting(financeId, 2));
    const financeUrgent = await connection(fx.a, [financeId], waiting(financeId, 1, 2));
    const rg = await connection(fx.a, [rgId], waiting(rgId, 1));
    // Support grants access, but it waits nowhere — Support's tab is empty.
    await connection(fx.a, [supportId], { assigneeId: fx.a.agentAccountId });

    const finance = await list(adminToken, `view=queued&queue_group_id=${financeId}`);
    expect(finance.total).toBe(2);
    expect(finance.items.map((r) => r.id).sort()).toEqual([financeNormal, financeUrgent].sort());
    const byId = new Map(finance.items.map((r) => [r.id, r]));
    expect(byId.get(financeUrgent)).toMatchObject({
      queue_position: 1,
      queue_group_id: Number(financeId),
      priority: 'urgent',
    });
    expect(byId.get(financeNormal)).toMatchObject({
      queue_position: 2,
      queue_group_id: Number(financeId),
      priority: 'normal',
    });

    const support = await list(adminToken, `view=queued&queue_group_id=${supportId}`);
    expect(support).toMatchObject({ total: 0, items: [] });

    // The unfiltered queue holds every team's, each row naming its own.
    const all = await list(adminToken, 'view=queued');
    expect(all.total).toBe(3);
    expect(all.items.find((r) => r.id === rg)?.queue_group_id).toBe(Number(rgId));
  });

  it('names no team for a connection no longer waiting, and leaves it out of every tab (FR-MOD-08.6.1)', async () => {
    // Taken from Finance's queue: the column keeps the team, the row does not.
    const taken = await connection(fx.a, [financeId], {
      queueGroupId: financeId,
      assigneeId: fx.a.agentAccountId,
      priority: 1,
    });
    const closed = await connection(fx.a, [financeId], {
      ...waiting(financeId, 1),
      active: false,
      closedAt: new Date(),
    });

    const everything = await list(adminToken, 'view=all');
    const row = everything.items.find((r) => r.id === taken);
    expect(row).toMatchObject({ queue_position: null, queue_group_id: null, priority: 'high' });

    // Even outside the Queued view, the tab filter means "waiting in it".
    const tab = await list(adminToken, `view=all&queue_group_id=${financeId}`);
    expect(tab.items.map((r) => r.id)).not.toContain(taken);
    expect(tab.items.map((r) => r.id)).not.toContain(closed);
    expect(tab.total).toBe(0);
  });

  it("keeps an agent to the chats their teams can see, and one workspace out of another's queue", async () => {
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: financeId, agentId: fx.a.agentAccountId },
    });
    const agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--access:ro'],
    });
    const visible = await connection(fx.a, [financeId], waiting(financeId, 1));
    // Waits in Finance's queue, but only Responsible Gambling can see it.
    await connection(fx.a, [rgId], waiting(financeId, 2));

    const mine = await list(agentToken, `view=queued&queue_group_id=${financeId}`);
    expect(mine.items.map((r) => r.id)).toEqual([visible]);
    expect(mine.total).toBe(1);

    const otherToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    expect(await list(otherToken, `view=queued&queue_group_id=${financeId}`)).toMatchObject({
      total: 0,
      items: [],
    });
  });

  it('refuses a team id that is not a number', async () => {
    const res = await server.get('/chats?view=queued&queue_group_id=finance', auth(adminToken));
    expect(res.statusCode).toBe(400);
  });
});
