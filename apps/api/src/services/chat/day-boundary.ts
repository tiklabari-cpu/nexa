/**
 * The workspace's conversation day boundary (ID-04 · tm 285, decision K3).
 *
 * One reader, one function: the day a chat is filed under is
 * `localDayKey(at, timezone, hour)` from `@siyahtus/types` and nothing else — no
 * second computation in SQL, so the day a chat was filed under and the day a
 * report groups it by cannot disagree.
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
 * progress is therefore never split by an edit.
 */
import {
  DEFAULT_DAY_BOUNDARY,
  isDayBoundaryHour,
  isDayBoundaryTimeZone,
  localDayKey,
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
