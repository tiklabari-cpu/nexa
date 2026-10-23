/**
 * The archive filters (tm 336.1 · SiyahTuş analysis AR-02):
 * `GET /archive/conversations` narrowed by date, agent, team, rating, tag,
 * who answered, risk flag and channel.
 *
 * What is pinned here:
 *
 *   - a date is a day on the workspace's calendar, by when the connection
 *     started: 23:30 Istanbul is that day, 00:30 the next, and the start hour
 *     of the workspace's day moves the line;
 *   - tags combine as asked — any, all, exclude ("Hariç: spam"), untagged —
 *     and a filter is never more than 20 tags;
 *   - the rating is the connection's newest; "commented" means some text;
 *   - the agent filter is who wrote to the player, recorded at close and
 *     read live while open, an internal note not counted;
 *   - the team filter is the row's own teams, and never widens what a Team
 *     Member sees (NFR-S4);
 *   - "AI solved" over a range is the AI report's `resolutions` for it;
 *   - a cleared risk flag still finds its conversation; the channel is the
 *     inbox's definition;
 *   - filters AND together, values of one filter OR, `total` counts the
 *     filtered list and the keyset pages it;
 *   - date + team reads `threads` through an index under row level security.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  generateShortId,
  localDayKey,
  localDayStart,
  shiftDayKey,
  type ArchiveConversation,
  type ArchiveConversationList,
  type RiskFlagType,
} from '@siyahtus/types';
import { withTenant } from '../../src/lib/tenant.js';
import { handledBySql } from '../../src/services/billing/ai-resolution.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Days on the default workspace calendar (Europe/Istanbul, UTC+3 all year,
// from midnight), a few days back so retention never reaches them.
const D = localDayKey(new Date(Date.now() - 5 * DAY));
const D_BEFORE = shiftDayKey(D, -1);
const D_AFTER = shiftDayKey(D, 1);
/** `hh:mm` Istanbul time on day `key`. */
const istanbul = (key: string, hours: number, minutes = 0): Date =>
  new Date(localDayStart(key).getTime() + hours * HOUR + minutes * MINUTE);

describe('the archive filters (AR-02 · tm 336.1)', () => {
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
    founder = await token(fx.a, fx.a.ownerAccountId, ['chats--all:rw', 'reports_read']);
    // A Team Member of Finans: that team's conversations, and the ones they were in.
    member = await token(fx.a, fx.a.agentAccountId, ['chats--access:ro']);
  });

  async function player(t: TenantFixture = fx.a): Promise<string> {
    const row = await owner.customer.create({
      data: { organizationId: t.organizationId },
      select: { id: true },
    });
    return row.id;
  }

  /** A day for a new player, visible to `groupIds`' teams. */
  async function day(opts: { at: Date; groupIds?: bigint[]; t?: TenantFixture }): Promise<string> {
    const t = opts.t ?? fx.a;
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: await player(t),
        active: false,
        createdAt: opts.at,
        lastEventAt: opts.at,
      },
    });
    for (const groupId of opts.groupIds ?? []) {
      await owner.chatAccess.create({ data: { chatId, groupId } });
    }
    return chatId;
  }

  type Author = 'customer' | 'agent' | 'bot';

  /** One connection, on a day of its own unless `chatId` is given. */
  async function connection(opts: {
    startedAt: Date;
    closedAt?: Date | null;
    chatId?: string;
    groupId?: bigint;
    agentIds?: string[];
    handledBy?: 'ai' | 'human' | 'mixed';
    messages?: Array<{ author: Author; authorId?: string; notes?: boolean }>;
    t?: TenantFixture;
  }): Promise<string> {
    const t = opts.t ?? fx.a;
    const chatId = opts.chatId ?? (await day({ at: opts.startedAt, t }));
    const closedAt =
      opts.closedAt === undefined ? new Date(opts.startedAt.getTime() + HOUR) : opts.closedAt;
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: closedAt === null,
        createdAt: opts.startedAt,
        closedAt,
        ...(opts.groupId !== undefined ? { groupId: opts.groupId } : {}),
        ...(opts.agentIds ? { agentIds: opts.agentIds } : {}),
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
          text: `Mesaj ${n}`,
          authorType: message.author,
          authorId:
            message.authorId ?? (message.author === 'customer' ? 'customer' : message.author),
          recipients: message.notes ? 'agents' : 'all',
          createdAt: new Date(opts.startedAt.getTime() + n * MINUTE),
        },
      });
    }
    return threadId;
  }

  async function chatOf(threadId: string): Promise<string> {
    return (await owner.thread.findUniqueOrThrow({ where: { id: threadId } })).chatId;
  }

  async function list(
    headers: Headers,
    query = '',
  ): Promise<{
    status: number;
    body: ArchiveConversationList & { error?: { details?: { reason?: string } } };
  }> {
    const res = await server.get(`/archive/conversations${query}`, headers);
    return { status: res.statusCode, body: res.json() };
  }

  /** The ids a query lists, sorted, with `total` checked against them. */
  async function found(query: string, headers: Headers = founder): Promise<string[]> {
    const res = await list(headers, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.next_page_id).toBeUndefined();
    expect(res.body.total).toBe(res.body.items.length);
    return ids(res.body.items).sort();
  }

  const ids = (items: ArchiveConversation[]) => items.map((item) => item.thread_id);
  const sorted = (...values: string[]) => [...values].sort();

  it('files a connection under the workspace’s day by when it started: 23:30 Istanbul is that day, 00:30 the next, and the start hour moves the line (FR-MOD-02.8)', async () => {
    // The default workspace day: Europe/Istanbul (UTC+3), from midnight.
    const lateEvening = await connection({ startedAt: istanbul(D, 23, 30) });
    const afterMidnight = await connection({ startedAt: istanbul(D_AFTER, 0, 30) });
    const atMidnight = await connection({ startedAt: istanbul(D, 0) });
    const lastMillisecond = await connection({
      startedAt: new Date(istanbul(D, 0).getTime() - 1),
    });

    expect(await found(`?date_from=${D}&date_to=${D}`)).toEqual(sorted(lateEvening, atMidnight));
    expect(await found(`?date_from=${D_AFTER}&date_to=${D_AFTER}`)).toEqual([afterMidnight]);
    expect(await found(`?date_from=${D_BEFORE}&date_to=${D_BEFORE}`)).toEqual([lastMillisecond]);
    // Either end may stay open.
    expect(await found(`?date_from=${D}`)).toEqual(sorted(lateEvening, afterMidnight, atMidnight));
    expect(await found(`?date_to=${D_BEFORE}`)).toEqual([lastMillisecond]);
    // The exact-time form: [from, to).
    expect(
      await found(
        `?from=${istanbul(D_AFTER, 0).toISOString()}&to=${istanbul(D_AFTER, 0, 30).toISOString()}`,
      ),
    ).toEqual([]);
    expect(
      await found(
        `?from=${istanbul(D_AFTER, 0).toISOString()}&to=${new Date(istanbul(D_AFTER, 0, 30).getTime() + 1).toISOString()}`,
      ),
    ).toEqual([afterMidnight]);

    // A workspace whose day starts at 06:00: 00:00 on the 20th is still the 19th.
    await owner.inboxSettings.create({
      data: {
        licenseId: fx.a.licenseId,
        brandId: await seedDefaultBrand(owner, fx.a.licenseId),
        dayBoundaryHour: 6,
      },
    });
    expect(await found(`?date_from=${D}&date_to=${D}`)).toEqual(sorted(lateEvening, afterMidnight));
    expect(await found(`?date_from=${D_BEFORE}&date_to=${D_BEFORE}`)).toEqual(
      sorted(atMidnight, lastMillisecond),
    );
  });

  it('refuses mixed date forms, a range that ends before it begins, a day that does not exist, more than 20 tags and a filter it does not know (FR-MOD-02.8)', async () => {
    const reason = async (query: string) => {
      const res = await list(founder, query);
      expect(res.status, query).toBe(400);
      return res.body.error?.details?.reason;
    };
    expect(await reason('?date_from=2026-10-20&from=2026-10-20T00:00:00Z')).toBe('date_mixed');
    expect(await reason('?date_from=2026-10-21&date_to=2026-10-20')).toBe('range_order');
    expect(await reason('?from=2026-10-21T00:00:00Z&to=2026-10-21T00:00:00Z')).toBe('range_order');
    await reason('?date_from=2026-02-30');
    await reason('?date_from=20.10.2026');

    const tags = Array.from({ length: 21 }, () => `tag=${crypto.randomUUID()}`);
    await reason(`?${tags.join('&')}`);
    // Twenty is allowed.
    expect((await list(founder, `?${tags.slice(1).join('&')}`)).status).toBe(200);

    // A mistyped key is a 400, not a filter silently not applied.
    await reason(`?agent=${fx.a.agentAccountId}`);
    await reason('?rating=excellent');
    await reason('?handled_by=robot');
    await reason('?risk_flag=spam');
    await reason('?channel=website');
    await reason('?untagged=yes');
  });

  it('combines tags as asked: any, all, exclude ("Hariç: spam"), untagged (FR-MOD-02.8)', async () => {
    const tag = async (name: string) =>
      (
        await owner.tag.create({
          data: { licenseId: fx.a.licenseId, name },
          select: { id: true },
        })
      ).id;
    const spam = await tag('spam');
    const withdrawal = await tag('çekim');
    const at = new Date(Date.now() - 2 * DAY);
    const onlySpam = await connection({ startedAt: at });
    const both = await connection({ startedAt: at });
    const onlyWithdrawal = await connection({ startedAt: at });
    const untagged = await connection({ startedAt: at });
    await owner.threadTag.createMany({
      data: [
        { threadId: onlySpam, tagId: spam },
        { threadId: both, tagId: spam },
        { threadId: both, tagId: withdrawal },
        { threadId: onlyWithdrawal, tagId: withdrawal },
      ],
    });

    expect(await found(`?tag=${spam}`)).toEqual(sorted(onlySpam, both));
    expect(await found(`?tag=${spam}&tag=${withdrawal}`)).toEqual(
      sorted(onlySpam, both, onlyWithdrawal),
    );
    expect(await found(`?tag=${spam}&tag=${withdrawal}&tag_mode=all`)).toEqual([both]);
    // A tag named twice is still one tag to have.
    expect(await found(`?tag=${spam}&tag=${spam}&tag_mode=all`)).toEqual(sorted(onlySpam, both));
    // "Hariç: spam" — and an untagged conversation is kept.
    expect(await found(`?tag=${spam}&tag_mode=exclude`)).toEqual(sorted(onlyWithdrawal, untagged));
    expect(await found('?untagged=true')).toEqual([untagged]);
    expect(await found('?untagged=false')).toHaveLength(4);
    // Filters that cannot both hold are applied as asked, not dropped.
    expect(await found(`?untagged=true&tag=${spam}`)).toEqual([]);
  });

  it('reads the rating off the connection’s newest rating; a comment of white space is no comment (FR-MOD-02.8)', async () => {
    const at = new Date(Date.now() - 2 * DAY);
    const changedMind = await connection({ startedAt: at });
    const goodWithComment = await connection({ startedAt: at });
    const badBlank = await connection({ startedAt: at });
    const badWithComment = await connection({ startedAt: at });
    const unrated = await connection({ startedAt: at });
    const rate = async (threadId: string, value: string, comment: string | null, minute: number) =>
      owner.rating.create({
        data: {
          chatId: await chatOf(threadId),
          licenseId: fx.a.licenseId,
          threadId,
          value,
          comment,
          createdAt: new Date(at.getTime() + minute * MINUTE),
        },
      });
    await rate(changedMind, 'bad', 'Geç cevap', 10);
    await rate(changedMind, 'good', null, 20);
    await rate(goodWithComment, 'good', 'Çok hızlıydı', 10);
    await rate(badBlank, 'bad', '   ', 10);
    await rate(badWithComment, 'bad', 'Para gelmedi', 10);

    expect(await found('?rating=good')).toEqual(sorted(changedMind, goodWithComment));
    expect(await found('?rating=bad')).toEqual(sorted(badBlank, badWithComment));
    expect(await found('?rating=any')).toEqual(
      sorted(changedMind, goodWithComment, badBlank, badWithComment),
    );
    expect(await found('?rating=not_rated')).toEqual([unrated]);
    // The newest of `changedMind` has no comment; its older one does not count.
    expect(await found('?rating=commented')).toEqual(sorted(goodWithComment, badWithComment));
    expect(await found('?rating=good_commented')).toEqual([goodWithComment]);
    expect(await found('?rating=bad_commented')).toEqual([badWithComment]);

    // The filter and the row read the same rating.
    const row = (await list(founder, '?rating=good_commented')).body.items[0]!;
    expect(row.rating).toEqual({ value: 'good', has_comment: true });
  });

  it('finds who wrote to the player: written as the connection closes, read live while it is open, an internal note not counted (FR-MOD-02.8)', async () => {
    // Through the product: the Founder writes, then closes.
    const opened = await server.post(
      '/chats',
      { customer_id: fx.a.customerId, initial_event: { type: 'message', text: 'Merhaba' } },
      founder,
    );
    expect(opened.statusCode, opened.body).toBe(201);
    const chat = opened.json() as { id: string; thread: { id: string } };
    expect((await server.post(`/chats/${chat.id}/deactivate`, undefined, founder)).statusCode).toBe(
      200,
    );
    const closedByApi = chat.thread.id;
    const stored = await owner.thread.findUniqueOrThrow({ where: { id: closedByApi } });
    expect(stored.agentIds).toEqual([fx.a.ownerAccountId]);

    const at = new Date(Date.now() - 2 * DAY);
    const agent = fx.a.agentAccountId;
    const both = await connection({ startedAt: at, agentIds: [agent, fx.a.ownerAccountId] });
    const nobody = await connection({ startedAt: at, agentIds: [] });
    const openWritten = await connection({
      startedAt: at,
      closedAt: null,
      messages: [{ author: 'customer' }, { author: 'agent', authorId: agent }],
    });
    const openNoteOnly = await connection({
      startedAt: at,
      closedAt: null,
      messages: [{ author: 'customer' }, { author: 'agent', authorId: agent, notes: true }],
    });

    expect(await found(`?agent_id=${fx.a.ownerAccountId}`)).toEqual(sorted(closedByApi, both));
    expect(await found(`?agent_id=${agent}`)).toEqual([both]);
    expect(await found(`?agent_id=${agent}&status=all`)).toEqual(sorted(both, openWritten));
    expect(await found(`?agent_id=${agent}&status=open`)).toEqual([openWritten]);
    // Values of one filter OR together; an unknown agent matches nothing.
    expect(await found(`?agent_id=${crypto.randomUUID()}&agent_id=${agent}`)).toEqual([both]);
    expect(await found(`?agent_id=${crypto.randomUUID()}&status=all`)).toEqual([]);
    expect(nobody).toBeDefined();
    expect(openNoteOnly).toBeDefined();
  });

  it('narrows by the teams the row lists; a Team Member’s team filter never widens what they see (FR-MOD-02.8 · NFR-S4)', async () => {
    const at = new Date(Date.now() - 2 * DAY);
    const financeRow = await connection({
      startedAt: at,
      chatId: await day({ at, groupIds: [finance] }),
      groupId: finance,
    });
    // Opened before the connection's team was recorded: its day's teams.
    const legacyRg = await connection({ startedAt: at, chatId: await day({ at, groupIds: [rg] }) });
    // Its day went to Finans as well, but the connection went to Responsible Gaming.
    const movedToRg = await connection({
      startedAt: at,
      chatId: await day({ at, groupIds: [finance, rg] }),
      groupId: rg,
    });
    // Another workspace's connection, in a team id the caller might guess.
    await connection({ startedAt: at, t: fx.b, groupId: finance });

    expect(await found(`?group_id=${finance}`)).toEqual([financeRow]);
    expect(await found(`?group_id=${rg}`)).toEqual(sorted(legacyRg, movedToRg));
    expect(await found(`?group_id=${finance}&group_id=${rg}`)).toEqual(
      sorted(financeRow, legacyRg, movedToRg),
    );
    const row = (await list(founder, `?group_id=${rg}`)).body.items.find(
      (item) => item.thread_id === movedToRg,
    )!;
    expect(row.group_ids).toEqual([Number(rg)]);

    // The member sees Finans' days — `movedToRg`'s too, as its day was given
    // to Finans — and asking for another team only narrows that.
    expect(await found(`?group_id=${finance}`, member)).toEqual([financeRow]);
    expect(await found(`?group_id=${rg}`, member)).toEqual([movedToRg]);
    expect((await found('', member)).includes(legacyRg)).toBe(false);
  });

  it('counts "AI solved" over a range exactly as the AI report counts its resolutions (FR-MOD-02.8 · FR-MOD-10.1.4)', async () => {
    const from = new Date(Date.now() - 5 * DAY);
    const to = new Date(Date.now() - DAY);
    const inside = (hours: number) => new Date(from.getTime() + hours * HOUR);
    const made = [
      await connection({
        startedAt: inside(1),
        messages: [{ author: 'customer' }, { author: 'bot' }],
      }),
      await connection({
        startedAt: inside(2),
        messages: [{ author: 'customer' }, { author: 'bot' }],
      }),
      await connection({ startedAt: inside(3), messages: [{ author: 'customer' }] }),
      await connection({
        startedAt: inside(4),
        messages: [{ author: 'customer' }, { author: 'agent', authorId: fx.a.agentAccountId }],
      }),
      await connection({
        startedAt: inside(5),
        messages: [{ author: 'bot' }, { author: 'agent', authorId: fx.a.agentAccountId }],
      }),
      // Outside the range, and one still open inside it.
      await connection({
        startedAt: new Date(from.getTime() - HOUR),
        messages: [{ author: 'bot' }],
      }),
      await connection({ startedAt: inside(6), closedAt: null, messages: [{ author: 'bot' }] }),
    ];
    // Written as the close writes it: ADR-09a's predicate, one evaluation.
    await owner.$executeRaw`
      UPDATE threads t SET handled_by = ${handledBySql()}
      WHERE t.id = ANY(${made}::text[]) AND NOT t.active`;

    const range = `from=${from.toISOString()}&to=${to.toISOString()}`;
    const report = await server.get(`/reports/ai-agent?${range}`, founder);
    expect(report.statusCode, report.body).toBe(200);
    const resolutions = (report.json() as { resolutions: number }).resolutions;
    expect(resolutions).toBe(3);

    const solved = await list(founder, `?handled_by=ai&${range}`);
    expect(solved.body.total).toBe(resolutions);
    expect((await list(founder, `?handled_by=human&${range}`)).body.total).toBe(1);
    expect((await list(founder, `?handled_by=mixed&${range}`)).body.total).toBe(1);
    expect((await list(founder, `?handled_by=human&handled_by=mixed&${range}`)).body.total).toBe(2);
  });

  it('finds a conversation by a risk flag raised in it, cleared or not, and by the channel its day arrived over (FR-MOD-02.8)', async () => {
    const at = new Date(Date.now() - 2 * DAY);
    const abusive = await connection({ startedAt: at });
    const fraud = await connection({ startedAt: at });
    const whatsapp = await connection({ startedAt: at });
    const raise = async (threadId: string, type: RiskFlagType) =>
      owner.riskFlag.create({
        data: {
          licenseId: fx.a.licenseId,
          scope: 'chat',
          chatId: await chatOf(threadId),
          threadId,
          type,
          severity: 'high',
          source: 'agent',
          raisedBy: fx.a.ownerAccountId,
        },
        select: { id: true },
      });
    await raise(abusive, 'abusive');
    await raise(abusive, 'abusive');
    const cleared = await raise(fraud, 'fraud_suspected');
    await owner.riskFlag.update({
      where: { id: cleared.id },
      data: {
        status: 'cleared',
        clearedBy: fx.a.ownerAccountId,
        clearedAt: new Date(),
        clearReason: 'Yanlış alarm',
      },
    });

    expect(await found('?risk_flag=abusive')).toEqual([abusive]);
    expect(await found('?risk_flag=fraud_suspected')).toEqual([fraud]);
    expect(await found('?risk_flag=abusive&risk_flag=fraud_suspected')).toEqual(
      sorted(abusive, fraud),
    );
    expect(await found('?risk_flag=rg_signal')).toEqual([]);
    const row = (await list(founder, '?risk_flag=abusive')).body.items[0]!;
    expect(row.risk_flags).toEqual(['abusive']);

    // The day's oldest inbound adapter message names its channel.
    const chatId = await chatOf(whatsapp);
    await owner.channelMessage.createMany({
      data: [
        {
          licenseId: fx.a.licenseId,
          channelType: 'whatsapp',
          direction: 'inbound',
          externalId: '905551112233',
          chatId,
          createdAt: at,
        },
        {
          licenseId: fx.a.licenseId,
          channelType: 'telegram',
          direction: 'inbound',
          externalId: 'tg-1',
          chatId,
          createdAt: new Date(at.getTime() + MINUTE),
        },
      ],
    });
    expect(await found('?channel=whatsapp')).toEqual([whatsapp]);
    expect(await found('?channel=telegram')).toEqual([]);
  });

  it('ANDs different filters, ORs one filter’s values, and pages the filtered list with total counting it (FR-MOD-02.8)', async () => {
    const spam = (
      await owner.tag.create({
        data: { licenseId: fx.a.licenseId, name: 'spam' },
        select: { id: true },
      })
    ).id;
    // 23:30 Istanbul on 20 October, in Finans: five that match.
    const base = istanbul(D, 23, 30);
    const matching: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      matching.push(
        await connection({
          startedAt: new Date(base.getTime() + i * MINUTE),
          chatId: await day({ at: base, groupIds: [finance] }),
          groupId: finance,
          handledBy: i % 2 === 0 ? 'ai' : 'human',
        }),
      );
    }
    // One of each that fails exactly one filter.
    const otherDay = await connection({
      startedAt: istanbul(D_AFTER, 0, 30),
      groupId: finance,
      handledBy: 'ai',
    });
    const otherTeam = await connection({ startedAt: base, groupId: rg, handledBy: 'ai' });
    const tagged = await connection({ startedAt: base, groupId: finance, handledBy: 'ai' });
    await owner.threadTag.create({ data: { threadId: tagged, tagId: spam } });
    const mixed = await connection({ startedAt: base, groupId: finance, handledBy: 'mixed' });

    const query =
      `?date_from=${D}&date_to=${D}&group_id=${finance}` +
      `&tag=${spam}&tag_mode=exclude&handled_by=ai&handled_by=human`;
    const seen: string[] = [];
    let pageId: string | undefined;
    do {
      const res = await list(
        founder,
        `${query}&limit=2${pageId ? `&page_id=${encodeURIComponent(pageId)}` : ''}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
      seen.push(...ids(res.body.items));
      pageId = res.body.next_page_id;
    } while (pageId);
    expect(seen.sort()).toEqual([...matching].sort());
    expect(seen).not.toContain(otherDay);
    expect(seen).not.toContain(otherTeam);
    expect(seen).not.toContain(tagged);
    expect(seen).not.toContain(mixed);
  });

  it('reads a day of one team through the threads index under row level security', async () => {
    const appUrl = process.env['DATABASE_APP_URL'];
    expect(appUrl).toBeDefined();
    const id = await player();
    // A connection an hour, for four months, half of them Finans'.
    await owner.$executeRaw`
      INSERT INTO chats (id, license_id, customer_id, active, created_at, last_event_at)
      SELECT 'Q' || lpad(g::text, 9, '0'), ${fx.a.licenseId}, ${id}::uuid, false,
             now() - g * interval '1 hour', now() - g * interval '1 hour'
      FROM generate_series(1, 3000) g`;
    await owner.$executeRaw`
      INSERT INTO threads (id, chat_id, license_id, active, created_at, closed_at, group_id)
      SELECT 'P' || lpad(g::text, 9, '0'), 'Q' || lpad(g::text, 9, '0'), ${fx.a.licenseId}, false,
             now() - g * interval '1 hour', now() - g * interval '1 hour' + interval '10 minutes',
             CASE WHEN g % 2 = 0 THEN ${finance}::bigint ELSE ${rg}::bigint END
      FROM generate_series(1, 3000) g`;
    await owner.$executeRaw`ANALYZE threads`;
    await owner.$executeRaw`ANALYZE chats`;

    const from = new Date(Date.now() - 10 * DAY);
    const to = new Date(from.getTime() + DAY);
    const app = new PrismaClient({ datasources: { db: { url: appUrl! } } });
    try {
      const plan = await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) =>
          tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
            `EXPLAIN SELECT t.id FROM threads t JOIN chats c ON c.id = t.chat_id
              WHERE t.license_id = ${fx.a.licenseId} AND t.closed_at IS NOT NULL
                AND t.created_at >= '${from.toISOString()}' AND t.created_at < '${to.toISOString()}'
                AND (t.group_id = ANY('{${finance}}'::bigint[]) OR (t.group_id IS NULL AND EXISTS (
                  SELECT 1 FROM chat_access ca WHERE ca.chat_id = t.chat_id
                    AND ca.group_id = ANY('{${finance}}'::bigint[]) OFFSET 0)))
              ORDER BY t.closed_at DESC, t.id DESC LIMIT 51`,
          ),
      );
      const text = plan.map((row) => row['QUERY PLAN']).join('\n');
      // One day of four months: the start-time index narrows to it; nothing
      // reads the whole table.
      expect(text).toContain('threads_license_id_created_at_id_idx');
      expect(text).not.toMatch(/Seq Scan on threads/);
    } finally {
      await app.$disconnect();
    }

    const started = performance.now();
    const page = await list(
      founder,
      `?from=${from.toISOString()}&to=${to.toISOString()}&group_id=${finance}`,
    );
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(12);
    expect(performance.now() - started).toBeLessThan(800);
  });
});
