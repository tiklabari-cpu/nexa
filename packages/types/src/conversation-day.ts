/**
 * The conversation day (ID-04 · tm 285, decision K3): which calendar day a
 * moment belongs to *for the workspace*, not for the server.
 *
 * The server clock is UTC; Istanbul is UTC+3. Without a tenant zone, a player
 * writing at 00:30 local time is filed under yesterday — and 00:00–03:00 is one
 * of an iGaming desk's busiest windows. So the day a conversation belongs to is
 * always computed by `localDayKey`, with the workspace's IANA zone and the hour
 * the day starts at. There is no second computation anywhere: SQL never derives
 * a day on its own (`AT TIME ZONE …`), so the key a chat was filed under and the
 * key a report groups by cannot disagree.
 *
 * What this does not move: the AI daily quota stays on the UTC day (ID-04-S3,
 * one platform counter for every tenant) and report day-buckets stay UTC for now
 * (the screens say so). Only the conversation day follows this setting.
 *
 * A change of setting affects the connections that start *after* it. A chat
 * already filed under a key keeps it (`chats.local_day` is written once), so a
 * conversation in progress is never split at the moment someone edits the zone.
 */
import { isIanaTimeZone } from './company.js';

/** The zone and start hour a workspace has before anyone sets them (K3). */
export interface DayBoundary {
  /** IANA zone, e.g. `"Europe/Istanbul"`. */
  timezone: string;
  /** The local hour a day starts at, 0-23. `0` = midnight. */
  hour: number;
}

/**
 * The shipped default: Europe/Istanbul, midnight. The `inbox_settings`
 * column defaults (`day_boundary_tz`, `day_boundary_hour`) carry exactly these
 * two values, and a workspace with no settings row reads them from here — the
 * three places describe one boundary (`conversation-day.test.ts` pins it).
 */
export const DEFAULT_DAY_BOUNDARY: DayBoundary = Object.freeze({
  timezone: 'Europe/Istanbul',
  hour: 0,
});

/** True for a whole number 0-23 — the only start hours the setting accepts. */
export function isDayBoundaryHour(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
}

/**
 * True for a zone the setting accepts: the same closed list the company
 * timezone uses (`isIanaTimeZone`), so one workspace cannot hold `Europe/Kiev`
 * in one place and `Europe/Kyiv` in another.
 */
export function isDayBoundaryTimeZone(value: unknown): value is string {
  return isIanaTimeZone(value);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    // `hourCycle: 'h23'` — `hour12: false` renders midnight as "24" on some
    // engines, which would read as the end of the previous day.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

/**
 * The day `at` falls on in `timezone`, for a day that starts at `boundaryHour`
 * local time, as `YYYY-MM-DD`.
 *
 * The local wall clock is read first and the boundary applied to it, rather than
 * subtracting `boundaryHour` hours from the instant: a daylight-saving change
 * moves the wall clock by an hour, and shifting the instant would then file
 * 05:59 and 06:00 on the wrong side of a 06:00 boundary twice a year. Comparing
 * wall-clock hours is correct on both sides of a transition.
 *
 * With a boundary of 6, 05:59 belongs to the previous day and 06:00 to today.
 * Throws a `RangeError` for a zone or hour the setting would have refused, so a
 * corrupt stored value is loud rather than a silently wrong day.
 */
export function localDayKey(
  at: Date,
  timezone: string = DEFAULT_DAY_BOUNDARY.timezone,
  boundaryHour: number = DEFAULT_DAY_BOUNDARY.hour,
): string {
  if (!isDayBoundaryHour(boundaryHour)) {
    throw new RangeError(`Day boundary hour must be a whole number 0-23, got ${boundaryHour}.`);
  }
  if (Number.isNaN(at.getTime())) {
    throw new RangeError('Cannot compute a conversation day for an invalid date.');
  }

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  for (const part of partsFormatter(timezone).formatToParts(at)) {
    if (part.type === 'year') year = Number(part.value);
    else if (part.type === 'month') month = Number(part.value);
    else if (part.type === 'day') day = Number(part.value);
    else if (part.type === 'hour') hour = Number(part.value);
  }

  // Calendar arithmetic on the local date alone, in UTC so no zone intrudes.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (hour < boundaryHour) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
