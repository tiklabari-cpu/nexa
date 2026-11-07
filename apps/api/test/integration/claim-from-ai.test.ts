/**
 * "Take" from the AI (tm 475.3 · owner decision D5): a conversation nobody
 * has, outside every queue, that the AI answers or is held back on is taken
 * with `POST /chats/{id}/claim` — the explicit act that replaced "writing to
 * the player takes it" once only the assignee answers the player (tm 475).
 * What is pinned here:
 *
 *   1. The take: the caller is the assignee and the connection `human`, with
 *      reason `agent_message` (no new reason) on the connection and on the
 *      AI's own conversation row, and one agents-only line in its own words;
 *      it leaves the AI view for the caller's; `chat_ai_mode_changed`,
 *      `incoming_chat` and `chat_transferred` (reason `manual`) are told; the
 *      caller's reply is then 201 and leaves no second line. A paused
 *      connection — pausing neither routes nor queues it — is taken the same
 *      way.
 *   2. Who may: anyone who may write to the chat, as writing used to take it
 *      — the owner outside every team, an agent at their concurrent limit —
 *      but not someone who cannot see it (404) or a bot (403). What is not the
 *      AI's is refused: a colleague's is `claimed`; a closed or never-routed
 *      one `not_waiting`. One queued beside the AI is a queued one — the
 *      team's rules — and the AI answers on beside its new assignee.
 *   3. The race, one winner: two takes held at the chat row (as the player's
 *      message holds it) both wait, then race for it, and the second reads
 *      the first one's commit — `claimed`; a free-running pair over separate
 *      connections (race-tests-need-separate-connections) never ends
 *      otherwise; a take arriving while the player's message is being written
 *      waits for it rather than deadlocking with it (the chat row before the
 *      thread, the order of every append).
 */
import { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { capabilitiesForRole, generateShortId, licenseChannel } from '@siyahtus/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/api-error.js';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import type { AgentPrincipal } from '../../src/services/auth/principal.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** The line a take leaves (`AI_TAKEN_NOTE_TEXT`). */
const TAKEN = 'AI stopped: an agent took the chat';

const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Envelope {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[]; customerId?: string };
  payload: Record<string, unknown>;
}

type AiMode = 'ai' | 'human' | 'paused';

describe('taking a conversation from the AI (tm 475.3)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let supportId: bigint;
  /** `fx.a`'s agent, a Support member. */
  let agentToken: string;
  /** A second Support member. */
  let colleagueId: string;
  let colleagueToken: string;
  /** A member of Logistics only: Support's chats are not theirs to see. */
  let outsiderToken: string;
  /** The workspace owner: every chat, and in no team. */
  let adminToken: string;
  let botToken: string;
  let listener: Redis;
  let pushes: Envelope[];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  /** A Support member as the service sees them, for a take on a connection of its own. */
  const memberPrincipal = (accountId: string): AgentPrincipal => ({
    kind: 'agent',
    accountId,
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
    role: 'agent',
    capabilities: capabilitiesForRole('agent', []),
    scopes: ['chats--access:rw', 'chats--access:ro'],
    tokenId: `test-${accountId}`,
    tokenKind: 'pat',
  });

  /**
   * A conversation in Support, its open connection as given — seeded, not
   * routed. In `ai` or `paused` mode it has the AI's conversation row too;
   * `queued` puts it first in Support's queue.
   */
  async function conversation(
    connection: { assigneeId?: string | null; aiMode?: AiMode | null; queued?: boolean } = {},
  ): Promise<{ chatId: string; threadId: string }> {
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
    await owner.chatUser.create({
      data: { chatId, userId: customer.id, userType: 'customer', present: true },
    });
    if (connection.assigneeId) {
      await owner.chatUser.create({
        data: { chatId, userId: connection.assigneeId, userType: 'agent', present: true },
      });
    }
    const queuedAt = connection.queued ? new Date() : null;
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        groupId: supportId,
        assigneeId: connection.assigneeId ?? null,
        aiMode: connection.aiMode ?? null,
        ...(queuedAt ? { queuePosition: 1, queuedAt, queueGroupId: supportId } : {}),
      },
    });
    if (queuedAt) {
      await owner.queueEntry.create({
        data: { licenseId: fx.a.licenseId, threadId, groupId: supportId, enteredAt: queuedAt },
      });
    }
    if (connection.aiMode === 'ai' || connection.aiMode === 'paused') {
      await owner.aiConversation.create({
        data: { licenseId: fx.a.licenseId, chatId, threadId, mode: connection.aiMode },
      });
    }
    return { chatId, threadId };
  }

  const claim = (chatId: string, token: string) =>
    server.post(`/chats/${chatId}/claim`, undefined, auth(token));

  const reply = (chatId: string, token: string) =>
    server.post(
      `/chats/${chatId}/events`,
      { type: 'message', text: 'Hi, I have your conversation now.' },
      auth(token),
    );

  const threadOf = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: {
        assigneeId: true,
        assignedAt: true,
        aiMode: true,
        groupId: true,
        queuePosition: true,
        queueGroupId: true,
      },
    });

  /** The agents-only AI mode lines on the connection, oldest first. */
  const modeLines = (threadId: string) =>
    owner.event.findMany({
      where: { threadId, properties: { path: ['system_event'], equals: 'ai_mode_changed' } },
      orderBy: { createdAt: 'asc' },
      select: { text: true, recipients: true, authorId: true, properties: true },
    });

  const viewIds = async (view: string, token: string): Promise<string[]> => {
    const response = await server.get(`/chats?view=${view}`, auth(token));
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);
  };

  async function pushed(action: string, chatId: string): Promise<Envelope[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return pushes.filter(
      (p) =>
        p.action === action &&
        (p.payload['chat_id'] === chatId ||
          (p.payload['chat'] as { id?: string } | undefined)?.id === chatId),
    );
  }

  /** Wait until `n` statements matching `pattern` wait for a lock in this run's database. */
  async function waitingOnLock(pattern: string, n = 1): Promise<void> {
    for (let i = 0; i < 250; i += 1) {
      const [row] = await owner.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database() AND query LIKE ${pattern}`;
      if ((row?.n ?? 0) >= n) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const seen = await owner.$queryRaw<Array<{ q: string; w: string | null }>>`
      SELECT left(query, 200) AS q, wait_event AS w FROM pg_stat_activity
       WHERE datname = current_database() AND state <> 'idle'`;
    throw new Error(
      `fewer than ${n} matching ${pattern} waited for a lock: ${JSON.stringify(seen)}`,
    );
  }

  /** Two clients of their own, connected before the race starts. */
  async function connected(): Promise<[PrismaClient, PrismaClient]> {
    const clients: [PrismaClient, PrismaClient] = [
      new PrismaClient({ datasourceUrl: APP_URL }),
      new PrismaClient({ datasourceUrl: APP_URL }),
    ];
    await Promise.all(clients.map((client) => client.$queryRaw`SELECT 1`));
    return clients;
  }

  /** Whatever a take came to, as the route would answer it. */
  const outcomeOf = (settled: PromiseSettledResult<unknown>): string => {
    if (settled.status === 'fulfilled') return 'taken';
    const error = settled.reason as unknown;
    if (error instanceof ApiError && error.type === 'chat_claim_refused') {
      return `refused:${String(error.details?.['reason'])}`;
    }
    return `error:${String(error)}`;
  };

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
    const licenseId = fx.a.licenseId;

    supportId = (
      await owner.group.create({ data: { licenseId, name: 'Destek' }, select: { id: true } })
    ).id;
    const logisticsId = (
      await owner.group.create({ data: { licenseId, name: 'Lojistik' }, select: { id: true } })
    ).id;
    const account = async (name: string) => {
      const created = await owner.account.create({
        data: { email: `${generateShortId()}@take.test`.toLowerCase(), name },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId, agentId: created.id, role: 'agent', routingStatus: 'accepting_chats' },
      });
      return created.id;
    };
    colleagueId = await account('Colleague');
    const outsiderId = await account('Outsider');
    await owner.groupAgent.createMany({
      data: [
        { licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
        { licenseId, groupId: supportId, agentId: colleagueId },
        { licenseId, groupId: logisticsId, agentId: outsiderId },
      ],
    });
    await owner.routingRule.create({
      data: { licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
    });

    const token = (ownerId: string, scopes: string[], kind?: 'bot') =>
      grantToken(owner, {
        licenseId,
        organizationId: fx.a.organizationId,
        ownerId,
        scopes,
        ...(kind ? { kind } : {}),
      });
    agentToken = await token(fx.a.agentAccountId, ['chats--access:rw']);
    colleagueToken = await token(colleagueId, ['chats--access:rw']);
    outsiderToken = await token(outsiderId, ['chats--access:rw']);
    adminToken = await token(fx.a.ownerAccountId, ['chats--all:rw']);
    const bot = await owner.bot.create({
      data: { licenseId, name: `Rules ${generateShortId()}` },
      select: { id: true },
    });
    botToken = await token(bot.id, ['chats--all:rw'], 'bot');

    pushes = [];
    listener = server.app.redis.duplicate();
    listener.on('message', (_channel: string, message: string) => {
      pushes.push(JSON.parse(message) as Envelope);
    });
    await listener.subscribe(licenseChannel(licenseId));
  });

  afterEach(async () => {
    await listener.quit();
  });

  // --- 1. The take ---------------------------------------------------------------

  describe('the take', () => {
    it('makes a connection the AI answers the caller’s, and the AI falls silent', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });
      expect(await viewIds('ai', agentToken)).toContain(chatId);
      const lastAssigned = async () =>
        (
          await owner.agentMembership.findUniqueOrThrow({
            where: {
              licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
            },
            select: { lastAssignedAt: true },
          })
        ).lastAssignedAt;
      const before = await lastAssigned();

      const taken = await claim(chatId, agentToken);
      expect(taken.statusCode, taken.body).toBe(200);
      expect(taken.json()).toMatchObject({
        id: chatId,
        thread: { id: threadId, assignee_id: fx.a.agentAccountId, ai_mode: 'human' },
      });
      const after = await threadOf(threadId);
      expect(after).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        aiMode: 'human',
        groupId: supportId,
        queuePosition: null,
      });
      expect(after.assignedAt).not.toBeNull();
      expect(await lastAssigned()).not.toEqual(before);
      // The AI's own state says so too — what fences a turn still being drafted.
      expect(
        await owner.aiConversation.findFirstOrThrow({
          where: { threadId },
          select: { mode: true, modeReason: true, modeChangedBy: true },
        }),
      ).toEqual({ mode: 'human', modeReason: 'agent_message', modeChangedBy: fx.a.agentAccountId });
      // One agents-only line, in words that do not say anyone replied.
      expect(await modeLines(threadId)).toEqual([
        {
          text: TAKEN,
          recipients: 'agents',
          authorId: fx.a.agentAccountId,
          properties: expect.objectContaining({
            ai_mode: 'human',
            previous_ai_mode: 'ai',
            reason: 'agent_message',
          }),
        },
      ]);
      expect(
        await owner.chatUser.findUniqueOrThrow({
          where: { chatId_userId: { chatId, userId: fx.a.agentAccountId } },
          select: { present: true },
        }),
      ).toEqual({ present: true });
      // Out of the AI view, into the caller's.
      expect(await viewIds('ai', agentToken)).not.toContain(chatId);
      expect(await viewIds('my', agentToken)).toEqual([chatId]);

      const [changed] = await pushed('chat_ai_mode_changed', chatId);
      expect(changed?.payload).toMatchObject({
        thread_id: threadId,
        ai_mode: 'human',
        previous_ai_mode: 'ai',
        by: fx.a.agentAccountId,
        reason: 'agent_message',
      });
      expect(changed?.audience.customerId).toBeUndefined();
      const incoming = await pushed('incoming_chat', chatId);
      expect(incoming.some((p) => p.audience.agentIds?.includes(fx.a.agentAccountId))).toBe(true);
      const moved = await pushed('chat_transferred', chatId);
      expect(moved).toHaveLength(1);
      expect(moved[0]!.payload).toMatchObject({
        thread_id: threadId,
        requester_id: fx.a.agentAccountId,
        reason: 'manual',
        outcome: 'assigned',
        assignee_id: fx.a.agentAccountId,
        transferred_to: { group_ids: [Number(supportId)], agent_ids: [fx.a.agentAccountId] },
      });
      // The visitor's widget hears of it (and re-reads who answers them).
      expect(moved[0]!.audience.customerId).toBeDefined();

      // Theirs to answer now; the take was the change, so no second line.
      const sent = await reply(chatId, agentToken);
      expect(sent.statusCode, sent.body).toBe(201);
      expect((await modeLines(threadId)).map((line) => line.text)).toEqual([TAKEN]);
    });

    it('takes a paused connection nobody has — pausing neither routes nor queues it', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });
      const paused = await server.post(`/chats/${chatId}/pause-ai`, {}, auth(adminToken));
      expect(paused.statusCode, paused.body).toBe(200);
      expect(await threadOf(threadId)).toMatchObject({
        aiMode: 'paused',
        assigneeId: null,
        queuePosition: null,
      });
      // Nobody but its assignee may answer it, and it has none.
      expect((await reply(chatId, agentToken)).statusCode).toBe(409);

      const taken = await claim(chatId, agentToken);
      expect(taken.statusCode, taken.body).toBe(200);
      expect(await threadOf(threadId)).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        aiMode: 'human',
      });
      const lines = await modeLines(threadId);
      expect(lines.map((line) => line.text)).toEqual(['AI paused', TAKEN]);
      expect(lines[1]!.properties).toMatchObject({
        previous_ai_mode: 'paused',
        reason: 'agent_message',
      });
      expect((await reply(chatId, agentToken)).statusCode).toBe(201);
    });

    it('answers the one who already has it with the chat itself, and announces nothing twice', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });
      expect((await claim(chatId, agentToken)).statusCode).toBe(200);
      const told = async () => (await pushed('chat_transferred', chatId)).length;
      const before = await told();

      const again = await claim(chatId, agentToken);
      expect(again.statusCode, again.body).toBe(200);
      expect(again.json()).toMatchObject({ id: chatId });
      expect(await told()).toBe(before);
      expect(await modeLines(threadId)).toHaveLength(1);
    });
  });

  // --- 2. Who may, and what ------------------------------------------------------

  describe('who may take it, and what', () => {
    it('lets whoever may write to the chat take it, as writing used to — no team, no limit', async () => {
      // The owner is in no team: write access to every chat is enough.
      const owners = await conversation({ aiMode: 'ai' });
      const byOwner = await claim(owners.chatId, adminToken);
      expect(byOwner.statusCode, byOwner.body).toBe(200);
      expect((await threadOf(owners.threadId)).assigneeId).toBe(fx.a.ownerAccountId);

      // At their concurrent limit and not taking chats, the agent may still take one.
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { concurrentChatsLimit: 1, routingStatus: 'not_accepting_chats' },
      });
      await conversation({ assigneeId: fx.a.agentAccountId });
      const full = await conversation({ aiMode: 'ai' });
      const byFull = await claim(full.chatId, agentToken);
      expect(byFull.statusCode, byFull.body).toBe(200);
      expect((await threadOf(full.threadId)).assigneeId).toBe(fx.a.agentAccountId);
    });

    it('answers someone who cannot see it, and a bot, as for an unseen chat', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });
      expect((await claim(chatId, outsiderToken)).statusCode).toBe(404);
      // Taking is a person's act: the route is not a bot's at all.
      expect((await claim(chatId, botToken)).statusCode).toBe(404);
      expect(await threadOf(threadId)).toMatchObject({ assigneeId: null, aiMode: 'ai' });
      expect(await modeLines(threadId)).toEqual([]);
    });

    it('refuses what is not the AI’s: a colleague’s as claimed, a closed or never-routed one as not waiting', async () => {
      const refusal = async (chatId: string) => {
        const response = await claim(chatId, agentToken);
        expect(response.statusCode, response.body).toBe(409);
        return (response.json() as { error: { type: string; details: { reason: string } } }).error;
      };

      // A colleague's, beside an AI that answers too: theirs until a takeover moves it.
      const colleagues = await conversation({ assigneeId: colleagueId, aiMode: 'ai' });
      expect(await refusal(colleagues.chatId)).toMatchObject({
        type: 'chat_claim_refused',
        details: { reason: 'claimed' },
      });
      expect(await threadOf(colleagues.threadId)).toMatchObject({
        assigneeId: colleagueId,
        aiMode: 'ai',
      });

      // Nobody's and never the AI's, or a person's already with nobody seated: not waiting.
      for (const aiMode of [null, 'human'] as const) {
        const nobodys = await conversation({ aiMode });
        expect(await refusal(nobodys.chatId)).toMatchObject({ details: { reason: 'not_waiting' } });
        expect((await threadOf(nobodys.threadId)).assigneeId).toBeNull();
      }

      // Closed.
      const closed = await conversation({ aiMode: 'ai' });
      const archived = await server.post(
        `/chats/${closed.chatId}/deactivate`,
        undefined,
        auth(adminToken),
      );
      expect(archived.statusCode, archived.body).toBe(200);
      expect(await refusal(closed.chatId)).toMatchObject({ details: { reason: 'not_waiting' } });
      expect(await modeLines(closed.threadId)).toEqual([]);
    });

    it('takes one queued beside the AI as a queued one — the team’s rules — and the AI answers on', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai', queued: true });

      // Not a member of Support: the queue is not theirs, whatever they can see.
      expect((await claim(chatId, adminToken)).statusCode).toBe(404);
      expect((await threadOf(threadId)).queuePosition).toBe(1);

      const taken = await claim(chatId, colleagueToken);
      expect(taken.statusCode, taken.body).toBe(200);
      expect(await threadOf(threadId)).toMatchObject({
        assigneeId: colleagueId,
        queuePosition: null,
        queueGroupId: null,
        // `parallel`: beside its assignee, as the drain would have left it.
        aiMode: 'ai',
      });
      expect(
        await owner.queueEntry.findFirstOrThrow({ where: { threadId }, select: { outcome: true } }),
      ).toEqual({ outcome: 'assigned' });
      expect(await modeLines(threadId)).toEqual([]);
      // Their first reply silences it, as any assignee's.
      expect((await reply(chatId, colleagueToken)).statusCode).toBe(201);
      expect((await threadOf(threadId)).aiMode).toBe('human');
    });
  });

  // --- 3. The race -------------------------------------------------------------

  describe('two takes at once', () => {
    it('gives it to one: both wait at the chat row, the second reads the first one’s commit', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });
      const [first, second] = await connected();
      const services = [first, second].map((client) => new ChatService(client, NO_REDIS));

      // The player's message holds the chat row; both takes arrive meanwhile.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const holding = new Promise<void>((resolve) => (locked = resolve));
      const held = withTenant(
        appRole,
        ctx(),
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM chats WHERE id = ${chatId} FOR NO KEY UPDATE`;
          locked();
          await gate;
        },
        { timeoutMs: 20_000 },
      );
      try {
        await holding;
        const takes = Promise.allSettled([
          services[0]!.claim(ctx(), memberPrincipal(fx.a.agentAccountId), chatId),
          services[1]!.claim(ctx(), memberPrincipal(colleagueId), chatId),
        ]);
        await waitingOnLock('%FROM chats%FOR NO KEY UPDATE%', 2);
        release();
        await held;

        const outcomes = (await takes).map(outcomeOf);
        expect([...outcomes].sort()).toEqual(['refused:claimed', 'taken']);
        const winner = outcomes[0] === 'taken' ? fx.a.agentAccountId : colleagueId;
        expect(await threadOf(threadId)).toMatchObject({ assigneeId: winner, aiMode: 'human' });
        expect(await modeLines(threadId)).toEqual([
          expect.objectContaining({ text: TAKEN, authorId: winner }),
        ]);
      } finally {
        release();
        await held.catch(() => undefined);
        await Promise.all([first.$disconnect(), second.$disconnect()]);
      }
    });

    it('never ends a free-running pair any other way', async () => {
      const [first, second] = await connected();
      const services = [first, second].map((client) => new ChatService(client, NO_REDIS));
      try {
        for (let round = 0; round < 5; round += 1) {
          const { chatId, threadId } = await conversation({
            aiMode: round % 2 === 0 ? 'ai' : 'paused',
          });
          const outcomes = (
            await Promise.allSettled([
              services[0]!.claim(ctx(), memberPrincipal(fx.a.agentAccountId), chatId),
              services[1]!.claim(ctx(), memberPrincipal(colleagueId), chatId),
            ])
          ).map(outcomeOf);
          expect([...outcomes].sort(), `round ${round}`).toEqual(['refused:claimed', 'taken']);
          const winner = outcomes[0] === 'taken' ? fx.a.agentAccountId : colleagueId;
          expect((await threadOf(threadId)).assigneeId).toBe(winner);
          expect(await modeLines(threadId)).toHaveLength(1);
        }
      } finally {
        await Promise.all([first.$disconnect(), second.$disconnect()]);
      }
    });

    it('waits for the player’s message being written instead of deadlocking with it', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });

      // A message's two writes, one at a time (`#appendEvent`): the chat row,
      // and — once the take is under way — the thread. A take that locked the
      // thread first would now wait on the chat row while this waits on it.
      let proceed!: () => void;
      const go = new Promise<void>((resolve) => (proceed = resolve));
      let locked!: () => void;
      const holding = new Promise<void>((resolve) => (locked = resolve));
      const message = withTenant(
        appRole,
        ctx(),
        async (tx) => {
          await tx.$executeRaw`UPDATE chats SET last_event_at = now() WHERE id = ${chatId}`;
          locked();
          await go;
          const [row] = await tx.$queryRaw<Array<{ event_sequence: number }>>`
            UPDATE threads SET event_sequence = event_sequence + 1 WHERE id = ${threadId}
            RETURNING event_sequence`;
          return row?.event_sequence ?? null;
        },
        { timeoutMs: 20_000 },
      );
      try {
        await holding;
        const take = claim(chatId, agentToken);
        await waitingOnLock('%chats%');
        proceed();
        expect(await message).toBe(1);
        const taken = await take;
        expect(taken.statusCode, taken.body).toBe(200);
      } finally {
        proceed();
        await message.catch(() => undefined);
      }
      expect(await threadOf(threadId)).toMatchObject({
        assigneeId: fx.a.agentAccountId,
        aiMode: 'human',
      });
    });
  });
});
