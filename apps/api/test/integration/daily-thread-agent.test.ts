/**
 * The member's day — the agent paths (ID-02 · tm 286.3; owner decisions
 * K1 = A, K2, K3, defaults ID-02-S6 and ID-02-S7).
 *
 * K1 = A: a chat ("Thread ID" in the panel) is one member's conversation for
 * one day, a thread ("Chat ID") one connection inside it. tm 286.2 pinned the
 * visitor's path; this file pins everything else that opens a connection,
 * against real Postgres + Redis + Fastify:
 *
 *   9  an agent reopening yesterday's archived conversation: today's chat (found
 *      or opened), a new connection assigned to that agent, the opening line
 *      naming yesterday's chat (`continued_from_chat_id`), yesterday untouched
 *      (ID-02-S6); a chat filed under today, or under no day, reopens in place;
 *   -  an agent starting a conversation (`POST /chats`): the day's chat, or a
 *      further connection under it with the team added (ID-02-S7), never a
 *      second chat for the day; yesterday's silent connection rolled over first;
 *   -  a conversation arriving over a messaging channel takes the visitor's path,
 *      and is split at midnight only when the idle sweep would have closed it;
 *   -  `listDayConnections`, the read AI-02 builds "earlier today" on;
 *   -  the customer counted as days and connections;
 *   -  the report regression: one day as one chat or as several, the same
 *      totals, AI resolutions, CSAT and SLA breaches;
 *   -  another workspace can neither reopen nor start into this one's day.
 *
 * The day is moved the way it moves in production — a chat is filed under a
 * day once, so "it is now the next day" is the chat being filed under the day
 * before (`fileUnderYesterday`, as in `daily-thread.test.ts`).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDayKey } from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { listDayConnections } from '../../src/services/chat/conversation-day.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
/** A literal public IP: the SSRF guard needs no DNS, and nothing leaves the process. */
const RECEIVER = 'https://93.184.216.34/hooks/day-agent';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const PAGE_ID = '100000000000286';
const SENDER = 'psid_member_day';

interface Delivery {
  action: string;
  data: Record<string, unknown>;
}

interface Connection {
  id: string;
  active: boolean;
  closed_at: string | null;
  assignee_id: string | null;
  opened_via: string | null;
  group_id: number | null;
}

interface DayChat {
  id: string;
  active: boolean;
  local_day: string | null;
  access: { group_ids: number[] };
  thread: { id: string } | null;
  connections: Connection[];
}

describe("the member's day — agent paths (ID-02)", () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;
  let tokenB: string;
  let support: bigint;
  let bonus: bigint;
  let brandA: string;
  /** Every webhook delivery to tenant A's receiver, in order. */
  let received: Delivery[];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer(
      {},
      {
        webhookSender: async (_target, request) => {
          received.push(JSON.parse(request.body) as Delivery);
          return { ok: true, statusCode: 200 };
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  /** A team with the tenant's agent in it, and the routing fallback pointing at it. */
  async function seedTeam(t: TenantFixture, name: string, fallback: boolean): Promise<bigint> {
    const { id } = await owner.group.create({
      data: { licenseId: t.licenseId, name },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: { licenseId: t.licenseId, groupId: id, agentId: t.agentAccountId, priority: 'normal' },
    });
    if (fallback) {
      await owner.routingRule.create({
        data: { licenseId: t.licenseId, kind: 'chat', isFallback: true, targetGroupId: id },
      });
    }
    return id;
  }

  beforeEach(async () => {
    // Enterprise: the report regression measures SLA breaches, an entitlement.
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
    await seedDefaultBrand(owner, fx.b.licenseId);
    await clearRateLimits(server.app);

    support = await seedTeam(fx.a, 'Support', true);
    bonus = await seedTeam(fx.a, 'Bonus', false);
    await seedTeam(fx.b, 'Support', true);

    const scopes = [
      'chats--all:rw',
      'customers:rw',
      'webhooks--all:rw',
      'channels--all:rw',
      'reports_read',
    ];
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes,
    });
    tokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes,
    });
    // The three announcements a day's connections produce.
    for (const action of ['chat_started', 'thread_started', 'chat_deactivated']) {
      const hook = await server.post('/webhooks', { url: RECEIVER, action }, auth(agentToken));
      expect(hook.statusCode).toBe(201);
    }
    received = [];
  });

  // --- helpers ---------------------------------------------------------------

  async function widgetToken(tenant = fx.a) {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  async function say(token: string, text: string): Promise<string> {
    const response = await server.post('/customer/chat/events', { text }, auth(token));
    expect(response.statusCode).toBe(201);
    return response.json().chat_id as string;
  }

  async function archive(chatId: string, token = agentToken): Promise<void> {
    const response = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(token));
    expect(response.statusCode).toBe(200);
  }

  const resume = (chatId: string, token = agentToken) =>
    server.post(`/chats/${chatId}/resume`, undefined, auth(token));

  const start = (body: Record<string, unknown>, token = agentToken) =>
    server.post('/chats', body, auth(token));

  const threadsOf = (chatId: string) =>
    owner.thread.findMany({ where: { chatId }, orderBy: { createdAt: 'asc' } });

  /** Today's key in the default boundary, read on both sides of an action that files one. */
  async function withToday<T>(action: () => Promise<T>): Promise<{ result: T; days: string[] }> {
    const before = localDayKey(new Date());
    const result = await action();
    return { result, days: [before, localDayKey(new Date())] };
  }

  /** "It is now the next day": the chat was filed under the day before. */
  async function fileUnderYesterday(chatId: string): Promise<void> {
    const chat = await owner.chat.findUniqueOrThrow({ where: { id: chatId } });
    await owner.chat.update({
      where: { id: chatId },
      data: { localDay: new Date(chat.localDay!.getTime() - 24 * HOUR) },
    });
  }

  /** Move everything that happened in a chat `ms` into the past. */
  async function silence(chatId: string, ms: number): Promise<void> {
    const interval = `${Math.round(ms / 1000)} seconds`;
    await owner.$executeRaw`
      UPDATE events SET created_at = created_at - ${interval}::interval WHERE chat_id = ${chatId}`;
    await owner.$executeRaw`
      UPDATE threads SET created_at = created_at - ${interval}::interval WHERE chat_id = ${chatId}`;
  }

  /** A member whose chat sits under yesterday, archived — what "Reopen" is pressed on. */
  async function yesterdaysArchivedChat(): Promise<{
    chatId: string;
    token: string;
    customerId: string;
  }> {
    const { token, customer_id: customerId } = await widgetToken();
    const chatId = await say(token, 'Last night: my Papara deposit is missing');
    await archive(chatId);
    await fileUnderYesterday(chatId);
    return { chatId, token, customerId };
  }

  async function detail(chatId: string): Promise<DayChat> {
    const response = await server.get(`/chats/${chatId}`, auth(agentToken));
    expect(response.statusCode).toBe(200);
    return response.json() as DayChat;
  }

  // ==========================================================================
  // Scenario 9 — an agent reopens an earlier day (ID-02-S6)
  // ==========================================================================

  describe('reopening an earlier day (scenario 9)', () => {
    it("continues yesterday's archived conversation in a new chat for today, assigned to the agent and naming where it came from (scenario 9) (FR-MOD-02.6)", async () => {
      const { chatId: yesterday, token, customerId } = await yesterdaysArchivedChat();
      const yesterdaysThreads = await threadsOf(yesterday);
      received = [];

      const { result: response, days } = await withToday(() => resume(yesterday));
      expect(response.statusCode).toBe(200);
      const today = response.json() as DayChat;

      // Today's chat — a different Thread ID — filed under today.
      expect(today.id).not.toBe(yesterday);
      expect(today.active).toBe(true);
      expect(days).toContain(today.local_day);
      expect(today.connections).toHaveLength(1);
      const connection = today.connections[0]!;
      expect(connection).toMatchObject({
        active: true,
        assignee_id: fx.a.ownerAccountId,
        opened_via: 'agent_reopen',
        group_id: Number(support),
      });
      // Yesterday's day gained nothing.
      expect(await threadsOf(yesterday)).toEqual(yesterdaysThreads);
      expect((await owner.chat.findUniqueOrThrow({ where: { id: yesterday } })).active).toBe(false);

      // The new connection opens with the reopening, naming yesterday's chat.
      const opening = await owner.event.findMany({
        where: { threadId: connection.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(opening).toHaveLength(1);
      expect(opening[0]).toMatchObject({
        type: 'system_message',
        text: 'Chat reopened',
        recipients: 'all',
        authorId: fx.a.ownerAccountId,
        authorType: 'system',
      });
      expect(opening[0]!.properties).toEqual({
        system_event: 'chat_resumed',
        continued_from_chat_id: yesterday,
      });

      // Whoever read yesterday reads the continuation, and so does the agent.
      expect(today.access.group_ids).toEqual([Number(support)]);
      const users = await owner.chatUser.findMany({ where: { chatId: today.id } });
      expect(users.map((u) => `${u.userType}:${u.userId}`).sort()).toEqual(
        [`agent:${fx.a.ownerAccountId}`, `customer:${customerId}`].sort(),
      );

      // Outside: the day's first connection, so the day's chat is announced.
      expect(received.map((d) => d.action)).toEqual(['chat_started']);
      expect(received[0]!.data).toMatchObject({ chat_id: today.id, thread_id: connection.id });

      // In the trail: today's chat became writable, and it says where from.
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'chat.reopened' },
      });
      expect(entry).toMatchObject({
        target: `chat:${today.id}`,
        actorType: 'agent',
        actorId: fx.a.ownerAccountId,
      });
      expect(entry.metadata).toEqual({
        thread_id: connection.id,
        continued_from_chat_id: yesterday,
        request_id: expect.any(String),
      });

      // The member's widget is in today's connection.
      const state = await server.get('/customer/chat', auth(token));
      expect(state.json().chat).toMatchObject({ id: today.id, thread_id: connection.id });
    });

    it("adds the reopened conversation to the member's chat for today as a further connection, its team added (scenario 9 · ID-02-S7)", async () => {
      const { chatId: yesterday, token, customerId } = await yesterdaysArchivedChat();
      // Yesterday's conversation had been handed to Bonus; today's went to Support.
      await owner.chatAccess.deleteMany({ where: { chatId: yesterday } });
      await owner.chatAccess.create({ data: { chatId: yesterday, groupId: bonus } });
      await owner.thread.updateMany({ where: { chatId: yesterday }, data: { groupId: bonus } });
      const todayId = await say(token, 'This morning: still missing');
      expect(todayId).not.toBe(yesterday);
      await archive(todayId);
      received = [];

      const response = await resume(yesterday);
      expect(response.statusCode).toBe(200);
      const today = response.json() as DayChat;
      expect(today.id).toBe(todayId);
      expect(today.connections.map((c) => [c.opened_via, c.active, c.group_id])).toEqual([
        ['first_of_day', false, Number(support)],
        ['agent_reopen', true, Number(bonus)],
      ]);
      expect(today.connections[1]!.assignee_id).toBe(fx.a.ownerAccountId);
      expect([...today.access.group_ids].sort()).toEqual([Number(support), Number(bonus)].sort());
      expect(await owner.chat.count({ where: { customerId } })).toBe(2);

      const marker = await owner.event.findFirstOrThrow({
        where: { threadId: today.connections[1]!.id, type: 'system_message' },
      });
      expect(marker.properties).toMatchObject({ continued_from_chat_id: yesterday });

      // A further connection of the day: `thread_started`, never `chat_started`.
      expect(received.map((d) => d.action)).toEqual(['thread_started']);
      expect(received[0]!.data).toMatchObject({
        chat_id: todayId,
        thread_id: today.connections[1]!.id,
        reason: 'agent_reopen',
      });
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'chat.reopened' },
      });
      expect(entry.target).toBe(`chat:${todayId}`);
      expect(entry.metadata).toMatchObject({ continued_from_chat_id: yesterday });
    });

    it('reopens a chat filed under today in place, as agent_reopen, announced as thread_started (FR-MOD-02.6 · FR-MOD-02.8)', async () => {
      const { token } = await widgetToken();
      const chatId = await say(token, 'Morning');
      await archive(chatId);
      received = [];

      const response = await resume(chatId);
      expect(response.statusCode).toBe(200);
      const chat = response.json() as DayChat;
      expect(chat.id).toBe(chatId);
      expect(chat.connections.map((c) => [c.opened_via, c.active])).toEqual([
        ['first_of_day', false],
        ['agent_reopen', true],
      ]);
      expect(chat.connections[1]).toMatchObject({
        assignee_id: fx.a.ownerAccountId,
        group_id: Number(support),
      });
      const marker = await owner.event.findFirstOrThrow({
        where: { threadId: chat.connections[1]!.id, type: 'system_message' },
      });
      expect(marker.properties).toEqual({ system_event: 'chat_resumed' });

      expect(received.map((d) => d.action)).toEqual(['thread_started']);
      expect(received[0]!.data).toMatchObject({
        chat_id: chatId,
        thread_id: chat.connections[1]!.id,
        reason: 'agent_reopen',
      });
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'chat.reopened' },
      });
      expect(entry.target).toBe(`chat:${chatId}`);
      expect(entry.metadata).toEqual({
        thread_id: chat.connections[1]!.id,
        request_id: expect.any(String),
      });
    });

    it('reopens a chat filed under no day in place — it keeps the model it was opened in', async () => {
      const { token } = await widgetToken();
      const chatId = await say(token, 'Before the daily model');
      await archive(chatId);
      await owner.chat.update({ where: { id: chatId }, data: { localDay: null, dayTz: null } });

      const response = await resume(chatId);
      expect(response.statusCode).toBe(200);
      const chat = response.json() as DayChat;
      expect(chat.id).toBe(chatId);
      expect(chat.local_day).toBeNull();
      const threads = await threadsOf(chatId);
      expect(threads.map((t) => [t.openedVia, t.active])).toEqual([
        ['first_of_day', false],
        ['agent_reopen', true],
      ]);
      // Not a day: only its newest connection is listed.
      expect(chat.connections.map((c) => c.id)).toEqual([threads[1]!.id]);
    });

    it('refuses to reopen yesterday while the member is in a conversation today, and opens nothing', async () => {
      const { chatId: yesterday, token } = await yesterdaysArchivedChat();
      const todayId = await say(token, 'Right now');
      const before = await threadsOf(todayId);

      const response = await resume(yesterday);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toMatch(/already has an active chat/i);
      expect(await threadsOf(todayId)).toEqual(before);
      expect(await threadsOf(yesterday)).toHaveLength(1);
    });

    it('lets one of two agents reopening the same earlier day at once through, and opens one chat for today', async () => {
      const { chatId: yesterday, customerId } = await yesterdaysArchivedChat();

      const responses = await Promise.all([resume(yesterday), resume(yesterday)]);
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const chats = await owner.chat.findMany({ where: { customerId } });
      expect(chats).toHaveLength(2);
      const today = chats.find((c) => c.id !== yesterday)!;
      expect((await threadsOf(today.id)).map((t) => t.openedVia)).toEqual(['agent_reopen']);
    });
  });

  // ==========================================================================
  // An agent starts a conversation (POST /chats)
  // ==========================================================================

  describe('an agent starting a conversation', () => {
    async function member(t = fx.a): Promise<string> {
      const { id } = await owner.customer.create({
        data: { organizationId: t.organizationId, name: 'Member' },
        select: { id: true },
      });
      return id;
    }

    it("opens the member's day: a chat filed under today, its connection agent_start, the routed team recorded (FR-MOD-09.4)", async () => {
      const customerId = await member();
      const { result: response, days } = await withToday(() => start({ customer_id: customerId }));
      expect(response.statusCode).toBe(201);
      const chat = response.json() as DayChat;
      expect(days).toContain(chat.local_day);
      expect((await owner.chat.findUniqueOrThrow({ where: { id: chat.id } })).dayTz).toBe(
        'Europe/Istanbul',
      );
      expect(chat.connections).toHaveLength(1);
      expect(chat.connections[0]).toMatchObject({
        opened_via: 'agent_start',
        assignee_id: fx.a.ownerAccountId,
        group_id: Number(support),
      });
      expect(received.map((d) => d.action)).toEqual(['chat_started']);
      expect(received[0]!.data).toMatchObject({
        chat_id: chat.id,
        thread_id: chat.connections[0]!.id,
      });
    });

    it("adds a connection to the member's chat for today rather than a second chat, its team added (ID-02-S7)", async () => {
      const { token, customer_id } = await widgetToken();
      const chatId = await say(token, 'Morning: withdrawal pending');
      await server.post('/customer/chat/close', undefined, auth(token));
      received = [];

      const response = await start({
        customer_id,
        group_ids: [Number(bonus)],
        initial_event: { type: 'message', text: 'Following up on your withdrawal' },
      });
      expect(response.statusCode).toBe(201);
      const chat = response.json() as DayChat;
      expect(chat.id).toBe(chatId);
      expect(await owner.chat.count({ where: { customerId: customer_id } })).toBe(1);
      expect(chat.connections.map((c) => [c.opened_via, c.active, c.group_id])).toEqual([
        ['first_of_day', false, Number(support)],
        ['agent_start', true, Number(bonus)],
      ]);
      expect(chat.connections[1]!.assignee_id).toBe(fx.a.ownerAccountId);
      // Added, not replacing: the morning's team still reads the day.
      expect([...chat.access.group_ids].sort()).toEqual([Number(support), Number(bonus)].sort());

      // The agent's line is the new connection's first; no marker before it.
      const events = await owner.event.findMany({
        where: { threadId: chat.connections[1]!.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => [e.authorType, e.text])).toEqual([
        ['agent', 'Following up on your withdrawal'],
      ]);

      expect(received.map((d) => d.action)).toEqual(['thread_started']);
      expect(received[0]!.data).toMatchObject({
        chat_id: chatId,
        thread_id: chat.connections[1]!.id,
        customer_id,
        reason: 'agent_start',
      });
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'chat.connection_opened' },
      });
      expect(entry).toMatchObject({
        target: `chat:${chatId}`,
        actorType: 'agent',
        actorId: fx.a.ownerAccountId,
      });
      expect(entry.metadata).toEqual({
        thread_id: chat.connections[1]!.id,
        opened_via: 'agent_start',
        request_id: expect.any(String),
      });
    });

    it('returns the open conversation unchanged — 200, nothing opened', async () => {
      const { token, customer_id } = await widgetToken();
      const chatId = await say(token, 'Here now');
      received = [];

      const response = await start({ customer_id });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(chatId);
      expect(await threadsOf(chatId)).toHaveLength(1);
      expect(received).toEqual([]);
    });

    it("closes yesterday's silent connection first, as the system, then opens today's", async () => {
      const { token, customer_id } = await widgetToken();
      const yesterday = await say(token, 'Last night');
      await fileUnderYesterday(yesterday);
      await silence(yesterday, 2 * HOUR);
      received = [];

      const response = await start({ customer_id });
      expect(response.statusCode).toBe(201);
      const today = response.json() as DayChat;
      expect(today.id).not.toBe(yesterday);
      expect(today.connections.map((c) => c.opened_via)).toEqual(['agent_start']);

      expect((await owner.chat.findUniqueOrThrow({ where: { id: yesterday } })).active).toBe(false);
      const close = await owner.event.findFirstOrThrow({
        where: { chatId: yesterday, type: 'system_message' },
      });
      expect(close.properties).toMatchObject({ reason: 'day_rollover' });
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { action: 'chat.archived', target: `chat:${yesterday}` },
      });
      expect(entry).toMatchObject({ actorType: 'system', actorId: null });

      // In the order they happened.
      expect(received.map((d) => [d.action, d.data['chat_id']])).toEqual([
        ['chat_deactivated', yesterday],
        ['chat_started', today.id],
      ]);
    });

    it("keeps yesterday's connection while it is live — midnight does not split it (K3)", async () => {
      const { token, customer_id } = await widgetToken();
      const yesterday = await say(token, 'Just before midnight');
      await fileUnderYesterday(yesterday);

      const response = await start({ customer_id });
      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(yesterday);
      expect(await threadsOf(yesterday)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // A conversation that arrived over a messaging channel
  // ==========================================================================

  describe('a channel conversation', () => {
    const inbound = (text: string) =>
      server.post('/channels/messenger/webhook', {
        recipient: { id: PAGE_ID },
        sender: { id: SENDER, name: 'Dana Member' },
        message: { text },
      });

    async function receive(text: string): Promise<string> {
      const response = await inbound(text);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'accepted' });
      return response.json().chat_id as string;
    }

    beforeEach(async () => {
      const connected = await server.post(
        '/channels/messenger/connect',
        { code: 'AQD_mock_oauth_code', page_id: PAGE_ID, page_name: 'Acme' },
        auth(agentToken),
      );
      expect(connected.statusCode).toBe(200);
    });

    it("files a channel conversation under the member's day, and a same-day return under the same chat (FR-MOD-08.5.4)", async () => {
      const chatId = await receive('My deposit is missing');
      const chat = await owner.chat.findUniqueOrThrow({ where: { id: chatId } });
      expect(chat.localDay).not.toBeNull();
      expect((await threadsOf(chatId)).map((t) => t.openedVia)).toEqual(['first_of_day']);

      await archive(chatId);
      received = [];
      expect(await receive('Still missing')).toBe(chatId);
      expect((await threadsOf(chatId)).map((t) => [t.openedVia, t.active])).toEqual([
        ['first_of_day', false],
        ['same_day_return', true],
      ]);
      expect(received.map((d) => d.action)).toEqual(['thread_started']);
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'chat.connection_opened' },
      });
      expect(entry).toMatchObject({ actorType: 'customer', actorId: chat.customerId, ip: null });
    });

    it('never splits a channel conversation at midnight while the workspace sets no timeout, and does once it sets one', async () => {
      const yesterday = await receive('Late message');
      await fileUnderYesterday(yesterday);
      await silence(yesterday, 2 * HOUR);

      // No timeout: the sweep would leave it open (K2 is a widget rule), so the
      // next message continues it however long the silence.
      expect(await receive('Morning reply')).toBe(yesterday);
      expect(await threadsOf(yesterday)).toHaveLength(1);
      expect(
        await owner.event.count({ where: { chatId: yesterday, authorType: 'customer' } }),
      ).toBe(2);

      // The workspace's own window covers every conversation: past it, the
      // turn of the day closes yesterday's and today's opens.
      await silence(yesterday, 2 * HOUR);
      await owner.inboxSettings.create({
        data: { licenseId: fx.a.licenseId, brandId: brandA, chatTimeoutSeconds: 600 },
      });
      const today = await receive('Afternoon');
      expect(today).not.toBe(yesterday);
      expect((await owner.chat.findUniqueOrThrow({ where: { id: yesterday } })).active).toBe(false);
      expect((await threadsOf(today)).map((t) => t.openedVia)).toEqual(['day_rollover']);
    });
    it('screens the message that would roll a channel conversation over, and a refusal closes nothing', async () => {
      const yesterday = await receive('Late message');
      await fileUnderYesterday(yesterday);
      await silence(yesterday, 2 * HOUR);
      await owner.inboxSettings.create({
        data: { licenseId: fx.a.licenseId, brandId: brandA, chatTimeoutSeconds: 600 },
      });

      // It would open today's connection, so it is screened like a first
      // contact — and refused before yesterday's is closed.
      const refused = await inbound('CRYPTO GIVEAWAY — claim your free prize now');
      expect(refused.statusCode).toBe(200);
      expect(refused.json()).toEqual({ status: 'ignored', reason: 'spam' });
      expect((await owner.chat.findUniqueOrThrow({ where: { id: yesterday } })).active).toBe(true);
      expect(await owner.chat.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });
  });

  // ==========================================================================
  // listDayConnections — the read AI-02's "earlier today" is built on
  // ==========================================================================

  describe("the day's earlier connections (listDayConnections)", () => {
    it("lists the day's other connections oldest first, with summaries and tags, never the one being answered", async () => {
      const { token } = await widgetToken();
      const chatId = await say(token, 'Morning');
      await server.post('/customer/chat/close', undefined, auth(token));
      await say(token, 'Afternoon');
      await server.post('/customer/chat/close', undefined, auth(token));
      await say(token, 'Evening');
      const [morning, afternoon, evening] = await threadsOf(chatId);

      await owner.thread.update({
        where: { id: morning!.id },
        data: { summary: 'Asked about a Papara deposit' },
      });
      const tag = await owner.tag.create({
        data: { licenseId: fx.a.licenseId, name: 'deposit' },
        select: { id: true },
      });
      await owner.threadTag.create({ data: { threadId: afternoon!.id, tagId: tag.id } });

      const earlier = await withTenant(appRole, ctx(fx.a), (tx) =>
        listDayConnections(tx, chatId, { excludeThreadId: evening!.id }),
      );
      expect(earlier.map((c) => [c.id, c.openedVia, c.summary, c.tags, c.groupId])).toEqual([
        [morning!.id, 'first_of_day', 'Asked about a Papara deposit', [], support],
        [afternoon!.id, 'same_day_return', null, ['deposit'], support],
      ]);
      expect(earlier[0]!.closedAt).not.toBeNull();

      const all = await withTenant(appRole, ctx(fx.a), (tx) => listDayConnections(tx, chatId));
      expect(all.map((c) => c.id)).toEqual([morning!.id, afternoon!.id, evening!.id]);
    });

    it('offers only the newest connection of a chat filed under no day — it is not a day', async () => {
      const { token } = await widgetToken();
      const chatId = await say(token, 'Old visit');
      await archive(chatId);
      await owner.chat.update({ where: { id: chatId }, data: { localDay: null, dayTz: null } });
      expect((await resume(chatId)).statusCode).toBe(200);
      const [, newest] = await threadsOf(chatId);

      const listed = await withTenant(appRole, ctx(fx.a), (tx) => listDayConnections(tx, chatId));
      expect(listed.map((c) => c.id)).toEqual([newest!.id]);
      const earlier = await withTenant(appRole, ctx(fx.a), (tx) =>
        listDayConnections(tx, chatId, { excludeThreadId: newest!.id }),
      );
      expect(earlier).toEqual([]);
    });

    it("reads another workspace's day as empty, never as an error that confirms it (NFR-S4)", async () => {
      const { token } = await widgetToken();
      const chatId = await say(token, 'Private');
      const fromB = await withTenant(appRole, ctx(fx.b), (tx) => listDayConnections(tx, chatId));
      expect(fromB).toEqual([]);
    });
  });

  // ==========================================================================
  // Counting a member: days and connections
  // ==========================================================================

  it('counts a member back three times in one day as one day and three connections', async () => {
    const { token, customer_id } = await widgetToken();
    await say(token, 'Morning');
    await server.post('/customer/chat/close', undefined, auth(token));
    await say(token, 'Afternoon');
    await server.post('/customer/chat/close', undefined, auth(token));
    expect((await start({ customer_id })).statusCode).toBe(201);

    const profile = await server.get(`/customers/${customer_id}`, auth(agentToken));
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({ chats_count: 1, connections_count: 3 });

    const list = await server.get('/customers?limit=50', auth(agentToken));
    expect(list.statusCode).toBe(200);
    const row = (list.json().items as Array<{ id: string }>).find((c) => c.id === customer_id);
    expect(row).toMatchObject({ chats_count: 1, connections_count: 3 });
  });

  // ==========================================================================
  // The report regression: a day as one chat or as several, the same figures
  // ==========================================================================

  it('reports the same totals, AI resolutions, CSAT and SLA breaches whether a day is one chat or one chat per visit (FR-MOD-07.3.2)', async () => {
    for (const t of [fx.a, fx.b]) {
      await owner.slaPolicy.create({
        data: {
          licenseId: t.licenseId,
          firstResponseMinutes: 1,
          resolutionMinutes: null,
          businessHoursOnly: false,
        },
      });
    }

    /**
     * One member's day and a second member, identical connection for
     * connection in both tenants. `oneChatPerVisit` files the morning's chat
     * under no day before the member returns — the model before ID-02, where
     * every visit opened a chat of its own.
     */
    async function run(t: TenantFixture, token: string, oneChatPerVisit: boolean) {
      const visitor = await widgetToken(t);
      // Morning: nobody answers, and the first-response target passes before
      // the archive — an AI resolution and an SLA breach.
      const morning = await say(visitor.token, 'Morning: my deposit is missing');
      await owner.$executeRaw`
        UPDATE threads SET created_at = created_at - interval '10 minutes'
        WHERE chat_id = ${morning} AND active`;
      await archive(morning, token);
      if (oneChatPerVisit) {
        await owner.chat.update({ where: { id: morning }, data: { localDay: null, dayTz: null } });
      }
      // Afternoon: answered in time, archived, rated.
      const afternoon = await say(visitor.token, 'Afternoon: still missing');
      const reply = await server.post(
        `/chats/${afternoon}/events`,
        { type: 'message', text: 'Found it — credited now', recipients: 'all' },
        auth(token),
      );
      expect(reply.statusCode).toBe(201);
      await archive(afternoon, token);
      const rated = await server.post(
        '/customer/chat/rating',
        { value: 'good' },
        auth(visitor.token),
      );
      expect(rated.statusCode).toBe(201);
      // Another member, answered, still open.
      const other = await widgetToken(t);
      const otherChat = await say(other.token, 'Hello');
      expect(
        (
          await server.post(
            `/chats/${otherChat}/events`,
            { type: 'message', text: 'Hi there', recipients: 'all' },
            auth(token),
          )
        ).statusCode,
      ).toBe(201);
      return { morning, afternoon, customerId: visitor.customer_id };
    }

    const daily = await run(fx.a, agentToken, false);
    const perVisit = await run(fx.b, tokenB, true);
    // The two shapes really differ: one chat for the day, or two.
    expect(daily.afternoon).toBe(daily.morning);
    expect(perVisit.afternoon).not.toBe(perVisit.morning);

    const from = new Date(Date.now() - 24 * HOUR).toISOString();
    const to = new Date(Date.now() + HOUR).toISOString();
    const figures = async (token: string) => {
      const response = await server.get(
        `/reports/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        auth(token),
      );
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        totals: Record<string, unknown>;
        satisfaction: Record<string, unknown>;
        sla: { breaches: number };
        by_agent: Array<{ chats: number }>;
      };
      return {
        totals: {
          chats: body.totals['chats'],
          total_cases: body.totals['total_cases'],
          closed: body.totals['closed'],
          manual: body.totals['manual'],
          assisted: body.totals['assisted'],
          automated: body.totals['automated'],
        },
        satisfaction: {
          good: body.satisfaction['good'],
          bad: body.satisfaction['bad'],
          responses: body.satisfaction['responses'],
        },
        slaBreaches: body.sla.breaches,
        byAgent: body.by_agent.map((row) => row.chats),
      };
    };

    const a = await figures(agentToken);
    expect(a).toEqual(await figures(tokenB));
    expect(a).toEqual({
      totals: { chats: 3, total_cases: 3, closed: 2, manual: 1, assisted: 0, automated: 1 },
      satisfaction: { good: 1, bad: 0, responses: 1 },
      slaBreaches: 1,
      byAgent: [3],
    });

    // The invoice's AI-resolution meter agrees with itself across the shapes.
    const meter = async (t: TenantFixture) =>
      (
        await owner.usageRecord.findMany({
          where: { licenseId: t.licenseId, metric: 'ai_resolutions' },
          select: { quantity: true },
        })
      ).map((r) => Number(r.quantity));
    expect(await meter(fx.a)).toEqual(await meter(fx.b));

    // What does move is the profile's day count — and the connection count
    // beside it is the one the reports agree with.
    const counts = async (customerId: string, token: string) => {
      const response = await server.get(`/customers/${customerId}`, auth(token));
      expect(response.statusCode).toBe(200);
      const body = response.json() as { chats_count: number; connections_count: number };
      return [body.chats_count, body.connections_count];
    };
    expect(await counts(daily.customerId, agentToken)).toEqual([1, 2]);
    expect(await counts(perVisit.customerId, tokenB)).toEqual([2, 2]);
  });

  // ==========================================================================
  // Team of a connection across a transfer
  // ==========================================================================

  it('records the team a transfer hands the open connection to, and keeps it on an agent hand-off', async () => {
    const { token } = await widgetToken();
    const chatId = await say(token, 'Help');
    expect((await detail(chatId)).connections[0]!.group_id).toBe(Number(support));

    const toTeam = await server.post(
      `/chats/${chatId}/transfer`,
      { group_id: Number(bonus) },
      auth(agentToken),
    );
    expect(toTeam.statusCode).toBe(200);
    const afterTeam = await detail(chatId);
    expect(afterTeam.connections[0]!.group_id).toBe(Number(bonus));
    // A hand-off still replaces the access, unlike a return (ID-02-S7).
    expect(afterTeam.access.group_ids).toEqual([Number(bonus)]);

    const toAgent = await server.post(
      `/chats/${chatId}/transfer`,
      { agent_id: fx.a.agentAccountId },
      auth(agentToken),
    );
    expect(toAgent.statusCode).toBe(200);
    expect((await detail(chatId)).connections[0]!.group_id).toBe(Number(bonus));
  });

  // ==========================================================================
  // Tenant isolation
  // ==========================================================================

  it("lets no other workspace reopen or start into this workspace's day (NFR-S4 · NFR-S5)", async () => {
    const { chatId: yesterday, customerId } = await yesterdaysArchivedChat();

    expect((await resume(yesterday, tokenB)).statusCode).toBe(404);
    expect((await start({ customer_id: customerId }, tokenB)).statusCode).toBe(404);

    expect(await owner.chat.count({ where: { customerId } })).toBe(1);
    expect(await threadsOf(yesterday)).toHaveLength(1);
    expect(await owner.chat.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
  });
});
