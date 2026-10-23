/**
 * The player card beside a chat (tm 331.1 · SiyahTuş analysis IN-02):
 * `GET /chats/{chatId}/customer-context`.
 *
 * The customer detail read lists a player's chats to anyone who can open the
 * record; this read must not carry that into the inbox. So the suite seeds one
 * player across days and teams and reads the card as an agent of one team:
 *
 *   - the player block, the pre-chat answers, missing fields as null;
 *   - a second connection the same day lists the first under "today" (time,
 *     outcome, hand-over card); the next day "today" is empty and the earlier
 *     day is one row in the history;
 *   - another team's day is a restricted row: its dates and its team's queue
 *     topic, never its id, summary, tags or card — and the whole body says so;
 *   - a chat the agent may not see, another workspace's, the widget's token:
 *     all 404 (NFR-S5);
 *   - with `customers.contact.view` off, the email and username are null and
 *     blanked out of the prose around them;
 *   - the history pages 20 at a time over 90 days, and its cursor names no chat.
 *
 * Rows are seeded as the database owner, with explicit times, so a day is a
 * day whatever the clock says when the suite runs.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, type CapabilityOverride, type CustomerContext } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What one seeded connection carries. */
interface ConnectionSeed {
  at: Date;
  closedAt?: Date | null;
  assigneeId?: string;
  groupId?: bigint;
  summary?: string;
  tags?: string[];
  outcome?: 'resolved' | 'handed_off' | 'abandoned' | 'no_ai';
  rating?: 'good' | 'bad';
  card?: string;
}

interface DaySeed {
  customerId: string;
  /** The day's teams (`chat_access`). */
  groupIds?: bigint[];
  connections: ConnectionSeed[];
  /** Filed under no day — a chat from before ID-02. */
  noDay?: boolean;
  /** Overrides the chat's own time (defaults to its first connection's). */
  createdAt?: Date;
}

describe('the player card beside a chat (IN-02 · tm 331.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agent: Headers;
  let founder: Headers;
  let finance: bigint;
  let rg: bigint;

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

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
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);
    // The Team Member is in Finance; Responsible Gambling is another team's.
    finance = await team(fx.a, 'Finans', 'finance');
    rg = await team(fx.a, 'Sorumlu Oyun', 'responsible_gambling');
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: finance, agentId: fx.a.agentAccountId },
    });
    agent = bearer(
      await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:ro'],
      }),
    );
    founder = bearer(
      await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro', 'access_rules:rw'],
      }),
    );
  });

  async function team(t: TenantFixture, name: string, topicRole: string | null): Promise<bigint> {
    const group = await owner.group.create({
      data: { licenseId: t.licenseId, name, topicRole },
      select: { id: true },
    });
    return group.id;
  }

  async function player(
    t: TenantFixture,
    data: Partial<{
      name: string;
      email: string;
      username: string;
      countryCode: string;
      bannedAt: Date;
    }> = {},
  ): Promise<string> {
    const row = await owner.customer.create({
      data: { organizationId: t.organizationId, ...data },
      select: { id: true },
    });
    return row.id;
  }

  /** One day of the player's: a chat with its connections, oldest first. */
  async function seedDay(
    t: TenantFixture,
    seed: DaySeed,
  ): Promise<{ chatId: string; threadIds: string[] }> {
    const chatId = generateShortId();
    const first = seed.connections[0]!.at;
    const last = seed.connections.at(-1)!;
    const open = last.closedAt === undefined || last.closedAt === null;
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: seed.customerId,
        active: open,
        createdAt: seed.createdAt ?? first,
        lastEventAt: last.at,
        ...(seed.noDay
          ? {}
          : {
              localDay: new Date(`${first.toISOString().slice(0, 10)}T00:00:00.000Z`),
              dayTz: 'UTC',
            }),
      },
    });
    if (seed.groupIds?.length) {
      await owner.chatAccess.createMany({
        data: seed.groupIds.map((groupId) => ({ chatId, groupId })),
      });
    }
    const threadIds: string[] = [];
    for (const c of seed.connections) {
      const threadId = generateShortId();
      threadIds.push(threadId);
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: t.licenseId,
          active: c.closedAt === undefined || c.closedAt === null,
          createdAt: c.at,
          closedAt: c.closedAt ?? null,
          assigneeId: c.assigneeId ?? null,
          groupId: c.groupId ?? null,
          summary: c.summary ?? null,
        },
      });
      for (const name of c.tags ?? []) {
        const tag = await owner.tag.upsert({
          where: { licenseId_name: { licenseId: t.licenseId, name } },
          create: { licenseId: t.licenseId, name },
          update: {},
          select: { id: true },
        });
        await owner.threadTag.create({ data: { threadId, tagId: tag.id } });
      }
      if (c.outcome) {
        await owner.aiConversation.create({
          data: { licenseId: t.licenseId, chatId, threadId, outcome: c.outcome },
        });
      }
      if (c.rating) {
        await owner.rating.create({
          data: { chatId, licenseId: t.licenseId, threadId, value: c.rating },
        });
      }
      if (c.card) {
        await owner.aiHandoff.create({
          data: {
            id: randomUUID(),
            licenseId: t.licenseId,
            chatId,
            threadId,
            summary: c.card,
            player: { username: null, name: null, email: null, basis: 'declared' },
            reasonCodes: ['no_knowledge'],
            primaryReason: 'no_knowledge',
            priority: 'normal',
            cardText: `Konu: ${c.card}`,
            createdAt: c.closedAt ?? c.at,
          },
        });
      }
    }
    return { chatId, threadIds };
  }

  async function read(
    chatId: string,
    auth: Headers = agent,
    pageId?: string,
  ): Promise<{ status: number; body: string; json: CustomerContext }> {
    const query = pageId ? `?page_id=${encodeURIComponent(pageId)}` : '';
    const res = await server.get(`/chats/${chatId}/customer-context${query}`, auth);
    return { status: res.statusCode, body: res.body, json: res.json() as CustomerContext };
  }

  // =========================================================================

  it('names the player, their country and city and their pre-chat answers; what is missing is null (FR-MOD-02.4.1–.6)', async () => {
    const customerId = await player(fx.a, {
      name: 'Ada Oyuncu',
      email: 'ada@example.test',
      username: 'ada_77',
      bannedAt: new Date(),
    });
    await owner.visit.create({
      data: { customerId, licenseId: fx.a.licenseId, countryCode: 'TR', city: 'İzmir' },
    });
    const bonus = await owner.customFieldDefinition.create({
      data: {
        licenseId: fx.a.licenseId,
        entity: 'contact',
        label: 'Bonus kodu',
        type: 'text',
        formPlacement: 'pre_chat',
      },
      select: { id: true },
    });
    // A plain CRM field and an unanswered pre-chat question are no answers.
    const crm = await owner.customFieldDefinition.create({
      data: { licenseId: fx.a.licenseId, entity: 'contact', label: 'Segment', type: 'text' },
      select: { id: true },
    });
    await owner.customFieldDefinition.create({
      data: {
        licenseId: fx.a.licenseId,
        entity: 'contact',
        label: 'Telefon',
        type: 'text',
        formPlacement: 'pre_chat',
      },
    });
    await owner.customFieldValue.createMany({
      data: [
        { licenseId: fx.a.licenseId, definitionId: bonus.id, customerId, value: 'HOSGELDIN' },
        { licenseId: fx.a.licenseId, definitionId: crm.id, customerId, value: 'VIP' },
      ],
    });
    const now = Date.now();
    const { chatId } = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [{ at: new Date(now - HOUR) }],
    });

    const { status, json } = await read(chatId);
    expect(status).toBe(200);
    expect(json.chat_id).toBe(chatId);
    expect(json.customer).toEqual({
      id: customerId,
      name: 'Ada Oyuncu',
      username: 'ada_77',
      email: 'ada@example.test',
      // No country on the record: the newest visit's, with its city.
      country_code: 'TR',
      country: null,
      city: 'İzmir',
      banned: true,
    });
    expect(json.contact_visible).toBe(true);
    expect(json.pre_chat).toEqual([{ label: 'Bonus kodu', value: 'HOSGELDIN' }]);
    expect(json.today).toEqual([]);
    expect(json.history).toEqual({ items: [] });
    expect(json.restricted_count).toBe(0);

    // A player who gave nothing reads as nothing, not as an error.
    const bare = await seedDay(fx.a, {
      customerId: await player(fx.a),
      groupIds: [finance],
      connections: [{ at: new Date(now - HOUR) }],
    });
    const empty = (await read(bare.chatId)).json;
    expect(empty.customer).toMatchObject({
      name: null,
      username: null,
      email: null,
      country_code: null,
      city: null,
      banned: false,
    });
    expect(empty.pre_chat).toEqual([]);
  });

  it('takes the pre-chat answers from the connection’s own filled form first', async () => {
    const customerId = await player(fx.a);
    const bonus = await owner.customFieldDefinition.create({
      data: {
        licenseId: fx.a.licenseId,
        entity: 'contact',
        label: 'Bonus kodu',
        type: 'text',
        formPlacement: 'pre_chat',
      },
      select: { id: true },
    });
    await owner.customFieldValue.create({
      data: { licenseId: fx.a.licenseId, definitionId: bonus.id, customerId, value: 'ESKI' },
    });
    const { chatId, threadIds } = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [{ at: new Date(Date.now() - HOUR) }],
    });
    const threadId = threadIds[0]!;
    const form = async (seq: number, author: string, recipients: string, label: string) => {
      await owner.$executeRaw`UPDATE threads SET event_sequence = ${seq} WHERE id = ${threadId}`;
      await owner.$executeRaw`
        INSERT INTO events (id, thread_id, chat_id, license_id, type, author_type, recipients,
                            properties, created_at)
        VALUES (${`${threadId}_${seq}`}, ${threadId}, ${chatId}, ${fx.a.licenseId}, 'filled_form',
                ${author}, ${recipients},
                ${JSON.stringify({
                  fields: [
                    { label, answer: 'Yatırım' },
                    { label: '', value: 'x' },
                  ],
                })}::jsonb, now() + ${`${seq} seconds`}::interval)
      `;
    };
    await form(1, 'customer', 'all', 'Konu');
    // Newer, but not the player's answers: an agent's event and an internal note.
    await form(2, 'agent', 'all', 'Ajanın formu');
    await form(3, 'customer', 'agents', 'İç not');

    expect((await read(chatId)).json.pre_chat).toEqual([{ label: 'Konu', value: 'Yatırım' }]);
  });

  it('lists the first connection under “today” when the player comes back the same day, and the day under history the next day (FR-MOD-02.4.1–.6)', async () => {
    const customerId = await player(fx.a, { name: 'Ada' });
    const now = Date.now();
    const firstAt = new Date(now - 3 * HOUR);
    const firstClosed = new Date(now - 2.5 * HOUR);
    const { chatId, threadIds } = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [
        {
          at: firstAt,
          closedAt: firstClosed,
          assigneeId: fx.a.agentAccountId,
          groupId: finance,
          summary: 'Yatırım hesaba geçmedi',
          tags: ['yatirim', 'acil'],
          outcome: 'handed_off',
          rating: 'bad',
          card: 'Papara yatırımı 2 saattir bekliyor',
        },
        { at: new Date(now - HOUR), groupId: finance },
      ],
    });

    const sameDay = (await read(chatId)).json;
    expect(sameDay.today).toHaveLength(1);
    const earlier = sameDay.today[0]!;
    expect(earlier).toMatchObject({
      accessible: true,
      chat_id: chatId,
      thread_id: threadIds[0],
      started_at: firstAt.toISOString(),
      ended_at: firstClosed.toISOString(),
      connections_count: 1,
      assignee: { id: fx.a.agentAccountId },
      teams: [{ id: Number(finance), name: 'Finans' }],
      topics: ['finance'],
      tags: ['acil', 'yatirim'],
      summary: 'Yatırım hesaba geçmedi',
      outcome: 'handed_off',
      rating: 'bad',
    });
    expect(earlier.ai_handoff).toMatchObject({
      thread_id: threadIds[0],
      summary: 'Papara yatırımı 2 saattir bekliyor',
    });
    expect(sameDay.history.items).toEqual([]);

    // The next day: the day closed, a chat of its own, nothing earlier today,
    // yesterday one row.
    await owner.thread.update({
      where: { id: threadIds[1]! },
      data: { active: false, closedAt: new Date(now - 0.5 * HOUR) },
    });
    await owner.chat.update({ where: { id: chatId }, data: { active: false } });
    const tomorrow = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [{ at: new Date(now + DAY - 3 * HOUR), groupId: finance }],
    });

    const nextDay = (await read(tomorrow.chatId)).json;
    expect(nextDay.today).toEqual([]);
    expect(nextDay.history.items).toHaveLength(1);
    expect(nextDay.history.items[0]).toMatchObject({
      accessible: true,
      chat_id: chatId,
      // A day is named by its newest connection.
      thread_id: threadIds[1],
      started_at: firstAt.toISOString(),
      ended_at: new Date(now - 0.5 * HOUR).toISOString(),
      connections_count: 2,
      teams: [{ id: Number(finance), name: 'Finans' }],
      tags: ['acil', 'yatirim'],
      // The newest connection that has a summary, card or rating speaks for the day.
      summary: 'Yatırım hesaba geçmedi',
      outcome: 'handed_off',
      rating: 'bad',
    });
    expect(nextDay.history.items[0]!.ai_handoff?.summary).toBe(
      'Papara yatırımı 2 saattir bekliyor',
    );
  });

  it('shows another team’s day as a restricted row — date and topic only, never its summary, tags or card (FR-MOD-02.4.1–.6 · NFR-S5)', async () => {
    const customerId = await player(fx.a, { name: 'Ada' });
    const now = Date.now();
    const secret = await seedDay(fx.a, {
      customerId,
      groupIds: [rg],
      connections: [
        {
          at: new Date(now - 3 * DAY),
          closedAt: new Date(now - 3 * DAY + HOUR),
          assigneeId: fx.a.ownerAccountId,
          groupId: rg,
          summary: 'KENDINI-SINIRLAMA-TALEBI',
          tags: ['oz-dislama'],
          outcome: 'handed_off',
          rating: 'good',
          card: 'GIZLI-DEVIR-KARTI',
        },
      ],
    });
    const mine = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [
        {
          at: new Date(now - 2 * DAY),
          closedAt: new Date(now - 2 * DAY + HOUR),
          groupId: finance,
          summary: 'Çekim onaylandı',
        },
      ],
    });
    const { chatId } = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [{ at: new Date(now - HOUR), groupId: finance }],
    });

    const { status, body, json } = await read(chatId);
    expect(status).toBe(200);
    expect(json.history.items.map((row) => row.accessible)).toEqual([true, false]);
    expect(json.history.items[0]).toMatchObject({
      chat_id: mine.chatId,
      summary: 'Çekim onaylandı',
    });
    expect(json.history.items[1]).toEqual({
      accessible: false,
      chat_id: null,
      thread_id: null,
      started_at: new Date(now - 3 * DAY).toISOString(),
      // Not how long it lasted, either.
      ended_at: null,
      connections_count: null,
      assignee: null,
      teams: [],
      topics: ['responsible_gambling'],
      tags: [],
      summary: null,
      outcome: null,
      rating: null,
      ai_handoff: null,
    });
    expect(json.restricted_count).toBe(1);
    // Nowhere in the body: not its summary, tag, card, team name, or its ids.
    for (const hidden of [
      'KENDINI-SINIRLAMA-TALEBI',
      'oz-dislama',
      'GIZLI-DEVIR-KARTI',
      'Sorumlu Oyun',
      secret.chatId,
      secret.threadIds[0]!,
    ]) {
      expect(body, hidden).not.toContain(hidden);
    }
    // The day itself stays closed to them too.
    expect((await server.get(`/chats/${secret.chatId}/events`, agent)).statusCode).toBe(404);

    // Whoever may see every chat sees it whole, and nothing is restricted.
    const all = (await read(chatId, founder)).json;
    expect(all.restricted_count).toBe(0);
    expect(all.history.items[1]).toMatchObject({
      accessible: true,
      chat_id: secret.chatId,
      summary: 'KENDINI-SINIRLAMA-TALEBI',
      tags: ['oz-dislama'],
      rating: 'good',
    });
    expect(all.history.items[1]!.ai_handoff?.summary).toBe('GIZLI-DEVIR-KARTI');

    // Joined in person (a transfer), the day opens for the agent.
    await owner.chatUser.create({
      data: { chatId: secret.chatId, userId: fx.a.agentAccountId, userType: 'agent' },
    });
    const joined = (await read(chatId)).json;
    expect(joined.restricted_count).toBe(0);
    expect(joined.history.items[1]).toMatchObject({ accessible: true, chat_id: secret.chatId });
  });

  it('lists at most the newest 20 of the day’s other connections', async () => {
    const now = Date.now();
    const connections: ConnectionSeed[] = Array.from({ length: 23 }, (_, i) => ({
      at: new Date(now - (24 - i) * 10 * 60_000),
      closedAt: new Date(now - (24 - i) * 10 * 60_000 + 60_000),
    }));
    connections.push({ at: new Date(now - 60_000) });
    const { chatId, threadIds } = await seedDay(fx.a, {
      customerId: await player(fx.a),
      groupIds: [finance],
      connections,
    });

    const today = (await read(chatId)).json.today;
    // 23 earlier connections; the newest 20, newest first, the open one not among them.
    expect(today.map((row) => row.thread_id)).toEqual(threadIds.slice(3, 23).reverse());
  });

  it('is a 404 for a chat the agent may not see, another workspace’s, and the widget’s own token (NFR-S5)', async () => {
    const now = Date.now();
    const other = await seedDay(fx.a, {
      customerId: await player(fx.a),
      groupIds: [rg],
      connections: [{ at: new Date(now - HOUR) }],
    });
    expect((await read(other.chatId)).status).toBe(404);

    const elsewhere = await seedDay(fx.b, {
      customerId: await player(fx.b),
      connections: [{ at: new Date(now - HOUR) }],
    });
    expect((await read(elsewhere.chatId, founder)).status).toBe(404);
    expect((await read(elsewhere.chatId)).status).toBe(404);

    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const visitor = bearer((minted.json() as { token: string }).token);
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'merhaba', url: `https://${fx.a.trustedDomain}/` },
      visitor,
    );
    expect(sent.statusCode, sent.body).toBe(201);
    const own = (sent.json() as { chat_id: string }).chat_id;
    // A customer token on an agent route is a 404 (auth plugin I4).
    expect((await read(own, visitor)).status).toBe(404);

    expect((await read(generateShortId())).status).toBe(404);
  });

  it('masks the email and username for a caller without customers.contact.view, in the prose around them too (FR-MOD-04.RBAC)', async () => {
    const hide: CapabilityOverride = {
      role: 'agent',
      capability: 'customers.contact.view',
      value: 'off',
    };
    const put = await server.put(
      '/settings/permissions',
      { changes: [hide], reason: 'Oyuncu verisi yalnız yöneticilerde' },
      founder,
    );
    expect(put.statusCode, put.body).toBe(200);

    const EMAIL = 'Gizli.Oyuncu+331@example.test';
    const USERNAME = 'GizliOyuncu331';
    const customerId = await player(fx.a, { name: 'Ada', email: EMAIL, username: USERNAME });
    const note = await owner.customFieldDefinition.create({
      data: {
        licenseId: fx.a.licenseId,
        entity: 'contact',
        label: 'Not',
        type: 'text',
        formPlacement: 'pre_chat',
      },
      select: { id: true },
    });
    await owner.customFieldValue.create({
      data: {
        licenseId: fx.a.licenseId,
        definitionId: note.id,
        customerId,
        value: `hesabım ${USERNAME.toLowerCase()}`,
      },
    });
    const now = Date.now();
    const { chatId } = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [
        {
          at: new Date(now - 3 * HOUR),
          closedAt: new Date(now - 2 * HOUR),
          groupId: finance,
          summary: `${EMAIL} adresine yazıldı`,
          card: `${USERNAME} yatırımı bekliyor`,
        },
        { at: new Date(now - HOUR), groupId: finance },
      ],
    });

    const masked = await read(chatId);
    expect(masked.status).toBe(200);
    expect(masked.json.contact_visible).toBe(false);
    expect(masked.json.customer).toMatchObject({ name: 'Ada', email: null, username: null });
    const lower = masked.body.toLowerCase();
    expect(lower).not.toContain(EMAIL.toLowerCase());
    expect(lower).not.toContain(USERNAME.toLowerCase());
    expect(masked.json.pre_chat).toEqual([{ label: 'Not', value: 'hesabım •••' }]);
    expect(masked.json.today[0]!.summary).toBe('••• adresine yazıldı');
    expect(masked.json.today[0]!.ai_handoff?.summary).toBe('••• yatırımı bekliyor');

    // The Kurucu's column is locked on: the same card, whole.
    const whole = (await read(chatId, founder)).json;
    expect(whole.contact_visible).toBe(true);
    expect(whole.customer).toMatchObject({ email: EMAIL, username: USERNAME });
    expect(whole.today[0]!.summary).toBe(`${EMAIL} adresine yazıldı`);
  });

  it('pages 90 days of history 20 at a time, ties included, with a cursor that names no chat', async () => {
    const customerId = await player(fx.a);
    const now = Date.now();
    const { chatId } = await seedDay(fx.a, {
      customerId,
      groupIds: [finance],
      connections: [{ at: new Date(now - HOUR) }],
    });
    const expected: string[] = [];
    const closedDay = (daysAgo: number, groupIds: bigint[], extra: Partial<DaySeed> = {}) =>
      seedDay(fx.a, {
        customerId,
        groupIds,
        connections: [
          { at: new Date(now - daysAgo * DAY), closedAt: new Date(now - daysAgo * DAY + HOUR) },
        ],
        ...extra,
      });
    // Days 1–19 ago, every fourth one another team's.
    for (let d = 1; d <= 19; d += 1) {
      expected.push((await closedDay(d, d % 4 === 0 ? [rg] : [finance])).chatId);
    }
    // Three chats opened in the same instant, from before days were kept,
    // straddling the page boundary — the tie the cursor has to count through.
    const tieAt = new Date(now - 20 * DAY);
    const ties: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ties.push((await closedDay(20, [finance], { noDay: true, createdAt: tieAt })).chatId);
    }
    expected.push(...ties.sort().reverse());
    for (let d = 21; d <= 23; d += 1) expected.push((await closedDay(d, [rg])).chatId);
    // Older than the window: never listed, never counted.
    await closedDay(95, [rg]);

    const first = await read(chatId, founder);
    expect(first.status).toBe(200);
    expect(first.json.history.items).toHaveLength(20);
    const pageId = first.json.history.next_page_id;
    expect(pageId).toBeDefined();
    // The cursor is a time and a count — no chat id rides in it.
    const decoded = JSON.parse(Buffer.from(pageId!, 'base64url').toString('utf8')) as object;
    expect(Object.keys(decoded).sort()).toEqual(['at', 'seen']);
    for (const id of expected) expect(pageId!.includes(id)).toBe(false);

    const second = await read(chatId, founder, pageId);
    expect(second.status).toBe(200);
    expect(second.json.history.next_page_id).toBeUndefined();
    const ids = [...first.json.history.items, ...second.json.history.items].map(
      (row) => row.chat_id,
    );
    expect(ids).toEqual(expected);

    // The Team Member reads the same rows in the same order; the other team's
    // are restricted, and counted over the whole window, not the page.
    const mine = await read(chatId);
    const rest = await read(chatId, agent, mine.json.history.next_page_id);
    const rows = [...mine.json.history.items, ...rest.json.history.items];
    expect(rows.map((row) => row.started_at)).toEqual(
      [...first.json.history.items, ...second.json.history.items].map((row) => row.started_at),
    );
    expect(rows.filter((row) => !row.accessible)).toHaveLength(4 + 3);
    expect(mine.json.restricted_count).toBe(7);
    expect(rest.json.restricted_count).toBe(7);

    // A cursor this read did not write is refused, not read as a first page.
    for (const bad of ['nope', Buffer.from('{"at":1}').toString('base64url')]) {
      expect((await read(chatId, founder, bad)).status).toBe(400);
    }
  });
});
