/**
 * The archive API (tm 335.1 · SiyahTuş analysis AR-01):
 * `GET /archive/conversations` and `GET /archive/conversations/{threadId}`.
 *
 * What is pinned here:
 *
 *   - a row is a connection: a player who wrote three times is three rows,
 *     each with its own tags, assignee, rating, risk flags and first message;
 *   - a resumed conversation leaves its earlier connection in the archive as
 *     it closed, and the close writes `handled_by`;
 *   - the most recently ended first, open ones on top only when asked for;
 *     the keyset hands out every row once, also across rows that closed in
 *     the same millisecond; `total` stops at the cap;
 *   - a Team Member sees their teams' conversations and the ones they were
 *     in, nothing else — another team's connection answers what a missing one
 *     answers, and so does another workspace's (NFR-S4 · NFR-S5);
 *   - a connection past the retention window is not listed, and its detail
 *     says why; an erased member has no rows;
 *   - the username follows `customers.contact.view`, the first message is
 *     masked and short;
 *   - the page is one statement served by the archive index under row level
 *     security.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ARCHIVE_FIRST_MESSAGE_MAX,
  ARCHIVE_TOTAL_CAP,
  generateShortId,
  type ArchiveConversation,
  type ArchiveConversationDetail,
  type ArchiveConversationList,
  type CapabilityOverride,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('the archive: one row per connection (AR-01 · tm 335.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let founder: Headers;
  let member: Headers;
  let finance: bigint;
  let rg: bigint;

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

  async function token(t: TenantFixture, ownerId: string, scopes: string[]): Promise<Headers> {
    return bearer(
      await grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId,
        scopes,
      }),
    );
  }

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
    finance = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Finans' },
        select: { id: true },
      })
    ).id;
    rg = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sorumlu Oyun' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: finance, agentId: fx.a.agentAccountId },
    });
    founder = await token(fx.a, fx.a.ownerAccountId, ['chats--all:rw', 'access_rules:rw']);
    // A Team Member of Finans: that team's conversations, and the ones they were in.
    member = await token(fx.a, fx.a.agentAccountId, ['chats--access:ro']);
  });

  async function player(
    t: TenantFixture,
    data: Partial<{ name: string; username: string }> = {},
  ): Promise<string> {
    const row = await owner.customer.create({
      data: { organizationId: t.organizationId, ...data },
      select: { id: true },
    });
    return row.id;
  }

  /** A day for `customerId`, visible to `groupIds`' teams. */
  async function day(
    t: TenantFixture,
    customerId: string,
    opts: { at: Date; groupIds?: bigint[]; agentIds?: string[] },
  ): Promise<string> {
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId,
        active: false,
        createdAt: opts.at,
        lastEventAt: opts.at,
      },
    });
    for (const groupId of opts.groupIds ?? []) {
      await owner.chatAccess.create({ data: { chatId, groupId } });
    }
    for (const userId of opts.agentIds ?? []) {
      await owner.chatUser.create({ data: { chatId, userId, userType: 'agent', present: false } });
    }
    return chatId;
  }

  /** One connection of `chatId`, closed at `closedAt` (open when null), with what it holds. */
  async function connection(
    t: TenantFixture,
    chatId: string,
    opts: {
      startedAt: Date;
      closedAt: Date | null;
      assigneeId?: string;
      groupId?: bigint;
      handledBy?: 'ai' | 'human' | 'mixed';
      messages?: Array<{ author: 'customer' | 'agent' | 'bot'; text: string; notes?: boolean }>;
    },
  ): Promise<string> {
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: opts.closedAt === null,
        createdAt: opts.startedAt,
        closedAt: opts.closedAt,
        ...(opts.assigneeId ? { assigneeId: opts.assigneeId } : {}),
        ...(opts.groupId !== undefined ? { groupId: opts.groupId } : {}),
        ...(opts.handledBy ? { handledBy: opts.handledBy } : {}),
      },
    });
    let n = 0;
    for (const message of opts.messages ?? []) {
      n += 1;
      await owner.event.create({
        data: {
          id: `${threadId}_${n}`,
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          text: message.text,
          authorType: message.author,
          recipients: message.notes ? 'agents' : 'all',
          createdAt: new Date(opts.startedAt.getTime() + n * MINUTE),
        },
      });
    }
    return threadId;
  }

  async function list(
    headers: Headers,
    query = '',
  ): Promise<{ status: number; body: ArchiveConversationList; raw: string }> {
    const res = await server.get(`/archive/conversations${query}`, headers);
    return { status: res.statusCode, body: res.json() as ArchiveConversationList, raw: res.body };
  }

  async function detail(
    headers: Headers,
    threadId: string,
  ): Promise<{
    status: number;
    body: ArchiveConversationDetail & { error?: { type: string; details?: { reason?: string } } };
  }> {
    const res = await server.get(`/archive/conversations/${threadId}`, headers);
    return { status: res.statusCode, body: res.json() };
  }

  const ids = (items: ArchiveConversation[]) => items.map((item) => item.thread_id);

  it('lists a player who wrote three times as three rows, each with its own tags, assignee, rating and first message (FR-MOD-02.8)', async () => {
    const now = Date.now();
    const id = await player(fx.a, { name: 'Üç Kez Yazan', username: 'uc_kez' });
    const bonus = await owner.tag.create({ data: { licenseId: fx.a.licenseId, name: 'bonus' } });
    const kyc = await owner.tag.create({ data: { licenseId: fx.a.licenseId, name: 'kyc' } });

    // Two connections on one day, a third the next day.
    const monday = await day(fx.a, id, { at: new Date(now - 2 * DAY), groupIds: [finance] });
    const tuesday = await day(fx.a, id, { at: new Date(now - DAY), groupIds: [finance] });
    const first = await connection(fx.a, monday, {
      startedAt: new Date(now - 2 * DAY),
      closedAt: new Date(now - 2 * DAY + 10 * MINUTE),
      assigneeId: fx.a.agentAccountId,
      groupId: finance,
      handledBy: 'human',
      messages: [
        { author: 'customer', text: 'Çekim talebim ne zaman onaylanır?' },
        { author: 'agent', text: 'Hemen bakıyorum.' },
        { author: 'agent', text: 'Kontrol ettim.', notes: true },
      ],
    });
    const second = await connection(fx.a, monday, {
      startedAt: new Date(now - 2 * DAY + HOUR),
      closedAt: new Date(now - 2 * DAY + HOUR + 5 * MINUTE),
      handledBy: 'ai',
      messages: [
        { author: 'customer', text: 'Bonus çevrim şartı nedir?' },
        { author: 'bot', text: 'Çevrim şartı 10 kattır.' },
      ],
    });
    const third = await connection(fx.a, tuesday, {
      startedAt: new Date(now - DAY),
      closedAt: new Date(now - DAY + 20 * MINUTE),
      assigneeId: fx.a.ownerAccountId,
      groupId: finance,
      handledBy: 'mixed',
      messages: [{ author: 'customer', text: 'Hesabımı doğrulamak istiyorum.' }],
    });
    await owner.threadTag.create({ data: { threadId: first, tagId: kyc.id } });
    await owner.threadTag.create({ data: { threadId: second, tagId: bonus.id } });
    await owner.rating.createMany({
      data: [
        // The newest of a connection's ratings is the one shown.
        {
          chatId: monday,
          licenseId: fx.a.licenseId,
          threadId: first,
          value: 'good',
          createdAt: new Date(now - 2 * DAY + 11 * MINUTE),
        },
        {
          chatId: monday,
          licenseId: fx.a.licenseId,
          threadId: first,
          value: 'bad',
          comment: 'Geç cevap',
          createdAt: new Date(now - 2 * DAY + 12 * MINUTE),
        },
        {
          chatId: tuesday,
          licenseId: fx.a.licenseId,
          threadId: third,
          value: 'good',
          createdAt: new Date(now - DAY + 21 * MINUTE),
        },
      ],
    });
    await owner.riskFlag.create({
      data: {
        licenseId: fx.a.licenseId,
        scope: 'chat',
        chatId: tuesday,
        threadId: third,
        type: 'fraud_suspected',
        severity: 'high',
        source: 'agent',
        raisedBy: fx.a.ownerAccountId,
      },
    });

    const { status, body } = await list(founder, `?customer_id=${id}`);
    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.total_capped).toBe(false);
    expect(body.next_page_id).toBeUndefined();
    // The most recently ended first.
    expect(ids(body.items)).toEqual([third, second, first]);

    const [t3, t2, t1] = body.items as [
      ArchiveConversation,
      ArchiveConversation,
      ArchiveConversation,
    ];
    expect(t1).toEqual({
      thread_id: first,
      chat_id: monday,
      customer: { id, name: 'Üç Kez Yazan', username: 'uc_kez' },
      started_at: new Date(now - 2 * DAY).toISOString(),
      ended_at: new Date(now - 2 * DAY + 10 * MINUTE).toISOString(),
      assignee: { id: fx.a.agentAccountId, name: expect.any(String) },
      group_ids: [Number(finance)],
      tags: [{ id: kyc.id, name: 'kyc' }],
      rating: { value: 'bad', has_comment: true },
      handled_by: 'human',
      risk_flags: [],
      first_customer_message: 'Çekim talebim ne zaman onaylanır?',
      message_count: 3,
    });
    // The same day, its own connection: no assignee, no rating, its own tag.
    expect(t2).toMatchObject({
      chat_id: monday,
      assignee: null,
      tags: [{ id: bonus.id, name: 'bonus' }],
      rating: null,
      handled_by: 'ai',
      // No team recorded on the connection: the day's teams.
      group_ids: [Number(finance)],
      first_customer_message: 'Bonus çevrim şartı nedir?',
      message_count: 2,
    });
    expect(t3).toMatchObject({
      chat_id: tuesday,
      assignee: { id: fx.a.ownerAccountId },
      tags: [],
      rating: { value: 'good', has_comment: false },
      risk_flags: ['fraud_suspected'],
      handled_by: 'mixed',
    });

    // The detail is the connection's own: the rating with its comment.
    const one = await detail(founder, first);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({
      thread_id: first,
      tags: [{ id: kyc.id, name: 'kyc' }],
      assignee: { id: fx.a.agentAccountId },
      rating: {
        value: 'bad',
        has_comment: true,
        comment: 'Geç cevap',
        rated_at: new Date(now - 2 * DAY + 12 * MINUTE).toISOString(),
      },
      summary: null,
    });
    expect((await detail(founder, second)).body.rating).toBeNull();
  });

  it('still finds the message a same-day return opened with, which the application stamps a few milliseconds before the thread row (FR-MOD-02.8)', async () => {
    const now = Date.now();
    const id = await player(fx.a, { name: 'Geri Dönen' });
    const chatId = await day(fx.a, id, { at: new Date(now - HOUR), groupIds: [finance] });
    const startedAt = new Date(now - 30 * MINUTE);
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: false,
        createdAt: startedAt,
        closedAt: new Date(startedAt.getTime() + 5 * MINUTE),
        groupId: finance,
      },
    });
    // 41 ms before the row's own `created_at`, as measured on the e2e stack.
    await owner.event.create({
      data: {
        id: `${threadId}_1`,
        threadId,
        chatId,
        licenseId: fx.a.licenseId,
        type: 'message',
        text: 'Yine ben, hesabımı kapatmak istiyorum',
        authorType: 'customer',
        recipients: 'all',
        createdAt: new Date(startedAt.getTime() - 41),
      },
    });

    const row = (await list(founder)).body.items.find((item) => item.thread_id === threadId);
    expect(row).toMatchObject({
      first_customer_message: 'Yine ben, hesabımı kapatmak istiyorum',
      message_count: 1,
    });
    expect((await detail(founder, threadId)).body).toMatchObject({ message_count: 1 });
  });

  it('keeps the connection a resume ended, writes handled_by as it closes, and lists open ones only when asked (FR-MOD-02.8)', async () => {
    const opened = await server.post(
      '/chats',
      { customer_id: fx.a.customerId, initial_event: { type: 'message', text: 'İlk ziyaret' } },
      founder,
    );
    expect(opened.statusCode, opened.body).toBe(201);
    const chat = opened.json() as { id: string; thread: { id: string } };
    const before = chat.thread.id;
    expect((await server.post(`/chats/${chat.id}/deactivate`, undefined, founder)).statusCode).toBe(
      200,
    );
    const resumed = await server.post(`/chats/${chat.id}/resume`, undefined, founder);
    expect(resumed.statusCode, resumed.body).toBe(200);
    const after = (resumed.json() as { thread: { id: string } }).thread.id;
    expect(after).not.toBe(before);

    // A person wrote and no bot did: `human`, written by the close.
    const stored = await owner.thread.findUniqueOrThrow({ where: { id: before } });
    expect(stored.handledBy).toBe('human');

    const closed = await list(founder);
    expect(ids(closed.body.items)).toEqual([before]);
    expect(closed.body.items[0]).toMatchObject({
      handled_by: 'human',
      ended_at: expect.any(String),
    });

    const all = await list(founder, '?status=all');
    expect(ids(all.body.items)).toEqual([after, before]);
    expect(all.body.items[0]).toMatchObject({ ended_at: null, handled_by: null });
    expect(ids((await list(founder, '?status=open')).body.items)).toEqual([after]);
  });

  it('shows a Team Member their teams’ and their own conversations only; another team’s and another workspace’s are absent (FR-MOD-02.8 · NFR-S4 · NFR-S5)', async () => {
    const now = Date.now();
    const id = await player(fx.a, { name: 'Görünürlük' });
    const ours = await connection(
      fx.a,
      await day(fx.a, id, { at: new Date(now - 3 * HOUR), groupIds: [finance] }),
      {
        startedAt: new Date(now - 3 * HOUR),
        closedAt: new Date(now - 3 * HOUR + MINUTE),
      },
    );
    const theirs = await connection(
      fx.a,
      await day(fx.a, id, { at: new Date(now - 2 * HOUR), groupIds: [rg] }),
      {
        startedAt: new Date(now - 2 * HOUR),
        closedAt: new Date(now - 2 * HOUR + MINUTE),
      },
    );
    // Another team's, but the member took part in it.
    const joined = await connection(
      fx.a,
      await day(fx.a, id, {
        at: new Date(now - HOUR),
        groupIds: [rg],
        agentIds: [fx.a.agentAccountId],
      }),
      { startedAt: new Date(now - HOUR), closedAt: new Date(now - HOUR + MINUTE) },
    );
    // Another workspace's.
    const elsewhere = await connection(
      fx.b,
      await day(fx.b, fx.b.customerId, { at: new Date(now - 30 * MINUTE) }),
      { startedAt: new Date(now - 30 * MINUTE), closedAt: new Date(now - 29 * MINUTE) },
    );

    const seen = await list(member);
    expect(seen.status).toBe(200);
    expect(ids(seen.body.items)).toEqual([joined, ours]);
    expect(seen.body.total).toBe(2);
    expect(seen.raw).not.toContain(theirs);
    expect(ids((await list(founder)).body.items)).toEqual([joined, theirs, ours]);

    // Another team's connection answers exactly what a missing one answers.
    const hidden = await server.get(`/archive/conversations/${theirs}`, member);
    const missing = await server.get(`/archive/conversations/${generateShortId()}`, member);
    const errorOf = (body: string) => {
      const { request_id: _id, ...rest } = (JSON.parse(body) as { error: Record<string, unknown> })
        .error;
      return rest;
    };
    expect(hidden.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(errorOf(hidden.body)).toEqual(errorOf(missing.body));
    expect((await detail(member, ours)).status).toBe(200);
    expect((await detail(member, joined)).status).toBe(200);

    // Another workspace: neither listed nor readable, even by its founder's peer here.
    expect(ids((await list(founder)).body.items)).not.toContain(elsewhere);
    expect((await detail(founder, elsewhere)).status).toBe(404);
    const theirFounder = await token(fx.b, fx.b.ownerAccountId, ['chats--all:ro']);
    expect(ids((await list(theirFounder)).body.items)).toEqual([elsewhere]);
    expect((await detail(theirFounder, ours)).status).toBe(404);
  });

  it('refuses a caller without a conversation scope, and a customer token never reaches it (NFR-S5)', async () => {
    const tickets = await token(fx.a, fx.a.ownerAccountId, ['tickets--all:ro']);
    expect((await server.get('/archive/conversations', tickets)).statusCode).toBe(403);

    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    const customer = bearer((minted.json() as { token: string }).token);
    expect((await server.get('/archive/conversations', customer)).statusCode).toBe(404);
  });

  it('pages newest-ended first, every row once — also rows that closed in the same millisecond (FR-MOD-02.8)', async () => {
    const now = Date.now();
    const id = await player(fx.a, { name: 'Sayfalı' });
    const chatId = await day(fx.a, id, { at: new Date(now - DAY) });
    const made: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      made.push(
        await connection(fx.a, chatId, {
          startedAt: new Date(now - DAY + i * MINUTE),
          closedAt: new Date(now - HOUR + i * MINUTE),
        }),
      );
    }
    // Pages of two, newest-ended first: three connections that closed at the
    // same instant (a page boundary falls between the second and the third —
    // only the id tie-break orders them), then three in one millisecond,
    // microseconds apart (a boundary falls after the newest — a cursor that
    // kept only milliseconds would skip the other two).
    const tied = new Date(now - 20 * MINUTE);
    for (const threadId of made.slice(3, 6)) {
      await owner.thread.update({ where: { id: threadId }, data: { closedAt: tied } });
    }
    const sameMs = new Date(now - 30 * MINUTE);
    for (const [k, threadId] of made.slice(0, 3).entries()) {
      await owner.$executeRaw`
        UPDATE threads SET closed_at = ${sameMs}::timestamptz + ${k * 100} * interval '1 microsecond'
        WHERE id = ${threadId}`;
    }

    const seen: string[] = [];
    let pageId: string | undefined;
    let pages = 0;
    do {
      const page = await list(founder, `?limit=2${pageId ? `&page_id=${pageId}` : ''}`);
      expect(page.status).toBe(200);
      expect(page.body.total).toBe(7);
      seen.push(...ids(page.body.items));
      pageId = page.body.next_page_id;
      pages += 1;
    } while (pageId && pages < 10);
    expect(pages).toBe(4);
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(made));

    const ordered = await owner.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM threads WHERE chat_id = ${chatId} ORDER BY closed_at DESC, id DESC`;
    expect(seen).toEqual(ordered.map((row) => row.id));

    expect((await list(founder, '?page_id=bm90LWEtY3Vyc29y')).status).toBe(400);
    expect((await list(founder, '?limit=101')).status).toBe(400);
    expect((await list(founder, '?status=deleted')).status).toBe(400);
  });

  it(`counts the list up to ${ARCHIVE_TOTAL_CAP} and says when there are more (FR-MOD-02.8)`, async () => {
    const id = await player(fx.a, { name: 'Çok' });
    const chatId = await day(fx.a, id, { at: new Date(Date.now() - DAY) });
    await owner.$executeRaw`
      INSERT INTO threads (id, chat_id, license_id, active, created_at, closed_at)
      SELECT 'C' || lpad(g::text, 9, '0'), ${chatId}, ${fx.a.licenseId}, false,
             now() - interval '1 day', now() - g * interval '1 second'
      FROM generate_series(1, ${ARCHIVE_TOTAL_CAP + 5}) g`;

    const { body } = await list(founder, '?limit=5');
    expect(body.items).toHaveLength(5);
    expect(body.total).toBe(ARCHIVE_TOTAL_CAP);
    expect(body.total_capped).toBe(true);
    expect(body.next_page_id).toEqual(expect.any(String));
  });

  it('leaves out a connection past the retention window and says so on its detail; an erased member has no rows (NFR-C8)', async () => {
    const now = Date.now();
    const id = await player(fx.a, { name: 'Eski' });
    const chatId = await day(fx.a, id, { at: new Date(now - 60 * DAY) });
    const expired = await connection(fx.a, chatId, {
      startedAt: new Date(now - 45 * DAY),
      closedAt: new Date(now - 45 * DAY + MINUTE),
    });
    const kept = await connection(fx.a, chatId, {
      startedAt: new Date(now - 10 * DAY),
      closedAt: new Date(now - 10 * DAY + MINUTE),
    });

    // The deployment default (365 days) keeps both.
    expect(ids((await list(founder)).body.items)).toEqual([kept, expired]);

    await owner.license.update({
      where: { id: fx.a.licenseId },
      data: { retentionThreadWindow: '30d' },
    });
    const listed = await list(founder);
    expect(ids(listed.body.items)).toEqual([kept]);
    expect(listed.body.total).toBe(1);
    const gone = await detail(founder, expired);
    expect(gone.status).toBe(404);
    expect(gone.body.error).toMatchObject({
      type: 'not_found',
      details: { reason: 'retention_expired' },
    });
    expect((await detail(founder, kept)).status).toBe(200);

    await owner.license.update({
      where: { id: fx.a.licenseId },
      data: { retentionThreadWindow: 'unlimited' },
    });
    expect(ids((await list(founder)).body.items)).toEqual([kept, expired]);

    // Erasure deletes the member and everything filed under them.
    const eraser = await token(fx.a, fx.a.ownerAccountId, ['customers.erase:rw']);
    const erased = await server.post(`/customers/${id}/erase`, undefined, eraser);
    expect(erased.statusCode, erased.body).toBe(200);
    expect((await list(founder)).body.items).toEqual([]);
    expect((await detail(founder, kept)).status).toBe(404);
  });

  it('hides the username without customers.contact.view; the first message is masked and short (FR-MOD-04.RBAC)', async () => {
    const now = Date.now();
    const id = await player(fx.a, { name: 'Gizli', username: 'gizli_335' });
    const long = `Kartım 4111 1111 1111 1111 ile yatırdım ${'ve bekliyorum '.repeat(20)}`;
    const threadId = await connection(
      fx.a,
      await day(fx.a, id, { at: new Date(now - HOUR), groupIds: [finance] }),
      {
        startedAt: new Date(now - HOUR),
        closedAt: new Date(now - HOUR + 10 * MINUTE),
        messages: [
          { author: 'agent', text: 'Merhaba, nasıl yardımcı olabilirim?' },
          { author: 'customer', text: long },
        ],
      },
    );

    const row = (await list(member)).body.items[0]!;
    expect(row.thread_id).toBe(threadId);
    expect(row.customer.username).toBe('gizli_335');
    const preview = row.first_customer_message!;
    expect(preview).toMatch(/^Kartım \*{4} \*{4} \*{4} 1111 ile yatırdım ve bekliyorum/);
    expect(preview).not.toContain('4111');
    expect(Array.from(preview).length).toBeLessThanOrEqual(ARCHIVE_FIRST_MESSAGE_MAX);
    expect(preview.endsWith('…')).toBe(true);

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
    const masked = await list(member);
    expect(masked.body.items[0]!.customer).toEqual({ id, name: 'Gizli', username: null });
    expect(masked.raw).not.toContain('gizli_335');
    expect((await detail(member, threadId)).body.customer.username).toBeNull();
    // The Founder's role is locked and still sees it.
    expect((await list(founder)).body.items[0]!.customer.username).toBe('gizli_335');
  });

  it('reads a page in one statement, from the archive index, under row level security', async () => {
    const appUrl = process.env['DATABASE_APP_URL'];
    expect(appUrl).toBeDefined();
    const id = await player(fx.a, { name: 'Plan' });
    // A day per connection, as a workspace has them: a skewed join (thousands
    // of connections on one day) is a plan nobody runs.
    await owner.$executeRaw`
      INSERT INTO chats (id, license_id, customer_id, active, created_at, last_event_at)
      SELECT 'Q' || lpad(g::text, 9, '0'), ${fx.a.licenseId}, ${id}::uuid, false,
             now() - interval '1 day', now() - interval '1 day'
      FROM generate_series(1, 3000) g`;
    await owner.$executeRaw`
      INSERT INTO threads (id, chat_id, license_id, active, created_at, closed_at)
      SELECT 'P' || lpad(g::text, 9, '0'), 'Q' || lpad(g::text, 9, '0'), ${fx.a.licenseId}, false,
             now() - interval '1 day', now() - g * interval '1 second'
      FROM generate_series(1, 3000) g`;
    await owner.$executeRaw`ANALYZE threads`;
    await owner.$executeRaw`ANALYZE chats`;

    const app = new PrismaClient({ datasources: { db: { url: appUrl! } } });
    try {
      const plan = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => {
          // A few thousand rows is a table the planner would rather scan and
          // sort; the question here is whether the index *serves the order* —
          // the timing at a million rows is measured apart (HANDOFF tm 335.1).
          await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
          await tx.$executeRawUnsafe('SET LOCAL enable_bitmapscan = off');
          return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
            `EXPLAIN SELECT t.id FROM threads t JOIN chats c ON c.id = t.chat_id
              WHERE t.license_id = ${fx.a.licenseId} AND t.closed_at IS NOT NULL
              ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`,
          );
        },
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');
      expect(text).toContain('Index Scan using threads_license_id_closed_at_id_idx on threads t');
      expect(text).not.toContain('Sort Key');
    } finally {
      await app.$disconnect();
    }

    // The route itself answers the first page fast at this size.
    const started = performance.now();
    const page = await list(founder);
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(50);
    expect(performance.now() - started).toBeLessThan(800);
  });
});
