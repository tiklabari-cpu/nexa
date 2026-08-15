/**
 * The SLA clock, on paper values (FR-MOD-11.5 · 11.5-d).
 *
 * The arithmetic here decides whether a team is told it broke a promise, and an
 * elapsed figure is plausible whatever it says — so the cases that matter are
 * the ones where a plausible-looking answer would be wrong: a wait that spans a
 * night, a timezone that moves a shift across midnight UTC, a workspace that
 * has published no hours at all.
 */
import { describe, expect, it } from 'vitest';
import { WORK_SCHEDULE_DAYS, type WorkScheduleSlot } from '@nexa/types';
import { buildBusinessWeek, elapsedMinutes, isBreach } from './business-hours.js';

/** A weekday plan: the named days open for the given window, the rest off. */
function plan(
  days: readonly string[],
  start: string,
  end: string,
  timezone = 'UTC',
): { timezone: string; schedule: WorkScheduleSlot[] } {
  return {
    timezone,
    schedule: WORK_SCHEDULE_DAYS.map((day) => ({
      day,
      start,
      end,
      enabled: days.includes(day),
    })),
  };
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/** 2026-08-17 is a Monday. */
const MONDAY = Date.UTC(2026, 7, 17);
const at = (dayOffset: number, hour: number, minute = 0): Date =>
  new Date(MONDAY + dayOffset * 86_400_000 + hour * 3_600_000 + minute * 60_000);

describe('buildBusinessWeek', () => {
  it('is null when no agent has published hours — nothing is known', () => {
    expect(buildBusinessWeek([], at(0, 12))).toBeNull();
  });

  it('is null when every plan names a zone the runtime cannot resolve', () => {
    // Dropped rather than read as UTC: falling back would open the workspace on
    // hours it never claimed, which is a wrong answer that looks right.
    expect(buildBusinessWeek([plan(WEEKDAYS, '09:00', '18:00', 'Mars/Olympus')], at(0, 12))).toBe(
      null,
    );
  });

  it('is a zero-hour calendar, not null, when a saved plan has every day off', () => {
    // "We are never open" is a claim; "nobody said" is not. Only the second is
    // null, and the caller treats them very differently.
    const week = buildBusinessWeek([plan([], '09:00', '18:00')], at(0, 12));
    expect(week).not.toBeNull();
    expect(week?.openMinutesPerWeek).toBe(0);
  });

  it('counts a weekday plan as 5 × 9 hours', () => {
    const week = buildBusinessWeek([plan(WEEKDAYS, '09:00', '18:00')], at(0, 12));
    expect(week?.openMinutesPerWeek).toBe(5 * 9 * 60);
  });

  it('unions overlapping plans rather than summing them', () => {
    // The workspace is open when *somebody* is rostered. Two agents on the same
    // shift do not make the day twice as long.
    const week = buildBusinessWeek(
      [plan(WEEKDAYS, '09:00', '18:00'), plan(WEEKDAYS, '09:00', '18:00')],
      at(0, 12),
    );
    expect(week?.openMinutesPerWeek).toBe(5 * 9 * 60);
  });

  it('unions disjoint plans into one longer day', () => {
    const week = buildBusinessWeek(
      [plan(['monday'], '09:00', '13:00'), plan(['monday'], '13:00', '17:00')],
      at(0, 12),
    );
    expect(week?.openMinutesPerWeek).toBe(8 * 60);
  });

  it('places a plan by its own timezone', () => {
    // 09:00-18:00 in UTC+3 is 06:00-15:00 UTC. The length is unchanged; where it
    // sits is not, which is the half a naive implementation gets wrong.
    const week = buildBusinessWeek(
      [plan(['monday'], '09:00', '18:00', 'Europe/Istanbul')],
      at(0, 12),
    );
    expect(week?.openMinutesPerWeek).toBe(9 * 60);
    // Monday 05:00-06:00 UTC is still closed; 06:00-07:00 is open.
    expect(elapsedMinutes(at(0, 5), at(0, 6), week)).toBe(0);
    expect(elapsedMinutes(at(0, 6), at(0, 7), week)).toBe(60);
  });
});

describe('elapsedMinutes', () => {
  it('runs continuously with no calendar', () => {
    expect(elapsedMinutes(at(0, 9), at(0, 11, 30), null)).toBe(150);
  });

  it('is zero when the end is not after the start', () => {
    // The two timestamps come from different writers; a skew between them must
    // not produce a negative wait no reader could interpret.
    expect(elapsedMinutes(at(0, 11), at(0, 9), null)).toBe(0);
    expect(elapsedMinutes(at(0, 9), at(0, 9), null)).toBe(0);
  });

  it('counts only open minutes inside a working day', () => {
    const week = buildBusinessWeek([plan(WEEKDAYS, '09:00', '18:00')], at(0, 12));
    expect(elapsedMinutes(at(0, 10), at(0, 11), week)).toBe(60);
  });

  it('does not count the night between two working days', () => {
    // The case the whole flag exists for: a message at 17:30 Monday answered at
    // 09:30 Tuesday waited 16 hours by the clock and one hour by the rota.
    const week = buildBusinessWeek([plan(WEEKDAYS, '09:00', '18:00')], at(0, 12));
    expect(elapsedMinutes(at(0, 17, 30), at(1, 9, 30), week)).toBe(60);
    expect(elapsedMinutes(at(0, 17, 30), at(1, 9, 30), null)).toBe(16 * 60);
  });

  it('does not count a closed weekend', () => {
    // Friday 17:00 → Monday 10:00: one working hour on Friday, one on Monday.
    const week = buildBusinessWeek([plan(WEEKDAYS, '09:00', '18:00')], at(0, 12));
    expect(elapsedMinutes(at(4, 17), at(7, 10), week)).toBe(120);
  });

  it('spans whole weeks without walking them', () => {
    // Three full weeks plus nothing: the prefix-sum path has to add whole weeks,
    // not loop, and getting the multiple wrong is invisible in a short span.
    const week = buildBusinessWeek([plan(WEEKDAYS, '09:00', '18:00')], at(0, 12));
    expect(elapsedMinutes(at(0, 0), at(21, 0), week)).toBe(3 * 5 * 9 * 60);
  });

  it('is zero for a wait entirely outside business hours', () => {
    const week = buildBusinessWeek([plan(WEEKDAYS, '09:00', '18:00')], at(0, 12));
    expect(elapsedMinutes(at(5, 2), at(5, 23), week)).toBe(0);
  });

  it('rounds toward not marking, at one-minute resolution', () => {
    // A 30-minute target is met by a reply at 30:59. A breach row is an
    // accusation; a target stated in minutes does not carry the precision to
    // make a second-level distinction stick.
    const from = new Date(at(0, 10).getTime());
    const to = new Date(at(0, 10, 30).getTime() + 59_000);
    expect(elapsedMinutes(from, to, null)).toBe(30);
  });
});

describe('isBreach', () => {
  it('is false when nothing was promised', () => {
    expect(isBreach(null, 10_000)).toBe(false);
  });

  it('is false on the target and true past it', () => {
    // Strictly greater, matching `sla_breaches_elapsed_check` in the database,
    // so the rule cannot drift between the two places that state it.
    expect(isBreach(30, 29)).toBe(false);
    expect(isBreach(30, 30)).toBe(false);
    expect(isBreach(30, 31)).toBe(true);
  });
});
