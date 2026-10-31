/**
 * Report filters (RP-01 · tm 368): the one place a report learns which
 * conversations it counts.
 *
 * Every conversation report query — the JSON reports, their CSV/PDF export, a
 * share link's read and a scheduled run — narrows its rows through the SQL
 * fragments below, never through a predicate of its own. A filter added to
 * each query by hand is a filter one query forgets, and then the screen and the
 * download quote two different numbers for the same filter (05 RP-01
 * "Riskler"); `report-filter-all-endpoints.test.ts` holds every conversation
 * group to it.
 *
 * Definitions (05 RP-01 "Kodlama mantığı"):
 *   - agent — the connection's last assignee (`threads.assignee_id`);
 *   - team — the conversation's access teams (`chat_access.group_id`);
 *   - tag — any of the tags on the connection (`thread_tags`);
 *   - topic — the AI's recorded topic for the connection (AI-05, the
 *     procedure key in `ai_conversation_outcomes.intent`), not a tag.
 * Any-of within a key, all-of across keys.
 *
 * The reach (RL-02 · K7): `reports_read` reads the workspace, so its filter is
 * the one it asked for. `reports_read--groups` reads the teams its holder
 * leads, and the server — never the client — intersects the requested teams
 * with those; an empty intersection is an empty report.
 */
import { Prisma } from '@prisma/client';
import {
  hasAnyScope,
  isReportFilterableGroup,
  REPORT_FILTER_KEYS,
  REPORT_FILTER_MAX_VALUES,
  REPORT_FILTER_TOPIC_MAX_LENGTH,
  type ReportFilter,
} from '@siyahtus/types';
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { ledGroupIds } from '../team/led-groups.js';

/**
 * The filter the queries read. `null` = nothing narrows the report. A present
 * key with an empty list matches nothing — that is how a Team Lead whose
 * requested teams do not meet the teams they lead reads an empty report.
 */
export interface ThreadFilter {
  readonly agentIds?: readonly string[];
  readonly groupIds?: readonly bigint[];
  readonly tagIds?: readonly string[];
  readonly topics?: readonly string[];
}

const uuid = z.string().uuid();
const teamId = z.string().regex(/^\d{1,18}$/);
const topic = z.string().trim().min(1).max(REPORT_FILTER_TOPIC_MAX_LENGTH);

/** One value or several — `?agent_id=a` and `?agent_id=a&agent_id=b` alike. */
function oneOrMany<T extends z.ZodTypeAny>(item: T) {
  return z
    .union([item, z.array(item).max(REPORT_FILTER_MAX_VALUES)])
    .transform((value): z.infer<T>[] => (Array.isArray(value) ? value : [value]))
    .optional();
}

/**
 * The query-string half. Not strict: the window, the baseline and the export's
 * own keys ride on the same query string.
 */
export const reportFilterQuery = z.object({
  agent_id: oneOrMany(uuid),
  group_id: oneOrMany(teamId),
  tag: oneOrMany(uuid),
  topic: oneOrMany(topic),
});

/**
 * The JSON-body half (share links, scheduled exports). Strict, so a misspelt
 * key is a 400 rather than a link frozen to a wider filter than its creator
 * meant. A team id may arrive as a number or a decimal string.
 */
export const reportFilterBody = z
  .object({
    agent_id: z.array(uuid).max(REPORT_FILTER_MAX_VALUES).optional(),
    group_id: z
      .array(
        z
          .union([teamId, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)])
          .transform(String),
      )
      .max(REPORT_FILTER_MAX_VALUES)
      .optional(),
    tag: z.array(uuid).max(REPORT_FILTER_MAX_VALUES).optional(),
    topic: z.array(topic).max(REPORT_FILTER_MAX_VALUES).optional(),
  })
  .strict();

/**
 * The wire filter in one canonical spelling: duplicates dropped, ids
 * lower-cased, an empty list the same as an absent key. Stored and echoed in
 * this form, so two requests that mean the same filter look the same.
 */
export function normalizeReportFilter(input: {
  agent_id?: readonly string[] | undefined;
  group_id?: readonly string[] | undefined;
  tag?: readonly string[] | undefined;
  topic?: readonly string[] | undefined;
}): ReportFilter {
  const out: ReportFilter = {};
  const clean = (values: readonly string[] | undefined, lower: boolean): string[] | undefined => {
    if (values === undefined) return undefined;
    const unique = [...new Set(values.map((value) => (lower ? value.toLowerCase() : value)))];
    return unique.length === 0 ? undefined : unique;
  };
  const agents = clean(input.agent_id, true);
  // A team id is a bigint: `05` and `5` are one team.
  const teams = clean(
    input.group_id?.map((value) => BigInt(value).toString()),
    false,
  );
  const tags = clean(input.tag, true);
  const topics = clean(input.topic, false);
  if (agents) out.agent_id = agents;
  if (teams) out.group_id = teams;
  if (tags) out.tag = tags;
  if (topics) out.topic = topics;
  return out;
}

/** The query string's filter, or a 400 naming the key that was wrong. */
export function parseReportFilterQuery(query: unknown): ReportFilter {
  const parsed = reportFilterQuery.safeParse(query ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue?.path[0];
    throw ApiError.validation(
      typeof key === 'string'
        ? `\`${key}\`: ${issue?.message ?? 'invalid value'}.`
        : 'Invalid report filter.',
    );
  }
  return normalizeReportFilter(parsed.data);
}

/** Whether the query string names any filter key at all. */
export function queryNamesReportFilter(query: unknown): boolean {
  if (query === null || typeof query !== 'object') return false;
  return REPORT_FILTER_KEYS.some((key) => (query as Record<string, unknown>)[key] !== undefined);
}

/**
 * A 400 for a report group counted from something other than conversations —
 * cases, leads, goals… — when a filter is sent to it. Refused rather than
 * ignored: unfiltered figures under a filtered heading are the wrong number
 * presented as the right one.
 */
export function refuseReportFilter(group: string): never {
  throw ApiError.validation(
    `The ${group} report does not take report filters (agent_id, group_id, tag, topic).`,
  );
}

/** The queries' form of a wire filter; `null` when it narrows nothing. */
export function toThreadFilter(filter: ReportFilter | null | undefined): ThreadFilter | null {
  if (!filter) return null;
  const out: {
    agentIds?: string[];
    groupIds?: bigint[];
    tagIds?: string[];
    topics?: string[];
  } = {};
  if (filter.agent_id !== undefined) out.agentIds = [...filter.agent_id];
  if (filter.group_id !== undefined) out.groupIds = filter.group_id.map((id) => BigInt(id));
  if (filter.tag !== undefined) out.tagIds = [...filter.tag];
  if (filter.topic !== undefined) out.topics = [...filter.topic];
  return Object.keys(out).length === 0 ? null : out;
}

/** The wire form of an applied filter — what a report echoes as `filters`. */
export function toWireFilter(filter: ThreadFilter | null): ReportFilter {
  if (!filter) return {};
  const out: ReportFilter = {};
  if (filter.agentIds !== undefined) out.agent_id = [...filter.agentIds];
  if (filter.groupIds !== undefined) out.group_id = filter.groupIds.map(String);
  if (filter.tagIds !== undefined) out.tag = [...filter.tagIds];
  if (filter.topics !== undefined) out.topic = [...filter.topics];
  return out;
}

/** A wire filter as the JSONB a share link or a schedule stores. */
export function reportFilterJson(filter: ReportFilter | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of REPORT_FILTER_KEYS) {
    const values = filter?.[key];
    if (values !== undefined) out[key] = [...values];
  }
  return out;
}

/** A stored `filters` JSONB column read back; anything malformed is a 500, not a wider report. */
export function storedReportFilter(value: unknown): ReportFilter {
  const parsed = reportFilterBody.safeParse(value ?? {});
  if (!parsed.success) {
    // Fail closed: a stored filter we cannot read must not run as "no filter".
    throw new Error('A stored report filter is not a ReportFilter.');
  }
  return normalizeReportFilter(parsed.data);
}

/**
 * The filter a caller's report actually runs with.
 *
 * `reports_read` — the workspace — runs the filter it asked for. A
 * `reports_read--groups` holder runs it bounded to the teams they lead: the
 * requested `group_id` intersected with those teams, or those teams when none
 * was requested. Read from the database on every request (`ledGroupIds`), so
 * stepping down as lead takes effect on the next click. Anyone else is refused
 * — the route gate should already have.
 */
export async function resolveReportReach(
  tx: TenantClient,
  principal: Principal,
  requested: ReportFilter,
): Promise<ThreadFilter | null> {
  if (principal.kind === 'customer') {
    throw ApiError.authorization('This token cannot read reports.');
  }
  if (hasAnyScope(principal.scopes, ['reports_read'])) return toThreadFilter(requested);
  if (!hasAnyScope(principal.scopes, ['reports_read--groups'])) {
    throw ApiError.authorization('This token cannot read reports.');
  }
  // A bot has no teams to lead, so its team-bounded reach is empty.
  const led = principal.kind === 'agent' ? await ledGroupIds(tx, principal.accountId) : [];
  const ledSet = new Set(led.map(String));
  const groupIds =
    requested.group_id === undefined
      ? led
      : requested.group_id.filter((id) => ledSet.has(id)).map((id) => BigInt(id));
  return { ...(toThreadFilter(requested) ?? {}), groupIds };
}

/** Whether a report group may be given a non-null filter; a 400 when not. */
export function assertFilterable(group: string, filter: ThreadFilter | null): void {
  if (filter !== null && !isReportFilterableGroup(group)) refuseReportFilter(group);
}

// ---------------------------------------------------------------------------
// The SQL — one fragment per table a conversation report reads
// ---------------------------------------------------------------------------

const uuids = (ids: readonly string[]) => Prisma.sql`${[...ids]}::uuid[]`;
const bigints = (ids: readonly bigint[]) => Prisma.sql`${ids.map(String)}::bigint[]`;
const texts = (values: readonly string[]) => Prisma.sql`${[...values]}::text[]`;

/**
 * The conversation filter on a `threads` row aliased `alias`, as a boolean
 * expression (`TRUE` when nothing narrows). An empty list is `= ANY('{}')`,
 * false for every row — the empty intersection's empty report.
 *
 * `chat_access` has no licence column; the chat id is unique platform-wide and
 * the thread row is already licence-bound, so the join cannot cross tenants.
 */
export function threadFilterSql(filter: ThreadFilter | null, alias = 't'): Prisma.Sql {
  if (filter === null) return Prisma.sql`TRUE`;
  const t = Prisma.raw(alias);
  const parts: Prisma.Sql[] = [];
  if (filter.agentIds !== undefined) {
    parts.push(Prisma.sql`${t}.assignee_id = ANY(${uuids(filter.agentIds)})`);
  }
  if (filter.groupIds !== undefined) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM chat_access rf_ca
      WHERE rf_ca.chat_id = ${t}.chat_id AND rf_ca.group_id = ANY(${bigints(filter.groupIds)})
    )`);
  }
  if (filter.tagIds !== undefined) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM thread_tags rf_tt
      WHERE rf_tt.thread_id = ${t}.id AND rf_tt.tag_id = ANY(${uuids(filter.tagIds)})
    )`);
  }
  if (filter.topics !== undefined) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ai_conversation_outcomes rf_o
      WHERE rf_o.license_id = ${t}.license_id AND rf_o.thread_id = ${t}.id
        AND rf_o.intent = ANY(${texts(filter.topics)})
    )`);
  }
  return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.sql`(${Prisma.join(parts, ' AND ')})`;
}

/**
 * The team half of the filter on a `chat_access` row: the Breakdown's per-team
 * rows under a team filter are the filtered teams', not every team a matching
 * chat is also shared with. `TRUE` when no team filter is set.
 */
export function accessTeamSql(filter: ThreadFilter | null, alias = 'ca'): Prisma.Sql {
  if (filter?.groupIds === undefined) return Prisma.sql`TRUE`;
  return Prisma.sql`${Prisma.raw(alias)}.group_id = ANY(${bigints(filter.groupIds)})`;
}

/**
 * The same filter on a `ratings` row: a rating counts when the connection it
 * rates passes. A rating with no connection (rows before `thread_id` was
 * written) cannot be attributed, so a filter excludes it.
 */
export function ratingFilterSql(filter: ThreadFilter | null, alias = 'r'): Prisma.Sql {
  if (filter === null) return Prisma.sql`TRUE`;
  const r = Prisma.raw(alias);
  return Prisma.sql`EXISTS (
    SELECT 1 FROM threads rf_t
    WHERE rf_t.id = ${r}.thread_id AND rf_t.license_id = ${r}.license_id
      AND ${threadFilterSql(filter, 'rf_t')}
  )`;
}

/**
 * The same filter on a `tickets` row, for the Overview's "total cases": agent
 * = the ticket's assignee, team = the ticket's team, tag = any of its tags,
 * topic = the AI's topic on the connection it was opened from.
 */
export function ticketFilterSql(filter: ThreadFilter | null, alias = 'tk'): Prisma.Sql {
  if (filter === null) return Prisma.sql`TRUE`;
  const tk = Prisma.raw(alias);
  const parts: Prisma.Sql[] = [];
  if (filter.agentIds !== undefined) {
    parts.push(Prisma.sql`${tk}.assignee_id = ANY(${uuids(filter.agentIds)})`);
  }
  if (filter.groupIds !== undefined) {
    parts.push(Prisma.sql`${tk}.group_id = ANY(${bigints(filter.groupIds)})`);
  }
  if (filter.tagIds !== undefined) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ticket_tags rf_kt
      WHERE rf_kt.ticket_id = ${tk}.id AND rf_kt.tag_id = ANY(${uuids(filter.tagIds)})
    )`);
  }
  if (filter.topics !== undefined) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM ai_conversation_outcomes rf_ko
      WHERE rf_ko.license_id = ${tk}.license_id AND rf_ko.thread_id = ${tk}.source_thread_id
        AND rf_ko.intent = ANY(${texts(filter.topics)})
    )`);
  }
  return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.sql`(${Prisma.join(parts, ' AND ')})`;
}

/**
 * The same filter on an `sla_breaches` row: a miss counts when its subject — a
 * connection or a ticket — passes the filter for its kind.
 */
export function slaBreachFilterSql(filter: ThreadFilter | null, alias = 'sb'): Prisma.Sql {
  if (filter === null) return Prisma.sql`TRUE`;
  const sb = Prisma.raw(alias);
  return Prisma.sql`(
    (${sb}.subject_type = 'thread' AND EXISTS (
      SELECT 1 FROM threads rf_st
      WHERE rf_st.id = ${sb}.subject_id AND rf_st.license_id = ${sb}.license_id
        AND ${threadFilterSql(filter, 'rf_st')}
    ))
    OR (${sb}.subject_type = 'ticket' AND EXISTS (
      SELECT 1 FROM tickets rf_sk
      WHERE rf_sk.id = ${sb}.subject_id AND rf_sk.license_id = ${sb}.license_id
        AND ${ticketFilterSql(filter, 'rf_sk')}
    ))
  )`;
}
