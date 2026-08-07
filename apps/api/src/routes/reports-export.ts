/**
 * Report groups and CSV export (FR-MOD-07.7).
 *
 * Two concerns share this module because they share one catalogue:
 *
 *   1. Permission-based visibility — a report is a *group* with a required
 *      scope, and a caller sees only the groups their token satisfies. The
 *      catalogue is the single source of truth for both what `/reports/groups`
 *      lists and what `/reports/export` will hand out, so the two can never
 *      disagree about who may read what.
 *   2. Export — each group serialises to CSV. The serialiser lives here, apart
 *      from the route, because its correctness (quoting, and the spreadsheet
 *      formula-injection guard below) is worth testing without a server.
 *
 * PDF and benchmark comparison are explicitly out of scope for v1 (PLAN §4.4.8,
 * PRD 07.7 marks them v2).
 */
import { hasAnyScope, type Scope } from '@nexa/types';

/** A report group: a named, scope-gated slice of the reports surface. */
export interface ReportGroup {
  id: string;
  label: string;
  /**
   * Scopes that grant this group, OR semantics. Every group today needs
   * `reports_read` — the whole reports surface is one permission — but the
   * catalogue carries the requirement per group so a future group gated on a
   * different scope (a billing export, say) drops in without reworking the
   * visibility or the guard.
   */
  scopes: Scope[];
}

/**
 * The catalogue, in the order the Reports page shows its tabs. Each id is the
 * `group` an export is requested for and the tab the web client renders, so the
 * three surfaces (tabs, groups list, export) speak one vocabulary.
 */
export const REPORT_GROUPS: readonly ReportGroup[] = [
  { id: 'overview', label: 'Overview', scopes: ['reports_read'] },
  { id: 'breakdown', label: 'Breakdown', scopes: ['reports_read'] },
  { id: 'ai-agent', label: 'AI Agent', scopes: ['reports_read'] },
  { id: 'reviews', label: 'Reviews', scopes: ['reports_read'] },
  { id: 'topics', label: 'Chat topics', scopes: ['reports_read'] },
  { id: 'cases', label: 'Cases', scopes: ['reports_read'] },
  { id: 'leads', label: 'Leads', scopes: ['reports_read'] },
  { id: 'team-performance', label: 'Team performance', scopes: ['reports_read'] },
  { id: 'sales', label: 'Sales', scopes: ['reports_read'] },
] as const;

export type ReportGroupId = (typeof REPORT_GROUPS)[number]['id'];

/**
 * Every scope that grants *some* group — the route-level requirement for the
 * export endpoint, so a token holding none of them is refused at the guard
 * before any group is even resolved. Kept in sync with the catalogue by
 * construction rather than hand-listed.
 */
export const EXPORT_SCOPES: Scope[] = [...new Set(REPORT_GROUPS.flatMap((group) => group.scopes))];

/** The group with this id, or undefined — the caller turns undefined into a 400. */
export function reportGroup(id: string): ReportGroup | undefined {
  return REPORT_GROUPS.find((group) => group.id === id);
}

/**
 * The groups a caller with these granted scopes may see. This *is* the
 * permission-based visibility rule (FR-MOD-07.7): a token missing `reports_read`
 * gets an empty list, not a 403 — "here is what you can see" answers honestly
 * with nothing rather than refusing to answer.
 */
export function visibleReportGroups(granted: readonly string[]): ReportGroup[] {
  return REPORT_GROUPS.filter((group) => hasAnyScope(granted, group.scopes));
}

/** A single CSV cell before serialisation. Null/undefined render as empty. */
export type CsvCell = string | number | null | undefined;

/**
 * Characters that make a spreadsheet treat a cell as a formula. A field a user
 * influenced (an agent name, a tag) that begins with one of these would run on
 * open — the classic CSV-injection path. `\t` and `\r` are here because Excel
 * treats a leading tab/carriage-return the same way.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One field, RFC 4180 quoted and injection-guarded.
 *
 * A string that opens with a formula lead gets a `'` prefix first — the standard
 * neutralisation, which spreadsheets strip on display but never execute. Then any
 * field containing a comma, quote, CR or LF is wrapped in double quotes with its
 * own quotes doubled. Numbers are emitted bare; null/undefined as empty.
 */
function csvField(cell: CsvCell): string {
  if (cell == null) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';

  const guarded = FORMULA_LEAD.test(cell) ? `'${cell}` : cell;
  if (/[",\r\n]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

/**
 * A header row plus data rows as RFC 4180 CSV. Lines end CRLF (what the spec and
 * Excel expect); the whole document ends with a trailing CRLF so a POSIX tool
 * that counts lines agrees with the row count.
 */
export function toCsv(headers: readonly string[], rows: readonly CsvCell[][]): string {
  const line = (cells: readonly CsvCell[]): string => cells.map(csvField).join(',');
  return [line(headers), ...rows.map(line)].map((row) => `${row}\r\n`).join('');
}

/**
 * A stable, filesystem-safe download name — `nexa-<group>-<from>-<to>.csv`,
 * dates as UTC `YYYY-MM-DD`. Encodes the window so two exports of the same group
 * over different ranges do not overwrite each other in a downloads folder.
 */
export function exportFilename(groupId: string, from: Date, to: Date): string {
  const day = (date: Date): string => date.toISOString().slice(0, 10);
  return `nexa-${groupId}-${day(from)}-${day(to)}.csv`;
}
