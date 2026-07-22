/**
 * Routing and queueing (ADR-08).
 *
 * The failure modes worth testing are not "it crashed" but the unfair ones: one
 * agent taking every chat, an agent silently pushed past their limit, a
 * customer stuck in a queue while somebody sits idle.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { RoutingService } from '../../src/services/routing/routing-service.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('routing', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let routing: RoutingService;

  let supportId: bigint;
  let salesId: bigint;
  let adminToken: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    routing = new RoutingService();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const sales = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Sales' },
      select: { id: true },
    });
    supportId = support.id;
    salesId = sales.id;

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:rw', 'customers:rw'],
    });
  });

  /** Add an agent to a team with a given priority and capacity. */
  async function addAgent(options: {
    groupId: bigint;
    priority?: string;
    limit?: number;
    status?: string;
    name?: string;
  }): Promise<string> {
    const account = await owner.account.create({
      data: {
        email: `${options.name ?? generateShortId()}@routing.test`.toLowerCase(),
        name: options.name ?? 'Agent',
      },
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
        groupId: options.groupId,
        agentId: account.id,
        priority: options.priority ?? 'normal',
      },
    });
    return account.id;
  }

  /** Give an agent N open conversations, to simulate load. */
  async function loadAgent(agentId: string, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: `Load ${i}` },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
      });
      await owner.thread.create({
        data: {
          id: generateShortId(),
          chatId,
          licenseId: fx.a.licenseId,
          active: true,
          assigneeId: agentId,
        },
      });
    }
  }

  const route = (context = {}) =>
    withTenant(owner, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
      routing.route(tx, fx.a.licenseId, context),
    );

  // =========================================================================
  // Team selection
  // =========================================================================

  describe('team selection', () => {
    it('prefers a matching rule over the fallback', async () => {
      await addAgent({ groupId: supportId });
      await addAgent({ groupId: salesId });

      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: supportId,
        },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/pricing'] },
          targetGroupId: salesId,
          priority: 10,
        },
      });

      const pricing = await route({ url: 'https://shop.test/pricing' });
      const home = await route({ url: 'https://shop.test/' });

      expect(pricing.groupIds).toEqual([salesId]);
      expect(home.groupIds).toEqual([supportId]);
    });

    it('requires every stated condition to hold', async () => {
      await addAgent({ groupId: salesId });
      await addAgent({ groupId: supportId });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: supportId,
        },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          // "pricing pages, from the UK" must not fire for a UK visitor on the
          // home page.
          conditions: { url_contains: ['/pricing'], country_codes: ['GB'] },
          targetGroupId: salesId,
          priority: 5,
        },
      });

      expect((await route({ url: '/pricing', countryCode: 'GB' })).groupIds).toEqual([salesId]);
      expect((await route({ url: '/', countryCode: 'GB' })).groupIds).toEqual([supportId]);
      expect((await route({ url: '/pricing', countryCode: 'FR' })).groupIds).toEqual([supportId]);
    });

    it('honours an explicitly requested team', async () => {
      await addAgent({ groupId: salesId });
      expect((await route({ requestedGroupId: salesId })).groupIds).toEqual([salesId]);
    });

    it('ignores a requested team that no longer exists', async () => {
      // A stale widget snippet must not cost the customer their conversation.
      await addAgent({ groupId: supportId });
      const decision = await route({ requestedGroupId: 999_999n });
      expect(decision.groupIds).toEqual([supportId]);
    });

    it('works before any routing rule is configured', async () => {
      await addAgent({ groupId: supportId });
      const decision = await route();
      expect(decision.groupIds).toEqual([supportId]);
      expect(decision.assigneeId).not.toBeNull();
    });

    it('still creates the chat when there is no team at all', async () => {
      await owner.group.deleteMany({ where: { licenseId: fx.a.licenseId } });
      const decision = await route();
      expect(decision.reason).toBe('no_group');
      // Nothing is lost — a `chats--all` holder can still find it.
      expect(decision.assigneeId).toBeNull();
    });
  });

  // =========================================================================
  // Agent selection: priority, load, fairness
  // =========================================================================

  describe('agent selection', () => {
    it('prefers the higher priority tier', async () => {
      const primary = await addAgent({ groupId: supportId, priority: 'primary', name: 'primary' });
      await addAgent({ groupId: supportId, priority: 'normal', name: 'normal' });

      expect((await route()).assigneeId).toBe(primary);
    });

    it('falls through to the next tier when the top one is full', async () => {
      const primary = await addAgent({
        groupId: supportId,
        priority: 'primary',
        limit: 1,
        name: 'primary-full',
      });
      const first = await addAgent({ groupId: supportId, priority: 'first', name: 'first' });
      await loadAgent(primary, 1);

      // A full primary must not send the chat to the queue while `first` is idle.
      expect((await route()).assigneeId).toBe(first);
    });

    it('picks the least loaded agent within a tier', async () => {
      const busy = await addAgent({ groupId: supportId, name: 'busy' });
      const idle = await addAgent({ groupId: supportId, name: 'idle' });
      await loadAgent(busy, 3);

      expect((await route()).assigneeId).toBe(idle);
    });

    it('breaks ties by who has waited longest', async () => {
      // Without this the planner's row order decides, and the same agent wins
      // every time a queue drains.
      const recent = await addAgent({ groupId: supportId, name: 'recent' });
      const stale = await addAgent({ groupId: supportId, name: 'stale' });

      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: recent } },
        data: { lastAssignedAt: new Date() },
      });
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: stale } },
        data: { lastAssignedAt: new Date(Date.now() - 3_600_000) },
      });

      expect((await route()).assigneeId).toBe(stale);
    });

    it('spreads a burst of chats rather than piling them on one agent', async () => {
      const a = await addAgent({ groupId: supportId, name: 'a' });
      const b = await addAgent({ groupId: supportId, name: 'b' });
      const c = await addAgent({ groupId: supportId, name: 'c' });

      const assigned: string[] = [];
      for (let i = 0; i < 6; i++) {
        const decision = await route();
        expect(decision.assigneeId).not.toBeNull();
        assigned.push(decision.assigneeId!);
        await loadAgent(decision.assigneeId!, 1);
      }

      const counts = [a, b, c].map((id) => assigned.filter((x) => x === id).length);
      expect(counts).toEqual([2, 2, 2]);
    });

    it("never exceeds an agent's concurrent limit", async () => {
      const only = await addAgent({ groupId: supportId, limit: 2, name: 'limited' });
      await loadAgent(only, 2);

      const decision = await route();
      // Queued, not assigned anyway — an over-limit agent quietly accumulating
      // chats is how customers end up ignored.
      expect(decision.assigneeId).toBeNull();
      expect(decision.reason).toBe('queued');
    });

    it.each([
      ['not accepting', 'not_accepting_chats'],
      ['offline', 'offline'],
    ])('skips an agent who is %s', async (_label, status) => {
      await addAgent({ groupId: supportId, status, name: `away-${status}` });
      const decision = await route();
      expect(decision.assigneeId).toBeNull();
    });

    it('skips a suspended agent', async () => {
      const agent = await addAgent({ groupId: supportId, name: 'suspended' });
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: agent } },
        data: { suspended: true },
      });
      expect((await route()).assigneeId).toBeNull();
    });

    it('never assigns an agent from another tenant', async () => {
      // Same team id number in a different licence must not match.
      await owner.group.create({ data: { licenseId: fx.b.licenseId, name: 'Support' } });
      await owner.groupAgent.create({
        data: {
          licenseId: fx.b.licenseId,
          groupId: (
            await owner.group.findFirstOrThrow({
              where: { licenseId: fx.b.licenseId },
              select: { id: true },
            })
          ).id,
          agentId: fx.b.agentAccountId,
          priority: 'primary',
        },
      });

      await addAgent({ groupId: supportId, name: 'ours' });
      const decision = await route();
      expect(decision.assigneeId).not.toBe(fx.b.agentAccountId);
    });
  });

  // =========================================================================
  // Fallback and queue
  // =========================================================================

  describe('fallback and queue', () => {
    it('falls back to the fallback team when the matched one is full', async () => {
      const busy = await addAgent({ groupId: salesId, limit: 1, name: 'sales-full' });
      const rescue = await addAgent({ groupId: supportId, name: 'support-free' });
      await loadAgent(busy, 1);

      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: supportId,
        },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/pricing'] },
          targetGroupId: salesId,
          priority: 5,
        },
      });

      const decision = await route({ url: '/pricing' });
      expect(decision.assigneeId).toBe(rescue);
      expect(decision.groupIds).toEqual([supportId]);
    });

    it('queues with contiguous positions when nobody is free', async () => {
      const only = await addAgent({ groupId: supportId, limit: 1, name: 'one' });
      await loadAgent(only, 1);

      // Through the API, because `route()` only decides — the position depends
      // on threads that already exist, which the caller writes.
      const positions: Array<number | null> = [];
      for (let i = 0; i < 3; i++) {
        const customer = await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: `Q${i}` },
          select: { id: true },
        });
        const chat = await server.post(
          '/chats',
          { customer_id: customer.id, assign_to_me: false },
          { authorization: `Bearer ${adminToken}` },
        );
        positions.push(chat.json().thread.queue_position);
      }

      expect(positions).toEqual([1, 2, 3]);
    });

    it('assigns from the queue when a chat closes', async () => {
      const agent = await addAgent({ groupId: supportId, limit: 1, name: 'solo' });

      // One live chat, one waiting behind it.
      const liveCustomer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Live' },
        select: { id: true },
      });
      const live = await server.post(
        '/chats',
        { customer_id: liveCustomer.id, assign_to_me: false },
        { authorization: `Bearer ${adminToken}` },
      );
      expect(live.json().thread.assignee_id).toBe(agent);

      const waitingCustomer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Waiting' },
        select: { id: true },
      });
      const waiting = await server.post(
        '/chats',
        { customer_id: waitingCustomer.id, assign_to_me: false },
        { authorization: `Bearer ${adminToken}` },
      );
      expect(waiting.json().thread.assignee_id).toBeNull();
      expect(waiting.json().thread.queue_position).toBe(1);

      await server.post(`/chats/${live.json().id}/deactivate`, undefined, {
        authorization: `Bearer ${adminToken}`,
      });

      // The waiting customer should not sit there while the agent is now free.
      const after = await server.get(`/chats/${waiting.json().id}`, {
        authorization: `Bearer ${adminToken}`,
      });
      expect(after.json().thread.assignee_id).toBe(agent);
      expect(after.json().thread.queue_position).toBeNull();
    });

    it('assigns from the queue when an agent comes back online', async () => {
      const agent = await addAgent({
        groupId: supportId,
        status: 'not_accepting_chats',
        name: 'returning',
      });
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: agent,
        scopes: ['agents--my:rw'],
      });

      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Waiting' },
        select: { id: true },
      });
      const queued = await server.post(
        '/chats',
        { customer_id: customer.id, assign_to_me: false },
        { authorization: `Bearer ${adminToken}` },
      );
      expect(queued.json().thread.assignee_id).toBeNull();

      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/v1/agents/me/routing-status',
        headers: { authorization: `Bearer ${agentToken}` },
        payload: { routing_status: 'accepting_chats' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().assigned_from_queue).toContain(queued.json().id);
    });

    it('renumbers so positions stay contiguous', async () => {
      // "You are number 4" with three people waiting erodes trust fast.
      const agent = await addAgent({ groupId: supportId, limit: 1, name: 'solo' });
      await loadAgent(agent, 1);

      const queued: string[] = [];
      for (let i = 0; i < 3; i++) {
        const customer = await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: `Q${i}` },
          select: { id: true },
        });
        const chat = await server.post(
          '/chats',
          { customer_id: customer.id, assign_to_me: false },
          { authorization: `Bearer ${adminToken}` },
        );
        queued.push(chat.json().id);
      }

      // Abandon the middle one.
      await server.post(`/chats/${queued[1]}/deactivate`, undefined, {
        authorization: `Bearer ${adminToken}`,
      });

      await withTenant(
        owner,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => routing.renumberQueue(tx, fx.a.licenseId),
      );

      const positions = await owner.thread.findMany({
        where: { licenseId: fx.a.licenseId, active: true, queuePosition: { not: null } },
        orderBy: { queuePosition: 'asc' },
        select: { queuePosition: true },
      });
      expect(positions.map((p) => p.queuePosition)).toEqual(
        Array.from({ length: positions.length }, (_, i) => i + 1),
      );
    });

    it('does not reorder the queue when one entry cannot be assigned', async () => {
      // Taking a later chat because an earlier one has no available team would
      // quietly jump the queue.
      const salesAgent = await addAgent({ groupId: salesId, name: 'sales' });
      await loadAgent(salesAgent, 6); // at the default limit

      const supportAgent = await addAgent({ groupId: supportId, name: 'support' });
      await loadAgent(supportAgent, 6);

      const firstCustomer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'First' },
        select: { id: true },
      });
      await server.post(
        '/chats',
        { customer_id: firstCustomer.id, assign_to_me: false, group_ids: [Number(salesId)] },
        { authorization: `Bearer ${adminToken}` },
      );

      const secondCustomer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Second' },
        select: { id: true },
      });
      const second = await server.post(
        '/chats',
        { customer_id: secondCustomer.id, assign_to_me: false, group_ids: [Number(supportId)] },
        { authorization: `Bearer ${adminToken}` },
      );

      // Free capacity in Support only.
      await owner.thread.updateMany({
        where: { assigneeId: supportAgent, active: true },
        data: { active: false, closedAt: new Date() },
      });

      const assigned = await withTenant(
        owner,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => routing.drainQueue(tx, fx.a.licenseId),
      );

      // The Sales chat is first and cannot be served, so the drain stops there
      // rather than skipping to the Support one.
      expect(assigned.map((a) => a.chatId)).not.toContain(second.json().id);
    });
  });

  // =========================================================================
  // Through the API
  // =========================================================================

  describe('through the API', () => {
    it('routes an unassigned chat to the right agent', async () => {
      const primary = await addAgent({ groupId: supportId, priority: 'primary', name: 'p' });
      await addAgent({ groupId: supportId, priority: 'last', name: 'l' });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: supportId,
        },
      });

      const response = await server.post(
        '/chats',
        { customer_id: fx.a.customerId, assign_to_me: false },
        { authorization: `Bearer ${adminToken}` },
      );

      expect(response.statusCode).toBe(201);
      expect(response.json().thread.assignee_id).toBe(primary);
      expect(response.json().access.group_ids).toEqual([Number(supportId)]);
    });

    it('honours an explicit assignment over routing', async () => {
      await addAgent({ groupId: supportId, priority: 'primary', name: 'p' });
      const response = await server.post(
        '/chats',
        { customer_id: fx.a.customerId, assign_to_me: true },
        { authorization: `Bearer ${adminToken}` },
      );
      expect(response.json().thread.assignee_id).toBe(fx.a.ownerAccountId);
    });

    it('routes by page url from the widget', async () => {
      await addAgent({ groupId: salesId, name: 'sales' });
      await addAgent({ groupId: supportId, name: 'support' });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: supportId,
        },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          conditions: { url_contains: ['/pricing'] },
          targetGroupId: salesId,
          priority: 1,
        },
      });

      const response = await server.post(
        '/chats',
        {
          customer_id: fx.a.customerId,
          assign_to_me: false,
          routing: { url: 'https://shop.test/pricing/plans' },
        },
        { authorization: `Bearer ${adminToken}` },
      );
      expect(response.json().access.group_ids).toEqual([Number(salesId)]);
    });

    it('rejects an unknown routing status', async () => {
      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/v1/agents/me/routing-status',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { routing_status: 'on_holiday' },
      });
      expect(response.statusCode).toBe(400);
    });
  });
});
