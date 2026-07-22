/**
 * RTM gateway.
 *
 * The property this slice exists for is that a dropped connection costs
 * nothing. Everything else — auth, subscriptions, fan-out filtering — is in
 * service of that, so the reconnect tests come first and are the most detailed.
 *
 * These drive a real server over a real socket against real Postgres and Redis.
 * Mocking the transport would test the mock: the login window, framing,
 * back-pressure and delivery ordering only exist at that level.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, type BusEnvelope, type PushAudience } from '@nexa/types';
import {
  createConversation,
  createCustomer,
  customerToken,
  grantToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket } from '../helpers/rtm-harness.js';

const AGENT_PUSHES = [
  'incoming_chat',
  'incoming_event',
  'chat_deactivated',
  'chat_transferred',
  'routing_status_set',
];

describe('rtm gateway', () => {
  let db: PrismaClient;
  let redis: Redis;
  let rtm: Awaited<ReturnType<typeof startRtm>>;
  let fx: RtmFixtures;
  const customerSecret = process.env['CUSTOMER_TOKEN_SECRET'] ?? '';

  const sockets: TestSocket[] = [];

  beforeAll(async () => {
    db = ownerClient();
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6380');
    rtm = await startRtm();
  });

  afterAll(async () => {
    for (const socket of sockets) socket.close();
    await rtm.close();
    await redis.quit();
    await db.$disconnect();
  });

  beforeEach(async () => {
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    fx = await seedRtmFixtures(db);
  });

  async function connect(tenant: RtmTenant, side: 'agent' | 'customer' = 'agent') {
    const socket = await TestSocket.connect(rtm.port, {
      organizationId: tenant.organizationId,
      side,
    });
    sockets.push(socket);
    return socket;
  }

  /** Connect and log in as an agent, subscribed to the usual pushes. */
  async function loginAgent(tenant: RtmTenant, accountId: string, scopes = ['chats--access:rw']) {
    const token = await grantToken(db, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: accountId,
      scopes,
    });
    const socket = await connect(tenant);
    const response = await socket.request('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': AGENT_PUSHES },
    });
    expect(response.success).toBe(true);
    return socket;
  }

  /** Publish exactly what the API would, without running the API. */
  async function publish(
    tenant: RtmTenant,
    action: string,
    audience: PushAudience,
    payload: unknown,
  ): Promise<void> {
    const envelope: BusEnvelope = {
      v: 1,
      licenseId: tenant.licenseId.toString(),
      organizationId: tenant.organizationId,
      action: action as BusEnvelope['action'],
      audience,
      payload,
      at: Date.now(),
    };
    await redis.publish(licenseChannel(tenant.licenseId), JSON.stringify(envelope));
  }

  // =========================================================================
  // Reconnect and missed-event sync — the point of this slice
  // =========================================================================

  describe('missed-event sync', () => {
    it('replays everything sent while the socket was down', async () => {
      const conversation = await createConversation(db, {
        tenant: fx.a,
        messages: ['first', 'second'],
      });

      const before = await loginAgent(fx.a, fx.a.agentAccountId);
      const seen = conversation.eventIds[1]!;
      before.close();

      // Three messages arrive with nobody listening — the exact situation the
      // client cannot detect on its own.
      for (const text of ['while-away-1', 'while-away-2', 'while-away-3']) {
        await appendEvent(db, conversation, text);
      }

      const after = await loginAgent(fx.a, fx.a.agentAccountId);
      const response = await after.request('sync', {
        cursors: { [conversation.chatId]: seen },
      });

      const chats = response.payload['chats'] as Array<{
        chat_id: string;
        events: Array<{ text: string }>;
        truncated: boolean;
      }>;
      const replayed = chats.find((c) => c.chat_id === conversation.chatId);

      expect(replayed?.events.map((e) => e.text)).toEqual([
        'while-away-1',
        'while-away-2',
        'while-away-3',
      ]);
      expect(replayed?.truncated).toBe(false);
    });

    it('replays nothing when the client is already current', async () => {
      const conversation = await createConversation(db, {
        tenant: fx.a,
        messages: ['only message'],
      });
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });
      const chats = response.payload['chats'] as Array<{ events: unknown[] }>;
      expect(chats[0]?.events).toEqual([]);
    });

    it('replays the whole thread when the client has no cursor', async () => {
      const conversation = await createConversation(db, {
        tenant: fx.a,
        messages: ['a', 'b', 'c'],
      });
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: null },
      });
      const chats = response.payload['chats'] as Array<{ events: Array<{ text: string }> }>;
      expect(chats[0]?.events.map((e) => e.text)).toEqual(['a', 'b', 'c']);
    });

    it('orders replay by sequence, not by timestamp', async () => {
      // Several events can share a millisecond, and clocks differ between
      // processes — which is exactly why the cursor is a sequence, not a time.
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['start'] });
      const sameInstant = new Date();
      for (let i = 2; i <= 13; i++) {
        await db.event.create({
          data: {
            id: `${conversation.threadId}_${i}`,
            threadId: conversation.threadId,
            chatId: conversation.chatId,
            licenseId: fx.a.licenseId,
            type: 'message',
            text: `m${i}`,
            authorType: 'customer',
            createdAt: sameInstant,
          },
        });
      }

      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });
      const chats = response.payload['chats'] as Array<{ events: Array<{ text: string }> }>;

      // Lexical id ordering would give m10, m11, m12, m13, m2, m3...
      expect(chats[0]?.events.map((e) => e.text)).toEqual(
        Array.from({ length: 12 }, (_, i) => `m${i + 2}`),
      );
    });

    it('flags a gap too large to replay instead of flooding the client', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['start'] });
      // 250 messages, above the 200 replay cap.
      for (let i = 2; i <= 251; i++) {
        await db.event.create({
          data: {
            id: `${conversation.threadId}_${i}`,
            threadId: conversation.threadId,
            chatId: conversation.chatId,
            licenseId: fx.a.licenseId,
            type: 'message',
            text: `m${i}`,
            authorType: 'customer',
          },
        });
      }

      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });
      const chats = response.payload['chats'] as Array<{
        events: unknown[];
        truncated: boolean;
      }>;

      expect(chats[0]?.truncated).toBe(true);
      expect(chats[0]?.events).toHaveLength(200);
    });

    it('reports chats gained while disconnected', async () => {
      const known = await createConversation(db, { tenant: fx.a, messages: ['known'] });
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      // Arrived while the client was away; it holds no cursor for this one.
      // A different customer, because one active chat per customer is enforced.
      const gained = await createConversation(db, {
        tenant: fx.a,
        messages: ['new'],
        customerId: await createCustomer(db, fx.a),
      });

      const response = await socket.request('sync', {
        cursors: { [known.chatId]: known.eventIds[0] },
      });

      expect(response.payload['new_chat_ids']).toContain(gained.chatId);
      // Not silently replayed: the client fetches it properly rather than
      // receiving an unbounded history it never asked for.
      const chats = response.payload['chats'] as Array<{ chat_id: string }>;
      expect(chats.map((c) => c.chat_id)).not.toContain(gained.chatId);
    });

    it('reports chats the client can no longer see', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hi'] });
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      // Moved to a team this agent is not in.
      await db.chatAccess.deleteMany({ where: { chatId: conversation.chatId } });
      await db.chatAccess.create({
        data: { chatId: conversation.chatId, groupId: fx.a.salesGroupId },
      });

      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });
      expect(response.payload['removed_chat_ids']).toContain(conversation.chatId);
    });

    it('asks for a refetch when the cursor names a superseded thread', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['old'] });
      const staleCursor = conversation.eventIds[0]!;

      // The conversation was archived and reopened while the client was away,
      // so its position refers to a thread that is no longer current.
      await db.thread.update({
        where: { id: conversation.threadId },
        data: { active: false, closedAt: new Date() },
      });
      const newThreadId = `${conversation.threadId.slice(0, 9)}X`;
      await db.thread.create({
        data: {
          id: newThreadId,
          chatId: conversation.chatId,
          licenseId: fx.a.licenseId,
          active: true,
        },
      });

      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: staleCursor },
      });
      const chats = response.payload['chats'] as Array<{ truncated: boolean }>;
      // Truncated rather than replaying from zero, which for a long history
      // would flood the client.
      expect(chats[0]?.truncated).toBe(true);
    });

    it("never replays another tenant's conversation", async () => {
      const theirs = await createConversation(db, { tenant: fx.b, messages: ['their secret'] });
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      const response = await socket.request('sync', {
        cursors: { [theirs.chatId]: null },
      });

      const chats = response.payload['chats'] as Array<{ chat_id: string }>;
      expect(chats.map((c) => c.chat_id)).not.toContain(theirs.chatId);
      // Reported as gone rather than 403 — the client is simply told it is not
      // theirs, with no confirmation that the id exists.
      expect(response.payload['removed_chat_ids']).toContain(theirs.chatId);
      expect(JSON.stringify(response.payload)).not.toContain('their secret');
    });

    it("withholds internal notes from a customer's replay", async () => {
      // Reconnect must not become the one path that leaks a note.
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      await db.event.create({
        data: {
          id: `${conversation.threadId}_2`,
          threadId: conversation.threadId,
          chatId: conversation.chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'INTERNAL-ONLY',
          authorType: 'agent',
          recipients: 'agents',
        },
      });

      const socket = await connect(fx.a, 'customer');
      await socket.request('login', {
        token: customerToken({
          customerId: fx.a.customerId,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
          secret: customerSecret,
        }),
        pushes: { '3.6': ['incoming_event'] },
      });

      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: null },
      });
      expect(JSON.stringify(response.payload)).not.toContain('INTERNAL-ONLY');
    });

    it('refuses an absurd cursor map rather than doing the work', async () => {
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      const cursors = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`CHAT${i}`, null]));

      const response = await socket.request('sync', { cursors });
      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('limit_reached');
    });

    it('rejects a malformed sync payload', async () => {
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      for (const payload of [{}, { cursors: 'nope' }, { cursors: [] }]) {
        const response = await socket.request('sync', payload);
        expect(response.success).toBe(false);
      }
    });
  });

  // =========================================================================
  // Authentication
  // =========================================================================

  describe('login', () => {
    it('rejects an upgrade without organization_id', async () => {
      await expect(TestSocket.connect(rtm.port, { side: 'agent' })).rejects.toThrow();
    });

    it('rejects an upgrade on an unknown path', async () => {
      await expect(
        TestSocket.connect(rtm.port, {
          organizationId: fx.a.organizationId,
          path: '/v1/admin/rtm/ws',
        }),
      ).rejects.toThrow();
    });

    it('refuses any action before login', async () => {
      const socket = await connect(fx.a);
      const response = await socket.request('sync', { cursors: {} });
      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('authentication');
    });

    it('allows ping before login, so keepalive works during the handshake', async () => {
      const socket = await connect(fx.a);
      const response = await socket.request('ping');
      expect(response.success).toBe(true);
    });

    it.each([
      ['garbage', 'not-a-token'],
      ['empty', ''],
      ['a plausible-looking fake', 'test_00000000-0000-4000-8000-000000000000'],
    ])('refuses %s', async (_label, token) => {
      const socket = await connect(fx.a);
      const response = await socket.request('login', { token });
      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('authentication');
    });

    it('refuses a revoked token', async () => {
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:rw'],
        revokedAt: new Date(),
      });
      const socket = await connect(fx.a);
      const response = await socket.request('login', { token });
      expect(response.success).toBe(false);
    });

    it('refuses a suspended agent', async () => {
      await db.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { suspended: true },
      });
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:rw'],
      });
      const socket = await connect(fx.a);
      expect((await socket.request('login', { token })).success).toBe(false);
    });

    it('refuses a token issued for a different organization', async () => {
      // Valid credential, wrong socket. Without this check every audience
      // filter downstream would be evaluated against the wrong tenant.
      const token = await grantToken(db, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.agentAccountId,
        scopes: ['chats--all:rw'],
      });
      const socket = await connect(fx.a);
      expect((await socket.request('login', { token })).success).toBe(false);
    });

    it('gives the same message for every rejection reason', async () => {
      const revoked = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: [],
        revokedAt: new Date(),
      });
      const socketA = await connect(fx.a);
      const socketB = await connect(fx.a);

      const a = await socketA.request('login', { token: revoked });
      const b = await socketB.request('login', { token: 'never-existed' });

      expect((a.payload['error'] as { message: string }).message).toBe(
        (b.payload['error'] as { message: string }).message,
      );
    });

    it('refuses a second login on the same socket', async () => {
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      const response = await socket.request('login', { token: 'anything' });
      expect(response.success).toBe(false);
    });

    it('accepts a customer token on the customer path', async () => {
      const socket = await connect(fx.a, 'customer');
      const response = await socket.request('login', {
        token: customerToken({
          customerId: fx.a.customerId,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
          secret: customerSecret,
        }),
      });
      expect(response.success).toBe(true);
      expect((response.payload['my_profile'] as { kind: string }).kind).toBe('customer');
    });

    it('refuses a tampered customer token', async () => {
      const valid = customerToken({
        customerId: fx.a.customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        secret: customerSecret,
      });
      const [prefix, , signature] = valid.split('.');
      const forged = Buffer.from(
        JSON.stringify({
          sub: fx.b.customerId,
          org: fx.a.organizationId,
          lic: fx.a.licenseId.toString(),
          exp: Math.floor(Date.now() / 1000) + 600,
        }),
      ).toString('base64url');

      const socket = await connect(fx.a, 'customer');
      const response = await socket.request('login', {
        token: `${prefix}.${forged}.${signature}`,
      });
      expect(response.success).toBe(false);
    });

    it('refuses an expired customer token', async () => {
      const socket = await connect(fx.a, 'customer');
      const response = await socket.request('login', {
        token: customerToken({
          customerId: fx.a.customerId,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
          secret: customerSecret,
          expiresInSeconds: -10,
        }),
      });
      expect(response.success).toBe(false);
    });
  });

  // =========================================================================
  // Fan-out
  // =========================================================================

  describe('fan-out', () => {
    it('delivers to an agent in the addressed team', async () => {
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      await publish(
        fx.a,
        'incoming_event',
        { groupIds: [Number(fx.a.supportGroupId)] },
        { chat_id: 'CHAT1', event: { text: 'hello' } },
      );

      const push = await socket.waitForPush('incoming_event');
      expect((push.payload['event'] as { text: string }).text).toBe('hello');
    });

    it('does not deliver to an agent outside the addressed team', async () => {
      const insider = await loginAgent(fx.a, fx.a.agentAccountId);
      const outsider = await loginAgent(fx.a, fx.a.outsiderAccountId);

      await publish(
        fx.a,
        'incoming_event',
        { groupIds: [Number(fx.a.supportGroupId)] },
        { chat_id: 'CHAT1' },
      );

      await insider.waitForPush('incoming_event');
      await settle();
      expect(outsider.pushes('incoming_event')).toHaveLength(0);
    });

    it('never crosses a tenant boundary', async () => {
      const acme = await loginAgent(fx.a, fx.a.agentAccountId);
      const northwind = await loginAgent(fx.b, fx.b.agentAccountId);

      await publish(fx.a, 'incoming_event', { allAgents: true }, { secret: 'acme-only' });

      await acme.waitForPush('incoming_event');
      await settle();
      expect(northwind.pushes()).toHaveLength(0);
      expect(JSON.stringify(northwind.frames)).not.toContain('acme-only');
    });

    it('does not deliver an agent-only push to a customer socket', async () => {
      const agent = await loginAgent(fx.a, fx.a.agentAccountId);
      const customer = await connect(fx.a, 'customer');
      await customer.request('login', {
        token: customerToken({
          customerId: fx.a.customerId,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
          secret: customerSecret,
        }),
        pushes: { '3.6': ['incoming_event'] },
      });

      // An internal note: addressed to teams, with no customer in the audience.
      await publish(
        fx.a,
        'incoming_event',
        { groupIds: [Number(fx.a.supportGroupId)] },
        { text: 'INTERNAL' },
      );

      await agent.waitForPush('incoming_event');
      await settle();
      expect(customer.pushes()).toHaveLength(0);
      expect(JSON.stringify(customer.frames)).not.toContain('INTERNAL');
    });

    it('delivers a customer-addressed push to that customer only', async () => {
      const customer = await connect(fx.a, 'customer');
      await customer.request('login', {
        token: customerToken({
          customerId: fx.a.customerId,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
          secret: customerSecret,
        }),
        pushes: { '3.6': ['incoming_event'] },
      });

      await publish(fx.a, 'incoming_event', { customerId: fx.a.customerId }, { text: 'for you' });
      const push = await customer.waitForPush('incoming_event');
      expect(push.payload['text']).toBe('for you');
    });

    it('does not deliver a push the socket did not subscribe to', async () => {
      const socket = await connect(fx.a);
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:rw'],
      });
      // Subscribed to incoming_chat only.
      await socket.request('login', { token, pushes: { '3.6': ['incoming_chat'] } });

      await publish(fx.a, 'incoming_event', { allAgents: true }, {});
      await settle();
      expect(socket.pushes('incoming_event')).toHaveLength(0);

      await publish(fx.a, 'incoming_chat', { allAgents: true }, {});
      await socket.waitForPush('incoming_chat');
    });

    it('adds and removes subscriptions at runtime', async () => {
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      const unsubscribed = await socket.request('unsubscribe', {
        actions: ['incoming_event'],
      });
      expect(unsubscribed.payload['subscribed']).not.toContain('incoming_event');

      await publish(fx.a, 'incoming_event', { allAgents: true }, {});
      await settle();
      expect(socket.pushes('incoming_event')).toHaveLength(0);

      await socket.request('subscribe', { actions: ['incoming_event'] });
      await publish(fx.a, 'incoming_event', { allAgents: true }, {});
      await socket.waitForPush('incoming_event');
    });

    it('ignores unknown push names in a subscribe request', async () => {
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      const response = await socket.request('subscribe', {
        actions: ['incoming_event', 'drop_database'],
      });
      expect(response.payload['subscribed']).not.toContain('drop_database');
    });

    it('reaches every tab an agent has open', async () => {
      const first = await loginAgent(fx.a, fx.a.agentAccountId);
      const second = await loginAgent(fx.a, fx.a.agentAccountId);

      await publish(fx.a, 'incoming_event', { agentIds: [fx.a.agentAccountId] }, { n: 1 });

      await Promise.all([
        first.waitForPush('incoming_event'),
        second.waitForPush('incoming_event'),
      ]);
    });

    it('discards a malformed bus message without disturbing the socket', async () => {
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);

      await redis.publish(licenseChannel(fx.a.licenseId), 'not json at all');
      await redis.publish(licenseChannel(fx.a.licenseId), JSON.stringify({ nope: true }));
      await settle();
      expect(socket.closed).toBe(false);

      // Still working afterwards.
      await publish(fx.a, 'incoming_event', { allAgents: true }, { ok: true });
      await socket.waitForPush('incoming_event');
    });
  });

  // =========================================================================
  // Protocol limits
  // =========================================================================

  describe('protocol limits', () => {
    it('answers a malformed frame without closing the socket', async () => {
      const socket = await connect(fx.a);
      socket.sendRaw('{ not json');
      const frame = await socket.waitFor((f) => f.type === 'response' && f.success === false);
      expect((frame.payload['error'] as { type: string }).type).toBe('validation');
      expect(socket.closed).toBe(false);
    });

    it('rejects an unknown protocol version', async () => {
      const socket = await connect(fx.a);
      socket.sendRaw(JSON.stringify({ version: '1.0', request_id: 'r', action: 'ping' }));
      const frame = await socket.waitFor((f) => f.success === false);
      expect((frame.payload['error'] as { type: string }).type).toBe('unsupported_version');
    });

    it('throttles a socket that exceeds its message budget', async () => {
      const rtmSlow = await startRtm({ RATE_LIMIT_RTM_PER_SEC: '3' });
      try {
        const token = await grantToken(db, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: ['chats--all:rw'],
        });
        const socket = await TestSocket.connect(rtmSlow.port, {
          organizationId: fx.a.organizationId,
        });
        sockets.push(socket);
        await socket.request('login', { token });

        const results: boolean[] = [];
        for (let i = 0; i < 6; i++) {
          results.push((await socket.request('ping')).success === true);
        }

        expect(results.filter((ok) => !ok).length).toBeGreaterThan(0);
        // Throttled, not disconnected — dropping the socket would cost the
        // agent their live conversation over a client-side bug.
        expect(socket.closed).toBe(false);
      } finally {
        await rtmSlow.close();
      }
    });

    it('refuses chat mutations over the socket', async () => {
      // Accepting these here would mean two implementations of the same
      // invariants, which is how they diverge.
      const socket = await loginAgent(fx.a, fx.a.agentAccountId);
      const response = await socket.request('send_event', { chat_id: 'X', text: 'hi' });
      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('not_allowed');
    });

    it('closes an unauthenticated socket after the login window', async () => {
      const rtmFast = await startRtm();
      try {
        const socket = await TestSocket.connect(rtmFast.port, {
          organizationId: fx.a.organizationId,
        });
        sockets.push(socket);
        // The real window is 30s; assert the socket is still open well inside it
        // rather than making the suite wait.
        await settle(200);
        expect(socket.closed).toBe(false);
      } finally {
        await rtmFast.close();
      }
    });
  });
});

/** Append an event the way the API would, keeping the thread counter in step. */
async function appendEvent(
  db: PrismaClient,
  conversation: { chatId: string; threadId: string },
  text: string,
): Promise<void> {
  const [row] = await db.$queryRaw<Array<{ event_sequence: number }>>`
    UPDATE threads SET event_sequence = event_sequence + 1
    WHERE id = ${conversation.threadId}
    RETURNING event_sequence
  `;
  const thread = await db.thread.findUniqueOrThrow({
    where: { id: conversation.threadId },
    select: { licenseId: true },
  });

  await db.event.create({
    data: {
      id: `${conversation.threadId}_${row!.event_sequence}`,
      threadId: conversation.threadId,
      chatId: conversation.chatId,
      licenseId: thread.licenseId,
      type: 'message',
      text,
      authorType: 'customer',
      recipients: 'all',
    },
  });
}
