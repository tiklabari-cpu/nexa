/**
 * The AI quality metrics (tm 320.2 · SiyahTuş analysis AI-25 "Kodlama
 * mantığı", owner decisions K9, K10 · `@siyahtus/types` `ai-metrics.ts`):
 * read from the `ai_conversation_outcomes` rows tm 320.1 writes.
 *
 *   - **Finalize** ({@link AiOutcomeFinalizer}, the scheduler's
 *     `ai_outcomes_finalize`): a row whose connection ended 72 hours ago is
 *     settled once — did the same member open any connection in those 72
 *     hours, and one about the same topic? — and an `assumed_pending` one
 *     becomes `assumed_resolved` or `false_resolved` ({@link finalizedOutcome}).
 *     A row with no member (an unverified visitor) is settled with the repeat
 *     unknown: the "not measurable" bucket.
 *   - **Rollup** ({@link AiMetricsRollup}, `ai_metrics_rollup`): the additive
 *     counts per workspace day and per brand, team, topic, version and
 *     language, in `ai_metrics_daily` — a day rebuilt whole when one of its
 *     rows changed.
 *   - **The report's `quality` block** ({@link readAiQuality}), **the
 *     breakdown** ({@link readAiQualityBreakdown}) and **the list behind a
 *     figure** ({@link listAiMetricConversations}).
 *
 * One SQL ({@link countsSelect}) counts for the report, the breakdown and the
 * rollup, so a day's rollup and its raw rows cannot disagree; the definitions
 * are `aiMetricCountsOf`'s in `@siyahtus/types`, which the tests hold this SQL
 * to. The report reads the raw rows rather than the rollup: an hourly rollup
 * would lag a QA result or a close by up to an hour, and a median does not add
 * up across days.
 *
 * None of this touches ADR-09a's billed AI resolution (`handled_by`): the
 * report keeps `resolutions` as it was and adds this beside it (AI-25-S1).
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AI_CONSISTENCY_SETTLED_OUTCOMES,
  AI_METRIC_COUNT_KEYS,
  AI_OUTCOME_FINALIZE_HOURS,
  QA_MANDATORY_HANDOFF_REASONS,
  aiConsistency,
  aiQualityRates,
  aiWaitSummary,
  hasAnyScope,
  emptyAiMetricCounts,
  finalizedOutcome,
  type AiMetricCounts,
  type AiMetricsBreakdownDimension,
  type AiMetricsConversationList,
  type AiOutcome,
  type AiOutcomeQaResult,
  type AiQualityRates,
  type AiWaitSummary,
} from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import { requireQaReach } from '../qa/qa-service.js';
import { nextOpenAt, type BusinessWeek } from '../sla/business-hours.js';
import { readBusinessWeek } from '../sla/sla-service.js';

const HOUR_MS = 3_600_000;

/** Rows the finalize job settles per workspace per batch. */
export const AI_OUTCOME_FINALIZE_BATCH = 500;
/** Batches per workspace per tick: a backlog is worked off over the next ticks. */
const AI_OUTCOME_FINALIZE_BATCHES_MAX = 20;
/** At most this many mandatory hand-over violations the `quality` block lists by id. */
export const AI_MANDATORY_VIOLATIONS_LISTED_MAX = 50;
/** At most this many groups a breakdown returns, the largest first. */
export const AI_METRICS_BREAKDOWN_GROUPS_MAX = 100;

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * What a reader narrows to. `teamIds` is the caller's reach — a Team Lead's
 * led teams (RL-02); `null` is every team. The rest are the report's filters.
 */
export interface AiMetricsFilter {
  readonly teamIds: readonly bigint[] | null;
  readonly teamId?: bigint;
  readonly brandId?: string;
  readonly intent?: string;
  readonly configVersionId?: string;
  readonly language?: string;
}

export const ALL_AI_METRICS: AiMetricsFilter = { teamIds: null };

/**
 * Whose rows a caller reads (AI-25 "Roller", RL-02): `reports_read` — the
 * Founder and administrators — every team's; a Team Lead, who holds no
 * `reports_read` (`reports.view` has no team level yet, #368), the teams they
 * lead, through the QA reviewer's reach (`ai.qa.review`, the same row that
 * opens Raporlar › AI kalite to them); anyone else a 403.
 */
export async function aiMetricsReachOf(
  tx: TenantClient,
  principal: Principal,
): Promise<readonly bigint[] | null> {
  if (principal.kind !== 'customer' && hasAnyScope(principal.scopes, ['reports_read'])) {
    return null;
  }
  const reach = await requireQaReach(tx, principal);
  return reach.all ? null : reach.teamIds;
}

function filterSql(filter: AiMetricsFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filter.teamIds !== null) {
    // A lead of no team reaches no row; `= ANY('{}')` is false for every row.
    parts.push(Prisma.sql`o.team_id = ANY(${filter.teamIds.map(String)}::bigint[])`);
  }
  if (filter.teamId !== undefined) parts.push(Prisma.sql`o.team_id = ${filter.teamId}`);
  if (filter.brandId !== undefined) parts.push(Prisma.sql`o.brand_id = ${filter.brandId}::uuid`);
  if (filter.intent !== undefined) parts.push(Prisma.sql`o.intent = ${filter.intent}`);
  if (filter.configVersionId !== undefined) {
    parts.push(Prisma.sql`o.config_version_id = ${filter.configVersionId}::uuid`);
  }
  if (filter.language !== undefined) parts.push(Prisma.sql`o.language = ${filter.language}`);
  return parts.length === 0 ? Prisma.sql`TRUE` : Prisma.join(parts, ' AND ');
}

function windowSql(from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`o.ended_at >= ${from} AND o.ended_at < ${to}`;
}

// ---------------------------------------------------------------------------
// The counts — one SQL for the report, the breakdown and the rollup
// ---------------------------------------------------------------------------

/** Ended, and the AI wrote at least one turn: the denominator N. */
const IN_N = Prisma.sql`o.ended_at IS NOT NULL AND o.ai_turns >= 1`;
const ENDED = Prisma.sql`o.ended_at IS NOT NULL`;
const SETTLED = Prisma.sql`o.outcome IN ('confirmed_resolved', 'assumed_resolved', 'false_resolved')`;
const FALSE_IN_SETTLED = Prisma.sql`(${IN_N} AND ${SETTLED} AND (o.outcome = 'false_resolved'
  OR o.repeat_same_intent_72h IS TRUE OR o.qa_result = 'unresolved'))`;
const AI_ALONE = Prisma.sql`o.handoff_at IS NULL AND o.first_human_reply_at IS NULL`;
const CLARIFIED = Prisma.sql`o.required_slots_total > 0
  AND o.required_slots_filled = o.required_slots_total`;

/**
 * Each count of `AiMetricCounts` as a column over the rows aliased `o` — the
 * same predicates as `aiMetricCountsOf` (`@siyahtus/types`).
 */
const COUNT_COLUMNS: Readonly<Record<keyof AiMetricCounts, Prisma.Sql>> = {
  ended: Prisma.sql`count(*) FILTER (WHERE ${ENDED})`,
  conversations: Prisma.sql`count(*) FILTER (WHERE ${IN_N})`,
  confirmed: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.outcome = 'confirmed_resolved')`,
  assumed: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.outcome = 'assumed_resolved')`,
  false_resolved: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.outcome = 'false_resolved')`,
  unsettled: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.outcome = 'assumed_pending')`,
  handed_off: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.outcome = 'handed_off')`,
  abandoned: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.outcome = 'abandoned')`,
  declined: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.outcome = 'declined')`,
  false_in_settled: Prisma.sql`count(*) FILTER (WHERE ${FALSE_IN_SETTLED})`,
  contained: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.first_human_reply_at IS NULL)`,
  card_sufficient: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.handoff_card_rating = 'sufficient')`,
  card_insufficient: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.handoff_card_rating = 'insufficient')`,
  reasked: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.agent_reasked IS TRUE)`,
  reask_judged: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.agent_reasked IS NOT NULL)`,
  mandatory_triggered: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.handoff_mandatory_rule IS NOT NULL)`,
  mandatory_compliant: Prisma.sql`count(*) FILTER (WHERE ${ENDED}
    AND o.handoff_mandatory_rule IS NOT NULL AND NOT o.mandatory_handoff_violation)`,
  mandatory_violations: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.mandatory_handoff_violation)`,
  mandatory_due: Prisma.sql`count(*) FILTER (WHERE ${ENDED}
    AND (o.handoff_mandatory_rule IS NOT NULL OR o.mandatory_handoff_violation))`,
  guardrail_confirmed: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.guardrail_violations_confirmed > 0)`,
  guardrail_suspected: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND jsonb_array_length(o.guardrail_hits) > 0)`,
  bsat_good: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND ${AI_ALONE} AND o.bsat = 'good')`,
  bsat_bad: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND ${AI_ALONE} AND o.bsat = 'bad')`,
  csat_good: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.csat_after_handoff = 'good')`,
  csat_bad: Prisma.sql`count(*) FILTER (WHERE ${ENDED} AND o.csat_after_handoff = 'bad')`,
  clarification_turns: Prisma.sql`coalesce(sum(o.clarification_turns) FILTER (WHERE ${IN_N} AND ${CLARIFIED}), 0)`,
  clarification_rows: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND ${CLARIFIED})`,
  repeat_any: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.repeat_any_72h IS TRUE)`,
  repeat_same_intent: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.repeat_same_intent_72h IS TRUE)`,
  repeat_unmeasured: Prisma.sql`count(*) FILTER (WHERE ${IN_N} AND o.member_key IS NULL)`,
};

/** `count(...)::int AS ended, …` — every count, as named columns. */
function countsSelect(): Prisma.Sql {
  return Prisma.join(
    AI_METRIC_COUNT_KEYS.map(
      (key) => Prisma.sql`(${COUNT_COLUMNS[key]})::int AS ${Prisma.raw(key)}`,
    ),
    ', ',
  );
}

function countsOf(row: Record<string, unknown> | undefined): AiMetricCounts {
  const counts = emptyAiMetricCounts();
  if (!row) return counts;
  for (const key of AI_METRIC_COUNT_KEYS) counts[key] = Number(row[key] ?? 0);
  return counts;
}

/** The counts over the raw rows that ended in a window (the reference for the rollup). */
export async function readAiMetricCounts(
  tx: TenantClient,
  from: Date,
  to: Date,
  filter: AiMetricsFilter = ALL_AI_METRICS,
): Promise<AiMetricCounts> {
  const rows = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT ${countsSelect()} FROM ai_conversation_outcomes o
     WHERE ${windowSql(from, to)} AND ${filterSql(filter)}`;
  return countsOf(rows[0]);
}

// ---------------------------------------------------------------------------
// The `quality` block
// ---------------------------------------------------------------------------

/** A mandatory hand-over QA says was missed or late, by id (AI-25: "ihlaller ID'leriyle"). */
export interface AiMandatoryViolation {
  thread_id: string;
  chat_id: string;
  ended_at: string;
  handoff_mandatory_rule: string | null;
}

export interface AiQualityBlock extends AiQualityRates {
  counts: AiMetricCounts;
  /** K9: what the AI said and what the player answered, apart. */
  claims: {
    ai_claimed_resolved: number;
    player_confirmed: number;
    player_denied: number;
    claimed_unanswered: number;
  };
  handoff_reasons: { reason: string; count: number }[];
  handoff_wait: {
    all: AiWaitSummary;
    /** Null when the workspace has saved no work schedule: no business hours to split by. */
    in_hours: AiWaitSummary | null;
    out_of_hours: AiWaitSummary | null;
  };
  consistency: number | null;
  mandatory_violations: AiMandatoryViolation[];
}

/** True when `at` falls in an open minute of the workspace's week. */
function openAt(week: BusinessWeek, at: Date): boolean {
  const next = nextOpenAt(week, at);
  return next !== null && next.getTime() <= Math.floor(at.getTime() / 60_000) * 60_000;
}

/**
 * The `quality` block of `GET /reports/ai-agent` (and every breakdown row's
 * total): the rates, the counts behind them, the K9 claims, the hand-over
 * reasons, the wait after a hand-over, consistency and the mandatory
 * hand-over violations by id.
 */
export async function readAiQuality(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: AiMetricsFilter = ALL_AI_METRICS,
): Promise<AiQualityBlock> {
  const where = Prisma.sql`${windowSql(from, to)} AND ${filterSql(filter)}`;
  const [aggregate] = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT ${countsSelect()},
           count(*) FILTER (WHERE ${IN_N} AND o.ai_claimed_resolved)::int AS ai_claimed_resolved,
           count(*) FILTER (WHERE ${IN_N} AND o.resolution_confirmation = 'yes')::int AS player_confirmed,
           count(*) FILTER (WHERE ${IN_N} AND o.resolution_confirmation = 'no')::int AS player_denied,
           count(*) FILTER (WHERE ${IN_N} AND o.ai_claimed_resolved
                              AND o.resolution_confirmation IS NULL)::int AS claimed_unanswered
      FROM ai_conversation_outcomes o WHERE ${where}`;
  const counts = countsOf(aggregate);

  const reasons = await tx.$queryRaw<{ reason: string; count: number }[]>`
    SELECT o.handoff_reason AS reason, count(*)::int AS count
      FROM ai_conversation_outcomes o
     WHERE ${where} AND ${IN_N} AND o.outcome = 'handed_off' AND o.handoff_reason IS NOT NULL
     GROUP BY o.handoff_reason ORDER BY count(*) DESC, o.handoff_reason`;

  const waits = await tx.$queryRaw<{ handoff_at: Date; seconds: number }[]>`
    SELECT o.handoff_at,
           extract(epoch FROM (o.first_human_reply_at - o.handoff_at))::int AS seconds
      FROM ai_conversation_outcomes o
     WHERE ${where} AND o.handoff_at IS NOT NULL
       AND o.first_human_reply_at IS NOT NULL AND o.first_human_reply_at >= o.handoff_at`;
  const week = waits.length === 0 ? null : await readBusinessWeek(tx, { licenseId }, to);
  const inHours: number[] = [];
  const outOfHours: number[] = [];
  if (week) {
    for (const wait of waits)
      (openAt(week, wait.handoff_at) ? inHours : outOfHours).push(wait.seconds);
  }

  const groups = await tx.$queryRaw<{ settled: number; handed_off: number }[]>`
    SELECT count(*) FILTER (WHERE o.outcome = ANY(${[...AI_CONSISTENCY_SETTLED_OUTCOMES]}::text[]))::int AS settled,
           count(*) FILTER (WHERE o.outcome = 'handed_off')::int AS handed_off
      FROM ai_conversation_outcomes o
     WHERE ${where} AND ${IN_N} AND o.intent IS NOT NULL
       AND (o.handoff_mandatory_rule IS NULL
            OR NOT (o.handoff_mandatory_rule = ANY(${[...QA_MANDATORY_HANDOFF_REASONS]}::text[])))
     GROUP BY o.intent`;

  const violations = await tx.$queryRaw<AiMandatoryViolation[]>`
    SELECT o.thread_id, o.chat_id,
           to_char(o.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ended_at,
           o.handoff_mandatory_rule
      FROM ai_conversation_outcomes o
     WHERE ${where} AND o.mandatory_handoff_violation
     ORDER BY o.ended_at DESC, o.id DESC
     LIMIT ${AI_MANDATORY_VIOLATIONS_LISTED_MAX}`;

  return {
    ...aiQualityRates(counts),
    counts,
    claims: {
      ai_claimed_resolved: Number(aggregate?.['ai_claimed_resolved'] ?? 0),
      player_confirmed: Number(aggregate?.['player_confirmed'] ?? 0),
      player_denied: Number(aggregate?.['player_denied'] ?? 0),
      claimed_unanswered: Number(aggregate?.['claimed_unanswered'] ?? 0),
    },
    handoff_reasons: reasons,
    handoff_wait: {
      all: aiWaitSummary(waits.map((wait) => wait.seconds)),
      in_hours: week ? aiWaitSummary(inHours) : null,
      out_of_hours: week ? aiWaitSummary(outOfHours) : null,
    },
    consistency: aiConsistency(
      groups.map((g) => ({ settled: g.settled, handedOff: g.handed_off })),
    ),
    mandatory_violations: violations,
  };
}

// ---------------------------------------------------------------------------
// The breakdown
// ---------------------------------------------------------------------------

export interface AiQualityBreakdownRow {
  /** The group's value (a topic, a reason, an id, a language); null for "none". */
  key: string | null;
  /** A version's number (`v12`), a brand's or a team's name; the key otherwise. */
  label: string | null;
  quality: AiQualityRates & { counts: AiMetricCounts };
}

const DIMENSION_COLUMN: Readonly<Record<AiMetricsBreakdownDimension, Prisma.Sql>> = {
  intent: Prisma.sql`o.intent`,
  reason: Prisma.sql`o.handoff_reason`,
  version: Prisma.sql`o.config_version_id::text`,
  language: Prisma.sql`o.language`,
  brand: Prisma.sql`o.brand_id::text`,
  team: Prisma.sql`o.team_id::text`,
};

async function labelsOf(
  tx: TenantClient,
  by: AiMetricsBreakdownDimension,
  keys: readonly string[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (keys.length === 0) return labels;
  if (by === 'version') {
    const rows = await tx.aiConfigVersion.findMany({
      where: { id: { in: [...keys] } },
      select: { id: true, number: true, minor: true },
    });
    for (const row of rows) {
      labels.set(row.id, row.minor > 0 ? `v${row.number}.${row.minor}` : `v${row.number}`);
    }
  } else if (by === 'brand') {
    const rows = await tx.brand.findMany({
      where: { id: { in: [...keys] } },
      select: { id: true, name: true },
    });
    for (const row of rows) labels.set(row.id, row.name);
  } else if (by === 'team') {
    const rows = await tx.group.findMany({
      where: { id: { in: keys.map((key) => BigInt(key)) } },
      select: { id: true, name: true },
    });
    for (const row of rows) labels.set(String(row.id), row.name);
  }
  return labels;
}

/**
 * `GET /reports/ai-agent/breakdown?by=…`: the window's counts and rates per
 * topic, hand-over reason, AI version (side by side: v12 beside v13),
 * language, brand or team — the largest {@link AI_METRICS_BREAKDOWN_GROUPS_MAX}.
 */
export async function readAiQualityBreakdown(
  tx: TenantClient,
  from: Date,
  to: Date,
  filter: AiMetricsFilter,
  by: AiMetricsBreakdownDimension,
): Promise<AiQualityBreakdownRow[]> {
  const column = DIMENSION_COLUMN[by];
  const rows = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT ${column} AS key, ${countsSelect()}
      FROM ai_conversation_outcomes o
     WHERE ${windowSql(from, to)} AND ${filterSql(filter)}
     GROUP BY ${column}
     ORDER BY count(*) FILTER (WHERE ${IN_N}) DESC, count(*) DESC, ${column} NULLS LAST
     LIMIT ${AI_METRICS_BREAKDOWN_GROUPS_MAX}`;
  const keys = rows
    .map((row) => row['key'])
    .filter((key): key is string => typeof key === 'string');
  const labels = await labelsOf(tx, by, keys);
  return rows.map((row) => {
    const key = typeof row['key'] === 'string' ? row['key'] : null;
    const counts = countsOf(row);
    return {
      key,
      label: key === null ? null : (labels.get(key) ?? key),
      quality: { ...aiQualityRates(counts), counts },
    };
  });
}

// ---------------------------------------------------------------------------
// The list behind a figure
// ---------------------------------------------------------------------------

const LIST_WHERE: Readonly<Record<AiMetricsConversationList, Prisma.Sql>> = {
  confirmed_resolved: Prisma.sql`${IN_N} AND o.outcome = 'confirmed_resolved'`,
  assumed_resolved: Prisma.sql`${IN_N} AND o.outcome = 'assumed_resolved'`,
  unsettled: Prisma.sql`${IN_N} AND o.outcome = 'assumed_pending'`,
  false_resolution: FALSE_IN_SETTLED,
  handed_off: Prisma.sql`${IN_N} AND o.outcome = 'handed_off'`,
  abandoned: Prisma.sql`${IN_N} AND o.outcome = 'abandoned'`,
  declined: Prisma.sql`${IN_N} AND o.outcome = 'declined'`,
  mandatory_handoff_violation: Prisma.sql`${ENDED} AND o.mandatory_handoff_violation`,
  guardrail_violation: Prisma.sql`${IN_N} AND o.guardrail_violations_confirmed > 0`,
  guardrail_suspected: Prisma.sql`${IN_N} AND jsonb_array_length(o.guardrail_hits) > 0`,
  repeat_unmeasured: Prisma.sql`${IN_N} AND o.member_key IS NULL`,
};

export interface AiMetricConversation {
  id: string;
  /** The connection (panel "Chat ID"). */
  thread_id: string;
  /** The day container (panel "Thread ID"). */
  chat_id: string;
  started_at: string;
  ended_at: string;
  outcome: AiOutcome | null;
  intent: string | null;
  language: string | null;
  config_version_id: string | null;
  team_id: string | null;
  brand_id: string | null;
  ai_turns: number;
  ai_claimed_resolved: boolean;
  resolution_confirmation: string | null;
  handoff_reason: string | null;
  handoff_mandatory_rule: string | null;
  mandatory_handoff_violation: boolean;
  repeat_same_intent_72h: boolean | null;
  repeat_any_72h: boolean | null;
  qa_result: AiOutcomeQaResult | null;
  finalized_at: string | null;
}

/** An opaque keyset cursor: the last row's end (to the millisecond) and id. */
export function encodeAiMetricsCursor(endedAt: string, id: string): string {
  return Buffer.from(`${endedAt}|${id}`, 'utf8').toString('base64url');
}

export function decodeAiMetricsCursor(cursor: string): { endedAt: Date; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!at || !id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const endedAt = new Date(at);
  return Number.isNaN(endedAt.getTime()) ? null : { endedAt, id };
}

const ISO = (column: string): Prisma.Sql =>
  Prisma.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

/**
 * `GET /reports/ai-agent/conversations?metric=…`: the connections behind a
 * figure, newest end first, with their ids — the same predicate as the count.
 */
export async function listAiMetricConversations(
  tx: TenantClient,
  from: Date,
  to: Date,
  filter: AiMetricsFilter,
  metric: AiMetricsConversationList,
  page: { limit: number; cursor: { endedAt: Date; id: string } | null },
): Promise<{ conversations: AiMetricConversation[]; next_cursor: string | null }> {
  // Keyset on the end truncated to the millisecond: a JS Date carries no more.
  const after = page.cursor
    ? Prisma.sql`AND (date_trunc('milliseconds', o.ended_at), o.id)
                   < (${page.cursor.endedAt}::timestamptz, ${page.cursor.id}::uuid)`
    : Prisma.empty;
  const rows = await tx.$queryRaw<AiMetricConversation[]>`
    SELECT o.id::text AS id, o.thread_id, o.chat_id,
           ${ISO('o.started_at')} AS started_at, ${ISO('o.ended_at')} AS ended_at,
           o.outcome, o.intent, o.language, o.config_version_id::text AS config_version_id,
           o.team_id::text AS team_id, o.brand_id::text AS brand_id, o.ai_turns,
           o.ai_claimed_resolved, o.resolution_confirmation, o.handoff_reason,
           o.handoff_mandatory_rule, o.mandatory_handoff_violation,
           o.repeat_same_intent_72h, o.repeat_any_72h, o.qa_result,
           ${ISO('o.finalized_at')} AS finalized_at
      FROM ai_conversation_outcomes o
     WHERE ${windowSql(from, to)} AND ${filterSql(filter)} AND ${LIST_WHERE[metric]} ${after}
     ORDER BY date_trunc('milliseconds', o.ended_at) DESC, o.id DESC
     LIMIT ${page.limit + 1}`;
  const more = rows.length > page.limit;
  const conversations = more ? rows.slice(0, page.limit) : rows;
  const last = conversations.at(-1);
  return {
    conversations,
    next_cursor: more && last ? encodeAiMetricsCursor(last.ended_at, last.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Finalize (`ai_outcomes_finalize`)
// ---------------------------------------------------------------------------

interface DueRow {
  id: string;
  outcome: AiOutcome | null;
  qa_result: AiOutcomeQaResult | null;
  member_key: string | null;
  repeat_any: boolean | null;
  same_intent_id: string | null;
}

/**
 * Settle the current workspace's rows whose connection ended at least 72
 * hours before `now` and that are not settled yet, in the caller's
 * transaction; returns how many it settled and how many of them came back.
 *
 * The repeat search (AI-25-S3): **any** connection (thread) the same member
 * opened in the 72 hours after the end — a new one in the same day's chat
 * too — sets `repeat_any_72h`; the member's next AI connection about the same
 * topic within them sets `repeat_same_intent_72h` and `repeat_of_id`. With no
 * member both stay null.
 */
export async function finalizeAiOutcomes(
  tx: TenantClient,
  now: Date,
  limit: number = AI_OUTCOME_FINALIZE_BATCH,
): Promise<{ finalized: number; repeated: number; unmeasured: number }> {
  const cutoff = new Date(now.getTime() - AI_OUTCOME_FINALIZE_HOURS * HOUR_MS);
  const window = Prisma.sql`make_interval(hours => ${AI_OUTCOME_FINALIZE_HOURS}::int)`;
  const due = await tx.$queryRaw<DueRow[]>`
    SELECT o.id::text AS id, o.outcome, o.qa_result, o.member_key,
           CASE WHEN o.member_key IS NULL THEN NULL ELSE EXISTS (
             SELECT 1 FROM threads t JOIN chats c ON c.id = t.chat_id
              WHERE c.customer_id::text = o.member_key
                AND t.id <> o.thread_id
                AND t.created_at > o.ended_at AND t.created_at <= o.ended_at + ${window}
           ) END AS repeat_any,
           CASE WHEN o.member_key IS NULL OR o.intent IS NULL THEN NULL ELSE (
             SELECT r.id::text FROM ai_conversation_outcomes r
              WHERE r.member_key = o.member_key AND r.intent = o.intent AND r.id <> o.id
                AND r.started_at > o.ended_at AND r.started_at <= o.ended_at + ${window}
              ORDER BY r.started_at, r.id LIMIT 1
           ) END AS same_intent_id
      FROM ai_conversation_outcomes o
     WHERE o.finalized_at IS NULL AND o.ended_at IS NOT NULL AND o.ended_at <= ${cutoff}
     ORDER BY o.ended_at, o.id
     LIMIT ${limit}
     FOR UPDATE OF o SKIP LOCKED`;
  if (due.length === 0) return { finalized: 0, repeated: 0, unmeasured: 0 };

  const ids: string[] = [];
  const outcomes: (string | null)[] = [];
  const repeatAny: (boolean | null)[] = [];
  const repeatSame: (boolean | null)[] = [];
  const repeatOf: (string | null)[] = [];
  let repeated = 0;
  let unmeasured = 0;
  for (const row of due) {
    const measured = row.member_key !== null;
    const same = measured ? row.same_intent_id !== null : null;
    ids.push(row.id);
    outcomes.push(finalizedOutcome(row.outcome, same, row.qa_result));
    // A same-topic return is a return: the thread search can miss nothing it found.
    repeatAny.push(measured ? row.repeat_any === true || same === true : null);
    repeatSame.push(same);
    repeatOf.push(row.same_intent_id);
    if (same === true || row.repeat_any === true) repeated += 1;
    if (!measured) unmeasured += 1;
  }
  await tx.$executeRaw`
    UPDATE ai_conversation_outcomes o
       SET outcome = f.outcome,
           repeat_any_72h = f.repeat_any,
           repeat_same_intent_72h = f.repeat_same,
           repeat_of_id = f.repeat_of,
           finalized_at = ${now},
           updated_at = now()
      FROM unnest(${ids}::uuid[], ${outcomes}::text[], ${repeatAny}::boolean[],
                  ${repeatSame}::boolean[], ${repeatOf}::uuid[])
           AS f(id, outcome, repeat_any, repeat_same, repeat_of)
     WHERE o.id = f.id AND o.finalized_at IS NULL`;
  return { finalized: due.length, repeated, unmeasured };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export interface AiOutcomeFinalizeReport {
  startedAt: string;
  finishedAt: string;
  totals: { tenants: number; finalized: number; repeated: number; unmeasured: number };
}

/** The scheduler's `ai_outcomes_finalize`: every workspace, in its own transaction per batch. */
export class AiOutcomeFinalizer {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async run(options: { now?: Date; signal?: AbortSignal } = {}): Promise<AiOutcomeFinalizeReport> {
    const startedAt = new Date().toISOString();
    const now = options.now ?? new Date();
    const totals = { tenants: 0, finalized: 0, repeated: 0, unmeasured: 0 };
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      const context: TenantContext = {
        licenseId: tenant.license_id,
        organizationId: tenant.organization_id,
      };
      totals.tenants += 1;
      for (let batch = 0; batch < AI_OUTCOME_FINALIZE_BATCHES_MAX; batch += 1) {
        if (options.signal?.aborted) break;
        const result = await withTenant(this.#db, context, (tx) => finalizeAiOutcomes(tx, now), {
          timeoutMs: 60_000,
        });
        totals.finalized += result.finalized;
        totals.repeated += result.repeated;
        totals.unmeasured += result.unmeasured;
        if (result.finalized < AI_OUTCOME_FINALIZE_BATCH) break;
      }
    }
    return { startedAt, finishedAt: new Date().toISOString(), totals };
  }
}

// ---------------------------------------------------------------------------
// Rollup (`ai_metrics_rollup`)
// ---------------------------------------------------------------------------

/**
 * A rollup run re-reads the rows changed since its last run less this much:
 * a write that committed while the last run was reading is caught next time.
 */
const ROLLUP_OVERLAP = Prisma.sql`interval '1 hour'`;

/**
 * Rebuild the current workspace's `ai_metrics_daily` days that have a row
 * changed since the last rollup (every day, the first time), in the caller's
 * transaction. A day is the workspace's conversation day the connection ended
 * on (its own clock and day start, ID-04).
 */
export async function rollupAiMetrics(
  tx: TenantClient,
  licenseId: bigint,
): Promise<{ days: number; rows: number }> {
  const boundary = await readDayBoundary(tx);
  const day = Prisma.sql`((o.ended_at AT TIME ZONE ${boundary.timezone})
    - make_interval(hours => ${boundary.hour}::int))::date`;
  const [last] = await tx.$queryRaw<{ at: Date | null }[]>`
    SELECT max(computed_at) AS at FROM ai_metrics_daily`;
  const since = last?.at
    ? Prisma.sql`AND o.updated_at >= ${last.at}::timestamptz - ${ROLLUP_OVERLAP}`
    : Prisma.empty;
  const days = await tx.$queryRaw<{ day: Date }[]>`
    SELECT DISTINCT ${day} AS day FROM ai_conversation_outcomes o
     WHERE o.ended_at IS NOT NULL ${since}`;
  if (days.length === 0) return { days: 0, rows: 0 };
  const keys = days.map((row) => row.day.toISOString().slice(0, 10));
  await tx.$executeRaw`DELETE FROM ai_metrics_daily WHERE day = ANY(${keys}::date[])`;
  const columns = Prisma.join(
    AI_METRIC_COUNT_KEYS.map((key) => Prisma.raw(key)),
    ', ',
  );
  const rows = await tx.$executeRaw`
    INSERT INTO ai_metrics_daily (
      license_id, day, brand_id, team_id, intent, config_version_id, language, ${columns})
    SELECT ${licenseId}, ${day}, o.brand_id, o.team_id, o.intent, o.config_version_id, o.language,
           ${countsSelect()}
      FROM ai_conversation_outcomes o
     WHERE o.ended_at IS NOT NULL AND ${day} = ANY(${keys}::date[])
     GROUP BY 2, 3, 4, 5, 6, 7`;
  return { days: days.length, rows };
}

/** The rollup's counts summed over its days `[fromDay, toDay]` (`YYYY-MM-DD`). */
export async function readAiMetricsRollup(
  tx: TenantClient,
  fromDay: string,
  toDay: string,
): Promise<AiMetricCounts> {
  const sums = Prisma.join(
    AI_METRIC_COUNT_KEYS.map(
      (key) => Prisma.sql`coalesce(sum(${Prisma.raw(key)}), 0)::int AS ${Prisma.raw(key)}`,
    ),
    ', ',
  );
  const rows = await tx.$queryRaw<Record<string, unknown>[]>`
    SELECT ${sums} FROM ai_metrics_daily
     WHERE day >= ${fromDay}::date AND day <= ${toDay}::date`;
  return countsOf(rows[0]);
}

export interface AiMetricsRollupReport {
  startedAt: string;
  finishedAt: string;
  totals: { tenants: number; days: number; rows: number };
}

/** The scheduler's `ai_metrics_rollup`: every workspace, one transaction each. */
export class AiMetricsRollup {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async run(options: { signal?: AbortSignal } = {}): Promise<AiMetricsRollupReport> {
    const startedAt = new Date().toISOString();
    const totals = { tenants: 0, days: 0, rows: 0 };
    const tenants = await this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
    for (const tenant of tenants) {
      if (options.signal?.aborted) break;
      const context: TenantContext = {
        licenseId: tenant.license_id,
        organizationId: tenant.organization_id,
      };
      const result = await withTenant(
        this.#db,
        context,
        (tx) => rollupAiMetrics(tx, tenant.license_id),
        { timeoutMs: 60_000 },
      );
      totals.tenants += 1;
      totals.days += result.days;
      totals.rows += result.rows;
    }
    return { startedAt, finishedAt: new Date().toISOString(), totals };
  }
}
