/**
 * The period one scheduled delivery covers (07.9-sched-e) — pure, UTC, and the
 * deterministic half of the scheduler's idempotency.
 *
 * Two properties matter here, and both are about the *key* rather than the
 * dates:
 *
 *   1. **The key is a function of the frequency and nothing else.** It is what
 *      `scheduled_report_runs`' `UNIQUE (scheduled_report_id, period_key)`
 *      deduplicates on, so two sweeps that run minutes apart — or at the same
 *      instant on two processes — must derive the *same* string, or the second
 *      one mails the report again. That rules out anything drawn from the
 *      moment of the run: no timestamps, no elapsed-time arithmetic, no local
 *      clock. `now` only selects *which* period; it never leaks into the label.
 *   2. **The period is always the previous COMPLETE one.** A daily schedule
 *      swept at 09:00 reports on yesterday, not on the seven hours of today
 *      that happen to have elapsed — a partial period would be delivered as if
 *      it were whole, and its key would then be taken, so the real figures for
 *      that day could never be sent. "Complete" is also what makes the key
 *      safe: the window it names can no longer change.
 *
 * Everything is UTC. Tenant time zones are out of scope for v1 (open question
 * #4) and a *silent* local-time reading would be worse than not having the
 * feature: the same calendar day would mean two different windows for two
 * workspaces, and the key would no longer identify the data it labelled.
 *
 * `to` is the last instant *inside* the period, not the first instant of the
 * next one, because every report aggregation this feeds is a closed interval
 * (`created_at >= from AND created_at <= to`, see `report-csv.ts`). Handing it
 * an exclusive end would put the boundary row in two consecutive periods and
 * count it twice.
 */
import type { ScheduledExportFrequency } from '@siyahtus/types';

const DAY_MS = 86_400_000;

export interface ReportPeriod {
  /**
   * The deduplication key, in the exact shapes
   * `scheduled_report_runs_period_key_check` pins:
   * `2026-07-31` (daily), `2026-W31` (weekly), `2026-07` (monthly).
   */
  periodKey: string;
  /** Inclusive UTC start — midnight of the period's first day. */
  from: Date;
  /** Inclusive UTC end — the last millisecond of the period's last day. */
  to: Date;
}

/**
 * The most recent complete period for this frequency, as of `now`.
 *
 * `now` is a parameter rather than a `new Date()` inside so a test can stand on
 * a year boundary, a leap day or an ISO week that belongs to the neighbouring
 * year, and so two callers sweeping the same minute agree on the period.
 */
export function periodFor(frequency: ScheduledExportFrequency, now: Date): ReportPeriod {
  switch (frequency) {
    case 'daily': {
      const startOfToday = startOfUtcDay(now);
      const from = new Date(startOfToday.getTime() - DAY_MS);
      return { periodKey: utcDayKey(from), from, to: lastInstantBefore(startOfToday) };
    }
    case 'weekly': {
      const thisMonday = startOfIsoWeek(now);
      const from = new Date(thisMonday.getTime() - 7 * DAY_MS);
      return { periodKey: isoWeekKey(from), from, to: lastInstantBefore(thisMonday) };
    }
    case 'monthly': {
      // Month 0 - 1 is December of the previous year: Date.UTC normalises it,
      // so the year boundary needs no special case.
      const startOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      return { periodKey: utcMonthKey(from), from, to: lastInstantBefore(startOfThisMonth) };
    }
    default: {
      // Unreachable through the database, which constrains `frequency` to those
      // three (`scheduled_reports_frequency_check`), and unreachable through the
      // API, which validates before writing. Loud rather than silent all the
      // same: a frequency with no period has no key, and a delivery with no key
      // has nothing to deduplicate on — every sweep would mail it again.
      const unknown: never = frequency;
      throw new RangeError(`unknown scheduled export frequency: ${String(unknown)}`);
    }
  }
}

/**
 * How many missed periods one sweep still mails late (tm 460 · F46): a week of
 * daily reports, a fortnight of weekly ones, the last month. Beyond that a
 * late report is noise rather than news, and an outage would otherwise turn
 * into a burst of dozens of mails per schedule.
 */
export const CATCH_UP_LIMIT: Readonly<Record<ScheduledExportFrequency, number>> = {
  daily: 7,
  weekly: 2,
  monthly: 1,
};

/**
 * How far back one sweep looks for missed periods at all, counting the current
 * one — about a quarter. Older periods are neither mailed nor recorded: the
 * bound keeps a schedule whose host was off for a year from writing hundreds
 * of `skipped` rows in one go.
 */
export const MISSED_LOOKBACK: Readonly<Record<ScheduledExportFrequency, number>> = {
  daily: 92,
  weekly: 13,
  monthly: 3,
};

export interface DuePeriods {
  /** Periods to claim and mail, oldest first; the current period is always last. */
  deliver: ReportPeriod[];
  /** Missed periods past the catch-up allowance, oldest first: recorded `skipped`. */
  missed: ReportPeriod[];
}

/**
 * Every period one sweep should act on (tm 460 · F46).
 *
 * The current period ({@link periodFor}) is always due, exactly as before —
 * whether it is still open is the claim's question, not this one's. Behind it,
 * the periods that ended after the schedule's newest run and were never
 * claimed are *missed*: the host was down when they fell due. The newest
 * {@link CATCH_UP_LIMIT} of them (with the current one) are delivered, oldest
 * first; the rest are returned as `missed` so the sweep can leave a row saying
 * so instead of a silent gap.
 *
 * Two floors stop the walk:
 *
 *   - `lastClaimedFrom` — the start of the newest period this schedule has a
 *     run row for, whatever its status. A schedule that has never run has
 *     nothing to catch up on (its first sweep sends the current period, as it
 *     always did), so `null` means "current period only".
 *   - `enabledAt` — when the schedule last started. A period that was over
 *     before then was not missed: the schedule was off, or did not exist yet.
 *
 * Periods are compared by instant rather than by key, so a schedule that moved
 * from daily to weekly compares its new weeks against its last day correctly.
 */
export function duePeriods(
  frequency: ScheduledExportFrequency,
  now: Date,
  floor: { lastClaimedFrom: Date | null; enabledAt: Date },
): DuePeriods {
  const current = periodFor(frequency, now);
  if (floor.lastClaimedFrom === null) return { deliver: [current], missed: [] };

  const lookback = MISSED_LOOKBACK[frequency];
  const newestFirst: ReportPeriod[] = [current];
  // `periodFor` at a period's first instant is the period before it.
  let previous = periodFor(frequency, current.from);
  while (
    newestFirst.length < lookback &&
    previous.from.getTime() > floor.lastClaimedFrom.getTime() &&
    previous.to.getTime() >= floor.enabledAt.getTime()
  ) {
    newestFirst.push(previous);
    previous = periodFor(frequency, previous.from);
  }

  const oldestFirst = newestFirst.reverse();
  const cut = Math.max(0, oldestFirst.length - CATCH_UP_LIMIT[frequency]);
  return { deliver: oldestFirst.slice(cut), missed: oldestFirst.slice(0, cut) };
}

// ---------------------------------------------------------------------------
// UTC calendar boundaries.
//
// Exported, not private: Copilot's BI command resolves a spoken window ("last
// week") to the same dates (see `biWindow` in services/ai/copilot-service.ts),
// and a second definition of "the week starts Monday" or "a report window is
// closed at both ends" is exactly the drift ADR-09 exists to prevent — a weekly
// scheduled export and a "last week" question must not cover different days.
// ---------------------------------------------------------------------------

/** Midnight UTC of the day `date` falls in. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Midnight UTC of the Monday that opens the ISO week `date` falls in. */
export function startOfIsoWeek(date: Date): Date {
  const day = startOfUtcDay(date);
  // getUTCDay() is Sunday-first (0..6); ISO weeks start on Monday, so shift it
  // to Monday-first before subtracting.
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - mondayOffset * DAY_MS);
}

/** The final millisecond before an exclusive boundary — see the file header. */
export function lastInstantBefore(exclusiveEnd: Date): Date {
  return new Date(exclusiveEnd.getTime() - 1);
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * `YYYY-Www` for the ISO-8601 week containing `date`.
 *
 * The year in the label is the ISO *week-numbering* year, which is not always
 * the calendar year of the days in it: 2027-01-01 is a Friday, so that whole
 * week is `2026-W53`, and 2029-12-31 is a Monday, so it opens `2030-W01`.
 * Labelling either by its calendar year would put two different weeks under one
 * key — and a key collision here is a report that is never delivered again.
 *
 * The Thursday rule is what settles it: ISO week 1 is the week containing the
 * first Thursday of the year, so a week belongs to whatever year *its* Thursday
 * falls in, and every week is then a whole number of weeks away from week 1's
 * Thursday.
 */
function isoWeekKey(date: Date): string {
  const thursday = new Date(startOfIsoWeek(date).getTime() + 3 * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  // 4 January is always in week 1 (it is at most three days past the first
  // Thursday and at most three days before it), so its week's Thursday is
  // week 1's Thursday.
  const firstThursday = new Date(
    startOfIsoWeek(new Date(Date.UTC(isoYear, 0, 4))).getTime() + 3 * DAY_MS,
  );
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return `${String(isoYear)}-W${String(week).padStart(2, '0')}`;
}
