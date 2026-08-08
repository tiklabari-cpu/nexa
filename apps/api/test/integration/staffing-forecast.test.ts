/**
 * `GET /reports/staffing-forecast` (PRD §5.3-Vardiya, WORKSCHED-g).
 *
 * A staffing number is *plausible whatever it says*, which is what makes this
 * endpoint dangerous: a wrong figure is not noticed, it is staffed to. So the
 * claims under test are the ones that fail silently.
 *
 *   - **It is one tenant's grid.** Volume, presence and rosters are three
 *     separate reads, and each is a fresh chance to forget the license boundary.
 *     A leak here shows up as a perfectly reasonable forecast built partly on
 *     someone else's week.
 *   - **Unknown never renders as zero.** Four different unknowns (too little
 *     history, no handling time, no presence log, no saved plan) each have to
 *     answer `null`; a 0 in any of them reads as a measurement and turns a
 *     "we don't know" into a staffing gap or, worse, into full coverage.
 *   - **The volume agrees with the volume report** (ADR-09). Two counters meant
 *     to agree will not, and here the second one would be arguing about staff.
 *
 * The negatives — who is refused, and which ranges are — come first, before
 * anything proves the endpoint works at all.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/**
 * Monday 2026-03-02 to Monday 2026-03-09 — exactly one week, so every
 * weekday-hour of the grid occurred exactly once and a cell's rate *is* its
 * tally. Arithmetic anyone can redo on paper is the point of this feature.
 */
const FROM = '2026-03-02T00:00:00.000Z';
const TO = '2026-03-09T00:00:00.000Z';
const RANGE = `from=${FROM}&to=${TO}`;

/** UTC weekday numbers (`getUTCDay()`), the axis the response uses. */
const MONDAY = 1;
const TUESDAY = 2;
const WEDNESDAY = 3;
const THURSDAY = 4;

/** Fixtures give every license two agents, both on the schema default limit. */
const AGENTS = 2;
const CONCURRENT_LIMIT = 6;

interface Cell {
  day_of_week: number;
  hour: number;
  observed_chats: number;
  required_agents: number | null;
  scheduled_agents: number | null;
  rostered_agents: number | null;
  gap: number | null;
  low_confidence: boolean;
}

interface Forecast {
  range: { from: string; to: string };
  inputs: {
    concurrent_chats_limit: number | null;
    average_chat_minutes: number | null;
    minimum_sample_chats: number;
    agents: number;
  };
  coverage_known: boolean;
  roster_known: boolean;
  low_confidence: boolean;
  cells: Cell[];
}

describe('staffing forecast (PRD §5.3-Vardiya)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;

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

    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });
  });

  const auth = {
    get authorization() {
      return `Bearer ${token}`;
    },
  };

  const forecast = async (query = RANGE, headers = auth): Promise<Forecast> => {
    const res = await server.get(`/reports/staffing-forecast?${query}`, { ...headers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as Forecast;
  };

  const cellAt = (body: Forecast, dayOfWeek: number, hour: number): Cell => {
    const cell = body.cells.find((c) => c.day_of_week === dayOfWeek && c.hour === hour);
    if (!cell) throw new Error(`no cell for day ${dayOfWeek} hour ${hour}`);
    return cell;
  };

  // Seeded as the owner (RLS-exempt) so a scenario can place exactly the week it
  // wants to probe — including the other tenant's, which no API call could make.

  /**
   * `count` chats starting at one instant, optionally closed after `minutes`.
   *
   * A customer each, because a license may hold only one *active* chat per
   * customer (`chats (license_id, customer_id) WHERE active`) — and a forecast
   * cell needs more chats than one visitor can have open.
   */
  async function chatsAt(
    t: TenantFixture,
    at: string,
    count: number,
    closedAfterMinutes: number | null,
  ): Promise<void> {
    const createdAt = new Date(at);
    const closedAt =
      closedAfterMinutes === null
        ? null
        : new Date(createdAt.getTime() + closedAfterMinutes * 60_000);

    for (let i = 0; i < count; i += 1) {
      const chatId = generateShortId();
      const customer = await owner.customer.create({
        data: { organizationId: t.organizationId, name: `Visitor ${chatId}` },
        select: { id: true },
      });
      await owner.chat.create({
        data: {
          id: chatId,
          licenseId: t.licenseId,
          customerId: customer.id,
          active: closedAt === null,
          createdAt,
        },
      });
      await owner.thread.create({
        data: {
          id: generateShortId(),
          chatId,
          licenseId: t.licenseId,
          active: closedAt === null,
          createdAt,
          closedAt,
        },
      });
    }
  }

  /** One online stretch in the presence log: `accepting_chats` then `offline`. */
  async function onlineFrom(t: TenantFixture, start: string, end: string): Promise<void> {
    await owner.agentPresenceEvent.createMany({
      data: [
        {
          licenseId: t.licenseId,
          agentId: t.agentAccountId,
          status: 'accepting_chats',
          changedAt: new Date(start),
        },
        {
          licenseId: t.licenseId,
          agentId: t.agentAccountId,
          status: 'offline',
          changedAt: new Date(end),
        },
      ],
    });
  }

  /** A saved weekly plan — one weekday only, so the empty days stay assertable. */
  async function roster(
    t: TenantFixture,
    day: string,
    start: string,
    end: string,
    timezone = 'UTC',
  ): Promise<void> {
    await owner.workSchedule.create({
      data: {
        licenseId: t.licenseId,
        agentId: t.agentAccountId,
        timezone,
        schedule: [{ day, start, end, enabled: true }],
      },
    });
  }

  /**
   * Tenant A's week: 24 chats in Tuesday 10:00 each handled for 30 minutes, 5 in
   * Wednesday 11:00 still open, the agent online Tuesday 09:00-12:00 and
   * rostered for exactly those hours.
   *
   * Every figure the assertions below quote follows from those numbers alone:
   * 24 chats an hour × 30 minutes each is 12 concurrent, and one agent holds 6,
   * so Tuesday 10:00 needs 2 — against the 1 who was actually there.
   */
  async function seedWeek(t: TenantFixture): Promise<void> {
    await chatsAt(t, '2026-03-03T10:15:00.000Z', 24, 30);
    await chatsAt(t, '2026-03-04T11:20:00.000Z', 5, null);
    await onlineFrom(t, '2026-03-03T09:00:00.000Z', '2026-03-03T12:00:00.000Z');
    await roster(t, 'tuesday', '09:00', '12:00');
  }

  // ==========================================================================
  // Who is refused (NFR-S3)
  // ==========================================================================

  it('refuses a token without reports_read', async () => {
    const other = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents--all:ro'],
    });

    const res = await server.get(`/reports/staffing-forecast?${RANGE}`, {
      authorization: `Bearer ${other}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await server.get(`/reports/staffing-forecast?${RANGE}`);
    expect(res.statusCode).toBe(401);
  });

  // ==========================================================================
  // Which ranges are refused
  // ==========================================================================

  it('rejects a reversed range and an unparseable date', async () => {
    const reversed = await server.get(
      `/reports/staffing-forecast?from=${TO}&to=${FROM}`,
      { ...auth },
    );
    expect(reversed.statusCode).toBe(400);

    const nonsense = await server.get('/reports/staffing-forecast?from=yesterday', { ...auth });
    expect(nonsense.statusCode).toBe(400);
  });

  it('rejects a range wider than a year rather than reading it slowly', async () => {
    // This endpoint walks raw rows in JavaScript, so an unbounded range would let
    // a caller size the work. Refusing says so; a silent cap would answer with a
    // number derived from part of the window and look identical.
    const res = await server.get(
      '/reports/staffing-forecast?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z',
      { ...auth },
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error?.message ?? '').toMatch(/366 days/);
  });

  // ==========================================================================
  // Cross-tenant isolation (NFR-S4)
  // ==========================================================================

  it("never shows another license's volume, presence or roster", async () => {
    // B's week is loud and lands on a weekday A never used, so a leak is not a
    // rounding difference — it is a populated Thursday in an empty grid.
    await chatsAt(fx.b, '2026-03-05T14:10:00.000Z', 40, 30);
    await onlineFrom(fx.b, '2026-03-05T08:00:00.000Z', '2026-03-05T20:00:00.000Z');
    await roster(fx.b, 'thursday', '08:00', '20:00');

    const body = await forecast();

    // A has nothing at all: not B's chats, not B's presence, not B's plan.
    expect(body.cells.every((cell) => cell.observed_chats === 0)).toBe(true);
    expect(cellAt(body, THURSDAY, 14).observed_chats).toBe(0);
    expect(body.coverage_known).toBe(false);
    expect(body.roster_known).toBe(false);
    expect(cellAt(body, THURSDAY, 14).scheduled_agents).toBeNull();
    expect(cellAt(body, THURSDAY, 14).rostered_agents).toBeNull();
    expect(body.low_confidence).toBe(true);

    // And B, asking for the same window, sees its own week — proof the data was
    // there to be leaked and the grid above was not empty for some other reason.
    const theirToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['reports_read'],
    });
    const theirs = await forecast(RANGE, { authorization: `Bearer ${theirToken}` });

    expect(cellAt(theirs, THURSDAY, 14).observed_chats).toBe(40);
    expect(theirs.coverage_known).toBe(true);
    expect(theirs.roster_known).toBe(true);
  });

  it('keeps two licenses independent when both have a week', async () => {
    await seedWeek(fx.a);
    await chatsAt(fx.b, '2026-03-05T14:10:00.000Z', 40, 30);

    const body = await forecast();

    expect(cellAt(body, TUESDAY, 10).observed_chats).toBe(24);
    expect(cellAt(body, THURSDAY, 14).observed_chats).toBe(0);
  });

  // ==========================================================================
  // The grid
  // ==========================================================================

  it('returns the full 7 × 24 grid in a fixed order, whatever the data', async () => {
    const body = await forecast();

    expect(body.cells).toHaveLength(168);
    expect(body.cells.map((cell) => `${cell.day_of_week}:${cell.hour}`)).toEqual(
      Array.from({ length: 168 }, (_, i) => `${Math.floor(i / 24)}:${i % 24}`),
    );
    expect(body.range).toEqual({ from: FROM, to: TO });
  });

  it('defaults to the last 30 days when no range is given', async () => {
    const body = await forecast('');

    expect(body.cells).toHaveLength(168);
    const span = Date.parse(body.range.to) - Date.parse(body.range.from);
    expect(Math.round(span / 86_400_000)).toBe(30);
  });

  it('recommends staffing from the observed load, and names what it derived it from', async () => {
    await seedWeek(fx.a);

    const body = await forecast();
    const busy = cellAt(body, TUESDAY, 10);

    expect(body.inputs).toEqual({
      concurrent_chats_limit: CONCURRENT_LIMIT,
      average_chat_minutes: 30,
      minimum_sample_chats: 20,
      agents: AGENTS,
    });

    // 24 chats/hour × 30 min = 12 concurrent; one agent holds 6 → 2 needed.
    expect(busy).toEqual({
      day_of_week: TUESDAY,
      hour: 10,
      observed_chats: 24,
      required_agents: 2,
      scheduled_agents: 1,
      rostered_agents: 1,
      gap: 1,
      low_confidence: false,
    });
    expect(body.low_confidence).toBe(false);
    expect(body.coverage_known).toBe(true);
    expect(body.roster_known).toBe(true);
  });

  it('reports presence and roster on the hours around the busy one', async () => {
    await seedWeek(fx.a);
    const body = await forecast();

    // 09:00-12:00 online and rostered; nothing arrived in 09:00 or 11:00, so
    // those hours are covered but not forecast.
    for (const hour of [9, 11]) {
      expect(cellAt(body, TUESDAY, hour).scheduled_agents, `hour ${hour}`).toBe(1);
      expect(cellAt(body, TUESDAY, hour).rostered_agents, `hour ${hour}`).toBe(1);
      expect(cellAt(body, TUESDAY, hour).required_agents, `hour ${hour}`).toBeNull();
    }
    expect(cellAt(body, TUESDAY, 12).scheduled_agents).toBe(0);
    expect(cellAt(body, TUESDAY, 12).rostered_agents).toBe(0);
    expect(cellAt(body, MONDAY, 10).rostered_agents).toBe(0);
  });

  // ==========================================================================
  // Unknown is not zero
  // ==========================================================================

  it('answers null — not 0 — for every unknown when the license has no history', async () => {
    const body = await forecast();

    expect(body.coverage_known).toBe(false);
    expect(body.roster_known).toBe(false);
    expect(body.low_confidence).toBe(true);
    expect(body.inputs.average_chat_minutes).toBeNull();
    expect(body.inputs.concurrent_chats_limit).toBe(CONCURRENT_LIMIT);

    for (const cell of body.cells) {
      expect(cell.required_agents).toBeNull();
      expect(cell.scheduled_agents).toBeNull();
      expect(cell.rostered_agents).toBeNull();
      expect(cell.gap).toBeNull();
      expect(cell.low_confidence).toBe(true);
      expect(cell.observed_chats).toBe(0);
    }
  });

  it('keeps a thin cell null rather than forecasting from a handful of chats', async () => {
    await seedWeek(fx.a);
    const body = await forecast();
    const thin = cellAt(body, WEDNESDAY, 11);

    // Five chats is a real count and is reported as one — but a rate built on it
    // is noise, so the recommendation stays absent.
    expect(thin.observed_chats).toBe(5);
    expect(thin.required_agents).toBeNull();
    expect(thin.gap).toBeNull();
    expect(thin.low_confidence).toBe(true);
    // The presence log exists, so an hour nobody was online is a real 0.
    expect(thin.scheduled_agents).toBe(0);
  });

  it('withholds every recommendation when no conversation closed, instead of inventing a duration', async () => {
    // Enough volume to clear the sample bar, but nothing ever closed — so there
    // is no handling time, and sizing against a made-up one would produce a
    // number that looks exactly like a measured one.
    await chatsAt(fx.a, '2026-03-03T10:15:00.000Z', 40, null);
    await onlineFrom(fx.a, '2026-03-03T09:00:00.000Z', '2026-03-03T12:00:00.000Z');

    const body = await forecast();
    const busy = cellAt(body, TUESDAY, 10);

    expect(body.inputs.average_chat_minutes).toBeNull();
    expect(body.low_confidence).toBe(true);
    // The volume and the coverage are still facts, and are still reported.
    expect(busy.observed_chats).toBe(40);
    expect(busy.scheduled_agents).toBe(1);
    expect(busy.required_agents).toBeNull();
    expect(busy.gap).toBeNull();
  });

  it('withholds every recommendation when the workspace has no active agent', async () => {
    // Suspended agents are the pool routing already skips, so a workspace of
    // suspended people has no capacity to divide by — the same unknown as a
    // missing handling time, and the same answer.
    //
    // Asked with a bot credential on purpose: a human's token resolves through
    // their membership, so suspending everyone would 401 the very caller trying
    // to read the report. An integration reading reports is exactly who still
    // can, and exactly who would be shown a fabricated number.
    await chatsAt(fx.a, '2026-03-03T10:15:00.000Z', 40, 30);
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { suspended: true },
    });
    const bot = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      kind: 'bot',
      scopes: ['reports_read'],
    });

    const body = await forecast(RANGE, { authorization: `Bearer ${bot}` });

    expect(body.inputs.concurrent_chats_limit).toBeNull();
    expect(body.inputs.agents).toBe(0);
    expect(body.inputs.average_chat_minutes).toBe(30);
    expect(cellAt(body, TUESDAY, 10).observed_chats).toBe(40);
    expect(cellAt(body, TUESDAY, 10).required_agents).toBeNull();
    expect(body.low_confidence).toBe(true);
  });

  it('never counts the default week as a roster the workspace committed to', async () => {
    // Reading one agent's schedule answers with Monday-Friday 09:00-18:00 even
    // when nothing was ever saved. That pre-fill is a suggestion; counting it
    // here would put a full working week on a workspace that planned nothing —
    // and hide the gap this report exists to show.
    await chatsAt(fx.a, '2026-03-03T10:15:00.000Z', 24, 30);

    const single = await server.get(`/agents/${fx.a.agentAccountId}/work-schedule`, {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents--all:ro'],
      })}`,
    });
    expect(single.statusCode).toBe(200);
    expect(single.json().schedule).toEqual(
      expect.arrayContaining([{ day: 'monday', start: '09:00', end: '18:00', enabled: true }]),
    );

    const body = await forecast();
    expect(body.roster_known).toBe(false);
    expect(cellAt(body, MONDAY, 10).rostered_agents).toBeNull();
  });

  // ==========================================================================
  // ADR-09 — one definition of a chat in a window
  // ==========================================================================

  it('quotes the same hourly volume as /reports/breakdown', async () => {
    await seedWeek(fx.a);
    // A second cell in the same hour of a different day, so the check is a real
    // fold across the week rather than one cell compared to itself.
    await chatsAt(fx.a, '2026-03-06T10:40:00.000Z', 7, 30);

    const staffing = await forecast();
    const breakdown = await server.get(`/reports/breakdown?${RANGE}`, { ...auth });
    expect(breakdown.statusCode).toBe(200);
    const byHour = breakdown.json().by_hour as Array<{ hour: number; chats: number }>;

    expect(byHour).toHaveLength(24);
    for (const row of byHour) {
      const summed = staffing.cells
        .filter((cell) => cell.hour === row.hour)
        .reduce((total, cell) => total + cell.observed_chats, 0);
      expect(summed, `hour ${row.hour}`).toBe(row.chats);
    }
    // Guards the guard: an all-zero comparison would pass vacuously.
    expect(byHour.reduce((total, row) => total + row.chats, 0)).toBe(36);
  });

  // ==========================================================================
  // Timezones — a plan is local wall-clock time
  // ==========================================================================

  it('places a rostered shift by the plan timezone, not by UTC', async () => {
    // 09:00-12:00 in Istanbul (UTC+3) is 06:00-09:00 UTC. Reading the stored
    // hours as if they were UTC would put the whole roster three hours late —
    // plausible, and wrong in the direction that hides a morning gap.
    await roster(fx.a, 'tuesday', '09:00', '12:00', 'Europe/Istanbul');

    const body = await forecast();

    expect(body.roster_known).toBe(true);
    expect(cellAt(body, TUESDAY, 6).rostered_agents).toBe(1);
    expect(cellAt(body, TUESDAY, 9).rostered_agents).toBe(0);
  });
});
