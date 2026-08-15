/**
 * When the workspace is open, and how much of a wait falls inside it
 * (FR-MOD-11.5 · 11.5-d).
 *
 * An SLA target of "reply within 30 minutes" means something different to a
 * team that works 09:00-18:00 than to one that does not sleep. `business_hours_only`
 * on the policy is that difference, and this module is where it is computed.
 *
 * Pure, like `roster-coverage.ts` next door: no Fastify, no Prisma, no env, no
 * clock. The caller reads the rows; the timezone arithmetic lives here where it
 * can be tested on paper values, because it is easy to get quietly wrong — an
 * elapsed figure is plausible whatever it says, and this one decides whether a
 * team is told it broke a promise.
 *
 * ## The calendar is the union of the agents' plans
 *
 * §C-A27: business hours come from the existing `work_schedules` table and no
 * second calendar model is opened. Those rows are *per agent*, so the workspace
 * is treated as open when **at least one** agent is rostered — the union of the
 * saved plans, not their intersection and not any one person's.
 *
 * That is the only reading that survives contact with a real rota. An
 * intersection would close the workspace whenever one person took a late shift;
 * picking one agent's plan would mean the answer changed when they left. The
 * union says "somebody was supposed to be here", which is exactly the claim an
 * SLA makes.
 *
 * Two consequences, both deliberate:
 *
 *   - A workspace where **nobody** has saved a plan has no calendar at all. It
 *     gets `null`, and the caller runs the clock continuously rather than
 *     inventing 09:00-18:00 for a team that never said so — the same
 *     only-saved-plans rule `rosterCoverage` applies, and for the same reason.
 *     Note the direction: here, no calendar means *more* elapsed time, so the
 *     conservative choice is the one that could mark a breach. It is still the
 *     right one, because the alternative is a subtraction nobody asked for.
 *   - A plan whose timezone the runtime cannot resolve is dropped rather than
 *     read as UTC. Falling back would open the workspace on the wrong hours — a
 *     wrong answer that looks right — where dropping shows up as a calendar
 *     with less coverage than expected.
 *
 * ## Resolution is one minute, and it rounds toward not marking
 *
 * Both ends of a span are floored to the minute, and the elapsed figure is the
 * count of open minutes in `[floor(from), floor(to))`. So a 30-minute target is
 * met by a reply at 30:59 as surely as by one at 30:00. Under-counting by less
 * than a minute is the safe direction: a breach row is an accusation that a
 * promise was missed, and a target expressed in minutes does not carry the
 * precision to make a second-level distinction stick.
 *
 * ## A standing week, resolved once
 *
 * A work schedule is a *recurring* pattern with no per-date variation, so the
 * calendar is one standing week projected onto UTC. Each plan's offset is
 * resolved once, at the instant the caller passes, for the same reason
 * `rosterCoverage` does it: re-deriving the offset per date would give one plan
 * several different UTC placements and leave no single week to reason about.
 * The cost is that a span crossing a DST change is placed by whichever side of
 * it `at` falls on, off by an hour for the other side. Documented rather than
 * modelled, because the plan itself carries no per-date detail that would
 * justify the machinery.
 */
import { WORK_SCHEDULE_DAYS, WORK_SCHEDULE_TIME_PATTERN, type WorkScheduleSlot } from '@nexa/types';

/** One agent's saved plan, as this module needs it. */
export interface BusinessHoursPlan {
  /** IANA zone from `work_schedules.timezone`; an unresolvable one drops the plan. */
  timezone: string;
  /** Already through `normalizeWorkSchedule`; malformed slots are skipped defensively. */
  schedule: readonly WorkScheduleSlot[];
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = MINUTES_PER_HOUR * 24;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;
const MS_PER_MINUTE = 60_000;

/**
 * 1970-01-01 was a Thursday, so minute 0 of the Unix epoch sits 3 days into a
 * Monday-based week. Adding this puts absolute minute indices on a week that
 * starts on Monday — the order `WORK_SCHEDULE_DAYS` uses.
 */
const EPOCH_WEEK_OFFSET_MINUTES = 3 * MINUTES_PER_DAY;

/**
 * A standing week of open minutes, prepared for O(1) queries.
 *
 * `openBefore[i]` is how many of the first `i` minutes of the week are open, so
 * the open minutes of any span are two lookups and some arithmetic rather than
 * a walk — a span of a year costs the same as a span of an hour, which matters
 * because the sweep asks this question once per waiting case.
 */
export interface BusinessWeek {
  /** Prefix sums, length `MINUTES_PER_WEEK + 1`. */
  readonly openBefore: readonly number[];
  /** Open minutes in a full week. Zero means a calendar that is never open. */
  readonly openMinutesPerWeek: number;
}

/**
 * One formatter per zone, built lazily. Memoisation only — the value depends on
 * nothing but the key. A zone the runtime rejects is remembered as `null` so a
 * workspace full of typos does not re-throw once per plan.
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

/** How far ahead of UTC a zone is, in minutes, at one instant. `null` if unresolvable. */
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
  return Math.round((asUtc - at.getTime()) / MS_PER_MINUTE);
}

/** `"09:30"` → 570, or `null` when it is not a well-formed 24h time. */
function minutesOfDay(time: string): number | null {
  if (typeof time !== 'string' || !WORK_SCHEDULE_TIME_PATTERN.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * MINUTES_PER_HOUR + (minutes ?? 0);
}

/** Mark `[start, end)` open, wrapping so a shift across the week edge lands on both sides. */
function markOpen(open: boolean[], start: number, end: number): void {
  for (let minute = start; minute < end; minute += 1) {
    const index = ((minute % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
    open[index] = true;
  }
}

/**
 * The workspace's standing open week, or `null` when no usable plan exists.
 *
 * `at` selects which UTC offset each plan's zone is read at; pass an instant
 * from the span being measured (its end reads the calendar as it stands today)
 * rather than the current time, so a report run twice gives the same answer.
 *
 * A workspace whose every plan has all seven days disabled is *not* null — it
 * has said, deliberately, that it is never open, and gets a calendar with zero
 * open minutes. `null` is reserved for "nothing is known", which is the case
 * that must not be mistaken for a claim.
 */
export function buildBusinessWeek(
  plans: readonly BusinessHoursPlan[],
  at: Date,
): BusinessWeek | null {
  if (!Array.isArray(plans)) throw new TypeError('buildBusinessWeek: `plans` must be an array.');
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
    throw new TypeError('buildBusinessWeek: `at` must be a valid Date.');
  }

  const open = new Array<boolean>(MINUTES_PER_WEEK).fill(false);
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
      // three. A row that slipped past it (edited in psql, written before a
      // rule tightened) is skipped rather than allowed to open the workspace at
      // an hour nobody can read.
      if (dayIndex < 0 || start === null || end === null || end <= start) continue;

      const localStart = dayIndex * MINUTES_PER_DAY + start;
      markOpen(open, localStart - offset, localStart + (end - start) - offset);
    }
  }

  // Not "no rows" but "no rows this runtime can place": a workspace whose only
  // plans carry unresolvable zones knows as little as one with no plans at all.
  if (usablePlans === 0) return null;

  const openBefore = new Array<number>(MINUTES_PER_WEEK + 1);
  openBefore[0] = 0;
  for (let index = 0; index < MINUTES_PER_WEEK; index += 1) {
    openBefore[index + 1] = (openBefore[index] as number) + (open[index] ? 1 : 0);
  }

  return { openBefore, openMinutesPerWeek: openBefore[MINUTES_PER_WEEK] as number };
}

/** Absolute minute index on a Monday-based week, floored. */
function weekAlignedMinute(at: Date): number {
  return Math.floor(at.getTime() / MS_PER_MINUTE) + EPOCH_WEEK_OFFSET_MINUTES;
}

/** Open minutes strictly before an absolute (Monday-aligned) minute index. */
function openBeforeMinute(week: BusinessWeek, minute: number): number {
  const wholeWeeks = Math.floor(minute / MINUTES_PER_WEEK);
  const within = minute - wholeWeeks * MINUTES_PER_WEEK;
  return wholeWeeks * week.openMinutesPerWeek + (week.openBefore[within] as number);
}

/**
 * How long a wait lasted, in whole minutes.
 *
 * With `week` null the clock runs continuously — the workspace has published no
 * hours, so there is nothing to subtract. With a week, only open minutes count,
 * which is what makes "reply within 30 minutes" mean 30 *working* minutes and
 * not 30 minutes of a Sunday night.
 *
 * Never negative: a `to` before `from` reads as zero rather than as a negative
 * wait. The two timestamps come from different writers (a thread's creation and
 * the event that answered it) and a clock skew between them should not produce
 * a figure no reader could interpret.
 */
export function elapsedMinutes(from: Date, to: Date, week: BusinessWeek | null): number {
  const start = weekAlignedMinute(from);
  const end = weekAlignedMinute(to);
  if (end <= start) return 0;
  if (!week) return end - start;
  return openBeforeMinute(week, end) - openBeforeMinute(week, start);
}

/**
 * Whether a wait of `elapsed` minutes missed `target`, where a null target means
 * nothing was promised.
 *
 * Strictly greater: a reply that lands exactly on the target met it. The
 * database says the same thing (`sla_breaches_elapsed_check`), so the rule
 * cannot drift between the two places that state it.
 */
export function isBreach(target: number | null, elapsed: number): boolean {
  return target !== null && target > 0 && elapsed > target;
}
