/**
 * The member's day — the visitor's path (ID-02 · tm 286.2; owner decisions
 * K1 = A, K2, K3).
 *
 * K1 = A: a chat ("Thread ID" in the panel) is one member's conversation for
 * one day, a thread ("Chat ID") one connection inside it. What this file pins,
 * against real Postgres + Redis + Fastify, scenario by scenario from the
 * analysis' acceptance criteria (05 ID-02; Istanbul time, boundary 00:00, idle
 * window 30 minutes):
 *
 *   1  the day's first message opens the day: a new chat filed under today,
 *      its connection `first_of_day`, announced once as `chat_started`;
 *   2  back the same day: the same chat, a further connection
 *      (`same_day_return`) routed like an arrival, `thread_started` and never
 *      `chat_started`, an agents-only marker, `chat.connection_opened`;
 *   3  the next day: a new chat, yesterday's untouched;
 *   4  a reload, a second tab, a dropped connection: no new id of either kind;
 *   5  midnight never splits a live conversation; after it ends, today opens;
 *   6  yesterday's connection silent past the window is closed as a
 *      `day_rollover`, by the system, and today opens;
 *   7  two first messages at once: one chat, one connection, both messages —
 *      raced for real over separate database connections;
 *   8  23:59 and 00:01 in Istanbul are two days (injected clock);
 *  10  another browser with the same username is another member.
 *
 * Plus: the rating lands on the current connection, the spam filter screens a
 * return's opening message, the day's previous agent gets the return when
 * free (ID-02-S5), the day's teams accumulate (ID-02-S7), and another tenant
 * can neither find nor continue the day (RLS negative). Scenario 9 (an agent
 * reopening yesterday) is the agent path, tm 286.3.
 *
 * The day is moved the way it moves in production — the chat is filed under a
 * day once, so "it is now the next day" is the chat being filed under the day
 * before — or, where the boundary itself is the subject, with the service's
 * injectable clock.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDayKey } from '@siyahtus/types';
import type { CustomerPrincipal } from '../../src/services/auth/principal.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { dayKeyOf } from '../../src/services/chat/conversation-day.js';
import {
  auditContextFor,
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
const RECEIVER = 'https://93.184.216.34/hooks/day';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SPAM = 'Congratulations! You have won a prize — click here to claim now';

/** The send path's idempotency cache, unused by these service-level calls. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Delivery {
  action: string;
  data: Record<string, unknown>;
}

describe("the member's day — visitor path (ID-02)", () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;
  let support: bigint;
  /** Every webhook delivery, in order — the mock receiver. */
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

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    // Security settings (the spam filter's switch) are brand-scoped.
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);

    support = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: support },
    });

    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'webhooks--all:rw'],
    });
    // The three announcements a day's connections produce.
    for (const action of ['chat_started', 'thread_started', 'chat_deactivated']) {
      const hook = await server.post('/webhooks', { url: RECEIVER, action }, auth(agentToken));
      expect(hook.statusCode).toBe(201);
    }
    received = [];
  });

  // --- helpers ---------------------------------------------------------------

  async function widgetToken(tenant = fx.a, customerId?: string) {
    const response = await server.post(
      '/customer/token',
      {
        organization_id: tenant.organizationId,
        ...(customerId ? { customer_id: customerId } : {}),
      },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  async function say(token: string, text: string, extra: Record<string, unknown> = {}) {
    return server.post('/customer/chat/events', { text, ...extra }, auth(token));
  }

  /** The visitor's own "End chat": the connection closes, the day's chat with it. */
  async function endConnection(token: string): Promise<void> {
    expect((await server.post('/customer/chat/close', undefined, auth(token))).statusCode).toBe(
      204,
    );
  }

  const threadsOf = (chatId: string) =>
    owner.thread.findMany({ where: { chatId }, orderBy: { createdAt: 'asc' } });

  /** Today's key in the default boundary, read around an action that files one. */
  async function fileDay<T>(action: () => Promise<T>): Promise<{ result: T; days: string[] }> {
    const before = localDayKey(new Date());
    const result = await action();
    return { result, days: [before, localDayKey(new Date())] };
  }

  /**
   * "It is now the next day": the chat was filed under the day before. The day
   * is written once and never recomputed, so moving it is how the turn of the
   * day looks to the chat.
   */
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

  // ==========================================================================
  // Scenario 1 — the first message of the day
  // ==========================================================================

  it('opens the day: a new chat filed under today in Istanbul, its connection first_of_day (scenario 1)', async () => {
    const { token } = await widgetToken();
    const { result: response, days } = await fileDay(() => say(token, 'My Papara deposit'));
    expect(response.statusCode).toBe(201);
    const chatId = response.json().chat_id as string;

    const chat = await owner.chat.findUniqueOrThrow({ where: { id: chatId } });
    expect(days).toContain(dayKeyOf(chat.localDay!));
    expect(chat.dayTz).toBe('Europe/Istanbul');

    const threads = await threadsOf(chatId);
    expect(threads.map((t) => t.openedVia)).toEqual(['first_of_day']);
    expect(response.json().event.thread_id).toBe(threads[0]!.id);

    // Announced once, as the chat's start, naming its first connection.
    expect(received.map((d) => d.action)).toEqual(['chat_started']);
    expect(received[0]!.data).toMatchObject({ chat_id: chatId, thread_id: threads[0]!.id });
  });

  // ==========================================================================
  // Scenario 2 — back the same day
  // ==========================================================================

  it('keeps the Thread ID and opens a further connection, announced as thread_started only (scenario 2)', async () => {
    const { token, customer_id } = await widgetToken();
    const chatId = (await say(token, 'Morning: deposit missing')).json().chat_id as string;
    const [first] = await threadsOf(chatId);
    await endConnection(token);
    received = [];

    const back = await say(token, 'Afternoon: still missing');
    expect(back.statusCode).toBe(201);
    expect(back.json().chat_id).toBe(chatId);

    const threads = await threadsOf(chatId);
    expect(threads).toHaveLength(2);
    const second = threads[1]!;
    expect(second.id).not.toBe(first!.id);
    expect(second).toMatchObject({ active: true, openedVia: 'same_day_return' });
    expect(back.json().event.thread_id).toBe(second.id);

    // The day lists both connections, oldest first.
    const detail = await server.get(`/chats/${chatId}`, auth(agentToken));
    expect(detail.json()).toMatchObject({ id: chatId, active: true });
    expect(
      (detail.json().connections as Array<{ id: string; opened_via: string }>).map((c) => [
        c.id,
        c.opened_via,
      ]),
    ).toEqual([
      [first!.id, 'first_of_day'],
      [second.id, 'same_day_return'],
    ]);

    // Outside, exactly one announcement for the connection, and not a new chat.
    expect(received.map((d) => d.action)).toEqual(['thread_started']);
    expect(received[0]!.data).toMatchObject({
      chat_id: chatId,
      thread_id: second.id,
      customer_id,
      reason: 'same_day_return',
    });

    // The agents see where the return began; the visitor sees only their words.
    const markers = await owner.event.findMany({
      where: { threadId: second.id, authorType: 'system' },
    });
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      recipients: 'agents',
      text: 'Customer reconnected the same day',
    });
    const state = await server.get('/customer/chat', auth(token));
    expect(state.json().chat).toMatchObject({ id: chatId, thread_id: second.id });
    expect((state.json().events as Array<{ text: string }>).map((e) => e.text)).toEqual([
      'Afternoon: still missing',
    ]);

    // The reopening is in the trail, as the visitor's act, PII-minimal.
    const entry = await owner.auditLogEntry.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, action: 'chat.connection_opened' },
    });
    expect(entry).toMatchObject({
      target: `chat:${chatId}`,
      actorType: 'customer',
      actorId: customer_id,
    });
    expect(entry.metadata).toEqual({
      thread_id: second.id,
      opened_via: 'same_day_return',
      request_id: expect.any(String),
    });
  });

  it("routes the return like an arrival and prefers the day's earlier agent while they are free (ID-02-S5)", async () => {
    // Two agents in the team. Whoever took the morning has the more recent
    // assignment, so routing alone would now prefer the other one.
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support,
        agentId: fx.a.ownerAccountId,
        priority: 'normal',
      },
    });
    const { token } = await widgetToken();
    const chatId = (await say(token, 'Morning')).json().chat_id as string;
    const morningAgent = (await threadsOf(chatId))[0]!.assigneeId!;
    expect([fx.a.agentAccountId, fx.a.ownerAccountId]).toContain(morningAgent);
    await endConnection(token);

    await say(token, 'Afternoon');
    expect((await threadsOf(chatId))[1]!.assigneeId).toBe(morningAgent);

    // Not free any more: the next return is routed to whoever is.
    await endConnection(token);
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: morningAgent } },
      data: { routingStatus: 'offline' },
    });
    await say(token, 'Evening');
    const evening = (await threadsOf(chatId))[2]!;
    expect(evening.assigneeId).not.toBeNull();
    expect(evening.assigneeId).not.toBe(morningAgent);
  });

  it("adds the return's team to the day's access and keeps the morning's (ID-02-S7)", async () => {
    const sales = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: sales,
        agentId: fx.a.ownerAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        conditions: { url_contains: ['/pricing'] },
        targetGroupId: sales,
        priority: 1,
      },
    });

    const { token } = await widgetToken();
    const chatId = (await say(token, 'Help', { url: 'https://shop.test/support' })).json()
      .chat_id as string;
    await endConnection(token);
    // The morning's agent is away, so the return is routed by its page.
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
      data: { routingStatus: 'offline' },
    });
    await say(token, 'Prices?', { url: 'https://shop.test/pricing' });

    const access = await owner.chatAccess.findMany({ where: { chatId } });
    expect(access.map((a) => a.groupId).sort()).toEqual([support, sales].sort());
    expect((await threadsOf(chatId))[1]!.assigneeId).toBe(fx.a.ownerAccountId);
  });

  it('writes a rating after a return to the current connection (C2)', async () => {
    const { token } = await widgetToken();
    const chatId = (await say(token, 'Morning')).json().chat_id as string;
    await endConnection(token);
    await say(token, 'Afternoon');
    await endConnection(token);

    const rated = await server.post('/customer/chat/rating', { value: 'good' }, auth(token));
    expect(rated.statusCode).toBe(201);
    const rating = await owner.rating.findUniqueOrThrow({ where: { id: rated.json().id } });
    expect(rating.chatId).toBe(chatId);
    expect(rating.threadId).toBe((await threadsOf(chatId))[1]!.id);
  });

  it("screens a return's opening message for spam, and a refusal reopens nothing", async () => {
    const { token } = await widgetToken();
    const chatId = (await say(token, 'Morning')).json().chat_id as string;
    await endConnection(token);

    const refused = await say(token, SPAM);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.type).toBe('message_rejected');
    expect((await owner.chat.findUniqueOrThrow({ where: { id: chatId } })).active).toBe(false);
    expect(await threadsOf(chatId)).toHaveLength(1);
  });

  it('answers a retried message from the day it was written, never posting it twice', async () => {
    const { token } = await widgetToken();
    const sent = await say(token, 'Is my withdrawal done?', { idempotency_key: 'k-first' });
    expect(sent.statusCode).toBe(201);
    const chatId = sent.json().chat_id as string;

    const retried = await say(token, 'Is my withdrawal done?', { idempotency_key: 'k-first' });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().event.id).toBe(sent.json().event.id);

    // The connection ends before the retry arrives: still the same message, and
    // no further connection opened for it.
    await endConnection(token);
    const late = await say(token, 'Is my withdrawal done?', { idempotency_key: 'k-first' });
    expect(late.statusCode).toBe(200);
    expect(late.json()).toMatchObject({ chat_id: chatId, event: { id: sent.json().event.id } });
    expect(await threadsOf(chatId)).toHaveLength(1);
    expect(await owner.event.count({ where: { chatId, authorType: 'customer' } })).toBe(1);
  });

  // ==========================================================================
  // Scenario 3 — the next day
  // ==========================================================================

  it("opens a new Thread ID the next day and adds nothing to yesterday's (scenario 3)", async () => {
    const { token } = await widgetToken();
    const yesterday = (await say(token, 'Day one')).json().chat_id as string;
    await endConnection(token);
    await fileUnderYesterday(yesterday);
    received = [];

    const { result: next, days } = await fileDay(() => say(token, 'Day two'));
    const today = next.json().chat_id as string;
    expect(today).not.toBe(yesterday);
    expect(await threadsOf(yesterday)).toHaveLength(1);

    const chat = await owner.chat.findUniqueOrThrow({ where: { id: today } });
    expect(days).toContain(dayKeyOf(chat.localDay!));
    expect((await threadsOf(today)).map((t) => t.openedVia)).toEqual(['first_of_day']);
    expect(received.map((d) => d.action)).toEqual(['chat_started']);
  });

  // ==========================================================================
  // Scenario 4 — a reload, a second tab, a dropped connection
  // ==========================================================================

  it('mints no new Thread ID or Chat ID for a reload, a second tab or a reconnect (scenario 4)', async () => {
    const first = await widgetToken();
    const chatId = (await say(first.token, 'Hello')).json().chat_id as string;
    const [connection] = await threadsOf(chatId);

    // A reloaded page, a second tab, a reconnect: a fresh token, same member.
    const second = await widgetToken(fx.a, first.customer_id);
    expect(second.customer_id).toBe(first.customer_id);
    for (const token of [second.token, first.token, second.token]) {
      const response = await say(token, 'again');
      expect(response.statusCode).toBe(201);
      expect(response.json().chat_id).toBe(chatId);
      expect(response.json().event.thread_id).toBe(connection!.id);
    }
    expect(await threadsOf(chatId)).toHaveLength(1);
    expect(await owner.chat.count({ where: { customerId: first.customer_id } })).toBe(1);
  });

  // ==========================================================================
  // Scenario 5 — midnight
  // ==========================================================================

  it('keeps a live conversation that crosses midnight under its day; once it ends, today opens (scenario 5)', async () => {
    const { token } = await widgetToken();
    const lastNight = (await say(token, '23:50 — my withdrawal')).json().chat_id as string;
    const [connection] = await threadsOf(lastNight);
    // 00:10: the chat is yesterday's, its last message a few minutes old.
    await fileUnderYesterday(lastNight);

    const late = await say(token, '00:10 — any news?');
    expect(late.json().chat_id).toBe(lastNight);
    expect(late.json().event.thread_id).toBe(connection!.id);

    await endConnection(token);
    const { result: next, days } = await fileDay(() => say(token, '00:40 — me again'));
    const today = next.json().chat_id as string;
    expect(today).not.toBe(lastNight);
    expect(days).toContain(
      dayKeyOf((await owner.chat.findUniqueOrThrow({ where: { id: today } })).localDay!),
    );
    expect((await threadsOf(today)).map((t) => t.openedVia)).toEqual(['first_of_day']);
  });

  // ==========================================================================
  // Scenario 6 — yesterday's connection left open and silent
  // ==========================================================================

  it("closes yesterday's connection silent past 30 minutes as day_rollover and opens today's (scenario 6)", async () => {
    const { token } = await widgetToken();
    const yesterday = (await say(token, 'Last night')).json().chat_id as string;
    const [stale] = await threadsOf(yesterday);
    await fileUnderYesterday(yesterday);
    await silence(yesterday, 2 * HOUR);
    received = [];

    const morning = await say(token, 'Good morning');
    expect(morning.statusCode).toBe(201);
    const today = morning.json().chat_id as string;
    expect(today).not.toBe(yesterday);

    // Yesterday's, closed by the system — the reason on the transcript and in
    // the trail, nobody named.
    expect((await owner.thread.findUniqueOrThrow({ where: { id: stale!.id } })).active).toBe(false);
    expect((await owner.chat.findUniqueOrThrow({ where: { id: yesterday } })).active).toBe(false);
    const close = await owner.event.findFirstOrThrow({
      where: { threadId: stale!.id, authorType: 'system' },
    });
    expect(close.properties).toMatchObject({
      system_event: 'chat_deactivated',
      reason: 'day_rollover',
    });
    const archived = await owner.auditLogEntry.findFirstOrThrow({
      where: { action: 'chat.archived', target: `chat:${yesterday}` },
    });
    expect(archived).toMatchObject({ actorId: null, actorType: 'system', ip: null });
    // The request that noticed the turn of the day is kept for correlation.
    expect(archived.metadata).toEqual({
      thread_id: stale!.id,
      reason: 'day_rollover',
      request_id: morning.headers['x-request-id'],
    });

    // Today's: a new day whose first connection the rollover opened.
    expect((await threadsOf(today)).map((t) => t.openedVia)).toEqual(['day_rollover']);
    expect(received.map((d) => d.action)).toEqual(['chat_deactivated', 'chat_started']);
  });

  it("leaves yesterday's connection as it was when the opening message is refused", async () => {
    const { token } = await widgetToken();
    const yesterday = (await say(token, 'Last night')).json().chat_id as string;
    await fileUnderYesterday(yesterday);
    await silence(yesterday, 2 * HOUR);

    // The message would open today's connection, so it is screened — and the
    // refusal happens before yesterday's is closed.
    expect((await say(token, SPAM)).statusCode).toBe(403);
    expect((await owner.chat.findUniqueOrThrow({ where: { id: yesterday } })).active).toBe(true);
    expect(await owner.chat.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
  });

  // ==========================================================================
  // Scenario 7 — two first messages at once
  // ==========================================================================

  it('puts five first messages sent at once into one chat and one connection (scenario 7, HTTP)', async () => {
    const { token, customer_id } = await widgetToken();
    const responses = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((tab) => say(token, `tab ${tab}`)),
    );
    expect(responses.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(responses.map((r) => r.json().chat_id)).size).toBe(1);

    const chats = await owner.chat.findMany({ where: { customerId: customer_id } });
    expect(chats).toHaveLength(1);
    const threads = await threadsOf(chats[0]!.id);
    expect(threads).toHaveLength(1);
    expect(
      await owner.event.count({ where: { threadId: threads[0]!.id, authorType: 'customer' } }),
    ).toBe(5);
    expect(received.filter((d) => d.action === 'chat_started')).toHaveLength(1);
  });

  describe('raced over separate database connections (scenario 7)', () => {
    const RACERS = 8;
    let clients: PrismaClient[] = [];

    beforeEach(async () => {
      // One client serialises a burst on its warm connection; separate,
      // pre-connected clients are what makes the transactions overlap.
      clients = Array.from({ length: RACERS }, () => new PrismaClient({ datasourceUrl: APP_URL }));
      await Promise.all(clients.map((c) => c.$queryRaw`SELECT 1`));
    });

    afterAll(async () => {
      await Promise.all(clients.map((c) => c.$disconnect()));
    });

    async function racers(customerId: string, label: string) {
      const principal: CustomerPrincipal = {
        kind: 'customer',
        customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
      };
      return Promise.all(
        clients.map((client, i) =>
          new ChatService(client, NO_REDIS).openOrContinueConnection(ctx(fx.a), principal, {
            customerId,
            event: { type: 'message', text: `${label} ${i}`, recipients: 'all' },
            audit: auditContextFor(fx.a, { actorId: customerId, actorType: 'customer' }),
          }),
        ),
      );
    }

    async function newMember(): Promise<string> {
      return (
        await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: 'Racer' },
          select: { id: true },
        })
      ).id;
    }

    it('opens the day once: one chat, one connection, every message in it', async () => {
      const customerId = await newMember();
      const results = await racers(customerId, 'first');

      expect(new Set(results.map((r) => r.chat.id)).size).toBe(1);
      const chats = await owner.chat.findMany({ where: { customerId } });
      expect(chats).toHaveLength(1);
      const threads = await threadsOf(chats[0]!.id);
      expect(threads).toHaveLength(1);
      expect(await owner.event.count({ where: { threadId: threads[0]!.id } })).toBe(RACERS);
      // Exactly one of them opened it.
      expect(results.filter((r) => r.openedVia === 'first_of_day')).toHaveLength(1);
    });

    it('opens one further connection when the member returns from several tabs at once', async () => {
      const customerId = await newMember();
      const [first] = await racers(customerId, 'morning');
      const principal: CustomerPrincipal = {
        kind: 'customer',
        customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
      };
      await new ChatService(appRole, NO_REDIS).deactivate(
        ctx(fx.a),
        principal,
        first!.chat.id,
        auditContextFor(fx.a),
      );

      const results = await racers(customerId, 'afternoon');
      expect(new Set(results.map((r) => r.chat.id))).toEqual(new Set([first!.chat.id]));
      const threads = await threadsOf(first!.chat.id);
      expect(threads.map((t) => t.openedVia)).toEqual(['first_of_day', 'same_day_return']);
      expect(
        await owner.event.count({ where: { threadId: threads[1]!.id, authorType: 'customer' } }),
      ).toBe(RACERS);
      expect(results.filter((r) => r.openedVia === 'same_day_return')).toHaveLength(1);
    });

    it("rolls yesterday's silent connection over once, however many tabs arrive", async () => {
      const customerId = await newMember();
      const [first] = await racers(customerId, 'last night');
      await fileUnderYesterday(first!.chat.id);
      await silence(first!.chat.id, 2 * HOUR);

      const results = await racers(customerId, 'morning');
      const today = new Set(results.map((r) => r.chat.id));
      expect(today.size).toBe(1);
      expect(today.has(first!.chat.id)).toBe(false);
      // One close, one line in the trail for it.
      expect(
        await owner.event.count({
          where: { chatId: first!.chat.id, authorType: 'system', type: 'system_message' },
        }),
      ).toBe(1);
      expect(
        await owner.auditLogEntry.count({
          where: { action: 'chat.archived', target: `chat:${first!.chat.id}` },
        }),
      ).toBe(1);
      expect(results.filter((r) => r.openedVia === 'day_rollover')).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Scenario 8 — the day boundary, on the service's clock
  // ==========================================================================

  describe('the day boundary (scenario 8)', () => {
    let clock: Date;
    const service = () => new ChatService(appRole, NO_REDIS, ...noOptionals(), () => clock);

    async function member(): Promise<{ customerId: string; principal: CustomerPrincipal }> {
      const { id } = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Night owl' },
        select: { id: true },
      });
      return {
        customerId: id,
        principal: {
          kind: 'customer',
          customerId: id,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
        },
      };
    }

    const send = (customerId: string, principal: CustomerPrincipal, text: string) =>
      service().openOrContinueConnection(ctx(fx.a), principal, {
        customerId,
        event: { type: 'message', text, recipients: 'all' },
        audit: auditContextFor(fx.a, { actorId: customerId, actorType: 'customer' }),
      });

    it('files 23:59 and 00:01 in Istanbul under two days and two Thread IDs', async () => {
      const { customerId, principal } = await member();
      clock = new Date('2026-03-10T20:59:00Z'); // 23:59 in Istanbul (UTC+3)
      const late = await send(customerId, principal, 'Just before midnight');
      expect(late.chat.local_day).toBe('2026-03-10');
      await service().deactivate(ctx(fx.a), principal, late.chat.id, auditContextFor(fx.a));

      clock = new Date('2026-03-10T21:01:00Z'); // 00:01
      const early = await send(customerId, principal, 'Just after');
      expect(early.chat.id).not.toBe(late.chat.id);
      expect(early.chat.local_day).toBe('2026-03-11');
      expect(early.openedVia).toBe('first_of_day');
    });

    it("files the day in the workspace's own boundary, and records the zone it was counted in", async () => {
      const brand = await owner.brand.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, isDefault: true },
        select: { id: true },
      });
      await owner.inboxSettings.create({
        data: {
          licenseId: fx.a.licenseId,
          brandId: brand.id,
          dayBoundaryTz: 'America/New_York',
          dayBoundaryHour: 6,
        },
      });
      const { customerId, principal } = await member();
      // 05:30 in New York (UTC-4 in October): still the previous day.
      clock = new Date('2026-10-15T09:30:00Z');
      const result = await send(customerId, principal, 'Early shift');
      expect(result.chat.local_day).toBe('2026-10-14');
      expect((await owner.chat.findUniqueOrThrow({ where: { id: result.chat.id } })).dayTz).toBe(
        'America/New_York',
      );
    });
  });

  // ==========================================================================
  // Scenario 10 — another browser
  // ==========================================================================

  it('gives a different browser typing the same username a different member and Thread ID (scenario 10)', async () => {
    const here = await widgetToken();
    const there = await widgetToken();
    const a = await say(here.token, 'hi', { username: 'lucky_7' });
    const b = await say(there.token, 'hi', { username: 'lucky_7' });

    expect(there.customer_id).not.toBe(here.customer_id);
    expect(b.json().chat_id).not.toBe(a.json().chat_id);
  });

  // ==========================================================================
  // Isolation (NFR-S4) — the mandatory negative test
  // ==========================================================================

  it("never lets another tenant find or continue this tenant's day", async () => {
    const { token, customer_id } = await widgetToken();
    const chatId = (await say(token, 'Mine')).json().chat_id as string;
    await endConnection(token);

    // B's widget presenting A's member id is simply a member of B.
    const intruder = await widgetToken(fx.b, customer_id);
    expect(intruder.customer_id).not.toBe(customer_id);
    const theirs = await say(intruder.token, 'Theirs');
    expect(theirs.statusCode).toBe(201);
    expect(theirs.json().chat_id).not.toBe(chatId);

    // And B's context naming A's member reaches nothing at all.
    const principal: CustomerPrincipal = {
      kind: 'customer',
      customerId: customer_id,
      organizationId: fx.b.organizationId,
      licenseId: fx.b.licenseId,
    };
    await expect(
      new ChatService(appRole, NO_REDIS).openOrContinueConnection(ctx(fx.b), principal, {
        customerId: customer_id,
        event: { type: 'message', text: 'continue it', recipients: 'all' },
        audit: auditContextFor(fx.b),
      }),
    ).rejects.toMatchObject({ status: 404 });

    expect(await threadsOf(chatId)).toHaveLength(1);
    expect((await owner.chat.findUniqueOrThrow({ where: { id: chatId } })).active).toBe(false);
  });
});

/**
 * The seven optional collaborators between the Redis double and the clock, left
 * unset: no publisher, default routing and billing, no mailer, channels or
 * automations, the default goal recorder.
 */
function noOptionals(): [
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
] {
  return [undefined, undefined, undefined, undefined, undefined, undefined, undefined];
}
