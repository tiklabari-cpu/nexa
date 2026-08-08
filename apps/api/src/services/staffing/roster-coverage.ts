/**
 * The planned side of the staffing picture (PRD §5.3-Vardiya, WORKSCHED-g).
 *
 * `presence-coverage.ts` answers "who was *actually* online last Tuesday at
 * 14:00". This answers the other half the forecast compares it against: "who was
 * *supposed* to be" — the standing weekly plan the workspace saved through
 * `PUT /agents/{agentId}/work-schedule` (WORKSCHED-c), projected onto the same
 * UTC weekday × hour grid the forecast uses.
 *
 * Pure, like its two siblings: no Fastify, no Prisma, no env, no clock. The
 * caller reads the rows; the timezone arithmetic and the unknown-vs-zero rule
 * live here where they can be tested on paper values, because both are easy to
 * get quietly wrong — a roster number is plausible whatever it says.
 *
 * ## A week, not a window
 *
 * A work schedule is a *recurring* pattern with no per-date variation, so the
 * honest unit is one standing week: a cell's value is how many agents that
 * pattern puts on that hour, and it does not change because the report was run
 * over 7 days or 90. That is also why nothing here is divided by how many times
 * an hour occurred — unlike observed volume and observed presence, which are
 * tallies over a window and only become rates once divided.
 *
 * Fractional on purpose: a shift ending at 17:30 contributes 0.5 to hour 17, and
 * two agents rostered on the same hour contribute 2. So the figure reads as
 * *mean agents planned during that hour*, directly comparable to the
 * presence-derived `scheduledAgents` beside it.
 *
 * ## Only saved plans count
 *
 * An agent with no stored row is not counted at all, even though reading their
 * schedule individually answers with {@link DEFAULT_WORK_SCHEDULE} — the
 * editor's pre-filled suggestion is not a commitment anyone made, and counting
 * it would put a Monday-to-Friday 09:00-18:00 roster on a workspace that never
 * opened the screen. And when *no* agent has a saved plan this returns `null`
 * rather than a grid of zeros, the same distinction `presenceCoverage` draws for
 * an empty log: nothing is known here, which is not the claim that nobody is
 * planned. Once one plan exists, an empty hour is a real 0.
 *
 * Both rules err downward, which is the safe direction for exactly the reason
 * WORKSCHED-d gives for coverage: over-stating who will be there hides
 * understaffing instead of showing it.
 *
 * ## Timezones
 *
 * Slots are local wall-clock times in the plan's own IANA zone, so placing them
 * on a UTC grid needs that zone's offset. It is resolved **once per plan, at the
 * instant the caller passes** (`at`) rather than per calendar day: a standing
 * pattern has one shape, and the alternative — re-deriving the offset for every
 * date in the window — would give a single plan several different UTC placements
 * and no single "week" left to report. The cost is that a window spanning a DST
 * change places the plan by whichever side of it `at` falls on, off by one hour
 * for the other side. Documented rather than modelled, because the plan itself
 * carries no per-date detail that would justify the extra machinery.
 *
 * A zone string the runtime cannot resolve (the column is a free string;
 * `normalizeWorkSchedule` only requires it to be non-empty) drops that plan
 * instead of falling back to UTC. Falling back would place real shifts on the
 * wrong hours — a wrong number that looks right — where dropping shows up as
 * less roster than expected, in the same conservative direction as the rules
 * above.
 */
import { WORK_SCHEDULE_DAYS, WORK_SCHEDULE_TIME_PATTERN, type WorkScheduleSlot } from '@nexa/types';

/** One agent's saved plan, as this module needs it. */
export interface RosterPlan {
  agentId: string;
  /** IANA zone from `work_schedules.timezone`; an unresolvable one drops the plan. */
  timezone: string;
  /** Already through `normalizeWorkSchedule` — malformed slots are skipped defensively. */
  schedule: readonly WorkScheduleSlot[];
}

/** Mean agents planned onto one UTC (weekday, hour) cell of a standing week. */
export interface RosterCell {
  /** 0 = Sunday … 6 = Saturday (UTC), matching `Date.getUTCDay()`. */
  dayOfWeek: number;
  /** 0-23 (UTC). */
  hour: number;
  /** Agents rostered for this hour; fractional when a shift covers part of it. */
  rosteredAgents: number;
}

const DAYS_PER_WEEK = 7;
const HOURS_PER_DAY = 24;
const CELLS_PER_WEEK = DAYS_PER_WEEK * HOURS_PER_DAY;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * DAYS_PER_WEEK;

/** Three decimals, the precision `reports-metrics.round` settled on. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * One formatter per zone, built lazily.
 *
 * Memoisation only — the value depends on nothing but the key, so two runs over
 * the same plans stay byte-identical whatever order the cache filled in. A zone
 * the runtime rejects is remembered as `null` so a workspace full of typos does
 * not re-throw once per request.
 */
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;

  let formatter: Intl.DateTimeFormat | null = null;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // h23 rather than hour12:false: the latter renders midnight as hour 24 on
      // some ICU builds, which would place a plan a day late.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    formatter = null;
  }
  formatters.set(timeZone, formatter);
  return formatter;
}

/**
 * How far ahead of UTC a zone is, in minutes, at one instant — positive east of
 * Greenwich. `null` when the zone cannot be resolved.
 *
 * Read off `Intl` rather than a table: the runtime already ships the tzdata, and
 * a hand-rolled offset would go stale the next time a country moves its clocks.
 */
function zoneOffsetMinutes(timeZone: string, at: Date): number | null {
  const formatter = formatterFor(timeZone);
  if (!formatter) return null;

  const parts = new Map<string, string>(
    formatter.formatToParts(at).map((part) => [part.type, part.value] as const),
  );
  const number = (type: string): number => Number(parts.get(type));
  const [year, month, day, hour, minute, second] = [
    number('year'),
    number('month'),
    number('day'),
    number('hour'),
    number('minute'),
    number('second'),
  ];
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;

  // The same wall clock read as if it were UTC, minus the real instant, is the
  // offset — the standard trick, and exact to the second.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** `"09:30"` → 570, or `null` when it is not a well-formed 24h time. */
function minutesOfDay(time: string): number | null {
  if (typeof time !== 'string' || !WORK_SCHEDULE_TIME_PATTERN.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);
}

/** The grid slot a week-minute belongs to, wrapping so week edges never fall off. */
function cellIndexAt(weekMinute: number): number {
  const minute = ((weekMinute % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  // The week here starts on Monday (WORK_SCHEDULE_DAYS order); the grid starts on
  // Sunday (getUTCDay), hence the +1.
  const dayOfWeek = (Math.floor(minute / MINUTES_PER_DAY) + 1) % DAYS_PER_WEEK;
  const hour = Math.floor((minute % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return dayOfWeek * HOURS_PER_DAY + hour;
}

/**
 * Add one shift to the minute grid, splitting it at hour boundaries.
 *
 * A shift from 08:45 to 10:10 puts 15 minutes in hour 8, 60 in hour 9 and 10 in
 * hour 10 — assigning the whole span to the hour it started in would report a
 * night shift as one very busy hour. Both ends may sit outside `[0, week)` once
 * the UTC offset is applied; {@link cellIndexAt} wraps, so a shift that crosses
 * the week boundary lands on the days it actually covers.
 */
function addShift(minutes: number[], startMinute: number, endMinute: number): void {
  let cursor = startMinute;
  while (cursor < endMinute) {
    const hourEnd = (Math.floor(cursor / MINUTES_PER_HOUR) + 1) * MINUTES_PER_HOUR;
    const sliceEnd = Math.min(endMinute, hourEnd);
    const index = cellIndexAt(cursor);
    minutes[index] = (minutes[index] ?? 0) + (sliceEnd - cursor);
    cursor = sliceEnd;
  }
}

/**
 * The standing weekly roster as a dense 7 × 24 grid of mean agents per UTC hour,
 * or `null` when no usable plan exists at all — see the module header for the
 * week-not-window unit, the only-saved-plans rule and how zones are resolved.
 *
 * `at` selects which UTC offset each plan's zone is read at; pass an instant
 * from the window being reported on (its end, so a plan reads the way it stands
 * today) rather than the current time, so the result stays deterministic.
 *
 * Cells are ordered day 0-6 then hour 0-23 — the same order and axes
 * `staffingForecast` emits, so the two align index by index.
 */
export function rosterCoverage(plans: readonly RosterPlan[], at: Date): RosterCell[] | null {
  if (!Array.isArray(plans)) throw new TypeError('rosterCoverage: `plans` must be an array.');
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new TypeError('rosterCoverage: `at` must be a valid Date.');
  }

  const minutes = new Array<number>(CELLS_PER_WEEK).fill(0);
  let usablePlans = 0;

  for (const plan of plans) {
    const offset = zoneOffsetMinutes(plan.timezone, at);
    if (offset === null) continue;
    usablePlans += 1;

    if (!Array.isArray(plan.schedule)) continue;
    for (const slot of plan.schedule) {
      if (!slot?.enabled) continue;

      const dayIndex = WORK_SCHEDULE_DAYS.indexOf(slot.day);
      const start = minutesOfDay(slot.start);
      const end = minutesOfDay(slot.end);
      // Defensive: `normalizeWorkSchedule` is the gate that guarantees all
      // three, and a row that slipped past it (edited in psql, written before a
      // rule tightened) is skipped rather than allowed to place a shift at a
      // time nobody can read.
      if (dayIndex < 0 || start === null || end === null || end <= start) continue;

      const localStart = dayIndex * MINUTES_PER_DAY + start;
      addShift(minutes, localStart - offset, localStart + (end - start) - offset);
    }
  }

  // Not "no rows" but "no rows this runtime can place": a workspace whose only
  // plans carry unresolvable zones knows as little as one with no plans at all,
  // and a grid of zeros would state the opposite.
  if (usablePlans === 0) return null;

  return Array.from({ length: CELLS_PER_WEEK }, (_, index) => ({
    dayOfWeek: Math.floor(index / HOURS_PER_DAY),
    hour: index % HOURS_PER_DAY,
    // Minutes over an hour is agents-per-hour, because one standing week counts
    // every cell exactly once.
    rosteredAgents: round((minutes[index] ?? 0) / MINUTES_PER_HOUR),
  }));
}
