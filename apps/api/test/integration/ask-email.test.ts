/**
 * Asking a waiting player for an e-mail (WG-08 · tm 342), through the real
 * server and the inactivity sweep:
 *
 *   1. The settings: `ask_email_after_seconds` + `ask_email_when_offline` on
 *      `/settings/chat-timeout`, off until saved, ordered before the transfer.
 *   2. The delay trigger: a connection the player wrote to and nobody answered
 *      in time gets ONE `ask_email` system event — in the player's language,
 *      to the player and the inbox — and a second pass writes nothing.
 *   3. Who is not asked: a player the team can reach (e-mail or username) gets
 *      the "we will reply here" line instead of a card; an answered
 *      connection, one the AI has, one the player never wrote to, and every
 *      connection while the setting is off get nothing.
 *   4. The offline trigger: nobody accepting chats asks at once; with an AI
 *      that would answer, only after it handed the connection over.
 *   5. Order: in the same pass the ask comes before the transfer, and the
 *      transfer does not ask again.
 *   6. The answer: `POST /customer/chat/email` stores the address on the
 *      contact (a lead), writes the answered event once, takes only a
 *      connection that was asked, and refuses what is not an address.
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
const ASK_SECONDS = 120;
const TRANSFER_SECONDS = 300;

const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Envelope {
  action: string;
  audience: { customerId?: string };
  payload: { event?: { properties?: Record<string, unknown>; text?: string } };
}

describe('asking a waiting player for an e-mail (WG-08)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let chats: ChatService;
  let supportId: bigint;
  let adminToken: string;
  let listener: Redis;
  let pushes: Envelope[];
  let seq = 0;

  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const sweep = (ms = 0) =>
    new ChatInactivitySweeper(appRole, chats).run({ now: new Date(Date.now() + ms * SECOND) });

  const putSettings = (payload: Record<string, unknown>) =>
    server.app.inject({
      method: 'PUT',
      url: server.url('/settings/chat-timeout'),
      payload: { chat_timeout_seconds: null, ...payload },
      headers: auth(adminToken),
    });
  async function settings(payload: Record<string, unknown>): Promise<void> {
    const response = await putSettings(payload);
    expect(response.statusCode, response.body).toBe(200);
  }

  /** Every person in the fixture stops accepting chats, so the widget is "offline". */
  async function nobodyAccepting(): Promise<void> {
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { routingStatus: 'not_accepting_chats' },
    });
  }

  async function addAgent(): Promise<string> {
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@askemail.test`.toLowerCase(), name: 'Agent' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: account.id,
        role: 'agent',
        routingStatus: 'accepting_chats',
        concurrentChatsLimit: 6,
      },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: supportId, agentId: account.id, isLead: false },
    });
    return account.id;
  }

  async function aiAgent(): Promise<void> {
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: agent.id,
        name: 'Skill',
        kind: 'ai_agent',
        steps: [{ type: 'send_message', source: 'text', text: 'Merhaba' }],
        active: true,
        updatedAt: new Date(),
      },
    });
  }

  /** A widget visitor, through the real token mint. */
  async function visitor(): Promise<{ headers: Record<string, string>; customerId: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const minted = response.json() as { token: string; customer_id: string };
    return { headers: auth(minted.token), customerId: minted.customer_id };
  }

  /** The visitor writes: their message opens a connection (routed to Support). */
  async function say(
    headers: Record<string, string>,
    extra: Record<string, unknown> = {},
  ): Promise<{ chatId: string; threadId: string }> {
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'Param yatmadı', ...extra },
      headers,
    );
    expect(sent.statusCode, sent.body).toBe(201);
    const { chat_id: chatId, event } = sent.json() as {
      chat_id: string;
      event: { thread_id: string };
    };
    return { chatId, threadId: event.thread_id };
  }

  /** A Support connection written straight in, with a player message unless `quiet`. */
  async function bare(
    options: { aiMode?: string; quiet?: boolean; firstResponse?: boolean } = {},
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
        ...(options.aiMode ? { aiMode: options.aiMode } : {}),
        ...(options.firstResponse ? { firstResponseAt: new Date() } : {}),
      },
    });
    if (!options.quiet) {
      seq += 1;
      await owner.event.create({
        data: {
          id: `${threadId}_x${seq}`,
          threadId,
          chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'Param yatmadı',
          authorType: 'customer',
          recipients: 'all',
          properties: {},
        },
      });
    }
    return { chatId, threadId, customerId: customer.id };
  }

  const familyEvents = (threadId: string) =>
    owner.event.findMany({
      where: {
        threadId,
        type: 'system_message',
        OR: [
          { properties: { path: ['system_event'], equals: 'ask_email' } },
          { properties: { path: ['system_event'], equals: 'reply_here' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { text: true, recipients: true, authorType: true, properties: true },
    });

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

  // --- 1. The settings ---------------------------------------------------------

  it('reads off until saved, saves both, keeps what a save leaves out, and refuses a window out of order (WG-08)', async () => {
    const read = async () =>
      (await server.get('/settings/chat-timeout', auth(adminToken))).json() as Record<
        string,
        unknown
      >;
    expect(await read()).toMatchObject({
      ask_email_after_seconds: null,
      ask_email_when_offline: false,
    });

    await settings({ ask_email_after_seconds: ASK_SECONDS, ask_email_when_offline: true });
    expect(await read()).toMatchObject({
      ask_email_after_seconds: ASK_SECONDS,
      ask_email_when_offline: true,
    });
    // A save that names neither keeps both.
    await settings({ unanswered_transfer_seconds: TRANSFER_SECONDS });
    expect(await read()).toMatchObject({
      ask_email_after_seconds: ASK_SECONDS,
      ask_email_when_offline: true,
      unanswered_transfer_seconds: TRANSFER_SECONDS,
    });

    // Not before the transfer: refused, and nothing changes.
    const late = await putSettings({ ask_email_after_seconds: TRANSFER_SECONDS });
    expect(late.statusCode).toBe(400);
    expect(late.json()).toMatchObject({
      error: { details: { problem: 'ask_email_not_before_transfer' } },
    });
    // …nor can the transfer move to or before it.
    const early = await putSettings({ unanswered_transfer_seconds: ASK_SECONDS });
    expect(early.statusCode).toBe(400);
    expect(await read()).toMatchObject({ ask_email_after_seconds: ASK_SECONDS });

    expect((await putSettings({ ask_email_after_seconds: 0 })).statusCode).toBe(400);
    expect((await putSettings({ ask_email_when_offline: 'yes' })).statusCode).toBe(400);
    await expect(
      owner.$executeRaw`UPDATE inbox_settings SET ask_email_after_seconds = 0 WHERE license_id = ${fx.a.licenseId}`,
    ).rejects.toThrow(/inbox_settings_ask_email_after_seconds_check/);

    await settings({ ask_email_after_seconds: null });
    expect(await read()).toMatchObject({ ask_email_after_seconds: null });
  });

  // --- 2. The delay trigger ----------------------------------------------------

  it('asks the player once, in their language, when nobody answered in time — and a second pass writes nothing', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await addAgent();
    const { headers, customerId } = await visitor();
    await owner.customer.update({ where: { id: customerId }, data: { locale: 'en' } });
    const { threadId } = await say(headers);
    expect(
      (await owner.thread.findUniqueOrThrow({ where: { id: threadId } })).assigneeId,
    ).not.toBeNull();

    // Inside the window: nothing.
    expect((await sweep(60)).totals).toMatchObject({ askedEmail: 0, repliedHere: 0 });
    expect(await familyEvents(threadId)).toEqual([]);

    // Past it: one card, the system's, to everyone, in English.
    expect((await sweep(ASK_SECONDS + 10)).totals).toMatchObject({ askedEmail: 1, repliedHere: 0 });
    const events = await familyEvents(threadId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      authorType: 'system',
      recipients: 'all',
      properties: { system_event: 'ask_email' },
    });
    expect(events[0]!.text).toContain('e-mail address');

    // The player's widget hears it.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const heard = pushes.filter(
      (p) =>
        p.action === 'incoming_event' &&
        p.payload.event?.properties?.['system_event'] === 'ask_email',
    );
    expect(heard).toHaveLength(1);
    expect(heard[0]!.audience.customerId).toBe(customerId);

    // Idempotent: later passes, however late, find the event and stop.
    expect((await sweep(ASK_SECONDS + 400)).totals).toMatchObject({
      askedEmail: 0,
      repliedHere: 0,
    });
    expect(await familyEvents(threadId)).toHaveLength(1);
  });

  it('asks in Turkish when the player has no language on file', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await addAgent();
    const { headers } = await visitor();
    const { threadId } = await say(headers);
    await sweep(ASK_SECONDS + 10);
    expect((await familyEvents(threadId))[0]!.text).toContain('e-posta adresinizi bırakın');
  });

  it('measures a connection nobody has from when it joined the queue', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await nobodyAccepting();
    const { headers } = await visitor();
    const { threadId } = await say(headers);
    const thread = await owner.thread.findUniqueOrThrow({ where: { id: threadId } });
    expect(thread.assigneeId).toBeNull();

    expect((await sweep(60)).totals.askedEmail).toBe(0);
    expect((await sweep(ASK_SECONDS + 10)).totals.askedEmail).toBe(1);
  });

  // --- 3. Who is not asked -------------------------------------------------------

  it('tells a player the team can reach — by username or by e-mail — that the answer comes here, with no card', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await addAgent();
    const named = await visitor();
    const byName = await say(named.headers, { username: 'oyuncu42' });
    const mailed = await visitor();
    const byMail = await say(mailed.headers, { email: 'oyuncu@example.com' });
    const anon = await visitor();
    const nobody = await say(anon.headers);

    expect((await sweep(ASK_SECONDS + 10)).totals).toMatchObject({ askedEmail: 1, repliedHere: 2 });
    for (const known of [byName, byMail]) {
      const events = await familyEvents(known.threadId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ properties: { system_event: 'reply_here' } });
      expect(events[0]!.text).toContain('sohbet üzerinden');
    }
    expect(await familyEvents(nobody.threadId)).toMatchObject([
      { properties: { system_event: 'ask_email' } },
    ]);

    // One line per connection, whatever comes after.
    expect((await sweep(ASK_SECONDS + 500)).totals).toMatchObject({
      askedEmail: 0,
      repliedHere: 0,
    });
  });

  it('does nothing while the setting is off, however long the player waits', async () => {
    await addAgent();
    const { headers } = await visitor();
    const { threadId } = await say(headers);
    expect((await sweep(86_400)).totals).toMatchObject({ askedEmail: 0, repliedHere: 0 });
    // Turned on and off again.
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await settings({ ask_email_after_seconds: null, ask_email_when_offline: false });
    expect((await sweep(86_400)).totals).toMatchObject({ askedEmail: 0, repliedHere: 0 });
    expect(await familyEvents(threadId)).toEqual([]);
  });

  it('spares a connection a person answered, one the AI has, and one the player never wrote to', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS, ask_email_when_offline: true });
    await nobodyAccepting();
    const answered = await bare({ firstResponse: true });
    const aiHas = await bare({ aiMode: 'ai' });
    const quiet = await bare({ quiet: true });

    expect((await sweep(ASK_SECONDS + 10)).totals).toMatchObject({ askedEmail: 0, repliedHere: 0 });
    for (const connection of [answered, aiHas, quiet]) {
      expect(await familyEvents(connection.threadId)).toEqual([]);
    }
  });

  it('is spared by a reply that lands before the ask takes the locks', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await addAgent();
    const { headers } = await visitor();
    const { threadId } = await say(headers);
    // The agent answers after the listing would have found the connection: the
    // question asked again under the lock says no.
    await owner.thread.update({ where: { id: threadId }, data: { firstResponseAt: new Date() } });
    const rule = { cutoff: new Date(Date.now() + 1_000), offline: 'off' as const };
    const thread = await owner.thread.findUniqueOrThrow({ where: { id: threadId } });
    expect(await chats.requestContact(ctx(), { chatId: thread.chatId, threadId }, rule)).toBeNull();
    expect(await familyEvents(threadId)).toEqual([]);
  });

  // --- 4. The offline trigger ----------------------------------------------------

  it('asks at once while nobody is accepting chats, and not while someone is', async () => {
    await settings({ ask_email_when_offline: true });
    await nobodyAccepting();
    const { headers } = await visitor();
    const { threadId } = await say(headers);

    expect((await sweep()).totals).toMatchObject({ askedEmail: 1 });
    expect(await familyEvents(threadId)).toMatchObject([
      { properties: { system_event: 'ask_email' } },
    ]);

    // With a person accepting, a new waiting player is not asked.
    await addAgent();
    const second = await visitor();
    const next = await say(second.headers);
    await owner.thread.update({ where: { id: next.threadId }, data: { assigneeId: null } });
    expect((await sweep()).totals.askedEmail).toBe(0);
  });

  it('waits for the AI to hand the connection over when an AI would answer', async () => {
    await settings({ ask_email_when_offline: true });
    await nobodyAccepting();
    await aiAgent();
    const waiting = await bare();
    const handedOver = await bare({ aiMode: 'human' });

    expect((await sweep()).totals.askedEmail).toBe(1);
    expect(await familyEvents(waiting.threadId)).toEqual([]);
    expect(await familyEvents(handedOver.threadId)).toMatchObject([
      { properties: { system_event: 'ask_email' } },
    ]);
  });

  // --- 5. Order -------------------------------------------------------------------

  it('asks before the transfer in the same pass, and the new agent does not ask again', async () => {
    await settings({
      ask_email_after_seconds: ASK_SECONDS,
      unanswered_transfer_seconds: TRANSFER_SECONDS,
    });
    const first = await addAgent();
    const second = await addAgent();
    const { headers } = await visitor();
    const { threadId } = await say(headers);
    const holder = (await owner.thread.findUniqueOrThrow({ where: { id: threadId } })).assigneeId;
    expect([first, second]).toContain(holder);

    // Past the first window only: asked, not transferred.
    expect((await sweep(ASK_SECONDS + 10)).totals).toMatchObject({ askedEmail: 1, transferred: 0 });
    expect((await owner.thread.findUniqueOrThrow({ where: { id: threadId } })).assigneeId).toBe(
      holder,
    );

    // Past the second: transferred, the event stays the one it was.
    expect((await sweep(TRANSFER_SECONDS + 10)).totals).toMatchObject({
      askedEmail: 0,
      transferred: 1,
    });
    expect((await owner.thread.findUniqueOrThrow({ where: { id: threadId } })).assigneeId).not.toBe(
      holder,
    );
    expect(await familyEvents(threadId)).toHaveLength(1);
    // The new agent's wait starts over; the player is not asked a second time.
    expect((await sweep(TRANSFER_SECONDS + ASK_SECONDS + 400)).totals.askedEmail).toBe(0);
  });

  // --- 6. The answer ---------------------------------------------------------------

  it('stores the address on the contact, answers the card once, and takes only a connection that was asked', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await addAgent();
    const { headers, customerId } = await visitor();

    // No conversation yet: 409.
    expect(
      (await server.post('/customer/chat/email', { email: 'a@b.co' }, headers)).statusCode,
    ).toBe(409);

    const { threadId } = await say(headers);
    // A connection nobody asked: 404, nothing stored.
    const early = await server.post(
      '/customer/chat/email',
      { email: 'oyuncu@example.com' },
      headers,
    );
    expect(early.statusCode).toBe(404);
    expect(
      (await owner.customer.findUniqueOrThrow({ where: { id: customerId } })).email,
    ).toBeNull();

    await sweep(ASK_SECONDS + 10);
    pushes = [];

    // Not an address: 400.
    for (const email of ['not-an-address', '', ' ', 'a@b']) {
      expect((await server.post('/customer/chat/email', { email }, headers)).statusCode).toBe(400);
    }
    expect(
      (await server.post('/customer/chat/email', { email: 'a@b.co', x: 1 }, headers)).statusCode,
    ).toBe(400);

    const saved = await server.post(
      '/customer/chat/email',
      { email: '  Oyuncu@Example.com ' },
      headers,
    );
    expect(saved.statusCode, saved.body).toBe(204);
    const customer = await owner.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer).toMatchObject({ email: 'Oyuncu@Example.com', isLead: true });

    const answered = await owner.event.findMany({
      where: { threadId, properties: { path: ['system_event'], equals: 'ask_email_answered' } },
      select: { text: true, authorType: true, recipients: true, properties: true },
    });
    expect(answered).toHaveLength(1);
    expect(answered[0]).toMatchObject({ authorType: 'system', recipients: 'all' });
    // The address is nowhere in the event.
    expect(JSON.stringify(answered)).not.toContain('example.com');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(
      pushes.filter(
        (p) =>
          p.action === 'incoming_event' &&
          p.payload.event?.properties?.['system_event'] === 'ask_email_answered',
      ),
    ).toHaveLength(1);

    // A second answer replaces the address and writes no second event.
    const again = await server.post('/customer/chat/email', { email: 'yeni@example.com' }, headers);
    expect(again.statusCode).toBe(204);
    expect((await owner.customer.findUniqueOrThrow({ where: { id: customerId } })).email).toBe(
      'yeni@example.com',
    );
    expect(
      await owner.event.count({
        where: { threadId, properties: { path: ['system_event'], equals: 'ask_email_answered' } },
      }),
    ).toBe(1);

    // The poll carries both events, with the property the widget keys on.
    const poll = await server.get('/customer/chat', headers);
    const kinds = (
      poll.json() as { events: Array<{ properties?: Record<string, unknown> }> }
    ).events
      .map((event) => event.properties?.['system_event'])
      .filter((kind) => typeof kind === 'string' && kind.startsWith('ask_email'));
    expect(kinds).toEqual(['ask_email', 'ask_email_answered']);
  });

  it('does not take an address for a connection that got the "reply here" line instead', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await addAgent();
    const { headers, customerId } = await visitor();
    await say(headers, { username: 'oyuncu42' });
    await sweep(ASK_SECONDS + 10);

    const refused = await server.post('/customer/chat/email', { email: 'x@example.com' }, headers);
    expect(refused.statusCode).toBe(404);
    expect(
      (await owner.customer.findUniqueOrThrow({ where: { id: customerId } })).email,
    ).toBeNull();
  });

  it('limits the answers one visitor may send in an hour', async () => {
    await settings({ ask_email_after_seconds: ASK_SECONDS });
    await addAgent();
    const { headers } = await visitor();
    await say(headers);
    await sweep(ASK_SECONDS + 10);

    let last = 0;
    for (let i = 0; i < 11; i += 1) {
      last = (await server.post('/customer/chat/email', { email: `p${i}@example.com` }, headers))
        .statusCode;
    }
    expect(last).toBe(429);
  });
});
