/**
 * The presence log as a timeline (RP-03 · tm 370): the interval arithmetic
 * behind `GET /reports/availability` and `GET /reports/agent-activity`.
 *
 * Pure on purpose, the way its sibling `staffing/presence-coverage.ts` is: no
 * Fastify, no Prisma, no env, no clock. The caller reads the rows (with each
 * agent's opening row — the last change before the window, see
 * `presenceLog`), the arithmetic lives here where it can be tested on paper
 * values. `presenceCoverage` answers one question of the same log (accepting
 * minutes per UTC hour, for the forecast); this answers the rest — how long in
 * each state, which stretch was a dropped connection, where the plan said the
 * agent would be — and the unit tests hold the two to the same accepting
 * minutes.
 *
 * Rules:
 *
 *   - A row holds until the agent's next row, or to the end of the window.
 *   - Before an agent's first row nothing is known: `unknown`, never `offline`.
 *     Over-reporting absence is as wrong as over-reporting coverage.
 *   - `offline` written by the RTM after the connection dropped
 *     (`source = 'disconnect'`) is `disconnected`; any other `offline` is a
 *     chosen one. A status this code does not know reads as `offline` (not
 *     available) — the safe direction, as in `presenceCoverage`.
 */
import type { ActivityState, PresenceSource, WorkScheduleSlot } from '@siyahtus/types';
import { ACTIVITY_STATES, isPresenceSource, WORK_SCHEDULE_DAYS } from '@siyahtus/types';
import { zoneOffsetMinutes } from '../staffing/roster-coverage.js';

/** One row of `agent_presence_events`, with its source. */
export interface PresenceLogRow {
  agentId: string;
  status: string;
  source: string;
  changedAt: Date;
}

/** One stretch of an agent's window in a single state. */
export interface ActivitySegment {
  state: ActivityState;
  /** What wrote the row that opened it; `null` for `unknown`. */
  source: PresenceSource | null;
  from: number;
  to: number;
}

/** Whole seconds per state. */
export type StateSeconds = Record<ActivityState, number>;

/** One planned shift, as absolute instants (epoch ms). */
export interface PlannedInterval {
  from: number;
  to: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** The state a log row puts an agent in — see the module header. */
export function stateOf(status: string, source: string): ActivityState {
  if (status === 'accepting_chats') return 'accepting';
  if (status === 'not_accepting_chats') return 'not_accepting';
  if (status === 'offline' && source === 'disconnect') return 'disconnected';
  return 'offline';
}

/**
 * One agent's window `[from, to)` as consecutive segments covering it
 * end to end. `rows` are that agent's rows in any order (sorted here); rows
 * at or after `to` describe a state the window never saw and are ignored.
 * Adjacent segments in the same state from the same source are merged — a
 * re-sent status is not a new stretch.
 */
export function activitySegments(
  rows: readonly Pick<PresenceLogRow, 'status' | 'source' | 'changedAt'>[],
  from: number,
  to: number,
): ActivitySegment[] {
  if (!(from < to)) throw new RangeError('activitySegments: `from` must be before `to`.');
  const ordered = rows
    .filter((row) => row.changedAt.getTime() < to)
    .sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());

  const segments: ActivitySegment[] = [];
  const push = (segment: ActivitySegment): void => {
    if (segment.to <= segment.from) return;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.state === segment.state &&
      last.source === segment.source &&
      last.to === segment.from
    ) {
      last.to = segment.to;
      return;
    }
    segments.push(segment);
  };

  const first = ordered[0];
  if (!first || first.changedAt.getTime() > from) {
    push({ state: 'unknown', source: null, from, to: first ? first.changedAt.getTime() : to });
  }
  for (const [index, row] of ordered.entries()) {
    const next = ordered[index + 1];
    push({
      state: stateOf(row.status, row.source),
      source: isPresenceSource(row.source) ? row.source : 'manual',
      from: Math.max(row.changedAt.getTime(), from),
      to: Math.min(next ? next.changedAt.getTime() : to, to),
    });
  }
  return segments;
}

/** Whole seconds per state across `segments` (every state present, 0 when absent). */
export function stateSeconds(segments: readonly ActivitySegment[]): StateSeconds {
  const ms = Object.fromEntries(ACTIVITY_STATES.map((state) => [state, 0])) as StateSeconds;
  for (const segment of segments) ms[segment.state] += segment.to - segment.from;
  return Object.fromEntries(
    ACTIVITY_STATES.map((state) => [state, Math.round(ms[state] / 1000)]),
  ) as StateSeconds;
}

/** How many segments `predicate` matches — e.g. dropped connections in a window. */
export function countSegments(
  segments: readonly ActivitySegment[],
  predicate: (segment: ActivitySegment) => boolean,
): number {
  return segments.filter(predicate).length;
}

/**
 * The local hours of `[from, to)` in `timezone`: each hour's first instant
 * (the window's own start for the first) and its local hour of day.
 *
 * A local hour starts where the local minute is 0. Every zone's offset is a
 * whole number of minutes, so the next start is the current instant plus the
 * minutes left in its local hour — read off `Intl` once per hour, which also
 * places India's :30 boundaries and a daylight-saving day's 23 or 25 hours
 * correctly. A zone the runtime cannot resolve throws: the caller hands in the
 * workspace's validated day-boundary zone.
 */
export function localHours(
  from: number,
  to: number,
  timezone: string,
): { starts: number[]; hours: number[] } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  });
  const starts: number[] = [];
  const hours: number[] = [];
  let cursor = from;
  while (cursor < to) {
    let hour = 0;
    let minute = 0;
    for (const part of formatter.formatToParts(new Date(cursor))) {
      if (part.type === 'hour') hour = Number(part.value);
      else if (part.type === 'minute') minute = Number(part.value);
    }
    starts.push(cursor);
    hours.push(hour);
    const intoMinute = cursor % MINUTE_MS;
    cursor = cursor - intoMinute + (60 - minute) * MINUTE_MS;
  }
  return { starts, hours };
}

/** Minutes per state per local hour of day (24 rows), summed over every hour the window holds. */
export type HourlyStateMinutes = Array<Record<ActivityState, number>>;

export function emptyHourly(): HourlyStateMinutes {
  return Array.from(
    { length: 24 },
    () =>
      Object.fromEntries(ACTIVITY_STATES.map((state) => [state, 0])) as Record<
        ActivityState,
        number
      >,
  );
}

/**
 * Add `segments` to `into`, split at the local hour starts `hours` describes
 * (from {@link localHours} over the same window). A segment from 08:45 to
 * 10:10 puts 15 minutes in hour 8, 60 in hour 9 and 10 in hour 10.
 */
export function addHourly(
  into: HourlyStateMinutes,
  segments: readonly ActivitySegment[],
  hours: { starts: number[]; hours: number[] },
  end: number,
): void {
  const { starts } = hours;
  for (const segment of segments) {
    // The last local hour starting at or before the segment.
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= segment.from) low = middle;
      else high = middle - 1;
    }
    let cursor = segment.from;
    for (let index = low; index < starts.length && cursor < segment.to; index += 1) {
      const hourEnd = starts[index + 1] ?? end;
      const sliceEnd = Math.min(segment.to, hourEnd);
      if (sliceEnd > cursor) {
        const bucket = into[hours.hours[index] ?? 0];
        if (bucket) bucket[segment.state] += (sliceEnd - cursor) / MINUTE_MS;
        cursor = sliceEnd;
      }
    }
  }
}

/** Round every bucket to three decimals (the reports' precision). */
export function roundHourly(hourly: HourlyStateMinutes): HourlyStateMinutes {
  return hourly.map(
    (bucket) =>
      Object.fromEntries(ACTIVITY_STATES.map((state) => [state, round(bucket[state])])) as Record<
        ActivityState,
        number
      >,
  );
}

/** How many minutes of each local hour of day the window holds (the divisor for a mean). */
export function hourMinutes(hours: { starts: number[]; hours: number[] }, end: number): number[] {
  const out = new Array<number>(24).fill(0);
  hours.starts.forEach((start, index) => {
    const hourEnd = hours.starts[index + 1] ?? end;
    const hour = hours.hours[index] ?? 0;
    out[hour] = (out[hour] ?? 0) + (hourEnd - start) / MINUTE_MS;
  });
  return out.map(round);
}

/** `"09:30"` → 570. */
function minutesOfDay(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The instant a wall-clock time in `timezone` names, epoch ms — the offset is
 * read at a first guess and once more at the answer, which settles every
 * ordinary instant; on a spring-forward gap the shifted reading is taken.
 */
function wallToInstant(wallAsUtc: number, timezone: string): number | null {
  const first = zoneOffsetMinutes(timezone, new Date(wallAsUtc));
  if (first === null) return null;
  const guess = wallAsUtc - first * MINUTE_MS;
  const second = zoneOffsetMinutes(timezone, new Date(guess));
  if (second === null) return null;
  return wallAsUtc - second * MINUTE_MS;
}

/**
 * A saved weekly plan placed on `[from, to)` as absolute shifts, merged where
 * they touch, or `null` when the plan's zone cannot be resolved (dropped, as
 * `rosterCoverage` drops it, rather than placed on the wrong hours).
 *
 * Unlike the forecast's standing week, a day's overlay must land on real
 * dates, so each calendar date the window touches in the plan's zone is
 * resolved with that date's own offset.
 */
export function plannedIntervals(
  plan: { timezone: string; schedule: readonly WorkScheduleSlot[] },
  from: number,
  to: number,
): PlannedInterval[] | null {
  if (zoneOffsetMinutes(plan.timezone, new Date(from)) === null) return null;
  const intervals: PlannedInterval[] = [];
  // Every zone is within ±14 h of UTC, so the window's dates in the plan's zone
  // lie between the UTC date a day before `from` and a day after `to`.
  const firstDay = Math.floor(from / DAY_MS) * DAY_MS - DAY_MS;
  for (let day = firstDay; day <= to + DAY_MS; day += DAY_MS) {
    // `getUTCDay`: 0 = Sunday; WORK_SCHEDULE_DAYS starts on Monday.
    const weekday = WORK_SCHEDULE_DAYS[(new Date(day).getUTCDay() + 6) % 7];
    for (const slot of plan.schedule) {
      if (!slot?.enabled || slot.day !== weekday) continue;
      const start = minutesOfDay(slot.start);
      const end = minutesOfDay(slot.end);
      if (start === null || end === null || end <= start) continue;
      const startAt = wallToInstant(day + start * MINUTE_MS, plan.timezone);
      const endAt = wallToInstant(day + end * MINUTE_MS, plan.timezone);
      if (startAt === null || endAt === null) continue;
      const clippedFrom = Math.max(startAt, from);
      const clippedTo = Math.min(endAt, to);
      if (clippedTo > clippedFrom) intervals.push({ from: clippedFrom, to: clippedTo });
    }
  }
  intervals.sort((a, b) => a.from - b.from);
  const merged: PlannedInterval[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to);
    else merged.push({ ...interval });
  }
  return merged;
}

/** Whole seconds `intervals` cover. */
export function intervalSeconds(intervals: readonly PlannedInterval[]): number {
  return Math.round(intervals.reduce((sum, item) => sum + (item.to - item.from), 0) / 1000);
}

/** Whole seconds of `state` that fall inside `intervals` — accepting time during the plan. */
export function stateSecondsWithin(
  segments: readonly ActivitySegment[],
  intervals: readonly PlannedInterval[],
  state: ActivityState,
): number {
  let ms = 0;
  for (const segment of segments) {
    if (segment.state !== state) continue;
    for (const interval of intervals) {
      const overlap = Math.min(segment.to, interval.to) - Math.max(segment.from, interval.from);
      if (overlap > 0) ms += overlap;
    }
  }
  return Math.round(ms / 1000);
}
