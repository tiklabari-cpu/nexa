/**
 * Report filters (RP-01 · tm 368): which conversations a report counts.
 *
 * One shape for every surface that narrows a report — the query string of
 * `GET /reports/{overview,breakdown,team-performance,reviews}` and
 * `GET /reports/export`, the `filters` of a share link and of a scheduled
 * export — so a figure on screen, in a download, behind a link and in a mailed
 * CSV is the same figure for the same filter.
 *
 * Identifiers only (GV-05): an agent is its account id, a team its numeric id,
 * a tag its id, a topic the AI's procedure key. Never an e-mail address or a
 * name, so a deep link (`/app/reports?group_id=5&agent_id=<uuid>`) carries no
 * personal data.
 *
 * Every key is a list, and a missing key means "no narrowing". Within a key
 * the values are any-of; across keys they are all-of:
 *
 * - `agent_id` — the connection's last assignee (`threads.assignee_id`);
 * - `group_id` — the conversation's access teams (`chat_access.group_id`);
 * - `tag` — any of these tags on the connection (`thread_tags`);
 * - `topic` — the topic the AI recorded for the connection (AI-05, the
 *   procedure key in `ai_conversation_outcomes.intent`). Not merged with
 *   tags: the two are different sources (RP-01 decision 2).
 *
 * The filter is at the conversation (thread) level. A report group whose
 * figures are not conversations (cases, leads, goals, …) does not take one —
 * see {@link REPORT_FILTERABLE_GROUPS}.
 *
 * Plain literals only: this module reaches the widget loader through the
 * barrel, and a top-level call would keep it in that bundle.
 */
export const REPORT_FILTER_KEYS = ['agent_id', 'group_id', 'tag', 'topic'] as const;

export type ReportFilterKey = (typeof REPORT_FILTER_KEYS)[number];

/** The most values one key may carry — bounds the `ANY(...)` list a request can make. */
export const REPORT_FILTER_MAX_VALUES = 50;

/** The longest topic key accepted (the AI metrics' `intent` bound). */
export const REPORT_FILTER_TOPIC_MAX_LENGTH = 200;

/** The wire shape. A team id travels as a decimal string: it is a bigint. */
export interface ReportFilter {
  agent_id?: string[];
  group_id?: string[];
  tag?: string[];
  topic?: string[];
}

/**
 * The report groups that take a {@link ReportFilter}: the ones counted from
 * conversations. Every other group refuses a filter with a 400 rather than
 * quietly returning unfiltered figures under a filtered heading.
 */
export const REPORT_FILTERABLE_GROUPS = [
  'overview',
  'breakdown',
  'team-performance',
  'reviews',
] as const;

export type ReportFilterableGroup = (typeof REPORT_FILTERABLE_GROUPS)[number];

export function isReportFilterableGroup(group: string): group is ReportFilterableGroup {
  return (REPORT_FILTERABLE_GROUPS as readonly string[]).includes(group);
}

/** Whether a filter narrows nothing — every key absent. */
export function isEmptyReportFilter(filter: ReportFilter | null | undefined): boolean {
  if (!filter) return true;
  return REPORT_FILTER_KEYS.every((key) => filter[key] === undefined);
}
