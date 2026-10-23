/**
 * Message text search: `search_events` (ID-07 · tm 333.2; migration
 * 20261023120000_search_events).
 *
 * The function runs as the owner of `events`, which row level security does
 * not apply to — that is what lets its LIKE reach the trigram index — so every
 * guard RLS and `chatVisibilityFilter` would have applied lives inside it, and
 * this file is what holds each one in place:
 *
 *   - the tenant: another workspace's messages never come back, take no place
 *     on a page and count toward no cap; a licence that is not the
 *     transaction's tenant, or no tenant at all, is refused;
 *   - who sees what: unrestricted, through a team, or personally in the
 *     conversation as an agent — the three ways `services/chat/access.ts`
 *     grants one; every NULL closes, a customer-shaped call finds nothing, and
 *     the cap counts only what the caller may see;
 *   - internal notes only when asked for, system lines never;
 *   - the words: case and Turkish letters folded, every word required in any
 *     order, LIKE's own characters literal, unsearchable queries refused;
 *   - the dates: the last 90 days by default, `[from, to)`, at most 400 days;
 *   - one row per conversation (newest match + count) and millisecond keyset
 *     pages with no gap and no repeat;
 *   - a card number masked on the way in is not found by its digits;
 *   - no search runs without a statement timeout of at most 30 s armed by the
 *     caller (the function cannot time itself out);
 *   - the catalogue entry (definer, pinned path, EXECUTE for `siyahtus_app`
 *     only) and the plan inside it (the trigram index serves the LIKE).
 *
 * Every bound is checked at its edge against the `MESSAGE_SEARCH_*` constants
 * the API validates with (`@siyahtus/types`), so the two cannot drift apart.
 *
 * Called the way the API will call it (tm 333.3): as `siyahtus_app`, inside
 * `withTenant`. Rows are written as the owner, one statement each, so what is
 * under test is the read.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateShortId,
  MESSAGE_SEARCH_DEFAULT_DAYS,
  MESSAGE_SEARCH_MATCH_CAP,
  MESSAGE_SEARCH_MAX_DAYS,
  MESSAGE_SEARCH_MAX_PAGE_SIZE,
  MESSAGE_SEARCH_MAX_STATEMENT_TIMEOUT_MS,
  MESSAGE_SEARCH_MAX_WORDS,
  MESSAGE_SEARCH_PAGE_SIZE,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Hit {
  chat_id: string;
  thread_id: string;
  event_id: string;
  created_at: Date;
  recipients: string;
  text: string;
  match_count: number;
  chat_count: number;
}

interface Caller {
  unrestricted: boolean | null;
  groupIds: bigint[] | null;
  actorId: string | null;
  includeNotes: boolean | null;
}

interface Search extends Partial<Caller> {
  query: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number | null;
  cursor?: { at: Date; id: string } | null;
}

interface Conversation {
  chatId: string;
  threadId: string;
}

function sqlStateOf(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const code = (error.meta as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

async function failureOf(query: PromiseLike<unknown>): Promise<unknown> {
  try {
    await query;
  } catch (error) {
    return error;
  }
  throw new Error('expected the search to be refused, and it ran');
}

/** The call, every parameter cast so a NULL is still the right type. */
function searchSql(license: bigint | null, caller: Caller, s: Search): Prisma.Sql {
  const groups = caller.groupIds === null ? null : `{${caller.groupIds.join(',')}}`;
  return Prisma.sql`
    SELECT * FROM search_events(
      ${license}::bigint, ${s.query}::text,
      ${s.from ?? null}::timestamptz, ${s.to ?? null}::timestamptz,
      ${caller.unrestricted}::boolean, ${groups}::bigint[], ${caller.actorId}::text,
      ${caller.includeNotes}::boolean, ${s.limit ?? null}::integer,
      ${s.cursor?.at ?? null}::timestamptz, ${s.cursor?.id ?? null}::text
    )`;
}

describe('search_events — message text search (ID-07 · tm 333.2)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;

  beforeAll(() => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await app.$disconnect();
    await owner.$disconnect();
  });

  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });

  /**
   * A statement as the API will run it: the runtime role, the tenant set, a
   * statement timeout armed before the call (the function's precondition).
   */
  function asApi<T>(t: TenantFixture, sql: Prisma.Sql, timeout: string | null = '10s'): Promise<T> {
    return withTenant(app, ctx(t), async (tx) => {
      if (timeout !== null) {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeout}'`);
      }
      return tx.$queryRaw<T>(sql);
    });
  }

  /** A search, the licence named as the transaction's own unless told otherwise. */
  function search(
    t: TenantFixture,
    caller: Caller,
    s: Search,
    license: bigint | null = t.licenseId,
  ): Promise<Hit[]> {
    return asApi<Hit[]>(t, searchSql(license, caller, s));
  }

  async function conversation(
    t: TenantFixture,
    opts: { customerId: string; groups?: bigint[]; agents?: string[]; customerInChat?: boolean },
  ): Promise<Conversation> {
    const chatId = generateShortId();
    const threadId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: opts.customerId, active: false },
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
    if (opts.customerInChat) {
      await owner.chatUser.create({
        data: { chatId, userId: opts.customerId, userType: 'customer' },
      });
    }
    return { chatId, threadId };
  }

  /** One event, id shaped as the service mints it (`<thread_id>_<sequence>`). */
  async function message(
    t: TenantFixture,
    c: Conversation,
    seq: number,
    text: string,
    at: Date | Prisma.Sql,
    opts: { type?: string; recipients?: string; authorType?: string } = {},
  ): Promise<string> {
    const id = `${c.threadId}_${seq}`;
    const createdAt = at instanceof Date ? Prisma.sql`${at}::timestamptz` : at;
    await owner.$executeRaw`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type,
                          recipients, created_at)
      VALUES (${id}, ${c.threadId}, ${c.chatId}, ${t.licenseId}, ${opts.type ?? 'message'},
              ${text}, ${opts.authorType ?? 'customer'}, ${opts.recipients ?? 'all'}, ${createdAt})`;
    return id;
  }

  describe('one workspace, three teams of visibility', () => {
    let fx: Fixtures;
    let finance: bigint;
    let rg: bigint;
    let bTeam: bigint;
    let player: string;
    let fin: Conversation;
    let rgOnly: Conversation;
    let joined: Conversation;
    let players: Conversation;
    let old: Conversation;
    let turkish: Conversation;
    let escapes: Conversation;
    let inB: Conversation;
    const ids: Record<string, string> = {};
    const now = Date.now();
    const ago = (ms: number) => new Date(now - ms);

    /** Every chat in the licence, the founder's view. */
    let founder: Caller;
    /** A Team Member in Finance (RL-02 `team`). */
    let member: Caller;

    beforeAll(async () => {
      fx = await seedFixtures(owner);
      const team = async (t: TenantFixture, name: string) =>
        (
          await owner.group.create({
            data: { licenseId: t.licenseId, name },
            select: { id: true },
          })
        ).id;
      finance = await team(fx.a, 'Finans');
      rg = await team(fx.a, 'Sorumlu Oyun');
      bTeam = await team(fx.b, 'Finans B');
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: finance, agentId: fx.a.agentAccountId },
      });
      player = fx.a.customerId;

      founder = {
        unrestricted: true,
        groupIds: [],
        actorId: fx.a.ownerAccountId,
        includeNotes: true,
      };
      member = {
        unrestricted: false,
        groupIds: [finance],
        actorId: fx.a.agentAccountId,
        includeNotes: true,
      };

      fin = await conversation(fx.a, { customerId: player, groups: [finance] });
      ids['fin.player'] = await message(
        fx.a,
        fin,
        1,
        'Papara ile 5000 TL gönderdim, hâlâ gelmedi',
        ago(2 * HOUR),
      );
      ids['fin.system'] = await message(fx.a, fin, 2, 'papara 5000 sistem satırı', ago(HOUR), {
        type: 'system_message',
        authorType: 'system',
      });
      ids['fin.reversed'] = await message(
        fx.a,
        fin,
        3,
        '5000 lira, sonra da Papara',
        ago(40 * MINUTE),
      );
      ids['fin.note'] = await message(
        fx.a,
        fin,
        4,
        'Not: Papara 5000 TL dekontu istendi',
        ago(30 * MINUTE),
        { recipients: 'agents', authorType: 'agent' },
      );

      rgOnly = await conversation(fx.a, { customerId: player, groups: [rg] });
      ids['rg'] = await message(fx.a, rgOnly, 1, 'Papara 5000 RG ekibinde', ago(3 * HOUR));

      joined = await conversation(fx.a, {
        customerId: player,
        groups: [rg],
        agents: [fx.a.agentAccountId],
      });
      ids['joined'] = await message(fx.a, joined, 1, 'Papara 5000 kişisel katılım', ago(4 * HOUR));

      players = await conversation(fx.a, {
        customerId: player,
        groups: [rg],
        customerInChat: true,
      });
      ids['players'] = await message(
        fx.a,
        players,
        1,
        'Papara 5000 oyuncunun kendi sohbeti',
        ago(5 * HOUR),
      );

      old = await conversation(fx.a, { customerId: player, groups: [finance] });
      ids['old'] = await message(fx.a, old, 1, 'Papara 5000 eski kayıt', ago(100 * DAY));

      // A day inside and a day outside the default window, one conversation each.
      for (const [name, days] of [
        ['edgeIn', MESSAGE_SEARCH_DEFAULT_DAYS - 1],
        ['edgeOut', MESSAGE_SEARCH_DEFAULT_DAYS + 1],
      ] as const) {
        const c = await conversation(fx.a, { customerId: player, groups: [finance] });
        ids[name] = await message(fx.a, c, 1, `sinirkelime ${name}`, ago(days * DAY));
      }

      turkish = await conversation(fx.a, { customerId: player, groups: [finance] });
      ids['turkish'] = await message(
        fx.a,
        turkish,
        1,
        'İSTANBUL şubesine çağrı bıraktım',
        ago(6 * HOUR),
      );

      // Each decoy is what the unescaped pattern would also match, and is the
      // newer line of its pair — so a lost escape changes which message a
      // search names, not just how many it counts.
      escapes = await conversation(fx.a, { customerId: player, groups: [finance] });
      const lines: Array<[string, string]> = [
        ['percentDecoy', '1000 bonus kampanyası'],
        ['percent', '100% bonus kampanyası'],
        ['underscoreDecoy', 'userxname alanı dolu'],
        ['underscore', 'user_name alanı boş'],
        ['backslashDecoy', 'dosya C:yedek klasöründe'],
        ['backslash', 'dosya C:\\yedek klasöründe'],
      ];
      for (const [index, [name, text]] of lines.entries()) {
        ids[name] = await message(fx.a, escapes, index + 1, text, ago(7 * HOUR + index * MINUTE));
      }

      inB = await conversation(fx.b, { customerId: fx.b.customerId, groups: [bTeam] });
      ids['b'] = await message(fx.b, inB, 1, 'Papara ile 5000 TL gönderdim', ago(HOUR));
    });

    const eventIds = (hits: Hit[]) => hits.map((hit) => hit.event_id);
    const chatIds = (hits: Hit[]) => hits.map((hit) => hit.chat_id).sort();

    describe('the tenant', () => {
      it('never returns another workspace’s message, and each sees its own (NFR-S4)', async () => {
        const inA = await search(fx.a, founder, { query: 'papara 5000' });
        expect(inA.map((hit) => hit.chat_id)).not.toContain(inB.chatId);
        expect(eventIds(inA)).not.toContain(ids['b']);

        const bFounder: Caller = { ...founder, actorId: fx.b.ownerAccountId };
        expect(eventIds(await search(fx.b, bFounder, { query: 'papara 5000' }))).toEqual([
          ids['b'],
        ]);
        // B's team id handed to a search in A opens nothing in either workspace:
        // what is left is the conversation the person was in.
        expect(
          chatIds(await search(fx.a, { ...member, groupIds: [bTeam] }, { query: 'papara 5000' })),
        ).toEqual([joined.chatId]);
      });

      it('another workspace’s newer match takes no place on a page (NFR-S4)', async () => {
        // B's match is an hour old: newer than every conversation here but the
        // first, so it would be second on this page if it were read at all.
        expect(
          (await search(fx.a, founder, { query: 'papara 5000', limit: 2 })).map(
            (hit) => hit.chat_id,
          ),
        ).toEqual([fin.chatId, rgOnly.chatId]);
      });

      it('refuses a licence that is not the transaction’s tenant, and a missing one (NFR-S4)', async () => {
        expect(
          sqlStateOf(await failureOf(search(fx.a, founder, { query: 'papara' }, fx.b.licenseId))),
        ).toBe('42501');
        expect(sqlStateOf(await failureOf(search(fx.a, founder, { query: 'papara' }, null)))).toBe(
          '42501',
        );
      });

      it('refuses a caller that set no tenant at all (NFR-S4)', async () => {
        const failure = await failureOf(
          app.$transaction((tx) =>
            tx.$queryRaw(searchSql(fx.a.licenseId, founder, { query: 'papara' })),
          ),
        );
        expect(sqlStateOf(failure)).toBe('42501');
      });
    });

    describe('who sees which conversation', () => {
      it('an unrestricted caller finds every conversation of the workspace', async () => {
        expect(chatIds(await search(fx.a, founder, { query: 'papara 5000' }))).toEqual(
          [fin.chatId, rgOnly.chatId, joined.chatId, players.chatId].sort(),
        );
      });

      it('a team member finds their team’s and the ones they were in, not another team’s', async () => {
        expect(chatIds(await search(fx.a, member, { query: 'papara 5000' }))).toEqual(
          [fin.chatId, joined.chatId].sort(),
        );
      });

      it('`own` (no team) finds only the conversations the person was in', async () => {
        expect(
          chatIds(await search(fx.a, { ...member, groupIds: [] }, { query: 'papara 5000' })),
        ).toEqual([joined.chatId]);
      });

      it('a customer-shaped call finds nothing, not even the customer’s own conversation', async () => {
        const customer: Caller = {
          unrestricted: false,
          groupIds: [],
          actorId: player,
          includeNotes: false,
        };
        expect(await search(fx.a, customer, { query: 'papara 5000' })).toEqual([]);
      });

      it('every NULL closes: no flag, no team list and no actor see nothing', async () => {
        const nothing: Caller = {
          unrestricted: null,
          groupIds: null,
          actorId: null,
          includeNotes: null,
        };
        expect(await search(fx.a, nothing, { query: 'papara 5000' })).toEqual([]);
        expect(
          await search(fx.a, { ...nothing, groupIds: [rg], actorId: null }, { query: 'kişisel' }),
        ).toHaveLength(1);
      });
    });

    describe('one row per conversation', () => {
      it('names the newest match and counts them; notes only when asked, system lines never', async () => {
        const [withNotes] = await search(fx.a, founder, { query: 'papara 5000', limit: 1 });
        expect(withNotes).toEqual({
          chat_id: fin.chatId,
          thread_id: fin.threadId,
          event_id: ids['fin.note'],
          created_at: ago(30 * MINUTE),
          recipients: 'agents',
          text: 'Not: Papara 5000 TL dekontu istendi',
          // The player's line, the reversed one and the note — not the system line.
          match_count: 3,
          // fin, rgOnly, joined, players (tm 333.3).
          chat_count: 4,
        });

        const [withoutNotes] = await search(
          fx.a,
          { ...founder, includeNotes: false },
          { query: 'papara 5000', limit: 1 },
        );
        expect(withoutNotes).toMatchObject({
          chat_id: fin.chatId,
          event_id: ids['fin.reversed'],
          recipients: 'all',
          match_count: 2,
        });

        const everything = await search(fx.a, founder, { query: 'sistem satırı' });
        expect(everything).toEqual([]);
      });

      it('counts the conversations of every page, among those the caller may see (tm 333.3)', async () => {
        for (const caller of [founder, member, { ...founder, includeNotes: false }]) {
          const all = await search(fx.a, caller, { query: 'papara 5000' });
          expect(all.length).toBeGreaterThan(0);
          const first = await search(fx.a, caller, { query: 'papara 5000', limit: 1 });
          const last = all.at(-1)!;
          const tail = await search(fx.a, caller, {
            query: 'papara 5000',
            limit: 1,
            cursor: {
              at: all.at(-2)?.created_at ?? last.created_at,
              id: all.at(-2)?.event_id ?? '',
            },
          });
          for (const row of [...all, ...first, ...tail]) expect(row.chat_count).toBe(all.length);
        }
        // The team member's count leaves out the conversation of another team.
        const founderCount = (await search(fx.a, founder, { query: 'papara 5000' }))[0]?.chat_count;
        const memberCount = (await search(fx.a, member, { query: 'papara 5000' }))[0]?.chat_count;
        expect(memberCount).toBeLessThan(founderCount ?? 0);
      });

      it('orders conversations by their newest match', async () => {
        expect(
          (await search(fx.a, founder, { query: 'papara 5000' })).map((hit) => hit.chat_id),
        ).toEqual([fin.chatId, rgOnly.chatId, joined.chatId, players.chatId]);
      });
    });

    describe('the words', () => {
      it('finds "papara 5000" in "Papara ile 5000 TL", and the words in either order', async () => {
        const hits = await search(
          fx.a,
          { ...founder, includeNotes: false },
          { query: 'papara 5000', from: ago(150 * MINUTE), to: ago(35 * MINUTE) },
        );
        expect(hits).toHaveLength(1);
        expect(hits[0]).toMatchObject({ event_id: ids['fin.reversed'], match_count: 2 });
        expect(
          eventIds(
            await search(fx.a, founder, {
              query: '  PAPARA\tile\n5000  ',
              from: ago(3 * HOUR),
              to: ago(HOUR),
            }),
          ),
        ).toEqual([ids['fin.player']]);
      });

      it('is case- and Turkish-letter-insensitive both ways', async () => {
        for (const query of [
          'istanbul',
          'İSTANBUL',
          'İstanbul'.toLowerCase(),
          'Istanbul',
          'cagri',
          'ÇAĞRI',
          'çağrı subesine',
        ]) {
          expect(eventIds(await search(fx.a, founder, { query })), query).toEqual([ids['turkish']]);
        }
      });

      it('reads %, _ and \\ as themselves', async () => {
        const find = async (query: string) =>
          (await search(fx.a, founder, { query })).map((hit) => [hit.event_id, hit.match_count]);
        expect(await find('100%')).toEqual([[ids['percent'], 1]]);
        expect(await find('user_name')).toEqual([[ids['underscore'], 1]]);
        expect(await find('c:\\yedek')).toEqual([[ids['backslash'], 1]]);
        // The decoys are there, and found by their own words.
        expect(await find('userxname')).toEqual([[ids['underscoreDecoy'], 1]]);
        expect(await find('1000 bonus')).toEqual([[ids['percentDecoy'], 1]]);
        expect(await find('c:yedek')).toEqual([[ids['backslashDecoy'], 1]]);
      });

      it('counts a repeated word once', async () => {
        expect(
          eventIds(
            await search(fx.a, founder, {
              query:
                'İstanbul istanbul ISTANBUL istanbul istanbul istanbul istanbul istanbul çağrı',
            }),
          ),
        ).toEqual([ids['turkish']]);
      });

      it('refuses a query the index cannot narrow, too many words, too many bytes, or none', async () => {
        const words = (count: number) =>
          Array.from({ length: count }, (_, index) => `kelime${index}`).join(' ');
        for (const query of [
          'ab',
          '   ',
          'a b c',
          'İŞ',
          'a.b',
          words(MESSAGE_SEARCH_MAX_WORDS + 1),
          `papara ${'x'.repeat(1000)}`,
          null,
        ]) {
          const failure = await failureOf(search(fx.a, founder, { query }));
          expect(sqlStateOf(failure), String(query).slice(0, 40)).toBe('22023');
        }
        expect(await search(fx.a, founder, { query: words(MESSAGE_SEARCH_MAX_WORDS) })).toEqual([]);
      });
    });

    describe('the dates', () => {
      it('looks back 90 days unless told otherwise', async () => {
        // A day inside the default window and a day outside it.
        expect(eventIds(await search(fx.a, founder, { query: 'sinirkelime' }))).toEqual([
          ids['edgeIn'],
        ]);
        expect(eventIds(await search(fx.a, founder, { query: 'eski kayıt' }))).toEqual([]);
        expect(
          eventIds(await search(fx.a, founder, { query: 'eski kayıt', from: ago(120 * DAY) })),
        ).toEqual([ids['old']]);
        // `to` alone moves the 90 days with it.
        expect(
          eventIds(await search(fx.a, founder, { query: 'eski kayıt', to: ago(30 * DAY) })),
        ).toEqual([ids['old']]);
      });

      it('includes `from` and excludes `to`', async () => {
        const at = ago(100 * DAY);
        expect(
          eventIds(await search(fx.a, founder, { query: 'eski kayıt', from: at, to: ago(DAY) })),
        ).toEqual([ids['old']]);
        expect(
          eventIds(
            await search(fx.a, founder, { query: 'eski kayıt', from: ago(101 * DAY), to: at }),
          ),
        ).toEqual([]);
      });

      it('refuses more than 400 days, an empty or reversed range, and infinity', async () => {
        const at = new Date();
        const cases: Array<[Date, Date]> = [
          [new Date(at.getTime() - (MESSAGE_SEARCH_MAX_DAYS * DAY + 1)), at],
          [at, at],
          [at, new Date(at.getTime() - DAY)],
        ];
        for (const [from, to] of cases) {
          expect(
            sqlStateOf(await failureOf(search(fx.a, founder, { query: 'papara', from, to }))),
          ).toBe('22023');
        }
        expect(
          await search(fx.a, founder, {
            query: 'papara',
            from: new Date(at.getTime() - MESSAGE_SEARCH_MAX_DAYS * DAY),
            to: at,
          }),
        ).not.toHaveLength(0);
        const infinite = await failureOf(
          asApi(
            fx.a,
            Prisma.sql`SELECT * FROM search_events(${fx.a.licenseId}::bigint, 'papara',
              '-infinity'::timestamptz, NULL, true, '{}', NULL, true, 50, NULL, NULL)`,
          ),
        );
        expect(sqlStateOf(infinite)).toBe('22023');
      });
    });

    describe('the page', () => {
      let paging: Conversation[];

      beforeAll(async () => {
        paging = [];
        // Seven conversations a minute apart, then two whose newest match falls
        // in the same millisecond — 100 and 700 microseconds into it — so the
        // millisecond key ties and the id decides. JavaScript cannot hold either
        // instant; a key with the microseconds in it would put a cursor that
        // came back through a `Date` between the two.
        const tied = new Date(Date.now() - 20 * MINUTE);
        for (let index = 0; index < 9; index += 1) {
          const c = await conversation(fx.a, { customerId: player, groups: [finance] });
          paging.push(c);
          const at =
            index < 7
              ? ago((index + 1) * MINUTE)
              : Prisma.sql`${tied}::timestamptz + ${index === 7 ? '100 microseconds' : '700 microseconds'}::interval`;
          await message(fx.a, c, 1, `zebrakelime sayfa ${index}`, at);
          if (index % 3 === 0) {
            await message(fx.a, c, 2, `zebrakelime eski ${index}`, ago(2 * DAY));
          }
        }
      });

      it('returns created_at to the millisecond, and every page continues without a gap or a repeat', async () => {
        const all = await search(fx.a, member, {
          query: 'zebrakelime',
          limit: MESSAGE_SEARCH_MAX_PAGE_SIZE,
        });
        expect(all).toHaveLength(9);
        expect(new Set(all.map((hit) => hit.chat_id)).size).toBe(9);
        expect(all.slice(0, 7).map((hit) => hit.chat_id)).toEqual(
          paging.slice(0, 7).map((c) => c.chatId),
        );
        // The tied pair: same millisecond, ordered by event id, newest key first.
        expect(all[7]!.created_at.getTime()).toBe(all[8]!.created_at.getTime());
        expect(all[7]!.event_id > all[8]!.event_id).toBe(true);

        for (const size of [1, 2, 4]) {
          const pages: Hit[] = [];
          let cursor: { at: Date; id: string } | null = null;
          for (let guard = 0; guard < 20; guard += 1) {
            const page: Hit[] = await search(fx.a, member, {
              query: 'zebrakelime',
              limit: size,
              cursor,
            });
            pages.push(...page);
            if (page.length < size) break;
            const last = page.at(-1)!;
            // Through JSON and back, as a page token will travel.
            cursor = {
              at: new Date(JSON.parse(JSON.stringify(last.created_at)) as string),
              id: last.event_id,
            };
          }
          expect(pages, `page size ${size}`).toEqual(all);
        }
      });

      it('holds 50 conversations unless asked for another size', async () => {
        for (let index = 0; index <= MESSAGE_SEARCH_PAGE_SIZE; index += 1) {
          const c = await conversation(fx.a, { customerId: player, groups: [finance] });
          await message(fx.a, c, 1, `gecekelime ${index}`, ago(3 * DAY + index * MINUTE));
        }
        expect(await search(fx.a, founder, { query: 'gecekelime' })).toHaveLength(
          MESSAGE_SEARCH_PAGE_SIZE,
        );
        expect(
          await search(fx.a, founder, { query: 'gecekelime', limit: MESSAGE_SEARCH_PAGE_SIZE + 1 }),
        ).toHaveLength(MESSAGE_SEARCH_PAGE_SIZE + 1);
      });

      it('refuses a page size outside 1..100 and half a cursor', async () => {
        for (const limit of [0, MESSAGE_SEARCH_MAX_PAGE_SIZE + 1]) {
          expect(
            sqlStateOf(await failureOf(search(fx.a, founder, { query: 'zebrakelime', limit }))),
          ).toBe('22023');
        }
        const half = await failureOf(
          asApi(
            fx.a,
            Prisma.sql`SELECT * FROM search_events(${fx.a.licenseId}::bigint, 'zebrakelime',
              NULL, NULL, true, '{}', NULL, true, 50, now(), NULL)`,
          ),
        );
        expect(sqlStateOf(half)).toBe('22023');
      });
    });

    describe('the statement timeout', () => {
      const run = (timeout: string | null) =>
        asApi<Hit[]>(fx.a, searchSql(fx.a.licenseId, founder, { query: 'papara 5000' }), timeout);

      it('refuses to run without one, or with one longer than 30 s', async () => {
        // The pooled connection's own default is no timeout at all.
        for (const timeout of [null, '0', `${MESSAGE_SEARCH_MAX_STATEMENT_TIMEOUT_MS + 1}ms`]) {
          expect(sqlStateOf(await failureOf(run(timeout))), String(timeout)).toBe('55000');
        }
        expect(await run(`${MESSAGE_SEARCH_MAX_STATEMENT_TIMEOUT_MS}ms`)).not.toHaveLength(0);
      });
    });
  });

  describe('the cap: at most 20 000 visible matches are read', () => {
    let fx: Fixtures;
    let member: Caller;
    let founder: Caller;
    let mine: Conversation;

    /** `count` messages saying `word`, the newest a second old; one statement. */
    async function bulk(t: TenantFixture, c: Conversation, word: string, count: number) {
      await owner.$executeRaw`
        INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, created_at)
        SELECT ${c.threadId} || '_' || g, ${c.threadId}, ${c.chatId}, ${t.licenseId},
               'message', ${word} || ' ' || g, 'customer',
               date_trunc('milliseconds', now()) - make_interval(secs => g::double precision)
        FROM generate_series(1, ${count}::int) AS g`;
    }

    beforeAll(async () => {
      fx = await seedFixtures(owner);
      const finance = (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name: 'Finans' },
          select: { id: true },
        })
      ).id;
      const rg = (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name: 'Sorumlu Oyun' },
          select: { id: true },
        })
      ).id;
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: finance, agentId: fx.a.agentAccountId },
      });
      founder = {
        unrestricted: true,
        groupIds: [],
        actorId: fx.a.ownerAccountId,
        includeNotes: true,
      };
      member = {
        unrestricted: false,
        groupIds: [finance],
        actorId: fx.a.agentAccountId,
        includeNotes: true,
      };

      // Exactly the cap in Finance's conversation, one more in a conversation
      // Finance cannot open: the founder reads one past the cap, the member the cap.
      const visible = await conversation(fx.a, { customerId: fx.a.customerId, groups: [finance] });
      await bulk(fx.a, visible, 'kapakelime', MESSAGE_SEARCH_MATCH_CAP);
      const hidden = await conversation(fx.a, { customerId: fx.a.customerId, groups: [rg] });
      await message(fx.a, hidden, 1, 'kapakelime gizli', new Date(Date.now() - HOUR));

      // One match here, more than the cap in the other workspace.
      mine = await conversation(fx.a, { customerId: fx.a.customerId, groups: [finance] });
      await message(fx.a, mine, 1, 'tenantkelime burada', new Date(Date.now() - HOUR));
      const bTeam = (
        await owner.group.create({
          data: { licenseId: fx.b.licenseId, name: 'Finans B' },
          select: { id: true },
        })
      ).id;
      const theirs = await conversation(fx.b, { customerId: fx.b.customerId, groups: [bTeam] });
      await bulk(fx.b, theirs, 'tenantkelime', MESSAGE_SEARCH_MATCH_CAP + 1);
    });

    it('refuses a search that would read more than the cap, whichever page it asks for', async () => {
      expect(sqlStateOf(await failureOf(search(fx.a, founder, { query: 'kapakelime' })))).toBe(
        '54000',
      );
      // A page past every match is empty, and still refused.
      const beyond = { at: new Date(Date.now() - 80 * DAY), id: 'zzzz' };
      expect(
        sqlStateOf(await failureOf(search(fx.a, founder, { query: 'kapakelime', cursor: beyond }))),
      ).toBe('54000');
    });

    it('counts only what the caller may see, and answers exactly at the cap', async () => {
      const [hit] = await search(fx.a, member, { query: 'kapakelime' });
      expect(hit?.match_count).toBe(MESSAGE_SEARCH_MATCH_CAP);
      expect(hit?.text).toBe('kapakelime 1');
    });

    it('another workspace’s matches are neither read nor counted (NFR-S4)', async () => {
      expect(
        (await search(fx.a, founder, { query: 'tenantkelime' })).map((hit) => [
          hit.chat_id,
          hit.match_count,
        ]),
      ).toEqual([[mine.chatId, 1]]);
    });
  });

  describe('a card number masked on the way in', () => {
    let server: TestServer;
    let fx: Fixtures;

    beforeAll(async () => {
      server = await startTestServer();
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
      // Routing, so the widget's first message opens a conversation.
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: group.id, agentId: fx.a.agentAccountId },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: group.id,
        },
      });
    });

    afterAll(async () => {
      await server.close();
    });

    it('is not found by its clear digits; the message is found by what was kept', async () => {
      const minted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      expect(minted.statusCode).toBe(200);
      const sent = await server.post(
        '/customer/chat/events',
        { text: 'kartım 4111 1111 1111 1111 ile yatırdım geçmedi' },
        { authorization: `Bearer ${(minted.json() as { token: string }).token}` },
      );
      expect(sent.statusCode).toBe(201);

      const founder: Caller = {
        unrestricted: true,
        groupIds: [],
        actorId: fx.a.ownerAccountId,
        includeNotes: true,
      };
      for (const query of ['4111111111111111', '4111 1111 1111 1111', '4111']) {
        expect(await search(fx.a, founder, { query }), query).toEqual([]);
      }
      const [kept] = await search(fx.a, founder, { query: 'kartım 1111 geçmedi' });
      expect(kept?.text).toBe('kartım **** **** **** 1111 ile yatırdım geçmedi');
    });
  });

  describe('the catalogue entry', () => {
    it('is SECURITY DEFINER with a pinned path, owned like events, executable by siyahtus_app only', async () => {
      const rows = await owner.$queryRaw<
        Array<{
          definer: boolean;
          volatility: string;
          config: string[] | null;
          ownedLikeEvents: boolean;
          publicCan: boolean;
          appCan: boolean;
          result: string;
          appCreatesInPublic: boolean;
        }>
      >`
        SELECT p.prosecdef AS definer,
               p.provolatile::text AS volatility,
               p.proconfig AS config,
               p.proowner = (SELECT relowner FROM pg_class WHERE oid = 'public.events'::regclass)
                 AS "ownedLikeEvents",
               has_function_privilege('public', p.oid, 'EXECUTE') AS "publicCan",
               has_function_privilege('siyahtus_app', p.oid, 'EXECUTE') AS "appCan",
               pg_get_function_result(p.oid) AS result,
               has_schema_privilege('siyahtus_app', 'public', 'CREATE') AS "appCreatesInPublic"
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'search_events'`;
      expect(rows).toEqual([
        {
          definer: true,
          volatility: 's',
          config: ['search_path=public, pg_temp'],
          ownedLikeEvents: true,
          publicCan: false,
          appCan: true,
          // Only what a result needs — no author, no properties, no customer.
          result:
            'TABLE(chat_id text, thread_id text, event_id text, created_at timestamp with time zone, recipients text, text text, match_count integer, chat_count integer)',
          // Nothing the runtime role creates can shadow a name the definer resolves.
          appCreatesInPublic: false,
        },
      ]);
    });
  });

  describe('the plan inside the function', () => {
    interface PlanNode {
      'Node Type': string;
      'Index Name'?: string;
      'Index Cond'?: string;
      'Relation Name'?: string;
      Plans?: PlanNode[];
    }
    const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];

    let fx: Fixtures;

    beforeAll(async () => {
      fx = await seedFixtures(owner);
      const c = await conversation(fx.a, { customerId: fx.a.customerId });
      // Enough rows in the current month that reading it is the expensive plan;
      // one statement, because the read is the point.
      await owner.$executeRaw`
        INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_type, created_at)
        SELECT ${c.threadId} || '_' || g, ${c.threadId}, ${c.chatId}, ${fx.a.licenseId}, 'message',
               'Merhaba, hesabıma para yatırdım ' || g || '. sipariş bekliyorum', 'customer',
               date_trunc('month', now()) + make_interval(secs => g::double precision)
        FROM generate_series(1, 20000) AS g`;
      await message(
        fx.a,
        c,
        20001,
        'Papara ile 5000 TL gönderdim',
        Prisma.sql`date_trunc('month', now()) + interval '6 hours'`,
      );
      // Statistics now, not whenever autovacuum gets to it: under gate load the
      // planner otherwise plans these rows as an empty table.
      await owner.$executeRawUnsafe('ANALYZE events');
    });

    it('serves the LIKE from the trigram index of the month it reads', async () => {
      // auto_explain with nested statements is the only window onto the plan of
      // a statement a function runs; LOAD needs the owner role of the test
      // database (a superuser in development and CI).
      const client = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
      await client.connect();
      const logged: string[] = [];
      client.on('notice', (notice) => logged.push(notice.message ?? ''));
      try {
        await client.query(`LOAD 'auto_explain'`);
        await client.query('SET auto_explain.log_min_duration = 0');
        await client.query('SET auto_explain.log_nested_statements = on');
        await client.query('SET auto_explain.log_format = json');
        await client.query('SET client_min_messages = log');
        await client.query('BEGIN');
        await client.query(`SET LOCAL statement_timeout = '10s'`);
        await client.query(`SELECT set_config('app.current_license', $1, true)`, [
          fx.a.licenseId.toString(),
        ]);
        // The whole current month and nothing else, whatever the day of the month.
        const { rows } = await client.query<{ event_id: string }>(
          `SELECT event_id FROM search_events($1, 'papara 5000',
             date_trunc('month', now()), date_trunc('month', now()) + interval '1 month',
             true, '{}', NULL, true, 50, NULL, NULL)`,
          [fx.a.licenseId.toString()],
        );
        await client.query('COMMIT');
        expect(rows).toHaveLength(1);
      } finally {
        await client.end();
      }

      const plans = logged
        .map((line) => line.slice(line.indexOf('{')))
        .filter((json) => json.startsWith('{'))
        .map((json) => JSON.parse(json) as { 'Query Text': string; Plan: PlanNode })
        .filter((entry) => entry['Query Text'].includes('WITH hits AS'));
      expect(plans, logged.join('\n').slice(0, 2000)).toHaveLength(1);
      const nodes = flatten(plans[0]!.Plan);

      const [current] = await owner.$queryRaw<Array<{ name: string }>>`
        SELECT format('events_%s', to_char(now() AT TIME ZONE 'UTC', 'YYYY_MM')) AS name`;
      const trigram = nodes.filter((node) => node['Node Type'] === 'Bitmap Index Scan');
      expect(
        trigram.map((node) => node['Index Name']),
        JSON.stringify(plans[0]!.Plan, null, 1).slice(0, 4000),
      ).toContain(`${current!.name}_text_search_idx`);
      for (const node of trigram) expect(node['Index Cond']).toMatch(/~~/);
      expect(
        nodes.filter(
          (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === current!.name,
        ),
      ).toEqual([]);
    });
  });
});
