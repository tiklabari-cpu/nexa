/**
 * The queue reports (RP-04 · tm 371) — `GET /reports/queue` and
 * `GET /reports/queue-abandonment` over the `queue_entries` record (tm 291).
 *
 * What is pinned here:
 *
 *   1. On real flows: a chat that waited three minutes and was then assigned
 *      reads 180 seconds and "assigned"; a player closing a waiting chat reads
 *      "abandoned".
 *   2. The arithmetic on seeded stays: entries, the outcomes, the two shares, the
 *      average / 80th percentile / longest wait of the assigned ones, the
 *      abandonment bands that partition the abandoned count.
 *   3. Every team has its own averages, and the team rows add up to the totals.
 *   4. Days and the hour × weekday heat map are in the workspace's zone, not UTC.
 *   5. The JSON and the CSV carry the same numbers.
 *   6. The report filter narrows the stays; a Team Lead reads only the queues of
 *      the teams they lead.
 */
import { PrismaClient } from '@prisma/client';
import { QUEUE_ABANDON_WAIT_BANDS, defaultScopesForRole, generateShortId } from '@siyahtus/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const MINUTE = 60_000;
const Q = 'from=2026-10-01T00:00:00.000Z&to=2026-10-31T00:00:00.000Z';

type Json = Record<string, unknown>;
type Headers = Record<string, string>;

describe('queue reports (RP-04 · tm 371)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let supportId: bigint;
  let salesId: bigint;
  let brandId: string;
  let adminToken: string;
  let ownerAuth: Headers;
  let leadAuth: Headers;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    brandId = await seedDefaultBrand(owner, fx.a.licenseId);
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);

    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    salesId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      })
    ).id;
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
    });

    const lead = await owner.account.create({
      data: { email: `lead-${fx.a.licenseId}@queue-report.test`, name: 'Ekip Lideri' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: lead.id,
        role: 'team_lead',
        // Not taking chats: the real-flow tests need Support's queue to fill.
        routingStatus: 'not_accepting_chats',
      },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: supportId, agentId: lead.id, isLead: true },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:rw', 'customers:rw', 'reports_read'],
    });
    const session = async (accountId: string, role: string): Promise<Headers> =>
      auth(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: accountId,
          kind: 'oauth',
          scopes: defaultScopesForRole(role),
        }),
      );
    ownerAuth = await session(fx.a.ownerAccountId, 'owner');
    leadAuth = await session(lead.id, 'team_lead');
  });

  async function json(path: string, headers: Headers = ownerAuth): Promise<Json> {
    const response = await server.get(path, headers);
    expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
    return response.json() as Json;
  }

  async function csv(group: string, query = Q, headers: Headers = ownerAuth): Promise<string[][]> {
    const response = await server.get(`/reports/export?group=${group}&${query}`, headers);
    expect(response.statusCode, response.body).toBe(200);
    return response.body
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(','));
  }

  /** A closed connection and one stay in the queue for `groupId`, `waitSeconds` long. */
  async function stay(input: {
    at: Date;
    groupId: bigint | null;
    waitSeconds?: number;
    outcome?: 'assigned' | 'abandoned' | 'closed_by_agent' | 'transferred' | 'timeout' | null;
    tags?: string[];
  }): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Oyuncu' },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: false },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: false,
        createdAt: input.at,
        closedAt: new Date(input.at.getTime() + 20 * MINUTE),
        groupId: input.groupId,
      },
    });
    if (input.groupId !== null) {
      await owner.chatAccess.create({ data: { chatId, groupId: input.groupId } });
    }
    for (const tagId of input.tags ?? []) {
      await owner.threadTag.create({ data: { threadId, tagId } });
    }
    const outcome = input.outcome === undefined ? 'assigned' : input.outcome;
    await owner.queueEntry.create({
      data: {
        licenseId: fx.a.licenseId,
        threadId,
        groupId: input.groupId,
        enteredAt: input.at,
        leftAt:
          outcome === null ? null : new Date(input.at.getTime() + (input.waitSeconds ?? 0) * 1000),
        outcome,
      },
    });
    return threadId;
  }

  // --- 1. Real flows ----------------------------------------------------------

  describe('on the queue as it runs', () => {
    async function addAgent(groupId: bigint, status = 'accepting_chats'): Promise<void> {
      const account = await owner.account.create({
        data: { email: `${generateShortId()}@queue-report.test`.toLowerCase(), name: 'Agent' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: account.id,
          role: 'agent',
          routingStatus: status,
          concurrentChatsLimit: 1,
        },
      });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId, agentId: account.id, priority: 'normal' },
      });
    }

    async function startChat(): Promise<{ chatId: string; queued: boolean }> {
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
      const body = response.json() as { id: string; thread: { queue_position: number | null } };
      return { chatId: body.id, queued: body.thread.queue_position !== null };
    }

    it('reads a three-minute wait that ended in an assignment as 3 minutes, assigned (RP-04)', async () => {
      const t0 = new Date();
      vi.useFakeTimers({ toFake: ['Date'], now: t0 });
      await addAgent(supportId);
      const live = await startChat();
      expect(live.queued).toBe(false);
      const waiting = await startChat();
      expect(waiting.queued).toBe(true);

      vi.setSystemTime(t0.getTime() + 3 * MINUTE);
      const freed = await server.post(
        `/chats/${live.chatId}/deactivate`,
        undefined,
        auth(adminToken),
      );
      expect(freed.statusCode).toBe(200);

      vi.setSystemTime(t0.getTime() + 4 * MINUTE);
      const report = await json('/reports/queue');
      expect(report.totals).toMatchObject({
        entries: 1,
        assigned: 1,
        abandoned: 0,
        waiting: 0,
        avg_wait_seconds: 180,
        p80_wait_seconds: 180,
        max_wait_seconds: 180,
        assigned_rate: 1,
        abandonment_rate: 0,
      });
      expect(report.by_team).toEqual([
        expect.objectContaining({
          team_id: Number(supportId),
          name: 'Support',
          entries: 1,
          assigned: 1,
          avg_wait_seconds: 180,
        }),
      ]);
    });

    it('reads a player closing a waiting chat as abandoned (RP-04)', async () => {
      await addAgent(supportId, 'not_accepting_chats');
      const visitor = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const token = (visitor.json() as { token: string }).token;
      const sent = await server.post('/customer/chat/events', { text: 'Anyone?' }, auth(token));
      expect(sent.statusCode).toBe(201);

      // Waiting: in the entries and in `waiting`, not yet abandoned.
      expect((await json('/reports/queue')).totals).toMatchObject({
        entries: 1,
        waiting: 1,
        abandoned: 0,
        assigned_rate: 0,
      });

      const closed = await server.post('/customer/chat/close', undefined, auth(token));
      expect(closed.statusCode).toBe(204);

      const report = await json('/reports/queue-abandonment');
      expect(report.totals).toMatchObject({
        entries: 1,
        abandoned: 1,
        waiting: 0,
        abandonment_rate: 1,
        assigned_rate: 0,
      });
      expect(report.by_team).toEqual([
        expect.objectContaining({ team_id: Number(supportId), abandoned: 1, abandonment_rate: 1 }),
      ]);
      // Gave up within seconds: the first band.
      expect((report.by_wait as Array<{ key: string; abandoned: number }>)[0]).toMatchObject({
        key: 'under_30s',
        abandoned: 1,
      });
    });
  });

  // --- 2. The arithmetic -------------------------------------------------------

  describe('the figures', () => {
    const at = (hhmm: string, day = '2026-10-13') => new Date(`${day}T${hhmm}:00.000Z`);

    beforeEach(async () => {
      // Support: assigned after 60 / 120 / 180 / 240 / 300 s, one abandoned at 45 s,
      // one at 400 s, one still waiting. Sales: assigned after 600 s, abandoned at 700 s.
      for (const [i, s] of [60, 120, 180, 240, 300].entries()) {
        await stay({ at: at(`08:0${i}`), groupId: supportId, waitSeconds: s });
      }
      await stay({ at: at('09:00'), groupId: supportId, waitSeconds: 45, outcome: 'abandoned' });
      await stay({ at: at('09:10'), groupId: supportId, waitSeconds: 400, outcome: 'abandoned' });
      await stay({ at: at('09:20'), groupId: supportId, outcome: null });
      await stay({ at: at('10:00'), groupId: salesId, waitSeconds: 600 });
      await stay({ at: at('10:05'), groupId: salesId, waitSeconds: 700, outcome: 'abandoned' });
      // The other outcomes count as entries and nothing more.
      await stay({ at: at('11:00'), groupId: salesId, waitSeconds: 30, outcome: 'transferred' });
      await stay({ at: at('11:05'), groupId: null, waitSeconds: 30, outcome: 'closed_by_agent' });
      await stay({ at: at('11:10'), groupId: null, waitSeconds: 30, outcome: 'timeout' });
      // Outside the window.
      await stay({ at: at('08:00', '2026-09-02'), groupId: supportId, waitSeconds: 60 });
    });

    it('counts the stays, the outcomes, the shares and the waits of the assigned ones (RP-04)', async () => {
      const report = await json(`/reports/queue?${Q}`);
      expect(report.totals).toEqual({
        entries: 13,
        assigned: 6,
        abandoned: 3,
        closed_by_agent: 1,
        transferred: 1,
        timeout: 1,
        waiting: 1,
        // (60 + 120 + 180 + 240 + 300 + 600) / 6.
        avg_wait_seconds: 250,
        // percentile_cont(0.8) over 60 120 180 240 300 600: position 0.8 × 5 = 4 → 300.
        p80_wait_seconds: 300,
        max_wait_seconds: 600,
        // (45 + 400 + 700) / 3.
        abandon_avg_wait_seconds: 382,
        assigned_rate: 0.4615,
        abandonment_rate: 0.2308,
      });
      expect(report.timezone).toBe('Europe/Istanbul');
    });

    it('gives every team its own averages, and the teams add up to the totals (RP-04)', async () => {
      const report = await json(`/reports/queue?${Q}`);
      const teams = report.by_team as Array<Json>;
      expect(teams.map((team) => [team.team_id, team.name, team.entries])).toEqual([
        [Number(supportId), 'Support', 8],
        [Number(salesId), 'Sales', 3],
        [null, null, 2],
      ]);
      const support = teams[0]!;
      expect(support).toMatchObject({
        assigned: 5,
        abandoned: 2,
        waiting: 1,
        avg_wait_seconds: 180,
        max_wait_seconds: 300,
        assigned_rate: 0.625,
        abandonment_rate: 0.25,
      });
      expect(teams[1]).toMatchObject({
        assigned: 1,
        abandoned: 1,
        transferred: 1,
        avg_wait_seconds: 600,
        abandon_avg_wait_seconds: 700,
      });
      const total = (key: string) => teams.reduce((n, team) => n + Number(team[key]), 0);
      const totals = report.totals as Json;
      for (const key of ['entries', 'assigned', 'abandoned', 'waiting', 'timeout']) {
        expect(total(key), key).toBe(totals[key]);
      }
    });

    it('spreads the abandonments over the wait bands, which partition the abandoned count (RP-04)', async () => {
      const report = await json(`/reports/queue-abandonment?${Q}`);
      const bands = report.by_wait as Array<{
        key: string;
        from_seconds: number;
        to_seconds: number | null;
        abandoned: number;
      }>;
      expect(bands.map((band) => band.key)).toEqual(QUEUE_ABANDON_WAIT_BANDS.map((b) => b.key));
      // 45 s → 30s_to_1m, 400 s → 5m_to_10m, 700 s → over_10m.
      expect(bands.map((band) => band.abandoned)).toEqual([0, 1, 0, 0, 1, 1]);
      expect(bands.at(-1)).toMatchObject({ from_seconds: 600, to_seconds: null });
      expect(bands.reduce((n, band) => n + band.abandoned, 0)).toBe(
        (report.totals as Json).abandoned,
      );
      expect(report.totals).toMatchObject({ abandoned: 3, abandonment_rate: 0.2308 });
    });

    it('lays the days and the hour × weekday heat map in the workspace zone, not UTC (RP-04)', async () => {
      // 2026-10-13 is a Tuesday; Istanbul is UTC+3: 08:00Z → 11:00, and a stay at
      // 22:30Z on the 13th is already Wednesday 01:30 on the 14th.
      await stay({ at: at('22:30'), groupId: supportId, waitSeconds: 10 });
      const report = await json(`/reports/queue?${Q}`);
      const cells = (report.heatmap as Array<Json>).filter((cell) => Number(cell.entries) > 0);
      expect(cells.map((cell) => [cell.weekday, cell.hour, cell.entries])).toEqual([
        [2, 11, 5],
        [2, 12, 3],
        [2, 13, 2],
        [2, 14, 3],
        [3, 1, 1],
      ]);
      expect(report.heatmap as Json[]).toHaveLength(168);
      expect((report.heatmap as Json[])[0]).toMatchObject({ weekday: 1, hour: 0, entries: 0 });
      expect((report.by_day as Json[]).map((day) => [day.date, day.entries])).toEqual([
        ['2026-10-13', 13],
        ['2026-10-14', 1],
      ]);

      await owner.inboxSettings.create({
        data: {
          licenseId: fx.a.licenseId,
          brandId,
          dayBoundaryTz: 'Asia/Tokyo',
        },
      });
      const tokyo = await json(`/reports/queue?${Q}`);
      expect(tokyo.timezone).toBe('Asia/Tokyo');
      // 08:00Z is 17:00 in Tokyo (UTC+9), and 22:30Z is Wednesday 07:30.
      expect(
        (tokyo.heatmap as Array<Json>)
          .filter((cell) => Number(cell.entries) > 0)
          .map((cell) => [cell.weekday, cell.hour]),
      ).toEqual([
        [2, 17],
        [2, 18],
        [2, 19],
        [2, 20],
        [3, 7],
      ]);
    });

    it('compares against the previous period (RP-04)', async () => {
      const report = await json(
        `/reports/queue?from=2026-10-01T00:00:00.000Z&to=2026-10-31T00:00:00.000Z`,
      );
      const previous = report.previous_period as Json;
      expect(previous.baseline).toBe('previous_period');
      // The 30-day window before 1 Oct holds the September stay.
      expect(previous).toMatchObject({ entries: 1, assigned: 1, avg_wait_seconds: 60 });
    });

    it('exports exactly the numbers the reports show (RP-04)', async () => {
      const report = await json(`/reports/queue?${Q}`);
      const totals = report.totals as Json;
      const lines = await csv('queue');
      expect(lines[0]).toEqual([
        'dimension',
        'key',
        'name',
        'entries',
        'assigned',
        'abandoned',
        'waiting',
        'avg_wait_seconds',
        'p80_wait_seconds',
        'max_wait_seconds',
      ]);
      const total = lines.find((line) => line[0] === 'total')!;
      expect(total.slice(3).map(Number)).toEqual([
        totals.entries,
        totals.assigned,
        totals.abandoned,
        totals.waiting,
        totals.avg_wait_seconds,
        totals.p80_wait_seconds,
        totals.max_wait_seconds,
      ]);
      const support = lines.find((line) => line[0] === 'team' && line[2] === 'Support')!;
      expect(support.slice(3).map(Number)).toEqual([8, 5, 2, 1, 180, 252, 300]);
      expect(lines.filter((line) => line[0] === 'team')).toHaveLength(3);
      expect(lines.filter((line) => line[0] === 'day')).toHaveLength(1);

      const abandonment = await csv('queue-abandonment');
      expect(abandonment[0]).toEqual([
        'dimension',
        'key',
        'name',
        'entries',
        'abandoned',
        'abandonment_rate',
        'abandon_avg_wait_seconds',
      ]);
      const aTotal = abandonment.find((line) => line[0] === 'total')!;
      expect(aTotal.slice(3).map(Number)).toEqual([13, 3, 0.2308, 382]);
      expect(
        abandonment.filter((line) => line[0] === 'wait').map((line) => [line[1], line[4]]),
      ).toEqual([
        ['under_30s', '0'],
        ['30s_to_1m', '1'],
        ['1m_to_2m', '0'],
        ['2m_to_5m', '0'],
        ['5m_to_10m', '1'],
        ['over_10m', '1'],
      ]);
    });

    it('answers an empty window with nulls and zeros, never a division (RP-04)', async () => {
      const empty = 'from=2025-01-01T00:00:00.000Z&to=2025-01-10T00:00:00.000Z';
      const report = await json(`/reports/queue?${empty}`);
      expect(report.totals).toMatchObject({
        entries: 0,
        avg_wait_seconds: null,
        p80_wait_seconds: null,
        max_wait_seconds: null,
        assigned_rate: null,
        abandonment_rate: null,
      });
      expect(report.by_team).toEqual([]);
      expect(report.by_day).toEqual([]);
      const abandonment = await json(`/reports/queue-abandonment?${empty}`);
      expect((abandonment.by_wait as Json[]).map((band) => band.abandoned)).toEqual([
        0, 0, 0, 0, 0, 0,
      ]);
    });
  });

  // --- 3. Filter and scope ----------------------------------------------------

  describe('the report filter and who may read', () => {
    it('narrows the stays by tag and by team, and echoes the filter (RP-04 · RP-01)', async () => {
      const vip = (
        await owner.tag.create({
          data: { licenseId: fx.a.licenseId, name: 'vip' },
          select: { id: true },
        })
      ).id;
      const day = new Date('2026-10-13T08:00:00.000Z');
      await stay({ at: day, groupId: supportId, waitSeconds: 60, tags: [vip] });
      await stay({ at: day, groupId: supportId, waitSeconds: 120 });
      await stay({ at: day, groupId: salesId, waitSeconds: 300, tags: [vip] });

      const tagged = await json(`/reports/queue?${Q}&tag=${vip}`);
      expect(tagged.totals).toMatchObject({ entries: 2, avg_wait_seconds: 180 });
      expect(tagged.filters).toEqual({ tag: [vip] });

      const sales = await json(`/reports/queue-abandonment?${Q}&group_id=${salesId}`);
      expect(sales.totals).toMatchObject({ entries: 1 });
      expect((sales.by_team as Json[]).map((team) => team.name)).toEqual(['Sales']);

      // The export is filtered the same way.
      const lines = await csv('queue', `${Q}&group_id=${salesId}`);
      expect(lines.find((line) => line[0] === 'total')!.slice(3, 5)).toEqual(['1', '1']);
    });

    it('lets a Team Lead read only the queue of the team they lead (RP-04 · RL-02)', async () => {
      const day = new Date('2026-10-13T08:00:00.000Z');
      await stay({ at: day, groupId: supportId, waitSeconds: 60 });
      await stay({ at: day, groupId: salesId, waitSeconds: 300 });
      // A chat shared with Support whose own queue was Sales: Sales' queue, not theirs.
      const shared = await stay({ at: day, groupId: salesId, waitSeconds: 500 });
      const sharedChat = await owner.thread.findUniqueOrThrow({
        where: { id: shared },
        select: { chatId: true },
      });
      await owner.chatAccess.create({ data: { chatId: sharedChat.chatId, groupId: supportId } });

      const own = await json(`/reports/queue?${Q}`, leadAuth);
      expect(own.totals).toMatchObject({ entries: 1, avg_wait_seconds: 60 });
      expect((own.by_team as Json[]).map((team) => team.name)).toEqual(['Support']);

      const other = await json(`/reports/queue?${Q}&group_id=${salesId}`, leadAuth);
      expect((other.totals as Json).entries).toBe(0);
      expect(other.by_team).toEqual([]);

      const lines = await csv('queue-abandonment', Q, leadAuth);
      expect(lines.filter((line) => line[0] === 'team').map((line) => line[2])).toEqual([
        'Support',
      ]);
    });

    it('refuses a token without report scope, and never shows another workspace (RP-04)', async () => {
      const noReports = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      for (const path of ['/reports/queue', '/reports/queue-abandonment']) {
        expect((await server.get(path, auth(noReports))).statusCode, path).toBe(403);
      }

      // Another workspace's stay is invisible.
      const otherCustomer = await owner.customer.create({
        data: { organizationId: fx.b.organizationId, name: 'Başka' },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: {
          id: chatId,
          licenseId: fx.b.licenseId,
          customerId: otherCustomer.id,
          active: false,
        },
      });
      const threadId = generateShortId();
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: fx.b.licenseId,
          active: false,
          createdAt: new Date('2026-10-13T08:00:00.000Z'),
          closedAt: new Date('2026-10-13T08:20:00.000Z'),
        },
      });
      await owner.queueEntry.create({
        data: {
          licenseId: fx.b.licenseId,
          threadId,
          enteredAt: new Date('2026-10-13T08:00:00.000Z'),
          leftAt: new Date('2026-10-13T08:05:00.000Z'),
          outcome: 'assigned',
        },
      });
      expect(((await json(`/reports/queue?${Q}`)).totals as Json).entries).toBe(0);
    });
  });
});
