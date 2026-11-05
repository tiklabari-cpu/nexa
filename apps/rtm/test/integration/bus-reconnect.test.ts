/**
 * The gateway's own Redis subscription drops while its sockets stay open
 * (tm 408).
 *
 * Pub/sub is at-most-once: whatever is published while the gateway is not
 * subscribed reaches nobody, and ioredis's automatic resubscribe does not bring
 * it back. In the tur 2 chaos run a message accepted during a Redis restart (201,
 * in Postgres) never reached the open agent socket — the socket had not dropped,
 * so the client never ran the reconnect `sync` that would have fetched it.
 *
 * Here the subscriber connection is killed from the Redis side (`CLIENT KILL`),
 * the same thing a restart does to it, and the tests hold the gateway to what it
 * owes its sockets once it is back: `sync_required`, after it is subscribed again.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel, type BusEnvelope, type PushAudience } from '@siyahtus/types';
import {
  createConversation,
  customerToken,
  grantToken,
  ownerClient,
  seedRtmFixtures,
  type RtmFixtures,
  type RtmTenant,
} from '../helpers/fixtures.js';
import { settle, startRtm, TestSocket } from '../helpers/rtm-harness.js';

describe('rtm gateway — its Redis subscription drops and comes back (tm 408)', () => {
  let db: PrismaClient;
  let redis: Redis;
  let rtm: Awaited<ReturnType<typeof startRtm>>;
  let fx: RtmFixtures;
  const sockets: TestSocket[] = [];
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

  beforeAll(async () => {
    db = ownerClient();
    redis = new Redis(redisUrl);
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

  async function loginAgent(tenant: RtmTenant, pushes: string[]): Promise<TestSocket> {
    const token = await grantToken(db, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.agentAccountId,
      scopes: ['chats--access:rw'],
    });
    const socket = await TestSocket.connect(rtm.port, { organizationId: tenant.organizationId });
    sockets.push(socket);
    const response = await socket.request('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': pushes },
    });
    expect(response.success).toBe(true);
    return socket;
  }

  async function publish(tenant: RtmTenant, audience: PushAudience, text: string): Promise<void> {
    const envelope: BusEnvelope = {
      v: 1,
      licenseId: tenant.licenseId.toString(),
      organizationId: tenant.organizationId,
      action: 'incoming_event',
      audience,
      payload: { chat_id: 'C', event: { id: 'E', text } },
      at: Date.now(),
    };
    await redis.publish(licenseChannel(tenant.licenseId), JSON.stringify(envelope));
  }

  /**
   * Kill this gateway's fan-out subscriber, as a Redis restart would. Found by
   * the name the gateway gives it and the logical database this run was handed —
   * another window's suite, on another database, keeps its own.
   */
  async function killSubscriber(): Promise<void> {
    const database = Number(new URL(redisUrl).pathname.slice(1) || '0');
    const list = String(await redis.client('LIST'));
    const ids = list
      .split('\n')
      .filter(
        (line) => line.includes(' name=siyahtus-rtm-sub ') && line.includes(` db=${database} `),
      )
      .map((line) => /(?:^|\s)id=(\d+)/.exec(line)?.[1])
      .filter((id): id is string => id !== undefined);
    expect(ids, 'exactly one fan-out subscriber for this run').toHaveLength(1);
    await redis.client('KILL', 'ID', ids[0]!);
  }

  it('tells an open socket to sync once it is subscribed again, and the sync returns what was written meanwhile', async () => {
    const conversation = await createConversation(db, {
      tenant: fx.a,
      messages: ['before the outage'],
    });
    const socket = await loginAgent(fx.a, ['incoming_event', 'sync_required']);

    await killSubscriber();
    // Written while the gateway is not listening: the API's 201 has happened,
    // its push is gone. Only the database still has it.
    await appendEvent(db, conversation, 'during the outage');

    const hint = await socket.waitForPush('sync_required', 10_000);
    expect(hint.payload).toEqual({ reason: 'bus_reconnected' });

    // What the client does with the hint: the same cursor `sync` a reconnect runs.
    const response = await socket.request('sync', {
      cursors: { [conversation.chatId]: conversation.eventIds[0]! },
    });
    const chats = response.payload['chats'] as Array<{
      chat_id: string;
      events: Array<{ text: string }>;
    }>;
    expect(chats.find((c) => c.chat_id === conversation.chatId)?.events.map((e) => e.text)).toEqual(
      ['during the outage'],
    );

    // And it is told only after the subscription is back: a push published the
    // moment the hint lands is delivered live.
    await publish(fx.a, { allAgents: true }, 'after the outage');
    const live = await socket.waitFor(
      (frame) =>
        frame.action === 'incoming_event' &&
        (frame.payload['event'] as { text?: string } | undefined)?.text === 'after the outage',
    );
    expect(live.type).toBe('push');
    expect(socket.pushes('sync_required')).toHaveLength(1);
  });

  it('tells a visitor socket too', async () => {
    const socket = await TestSocket.connect(rtm.port, {
      organizationId: fx.a.organizationId,
      side: 'customer',
    });
    sockets.push(socket);
    const login = await socket.request('login', {
      token: customerToken({
        customerId: fx.a.customerId,
        organizationId: fx.a.organizationId,
        licenseId: fx.a.licenseId,
        secret: process.env['CUSTOMER_TOKEN_SECRET'] ?? '',
      }),
      pushes: { '3.6': ['incoming_event', 'sync_required'] },
    });
    expect(login.success).toBe(true);

    await killSubscriber();

    const hint = await socket.waitForPush('sync_required', 10_000);
    expect(hint.payload).toEqual({ reason: 'bus_reconnected' });
  });

  it('says nothing to a socket that did not ask for it, and nothing without an outage', async () => {
    const listening = await loginAgent(fx.a, ['incoming_event', 'sync_required']);
    const deaf = await loginAgent(fx.a, ['incoming_event']);

    // Logging in and receiving traffic is not an outage.
    await publish(fx.a, { allAgents: true }, 'ordinary');
    await listening.waitForPush('incoming_event');
    await settle();
    expect(listening.pushes('sync_required')).toHaveLength(0);

    await killSubscriber();
    await listening.waitForPush('sync_required', 10_000);
    // The spread window for two sockets is 10 ms; give it far longer.
    await delay(200);
    expect(deaf.pushes('sync_required')).toHaveLength(0);
  });
});

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
