/**
 * Read receipts — the player's side (IN-05 · tm 362).
 *
 * `POST /customer/chat/seen` moves the visitor's `seen_up_to` forward and tells
 * the chat's agents (`customer_seen`). What these tests hold the line on: only
 * ever forward (the old `markSeen` overwrote unconditionally), only the
 * visitor's own conversation, agents only on the bus, and one call a second.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { licenseChannel } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('read receipts (IN-05)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentToken: string;

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
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function widgetToken(tenant = fx.a) {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  /** A visitor with an open conversation. */
  async function openChat() {
    const { token, customer_id } = await widgetToken();
    const started = await server.post('/customer/chat/events', { text: 'Hi' }, auth(token));
    expect(started.statusCode).toBe(201);
    return { token, customerId: customer_id, chatId: started.json().chat_id as string };
  }

  async function storedMarker(chatId: string, userId: string): Promise<string | null> {
    const row = await owner.chatUser.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { seenUpTo: true },
    });
    return row?.seenUpTo?.toISOString() ?? null;
  }

  /** Call the endpoint with the one-a-second budget cleared first. */
  async function markSeen(token: string, seenUpTo: string) {
    await clearRateLimits(server.app);
    return server.post('/customer/chat/seen', { seen_up_to: seenUpTo }, auth(token));
  }

  async function captureBus(run: () => Promise<void>): Promise<Array<Record<string, unknown>>> {
    const sub = server.app.redis.duplicate();
    const seen: Array<Record<string, unknown>> = [];
    await sub.subscribe(licenseChannel(fx.a.licenseId));
    sub.on('message', (_channel, raw) => {
      try {
        seen.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        /* not our shape — ignore */
      }
    });
    try {
      await run();
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await sub.unsubscribe(licenseChannel(fx.a.licenseId));
      sub.disconnect();
    }
    return seen.filter((e) => e['action'] === 'customer_seen');
  }

  it("records the visitor's marker and tells the chat's agents, never the visitor (IN-05)", async () => {
    const { token, customerId, chatId } = await openChat();
    const at = new Date(Date.now() - 5_000).toISOString();

    const pushes = await captureBus(async () => {
      const response = await markSeen(token, at);
      expect(response.statusCode).toBe(204);
    });

    expect(await storedMarker(chatId, customerId)).toBe(at);
    expect(pushes).toHaveLength(1);
    const audience = pushes[0]!['audience'] as Record<string, unknown>;
    expect(audience['customerId']).toBeUndefined();
    expect(audience['groupIds']).not.toEqual([]);
    expect(pushes[0]!['payload']).toMatchObject({ chat_id: chatId, seen_up_to: at });

    // The agent's own read of the chat carries it on the visitor's row.
    const chat = await server.get(`/chats/${chatId}`, auth(agentToken));
    expect(chat.statusCode).toBe(200);
    const users = chat.json().users as Array<{ user_type: string; seen_up_to: string | null }>;
    expect(users.find((u) => u.user_type === 'customer')?.seen_up_to).toBe(at);
  });

  it('only moves forward: an older or repeated time changes nothing and raises nothing (IN-05)', async () => {
    const { token, customerId, chatId } = await openChat();
    const later = new Date(Date.now() - 2_000).toISOString();
    const earlier = new Date(Date.now() - 9_000).toISOString();
    expect((await markSeen(token, later)).statusCode).toBe(204);

    const pushes = await captureBus(async () => {
      expect((await markSeen(token, earlier)).statusCode).toBe(204);
      expect((await markSeen(token, later)).statusCode).toBe(204);
    });

    expect(await storedMarker(chatId, customerId)).toBe(later);
    expect(pushes).toHaveLength(0);

    const newest = new Date(Date.now() - 1_000).toISOString();
    expect((await markSeen(token, newest)).statusCode).toBe(204);
    expect(await storedMarker(chatId, customerId)).toBe(newest);
  });

  it("holds a time past the server's clock at the edge of the allowed skew (IN-05)", async () => {
    const { token, customerId, chatId } = await openChat();
    const before = Date.now();
    const forged = new Date(before + 3 * 86_400_000).toISOString();

    expect((await markSeen(token, forged)).statusCode).toBe(204);

    const stored = Date.parse((await storedMarker(chatId, customerId))!);
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('is a no-op for a visitor with no open conversation (IN-05)', async () => {
    const { token } = await widgetToken();
    const pushes = await captureBus(async () => {
      const response = await markSeen(token, new Date().toISOString());
      expect(response.statusCode).toBe(204);
    });
    expect(pushes).toHaveLength(0);
  });

  it("never touches another visitor's or another tenant's chat (IN-05)", async () => {
    const mine = await openChat();
    const other = await widgetToken();
    // Tenant B's visitor has no conversation; A's chat must be untouched by it.
    const foreign = await widgetToken(fx.b);

    expect((await markSeen(other.token, new Date().toISOString())).statusCode).toBe(204);
    expect((await markSeen(foreign.token, new Date().toISOString())).statusCode).toBe(204);

    expect(await storedMarker(mine.chatId, mine.customerId)).toBeNull();
  });

  it('answers 429 to a second call inside the same second (IN-05)', async () => {
    const { token } = await openChat();
    await clearRateLimits(server.app);
    const first = await server.post(
      '/customer/chat/seen',
      { seen_up_to: new Date(Date.now() - 3_000).toISOString() },
      auth(token),
    );
    const second = await server.post(
      '/customer/chat/seen',
      { seen_up_to: new Date(Date.now() - 2_000).toISOString() },
      auth(token),
    );
    expect(first.statusCode).toBe(204);
    expect(second.statusCode).toBe(429);
  });

  it('rejects a malformed body and an agent token (IN-05)', async () => {
    const { token } = await openChat();
    expect((await markSeen(token, 'not a date')).statusCode).toBe(400);
    await clearRateLimits(server.app);
    const noField = await server.post('/customer/chat/seen', {}, auth(token));
    expect(noField.statusCode).toBe(400);

    await clearRateLimits(server.app);
    const asAgent = await server.post(
      '/customer/chat/seen',
      { seen_up_to: new Date().toISOString() },
      auth(agentToken),
    );
    expect(asAgent.statusCode).toBe(404);
  });

  it("an agent's own marker is forward only as well (IN-05)", async () => {
    const { chatId } = await openChat();
    const later = new Date(Date.now() - 1_000).toISOString();
    const earlier = new Date(Date.now() - 60_000).toISOString();

    for (const at of [later, earlier]) {
      const response = await server.post(
        `/chats/${chatId}/seen`,
        { seen_up_to: at },
        auth(agentToken),
      );
      expect(response.statusCode).toBe(204);
    }

    expect(await storedMarker(chatId, fx.a.ownerAccountId)).toBe(later);
  });
});
