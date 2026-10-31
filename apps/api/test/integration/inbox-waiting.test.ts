/**
 * The waiting timer on the inbox row (IN-03 · tm 361), through the real server:
 *
 *   1. The start: the player's message sets `threads.awaiting_reply_since`
 *      (read as `waiting_since` on the list and the chat), and a second message
 *      does not move it — the wait is since the first one nobody answered.
 *   2. What leaves it alone: an internal note, the "chat transferred" line.
 *   3. What ends it: an agent's reply the player sees, a bot's reply, the close.
 *      A new player message then starts it again.
 *   4. The AI handing over starts it (the AI's reply had cleared it); a message
 *      still unanswered keeps its older start.
 *   5. A queued chat reports `queued_at`; one that is not queued reports null.
 *   6. The thresholds: defaults 120/300, saved on `/settings/chat-timeout`,
 *      ordered, `null` puts the default back, and every agent's list carries them.
 */
import { PrismaClient } from '@prisma/client';
import { generateShortId } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantContext } from '../../src/lib/tenant.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { botPrincipal } from '../../src/services/ai/handoff-service.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Summary {
  id: string;
  waiting_since: string | null;
  queued_at: string | null;
  queue_position: number | null;
}

describe('the waiting timer on the inbox row (IN-03)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let chats: ChatService;
  let supportId: bigint;
  let adminToken: string;

  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A widget visitor, through the real token mint. */
  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return auth((response.json() as { token: string }).token);
  }

  /** The visitor writes. */
  async function say(
    headers: Record<string, string>,
    text = 'Param yatmadı',
  ): Promise<{ chatId: string; threadId: string }> {
    const sent = await server.post('/customer/chat/events', { text }, headers);
    expect(sent.statusCode, sent.body).toBe(201);
    const { chat_id: chatId, event } = sent.json() as {
      chat_id: string;
      event: { thread_id: string };
    };
    return { chatId, threadId: event.thread_id };
  }

  const agentSends = (chatId: string, recipients: 'all' | 'agents', text: string) =>
    server.post(`/chats/${chatId}/events`, { type: 'message', text, recipients }, auth(adminToken));

  const column = async (threadId: string) =>
    (await owner.thread.findUniqueOrThrow({ where: { id: threadId } })).awaitingReplySince;

  async function listed(chatId: string): Promise<Summary> {
    const response = await server.get('/chats?view=all', auth(adminToken));
    expect(response.statusCode, response.body).toBe(200);
    const { items } = response.json() as { items: Summary[] };
    const row = items.find((item) => item.id === chatId);
    expect(row, `chat ${chatId} in the list`).toBeDefined();
    return row!;
  }

  async function detail(chatId: string) {
    const response = await server.get(`/chats/${chatId}`, auth(adminToken));
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { thread: { waiting_since: string | null } | null };
  }

  /** A Support connection written straight in, `aiMode` set, with no player message. */
  async function bare(aiMode: string): Promise<{ chatId: string; threadId: string }> {
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
        aiMode,
      },
    });
    return { chatId, threadId };
  }

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
    chats = new ChatService(appRole, NO_REDIS);
  });

  it('starts at the first player message and a second one does not move it (IN-03)', async () => {
    const player = await visitor();
    const { chatId, threadId } = await say(player);

    const started = await column(threadId);
    expect(started).not.toBeNull();
    expect((await listed(chatId)).waiting_since).toBe(started!.toISOString());
    expect((await detail(chatId)).thread?.waiting_since).toBe(started!.toISOString());

    await say(player, 'Hâlâ bekliyorum');
    expect((await column(threadId))?.toISOString()).toBe(started!.toISOString());
  });

  it('is left alone by an internal note and by the "chat transferred" line (IN-03)', async () => {
    const player = await visitor();
    const { chatId, threadId } = await say(player);
    const started = (await column(threadId))!;

    expect((await agentSends(chatId, 'agents', 'Finans bakıyor')).statusCode).toBe(201);
    expect((await column(threadId))?.toISOString()).toBe(started.toISOString());

    const target = await owner.account.create({
      data: { email: `${generateShortId()}@waiting.test`.toLowerCase(), name: 'Second' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: target.id,
        role: 'agent',
        routingStatus: 'accepting_chats',
        concurrentChatsLimit: 6,
      },
    });
    const transfer = await server.post(
      `/chats/${chatId}/transfer`,
      { agent_id: target.id },
      auth(adminToken),
    );
    expect(transfer.statusCode, transfer.body).toBe(200);
    const lines = await owner.event.count({
      where: { threadId, type: 'system_message', text: 'Chat transferred' },
    });
    expect(lines).toBe(1);
    expect((await column(threadId))?.toISOString()).toBe(started.toISOString());
    expect((await listed(chatId)).waiting_since).toBe(started.toISOString());
  });

  it('ends at an agent reply, and the next player message starts it again (IN-03)', async () => {
    const player = await visitor();
    const { chatId, threadId } = await say(player);
    const first = (await column(threadId))!;

    expect((await agentSends(chatId, 'all', 'Merhaba, bakıyorum')).statusCode).toBe(201);
    expect(await column(threadId)).toBeNull();
    expect((await listed(chatId)).waiting_since).toBeNull();

    await say(player, 'Teşekkürler, bekliyorum');
    const second = await column(threadId);
    expect(second).not.toBeNull();
    expect(second!.getTime()).toBeGreaterThan(first.getTime());
  });

  it('ends at a bot reply, and the AI handing over starts it again (IN-03)', async () => {
    const { chatId, threadId } = await bare('ai');

    // A player message the AI has not answered yet.
    await owner.thread.update({
      where: { id: threadId },
      data: { awaitingReplySince: new Date() },
    });

    await chats.sendEvent(ctx(), botPrincipal(ctx()), chatId, {
      type: 'message',
      text: 'Kontrol ediyorum',
      recipients: 'all',
    });
    expect(await column(threadId)).toBeNull();

    // The AI hands over: the player is waiting for a person from now.
    expect(await chats.handOverFromAi(ctx(), { chatId, threadId }, 'ai_handoff')).toBe(true);
    const handedAt = await column(threadId);
    expect(handedAt).not.toBeNull();
    expect((await listed(chatId)).waiting_since).toBe(handedAt!.toISOString());
  });

  it('keeps an older unanswered message when the AI hands over (IN-03)', async () => {
    const { chatId, threadId } = await bare('ai');
    const earlier = new Date(Date.now() - 90_000);
    await owner.thread.update({ where: { id: threadId }, data: { awaitingReplySince: earlier } });

    expect(await chats.handOverFromAi(ctx(), { chatId, threadId }, 'ai_failure')).toBe(true);
    expect((await column(threadId))?.toISOString()).toBe(earlier.toISOString());
  });

  it('ends at the close (IN-03)', async () => {
    const player = await visitor();
    const { chatId, threadId } = await say(player);
    expect(await column(threadId)).not.toBeNull();

    const closed = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(adminToken));
    expect(closed.statusCode, closed.body).toBe(200);
    expect(await column(threadId)).toBeNull();
    expect((await detail(chatId)).thread?.waiting_since).toBeNull();
  });

  it('reports the queue entry of a queued chat and null for one that is not (IN-03)', async () => {
    const calm = await visitor();
    const { chatId: assigned } = await say(calm);
    // Nobody takes the next one: it waits in the queue.
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { routingStatus: 'not_accepting_chats' },
    });
    const queuedPlayer = await visitor();
    const { chatId: queued } = await say(queuedPlayer);

    const row = await listed(queued);
    expect(row.queue_position).not.toBeNull();
    expect(row.queued_at).not.toBeNull();
    expect(Number.isNaN(Date.parse(row.queued_at!))).toBe(false);
    if ((await listed(assigned)).queue_position === null) {
      expect((await listed(assigned)).queued_at).toBeNull();
    }
  });

  it('keeps the thresholds on /settings/chat-timeout and sends them with every list (IN-03)', async () => {
    const read = async () =>
      (await server.get('/settings/chat-timeout', auth(adminToken))).json() as Record<
        string,
        unknown
      >;
    const thresholds = async () =>
      (
        (await server.get('/chats?view=all', auth(adminToken))).json() as {
          waiting_thresholds: { warn_seconds: number; alert_seconds: number };
        }
      ).waiting_thresholds;
    const put = (payload: Record<string, unknown>) =>
      server.app.inject({
        method: 'PUT',
        url: server.url('/settings/chat-timeout'),
        payload: { chat_timeout_seconds: null, ...payload },
        headers: auth(adminToken),
      });

    expect(await read()).toMatchObject({ waiting_warn_seconds: null, waiting_alert_seconds: null });
    expect(await thresholds()).toEqual({ warn_seconds: 120, alert_seconds: 300 });

    expect((await put({ waiting_warn_seconds: 60, waiting_alert_seconds: 600 })).statusCode).toBe(
      200,
    );
    expect(await read()).toMatchObject({ waiting_warn_seconds: 60, waiting_alert_seconds: 600 });
    expect(await thresholds()).toEqual({ warn_seconds: 60, alert_seconds: 600 });

    // A save that names neither keeps both; one that crosses them is refused.
    expect((await put({})).statusCode).toBe(200);
    expect(await thresholds()).toEqual({ warn_seconds: 60, alert_seconds: 600 });
    const crossed = await put({ waiting_warn_seconds: 900 });
    expect(crossed.statusCode).toBe(400);
    expect(await thresholds()).toEqual({ warn_seconds: 60, alert_seconds: 600 });
    expect((await put({ waiting_warn_seconds: 0 })).statusCode).toBe(400);

    // Null puts the default back.
    expect(
      (await put({ waiting_warn_seconds: null, waiting_alert_seconds: null })).statusCode,
    ).toBe(200);
    expect(await thresholds()).toEqual({ warn_seconds: 120, alert_seconds: 300 });
  });
});
