/**
 * Which summary is due, and what it covers (RP-05 · tm 372) — pure, in the
 * company's time zone, and the deterministic half of the sweep's idempotency.
 *
 * A summary is due at 08:00 local (`DIGEST_SEND_HOUR`) and reports on the
 * previous COMPLETE local day — or, on Mondays for the weekly one, the previous
 * local Monday-to-Sunday week. Two properties matter, and both are about the
 * key rather than the dates:
 *
 *   1. **The key names the covered period, never the moment of the sweep.**
 *      `D2026-10-31` is the 31st whenever it is mailed — at 08:00, or at 11:40
 *      because the server was away — so two sweeps, or two instances sweeping
 *      together, agree on what "this delivery" is and the second finds it taken.
 *   2. **A period is always whole.** Nothing is sent for the part of today that
 *      has elapsed: the key would then be taken and the real figures for the
 *      day could never go out.
 *
 * "Due" is a state, not an instant: from 08:00 until the next summary is due, the
 * latest one is the answer, so a sweep that runs late still sends it, once. A
 * weekly summary is only fresh for `DIGEST_WEEKLY_GRACE_HOURS`; after that it is
 * not due any more (`null`) rather than arriving days late.
 *
 * Wall-clock arithmetic is done on civil dates and converted to instants one
 * boundary at a time, so a 23- or 25-hour day (daylight saving) and a zone that
 * is not a whole number of hours from UTC both come out as the local day they
 * are. `to` is the last millisecond INSIDE the period, because every report
 * aggregation this feeds is a closed interval (`created_at >= from AND
 * created_at <= to`).
 */
import { DIGEST_SEND_HOUR, DIGEST_WEEKLY_GRACE_HOURS, type DigestFrequency } from '@siyahtus/types';
import { zoneOffsetMinutes } from '../staffing/roster-coverage.js';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** A calendar date with no zone: `month` is 1-12. */
interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface DigestPeriod {
  frequency: DigestFrequency;
  /** `D2026-10-31` (the local day covered) or `W2026-10-26` (the local Monday opening the week). */
  periodKey: string;
  /** Inclusive start: local midnight of the first day covered. */
  from: Date;
  /** Inclusive end: the last millisecond of the last day covered. */
  to: Date;
  /** The equal-length period before it, which the change figures compare against. */
  previous: { from: Date; to: Date };
  /** The instant the summary became due (08:00 local). */
  dueAt: Date;
  /** The covered dates for a subject line: `2026-11-01` or `2026-10-26 – 2026-11-01`. */
  label: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

const isoDate = (date: CivilDate): string => `${date.year}-${pad(date.month)}-${pad(date.day)}`;

function addDays(date: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
  };
}

/** 1 = Monday … 7 = Sunday. */
function isoWeekday(date: CivilDate): number {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** An unresolvable zone is UTC: a summary on the wrong clock beats none. */
function offsetMinutes(timeZone: string, at: Date): number {
  return zoneOffsetMinutes(timeZone, at) ?? 0;
}

/** The local calendar date an instant falls on in `timeZone`. */
export function localDate(at: Date, timeZone: string): CivilDate {
  const local = new Date(at.getTime() + offsetMinutes(timeZone, at) * MINUTE_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

/**
 * The instant a local wall-clock time happens. The offset is read at the guess
 * and again at the corrected instant, so a time just after a clock change lands
 * on the right side of it; a time that does not exist (spring forward) resolves
 * to the instant the clock jumps past it.
 */
export function zonedInstant(date: CivilDate, hour: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hour, 0, 0);
  const first = wall - offsetMinutes(timeZone, new Date(wall)) * MINUTE_MS;
  const second = wall - offsetMinutes(timeZone, new Date(first)) * MINUTE_MS;
  return new Date(second);
}

const startOfLocalDay = (date: CivilDate, timeZone: string): Date =>
  zonedInstant(date, 0, timeZone);

/** The span of `days` local days starting at `first`, as a closed interval. */
function span(first: CivilDate, days: number, timeZone: string): { from: Date; to: Date } {
  const from = startOfLocalDay(first, timeZone);
  const end = startOfLocalDay(addDays(first, days), timeZone);
  return { from, to: new Date(end.getTime() - 1) };
}

/**
 * The summary due at `now` for this frequency, or `null` when none is — a weekly
 * summary past its grace. Never a period that has not finished.
 */
export function dueDigestPeriod(
  frequency: DigestFrequency,
  now: Date,
  timeZone: string,
): DigestPeriod | null {
  const today = localDate(now, timeZone);

  if (frequency === 'daily') {
    // Today's summary once it is 08:00, yesterday's until then.
    const dueToday = zonedInstant(today, DIGEST_SEND_HOUR, timeZone);
    const dueDay = now.getTime() >= dueToday.getTime() ? today : addDays(today, -1);
    const covered = addDays(dueDay, -1);
    return {
      frequency,
      periodKey: `D${isoDate(covered)}`,
      ...span(covered, 1, timeZone),
      previous: span(addDays(covered, -1), 1, timeZone),
      dueAt: zonedInstant(dueDay, DIGEST_SEND_HOUR, timeZone),
      label: isoDate(covered),
    };
  }

  // Weekly: the latest Monday whose 08:00 has come.
  const thisMonday = addDays(today, -(isoWeekday(today) - 1));
  const dueThisMonday = zonedInstant(thisMonday, DIGEST_SEND_HOUR, timeZone);
  const dueMonday = now.getTime() >= dueThisMonday.getTime() ? thisMonday : addDays(thisMonday, -7);
  const dueAt = zonedInstant(dueMonday, DIGEST_SEND_HOUR, timeZone);
  if (now.getTime() - dueAt.getTime() > DIGEST_WEEKLY_GRACE_HOURS * 3_600_000) return null;
  const covered = addDays(dueMonday, -7);
  return {
    frequency,
    periodKey: `W${isoDate(covered)}`,
    ...span(covered, 7, timeZone),
    previous: span(addDays(covered, -7), 7, timeZone),
    dueAt,
    label: `${isoDate(covered)} – ${isoDate(addDays(covered, 6))}`,
  };
}
