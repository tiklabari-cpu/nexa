/**
 * Roster projection arithmetic (WORKSCHED-g).
 *
 * The negatives come first, for the same reason they do in `presence-coverage`:
 * every failure mode here produces a *plausible* number rather than an error. A
 * missing plan read as "nobody is rostered", a default week counted as a
 * commitment, an unresolvable zone silently treated as UTC — each one yields a
 * roster grid that looks exactly as convincing as a correct one, and a staffing
 * decision gets made on it.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_SCHEDULE, WORK_SCHEDULE_DAYS, type WorkScheduleSlot } from '@nexa/types';
import { rosterCoverage, type RosterCell, type RosterPlan } from './roster-coverage.js';

/** Mid-January: northern-hemisphere winter offsets, no DST edge in sight. */
const AT = new Date('2026-01-14T12:00:00.000Z');

const HOURS_PER_DAY = 24;
/** UTC weekday numbers, the `getUTCDay()` convention the grid uses. */
const SUNDAY = 0;
const MONDAY = 1;
const TUESDAY = 2;
const SATURDAY = 6;

const slot = (
  day: (typeof WORK_SCHEDULE_DAYS)[number],
  start: string,
  end: string,
  enabled = true,
): WorkScheduleSlot => ({ day, start, end, enabled });

const plan = (
  agentId: string,
  schedule: WorkScheduleSlot[],
  timezone = 'UTC',
): RosterPlan => ({ agentId, timezone, schedule });

const cellAt = (cells: RosterCell[], dayOfWeek: number, hour: number): RosterCell => {
  const cell = cells[dayOfWeek * HOURS_PER_DAY + hour];
  if (!cell) throw new Error(`no cell for day ${dayOfWeek} hour ${hour}`);
  // Guards the index arithmetic itself: a shifted grid would otherwise make
  // every assertion below read the wrong cell and still pass somewhere.
  expect([cell.dayOfWeek, cell.hour]).toEqual([dayOfWeek, hour]);
  return cell;
};

/** Every cell carrying a roster, as `[dayOfWeek, hour, agents]`. */
const rostered = (cells: RosterCell[]): Array<[number, number, number]> =>
  cells
    .filter((cell) => cell.rosteredAgents !== 0)
    .map((cell) => [cell.dayOfWeek, cell.hour, cell.rosteredAgents]);

describe('rosterCoverage (PRD §5.3-Vardiya)', () => {
  // ==========================================================================
  // Unknown is not zero
  // ==========================================================================

  it('returns null — not zeroes — when nobody has a saved plan', () => {
    // A workspace that never opened the schedule screen has an *unknown* plan.
    // A grid of zeros would state the opposite ("nobody is planned"), which the
    // forecast would render as a staffing gap for all 168 hours of the week.
    expect(rosterCoverage([], AT)).toBeNull();
  });

  it('returns null when every plan carries a zone this runtime cannot resolve', () => {
    // Falling back to UTC would place real shifts on the wrong hours — a wrong
    // number that reads as a right one. Nothing placeable means nothing known.
    const nowhere = [
      plan('a', [slot('monday', '09:00', '17:00')], 'Mars/Olympus'),
      plan('b', [slot('monday', '09:00', '17:00')], ''),
    ];
    expect(rosterCoverage(nowhere, AT)).toBeNull();
  });

  it('reports a rostered-nowhere agent as 0, not as unknown', () => {
    // The mirror of the rule above: once one plan exists, an empty hour is a
    // fact ("nobody is scheduled then"), and reporting it as unknown would hide
    // the very gap this feature is for.
    const cells = rosterCoverage([plan('a', [slot('monday', '09:00', '17:00', false)])], AT);

    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(168);
    expect(rostered(cells ?? [])).toEqual([]);
  });

  it('never counts the default week for an agent with no saved row', () => {
    // The editor pre-fills Mon-Fri 09:00-18:00 for an agent who has never set a
    // schedule; that suggestion is not a commitment. A caller that passed it in
    // as if it were would put a full working week on a workspace that has
    // planned nothing — so the caller passes *rows*, and no row means no plan.
    expect(rosterCoverage([], AT)).toBeNull();

    // Sanity: the default week is a real schedule when someone actually saves it.
    const saved = rosterCoverage([plan('a', [...DEFAULT_WORK_SCHEDULE.schedule])], AT);
    expect(cellAt(saved ?? [], MONDAY, 9).rosteredAgents).toBe(1);
    expect(cellAt(saved ?? [], SATURDAY, 9).rosteredAgents).toBe(0);
  });

  // ==========================================================================
  // Rejections — a bad argument is a caller bug, not a small number
  // ==========================================================================

  it('rejects a non-array plan list and an invalid instant', () => {
    expect(() => rosterCoverage(undefined as unknown as RosterPlan[], AT)).toThrow(TypeError);
    expect(() => rosterCoverage([], new Date('nope'))).toThrow(TypeError);
    expect(() => rosterCoverage([], undefined as unknown as Date)).toThrow(TypeError);
  });

  it('skips a malformed slot rather than placing a shift nobody can read', () => {
    // A row edited by hand in psql, or written before a rule tightened, can hold
    // any of these. Each is dropped; the well-formed Tuesday still lands.
    const broken = plan('a', [
      { day: 'nonesuch', start: '09:00', end: '10:00', enabled: true } as unknown as WorkScheduleSlot,
      slot('monday', '9:00', '10:00'),
      slot('wednesday', '10:00', '10:00'),
      slot('thursday', '11:00', '10:00'),
      slot('tuesday', '09:00', '10:00'),
    ]);

    expect(rostered(rosterCoverage([broken], AT) ?? [])).toEqual([[TUESDAY, 9, 1]]);
  });

  // ==========================================================================
  // The grid
  // ==========================================================================

  it('returns a full 7 × 24 grid in a fixed order', () => {
    const cells = rosterCoverage([plan('a', [slot('monday', '09:00', '10:00')])], AT) ?? [];

    expect(cells).toHaveLength(168);
    expect(cells[0]).toMatchObject({ dayOfWeek: 0, hour: 0 });
    expect(cells[167]).toMatchObject({ dayOfWeek: 6, hour: 23 });
    expect(cells.map((cell) => `${cell.dayOfWeek}:${cell.hour}`)).toEqual(
      Array.from({ length: 168 }, (_, i) => `${Math.floor(i / 24)}:${i % 24}`),
    );
  });

  it('maps the plan weekday onto the UTC weekday number, Monday-first to Sunday-first', () => {
    // WORK_SCHEDULE_DAYS starts on Monday; the grid starts on Sunday. An
    // off-by-one here would silently move every shift a day.
    const week = WORK_SCHEDULE_DAYS.map((day) => slot(day, '00:00', '01:00'));
    const cells = rosterCoverage([plan('a', week)], AT) ?? [];

    expect(rostered(cells).map(([dayOfWeek]) => dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(cellAt(cells, SUNDAY, 0).rosteredAgents).toBe(1);
    expect(cellAt(cells, MONDAY, 0).rosteredAgents).toBe(1);
  });

  it('splits a shift at hour boundaries instead of billing it to its first hour', () => {
    // 08:45 → 10:10 is 15 minutes of hour 8, all of hour 9 and 10 of hour 10.
    const cells = rosterCoverage([plan('a', [slot('tuesday', '08:45', '10:10')])], AT) ?? [];

    expect(rostered(cells)).toEqual([
      [TUESDAY, 8, 0.25],
      [TUESDAY, 9, 1],
      [TUESDAY, 10, round3(10 / 60)],
    ]);
  });

  it('sums agents rostered on the same hour', () => {
    const cells =
      rosterCoverage(
        [
          plan('a', [slot('monday', '09:00', '12:00')]),
          plan('b', [slot('monday', '09:00', '10:00')]),
          plan('c', [slot('monday', '09:30', '10:00')]),
        ],
        AT,
      ) ?? [];

    expect(cellAt(cells, MONDAY, 9).rosteredAgents).toBe(2.5);
    expect(cellAt(cells, MONDAY, 10).rosteredAgents).toBe(1);
    expect(cellAt(cells, MONDAY, 12).rosteredAgents).toBe(0);
  });

  // ==========================================================================
  // Timezones
  // ==========================================================================

  it('shifts a plan by its zone offset', () => {
    // Istanbul is UTC+3 year-round, so 09:00-10:00 local is 06:00-07:00 UTC.
    const cells =
      rosterCoverage([plan('a', [slot('monday', '09:00', '10:00')], 'Europe/Istanbul')], AT) ?? [];

    expect(rostered(cells)).toEqual([[MONDAY, 6, 1]]);
  });

  it('wraps a shift that crosses the week boundary in UTC', () => {
    // Monday 00:00-08:00 in UTC+9 is Sunday 15:00-23:00 UTC — the *previous*
    // day, and past the Monday-first week's own start. Without wrapping those
    // minutes would fall off the grid entirely.
    const cells =
      rosterCoverage([plan('a', [slot('monday', '00:00', '08:00')], 'Asia/Tokyo')], AT) ?? [];

    expect(rostered(cells)).toEqual(
      Array.from({ length: 8 }, (_, i): [number, number, number] => [SUNDAY, 15 + i, 1]),
    );
  });

  it('wraps the other way too, for a zone behind UTC', () => {
    // Sunday 20:00-23:00 in UTC-5 is Monday 01:00-04:00 UTC — past the end of
    // the week, back around to its start.
    const cells =
      rosterCoverage([plan('a', [slot('sunday', '20:00', '23:00')], 'America/New_York')], AT) ?? [];

    expect(rostered(cells)).toEqual([
      [MONDAY, 1, 1],
      [MONDAY, 2, 1],
      [MONDAY, 3, 1],
    ]);
  });

  it('reads each zone at the given instant, so a DST change moves the plan', () => {
    // Same plan, same code, two instants either side of the US spring-forward:
    // 09:00 New York is 14:00 UTC in winter and 13:00 UTC in summer. The
    // documented approximation is that one instant decides the whole week — this
    // pins which instant that is, and that it is not the wall clock.
    const shift = [slot('tuesday', '09:00', '10:00')];
    const winter =
      rosterCoverage([plan('a', shift, 'America/New_York')], new Date('2026-01-14T12:00:00Z')) ?? [];
    const summer =
      rosterCoverage([plan('a', shift, 'America/New_York')], new Date('2026-07-14T12:00:00Z')) ?? [];

    expect(rostered(winter)).toEqual([[TUESDAY, 14, 1]]);
    expect(rostered(summer)).toEqual([[TUESDAY, 13, 1]]);
  });

  it('drops only the unplaceable plan, keeping the rest of the workspace', () => {
    const mixed = [
      plan('a', [slot('monday', '09:00', '10:00')], 'Nowhere/Nothing'),
      plan('b', [slot('monday', '09:00', '10:00')]),
    ];

    expect(rostered(rosterCoverage(mixed, AT) ?? [])).toEqual([[MONDAY, 9, 1]]);
  });

  // ==========================================================================
  // Determinism — the property the forecast's own determinism rests on
  // ==========================================================================

  it('is byte-identical across runs and independent of plan order', () => {
    const plans = [
      plan('a', [slot('monday', '09:00', '17:30')], 'Europe/Istanbul'),
      plan('b', [slot('monday', '22:00', '23:45')], 'Asia/Tokyo'),
      plan('c', [...DEFAULT_WORK_SCHEDULE.schedule], 'America/New_York'),
    ];

    const once = rosterCoverage(plans, AT);
    const again = rosterCoverage([...plans].reverse(), AT);

    expect(JSON.stringify(once)).toBe(JSON.stringify(again));
  });

  it('is a week, not a window — the same plans give the same grid whatever range is reported', () => {
    // The unit is one standing week: nothing here is divided by how many times
    // an hour occurred, so a 7-day report and a 90-day report read the plan the
    // same way. (`at` only selects the zone offset.)
    const plans = [plan('a', [slot('friday', '09:00', '17:00')], 'Europe/Istanbul')];

    expect(rosterCoverage(plans, new Date('2026-01-14T12:00:00Z'))).toEqual(
      rosterCoverage(plans, new Date('2026-02-20T12:00:00Z')),
    );
  });
});

/** The module's own three-decimal rounding, so expectations state exact values. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
