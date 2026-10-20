/**
 * Handing a conversation to a team (tm 306 · SiyahTuş analysis IN-04,
 * IN-04-S1, IN-04-S2).
 *
 * A team hand-off used to unassign the connection and leave it there: not
 * given to anyone in the team, not in the team's queue, so no drain ever
 * picked it up — it waited in "unassigned" until somebody noticed. And a team
 * with nobody accepting refused it (`group_offline`). What is tested here:
 *
 *   1. a member who is free gets it, and is told (acceptance: "çevrimiçi biri
 *      varsa ona atanır ve bildirim gider");
 *   2. nobody free: it waits in that team's queue — never the fallback team's
 *      — and the first member who frees up gets it (acceptance: "Finans'ta
 *      kimse yoksa Finans kuyruğuna girer, ilk müsait Finans ajanına atanır");
 *   3. a hand-off to one's own team means someone else;
 *   4. the note is an internal note (acceptance: "oyuncu görmez"), required
 *      of a person handing to Responsible Gambling or Complaints;
 *   5. the caller is told whether they can still open it (acceptance: "Sohbet
 *      aktaran ajanın listesinden düşer, hata görülmez");
 *   6. a Responsible Gambling hand-off nobody could take reaches the
 *      supervisors (IN-04-S1);
 *   7. a waiting chat moves queues; `GET /groups` says who is online.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, licenseChannel } from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Envelope {
  action: string;
  audience: { agentIds?: string[]; groupIds?: number[] };
  payload: Record<string, unknown>;
}

describe('handing a conversation to a team (IN-04)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  let financeId: bigint;
  let supportId: bigint;
  let rgId: bigint;
  let complaintsId: bigint;
  let adminToken: string;
  /** The agent handing chats off: a member of Destek, `chats--access:rw`. */
  let ayse: string;
  let ayseToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
    await clearRateLimits(server.app);
    const licenseId = fx.a.licenseId;

    supportId = (
      await owner.group.create({ data: { licenseId, name: 'Destek' }, select: { id: true } })
    ).id;
    financeId = (
      await owner.group.create({
        data: { licenseId, name: 'Finans', topicRole: 'finance' },
        select: { id: true },
      })
    ).id;
    rgId = (
      await owner.group.create({
        data: { licenseId, name: 'Sorumlu Oyun', topicRole: 'responsible_gambling' },
        select: { id: true },
      })
    ).id;
    complaintsId = (
      await owner.group.create({
        data: { licenseId, name: 'Şikâyet', topicRole: 'complaint' },
        select: { id: true },
      })
    ).id;
    // Every overflow goes to Destek — a team hand-off must never use it.
    await owner.routingRule.create({
      data: { licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
    });
    // The fixture's two members are not in these teams, and take nothing.
    await owner.agentMembership.updateMany({
      where: { licenseId },
      data: { routingStatus: 'not_accepting_chats' },
    });

    adminToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'groups--all:ro'],
    });
    ayse = await addAgent([supportId]);
    ayseToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: ayse,
      scopes: ['chats--access:rw', 'groups--my:ro'],
    });
  });

  // -------------------------------------------------------------------------

  async function addAgent(
    groupIds: bigint[],
    options: { status?: string; suspended?: boolean; limit?: number } = {},
  ): Promise<string> {
    const licenseId = fx.a.licenseId;
    const account = await owner.account.create({
      data: { email: `${generateShortId()}@transfer.test`.toLowerCase(), name: 'Agent' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId,
        agentId: account.id,
        role: 'agent',
        routingStatus: options.status ?? 'accepting_chats',
        suspended: options.suspended ?? false,
        concurrentChatsLimit: options.limit ?? 6,
      },
    });
    for (const groupId of groupIds) {
      await owner.groupAgent.create({
        data: { licenseId, groupId, agentId: account.id, priority: 'normal' },
      });
    }
    return account.id;
  }

  /** A chat in Destek, held by `assigneeId` (or nobody), with `assigneeId` in it. */
  async function chatInSupport(
    assigneeId: string | null,
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
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: true,
        assigneeId,
        groupId: supportId,
      },
    });
    if (assigneeId) {
      await owner.chatUser.create({
        data: { chatId, userId: assigneeId, userType: 'agent', present: true },
      });
    }
    return { chatId, threadId };
  }

  const transfer = (chatId: string, body: Record<string, unknown>, token = ayseToken) =>
    server.post(`/chats/${chatId}/transfer`, body, auth(token));

  const threadOf = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { assigneeId: true, queuePosition: true, queueGroupId: true, groupId: true },
    });

  async function captureBus(run: () => Promise<void>): Promise<Envelope[]> {
    const sub = server.app.redis.duplicate();
    const seen: Envelope[] = [];
    await sub.subscribe(licenseChannel(fx.a.licenseId));
    sub.on('message', (_channel, raw) => {
      try {
        seen.push(JSON.parse(raw) as Envelope);
      } catch {
        /* not an envelope */
      }
    });
    try {
      await run();
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await sub.unsubscribe(licenseChannel(fx.a.licenseId));
      sub.disconnect();
    }
    return seen;
  }

  async function comeOnline(agentId: string): Promise<void> {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: agentId,
      scopes: ['agents--my:rw'],
    });
    const response = await server.put(
      '/agents/me/routing-status',
      { routing_status: 'accepting_chats' },
      auth(token),
    );
    expect(response.statusCode).toBe(200);
  }

  // =========================================================================
  // 1–2. Someone has it, or it waits in the team's queue
  // =========================================================================

  it('gives the chat to a free member of the team and tells them (FR-MOD-08.6.1)', async () => {
    const fatih = await addAgent([financeId]);
    const { chatId, threadId } = await chatInSupport(ayse);

    let response: Awaited<ReturnType<typeof transfer>> | undefined;
    const envelopes = await captureBus(async () => {
      response = await transfer(chatId, { group_id: Number(financeId) });
    });

    expect(response!.statusCode).toBe(200);
    expect(response!.json()).toMatchObject({
      outcome: 'assigned',
      access: { group_ids: [Number(financeId)] },
      thread: { assignee_id: fatih },
    });
    expect(await threadOf(threadId)).toEqual({
      assigneeId: fatih,
      queuePosition: null,
      queueGroupId: null,
      groupId: financeId,
    });
    // Their inbox hears it was given to them, and the hand-off says so.
    const incoming = envelopes.find((e) => e.action === 'incoming_chat');
    expect(incoming?.audience.agentIds).toEqual([fatih]);
    const transferred = envelopes.find((e) => e.action === 'chat_transferred');
    expect(transferred?.payload).toMatchObject({ outcome: 'assigned', assignee_id: fatih });
    expect(transferred?.payload['unstaffed']).toBeUndefined();
  });

  it("queues the chat in the team's own queue when nobody there is free, and the first member who is gets it (FR-MOD-08.6.1)", async () => {
    // Destek, the fallback team, has a free member: a team hand-off never
    // overflows there.
    await addAgent([supportId]);
    const away = await addAgent([financeId], { status: 'not_accepting_chats' });
    const { chatId, threadId } = await chatInSupport(ayse);

    const response = await transfer(chatId, { group_id: Number(financeId) });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ outcome: 'queued', thread: { assignee_id: null } });
    expect(await threadOf(threadId)).toEqual({
      assigneeId: null,
      queuePosition: 1,
      queueGroupId: financeId,
      groupId: financeId,
    });
    const stay = await owner.queueEntry.findFirstOrThrow({
      where: { threadId, leftAt: null },
      select: { groupId: true },
    });
    expect(stay.groupId).toBe(financeId);

    // The away member comes back: the drain gives it to them.
    await comeOnline(away);
    expect(await threadOf(threadId)).toMatchObject({ assigneeId: away, queuePosition: null });
  });

  it('never refuses a team whose members are all away — the old 409 group_offline (FR-MOD-08.6.1)', async () => {
    await addAgent([financeId], { status: 'offline' });
    const { chatId } = await chatInSupport(ayse);
    const response = await transfer(chatId, { group_id: Number(financeId) });
    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe('queued');
  });

  it('applies the team’s required expertise to the member it picks (FR-MOD-08.6.3)', async () => {
    const vip = await owner.expertise.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'VIP',
        slug: `vip-${generateShortId()}`.toLowerCase(),
      },
      select: { id: true },
    });
    await owner.groupExpertise.create({
      data: { licenseId: fx.a.licenseId, groupId: financeId, expertiseId: vip.id },
    });
    // Without the requirement the primary-tier member would win (ADR-08 order).
    const plain = await addAgent([financeId]);
    await owner.groupAgent.updateMany({ where: { agentId: plain }, data: { priority: 'primary' } });
    const expert = await addAgent([financeId]);
    await owner.agentExpertise.create({
      data: { licenseId: fx.a.licenseId, agentId: expert, expertiseId: vip.id },
    });
    const { chatId, threadId } = await chatInSupport(ayse);

    expect((await transfer(chatId, { group_id: Number(financeId) })).statusCode).toBe(200);
    expect((await threadOf(threadId)).assigneeId).toBe(expert);
  });

  // =========================================================================
  // 3. One's own team means someone else
  // =========================================================================

  it('gives a hand-off to the caller’s own team to someone else, or queues it (FR-MOD-08.6.1)', async () => {
    const { chatId, threadId } = await chatInSupport(ayse);
    // Ayşe is free in Destek, and alone: it waits rather than come back to her.
    const alone = await transfer(chatId, { group_id: Number(supportId) });
    expect(alone.json().outcome).toBe('queued');
    expect(await threadOf(threadId)).toMatchObject({ assigneeId: null, queueGroupId: supportId });

    const colleague = await addAgent([supportId]);
    const second = await chatInSupport(ayse);
    const response = await transfer(second.chatId, { group_id: Number(supportId) });
    expect(response.json().outcome).toBe('assigned');
    expect((await threadOf(second.threadId)).assigneeId).toBe(colleague);
  });

  // =========================================================================
  // 4. The note
  // =========================================================================

  it('writes the note as an internal note the player never receives (FR-MOD-08.6.1)', async () => {
    await addAgent([financeId]);
    const { chatId, threadId } = await chatInSupport(ayse);
    const note = 'Çekim talebi 3 gündür bekliyor, IBAN doğrulandı.';

    const response = await transfer(chatId, { group_id: Number(financeId), note: `  ${note} ` });
    expect(response.statusCode).toBe(200);

    const written = await owner.event.findMany({
      where: { threadId, type: 'message' },
      select: { text: true, recipients: true, authorId: true, authorType: true },
    });
    expect(written).toEqual([
      { text: note, recipients: 'agents', authorId: ayse, authorType: 'agent' },
    ]);
    // The player's widget reads the conversation without it.
    const customerEvents = await owner.event.findMany({
      where: { threadId, recipients: 'all' },
      select: { text: true },
    });
    expect(customerEvents.map((e) => e.text)).not.toContain(note);
  });

  it('refuses a person’s hand-off to Responsible Gambling or Complaints without a note (FR-MOD-08.6.1)', async () => {
    await addAgent([rgId]);
    await addAgent([complaintsId]);
    for (const groupId of [rgId, complaintsId]) {
      const { chatId, threadId } = await chatInSupport(ayse);
      const bare = await transfer(chatId, { group_id: Number(groupId), note: '   ' });
      expect(bare.statusCode).toBe(400);
      expect(bare.json().error.type).toBe('validation');
      expect(await threadOf(threadId)).toMatchObject({ assigneeId: ayse, groupId: supportId });

      const noted = await transfer(chatId, {
        group_id: Number(groupId),
        note: 'Kendini sınırlamak istiyor.',
      });
      expect(noted.statusCode).toBe(200);
    }
    // Finans asks for none.
    await addAgent([financeId]);
    const { chatId } = await chatInSupport(ayse);
    expect((await transfer(chatId, { group_id: Number(financeId) })).statusCode).toBe(200);
  });

  it('refuses a note over 500 characters', async () => {
    await addAgent([financeId]);
    const { chatId } = await chatInSupport(ayse);
    const response = await transfer(chatId, { group_id: Number(financeId), note: 'x'.repeat(501) });
    expect(response.statusCode).toBe(400);
  });

  // =========================================================================
  // 5. Whether the caller can still open it
  // =========================================================================

  it('tells a caller who never joined the chat that it left their sight, and the chat is then 404 to them (FR-MOD-08.6.1)', async () => {
    await addAgent([financeId]);
    // Ayşe sees it through Destek only — she never joined it.
    const { chatId } = await chatInSupport(null);

    const response = await transfer(chatId, { group_id: Number(financeId) });
    expect(response.statusCode).toBe(200);
    expect(response.json().visible_to_caller).toBe(false);
    expect((await server.get(`/chats/${chatId}`, auth(ayseToken))).statusCode).toBe(404);

    // The one who held it is still in it, and still sees it.
    const held = await chatInSupport(ayse);
    const kept = await transfer(held.chatId, { group_id: Number(financeId) });
    expect(kept.json().visible_to_caller).toBe(true);
    expect((await server.get(`/chats/${held.chatId}`, auth(ayseToken))).statusCode).toBe(200);
  });

  // =========================================================================
  // 6. Responsible Gambling nobody could take
  // =========================================================================

  it('tells the supervisors when a Responsible Gambling hand-off finds nobody free (FR-MOD-08.6.1)', async () => {
    await addAgent([rgId], { status: 'offline' });
    const { chatId, threadId } = await chatInSupport(ayse);

    const envelopes = await captureBus(async () => {
      const response = await transfer(chatId, {
        group_id: Number(rgId),
        note: 'Ara verme talebi.',
      });
      expect(response.json().outcome).toBe('queued');
    });
    expect((await threadOf(threadId)).queueGroupId).toBe(rgId);

    const transferred = envelopes.find((e) => e.action === 'chat_transferred');
    expect(transferred?.payload).toMatchObject({ outcome: 'queued', unstaffed: true });
    // The owner is a supervisor outside every team here.
    expect(transferred?.audience.agentIds).toContain(fx.a.ownerAccountId);
    expect(transferred?.audience.agentIds).not.toContain(fx.a.agentAccountId);
  });

  it('does not bother the supervisors about an ordinary team’s queue', async () => {
    await addAgent([financeId], { status: 'offline' });
    const { chatId } = await chatInSupport(ayse);
    const envelopes = await captureBus(async () => {
      expect((await transfer(chatId, { group_id: Number(financeId) })).json().outcome).toBe(
        'queued',
      );
    });
    const transferred = envelopes.find((e) => e.action === 'chat_transferred');
    expect(transferred?.payload['unstaffed']).toBeUndefined();
    expect(transferred?.audience.agentIds).not.toContain(fx.a.ownerAccountId);
  });

  // =========================================================================
  // 7. A waiting chat, the roster, the tenant
  // =========================================================================

  it('moves a chat waiting in one team to another team’s free member, and renumbers the queue it left', async () => {
    const supportAway = await addAgent([supportId], { status: 'not_accepting_chats' });
    const first = await chatInSupport(null);
    const second = await chatInSupport(null);
    for (const [index, thread] of [first, second].entries()) {
      const queuedAt = new Date(Date.now() - (2 - index) * 60_000);
      await owner.thread.update({
        where: { id: thread.threadId },
        data: { queuePosition: index + 1, queueGroupId: supportId, queuedAt },
      });
      await owner.queueEntry.create({
        data: {
          licenseId: fx.a.licenseId,
          threadId: thread.threadId,
          groupId: supportId,
          enteredAt: queuedAt,
        },
      });
    }
    const fatih = await addAgent([financeId]);

    const response = await transfer(first.chatId, { group_id: Number(financeId) }, adminToken);
    expect(response.json().outcome).toBe('assigned');
    expect(await threadOf(first.threadId)).toMatchObject({ assigneeId: fatih, queueGroupId: null });
    expect(await threadOf(second.threadId)).toMatchObject({
      queuePosition: 1,
      queueGroupId: supportId,
    });
    const stays = await owner.queueEntry.findMany({
      where: { threadId: first.threadId },
      select: { outcome: true, leftAt: true },
    });
    expect(stays).toEqual([{ outcome: 'transferred', leftAt: expect.any(Date) }]);
    expect(supportAway).not.toBe(fatih);
  });

  it('counts each team’s members accepting chats in GET /groups', async () => {
    await addAgent([financeId]);
    await addAgent([financeId]);
    await addAgent([financeId], { status: 'offline' });
    await addAgent([financeId], { suspended: true });
    await addAgent([financeId], { status: 'not_accepting_chats' });

    const response = await server.get('/groups', auth(adminToken));
    expect(response.statusCode).toBe(200);
    const items = (response.json() as { items: Array<{ id: number; accepting_count: number }> })
      .items;
    const count = (id: bigint) => items.find((g) => g.id === Number(id))?.accepting_count;
    expect(count(financeId)).toBe(2);
    expect(count(supportId)).toBe(1);
    expect(count(complaintsId)).toBe(0);
  });

  it('does not hand a chat to another workspace’s team', async () => {
    const foreign = await owner.group.create({
      data: { licenseId: fx.b.licenseId, name: 'Finans' },
      select: { id: true },
    });
    const { chatId, threadId } = await chatInSupport(ayse);
    const response = await transfer(chatId, { group_id: Number(foreign.id) });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.type).toBe('group_not_found');
    expect((await threadOf(threadId)).assigneeId).toBe(ayse);
  });
});
