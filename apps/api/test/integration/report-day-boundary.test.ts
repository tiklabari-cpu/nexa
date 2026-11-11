/**
 * Report days on the workspace's clock (tm 458 · F44) and calendar-day ranges
 * (tm 459 · F45).
 *
 * A chat opened at 21:30Z on 4 November is a 5 November chat in Istanbul: the
 * chat list files it there (`chats.local_day`, ID-04), and every report's day
 * and hour buckets now say the same — the JSON and the CSV export alike. The
 * SQL that buckets reports (`localDaySql`) is checked against the one function
 * that files chats (`localDayKey`) instant by instant, across daylight-saving
 * days and a non-midnight day start.
 *
 * A date-only `from`/`to` names those same workspace days: `from=to=<day>` is
 * the whole day; the same instant on both ends is a 400 `range_empty`.
 *
 * Fixed dates, no clock: the instants are far from "now", so the suite does not
 * depend on the hour it runs in (memory: integration reds between 00 and 01 UTC).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { generateShortId, localDayKey, type DayBoundary } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { localDayKeySql, localHourSql } from '../../src/services/chat/day-boundary.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;

/** 00:30 on 5 November in Istanbul (UTC+3), 21:30 on 4 November in UTC. */
const LATE_EVENING = new Date('2026-11-04T21:30:00.000Z');
/** 12:00 on 5 November in both zones. */
const MIDDAY = new Date('2026-11-05T12:00:00.000Z');
/** 00:30 on 6 November in Istanbul — the day after, there. */
const NEXT_LATE_EVENING = new Date('2026-11-05T21:30:00.000Z');

/** Wide enough to hold every fixture in either zone. */
const WIDE = 'from=2026-11-01T00:00:00.000Z&to=2026-11-10T00:00:00.000Z';

describe('report days on the workspace clock (tm 458 · F44)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let brandId: string;
  let headers: Record<string, string>;

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
    brandId = await seedDefaultBrand(owner, fx.a.licenseId);
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });
    headers = { authorization: `Bearer ${token}` };
  });

  /** One closed connection opened at `at`, rated good, plus a ticket at `at`. */
  async function connectionAt(at: Date): Promise<void> {
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
        createdAt: at,
        closedAt: new Date(at.getTime() + 60_000),
      },
    });
    await owner.rating.create({
      data: { chatId, licenseId: fx.a.licenseId, threadId, value: 'good', createdAt: at },
    });
    await owner.ticket.create({
      data: { id: generateShortId(), licenseId: fx.a.licenseId, subject: 'Çekim', createdAt: at },
    });
  }

  async function setBoundary(timezone: string, hour = 0): Promise<void> {
    await owner.inboxSettings.create({
      data: {
        licenseId: fx.a.licenseId,
        brandId,
        dayBoundaryTz: timezone,
        dayBoundaryHour: hour,
      },
    });
  }

  async function json(path: string): Promise<Json> {
    const response = await server.get(path, headers);
    expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
    return response.json() as Json;
  }

  /** The breakdown export's `day` and `hour` rows as `[dimension, key, chats]`. */
  async function exportedBuckets(query: string): Promise<Array<[string, string, number]>> {
    const response = await server.get(`/reports/export?group=breakdown&${query}`, headers);
    expect(response.statusCode, response.body).toBe(200);
    return response.body
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(','))
      .filter(
        ([dimension, , chats]) => dimension === 'day' || (dimension === 'hour' && chats !== '0'),
      )
      .map(([dimension, key, chats]) => [dimension!, key!, Number(chats)]);
  }

  const days = (rows: unknown, key = 'chats') =>
    (rows as Json[]).map((row) => [row.date, row[key]]);
  const busyHours = (rows: unknown) =>
    (rows as Json[]).filter((row) => Number(row.chats) > 0).map((row) => [row.hour, row.chats]);

  it('files a 21:30Z chat under the next day in Istanbul, the default zone — JSON and CSV alike', async () => {
    await connectionAt(LATE_EVENING);
    // No inbox_settings row: the workspace reads Europe/Istanbul, midnight.
    const breakdown = await json(`/reports/breakdown?${WIDE}`);
    expect(days(breakdown.by_day)).toEqual([['2026-11-05', 1]]);
    expect(busyHours(breakdown.by_hour)).toEqual([[0, 1]]);
    expect(await exportedBuckets(WIDE)).toEqual([
      ['day', '2026-11-05', 1],
      ['hour', '0', 1],
    ]);

    // The same chat's day in the chat list's own function.
    expect(localDayKey(LATE_EVENING)).toBe('2026-11-05');

    // Every other by-day report agrees.
    expect(days((await json(`/reports/cases?${WIDE}`)).by_day, 'total')).toEqual([
      ['2026-11-05', 1],
    ]);
    const reviews = await json(`/reports/reviews?${WIDE}`);
    expect((reviews.by_day as Json[]).map((row) => row.date)).toEqual(['2026-11-05']);
  });

  it('files the same chat under 4 November, 21:00, when the workspace keeps UTC', async () => {
    await connectionAt(LATE_EVENING);
    await setBoundary('UTC');
    const breakdown = await json(`/reports/breakdown?${WIDE}`);
    expect(days(breakdown.by_day)).toEqual([['2026-11-04', 1]]);
    expect(busyHours(breakdown.by_hour)).toEqual([[21, 1]]);
    expect(await exportedBuckets(WIDE)).toEqual([
      ['day', '2026-11-04', 1],
      ['hour', '21', 1],
    ]);
    expect(days((await json(`/reports/cases?${WIDE}`)).by_day, 'total')).toEqual([
      ['2026-11-04', 1],
    ]);
  });

  it('moves the day, not the hour, with a later day start', async () => {
    // 06:00 start: 00:30 local is still the 4th's conversation day, but the
    // hour on the wall is 0.
    await connectionAt(LATE_EVENING);
    await setBoundary('Europe/Istanbul', 6);
    const breakdown = await json(`/reports/breakdown?${WIDE}`);
    expect(days(breakdown.by_day)).toEqual([['2026-11-04', 1]]);
    expect(busyHours(breakdown.by_hour)).toEqual([[0, 1]]);
    expect(localDayKey(LATE_EVENING, 'Europe/Istanbul', 6)).toBe('2026-11-04');
  });

  it('buckets in SQL exactly as localDayKey files a chat, across daylight saving', async () => {
    const boundaries: DayBoundary[] = [
      { timezone: 'Europe/Istanbul', hour: 0 },
      { timezone: 'Europe/Istanbul', hour: 6 },
      { timezone: 'America/New_York', hour: 0 },
      { timezone: 'America/New_York', hour: 2 },
      { timezone: 'Europe/London', hour: 1 },
      { timezone: 'Asia/Kolkata', hour: 23 },
    ];
    // Every 15 minutes across both 2026 US and EU transitions.
    const instants: Date[] = [];
    for (const start of [
      '2026-03-07T12:00:00Z',
      '2026-03-28T12:00:00Z',
      '2026-10-24T12:00:00Z',
      '2026-10-31T12:00:00Z',
    ]) {
      for (let step = 0; step < 4 * 48; step++) {
        instants.push(new Date(Date.parse(start) + step * 15 * 60_000));
      }
    }
    const at = Prisma.sql`x.at`;
    for (const boundary of boundaries) {
      const rows = await owner.$queryRaw<Array<{ at: Date; day: string; hour: number }>>`
        SELECT x.at, ${localDayKeySql(at, boundary)} AS day, ${localHourSql(at, boundary)} AS hour
          FROM unnest(${instants}::timestamptz[]) AS x(at)`;
      expect(rows).toHaveLength(instants.length);
      for (const row of rows) {
        const label = `${row.at.toISOString()} ${boundary.timezone}@${boundary.hour}`;
        expect(row.day, label).toBe(localDayKey(row.at, boundary.timezone, boundary.hour));
        const wallHour = Number(
          new Intl.DateTimeFormat('en-US', {
            timeZone: boundary.timezone,
            hourCycle: 'h23',
            hour: 'numeric',
          }).format(row.at),
        );
        expect(row.hour, label).toBe(wallHour);
      }
    }
  });
});

describe('calendar-day report ranges (tm 459 · F45)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let headers: Record<string, string>;

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
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read', 'reports_manage'],
    });
    headers = { authorization: `Bearer ${token}` };
    for (const at of [LATE_EVENING, MIDDAY, NEXT_LATE_EVENING]) {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Oyuncu' },
        select: { id: true },
      });
      const chatId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: false },
      });
      await owner.thread.create({
        data: {
          id: generateShortId(),
          chatId,
          licenseId: fx.a.licenseId,
          active: false,
          createdAt: at,
          closedAt: new Date(at.getTime() + 60_000),
        },
      });
    }
  });

  const get = (path: string) => server.get(path, headers);

  it('reads from=to=<day> as that whole workspace day', async () => {
    const response = await get('/reports/breakdown?from=2026-11-05&to=2026-11-05');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { by_day: Json[]; range: { from: string; to: string } };
    // 21:30Z on the 4th and noon on the 5th are Istanbul's 5 November; 21:30Z
    // on the 5th is already the 6th there.
    expect(body.by_day.map((row) => [row.date, row.chats])).toEqual([['2026-11-05', 2]]);
    expect(body.range).toEqual({
      from: '2026-11-04T21:00:00.000Z',
      to: '2026-11-05T20:59:59.999Z',
    });

    const overview = await get('/reports/overview?from=2026-11-05&to=2026-11-05');
    expect(overview.statusCode, overview.body).toBe(200);
    expect((overview.json() as { totals: { chats: number } }).totals.chats).toBe(2);

    // The export reads the same day.
    const csv = await get('/reports/export?group=breakdown&from=2026-11-05&to=2026-11-05');
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body).toContain('day,2026-11-05,2,');
  });

  it('places a calendar day on the workspace zone, UTC included', async () => {
    const brandId = await seedDefaultBrand(owner, fx.a.licenseId);
    await owner.inboxSettings.create({
      data: { licenseId: fx.a.licenseId, brandId, dayBoundaryTz: 'UTC' },
    });
    const response = await get('/reports/breakdown?from=2026-11-05&to=2026-11-05');
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as { by_day: Json[] };
    expect(body.by_day.map((row) => [row.date, row.chats])).toEqual([['2026-11-05', 2]]);
    const window = (response.json() as { range: { from: string; to: string } }).range;
    expect(window).toEqual({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-05T23:59:59.999Z' });
  });

  it('reads a calendar-day availability window as the same workspace day', async () => {
    const response = await get('/reports/availability?from=2026-11-05&to=2026-11-05');
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as { range: Json }).range).toEqual({
      from: '2026-11-04T21:00:00.000Z',
      to: '2026-11-05T20:59:59.999Z',
    });
    const malformed = await get('/reports/availability?from=2026-02-30&to=2026-03-02');
    expect(malformed.statusCode, malformed.body).toBe(400);
  });

  it('mixes a day with an instant: each end keeps its own meaning', async () => {
    const response = await get('/reports/breakdown?from=2026-11-05&to=2026-11-05T12:00:00.000Z');
    expect(response.statusCode, response.body).toBe(200);
    expect((response.json() as { range: Json }).range).toEqual({
      from: '2026-11-04T21:00:00.000Z',
      to: '2026-11-05T12:00:00.000Z',
    });
  });

  it('refuses the same instant on both ends with range_empty', async () => {
    const at = '2026-11-05T00:00:00.000Z';
    for (const path of [
      `/reports/breakdown?from=${at}&to=${at}`,
      `/reports/overview?from=${at}&to=${at}`,
      `/reports/export?group=overview&from=${at}&to=${at}`,
      `/reports/staffing-forecast?from=${at}&to=${at}`,
    ]) {
      const response = await get(path);
      expect(response.statusCode, path).toBe(400);
      expect((response.json() as { error: { type: string } }).error.type, path).toBe('range_empty');
    }
    const share = await server.post(
      '/reports/share-links',
      { group: 'overview', from: at, to: at },
      headers,
    );
    expect(share.statusCode, share.body).toBe(400);
    expect((share.json() as { error: { type: string } }).error.type).toBe('range_empty');
  });

  it('keeps the reversed-range and malformed-day refusals as validation errors', async () => {
    for (const path of [
      '/reports/breakdown?from=2026-11-06&to=2026-11-05',
      '/reports/breakdown?from=2026-11-05T12:00:00Z&to=2026-11-05T11:00:00Z',
      '/reports/breakdown?from=2026-02-30&to=2026-03-02',
      '/reports/breakdown?from=yesterday',
    ]) {
      const response = await get(path);
      expect(response.statusCode, path).toBe(400);
      expect((response.json() as { error: { type: string } }).error.type, path).toBe('validation');
    }
  });
});
