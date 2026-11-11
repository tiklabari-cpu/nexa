/**
 * The workspace's conversation day boundary (ID-04 · tm 285, decision K3).
 *
 * One rule, two spellings: the day a chat is filed under is
 * `localDayKey(at, timezone, hour)` from `@siyahtus/types`, and a report that
 * groups rows by day in SQL uses {@link localDaySql} — the same rule (read the
 * wall clock in the workspace zone, a wall-clock hour before the boundary is the
 * previous day) with the same two values bound as parameters. Both read the
 * boundary through {@link readDayBoundary}, so the day a chat was filed under and
 * the day a report groups it by cannot disagree (tm 458 · F44:
 * `day-boundary.test.ts` and `report-day-boundary.test.ts` compare the two).
 * A report's date-only `from`/`to` names conversation days too, resolved by
 * {@link localDayWindow} (tm 459 · F45).
 *
 * The setting lives on `inbox_settings`, next to the chat-timeout, and is read
 * the same way the timeout sweep reads it (`findFirst` inside the tenant
 * transaction): the row is keyed by licence + brand, but the boundary is in
 * effect one value for the workspace (ID-04-S2). A workspace that never saved it
 * has no row and reads `DEFAULT_DAY_BOUNDARY` — Europe/Istanbul, midnight.
 *
 * Changing the setting affects only connections that start afterwards: this
 * module computes a key for an instant it is handed and never revisits a key a
 * chat already carries (`chats.local_day` is written once, tm 286). A chat in
 * progress is therefore never split by an edit. A report, by contrast, is
 * recomputed on every read, so it groups by the boundary in effect when it is
 * read.
 */
import { Prisma } from '@prisma/client';
import {
  DEFAULT_DAY_BOUNDARY,
  isDayBoundaryHour,
  isDayBoundaryTimeZone,
  localDayKey,
  localDayStart,
  shiftDayKey,
  type DayBoundary,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** The two stored columns, or `null` when the workspace has no settings row. */
export interface DayBoundaryRow {
  dayBoundaryTz: string;
  dayBoundaryHour: number;
}

/**
 * The boundary a row means. A missing row is the default. A stored value that
 * would not pass today's validation (a zone a later tz database dropped, a hand
 * edit past the CHECK) falls back to that field's default rather than throwing:
 * a settings typo must not stop a player from starting a chat.
 */
export function dayBoundaryFromRow(row: DayBoundaryRow | null | undefined): DayBoundary {
  if (!row) return { ...DEFAULT_DAY_BOUNDARY };
  return {
    timezone: isDayBoundaryTimeZone(row.dayBoundaryTz)
      ? row.dayBoundaryTz
      : DEFAULT_DAY_BOUNDARY.timezone,
    hour: isDayBoundaryHour(row.dayBoundaryHour) ? row.dayBoundaryHour : DEFAULT_DAY_BOUNDARY.hour,
  };
}

/** The current workspace's day boundary (RLS scopes the read to the tenant). */
export async function readDayBoundary(tx: TenantClient): Promise<DayBoundary> {
  // Most recently saved row wins, so two brands that saved different values do
  // not make the day depend on which row the planner returns first.
  const row = await tx.inboxSettings.findFirst({
    select: { dayBoundaryTz: true, dayBoundaryHour: true },
    orderBy: { updatedAt: 'desc' },
  });
  return dayBoundaryFromRow(row);
}

/** The conversation day `at` belongs to for the current workspace, `YYYY-MM-DD`. */
export async function workspaceLocalDayKey(tx: TenantClient, at: Date): Promise<string> {
  const { timezone, hour } = await readDayBoundary(tx);
  return localDayKey(at, timezone, hour);
}

/**
 * SQL for the conversation day (a `date`) the timestamptz `column` falls on —
 * {@link localDayKey} in SQL. The wall clock is read in the workspace zone and
 * the boundary hour taken off the *wall clock* (a `timestamp`, which has no
 * daylight saving), so 05:59 local is the previous day under a 06:00 boundary
 * on both sides of a transition, exactly as `localDayKey` decides it. Zone and
 * hour are bound parameters, never spliced into the text.
 */
export function localDaySql(column: Prisma.Sql, boundary: DayBoundary): Prisma.Sql {
  return Prisma.sql`((${column} AT TIME ZONE ${boundary.timezone})
    - make_interval(hours => ${boundary.hour}::int))::date`;
}

/** {@link localDaySql} as `YYYY-MM-DD` text, the shape every `by_day` row carries. */
export function localDayKeySql(column: Prisma.Sql, boundary: DayBoundary): Prisma.Sql {
  return Prisma.sql`to_char(${localDaySql(column, boundary)}, 'YYYY-MM-DD')`;
}

/**
 * SQL for the workspace wall-clock hour (0-23) `column` falls in. An hour of
 * day is the clock on the wall, not shifted by the day boundary: a 06:00
 * boundary moves which day 05:30 belongs to, not which hour it is.
 */
export function localHourSql(column: Prisma.Sql, boundary: DayBoundary): Prisma.Sql {
  return Prisma.sql`EXTRACT(HOUR FROM ${column} AT TIME ZONE ${boundary.timezone})::int`;
}

/**
 * The instants the conversation days `[fromDay, toDay]` span, as a closed
 * window `{ from, to }` — the shape every report query filters with
 * (`>= from AND <= to`). `to` is one millisecond before the next day starts, so
 * the last day is whole and a chat filed under the following day is not in it.
 * A day of 23 or 25 hours stays whole because both ends come from
 * {@link localDayStart}, the inverse of the function that files chats.
 */
export function localDayWindow(
  fromDay: string,
  toDay: string,
  boundary: DayBoundary,
): { from: Date; to: Date } {
  const from = localDayStart(fromDay, boundary.timezone, boundary.hour);
  const next = localDayStart(shiftDayKey(toDay, 1), boundary.timezone, boundary.hour);
  return { from, to: new Date(next.getTime() - 1) };
}
