/**
 * A reply to the customer comes only from the agent the conversation is
 * assigned to (tm 475 · owner decision 2026-11-06, analysis 04 K45). What is
 * pinned here:
 *
 *   1. The rule (`ChatService.sendEvent`): an agent's message to the customer
 *      on a connection nobody has (`unassigned`), the AI's (`ai`, held back
 *      too) or a colleague's (`assigned_to_other`) is a 409
 *      `reply_requires_assignment` that writes nothing — no event, no AI mode
 *      change, no idempotency key used up. The assignee is answered 201 and,
 *      beside an AI answering too, silences it; an internal note and a bot's
 *      message are not held to the rule.
 *   2. The race: the reply reads the assignment under the conversation's
 *      locks (the chat row, then the thread), so a re-assignment that commits
 *      first is seen and the reply refused, and a takeover arriving while a
 *      reply is being written lands after it. Staged on a connection of its
 *      own (race-tests-need-separate-connections) and watched in
 *      `pg_stat_activity`; then a free-running race that must never end in an
 *      error.
 *   3. A conversation the agent opens (`POST /chats`): an opening line to the
 *      customer makes the connection theirs, whatever `assign_to_me` says —
 *      on a new day's chat and on a further connection under one; a note, or
 *      no opening line, is routed as asked.
 */
import { PrismaClient } from '@prisma/client';
import { capabilitiesForRole, generateShortId } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

/** The sequence an event id carries (`<thread>_<n>`) — the order the transcript shows. */
const sequenceOf = (eventId: string): number => Number(eventId.split('_').pop());

describe('a reply to the customer comes only from the assigned agent (tm 475)', () => {
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
  /** The workspace owner: every chat, and takes any of them over. */
  let adminToken: string;
  let botToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  /** `fx.a`'s agent as the service sees them, for a send held open on its own connection. */
  const agentPrincipal = (): AgentPrincipal => ({
    kind: 'agent',
    accountId: fx.a.agentAccountId,
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
    role: 'agent',
    capabilities: capabilitiesForRole('agent', []),
    scopes: ['chats--access:rw', 'chats--access:ro'],
    tokenId: 'test-token',
    tokenKind: 'pat',
  });

  async function newCustomer(): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    return customer.id;
  }

  /** A conversation in Support, its open connection as given — seeded, not routed. */
  async function conversation(
    connection: { assigneeId?: string | null; aiMode?: 'ai' | 'human' | 'paused' | null } = {},
  ): Promise<{ chatId: string; threadId: string }> {
    const customerId = await newCustomer();
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId, active: true },
    });
    await owner.chatAccess.create({ data: { chatId, groupId: supportId } });
    await owner.chatUser.create({
      data: { chatId, userId: customerId, userType: 'customer', present: true },
    });
    if (connection.assigneeId) {
      await owner.chatUser.create({
        data: { chatId, userId: connection.assigneeId, userType: 'agent', present: true },
      });
    }
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        groupId: supportId,
        assigneeId: connection.assigneeId ?? null,
        aiMode: connection.aiMode ?? null,
      },
    });
    return { chatId, threadId };
  }

  const send = (chatId: string, token: string, body: Record<string, unknown> = {}) =>
    server.post(
      `/chats/${chatId}/events`,
      { type: 'message', text: 'Thanks for waiting — I can help with that.', ...body },
      auth(token),
    );

  /** Every line an agent wrote to the customer on the connection, in transcript order. */
  async function repliesOn(threadId: string) {
    const rows = await owner.event.findMany({
      where: { threadId, authorType: 'agent', recipients: 'all' },
      select: { id: true, authorId: true },
    });
    return rows.sort((a, b) => sequenceOf(a.id) - sequenceOf(b.id));
  }

  const threadOf = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { assigneeId: true, aiMode: true, eventSequence: true },
    });

  /** Wait until a statement matching `pattern` waits for a row lock in this run's database. */
  async function waitingOnLock(pattern: string): Promise<void> {
    for (let i = 0; i < 250; i += 1) {
      const [row] = await owner.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE wait_event_type = 'Lock' AND datname = current_database() AND query LIKE ${pattern}`;
      if ((row?.n ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const seen = await owner.$queryRaw<Array<{ q: string; w: string | null }>>`
      SELECT left(query, 200) AS q, wait_event AS w FROM pg_stat_activity
       WHERE datname = current_database() AND state <> 'idle'`;
    throw new Error(`nothing matching ${pattern} waited for a lock: ${JSON.stringify(seen)}`);
  }

  /**
   * Give the connection to `assigneeId` the way a claim's compare-and-set or a
   * transfer does — the thread row only — in a transaction of its own, held
   * open until `release()`.
   */
  function holdReassignment(threadId: string, from: string, assigneeId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let moved!: (count: number) => void;
    const done = new Promise<number>((resolve) => (moved = resolve));
    const finished = withTenant(
      appRole,
      ctx(),
      async (tx) => {
        const count = await tx.$executeRaw`
          UPDATE threads SET assignee_id = ${assigneeId}::uuid
           WHERE id = ${threadId} AND assignee_id = ${from}::uuid`;
        moved(count);
        await gate;
      },
      { timeoutMs: 20_000 },
    );
    return { moved: done, release, finished };
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
    const licenseId = fx.a.licenseId;

    supportId = (
      await owner.group.create({ data: { licenseId, name: 'Destek' }, select: { id: true } })
    ).id;
    const colleague = await owner.account.create({
      data: { email: `${generateShortId()}@reply.test`.toLowerCase(), name: 'Colleague' },
      select: { id: true },
    });
    colleagueId = colleague.id;
    await owner.agentMembership.create({
      data: { licenseId, agentId: colleagueId, role: 'agent', routingStatus: 'accepting_chats' },
    });
    await owner.groupAgent.createMany({
      data: [
        { licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
        { licenseId, groupId: supportId, agentId: colleagueId },
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
    agentToken = await token(fx.a.agentAccountId, ['chats--access:rw', 'customers:rw']);
    colleagueToken = await token(colleagueId, ['chats--access:rw']);
    adminToken = await token(fx.a.ownerAccountId, ['chats--all:rw', 'customers:rw']);
    const bot = await owner.bot.create({
      data: { licenseId, name: `Rules ${generateShortId()}` },
      select: { id: true },
    });
    botToken = await token(bot.id, ['chats--all:rw'], 'bot');
  });

  // --- 1. The rule -------------------------------------------------------------

  describe('the rule', () => {
    it('refuses an agent on a connection nobody has, and writes nothing (unassigned)', async () => {
      const { chatId, threadId } = await conversation();
      const before = await threadOf(threadId);

      const refused = await send(chatId, agentToken, { idempotency_key: 'reply-1' });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        error: { type: 'reply_requires_assignment', details: { reason: 'unassigned' } },
      });
      expect(await repliesOn(threadId)).toEqual([]);
      // Nothing moved: no event counted, nobody assigned, the AI's mode as it was.
      expect(await threadOf(threadId)).toEqual(before);

      // The key was not used up: once the conversation is theirs, the same
      // send is a new message (201), not the replay of one that never was.
      await owner.thread.update({
        where: { id: threadId },
        data: { assigneeId: fx.a.agentAccountId },
      });
      const sent = await send(chatId, agentToken, { idempotency_key: 'reply-1' });
      expect(sent.statusCode, sent.body).toBe(201);
      expect(await repliesOn(threadId)).toHaveLength(1);
    });

    it("refuses a colleague's connection as assigned_to_other, and answers the colleague", async () => {
      const { chatId, threadId } = await conversation({ assigneeId: colleagueId });

      const refused = await send(chatId, agentToken);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        error: { type: 'reply_requires_assignment', details: { reason: 'assigned_to_other' } },
      });
      // The owner sees every chat and still does not write into a colleague's.
      const byAdmin = await send(chatId, adminToken);
      expect(byAdmin.statusCode).toBe(409);
      expect(byAdmin.json()).toMatchObject({ error: { details: { reason: 'assigned_to_other' } } });

      const sent = await send(chatId, colleagueToken);
      expect(sent.statusCode, sent.body).toBe(201);
      expect(await repliesOn(threadId)).toEqual([
        expect.objectContaining({ authorId: colleagueId }),
      ]);
    });

    it('refuses a connection the AI answers, and leaves the AI answering it (ai)', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });

      const refused = await send(chatId, agentToken);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        error: { type: 'reply_requires_assignment', details: { reason: 'ai' } },
      });
      // Writing no longer takes it from the AI: no `human`, no mode line.
      expect(await threadOf(threadId)).toMatchObject({ aiMode: 'ai', assigneeId: null });
      expect(await owner.event.count({ where: { threadId } })).toBe(0);
    });

    it('refuses a connection whose AI is held back with nobody on it (ai)', async () => {
      const { chatId, threadId } = await conversation({ aiMode: 'ai' });
      const paused = await server.post(`/chats/${chatId}/pause-ai`, {}, auth(adminToken));
      expect(paused.statusCode, paused.body).toBe(200);
      expect(await threadOf(threadId)).toMatchObject({ aiMode: 'paused', assigneeId: null });

      for (const token of [agentToken, adminToken]) {
        const refused = await send(chatId, token);
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json()).toMatchObject({
          error: { type: 'reply_requires_assignment', details: { reason: 'ai' } },
        });
      }
      expect(await repliesOn(threadId)).toEqual([]);
      expect((await threadOf(threadId)).aiMode).toBe('paused');
    });

    it('answers the assignee, whose reply silences an AI answering beside them', async () => {
      const { chatId, threadId } = await conversation({
        assigneeId: fx.a.agentAccountId,
        aiMode: 'ai',
      });

      const sent = await send(chatId, agentToken);
      expect(sent.statusCode, sent.body).toBe(201);
      expect(await repliesOn(threadId)).toEqual([
        expect.objectContaining({ authorId: fx.a.agentAccountId }),
      ]);
      // Parallel assignment: the implicit takeover stays for the assignee.
      expect(await threadOf(threadId)).toMatchObject({
        aiMode: 'human',
        assigneeId: fx.a.agentAccountId,
      });
    });

    it('lets anyone who sees the conversation write an internal note (FR-MOD-02.3.4)', async () => {
      const nobodys = await conversation();
      const colleagues = await conversation({ assigneeId: colleagueId });
      const ais = await conversation({ aiMode: 'ai' });

      for (const { chatId, threadId } of [nobodys, colleagues, ais]) {
        const note = await send(chatId, agentToken, {
          text: 'Checked the order: it shipped yesterday.',
          recipients: 'agents',
        });
        expect(note.statusCode, note.body).toBe(201);
        expect(note.json()).toMatchObject({ recipients: 'agents' });
        expect(await repliesOn(threadId)).toEqual([]);
      }
      // A note takes nothing: the AI keeps answering, nobody is assigned.
      expect(await threadOf(ais.threadId)).toMatchObject({ aiMode: 'ai', assigneeId: null });
      expect((await threadOf(nobodys.threadId)).assigneeId).toBeNull();
    });

    it("does not hold a bot's message to the rule", async () => {
      const { chatId, threadId } = await conversation();
      const sent = await send(chatId, botToken);
      expect(sent.statusCode, sent.body).toBe(201);
      expect(await owner.event.count({ where: { threadId, authorType: 'bot' } })).toBe(1);
    });
  });

  // --- 2. The race -------------------------------------------------------------

  describe('racing a re-assignment', () => {
    it('refuses a reply that waited on a re-assignment committing first (FR-MOD-08.6.3)', async () => {
      const { chatId, threadId } = await conversation({ assigneeId: fx.a.agentAccountId });

      // The conversation is moving to the colleague and has not committed;
      // the agent's reply arrives meanwhile and must wait for the answer.
      const held = holdReassignment(threadId, fx.a.agentAccountId, colleagueId);
      try {
        expect(await held.moved).toBe(1);
        const racing = send(chatId, agentToken);
        await waitingOnLock('%FROM threads%FOR UPDATE%');
        held.release();
        await held.finished;

        const refused = await racing;
        expect(refused.statusCode, refused.body).toBe(409);
        expect(refused.json()).toMatchObject({
          error: { type: 'reply_requires_assignment', details: { reason: 'assigned_to_other' } },
        });
      } finally {
        held.release();
        await held.finished.catch(() => undefined);
      }
      expect(await repliesOn(threadId)).toEqual([]);
      expect((await threadOf(threadId)).assigneeId).toBe(colleagueId);
    });

    it('lands a takeover arriving mid-reply after the reply (FR-MOD-08.6.3)', async () => {
      const { chatId, threadId } = await conversation({ assigneeId: fx.a.agentAccountId });
      const chats = new ChatService(appRole, NO_REDIS);

      // The agent's reply is written and its transaction still open.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let written!: () => void;
      const appended = new Promise<void>((resolve) => (written = resolve));
      const reply = chats.sendEvent(
        ctx(),
        agentPrincipal(),
        chatId,
        { type: 'message', text: 'Your refund is on its way.', recipients: 'all' },
        {
          outbox: async () => {
            written();
            await gate;
          },
        },
      );
      try {
        await appended;
        const takeover = server.post(`/chats/${chatId}/takeover`, {}, auth(adminToken));
        await waitingOnLock('%');
        release();
        const sent = await reply;
        const taken = await takeover;
        expect(taken.statusCode, taken.body).toBe(200);

        // The reply went out while the conversation was the agent's; the
        // takeover's line follows it.
        const line = await owner.event.findFirstOrThrow({
          where: { threadId, type: 'system_message', text: 'Chat taken over' },
          select: { id: true },
        });
        expect(sequenceOf(sent.event.id)).toBeLessThan(sequenceOf(line.id));
      } finally {
        release();
        await reply.catch(() => undefined);
      }
      expect((await threadOf(threadId)).assigneeId).toBe(fx.a.ownerAccountId);
      expect(await repliesOn(threadId)).toEqual([
        expect.objectContaining({ authorId: fx.a.agentAccountId }),
      ]);
    });

    it('takes the chat row before the thread, as a reply does, so the two never deadlock', async () => {
      const { chatId, threadId } = await conversation({ assigneeId: fx.a.agentAccountId });

      // A reply's two locks, one at a time: the chat row, and — once the
      // takeover is under way — the thread. A takeover that took the thread
      // first would now wait on the chat row while this waits on the thread.
      let chatLocked!: () => void;
      const holding = new Promise<void>((resolve) => (chatLocked = resolve));
      let proceed!: () => void;
      const go = new Promise<void>((resolve) => (proceed = resolve));
      const replying = withTenant(
        appRole,
        ctx(),
        async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM chats WHERE id = ${chatId} FOR NO KEY UPDATE`;
          chatLocked();
          await go;
          const [row] = await tx.$queryRaw<Array<{ assignee_id: string | null }>>`
            SELECT assignee_id FROM threads WHERE id = ${threadId} FOR UPDATE`;
          return row?.assignee_id ?? null;
        },
        { timeoutMs: 20_000 },
      );
      try {
        await holding;
        const takeover = server.post(`/chats/${chatId}/takeover`, {}, auth(adminToken));
        await waitingOnLock('%chats%');
        proceed();
        // The reply side read the connection as it was, and committed first.
        expect(await replying).toBe(fx.a.agentAccountId);
        const taken = await takeover;
        expect(taken.statusCode, taken.body).toBe(200);
      } finally {
        proceed();
        await replying.catch(() => undefined);
      }
      expect((await threadOf(threadId)).assigneeId).toBe(fx.a.ownerAccountId);
    });

    it('never answers a reply racing a takeover with an error, nor writes it after', async () => {
      for (let round = 0; round < 5; round += 1) {
        const { chatId, threadId } = await conversation({ assigneeId: fx.a.agentAccountId });
        const [reply, takeover] = await Promise.all([
          send(chatId, agentToken),
          server.post(`/chats/${chatId}/takeover`, {}, auth(adminToken)),
        ]);
        expect(takeover.statusCode, takeover.body).toBe(200);
        const line = await owner.event.findFirstOrThrow({
          where: { threadId, type: 'system_message', text: 'Chat taken over' },
          select: { id: true },
        });
        if (reply.statusCode === 201) {
          // Written first, while it was still the agent's.
          expect(sequenceOf((reply.json() as { id: string }).id)).toBeLessThan(sequenceOf(line.id));
        } else {
          expect(reply.statusCode, reply.body).toBe(409);
          expect(reply.json()).toMatchObject({
            error: { type: 'reply_requires_assignment', details: { reason: 'assigned_to_other' } },
          });
          expect(await repliesOn(threadId)).toEqual([]);
        }
      }
    });
  });

  // --- 3. A conversation the agent opens -----------------------------------------

  describe('a conversation the agent opens', () => {
    const start = (token: string, body: Record<string, unknown>) =>
      server.post('/chats', body, auth(token));

    it('is theirs when the opening line goes to the customer, whatever assign_to_me says', async () => {
      const customerId = await newCustomer();
      const opened = await start(agentToken, {
        customer_id: customerId,
        assign_to_me: false,
        group_ids: [Number(supportId)],
        initial_event: { type: 'message', text: 'Hi, following up on your order.' },
      });
      expect(opened.statusCode, opened.body).toBe(201);
      const chat = opened.json() as { id: string; thread: { id: string } };

      expect((await threadOf(chat.thread.id)).assigneeId).toBe(fx.a.agentAccountId);
      expect(await repliesOn(chat.thread.id)).toEqual([
        expect.objectContaining({ authorId: fx.a.agentAccountId }),
      ]);
      // And the next reply is theirs to write.
      const next = await send(chat.id, agentToken);
      expect(next.statusCode, next.body).toBe(201);

      // A further connection under the day's chat goes the same way.
      const closed = await server.post(`/chats/${chat.id}/deactivate`, undefined, auth(agentToken));
      expect(closed.statusCode, closed.body).toBe(200);
      const again = await start(agentToken, {
        customer_id: customerId,
        assign_to_me: false,
        group_ids: [Number(supportId)],
        initial_event: { type: 'message', text: 'One more thing about your order.' },
      });
      expect(again.statusCode, again.body).toBe(201);
      const further = again.json() as { id: string; thread: { id: string } };
      expect(further.id).toBe(chat.id);
      expect(further.thread.id).not.toBe(chat.thread.id);
      expect((await threadOf(further.thread.id)).assigneeId).toBe(fx.a.agentAccountId);
    });

    it('is routed as asked when it opens with a note, or with no line at all', async () => {
      // The agent is not taking chats: routing gives Support's to the colleague.
      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { routingStatus: 'not_accepting_chats' },
      });

      const noted = await start(agentToken, {
        customer_id: await newCustomer(),
        assign_to_me: false,
        initial_event: {
          type: 'message',
          text: 'Customer asked for a call back.',
          recipients: 'agents',
        },
      });
      expect(noted.statusCode, noted.body).toBe(201);
      const notedThread = (noted.json() as { thread: { id: string } }).thread.id;
      expect((await threadOf(notedThread)).assigneeId).toBe(colleagueId);

      const silent = await start(agentToken, {
        customer_id: await newCustomer(),
        assign_to_me: false,
      });
      expect(silent.statusCode, silent.body).toBe(201);
      const silentThread = (silent.json() as { thread: { id: string } }).thread.id;
      expect((await threadOf(silentThread)).assigneeId).toBe(colleagueId);

      // The same request with a line to the customer is the caller's.
      const replied = await start(agentToken, {
        customer_id: await newCustomer(),
        assign_to_me: false,
        initial_event: { type: 'message', text: 'Hello! Following up on your call.' },
      });
      expect(replied.statusCode, replied.body).toBe(201);
      const repliedThread = (replied.json() as { thread: { id: string } }).thread.id;
      expect((await threadOf(repliedThread)).assigneeId).toBe(fx.a.agentAccountId);
    });
  });
});
