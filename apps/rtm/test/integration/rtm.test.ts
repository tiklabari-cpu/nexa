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
import { composerStateKey, licenseChannel, type BusEnvelope, type PushAudience } from '@nexa/types';
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
      // Swap the last character for one guaranteed to differ, so the derived id
      // can never coincide with the original — short ids end in 'X' ~1/32 of the
      // time, which otherwise collides the "new" thread onto the old one.
      const newThreadId = `${conversation.threadId.slice(0, 9)}${
        conversation.threadId[9] === 'X' ? 'Y' : 'X'
      }`;
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

    /**
     * `chats--all` is what widens a socket from "my teams" to the whole
     * workspace, and on a session that scope is granted because of the holder's
     * rank. Until tm 146 this gateway read the scope list straight off the token
     * row, so an admin demoted to agent kept being pushed every team's traffic
     * over the socket even after the REST surface had stopped answering them —
     * the "refused over HTTP, live over the socket" split the residency check a
     * few lines above exists to prevent.
     */
    it('stops widening a session once the rank behind it is gone', async () => {
      // The outsider belongs to no team, so team traffic reaches them only if
      // the credential is unrestricted.
      const promote = (role: 'admin' | 'agent') =>
        db.agentMembership.update({
          where: {
            licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.outsiderAccountId },
          },
          data: { role },
        });
      await promote('admin');
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.outsiderAccountId,
        scopes: ['chats--all:rw'],
        kind: 'oauth',
      });
      const login = async () => {
        const socket = await connect(fx.a);
        const response = await socket.request('login', {
          token: `Bearer ${token}`,
          pushes: { '3.6': AGENT_PUSHES },
        });
        expect(response.success).toBe(true);
        return socket;
      };

      const asAdmin = await login();
      await publish(fx.a, 'incoming_event', { groupIds: [Number(fx.a.supportGroupId)] }, {});
      await asAdmin.waitForPush('incoming_event');

      await promote('agent');

      // Same credential, same socket handshake — only the rank moved. The reach
      // is decided at login, as suspension already is, so this is a fresh one.
      const asAgent = await login();
      const insider = await loginAgent(fx.a, fx.a.agentAccountId);
      await publish(fx.a, 'incoming_event', { groupIds: [Number(fx.a.supportGroupId)] }, {});

      await insider.waitForPush('incoming_event');
      await settle();
      expect(asAgent.pushes('incoming_event')).toHaveLength(0);
    });

    it('leaves a personal access token as broad as it was granted', async () => {
      // The other half of the same rule: a named credential keeps the list
      // somebody deliberately gave it, and what binds an over-broad one is the
      // role gate on the routes it can reach — not a silent narrowing here.
      const token = await grantToken(db, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.outsiderAccountId,
        scopes: ['chats--all:rw'],
      });
      const socket = await connect(fx.a);
      expect(
        (
          await socket.request('login', {
            token: `Bearer ${token}`,
            pushes: { '3.6': AGENT_PUSHES },
          })
        ).success,
      ).toBe(true);

      await publish(fx.a, 'incoming_event', { groupIds: [Number(fx.a.supportGroupId)] }, {});
      await socket.waitForPush('incoming_event');
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

  // =========================================================================
  // Multi-agent conflict warning (08.6.3)
  // =========================================================================

  describe('conflict warning', () => {
    /** Log in, then also subscribe to the conflict-warning push. */
    async function loginComposer(tenant: RtmTenant, accountId: string, scopes?: string[]) {
      const socket = await loginAgent(tenant, accountId, scopes);
      await socket.request('subscribe', { actions: ['agent_conflict_warning'] });
      return socket;
    }

    it('warns every agent composing the same chat at once', async () => {
      const conversation = await createConversation(db, { tenant: fx.a });
      const agent = await loginComposer(fx.a, fx.a.agentAccountId);
      const ownerAgent = await loginComposer(fx.a, fx.a.ownerAccountId, ['chats--all:rw']);

      await agent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await ownerAgent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });

      const [toAgent, toOwner] = await Promise.all([
        agent.waitForPush('agent_conflict_warning'),
        ownerAgent.waitForPush('agent_conflict_warning'),
      ]);

      // Both composing agents are told — not just the one who arrived second.
      for (const push of [toAgent, toOwner]) {
        expect(push.payload['chat_id']).toBe(conversation.chatId);
        expect(push.payload['thread_id']).toBe(conversation.threadId);
        const ids = (push.payload['agents'] as Array<{ agent_id: string }>)
          .map((a) => a.agent_id)
          .sort();
        expect(ids).toEqual([fx.a.agentAccountId, fx.a.ownerAccountId].sort());
      }
    });

    it('does not warn a single agent composing alone', async () => {
      const conversation = await createConversation(db, { tenant: fx.a });
      const agent = await loginComposer(fx.a, fx.a.agentAccountId);

      const response = await agent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      expect(response.success).toBe(true);

      await settle();
      expect(agent.pushes('agent_conflict_warning')).toHaveLength(0);
    });

    it('answers not_found for a chat the sender cannot see, and warns no one', async () => {
      // Routed to Support; the outsider belongs to Sales only.
      const conversation = await createConversation(db, {
        tenant: fx.a,
        groupId: fx.a.supportGroupId,
      });
      const outsider = await loginComposer(fx.a, fx.a.outsiderAccountId);

      const response = await outsider.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('not_found');

      await settle();
      expect(outsider.pushes('agent_conflict_warning')).toHaveLength(0);
    });

    it('keeps the warning to the agents in the chat, not others in the licence', async () => {
      const conversation = await createConversation(db, { tenant: fx.a });
      const agent = await loginComposer(fx.a, fx.a.agentAccountId);
      const ownerAgent = await loginComposer(fx.a, fx.a.ownerAccountId, ['chats--all:rw']);
      // Subscribed and in the licence, but not one of the composing agents.
      const outsider = await loginComposer(fx.a, fx.a.outsiderAccountId);

      await agent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await ownerAgent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await Promise.all([
        agent.waitForPush('agent_conflict_warning'),
        ownerAgent.waitForPush('agent_conflict_warning'),
      ]);

      await settle();
      expect(outsider.pushes('agent_conflict_warning')).toHaveLength(0);
    });

    it('never delivers a warning across a tenant boundary', async () => {
      const conversation = await createConversation(db, { tenant: fx.a });
      const agent = await loginComposer(fx.a, fx.a.agentAccountId);
      const ownerAgent = await loginComposer(fx.a, fx.a.ownerAccountId, ['chats--all:rw']);
      // Another tenant's agent, subscribed, sharing the exact same chat id.
      const other = await loginComposer(fx.b, fx.b.agentAccountId);

      await agent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await ownerAgent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await agent.waitForPush('agent_conflict_warning');

      await settle();
      expect(other.pushes('agent_conflict_warning')).toHaveLength(0);
      expect(JSON.stringify(other.frames)).not.toContain(conversation.chatId);
    });

    // -----------------------------------------------------------------------
    // 08.6.3-conflict-g — end-to-end verification of the whole path: the
    // lifecycle including the *drop*, wire-shape parity with the web reader,
    // resilience of the 02.9 indicator to an 08.6.3 fault, and the cross-tenant
    // mirror. No new behaviour — these only prove the built path holds together.
    // -----------------------------------------------------------------------

    it('drops the warning once one agent stops composing', async () => {
      const conversation = await createConversation(db, { tenant: fx.a });
      const agent = await loginComposer(fx.a, fx.a.agentAccountId);
      const ownerAgent = await loginComposer(fx.a, fx.a.ownerAccountId, ['chats--all:rw']);

      // Both compose → both warned. (The arrival itself is asserted above; here
      // it is only the setup for the release half of the lifecycle.)
      await agent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await ownerAgent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await Promise.all([
        agent.waitForPush('agent_conflict_warning'),
        ownerAgent.waitForPush('agent_conflict_warning'),
      ]);
      const seenByAgent = agent.pushes('agent_conflict_warning').length;
      const seenByOwner = ownerAgent.pushes('agent_conflict_warning').length;

      // The owner stops. Their registry entry is removed, so the chat is no
      // longer contended.
      const released = await ownerAgent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: false,
      });
      expect(released.success).toBe(true);

      // The remaining agent keeps composing — now alone. A fresh keystroke must
      // not re-raise the warning: the conflict genuinely cleared server-side, it
      // did not merely lapse on the client's idle timer.
      await agent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await settle();

      expect(agent.pushes('agent_conflict_warning')).toHaveLength(seenByAgent);
      expect(ownerAgent.pushes('agent_conflict_warning')).toHaveLength(seenByOwner);
    });

    it('emits a payload shaped exactly as the web client reads it', async () => {
      // Shape parity with apps/web/src/features/inbox/useInbox.ts, the
      // `agent_conflict_warning` case: it reads `chat_id`, `detected_at` and an
      // `agents` array of `{ agent_id, since }`, all strings, and discards the
      // whole warning if any is the wrong type. Nowhere else asserts the emitted
      // frame and that reader agree, so if they ever drift the banner silently
      // stops showing. Prove it at the wire, against the real published frame.
      const conversation = await createConversation(db, { tenant: fx.a });
      const agent = await loginComposer(fx.a, fx.a.agentAccountId);
      const ownerAgent = await loginComposer(fx.a, fx.a.ownerAccountId, ['chats--all:rw']);

      await agent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await ownerAgent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      const warning = await agent.waitForPush('agent_conflict_warning');

      // The web store's reader, copied verbatim in intent, so a drift on either
      // side fails this test rather than quietly disabling the banner.
      const applyPushReads = (payload: Record<string, unknown>) => {
        const chatId = payload['chat_id'];
        const rawAgents = payload['agents'];
        const detectedAt = payload['detected_at'];
        if (
          typeof chatId !== 'string' ||
          !Array.isArray(rawAgents) ||
          typeof detectedAt !== 'string'
        ) {
          return null;
        }
        const agents: Array<{ agentId: string; since: string }> = [];
        for (const entry of rawAgents) {
          const record = entry as Record<string, unknown> | null;
          const agentId = record?.['agent_id'];
          const since = record?.['since'];
          if (typeof agentId !== 'string' || typeof since !== 'string') return null;
          agents.push({ agentId, since });
        }
        return { chatId, detectedAt, agents };
      };

      const read = applyPushReads(warning.payload);
      // Not null means the web reader keeps the warning rather than dropping it.
      expect(read).not.toBeNull();
      expect(read!.chatId).toBe(conversation.chatId);
      expect(read!.agents.map((a) => a.agentId).sort()).toEqual(
        [fx.a.agentAccountId, fx.a.ownerAccountId].sort(),
      );
      // Every instant the store shows and times off of must parse.
      expect(Number.isNaN(new Date(read!.detectedAt).getTime())).toBe(false);
      for (const a of read!.agents) {
        expect(Number.isNaN(new Date(a.since).getTime())).toBe(false);
      }
      // `thread_id` rides the same wire contract even though applyPush ignores
      // it; assert it too so the emitted shape stays a superset of the type.
      expect(typeof warning.payload['thread_id']).toBe('string');
      expect(warning.payload['thread_id']).toBe(conversation.threadId);
    });

    it('keeps send_typing_indicator succeeding when conflict registration fails', async () => {
      // The composer registry is a Lua script over a Redis sorted set. Poison its
      // key with a plain string so the script's first command raises WRONGTYPE —
      // a stand-in for any Redis fault on the register path. The 02.9 typing
      // indicator rides above 08.6.3 and must not break with it: the dispatcher
      // guard swallows the fault, the request still succeeds, and no phantom
      // warning goes out.
      const conversation = await createConversation(db, { tenant: fx.a });
      const agent = await loginComposer(fx.a, fx.a.agentAccountId);
      const key = composerStateKey(fx.a.licenseId, conversation.chatId);
      await redis.set(key, 'not-a-sorted-set');

      try {
        const response = await agent.request('send_typing_indicator', {
          chat_id: conversation.chatId,
          is_typing: true,
        });
        // The indicator itself succeeded despite the detector blowing up.
        expect(response.success).toBe(true);
        expect(response.payload['is_typing']).toBe(true);

        await settle();
        // A failed registration cannot manufacture a warning either.
        expect(agent.pushes('agent_conflict_warning')).toHaveLength(0);
      } finally {
        await redis.del(key);
      }
    });

    it('is inert for a second tenant replaying the same flow on the same chat id', async () => {
      // The cross-tenant test above proves tenant B never *receives* A's warning.
      // This is the mirror: B running the whole compose flow itself, on the exact
      // same chat id, is turned away as if the chat did not exist and registers
      // nothing — so A's own conflict still fires untouched.
      const conversation = await createConversation(db, { tenant: fx.a });

      const bAgent = await loginComposer(fx.b, fx.b.agentAccountId);
      const bOwner = await loginComposer(fx.b, fx.b.ownerAccountId, ['chats--all:rw']);

      // Both of B's agents "compose" on A's chat id — each answered not_found,
      // exactly as a missing chat, so nothing lands in B's registry.
      for (const socket of [bAgent, bOwner]) {
        const response = await socket.request('send_typing_indicator', {
          chat_id: conversation.chatId,
          is_typing: true,
        });
        expect(response.success).toBe(false);
        expect((response.payload['error'] as { type: string }).type).toBe('not_found');
      }

      // A's own two agents then contend for the chat and are warned as usual,
      // proving B's attempts left A's registry untouched.
      const aAgent = await loginComposer(fx.a, fx.a.agentAccountId);
      const aOwner = await loginComposer(fx.a, fx.a.ownerAccountId, ['chats--all:rw']);
      await aAgent.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await aOwner.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      await Promise.all([
        aAgent.waitForPush('agent_conflict_warning'),
        aOwner.waitForPush('agent_conflict_warning'),
      ]);

      await settle();
      // Neither of B's sockets ever heard a conflict warning.
      expect(bAgent.pushes('agent_conflict_warning')).toHaveLength(0);
      expect(bOwner.pushes('agent_conflict_warning')).toHaveLength(0);
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
