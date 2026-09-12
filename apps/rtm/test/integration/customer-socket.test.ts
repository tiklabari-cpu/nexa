/**
 * The visitor's socket (FR-MOD-11.6).
 *
 * This is the first persistent, authenticated connection Nexa opens on the
 * *customer* side, and that is what makes it worth its own file. An agent
 * socket is opened by somebody who works here, against a credential minted
 * through a sign-in. A widget socket is opened by a stranger's browser on a
 * stranger's website, holding a token that has been sitting in `localStorage`,
 * and it stays open for as long as they keep the tab.
 *
 * So the questions here are not "does a push arrive" — `rtm.test.ts` answers
 * that for the agent side and the machinery is shared. They are the three ways
 * this connection could reach somebody it must not:
 *
 *   1. **Across a workspace.** A genuine, unexpired, correctly signed token for
 *      workspace B, presented on a socket opened for workspace A.
 *   2. **Across a conversation.** Two visitors in the *same* workspace. Nothing
 *      is forged; the second one simply must not be sent the first one's
 *      messages — including through `sync`, which is the path that replays
 *      history rather than forwarding it.
 *   3. **Past the recipients boundary.** An internal note is workspace-private
 *      text about the visitor, on their own chat.
 *
 * Each is a negative test, and each fails *closed*: the socket is told nothing
 * at all rather than being told it was refused.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  licenseChannel,
  MESSAGE_EDIT_WINDOW_SECONDS,
  RTM_PATHS,
  type BusEnvelope,
  type PushAudience,
} from '@nexa/types';
import {
  createConversation,
  createCustomer,
  customerToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket } from '../helpers/rtm-harness.js';

/** Exactly what the widget subscribes to — see `apps/widget/src/socket.ts`. */
const WIDGET_PUSHES = ['incoming_event', 'chat_deactivated'];

describe('customer RTM socket (FR-MOD-11.6)', () => {
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

  /** Open a socket on the widget's own path, against the given workspace. */
  async function connect(tenant: RtmTenant): Promise<TestSocket> {
    const socket = await TestSocket.connect(rtm.port, {
      organizationId: tenant.organizationId,
      side: 'customer',
    });
    sockets.push(socket);
    return socket;
  }

  /** The widget's handshake, verbatim: one visitor's token, two push kinds. */
  async function loginVisitor(
    tenant: RtmTenant,
    customerId: string,
    options: { as?: RtmTenant } = {},
  ) {
    const claims = options.as ?? tenant;
    const socket = await connect(tenant);
    const response = await socket.request('login', {
      token: customerToken({
        customerId,
        organizationId: claims.organizationId,
        licenseId: claims.licenseId,
        secret: customerSecret,
      }),
      pushes: { '3.6': WIDGET_PUSHES },
    });
    return { socket, response };
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

  describe('handshake', () => {
    it('accepts the widget on its own path and answers as a customer', async () => {
      const { socket, response } = await loginVisitor(fx.a, fx.a.customerId);

      expect(response.success).toBe(true);
      expect(response.payload['my_profile']).toMatchObject({
        id: fx.a.customerId,
        kind: 'customer',
      });
      // Push *kinds*, and nothing else. There is no chat id, team or scope in a
      // widget subscription, so there is none for the gateway to have honoured
      // wrongly — reach is decided entirely by the id inside the signed token.
      expect(response.payload['subscribed']).toEqual(WIDGET_PUSHES);
      expect(response.payload['my_profile']).toMatchObject({ scopes: [] });
      expect(socket.closeCode).toBeNull();
    });

    it('is reachable at the path the client library dials', async () => {
      // The widget is handed `rtm_url` by the token mint, which the API builds
      // from this same constant. A path written out by hand at either end would
      // be a second definition free to drift from this one.
      const socket = await TestSocket.connect(rtm.port, {
        organizationId: fx.a.organizationId,
        path: RTM_PATHS.customer,
      });
      sockets.push(socket);

      const response = await socket.request('login', {
        token: customerToken({
          customerId: fx.a.customerId,
          organizationId: fx.a.organizationId,
          licenseId: fx.a.licenseId,
          secret: customerSecret,
        }),
        pushes: { '3.6': WIDGET_PUSHES },
      });
      expect(response.success).toBe(true);
    });

    it("refuses another workspace's token, however genuine it is", async () => {
      // Not tampered, not expired, correctly signed by the real secret — a
      // token workspace B's own widget would be served. The only thing wrong
      // with it is the door: this socket was opened for workspace A.
      const { response } = await loginVisitor(fx.a, fx.b.customerId, { as: fx.b });

      expect(response.success).toBe(false);
      const error = response.payload['error'] as { type: string; message: string };
      expect(error.type).toBe('authentication');
      // Undifferentiated on purpose: telling a caller their token is real but
      // aimed at the wrong workspace confirms both facts to somebody holding a
      // stolen one.
      expect(error.message).toBe('Invalid or expired credentials.');
    });

    it('refuses an unauthenticated socket every action but login and ping', async () => {
      const socket = await connect(fx.a);
      for (const action of ['sync', 'subscribe', 'send_typing_indicator']) {
        const response = await socket.request(action, {});
        expect(response.success).toBe(false);
        expect((response.payload['error'] as { type: string }).type).toBe('authentication');
      }
      // `ping` is the exception, and it has to be: the widget's keep-alive runs
      // on the same socket as its handshake.
      expect((await socket.request('ping', {})).success).toBe(true);
    });
  });

  describe('reach', () => {
    it('delivers a reply on the visitor’s own conversation', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      // Shaped as `chat-service.ts` addresses a visible reply: the teams, the
      // agents, and the customer.
      await publish(
        fx.a,
        'incoming_event',
        {
          groupIds: [Number(fx.a.supportGroupId)],
          agentIds: [fx.a.agentAccountId],
          customerId: fx.a.customerId,
        },
        {
          chat_id: conversation.chatId,
          thread_id: conversation.threadId,
          event: { id: `${conversation.threadId}_2`, text: 'on its way', recipients: 'all' },
        },
      );

      const push = await socket.waitForPush('incoming_event');
      expect((push.payload['event'] as { text: string }).text).toBe('on its way');
    });

    it("never delivers another visitor's conversation in the same workspace", async () => {
      // Two visitors of one workspace. Nothing here is forged and nothing is
      // misconfigured — this is the ordinary case, and it is the one that has
      // to hold every second of every day.
      const otherCustomerId = await createCustomer(db, fx.a);
      const theirs = await createConversation(db, {
        tenant: fx.a,
        customerId: otherCustomerId,
        messages: ['their private question'],
      });

      const { socket: mine } = await loginVisitor(fx.a, fx.a.customerId);
      const { socket: theirSocket } = await loginVisitor(fx.a, otherCustomerId);

      await publish(
        fx.a,
        'incoming_event',
        { groupIds: [Number(fx.a.supportGroupId)], customerId: otherCustomerId },
        {
          chat_id: theirs.chatId,
          event: { id: `${theirs.threadId}_2`, text: 'THEIR-ANSWER', recipients: 'all' },
        },
      );

      // The intended recipient does get it — otherwise this test would pass on
      // a gateway that delivers nothing at all.
      await theirSocket.waitForPush('incoming_event');
      await settle();
      expect(mine.pushes()).toHaveLength(0);
      expect(JSON.stringify(mine.frames)).not.toContain('THEIR-ANSWER');
    });

    it('never delivers an internal note about the visitor’s own chat', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      // `chat-service.ts` narrows the audience to teams and agents when
      // `recipients === 'agents'`, so the customer id is simply absent. This
      // asserts the gateway's own half of that: a customer socket matches on
      // `audience.customerId` and on nothing else, so a team audience cannot
      // reach it even though the note is about this very conversation.
      await publish(
        fx.a,
        'incoming_event',
        { groupIds: [Number(fx.a.supportGroupId)], agentIds: [fx.a.agentAccountId] },
        {
          chat_id: conversation.chatId,
          event: {
            id: `${conversation.threadId}_2`,
            text: 'NOTE-REFUND-RISK',
            recipients: 'agents',
          },
        },
      );

      await settle();
      expect(socket.pushes()).toHaveLength(0);
      expect(JSON.stringify(socket.frames)).not.toContain('NOTE-REFUND-RISK');
    });

    it('never delivers a workspace-wide push', async () => {
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      // `allAgents` is how presence and routing reach every agent in the
      // workspace. A visitor is not an agent, and the fan-out's customer branch
      // ignores the flag entirely rather than treating "everyone" as including
      // them.
      await publish(fx.a, 'incoming_event', { allAgents: true }, { text: 'STAFF-BROADCAST' });
      await settle();

      expect(socket.pushes()).toHaveLength(0);
      expect(JSON.stringify(socket.frames)).not.toContain('STAFF-BROADCAST');
    });

    it('never delivers another workspace’s traffic to a live visitor', async () => {
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);
      const { socket: theirs } = await loginVisitor(fx.b, fx.b.customerId);

      await publish(
        fx.b,
        'incoming_event',
        { customerId: fx.b.customerId },
        { chat_id: 'CHAT-B', event: { id: 'THREADB_1', text: 'B-ONLY', recipients: 'all' } },
      );

      await theirs.waitForPush('incoming_event');
      await settle();
      expect(socket.pushes()).toHaveLength(0);
      expect(JSON.stringify(socket.frames)).not.toContain('B-ONLY');
    });
  });

  describe('missed-event sync', () => {
    it('replays what arrived while the widget was disconnected', async () => {
      // The property the whole socket is for: a visitor whose laptop slept
      // through a reply must not have to be told to refresh the page.
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      await db.event.create({
        data: {
          id: `${conversation.threadId}_2`,
          threadId: conversation.threadId,
          chatId: conversation.chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'while you were away',
          authorType: 'agent',
          recipients: 'all',
        },
      });

      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });

      expect(response.success).toBe(true);
      const chats = response.payload['chats'] as Array<{
        chat_id: string;
        events: Array<{ id: string; text: string }>;
      }>;
      expect(chats).toHaveLength(1);
      expect(chats[0]!.chat_id).toBe(conversation.chatId);
      // After the cursor, not from the top: replaying the message already on
      // screen is how a reconnect turns into a duplicated transcript.
      expect(chats[0]!.events.map((e) => e.text)).toEqual(['while you were away']);
    });

    /**
     * The half a cursor structurally cannot carry (FR-MOD-02.3.7 · NFR-R2).
     *
     * A correction rewrites `events.text` in place and mints no
     * `event_sequence`, so "everything after the cursor" — the replay above —
     * is blind to it by construction. Measured before it was closed (tm 248):
     * with the visitor's socket held shut across the edit, this same request
     * answered `events: []` and the visitor went on reading the sentence the
     * agent had retracted for a further 30.6 s, until the widget's 30-second
     * heartbeat poll refetched the transcript.
     */
    it('replays a correction to a message already on screen (NFR-R2)', async () => {
      const conversation = await createConversation(db, {
        tenant: fx.a,
        messages: ['when does my order arrive?', 'it ships on Tuesday'],
      });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      // The agent corrects the second message while nobody is listening. Written
      // the way the API writes it — in place, no new id, no new sequence.
      await db.$executeRaw`
        UPDATE events
        SET text = 'it ships on Thursday',
            properties = '{"edited_at":"2026-09-12T10:00:00.000Z"}'::jsonb
        WHERE id = ${conversation.eventIds[1]}
      `;

      // The cursor is already past it — this is the case the replay misses.
      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[1] },
      });

      expect(response.success).toBe(true);
      const chats = response.payload['chats'] as Array<{
        chat_id: string;
        events: Array<{ text: string }>;
        corrections: Array<{ id: string; text: string }>;
      }>;
      expect(chats).toHaveLength(1);
      // Nothing new happened, so nothing is appended — the correction rides its
      // own list precisely so the client replaces rather than appends.
      expect(chats[0]!.events).toEqual([]);
      expect(chats[0]!.corrections.map((e) => [e.id, e.text])).toEqual([
        [conversation.eventIds[1], 'it ships on Thursday'],
      ]);
    });

    it('replays no correction when nothing was corrected', async () => {
      // The lookback must cost nothing on the overwhelmingly common reconnect:
      // an untouched thread answers with an empty list, not with its tail.
      const conversation = await createConversation(db, {
        tenant: fx.a,
        messages: ['hello', 'hi there'],
      });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[1] },
      });

      const chats = response.payload['chats'] as Array<{ corrections: unknown[] }>;
      expect(chats[0]!.corrections).toEqual([]);
    });

    it('withholds a corrected internal note from the replay (NFR-S9)', async () => {
      // The note filter has to hold on the new list too, or the correction
      // replay becomes the one path that leaks an agents-only event.
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      await db.event.create({
        data: {
          id: `${conversation.threadId}_2`,
          threadId: conversation.threadId,
          chatId: conversation.chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'NOTE-EDITED-REFUND-RISK',
          authorType: 'agent',
          recipients: 'agents',
          properties: { edited_at: new Date().toISOString() },
        },
      });

      const { socket } = await loginVisitor(fx.a, fx.a.customerId);
      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: `${conversation.threadId}_2` },
      });

      expect(JSON.stringify(response.payload)).not.toContain('NOTE-EDITED-REFUND-RISK');
    });

    it('does not replay an edit to a message past the edit window', async () => {
      // The lookback is bounded by the product's own rule rather than a round
      // number: past `MESSAGE_EDIT_WINDOW_SECONDS` the API refuses the edit, so
      // a message that old cannot have changed under a connected client and
      // re-sending it every reconnect would be work with no answer behind it.
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      const longAgo = new Date(Date.now() - (MESSAGE_EDIT_WINDOW_SECONDS + 3600) * 1000);
      await db.$executeRaw`
        UPDATE events
        SET created_at = ${longAgo},
            text = 'corrected long ago',
            properties = '{"edited_at":"2020-01-01T00:00:00.000Z"}'::jsonb
        WHERE id = ${conversation.eventIds[0]}
      `;

      const { socket } = await loginVisitor(fx.a, fx.a.customerId);
      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });

      const chats = response.payload['chats'] as Array<{ corrections: unknown[] }>;
      expect(chats[0]!.corrections).toEqual([]);
    });

    it("refuses to replay another visitor's conversation, named by id", async () => {
      // The `sync` half of the cross-conversation boundary, and the one that
      // needs saying separately: a cursor map is a list of chat ids supplied by
      // the client, so this is the one place a visitor can *ask* for a
      // conversation by name.
      const otherCustomerId = await createCustomer(db, fx.a);
      const theirs = await createConversation(db, {
        tenant: fx.a,
        customerId: otherCustomerId,
        messages: ['their private question'],
      });
      const mine = await createConversation(db, { tenant: fx.a, messages: ['my question'] });

      const { socket } = await loginVisitor(fx.a, fx.a.customerId);
      const response = await socket.request('sync', {
        cursors: { [mine.chatId]: null, [theirs.chatId]: null },
      });

      const chats = response.payload['chats'] as Array<{ chat_id: string }>;
      expect(chats.map((c) => c.chat_id)).toEqual([mine.chatId]);
      // Answered as gone rather than refused: a 403 would confirm the id names
      // a real conversation, which is most of what an attacker wants to learn.
      expect(response.payload['removed_chat_ids']).toEqual([theirs.chatId]);
      expect(JSON.stringify(response.payload)).not.toContain('their private question');
    });

    it('withholds internal notes from the replay as well as from the push', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      await db.event.create({
        data: {
          id: `${conversation.threadId}_2`,
          threadId: conversation.threadId,
          chatId: conversation.chatId,
          licenseId: fx.a.licenseId,
          type: 'message',
          text: 'NOTE-REFUND-RISK',
          authorType: 'agent',
          recipients: 'agents',
        },
      });

      const { socket } = await loginVisitor(fx.a, fx.a.customerId);
      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });

      expect(JSON.stringify(response.payload)).not.toContain('NOTE-REFUND-RISK');
    });

    it('reports a conversation that ended while the widget was away', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      await db.chat.update({ where: { id: conversation.chatId }, data: { active: false } });

      const response = await socket.request('sync', {
        cursors: { [conversation.chatId]: conversation.eventIds[0] },
      });

      // The same answer an inaccessible chat gets, which is the point: the
      // widget's "this conversation ended" screen and its "not yours" handling
      // are one code path, so neither can be forgotten.
      expect(response.payload['removed_chat_ids']).toEqual([conversation.chatId]);
    });
  });

  describe('what a visitor may not do', () => {
    it('refuses a typing indicator sent over the socket', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      // A visitor's sneak-peek goes through the Customer API, where the
      // audience (agents only, never their own side) is decided. Accepting it
      // here would be a second place that decision could be made differently.
      const response = await socket.request('send_typing_indicator', {
        chat_id: conversation.chatId,
        is_typing: true,
      });
      expect(response.success).toBe(false);
      expect((response.payload['error'] as { type: string }).type).toBe('not_allowed');
    });

    it('refuses every chat mutation — those go over REST', async () => {
      const conversation = await createConversation(db, { tenant: fx.a, messages: ['hello'] });
      const { socket } = await loginVisitor(fx.a, fx.a.customerId);

      for (const action of ['send_event', 'deactivate_chat', 'transfer_chat', 'start_chat']) {
        const response = await socket.request(action, { chat_id: conversation.chatId });
        expect(response.success).toBe(false);
        expect((response.payload['error'] as { type: string }).type).toBe('not_allowed');
      }
    });
  });
});
