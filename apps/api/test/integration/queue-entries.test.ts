/**
 * The queue record (tm 291 · RP-04, RP-04-S1; K21).
 *
 * `threads.queued_at` is cleared when a connection leaves the queue, so a
 * finished wait lives in `queue_entries`: a row opened where the connection
 * starts waiting and closed, in the same transaction, where it stops. What has
 * to hold, each on its own:
 *
 *   1. Entry and exit pair up — a connection that waited three minutes and was
 *      then assigned reads three minutes and `assigned`; the team it waited for
 *      is on the row; the live queue (`queued_at`, positions) behaves as before.
 *   2. Every exit says how — the player closing it is `abandoned`, and so is the
 *      inactivity close (RP-04-S1); an agent archiving it is `closed_by_agent`;
 *      a takeover is `assigned`; a transfer is `transferred`, and a transfer to
 *      a team it still waits in opens a further stay under that team.
 *   3. A closed connection keeps no open stay — after every scenario here, and
 *      through the sweep's safety net when some path forgot to close one.
 *   4. It is a tenant record — RLS keeps workspaces apart; the runtime role can
 *      open and close a stay but not delete one or rewrite when it began; the
 *      database refuses an unknown outcome, a half-closed row and a second open
 *      stay on one connection.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUEUE_ENTRY_OUTCOMES, generateShortId } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { ChatTimeoutSweeper } from '../../src/services/chat/chat-timeout.js';
import { enterQueue, leaveQueue } from '../../src/services/routing/queue-entries.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const MINUTE = 60_000;

/** Close needs no cache; the send path's idempotency check is the only user. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

describe('queue_entries (RP-04)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  let supportId: bigint;
  let salesId: bigint;
  let adminToken: string;

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);

    // The fixture's own agents are in no team, so they never take a routed chat.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    const sales = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Sales' },
      select: { id: true },
    });
    supportId = support.id;
    salesId = sales.id;
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:rw', 'customers:rw'],
    });
  });

  // Acceptance 3 — whatever a scenario did, no closed connection keeps a stay open.
  afterEach(async () => {
    vi.useRealTimers();
    const orphans = await owner.queueEntry.count({
      where: { leftAt: null, thread: { active: false } },
    });
    expect(orphans).toBe(0);
  });

  /** A team member with the given capacity and status. */
  async function addAgent(options: {
    groupId: bigint;
    limit?: number;
    status?: string;
  }): Promise<string> {
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@queue.test`.toLowerCase(), name: 'Agent' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: account.id,
        role: 'agent',
        routingStatus: options.status ?? 'accepting_chats',
        concurrentChatsLimit: options.limit ?? 6,
      },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: options.groupId,
        agentId: account.id,
        priority: 'normal',
      },
    });
    return account.id;
  }

  /** A chat started from the agent API for a fresh customer, routed (not self-assigned). */
  async function startChat(): Promise<{ chatId: string; threadId: string; queued: boolean }> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const response = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: false },
      auth(adminToken),
    );
    expect([200, 201]).toContain(response.statusCode);
    const body = response.json() as {
      id: string;
      thread: { id: string; queue_position: number | null };
    };
    return {
      chatId: body.id,
      threadId: body.thread.id,
      queued: body.thread.queue_position !== null,
    };
  }

  const staysOf = (threadId: string) =>
    owner.queueEntry.findMany({ where: { threadId }, orderBy: { enteredAt: 'asc' } });

  async function deactivate(chatId: string): Promise<void> {
    const response = await server.post(`/chats/${chatId}/deactivate`, undefined, auth(adminToken));
    expect(response.statusCode).toBe(200);
  }

  // --- 1. Entry and exit pair up --------------------------------------------

  describe('entering and leaving', () => {
    it('records a three-minute wait that ended in an assignment as three minutes, assigned', async () => {
      // Only Date is faked: the database and the timers keep real time.
      const t0 = new Date();
      vi.useFakeTimers({ toFake: ['Date'], now: t0 });

      await addAgent({ groupId: supportId, limit: 1 });
      const live = await startChat();
      expect(live.queued).toBe(false);
      const waiting = await startChat();
      expect(waiting.queued).toBe(true);

      // Opened with the wait, at the instant the live queue records.
      const thread = await owner.thread.findUniqueOrThrow({ where: { id: waiting.threadId } });
      const [open] = await staysOf(waiting.threadId);
      expect(open).toMatchObject({
        licenseId: fx.a.licenseId,
        groupId: supportId,
        leftAt: null,
        outcome: null,
      });
      expect(open!.enteredAt).toEqual(t0);
      expect(open!.enteredAt).toEqual(thread.queuedAt);
      // The assigned chat never waited.
      expect(await staysOf(live.threadId)).toEqual([]);

      vi.setSystemTime(t0.getTime() + 3 * MINUTE);
      await deactivate(live.chatId);

      const [stay] = await staysOf(waiting.threadId);
      expect(stay!.outcome).toBe('assigned');
      expect(stay!.leftAt!.getTime() - stay!.enteredAt.getTime()).toBe(3 * MINUTE);

      // The live queue behaves as it did: assigned, out of the numbering.
      const after = await owner.thread.findUniqueOrThrow({ where: { id: waiting.threadId } });
      expect(after.assigneeId).not.toBeNull();
      expect(after.queuePosition).toBeNull();
      expect(after.queuedAt).toBeNull();
    });

    it('closes the stay when an agent coming back online drains the queue', async () => {
      const agent = await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const waiting = await startChat();
      expect(waiting.queued).toBe(true);

      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: agent,
        scopes: ['agents--my:rw'],
      });
      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/v1/agents/me/routing-status',
        headers: auth(agentToken),
        payload: { routing_status: 'accepting_chats' },
      });
      expect(response.statusCode).toBe(200);

      const [stay] = await staysOf(waiting.threadId);
      expect(stay).toMatchObject({ outcome: 'assigned', groupId: supportId });
      expect(stay!.leftAt).not.toBeNull();
    });

    it('opens a stay for a player whose first message waits, under the team it waits for', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const visitor = await widgetToken();
      const sent = await server.post(
        '/customer/chat/events',
        { text: 'Is anyone there?' },
        auth(visitor.token),
      );
      expect(sent.statusCode).toBe(201);

      const thread = await owner.thread.findFirstOrThrow({
        where: { chatId: sent.json().chat_id, active: true },
      });
      expect(thread.queuePosition).toBe(1);
      const stays = await staysOf(thread.id);
      expect(stays).toHaveLength(1);
      expect(stays[0]).toMatchObject({ groupId: supportId, leftAt: null, outcome: null });
      expect(stays[0]!.enteredAt).toEqual(thread.queuedAt);
    });
  });

  // --- 2. Every exit says how ------------------------------------------------

  describe('how a stay ends', () => {
    it('counts the player closing a waiting chat as abandoned (RP-04-S1)', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const visitor = await widgetToken();
      const sent = await server.post(
        '/customer/chat/events',
        { text: 'Hello' },
        auth(visitor.token),
      );
      const chatId = sent.json().chat_id as string;
      const thread = await owner.thread.findFirstOrThrow({ where: { chatId, active: true } });

      const closed = await server.post('/customer/chat/close', undefined, auth(visitor.token));
      expect(closed.statusCode).toBe(204);

      const closedThread = await owner.thread.findUniqueOrThrow({ where: { id: thread.id } });
      const [stay] = await staysOf(thread.id);
      expect(stay).toMatchObject({ outcome: 'abandoned', leftAt: closedThread.closedAt });
    });

    it('counts a waiting chat closed for inactivity as abandoned (RP-04-S1)', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const waiting = await startChat();
      expect(waiting.queued).toBe(true);

      // K2's 30-minute widget window, an hour on.
      const sweeper = new ChatTimeoutSweeper(
        appRole,
        new ChatService(appRole, NO_REDIS),
        testEnv().AUDIT_CHAIN_SECRET,
      );
      const report = await sweeper.run({ now: new Date(Date.now() + 60 * MINUTE) });
      expect(report.totals.closed).toBe(1);
      // Closed by its own close, so the safety net found nothing.
      expect(report.totals.queueEntriesClosed).toBe(0);

      const [stay] = await staysOf(waiting.threadId);
      expect(stay!.outcome).toBe('abandoned');
    });

    it('counts an agent archiving a waiting chat as closed_by_agent', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const waiting = await startChat();
      await deactivate(waiting.chatId);

      const [stay] = await staysOf(waiting.threadId);
      expect(stay!.outcome).toBe('closed_by_agent');
    });

    it('counts a supervisor seizing a waiting chat as assigned', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const waiting = await startChat();

      const seized = await server.post(
        `/chats/${waiting.chatId}/takeover`,
        { reason: 'Long wait' },
        auth(adminToken),
      );
      expect(seized.statusCode).toBe(200);

      const [stay] = await staysOf(waiting.threadId);
      expect(stay!.outcome).toBe('assigned');
      // Closing the chat afterwards does not touch the closed stay.
      await deactivate(waiting.chatId);
      expect((await staysOf(waiting.threadId))[0]!.outcome).toBe('assigned');
    });

    it('counts a hand-off to a named agent as transferred', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const colleague = await addAgent({ groupId: salesId });
      const waiting = await startChat();

      const handed = await server.post(
        `/chats/${waiting.chatId}/transfer`,
        { agent_id: colleague },
        auth(adminToken),
      );
      expect(handed.statusCode).toBe(200);

      const stays = await staysOf(waiting.threadId);
      expect(stays).toHaveLength(1);
      expect(stays[0]!.outcome).toBe('transferred');
    });

    it('opens a further stay under the receiving team when a transfer leaves it waiting there', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      // Accepting, so the transfer is allowed — but full, so the chat waits on.
      const full = await addAgent({ groupId: salesId, limit: 1 });
      const occupied = await startChatFor(full);
      const waiting = await startChat();

      const handed = await server.post(
        `/chats/${waiting.chatId}/transfer`,
        { group_id: Number(salesId) },
        auth(adminToken),
      );
      expect(handed.statusCode).toBe(200);

      const stays = await staysOf(waiting.threadId);
      expect(stays.map((s) => [s.groupId, s.outcome])).toEqual([
        [supportId, 'transferred'],
        [salesId, null],
      ]);
      expect(stays[1]!.enteredAt).toEqual(stays[0]!.leftAt);

      // Sales frees up: the second stay ends the way any wait in the queue does.
      await deactivate(occupied);
      const after = await staysOf(waiting.threadId);
      expect(after.map((s) => s.outcome)).toEqual(['transferred', 'assigned']);
    });

    it("opens a stay for a player's further connection of the day that waits again", async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const visitor = await widgetToken();
      const first = await server.post('/customer/chat/events', { text: 'Hi' }, auth(visitor.token));
      const chatId = first.json().chat_id as string;
      expect(
        (await server.post('/customer/chat/close', undefined, auth(visitor.token))).statusCode,
      ).toBe(204);

      const back = await server.post(
        '/customer/chat/events',
        { text: 'Me again' },
        auth(visitor.token),
      );
      expect(back.json().chat_id).toBe(chatId);
      const [later, earlier] = await owner.thread.findMany({
        where: { chatId },
        orderBy: { createdAt: 'desc' },
      });
      expect(later!.openedVia).toBe('same_day_return');
      expect((await staysOf(earlier!.id)).map((s) => s.outcome)).toEqual(['abandoned']);
      const [stay] = await staysOf(later!.id);
      expect(stay).toMatchObject({ groupId: supportId, leftAt: null, enteredAt: later!.queuedAt });
    });

    it('counts a wait the day rolled over under as timeout', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const visitor = await widgetToken();
      const night = await server.post(
        '/customer/chat/events',
        { text: 'Late' },
        auth(visitor.token),
      );
      const yesterday = night.json().chat_id as string;
      const stale = await owner.thread.findFirstOrThrow({ where: { chatId: yesterday } });

      // "It is now the next day" and the connection has been silent past its
      // window — the `daily-thread.test.ts` scenario 6 set-up.
      const chat = await owner.chat.findUniqueOrThrow({ where: { id: yesterday } });
      await owner.chat.update({
        where: { id: yesterday },
        data: { localDay: new Date(chat.localDay!.getTime() - 24 * 60 * MINUTE) },
      });
      await owner.$executeRaw`
        UPDATE events SET created_at = created_at - interval '2 hours' WHERE chat_id = ${yesterday}`;
      await owner.$executeRaw`
        UPDATE threads SET created_at = created_at - interval '2 hours' WHERE chat_id = ${yesterday}`;

      const morning = await server.post(
        '/customer/chat/events',
        { text: 'Morning' },
        auth(visitor.token),
      );
      expect(morning.statusCode).toBe(201);
      expect(morning.json().chat_id).not.toBe(yesterday);

      const closed = await owner.thread.findUniqueOrThrow({ where: { id: stale.id } });
      expect(closed.active).toBe(false);
      expect((await staysOf(stale.id))[0]).toMatchObject({
        outcome: 'timeout',
        leftAt: closed.closedAt,
      });
      // Today's connection waits too, on a stay of its own.
      const today = await owner.thread.findFirstOrThrow({
        where: { chatId: morning.json().chat_id, active: true },
      });
      expect((await staysOf(today.id))[0]).toMatchObject({ leftAt: null, outcome: null });
    });

    it('leaves a chat that never waited without a stay', async () => {
      await addAgent({ groupId: supportId });
      const assigned = await startChat();
      expect(assigned.queued).toBe(false);
      await deactivate(assigned.chatId);
      expect(await staysOf(assigned.threadId)).toEqual([]);
    });
  });

  // --- 3. The safety net -------------------------------------------------------

  describe('the sweep safety net', () => {
    it('closes a stay some path left open on a closed connection, as timeout at the close', async () => {
      await addAgent({ groupId: supportId, status: 'not_accepting_chats' });
      const waiting = await startChat();
      // A path that forgets the record: the connection closes, the stay does not.
      const closedAt = new Date(Date.now() + 5 * MINUTE);
      await owner.thread.update({
        where: { id: waiting.threadId },
        data: { active: false, closedAt, queuePosition: null, queuedAt: null },
      });
      await owner.chat.update({ where: { id: waiting.chatId }, data: { active: false } });
      // Tenant B's open stay on a live connection is none of A's business, and
      // not the net's either.
      const other = await seedThread(fx.b, { active: true });
      await owner.queueEntry.create({
        data: { licenseId: fx.b.licenseId, threadId: other, enteredAt: new Date() },
      });

      const sweeper = new ChatTimeoutSweeper(
        appRole,
        new ChatService(appRole, NO_REDIS),
        testEnv().AUDIT_CHAIN_SECRET,
      );
      const first = await sweeper.run();
      expect(first.totals.queueEntriesClosed).toBe(1);
      expect((await sweeper.run()).totals.queueEntriesClosed).toBe(0);

      const [stay] = await staysOf(waiting.threadId);
      expect(stay).toMatchObject({ outcome: 'timeout', leftAt: closedAt });
      expect((await staysOf(other))[0]).toMatchObject({ leftAt: null, outcome: null });
    });
  });

  // --- 4. A tenant record -------------------------------------------------------

  describe('the table', () => {
    it("never shows one workspace another workspace's queue record (NFR-S4)", async () => {
      const threadId = await seedThread(fx.a, { active: true });
      await withTenant(appRole, ctx(fx.a), (tx) =>
        enterQueue(tx, {
          licenseId: fx.a.licenseId,
          threadId,
          groupId: null,
          enteredAt: new Date(),
        }),
      );

      const seenByB = await withTenant(appRole, ctx(fx.b), (tx) =>
        Promise.all([tx.queueEntry.count(), tx.queueEntry.count({ where: { threadId } })]),
      );
      expect(seenByB).toEqual([0, 0]);
      // Nor can B close it.
      expect(
        await withTenant(appRole, ctx(fx.b), (tx) => leaveQueue(tx, threadId, 'abandoned')),
      ).toBe(false);
      expect(await withTenant(appRole, ctx(fx.a), (tx) => tx.queueEntry.count())).toBe(1);

      // And B cannot file a stay under A's licence.
      await expect(
        withTenant(appRole, ctx(fx.b), (tx) =>
          enterQueue(tx, {
            licenseId: fx.a.licenseId,
            threadId,
            groupId: null,
            enteredAt: new Date(),
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      await closeAll(threadId);
    });

    it('lets the runtime role close a stay but not delete one or move when it began', async () => {
      const threadId = await seedThread(fx.a, { active: true });
      const enteredAt = new Date();
      await withTenant(appRole, ctx(fx.a), (tx) =>
        enterQueue(tx, { licenseId: fx.a.licenseId, threadId, groupId: null, enteredAt }),
      );

      await expect(
        withTenant(appRole, ctx(fx.a), (tx) => tx.queueEntry.deleteMany({ where: { threadId } })),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withTenant(appRole, ctx(fx.a), (tx) =>
          tx.queueEntry.updateMany({ where: { threadId }, data: { enteredAt: new Date(0) } }),
        ),
      ).rejects.toThrow(/permission denied/i);

      expect(
        await withTenant(appRole, ctx(fx.a), (tx) => leaveQueue(tx, threadId, 'assigned')),
      ).toBe(true);
      // Once: a second leave finds nothing open.
      expect(
        await withTenant(appRole, ctx(fx.a), (tx) => leaveQueue(tx, threadId, 'abandoned')),
      ).toBe(false);
      expect((await staysOf(threadId))[0]).toMatchObject({ outcome: 'assigned', enteredAt });
    });

    it('refuses an outcome outside QUEUE_ENTRY_OUTCOMES and accepts each one it names', async () => {
      const threadId = await seedThread(fx.a, { active: true });
      const enteredAt = new Date();
      await expect(
        owner.queueEntry.create({
          data: {
            licenseId: fx.a.licenseId,
            threadId,
            enteredAt,
            leftAt: enteredAt,
            outcome: 'gave_up',
          },
        }),
      ).rejects.toThrow(/queue_entries_outcome_check/);

      for (const outcome of QUEUE_ENTRY_OUTCOMES) {
        await owner.queueEntry.create({
          data: { licenseId: fx.a.licenseId, threadId, enteredAt, leftAt: enteredAt, outcome },
        });
      }
      expect(await owner.queueEntry.count({ where: { threadId } })).toBe(
        QUEUE_ENTRY_OUTCOMES.length,
      );
    });

    it('refuses a half-closed stay and one that left before it began', async () => {
      const threadId = await seedThread(fx.a, { active: true });
      const enteredAt = new Date();
      await expect(
        owner.queueEntry.create({
          data: { licenseId: fx.a.licenseId, threadId, enteredAt, leftAt: enteredAt },
        }),
      ).rejects.toThrow(/queue_entries_left_pair_check/);
      await expect(
        owner.queueEntry.create({
          data: { licenseId: fx.a.licenseId, threadId, enteredAt, outcome: 'assigned' },
        }),
      ).rejects.toThrow(/queue_entries_left_pair_check/);
      await expect(
        owner.queueEntry.create({
          data: {
            licenseId: fx.a.licenseId,
            threadId,
            enteredAt,
            leftAt: new Date(enteredAt.getTime() - 1),
            outcome: 'assigned',
          },
        }),
      ).rejects.toThrow(/queue_entries_left_after_entered_check/);
    });

    it('allows one open stay per connection, and any number of closed ones', async () => {
      const threadId = await seedThread(fx.a, { active: true });
      const enteredAt = new Date();
      await owner.queueEntry.create({
        data: {
          licenseId: fx.a.licenseId,
          threadId,
          enteredAt,
          leftAt: enteredAt,
          outcome: 'transferred',
        },
      });
      await owner.queueEntry.create({ data: { licenseId: fx.a.licenseId, threadId, enteredAt } });
      await expect(
        owner.queueEntry.create({ data: { licenseId: fx.a.licenseId, threadId, enteredAt } }),
      ).rejects.toThrow(/queue_entries_thread_open_key|Unique constraint/);
      await closeAll(threadId);
    });

    it('goes with its connection', async () => {
      const threadId = await seedThread(fx.a, { active: true });
      await owner.queueEntry.create({
        data: { licenseId: fx.a.licenseId, threadId, enteredAt: new Date() },
      });
      await owner.thread.delete({ where: { id: threadId } });
      expect(await owner.queueEntry.count({ where: { threadId } })).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  async function widgetToken(tenant = fx.a): Promise<{ token: string; customer_id: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string };
  }

  /** A chat already held by `agentId` (seeded, not routed). Returns the chat id. */
  async function startChatFor(agentId: string): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `held-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: true },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        assigneeId: agentId,
        groupId: salesId,
      },
    });
    return chatId;
  }

  /** A bare connection for the table's own tests. */
  async function seedThread(t: TenantFixture, options: { active: boolean }): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `t-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: customer.id, active: options.active },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: options.active },
    });
    return threadId;
  }

  /** Close whatever is still open on a seeded connection, so `afterEach` stays honest. */
  async function closeAll(threadId: string): Promise<void> {
    await owner.queueEntry.updateMany({
      where: { threadId, leftAt: null },
      data: { leftAt: new Date(), outcome: 'timeout' },
    });
  }
});
