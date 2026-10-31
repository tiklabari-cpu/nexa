/**
 * Report filters in the console (RP-01 · tm 368.2): which conversations a
 * report counts, as the address, the saved views, the export and the share
 * link carry them.
 *
 * The shape is the server's (`ReportFilter`, `@siyahtus/types`): four lists —
 * `agent_id`, `group_id` (a team), `tag`, `topic` — any-of within a list,
 * all-of across lists. The address carries **identifiers only** (GV-05): an
 * agent and a tag by their uuid, a team by its number, a topic by the AI's
 * procedure key. Never an e-mail address or a name, so a link pasted into a chat
 * leaks no personal data; a value that is not an identifier of that kind is
 * dropped on the way in rather than echoed into a request.
 *
 * Only the four conversation reports take a filter (`REPORT_FILTERABLE_GROUPS`);
 * any other group answers a filter with a 400. So {@link reportFilterParams}
 * returns nothing for them, and the page says the filter does not apply instead
 * of showing unfiltered figures under a filtered heading.
 *
 * Pure functions only — the bar (`ReportFilterBar.tsx`) and the page bind them.
 */
import {
  REPORT_FILTER_KEYS,
  REPORT_FILTER_MAX_VALUES,
  REPORT_FILTER_TOPIC_MAX_LENGTH,
  isReportFilterableGroup,
  type ReportFilterKey,
} from '@siyahtus/types';

/** The filter the page holds: every key present, an empty list meaning "no narrowing". */
export type ReportFilterState = Record<ReportFilterKey, string[]>;

export const NO_REPORT_FILTER: ReportFilterState = {
  agent_id: [],
  group_id: [],
  tag: [],
  topic: [],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEAM_ID = /^\d{1,18}$/;

/** One value in the canonical spelling of its key, or null when it is not an identifier of that kind. */
function cleanValue(key: ReportFilterKey, raw: string): string | null {
  switch (key) {
    case 'agent_id':
    case 'tag':
      return UUID.test(raw) ? raw.toLowerCase() : null;
    case 'group_id':
      // `05` and `5` are one team.
      return TEAM_ID.test(raw) ? BigInt(raw).toString() : null;
    case 'topic': {
      const topic = raw.trim();
      return topic.length > 0 && topic.length <= REPORT_FILTER_TOPIC_MAX_LENGTH ? topic : null;
    }
  }
}

/** A list in canonical form: invalid values dropped, duplicates dropped, at most the API's bound. */
function cleanList(key: ReportFilterKey, values: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const value = cleanValue(key, raw);
    if (value !== null && !out.includes(value)) out.push(value);
    if (out.length >= REPORT_FILTER_MAX_VALUES) break;
  }
  return out;
}

/** The same filter in canonical form (what a saved view or a stored value is read through). */
export function normalizeReportFilter(
  filter: Partial<Record<ReportFilterKey, readonly string[]>> | null | undefined,
): ReportFilterState {
  const out: ReportFilterState = { agent_id: [], group_id: [], tag: [], topic: [] };
  for (const key of REPORT_FILTER_KEYS) out[key] = cleanList(key, filter?.[key] ?? []);
  return out;
}

/** The filter an address names; anything that is not an identifier is ignored. */
export function parseReportFilter(params: URLSearchParams): ReportFilterState {
  const out: ReportFilterState = { agent_id: [], group_id: [], tag: [], topic: [] };
  for (const key of REPORT_FILTER_KEYS) out[key] = cleanList(key, params.getAll(key));
  return out;
}

/** The address after the filter changed: the page's other keys (`tab`, `view`) stay. */
export function writeReportFilter(
  params: URLSearchParams,
  filter: ReportFilterState,
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of REPORT_FILTER_KEYS) {
    next.delete(key);
    for (const value of filter[key]) next.append(key, value);
  }
  return next;
}

/** Whether the filter narrows nothing. */
export function isReportFilterEmpty(filter: ReportFilterState): boolean {
  return REPORT_FILTER_KEYS.every((key) => filter[key].length === 0);
}

/** How many keys narrow the report — the number the "Filters" summary shows. */
export function activeReportFilterKeys(filter: ReportFilterState): ReportFilterKey[] {
  return REPORT_FILTER_KEYS.filter((key) => filter[key].length > 0);
}

/** Whether a report group (a tab's endpoint) takes a filter at all. */
export function takesReportFilter(group: string): boolean {
  return isReportFilterableGroup(group);
}

/**
 * The query-string half a request to `group` carries: `agent_id=a&agent_id=b&…`,
 * empty when the filter narrows nothing **or the group does not take one**.
 * Every request that asks for a report — the report itself, its export, a
 * share link's body — goes through this one function, so a tab cannot send a
 * filter its endpoint refuses, nor forget to send one it takes.
 */
export function reportFilterParams(group: string, filter: ReportFilterState): string {
  if (!takesReportFilter(group)) return '';
  const params = new URLSearchParams();
  for (const key of REPORT_FILTER_KEYS) for (const value of filter[key]) params.append(key, value);
  return params.toString();
}

/** The `filters` object a share link or a schedule is created with; absent when nothing narrows. */
export function reportFilterBody(
  group: string,
  filter: ReportFilterState,
): Partial<Record<ReportFilterKey, string[]>> | undefined {
  if (!takesReportFilter(group) || isReportFilterEmpty(filter)) return undefined;
  const body: Partial<Record<ReportFilterKey, string[]>> = {};
  for (const key of REPORT_FILTER_KEYS) if (filter[key].length > 0) body[key] = [...filter[key]];
  return body;
}

/** A stable react-query key part: the same filter is the same key. */
export function reportFilterKey(group: string, filter: ReportFilterState): string {
  return reportFilterParams(group, filter);
}

/** `/app/reports` opened on one team's conversations — the team page's "View reports". */
export function teamReportsHref(groupId: number | string): string {
  return `/app/reports?group_id=${encodeURIComponent(String(groupId))}`;
}

/** `/app/reports` opened on one agent's conversations — the member page's "View reports". */
export function agentReportsHref(agentId: string): string {
  return `/app/reports?agent_id=${encodeURIComponent(agentId)}`;
}
