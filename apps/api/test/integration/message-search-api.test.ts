/**
 * Message text search over HTTP (ID-07 · tm 333.3): `GET /chats?query=` and
 * `GET /search?types=message`, the API half of `search_events`
 * (`services/chat/event-search.ts`).
 *
 * The function's own guards are pinned by `search-events.test.ts`; this file
 * holds what the API adds and what an agent sees:
 *
 *   - "papara 5000" finds "Papara ile 5000 TL", case and Turkish letters
 *     folded ("İSTANBUL" finds "istanbul"), `%` and `_` literal;
 *   - only conversations the caller may open — another team's is not listed,
 *     one they joined personally is — and never another workspace's;
 *   - internal notes for agents, marked; a customer token never reaches it;
 *   - the last 90 days unless dates are given, at most 400;
 *   - each item is a list row plus `match` (snippet, highlights, count), the
 *     total counts matching conversations, pages chain without gap or repeat;
 *   - a card number masked on the way in is not found by its digits;
 *   - the rules and combinations are 400s naming the reason, a query matching
 *     past the cap is `too_broad`, a budget per account;
 *   - the transaction's statement timeout is put back after the search;
 *   - the request log masks `query`.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  capabilitiesForRole,
  generateShortId,
  MESSAGE_SEARCH_MATCH_CAP,
  MESSAGE_SEARCH_MAX_PAGE_SIZE,
  type MessageSearchMatch,
  type SearchResult,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import type { Principal } from '../../src/services/auth/principal.js';
import { searchChatsInTenant } from '../../src/services/chat/chat-service.js';
import { MESSAGE_SEARCHES_PER_MINUTE } from '../../src/services/chat/event-search.js';
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

interface Item {
  id: string;
  customer_name: string | null;
  thread_id: string | null;
  match?: MessageSearchMatch;
}

interface Page {
  items: Item[];
  total: number;
  next_page_id?: string;
}

interface Conversation {
  chatId: string;
  threadId: string;
}

class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
}

describe('message text search over HTTP (ID-07 · tm 333.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agent: Headers;
  let founder: Headers;
  let founderB: Headers;
  let finance: bigint;
  let rg: bigint;
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms);
  const ids: Record<string, Conversation> = {};
  const events: Record<string, string> = {};

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

  async function conversation(
    t: TenantFixture,
    opts: { name: string; groups?: bigint[]; agents?: string[] },
  ): Promise<Conversation> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: opts.name },
      select: { id: true },
    });
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: customer.id,
        active: false,
        lastEventAt: new Date(now - DAY),
      },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: false, closedAt: new Date() },
    });
    for (const groupId of opts.groups ?? []) {
      await owner.chatAccess.create({ data: { chatId, groupId } });
    }
    for (const userId of opts.agents ?? []) {
      await owner.chatUser.create({ data: { chatId, userId, userType: 'agent' } });
    }
    return { chatId, threadId };
  }

  async function message(
    t: TenantFixture,
    c: Conversation,
    seq: number,
    text: string,
    at: Date,
    opts: { recipients?: string; authorType?: string } = {},
  ): Promise<string> {
    const id = `${c.threadId}_${seq}`;
    await owner.$executeRaw`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type,
                          recipients, created_at)
      VALUES (${id}, ${c.threadId}, ${c.chatId}, ${t.licenseId}, 'message', ${text},
              ${opts.authorType ?? 'customer'}, ${opts.recipients ?? 'all'}, ${at}::timestamptz)`;
    return id;
  }

  async function search(
    query: string,
    auth: Headers = founder,
    extra = '',
  ): Promise<{ status: number; body: Page & { error?: { details?: { reason?: string } } } }> {
    const res = await server.get(`/chats?query=${encodeURIComponent(query)}${extra}`, auth);
    return { status: res.statusCode, body: res.json() };
  }

  const chatIds = (page: Page) => page.items.map((item) => item.id);

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    const team = async (name: string) =>
      (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name },
          select: { id: true },
        })
      ).id;
    finance = await team('Finans');
    rg = await team('Sorumlu Oyun');
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: finance, agentId: fx.a.agentAccountId },
    });
    agent = await token(fx.a, fx.a.agentAccountId, ['chats--access:ro']);
    founder = await token(fx.a, fx.a.ownerAccountId, ['chats--all:ro']);
    founderB = await token(fx.b, fx.b.ownerAccountId, ['chats--all:ro']);

    ids['fin'] = await conversation(fx.a, { name: 'Finans Oyuncu', groups: [finance] });
    events['fin'] = await message(
      fx.a,
      ids['fin'],
      1,
      'Merhaba, dün akşam Papara ile 5000 TL yatırdım ama bakiyeme geçmedi',
      ago(2 * HOUR),
    );
    ids['note'] = await conversation(fx.a, { name: 'Not Oyuncu', groups: [finance] });
    events['note.player'] = await message(fx.a, ids['note'], 1, 'para gelmedi', ago(3 * HOUR));
    events['note'] = await message(
      fx.a,
      ids['note'],
      2,
      'papara 5000 dekontu kontrol edildi',
      ago(30 * MINUTE),
      { recipients: 'agents', authorType: 'agent' },
    );
    ids['rg'] = await conversation(fx.a, { name: 'RG Oyuncu', groups: [rg] });
    events['rg'] = await message(fx.a, ids['rg'], 1, 'Papara 5000 RG ekibinde', ago(HOUR));
    ids['joined'] = await conversation(fx.a, {
      name: 'Katılım Oyuncu',
      agents: [fx.a.agentAccountId],
    });
    events['joined'] = await message(
      fx.a,
      ids['joined'],
      1,
      'PAPARA 5000 kişisel katılım',
      ago(4 * HOUR),
    );
    ids['old'] = await conversation(fx.a, { name: 'Eski Oyuncu', groups: [finance] });
    events['old'] = await message(fx.a, ids['old'], 1, 'Papara 5000 eski kayıt', ago(100 * DAY));
    ids['turkish'] = await conversation(fx.a, { name: 'Şehir Oyuncu', groups: [finance] });
    events['turkish'] = await message(
      fx.a,
      ids['turkish'],
      1,
      "istanbul'dan yazıyorum, çağrı merkezine ulaşamadım",
      ago(5 * HOUR),
    );
    ids['percent'] = await conversation(fx.a, { name: 'Yüzde Oyuncu', groups: [finance] });
    events['percent'] = await message(fx.a, ids['percent'], 1, 'bonus 100% doğru', ago(6 * HOUR));
    ids['decoy'] = await conversation(fx.a, { name: 'Tuzak Oyuncu', groups: [finance] });
    events['decoy'] = await message(
      fx.a,
      ids['decoy'],
      1,
      'bonus 1000 doğru userXname',
      ago(6 * HOUR),
    );
    ids['underscore'] = await conversation(fx.a, { name: 'Alt Çizgi', groups: [finance] });
    events['underscore'] = await message(
      fx.a,
      ids['underscore'],
      1,
      'hata user_name alanında',
      ago(7 * HOUR),
    );
    ids['b'] = await conversation(fx.b, { name: 'B Oyuncu' });
    events['b'] = await message(fx.b, ids['b'], 1, 'Papara ile 5000 TL gönderdim', ago(HOUR));
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  // =========================================================================

  it('finds "Papara ile 5000 TL" for "papara 5000", newest match first, every visible conversation', async () => {
    const { status, body } = await search('papara 5000');
    expect(status).toBe(200);
    expect(chatIds(body)).toEqual([
      ids['note']!.chatId,
      ids['rg']!.chatId,
      ids['fin']!.chatId,
      ids['joined']!.chatId,
    ]);
    expect(body.total).toBe(4);
    expect(body.next_page_id).toBeUndefined();

    const fin = body.items.find((item) => item.id === ids['fin']!.chatId);
    expect(fin?.customer_name).toBe('Finans Oyuncu');
    expect(fin?.match).toEqual({
      event_id: events['fin'],
      thread_id: ids['fin']!.threadId,
      created_at: ago(2 * HOUR).toISOString(),
      snippet: 'Merhaba, dün akşam Papara ile 5000 TL yatırdım ama bakiyeme geçmedi',
      highlights: [
        { start: 19, end: 25 },
        { start: 30, end: 34 },
      ],
      match_count: 1,
      internal: false,
    });
    const snippet = fin!.match!.snippet;
    expect(fin!.match!.highlights.map((h) => snippet.slice(h.start, h.end))).toEqual([
      'Papara',
      '5000',
    ]);
  });

  it('lists a team member only what they may open: their team, and a conversation they joined (NFR-S4)', async () => {
    const { status, body } = await search('papara 5000', agent);
    expect(status).toBe(200);
    expect(chatIds(body)).toEqual([ids['note']!.chatId, ids['fin']!.chatId, ids['joined']!.chatId]);
    expect(chatIds(body)).not.toContain(ids['rg']!.chatId);
    expect(body.total).toBe(3);
  });

  it("never returns another workspace's messages (NFR-S4)", async () => {
    const a = await search('papara 5000');
    expect(chatIds(a.body)).not.toContain(ids['b']!.chatId);
    const b = await search('papara 5000', founderB);
    expect(b.status).toBe(200);
    expect(chatIds(b.body)).toEqual([ids['b']!.chatId]);
    expect(b.body.total).toBe(1);
  });

  it('searches internal notes for agents and marks them; a customer token never reaches the search', async () => {
    const { body } = await search('dekontu kontrol', agent);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.match).toMatchObject({ event_id: events['note'], internal: true });

    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    const customer = bearer((minted.json() as { token: string }).token);
    const res = await server.get(`/chats?query=${encodeURIComponent('papara 5000')}`, customer);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('papara');
  });

  it('folds case and Turkish letters: "İSTANBUL" finds "istanbul", "cagri" finds "çağrı"', async () => {
    for (const query of ['İSTANBUL', 'ISTANBUL', 'istanbul', 'cagri merkezi', 'ÇAĞRI']) {
      const { status, body } = await search(query);
      expect(status, query).toBe(200);
      expect(chatIds(body), query).toEqual([ids['turkish']!.chatId]);
    }
    const { body } = await search('İSTANBUL');
    const match = body.items[0]!.match!;
    expect(match.highlights.map((h) => match.snippet.slice(h.start, h.end))).toEqual(['istanbul']);
  });

  it('takes % and _ literally', async () => {
    expect(chatIds((await search('bonus 100%')).body)).toEqual([ids['percent']!.chatId]);
    expect(chatIds((await search('user_name')).body)).toEqual([ids['underscore']!.chatId]);
  });

  it('reads the last 90 days unless dates say otherwise, and at most 400', async () => {
    expect(chatIds((await search('eski kayıt')).body)).toEqual([]);
    const from = encodeURIComponent(ago(120 * DAY).toISOString());
    expect(chatIds((await search('eski kayıt', founder, `&date_from=${from}`)).body)).toEqual([
      ids['old']!.chatId,
    ]);
    const to = encodeURIComponent(ago(3 * HOUR).toISOString());
    // [from, to): the 2-hour-old message is after `to`, the 4-hour-old one inside.
    expect(chatIds((await search('papara 5000', founder, `&date_to=${to}`)).body)).toEqual([
      ids['joined']!.chatId,
    ]);

    const tooLong = encodeURIComponent(ago(401 * DAY).toISOString());
    const refused = await search('papara 5000', founder, `&date_from=${tooLong}`);
    expect(refused.status).toBe(400);
    expect(refused.body.error?.details?.reason).toBe('range_too_long');

    const reversed = await search('papara 5000', founder, `&date_from=${to}&date_to=${from}`);
    expect(reversed.status).toBe(400);
    expect(reversed.body.error?.details?.reason).toBe('range_order');

    const noQuery = await server.get(`/chats?date_from=${from}`, founder);
    expect(noQuery.statusCode).toBe(400);
    expect(
      (noQuery.json() as Page & { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('needs_query');
  });

  it('pages by the newest match without gap or repeat, the total the same on every page', async () => {
    const first = await search('papara 5000', founder, '&limit=3');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(3);
    expect(first.body.total).toBe(4);
    expect(first.body.next_page_id).toBeDefined();

    const second = await search(
      'papara 5000',
      founder,
      `&limit=3&page_id=${first.body.next_page_id}`,
    );
    expect(second.status).toBe(200);
    expect(second.body.total).toBe(4);
    expect(second.body.next_page_id).toBeUndefined();
    expect([...chatIds(first.body), ...chatIds(second.body)]).toEqual(
      chatIds((await search('papara 5000')).body),
    );

    // A list cursor is not a page of a search.
    const list = await server.get('/chats?limit=1', founder);
    const listCursor = (list.json() as Page).next_page_id;
    expect(listCursor).toBeDefined();
    const mixed = await search('papara 5000', founder, `&page_id=${listCursor}`);
    expect(mixed.status).toBe(400);
    expect(mixed.body.error?.details?.reason).toBe('invalid_page');
  });

  it('counts every matching message of a conversation and shows its newest', async () => {
    const extra = await message(
      fx.a,
      ids['fin']!,
      2,
      'papara 5000 tekrar soruyorum',
      ago(90 * MINUTE),
    );
    try {
      const { body } = await search('papara 5000');
      const fin = body.items.find((item) => item.id === ids['fin']!.chatId);
      expect(fin?.match).toMatchObject({ event_id: extra, match_count: 2 });
    } finally {
      await owner.$executeRaw`DELETE FROM events WHERE id = ${extra}`;
    }
  });

  it('refuses a query it cannot search, a filter it does not compose with, naming the reason', async () => {
    const cases: Array<[string, string, string]> = [
      ['ab', '', 'too_short'],
      ['a b c', '', 'no_trigram'],
      [Array.from({ length: 9 }, (_, i) => `kelime${i}`).join(' '), '', 'too_many_words'],
      ['papara 5000', '&view=archived', 'not_with_query'],
      ['papara 5000', '&sort=oldest', 'not_with_query'],
      ['papara 5000', '&channel=whatsapp', 'not_with_query'],
      ['papara 5000', `&group_id=${finance}`, 'not_with_query'],
      ['papara 5000', `&customer_id=${fx.a.customerId}`, 'not_with_query'],
    ];
    for (const [query, extra, reason] of cases) {
      const res = await search(query, founder, extra);
      expect(res.status, `${query}${extra}`).toBe(400);
      expect(res.body.error?.details?.reason, `${query}${extra}`).toBe(reason);
    }
    // A blank box is the list.
    const blank = await server.get('/chats?query=%20%20&limit=5', founder);
    expect(blank.statusCode).toBe(200);
    expect((blank.json() as Page).items.every((item) => item.match === undefined)).toBe(true);
  });

  it('finds nothing by the clear digits of a card masked on the way in', async () => {
    const group = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Destek' },
      select: { id: true },
    });
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: group.id },
    });
    const minted = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'kartım 4111 1111 1111 1111 ile yatırdım geçmedi' },
      { authorization: `Bearer ${(minted.json() as { token: string }).token}` },
    );
    expect(sent.statusCode).toBe(201);

    for (const query of ['4111111111111111', '4111 1111 1111 1111', 'kartım 4111']) {
      const { status, body } = await search(query);
      expect(status, query).toBe(200);
      expect(body.total, query).toBe(0);
    }
    const kept = await search('kartım geçmedi');
    expect(kept.body.items[0]?.match?.snippet).toBe(
      'kartım **** **** **** 1111 ile yatırdım geçmedi',
    );
  });

  it('answers GET /search types=message with one result per conversation, and leaves it out by default', async () => {
    const res = await server.get(
      `/search?query=${encodeURIComponent('papara 5000')}&types=message&limit=2`,
      agent,
    );
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: SearchResult[] }).items;
    expect(items).toEqual([
      {
        kind: 'message',
        chat_id: ids['note']!.chatId,
        thread_id: ids['note']!.threadId,
        event_id: events['note'],
        title: 'Not Oyuncu',
        subtitle: 'papara 5000 dekontu kontrol edildi',
        highlights: [
          { start: 0, end: 6 },
          { start: 7, end: 11 },
        ],
        at: ago(30 * MINUTE).toISOString(),
        matched_on: 'text',
      },
      expect.objectContaining({ kind: 'message', chat_id: ids['fin']!.chatId }),
    ]);

    const byDefault = await server.get(`/search?query=${encodeURIComponent('papara 5000')}`, agent);
    expect(byDefault.statusCode).toBe(200);
    expect((byDefault.json() as { items: SearchResult[] }).items).toEqual([]);

    const short = await server.get('/search?query=ab&types=message', agent);
    expect(short.statusCode).toBe(400);
    expect((short.json() as { error: { details: { reason: string } } }).error.details.reason).toBe(
      'too_short',
    );
  });

  it('puts the transaction’s statement timeout back after the search', async () => {
    const app = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    try {
      const principal: Principal = {
        kind: 'agent',
        accountId: fx.a.ownerAccountId,
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        role: 'owner',
        capabilities: capabilitiesForRole('owner', []),
        scopes: ['chats--all:ro'],
        tokenId: 'timeout-probe',
        tokenKind: 'pat',
      };
      const after = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '7s'`);
          const page = await searchChatsInTenant(tx, principal, {
            query: 'papara 5000',
            limit: 10,
          });
          expect(page.total).toBe(4);
          return tx.$queryRaw<Array<{ value: string }>>`
            SELECT current_setting('statement_timeout') AS value`;
        },
      );
      expect(after[0]?.value).toBe('7s');
    } finally {
      await app.$disconnect();
    }
  });

  it('answers within a second at p95 on seeded data', async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      const res = await search(i % 2 === 0 ? 'papara 5000' : 'İSTANBUL', agent);
      times.push(performance.now() - started);
      expect(res.status).toBe(200);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(1000);
  });

  it(`pages at the largest page size, ${MESSAGE_SEARCH_MAX_PAGE_SIZE}, with nothing to look ahead into`, async () => {
    const customer = await owner.customer.create({
      data: { organizationId: fx.b.organizationId, name: 'Sayfa Oyuncu' },
      select: { id: true },
    });
    const count = MESSAGE_SEARCH_MAX_PAGE_SIZE + 1;
    const pages = Array.from({ length: count }, () => ({
      chatId: generateShortId(),
      threadId: generateShortId(),
    }));
    await owner.chat.createMany({
      data: pages.map((c) => ({
        id: c.chatId,
        licenseId: fx.b.licenseId,
        customerId: customer.id,
        active: false,
      })),
    });
    await owner.thread.createMany({
      data: pages.map((c) => ({
        id: c.threadId,
        chatId: c.chatId,
        licenseId: fx.b.licenseId,
        active: false,
        closedAt: new Date(),
      })),
    });
    for (const [i, c] of pages.entries()) {
      await message(fx.b, c, 1, `sayfakelime ${i}`, ago(2 * HOUR + i * MINUTE));
    }

    const limit = `&limit=${MESSAGE_SEARCH_MAX_PAGE_SIZE}`;
    const first = await search('sayfakelime', founderB, limit);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(MESSAGE_SEARCH_MAX_PAGE_SIZE);
    expect(first.body.total).toBe(count);
    expect(first.body.next_page_id).toBeDefined();
    const second = await search(
      'sayfakelime',
      founderB,
      `${limit}&page_id=${first.body.next_page_id}`,
    );
    expect(second.status).toBe(200);
    expect(chatIds(second.body)).toEqual([pages.at(-1)!.chatId]);
    expect(second.body.total).toBe(count);
    expect(second.body.next_page_id).toBeUndefined();

    // Exactly one full page — `date_to` is exclusive, so the newest drops out:
    // no next page is offered.
    const to = encodeURIComponent(ago(2 * HOUR).toISOString());
    const exact = await search('sayfakelime', founderB, `${limit}&date_to=${to}`);
    expect(exact.status).toBe(200);
    expect(exact.body.items).toHaveLength(MESSAGE_SEARCH_MAX_PAGE_SIZE);
    expect(exact.body.total).toBe(MESSAGE_SEARCH_MAX_PAGE_SIZE);
    expect(exact.body.next_page_id).toBeUndefined();
  });

  it(`refuses a query matching more than ${MESSAGE_SEARCH_MATCH_CAP} messages as too broad`, async () => {
    const wide = await conversation(fx.b, { name: 'Geniş Oyuncu' });
    await owner.$executeRaw`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type,
                          recipients, created_at)
      SELECT ${wide.threadId} || '_' || g, ${wide.threadId}, ${wide.chatId}, ${fx.b.licenseId},
             'message', 'yayginkelime ' || g, 'customer', 'all',
             now() - g * interval '1 second'
      FROM generate_series(1, ${MESSAGE_SEARCH_MATCH_CAP + 1}) g`;
    const { status, body } = await search('yayginkelime', founderB);
    expect(status).toBe(400);
    expect(body.error?.details?.reason).toBe('too_broad');
    // A narrower question about the same messages answers.
    const narrow = await search('yayginkelime 777', founderB);
    expect(narrow.status).toBe(200);
    expect(chatIds(narrow.body)).toEqual([wide.chatId]);
  });

  it(`allows ${MESSAGE_SEARCHES_PER_MINUTE} searches a minute per account`, async () => {
    await clearRateLimits(server.app);
    const runner = await token(fx.b, fx.b.agentAccountId, ['chats--all:ro']);
    for (let i = 0; i < MESSAGE_SEARCHES_PER_MINUTE; i += 1) {
      expect((await search('gönderdim', runner)).status).toBe(200);
    }
    const res = await search('gönderdim', runner);
    expect(res.status).toBe(429);
    // A refused query spends nothing, so it is still a 400 rather than a 429.
    expect((await search('ab', runner)).status).toBe(400);
    await clearRateLimits(server.app);
  });

  it('is written to the request log as query=[redacted]', async () => {
    const sink = new LineSink();
    const logged = await startTestServer(
      { LOG_LEVEL: 'trace' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
    try {
      const typed = 'papara5000gizli';
      const res = await logged.get(`/chats?query=${typed}`, founder);
      expect(res.statusCode).toBe(200);
      const written = sink.lines.join('\n');
      expect(written).toContain('query=[redacted]');
      expect(written).not.toContain(typed);
    } finally {
      await logged.close();
    }
  });
});
