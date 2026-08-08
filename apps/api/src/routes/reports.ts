/**
 * Reports and billing.
 *
 * The "Automated" figure here and the AI-resolution counter on the invoice come
 * from the same query (ADR-09). Two independent counters would drift, and the
 * first anyone would notice is a customer disputing a bill.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasAnyScope, isWorkScheduleProblem, normalizeWorkSchedule } from '@nexa/types';
import {
  clusterTopics,
  embed,
  similarity,
  TOPIC_MIN_CONVERSATIONS,
  TOPIC_SIMILARITY_THRESHOLD,
  type TopicDoc,
} from '@nexa/ai-mock';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import {
  BENCHMARK_BASELINES,
  benchmarkWindow,
  channelLabel,
  DEFAULT_BENCHMARK_BASELINE,
  resolutionRate,
  round,
  type BenchmarkBaseline,
} from './reports-metrics.js';
import {
  EXPORT_SCOPES,
  exportFilename,
  reportGroup,
  toCsv,
  toPdf,
  visibleReportGroups,
  type CsvCell,
} from './reports-export.js';
import { scopesOf } from '../services/auth/principal.js';
import {
  presenceCoverage,
  type PresenceEvent,
} from '../services/staffing/presence-coverage.js';
import { rosterCoverage, type RosterPlan } from '../services/staffing/roster-coverage.js';
import {
  DEFAULT_MINIMUM_SAMPLE_CHATS,
  staffingForecast,
  type CoverageCell,
  type VolumeCell,
} from '../services/staffing/staffing-forecast.js';
import type { Env } from '../config/env.js';
import type { TenantClient, TenantContext } from '../lib/tenant.js';
import { currentPeriod, trialState, usageSummary } from '../services/billing/metering.js';
import {
  BILLING_CYCLES,
  priceSeats,
  updateSubscription,
  type BillingCycle,
} from '../services/billing/subscription-service.js';
import {
  buildInvoices,
  invoiceCsvRows,
  invoiceFilename,
} from '../services/billing/invoice-service.js';
import {
  PAYMENT_BRANDS,
  getPaymentMethod,
  upsertPaymentMethod,
} from '../services/billing/payment-method-service.js';

const BILLING_WRITE_SCOPES = ['billing_manage', 'billing_admin'];

/** Who may read billing: either billing scope, or the plain reports reader. */
const BILLING_READ_SCOPES = ['billing_manage', 'billing_admin', 'reports_read'];

const paymentMethodBody = z.object({
  brand: z.enum(PAYMENT_BRANDS),
  // Last four only — a full card number is out of scope (PRD §11.1/1) and has no
  // field to land in.
  last4: z.string().regex(/^\d{4}$/, 'must be four digits'),
  exp_month: z.number().int().min(1).max(12),
  exp_year: z.number().int().min(2000).max(2100),
  holder_name: z.string().trim().min(1).max(120),
});

const updateSubscriptionBody = z
  .object({
    plan: z.string().min(1).max(64).optional(),
    billing_cycle: z.enum(BILLING_CYCLES).optional(),
    seats: z.number().int().min(1).max(100_000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'at least one field is required');

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /**
   * Which of *this license's* own past windows the report is benchmarked
   * against (FR-MOD-07.7, 07.7-e). A closed enum, not a free string: the two
   * values are the only baselines that stay inside the tenant boundary, and a
   * name like `industry` has to fail rather than fall back to a default that
   * would make it look supported. See `reports-metrics.ts` for why a
   * cross-license baseline is refused rather than unimplemented.
   */
  baseline: z.enum(BENCHMARK_BASELINES).optional(),
});

/**
 * An export request: which report group, in which format, over which window
 * (defaults to 30d). `format` defaults to `csv` — the only format v1 shipped —
 * so a caller who never learned about `?format=pdf` keeps getting exactly what
 * they always got.
 */
const exportQuery = rangeQuery.extend({
  group: z.string().min(1).max(64),
  format: z.enum(['csv', 'pdf']).default('csv'),
});

const DAY_MS = 86_400_000;

/**
 * Default window: the last 30 days, the span every dashboard opens on. Exported
 * so the `get_report` MCP tool (08.8.3-e) resolves a range the exact same way —
 * same 30-day default, same `from > to` rejection — as every REST report route.
 */
export function resolveRange(query: z.infer<typeof rangeQuery>): { from: Date; to: Date } {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * DAY_MS);
  if (from > to) throw ApiError.validation('`from` must be before `to`.');
  return { from, to };
}

/**
 * The widest window a report group will aggregate over (NFR-P7).
 *
 * NFR-P7 answers "heavy reports" with a read replica or a column-store analytics
 * warehouse (PRD:748). Neither exists here and neither can — they are
 * infrastructure this repo is explicitly out of scope for (PLAN §9) — so what is
 * left is to bound the work a single request can ask for. Without a cap the
 * window is whatever a caller typed: `from=1970-01-01` makes every group's
 * aggregation a full-history scan of `threads`/`tickets`/`events`, on an endpoint
 * any `reports_read` token can call as often as its rate-limit bucket allows.
 *
 * A range cap rather than a second rate-limit bucket, deliberately. A limit on
 * requests-per-minute bounds how *often* an expensive query runs, not how
 * expensive it is — one unbounded scan still ties up a connection for as long as
 * it takes — and its behaviour depends on Redis state, so it is neither
 * deterministic nor honestly testable. The cap bounds the query itself, refuses
 * in the request the caller can fix, and is the same shape the staffing forecast
 * already uses ({@link STAFFING_MAX_RANGE_DAYS}).
 *
 * 366 days, not 365: a "last twelve months" window that spans a leap day is a
 * real request, and it must not be the one that fails. Past a year the honest
 * answer is "narrow the range", not a slow request — the same reasoning, and the
 * same number, the forecast settled on.
 */
export const REPORT_MAX_RANGE_DAYS = 366;

/**
 * A window a report group can be aggregated over, or a 400 explaining why not.
 *
 * Applied to the JSON group endpoints ({@link resolveReportQuery}) *and* the
 * export route, because both run the same aggregations: capping only the
 * download would leave the identical scan one query string away on
 * `/reports/<group>`, which is a guard in name only.
 */
function assertReportRange(from: Date, to: Date): void {
  if (to.getTime() - from.getTime() > REPORT_MAX_RANGE_DAYS * DAY_MS) {
    throw ApiError.validation(
      `A report covers at most ${REPORT_MAX_RANGE_DAYS} days; narrow \`from\`/\`to\`.`,
    );
  }
}

/**
 * The window and the benchmark baseline a report request asks for — the one
 * place every `GET /reports/*` route parses its query, so the eight groups can
 * never diverge on what a bad `from` or an unknown `baseline` does.
 *
 * `requested` is the baseline the caller actually named, `undefined` when they
 * named none. Kept separate from the resolved `baseline` so a surface whose
 * shape is positional — the CSV export — can stay byte-identical for callers
 * that never asked for a benchmark, while the JSON reports carry the default
 * comparison for everyone.
 */
function resolveReportQuery(query: unknown): {
  from: Date;
  to: Date;
  baseline: BenchmarkBaseline;
  requested: BenchmarkBaseline | undefined;
} {
  const parsed = rangeQuery.safeParse(query);
  if (!parsed.success) {
    // Name the parameter that was wrong: `baseline=industry` is a different
    // mistake from a malformed date, and "Invalid date range." would send the
    // caller looking in the wrong place — the more so here, where the rejected
    // value may be one someone expected to work (§V1).
    if (parsed.error.issues.some((issue) => issue.path[0] === 'baseline')) {
      throw ApiError.validation(`\`baseline\` must be one of: ${BENCHMARK_BASELINES.join(', ')}.`);
    }
    throw ApiError.validation('Invalid date range.');
  }
  const { from, to } = resolveRange(parsed.data);
  assertReportRange(from, to);
  return {
    from,
    to,
    baseline: parsed.data.baseline ?? DEFAULT_BENCHMARK_BASELINE,
    requested: parsed.data.baseline,
  };
}

/**
 * Attaches a report's benchmark block — the same window arithmetic and the same
 * `previous_period` key for every group, so no report grows its own dialect of
 * "vs before" (the Overview and the Reviews report had each hand-rolled the
 * three lines this replaces).
 *
 * `figures` measures the baseline window and returns whatever that group
 * compares — headline counts, a CSAT tally, nothing at all. It is handed the
 * window rather than computing one, so a group cannot accidentally benchmark
 * against a different span than its neighbours. Every measurement it can make
 * runs through the same license-scoped helpers as the report itself, which is
 * what keeps a benchmark from ever quoting another license's number.
 */
async function withBenchmark(
  body: Record<string, unknown>,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline,
  figures: (window: { from: Date; to: Date }) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const window = benchmarkWindow(from, to, baseline);
  const measured = await figures(window);
  return {
    ...body,
    previous_period: {
      // Which comparison produced these figures. Sent because the same key
      // carries two different windows depending on the request, and a client
      // rendering "vs previous" must not have to guess which one it got.
      baseline,
      range: { from: window.from.toISOString(), to: window.to.toISOString() },
      ...measured,
    },
  };
}

// ===========================================================================
// Shared aggregation
//
// The resolution split is defined exactly once, as two SQL fragments, so the
// Overview, the Breakdown and the AI Agent report classify a case identically
// and can never drift — the same reason ADR-09 keeps a single automated query.
// ===========================================================================

/** A human wrote in the thread — ADR-09's line between automated and handled. */
const AGENT_EVENT = Prisma.sql`EXISTS (
  SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent'
)`;

/** A skill ran on the chat — what turns a handled case from manual to assisted. */
const SKILL_RUN = Prisma.sql`EXISTS (
  SELECT 1 FROM skill_runs sr WHERE sr.chat_id = t.chat_id AND sr.license_id = t.license_id
)`;

/**
 * The three-way split as `chats / closed / automated / assisted / manual`, for a
 * `GROUP BY` dimension (day, agent). The predicates are mutually exclusive and
 * cover all of closed, so manual + assisted + automated === closed in every row.
 */
const SPLIT_COUNTS = Prisma.sql`
  count(*)                             AS chats,
  count(*) FILTER (WHERE NOT t.active) AS closed,
  count(*) FILTER (WHERE NOT t.active AND NOT ${AGENT_EVENT})                  AS automated,
  count(*) FILTER (WHERE NOT t.active AND ${AGENT_EVENT} AND ${SKILL_RUN})     AS assisted,
  count(*) FILTER (WHERE NOT t.active AND ${AGENT_EVENT} AND NOT ${SKILL_RUN}) AS manual
`;

interface WindowRow {
  total_chats: bigint;
  closed_chats: bigint;
  automated: bigint;
  assisted: bigint;
  manual: bigint;
  avg_first_response_seconds: number | null;
  avg_duration_seconds: number | null;
  avg_automated_duration_seconds: number | null;
  total_duration_seconds: number | null;
}

const ZERO_WINDOW: WindowRow = {
  total_chats: 0n,
  closed_chats: 0n,
  automated: 0n,
  assisted: 0n,
  manual: 0n,
  avg_first_response_seconds: null,
  avg_duration_seconds: null,
  avg_automated_duration_seconds: null,
  total_duration_seconds: 0,
};

/**
 * Headline counts and durations for one window. Called for the requested range
 * and, again, for the equal-length window before it that the deltas compare
 * against — one query, so the two are computed the same way.
 */
async function windowTotals(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<WindowRow> {
  const [row] = await tx.$queryRaw<WindowRow[]>`
    SELECT
      count(*)                             AS total_chats,
      count(*) FILTER (WHERE NOT t.active) AS closed_chats,
      count(*) FILTER (WHERE NOT t.active AND NOT ${AGENT_EVENT})                  AS automated,
      count(*) FILTER (WHERE NOT t.active AND ${AGENT_EVENT} AND ${SKILL_RUN})     AS assisted,
      count(*) FILTER (WHERE NOT t.active AND ${AGENT_EVENT} AND NOT ${SKILL_RUN}) AS manual,
      avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)))
        FILTER (WHERE t.first_response_at IS NOT NULL)   AS avg_first_response_seconds,
      avg(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)))
        FILTER (WHERE t.closed_at IS NOT NULL)           AS avg_duration_seconds,
      avg(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)))
        FILTER (WHERE NOT t.active AND NOT ${AGENT_EVENT} AND t.closed_at IS NOT NULL)
                                                         AS avg_automated_duration_seconds,
      coalesce(sum(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)))
        FILTER (WHERE t.closed_at IS NOT NULL), 0)       AS total_duration_seconds
    FROM threads t
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
  `;
  return row ?? ZERO_WINDOW;
}

/** Tickets created in a window (PRD §3.3 counts these toward "total cases"). */
function ticketCount(tx: TenantClient, licenseId: bigint, from: Date, to: Date): Promise<number> {
  return tx.ticket.count({ where: { licenseId, createdAt: { gte: from, lte: to } } });
}

interface CaseDaySplit {
  date: string;
  open: number;
  closed: number;
  total: number;
}

/**
 * Tickets created per UTC day (FR-MOD-07.7 Cases, v2 payload), split into
 * `open` vs `closed` by *current* status — `solved`/`closed` count as closed
 * (the same terminal pair the 'solved' {@link TicketView} filters to in
 * ticket-service.ts), `open`/`pending`/`spam` as open. There is no per-day
 * status history to bucket against instead, the same non-historical
 * convention {@link breakdownByDay}'s `closed` count follows. `AT TIME ZONE
 * 'UTC'` pins the bucket boundary regardless of server timezone, same as the
 * other by-day reports. A merged ticket (`merged_into_id` set) is excluded so
 * a merge never double-counts toward both the primary and the ticket merged
 * into it (open question in PLAN §5.2.4, resolved this way for 07.7-a).
 */
async function casesByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<CaseDaySplit[]> {
  const rows = await tx.$queryRaw<
    Array<{ date: string; open: bigint; closed: bigint; total: bigint }>
  >`
    SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
      count(*) FILTER (WHERE status NOT IN ('solved', 'closed')) AS open,
      count(*) FILTER (WHERE status IN ('solved', 'closed'))     AS closed,
      count(*)                                                   AS total
    FROM tickets
    WHERE license_id = ${licenseId}
      AND created_at >= ${from} AND created_at <= ${to}
      AND merged_into_id IS NULL
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({
    date: row.date,
    open: Number(row.open),
    closed: Number(row.closed),
    total: Number(row.total),
  }));
}

/**
 * Tickets created in a window (FR-MOD-07.7 Cases), grouped by current status.
 * Same `merged_into_id IS NULL` exclusion as {@link casesByDay}.
 */
async function casesByStatus(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<Array<{ status: string; count: number }>> {
  const rows = await tx.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT status, count(*) AS count
    FROM tickets
    WHERE license_id = ${licenseId}
      AND created_at >= ${from} AND created_at <= ${to}
      AND merged_into_id IS NULL
    GROUP BY status
    ORDER BY status
  `;
  return rows.map((row) => ({ status: row.status, count: Number(row.count) }));
}

/**
 * Tickets created in a window (FR-MOD-07.7 Cases), grouped by their stored
 * queue priority (FR-MOD-13.6) — the raw signed integer the column holds, not
 * the four named levels the Inbox pane snaps to for display
 * (`ticket-priority.ts`, web-only): the report exposes what is actually
 * stored, highest first. Same `merged_into_id IS NULL` exclusion as
 * {@link casesByDay}.
 */
async function casesByPriority(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<Array<{ priority: number; count: number }>> {
  const rows = await tx.$queryRaw<Array<{ priority: number; count: bigint }>>`
    SELECT priority, count(*) AS count
    FROM tickets
    WHERE license_id = ${licenseId}
      AND created_at >= ${from} AND created_at <= ${to}
      AND merged_into_id IS NULL
    GROUP BY priority
    ORDER BY priority DESC
  `;
  return rows.map((row) => ({ priority: row.priority, count: Number(row.count) }));
}

interface LeadDayCount {
  date: string;
  count: number;
}

/**
 * The lead → license binding, as a CTE body shared by {@link leadsByDay} and
 * {@link leadTotals} so the two can never disagree on which leads belong to
 * this license.
 *
 * ISOLATION (why this is the isolation-sensitive core, NFR-S4): a lead is a
 * `customers` row with `is_lead` set, and `customers` is *organization*-scoped
 * — it has no `license_id` column, and RLS narrows it by
 * `app.current_organization` (lib/tenant.ts). One organization may hold several
 * licenses (`Organization.licenses`), so every lead in the org is visible under
 * *every* one of its licenses. Counting `customers.is_lead` directly would
 * therefore report a sibling license's leads as this license's — an
 * access-control leak, and the wrong side of a boundary that is expensive to
 * get wrong.
 *
 * The boundary this report commits to instead: a lead belongs to this license
 * only when it has actually *touched* the license, through a chat or a ticket
 * (both license-scoped). The touch tables are joined on
 * `license_id = ${licenseId}` explicitly — defence in depth on top of RLS,
 * exactly as {@link breakdownByChannel} and {@link breakdownByTeam} lock their
 * soft joins: were RLS ever weakened, an unqualified join would let another
 * license's chat/ticket for the same organization customer pull a sibling lead
 * in. `first_touch` is the earliest such touch, so a lead is attributed to the
 * day it first reached this license (see {@link leadsByDay}); the
 * organization-wide creation date — a fact this license does not own — never
 * decides the bucket.
 */
function leadFirstTouch(licenseId: bigint) {
  return Prisma.sql`
    lead_first_touch AS (
      SELECT c.id AS customer_id, min(touch.touched_at) AS first_touch
      FROM customers c
      JOIN (
        SELECT customer_id, created_at AS touched_at
          FROM chats  WHERE license_id = ${licenseId}
        UNION ALL
        SELECT customer_id, created_at AS touched_at
          FROM tickets WHERE license_id = ${licenseId} AND customer_id IS NOT NULL
      ) touch ON touch.customer_id = c.id
      WHERE c.is_lead = TRUE
      GROUP BY c.id
    )`;
}

/**
 * New leads per UTC day (FR-MOD-07.7 Leads, v2 payload): a lead counted once, on
 * the day of its first touch on this license (see {@link leadFirstTouch}), for
 * days inside the window. `AT TIME ZONE 'UTC'` pins the bucket boundary
 * regardless of server timezone, like every other by-day report. A lead first
 * seen before the window does not reappear inside it, so this is a true
 * "new leads acquired" series whose counts sum to {@link leadTotals}.
 */
async function leadsByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<LeadDayCount[]> {
  const rows = await tx.$queryRaw<Array<{ date: string; count: bigint }>>`
    WITH ${leadFirstTouch(licenseId)}
    SELECT to_char((first_touch AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
      count(*) AS count
    FROM lead_first_touch
    WHERE first_touch >= ${from} AND first_touch <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
}

/**
 * The window's distinct new leads (FR-MOD-07.7 Leads) — the same first-touch
 * definition as {@link leadsByDay}, so `leads` equals the sum of that series by
 * construction. An empty window returns 0, never null.
 */
async function leadTotals(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<{ leads: number }> {
  const [row] = await tx.$queryRaw<Array<{ leads: bigint }>>`
    WITH ${leadFirstTouch(licenseId)}
    SELECT count(*) AS leads
    FROM lead_first_touch
    WHERE first_touch >= ${from} AND first_touch <= ${to}
  `;
  return { leads: Number(row?.leads ?? 0n) };
}

/** Good/bad rating tallies for a window. */
async function satisfactionCounts(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<{ good: number; bad: number }> {
  const [row] = await tx.$queryRaw<Array<{ good: bigint; bad: bigint }>>`
    SELECT
      count(*) FILTER (WHERE value = 'good') AS good,
      count(*) FILTER (WHERE value = 'bad')  AS bad
    FROM ratings
    WHERE license_id = ${licenseId}
      AND created_at >= ${from} AND created_at <= ${to}
  `;
  return { good: Number(row?.good ?? 0n), bad: Number(row?.bad ?? 0n) };
}

/**
 * Satisfaction as a fraction of ratings, or null when nobody rated. Null (not
 * 0%) because an unrated window is unknown, not a failure — the same rule
 * `resolutionRate` follows for an empty window.
 */
function satisfactionScore(counts: { good: number; bad: number }): number | null {
  const rated = counts.good + counts.bad;
  return rated === 0 ? null : round(counts.good / rated);
}

interface CsatSummary {
  good: number;
  bad: number;
  responses: number;
  score: number | null;
}

/**
 * The full CSAT tally the Reviews report exposes for one span: the donut's
 * good/bad counts, their total, and the score (null when unrated). Built once so
 * the window, the previous window and every daily bucket describe CSAT the same
 * way — the same reason the resolution split lives in a single SQL fragment.
 */
function csatSummary(counts: { good: number; bad: number }): CsatSummary {
  return {
    good: counts.good,
    bad: counts.bad,
    responses: counts.good + counts.bad,
    score: satisfactionScore(counts),
  };
}

/**
 * Ratings tallied per UTC day for the daily bar (FR-MOD-07.8). `AT TIME ZONE
 * 'UTC'` pins the bucket boundary regardless of server timezone, exactly as the
 * breakdown's by-day split does, so a rating never lands on the wrong day. Only
 * days with a rating appear; an empty window yields an empty series.
 */
async function satisfactionByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<Array<{ date: string; good: number; bad: number }>> {
  const rows = await tx.$queryRaw<Array<{ date: string; good: bigint; bad: bigint }>>`
    SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
      count(*) FILTER (WHERE value = 'good') AS good,
      count(*) FILTER (WHERE value = 'bad')  AS bad
    FROM ratings
    WHERE license_id = ${licenseId}
      AND created_at >= ${from} AND created_at <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({ date: row.date, good: Number(row.good), bad: Number(row.bad) }));
}

interface DaySplit {
  date: string;
  chats: number;
  closed: number;
  automated: number;
  assisted: number;
  manual: number;
}

/**
 * The resolution split (manual / assisted / automated) per UTC day. Feeds both
 * the Breakdown tab's time series and the CSV export's `breakdown` group, so the
 * two can never quote a different split for the same day — the same reason the
 * split itself lives in one SQL fragment. `AT TIME ZONE 'UTC'` pins the bucket
 * boundary regardless of server timezone.
 */
async function breakdownByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<DaySplit[]> {
  const rows = await tx.$queryRaw<
    Array<{
      date: string;
      chats: bigint;
      closed: bigint;
      automated: bigint;
      assisted: bigint;
      manual: bigint;
    }>
  >`
    SELECT to_char((t.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date,
      ${SPLIT_COUNTS}
    FROM threads t
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({
    date: row.date,
    chats: Number(row.chats),
    closed: Number(row.closed),
    automated: Number(row.automated),
    assisted: Number(row.assisted),
    manual: Number(row.manual),
  }));
}

interface HourSplit {
  hour: number;
  chats: number;
  closed: number;
  automated: number;
  assisted: number;
  manual: number;
}

/**
 * The resolution split (manual / assisted / automated) per UTC hour of day,
 * for the Breakdown tab's hour dimension (FR-MOD-07.5). Reuses the same
 * `SPLIT_COUNTS` fragment as {@link breakdownByDay} — the only difference is
 * the `GROUP BY` expression — so the two dimensions can never disagree on
 * what counts as automated/assisted/manual. Dense: hours 0-23 are always
 * present, zero-filled where nothing happened, because the axis (a day's 24
 * hours) is fixed regardless of the data — unlike `by_day`, whose axis grows
 * with the range.
 */
async function breakdownByHour(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<HourSplit[]> {
  const rows = await tx.$queryRaw<
    Array<{
      hour: number;
      chats: bigint;
      closed: bigint;
      automated: bigint;
      assisted: bigint;
      manual: bigint;
    }>
  >`
    SELECT EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'UTC')::int AS hour,
      ${SPLIT_COUNTS}
    FROM threads t
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY 1
    ORDER BY 1
  `;
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => {
    const row = byHour.get(hour);
    return {
      hour,
      chats: Number(row?.chats ?? 0n),
      closed: Number(row?.closed ?? 0n),
      automated: Number(row?.automated ?? 0n),
      assisted: Number(row?.assisted ?? 0n),
      manual: Number(row?.manual ?? 0n),
    };
  });
}

interface ChannelSplit {
  channel: string;
  chats: number;
  closed: number;
  automated: number;
  assisted: number;
  manual: number;
}

/**
 * The resolution split (manual / assisted / automated) per channel
 * (FR-MOD-07.5). A chat's channel is the `channel_type` of its *oldest inbound*
 * `channel_messages` row; a chat with no inbound adapter message — the native
 * web widget writes none — falls back to `'website'` through {@link channelLabel},
 * the one mapping the CSV export and the UI also consume, so the fallback bucket
 * cannot drift between surfaces.
 *
 * ISOLATION (why this is the isolation-sensitive core, NFR-S4): `chat_id` on
 * `channel_messages` is a *soft* reference — no FK — and chat ids are only
 * unique within a license, so the soft-FK join is locked on BOTH
 * `cm.license_id = t.license_id` AND `cm.chat_id = t.chat_id`. RLS already
 * narrows `channel_messages` to the current license, but the explicit license
 * predicate is defence in depth: a join on `chat_id` alone would, the moment RLS
 * were ever weakened, let another tenant's row that happens to carry the same
 * chat id reclassify this chat's channel. The lock is written out rather than
 * trusted to RLS so the isolation argument is visible in the query itself.
 *
 * Reuses the same `SPLIT_COUNTS` fragment as {@link breakdownByDay}, so the
 * channel split can never disagree with Overview or the invoice (ADR-09). The
 * per-chat channel is derived from `t.chat_id`, so every thread on a chat shares
 * its channel and the counts stay thread-based like the other dimensions. Sparse
 * (only channels present in the window appear), unlike the fixed 24-hour axis;
 * because every thread maps to exactly one label, `SUM(by_channel.chats)` equals
 * the window's total chats.
 */
async function breakdownByChannel(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<ChannelSplit[]> {
  const rows = await tx.$queryRaw<
    Array<{
      channel_type: string | null;
      chats: bigint;
      closed: bigint;
      automated: bigint;
      assisted: bigint;
      manual: bigint;
    }>
  >`
    SELECT first_inbound.channel_type AS channel_type,
      ${SPLIT_COUNTS}
    FROM threads t
    LEFT JOIN LATERAL (
      SELECT cm.channel_type
      FROM channel_messages cm
      WHERE cm.license_id = t.license_id
        AND cm.chat_id = t.chat_id
        AND cm.direction = 'inbound'
      ORDER BY cm.created_at, cm.id
      LIMIT 1
    ) first_inbound ON TRUE
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY first_inbound.channel_type
  `;

  // Fold the raw `channel_type` groups into their display labels: NULL (no
  // inbound message) and any non-adapter value collapse to 'website', so a chat
  // lands in exactly one bucket and the counts stay a true partition of the
  // window's chats.
  const byLabel = new Map<string, ChannelSplit>();
  for (const row of rows) {
    const channel = channelLabel(row.channel_type);
    const acc = byLabel.get(channel) ?? {
      channel,
      chats: 0,
      closed: 0,
      automated: 0,
      assisted: 0,
      manual: 0,
    };
    acc.chats += Number(row.chats);
    acc.closed += Number(row.closed);
    acc.automated += Number(row.automated);
    acc.assisted += Number(row.assisted);
    acc.manual += Number(row.manual);
    byLabel.set(channel, acc);
  }
  // Busiest channel first, ties broken by name — a deterministic order.
  return Array.from(byLabel.values()).sort(
    (a, b) => b.chats - a.chats || a.channel.localeCompare(b.channel),
  );
}

interface TeamSplit {
  team_id: number | null;
  name: string | null;
  chats: number;
  closed: number;
  automated: number;
  assisted: number;
  manual: number;
}

/**
 * The resolution split (manual / assisted / automated) per team, for the
 * Breakdown tab's team dimension (FR-MOD-07.5). A chat's teams are the groups it
 * has been shared with through `chat_access`; a chat shared with no group falls
 * into a single `team_id: null` bucket ('Unassigned' on the UI) so that no chat
 * is dropped from the dimension.
 *
 * FAN-OUT (why the split declares `overlapping`): `chat_access` is M:N — a chat is
 * written one row per group it is opened to (chat-service's `createMany`) — and
 * the schema holds no notion of a chat's *primary* team. A chat reachable by two
 * teams is therefore counted once under each rather than silently attributed to
 * one, so `SUM(by_team.chats)` can exceed the window's total chats. `overlapping`
 * says so plainly: true when any chat in the window is shared with more than one
 * team. Collapsing the fan-out onto a single team would be inventing an ownership
 * the data does not record.
 *
 * ISOLATION (why this is the isolation-sensitive core, NFR-S4): `chat_access` has
 * no `license_id` column of its own (PRD §8.4 — its RLS runs through an EXISTS on
 * `chats`), and `groups` has a *composite* key `(license_id, id)`, so the same
 * autoincrement `group_id` can exist in more than one license. The join is locked
 * on the license twice over, defence in depth rather than trusting RLS alone:
 * `chat_access` is reached only through `chats c` bound on `c.license_id =
 * t.license_id`, and `groups g` is joined on `g.license_id = c.license_id AND
 * g.id = ca.group_id`. Drop the group's license predicate and another tenant's
 * team carrying the same `group_id` would surface in — and double-count — this
 * license's rows.
 *
 * Reuses the same `SPLIT_COUNTS` fragment as {@link breakdownByDay}, so the team
 * split can never disagree with Overview or the invoice (ADR-09); the invariant
 * `manual + assisted + automated === closed` holds inside every row, fan-out and
 * all. Counts are thread-based like every other dimension.
 */
async function breakdownByTeam(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<{ teams: TeamSplit[]; overlapping: boolean }> {
  const rows = await tx.$queryRaw<
    Array<{
      team_id: bigint | null;
      name: string | null;
      chats: bigint;
      closed: bigint;
      automated: bigint;
      assisted: bigint;
      manual: bigint;
    }>
  >`
    SELECT ca.group_id AS team_id, g.name AS name,
      ${SPLIT_COUNTS}
    FROM threads t
    JOIN chats c ON c.id = t.chat_id AND c.license_id = t.license_id
    LEFT JOIN chat_access ca ON ca.chat_id = c.id
    LEFT JOIN groups g ON g.license_id = c.license_id AND g.id = ca.group_id
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY ca.group_id, g.name
    ORDER BY chats DESC, name ASC NULLS LAST
  `;

  // Does any chat in the window reach more than one team? If so the rows above
  // double-count it and `SUM(by_team.chats)` overshoots the window total — the
  // fan-out `overlapping` warns the client about. Same license locks as the
  // aggregation, so a foreign tenant's access rows can never flip the flag.
  const [flag] = await tx.$queryRaw<Array<{ overlapping: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM threads t
      JOIN chats c ON c.id = t.chat_id AND c.license_id = t.license_id
      JOIN chat_access ca ON ca.chat_id = c.id
      WHERE t.license_id = ${licenseId}
        AND t.created_at >= ${from} AND t.created_at <= ${to}
      GROUP BY t.id
      HAVING count(*) > 1
    ) AS overlapping
  `;

  return {
    teams: rows.map((row) => ({
      team_id: row.team_id === null ? null : Number(row.team_id),
      name: row.name,
      chats: Number(row.chats),
      closed: Number(row.closed),
      automated: Number(row.automated),
      assisted: Number(row.assisted),
      manual: Number(row.manual),
    })),
    overlapping: flag?.overlapping ?? false,
  };
}

/**
 * AI→human hand-offs in a window — the `chat_transferred` system event. Feeds
 * both the AI Agent report and its CSV export. Containment (`@>`) rather than
 * `->>` so the jsonb GIN index can serve it.
 */
async function transferCount(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ transfers: bigint }>>`
    SELECT count(*) AS transfers
    FROM events e
    WHERE e.license_id = ${licenseId}
      AND e.properties @> '{"system_event": "chat_transferred"}'::jsonb
      AND e.created_at >= ${from} AND e.created_at <= ${to}
  `;
  return Number(row?.transfers ?? 0n);
}

interface AgentPerformanceRow {
  agent_id: string;
  name: string | null;
  chats: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
  avg_first_response_seconds: number | null;
  avg_duration_seconds: number | null;
  csat: CsatSummary;
  transfers: number;
}

/**
 * Per-agent KPIs for one window (FR-MOD-07.7 Team performance, v2 payload):
 * the same chat-split-by-agent query {@link buildBreakdownReport} uses
 * (`SPLIT_COUNTS`, most chats first, `LIMIT 20`), extended per row with
 * average first-response/duration, CSAT and transfer hand-offs. Shared by
 * `GET /reports/team-performance` and its CSV export, so the two can never
 * quote different figures for the same license and range.
 *
 * CSAT and transfers are windowed by their own timestamp (a rating's or a
 * transfer event's `created_at`), exactly as {@link satisfactionCounts} and
 * {@link transferCount} window the license-wide totals — not by the thread's
 * creation date. Which agents appear, their order and the `LIMIT 20` all come
 * from the chat-split query alone: an agent needs at least one thread
 * *created* in the window to appear here, even if a rating or transfer landed
 * inside the window on an older thread of theirs. This is the existing
 * by-agent breakdown with more fields, not a new agent-visibility rule.
 */
async function teamPerformanceByAgent(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<AgentPerformanceRow[]> {
  const rows = await tx.$queryRaw<
    Array<{
      agent_id: string;
      name: string | null;
      chats: bigint;
      closed: bigint;
      automated: bigint;
      assisted: bigint;
      manual: bigint;
      avg_first_response_seconds: number | null;
      avg_duration_seconds: number | null;
    }>
  >`
    SELECT t.assignee_id::text AS agent_id, a.name,
      ${SPLIT_COUNTS},
      avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)))
        FILTER (WHERE t.first_response_at IS NOT NULL)   AS avg_first_response_seconds,
      avg(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)))
        FILTER (WHERE t.closed_at IS NOT NULL)            AS avg_duration_seconds
    FROM threads t
    LEFT JOIN accounts a ON a.id = t.assignee_id
    WHERE t.license_id = ${licenseId}
      AND t.assignee_id IS NOT NULL
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY t.assignee_id, a.name
    ORDER BY chats DESC
    LIMIT 20
  `;

  // Good/bad tallies per agent, windowed by the rating's own `created_at` —
  // same convention as `satisfactionCounts`. `ratings.thread_id` is a soft
  // column (no FK), so the join reaches into `threads`, a table RLS already
  // scopes to this license — the same defence-in-depth every other soft join
  // here (breakdownByChannel, breakdownByTeam) locks explicitly.
  const ratingRows = await tx.$queryRaw<Array<{ agent_id: string; good: bigint; bad: bigint }>>`
    SELECT t.assignee_id::text AS agent_id,
      count(*) FILTER (WHERE r.value = 'good') AS good,
      count(*) FILTER (WHERE r.value = 'bad')  AS bad
    FROM ratings r
    JOIN threads t ON t.id = r.thread_id
    WHERE r.license_id = ${licenseId}
      AND t.assignee_id IS NOT NULL
      AND r.created_at >= ${from} AND r.created_at <= ${to}
    GROUP BY t.assignee_id
  `;
  const ratingsByAgent = new Map(ratingRows.map((row) => [row.agent_id, row]));

  // Hand-offs per agent, windowed by the transfer event's own `created_at` —
  // same convention as `transferCount`.
  const transferRows = await tx.$queryRaw<Array<{ agent_id: string; transfers: bigint }>>`
    SELECT t.assignee_id::text AS agent_id, count(*) AS transfers
    FROM events e
    JOIN threads t ON t.id = e.thread_id
    WHERE e.license_id = ${licenseId}
      AND e.properties @> '{"system_event": "chat_transferred"}'::jsonb
      AND e.created_at >= ${from} AND e.created_at <= ${to}
      AND t.assignee_id IS NOT NULL
    GROUP BY t.assignee_id
  `;
  const transfersByAgent = new Map(transferRows.map((row) => [row.agent_id, Number(row.transfers)]));

  return rows.map((row) => {
    const rating = ratingsByAgent.get(row.agent_id);
    return {
      agent_id: row.agent_id,
      name: row.name,
      chats: Number(row.chats),
      closed: Number(row.closed),
      manual: Number(row.manual),
      assisted: Number(row.assisted),
      automated: Number(row.automated),
      avg_first_response_seconds: roundOrNull(row.avg_first_response_seconds),
      avg_duration_seconds: roundOrNull(row.avg_duration_seconds),
      csat: csatSummary({ good: Number(rating?.good ?? 0n), bad: Number(rating?.bad ?? 0n) }),
      transfers: transfersByAgent.get(row.agent_id) ?? 0,
    };
  });
}

/**
 * The most conversations the Chat topics report clusters in one window — a
 * ceiling on the work per request (NFR-P7). The newest `TOPIC_WINDOW_LIMIT`
 * clusterable conversations are read and clustered, and `analyzed` reports how
 * many that actually was — the truth, capped, never a silent trim passed off as
 * the whole window. The floor the report gates on (`TOPIC_MIN_CONVERSATIONS`)
 * comes from the clusterer itself, so one number governs both the count gate here
 * and the cluster-size floor there.
 */
const TOPIC_WINDOW_LIMIT = 1000;

/**
 * The window's clusterable conversations, reduced to `{ id, text }` for the
 * clusterer. A thread is clusterable once it has text to cluster: its AI summary
 * when one was written (only AI-closed threads carry one), otherwise its first
 * customer message. Newest first and capped at {@link TOPIC_WINDOW_LIMIT}, so a
 * busy window bounds the work rather than the request.
 *
 * license_id-scoped and run inside withTenant, so another tenant's conversations
 * can never enter the clustering (NFR-S4) — the same isolation the other report
 * aggregates rely on. The text is customer-authored but never leaves this
 * transaction: only derived topic labels do, and those have bare numbers stripped
 * (07.6-b), so an order or card number cannot ride out in a label.
 */
async function clusterableDocs(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<TopicDoc[]> {
  const rows = await tx.$queryRaw<Array<{ id: string; text: string | null }>>`
    SELECT t.id AS id,
      COALESCE(
        NULLIF(t.summary, ''),
        (
          SELECT e.text FROM events e
          WHERE e.thread_id = t.id
            AND e.type = 'message'
            AND e.author_type = 'customer'
            AND e.text IS NOT NULL AND e.text <> ''
          ORDER BY e.created_at ASC, e.id ASC
          LIMIT 1
        )
      ) AS text
    FROM threads t
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
      AND (
        (t.summary IS NOT NULL AND t.summary <> '')
        OR EXISTS (
          SELECT 1 FROM events e
          WHERE e.thread_id = t.id
            AND e.type = 'message'
            AND e.author_type = 'customer'
            AND e.text IS NOT NULL AND e.text <> ''
        )
      )
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${TOPIC_WINDOW_LIMIT}
  `;
  return rows.flatMap((row) => (row.text ? [{ id: row.id, text: row.text }] : []));
}

/** One topic as the report serves it — the clusterer's output plus the route's derived fields. */
interface TopicReportRow {
  id: string;
  label: string;
  keywords: string[];
  volume: number;
  share: number | null;
  previous_volume: number;
  trend: number | null;
}

interface TopicsReport {
  min_conversations: number;
  analyzed: number;
  sufficient_data: boolean;
  topics: TopicReportRow[];
}

/**
 * The Chat topics report for one window (FR-MOD-07.6). Shared so the CSV export
 * (07.6-g) serves the exact figures the JSON does — the same reason the other
 * report aggregates each live in one helper.
 *
 * Cluster the current window; if it clears the floor, derive each topic's share
 * of the window and its trend against the equal-length window before. Trend is
 * *not* a second clustering: the previous window's conversations are assigned to
 * the current topics' centroids, so the two periods speak of the same topics.
 * Re-clustering the past would name it differently, and the comparison would be
 * between two things that only look alike.
 *
 * `share` and `trend` are null, not zero, when undefined — no conversations
 * analyzed, or a topic absent from the previous window (new, so its trend is
 * unknown, not a 100% rise) — the same "unknown is not zero" rule the Overview
 * and Reviews reports carry.
 */
async function buildTopicsReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  prevFrom: Date,
  prevTo: Date,
): Promise<TopicsReport> {
  const docs = await clusterableDocs(tx, licenseId, from, to);
  const result = clusterTopics(docs);

  const base = {
    min_conversations: TOPIC_MIN_CONVERSATIONS,
    analyzed: result.analyzed,
    sufficient_data: result.sufficient,
  };
  if (!result.sufficient) return { ...base, topics: [] };

  // Rebuild each topic's centroid from its members — the clusterer returns the
  // members, not the vector. Same formula it used (the normalised mean), so this
  // is the centroid it clustered on; `similarity` is a dot product, so the
  // centroid has to be a unit vector for the comparison to be a real cosine.
  const vectorById = new Map(docs.map((doc) => [doc.id, embed(doc.text)]));
  const centroids = result.topics.map((topic) =>
    centroidOf(
      topic.docIds.map((id) => vectorById.get(id)).filter((v): v is number[] => v != null),
    ),
  );

  // Assign the previous window's conversations to the current topics' centroids,
  // clearing the same cosine floor a current conversation had to clear to join a
  // topic — a past chat too far from every current topic simply is not one of
  // them, so it lifts no topic's previous volume.
  const prevDocs = await clusterableDocs(tx, licenseId, prevFrom, prevTo);
  const previousVolumes = new Array<number>(result.topics.length).fill(0);
  for (const doc of prevDocs) {
    const vector = embed(doc.text);
    let best = -Infinity;
    let bestIndex = -1;
    for (let i = 0; i < centroids.length; i++) {
      const centroid = centroids[i];
      if (!centroid || centroid.length === 0) continue;
      const sim = similarity(vector, centroid);
      // Strict `>` so a tie keeps the earlier (higher-volume) topic.
      if (sim > best) {
        best = sim;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && best >= TOPIC_SIMILARITY_THRESHOLD) {
      previousVolumes[bestIndex] = (previousVolumes[bestIndex] ?? 0) + 1;
    }
  }

  const topics = result.topics.map((topic, i) => {
    const previousVolume = previousVolumes[i] ?? 0;
    return {
      id: topic.id,
      label: topic.label,
      keywords: topic.keywords,
      volume: topic.volume,
      share: result.analyzed > 0 ? round(topic.volume / result.analyzed) : null,
      previous_volume: previousVolume,
      trend: previousVolume > 0 ? round((topic.volume - previousVolume) / previousVolume) : null,
    };
  });

  return { ...base, topics };
}

/**
 * The normalised mean of a set of unit vectors — a cluster's centroid. Rounded to
 * six places like {@link embed}, so the centroid stays comparable to the doc
 * vectors without float drift.
 */
function centroidOf(vectors: number[][]): number[] {
  const first = vectors[0];
  if (!first) return [];
  const sum = new Array<number>(first.length).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < sum.length; i++) sum[i] = (sum[i] ?? 0) + (vector[i] ?? 0);
  }
  let magnitude = 0;
  for (const value of sum) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return sum;
  return sum.map((value) => Number((value / magnitude).toFixed(6)));
}

/**
 * One report group rendered as a CSV table — a header row and its data rows —
 * for {@link toCsv}. `reviews` serialises one row per UTC day; `breakdown`
 * serialises the Breakdown tab's four dimensions (day, hour, team, channel) in
 * one long-format table — `dimension,key,...` — rather than four files, so the
 * download stays one CSV per group; `topics` serialises one row per cluster
 * (label, volume, share, previous window's volume, trend) — below the
 * sufficiency floor only the header row, never a fabricated zero-row; the two
 * window summaries (overview, ai-agent) serialise as `metric,value` pairs, the
 * honest tabular shape for a dashboard of headline figures. Every figure is the
 * *same* one its JSON report exposes — the export reuses the report's
 * aggregation helpers rather than recomputing — so a CSV can never disagree
 * with the screen it was exported from.
 *
 * `baseline` appends the benchmark block (07.7-e). It is opt-in, unlike the
 * JSON reports' always-present `previous_period`: omitting it returns the table
 * byte-for-byte as this function has always produced it, so a script that reads
 * these columns positionally is never handed rows it did not ask for. See
 * {@link benchmarkCsvRows} for the block's shape.
 */
export async function buildGroupCsv(
  tx: TenantClient,
  licenseId: bigint,
  groupId: string,
  from: Date,
  to: Date,
  baseline?: BenchmarkBaseline,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  const table = await groupCsvTable(
    tx,
    licenseId,
    groupId,
    from,
    to,
    baseline ?? DEFAULT_BENCHMARK_BASELINE,
  );
  if (baseline === undefined) return table;
  return {
    headers: table.headers,
    rows: [
      ...table.rows,
      ...(await benchmarkCsvRows(
        tx,
        licenseId,
        groupId,
        from,
        to,
        baseline,
        table.headers.length,
      )),
    ],
  };
}

/**
 * The benchmark block appended to an export — the same figures the group's JSON
 * `previous_period` carries, as `key,value` rows padded out to the table's own
 * width.
 *
 * One shape for all nine groups rather than a bespoke column per group: the
 * groups' tables have nothing in common (a day series, a long-format
 * dimension table, a metric/value list), so a "benchmark column" would have to
 * mean something different in each, while a trailing key/value block reads the
 * same everywhere. Every key is prefixed `benchmark_`, so a consumer that reads
 * the data rows positionally can skip the block with a single test on the first
 * cell — and only ever has to, having asked for it with `?baseline=`.
 */
async function benchmarkCsvRows(
  tx: TenantClient,
  licenseId: bigint,
  groupId: string,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline,
  columns: number,
): Promise<CsvCell[][]> {
  const window = benchmarkWindow(from, to, baseline);
  // The same measurement function the group's JSON report hands to
  // `withBenchmark`, so the exported benchmark is the number the tab shows for
  // that window — the invariant every other row in this file already keeps.
  const figures = await groupBenchmark(tx, licenseId, groupId, window);

  const rows: CsvCell[][] = [
    ['benchmark_baseline', baseline],
    ['benchmark_range_from', window.from.toISOString()],
    ['benchmark_range_to', window.to.toISOString()],
  ];
  for (const [key, value] of Object.entries(figures)) {
    rows.push([`benchmark_${key}`, csvScalar(value)]);
  }

  // Pad out to the table's own column count so every line in the file has the
  // same number of fields — a ragged CSV is a parse error in stricter readers.
  return rows.map((row) => [
    ...row,
    ...Array<CsvCell>(Math.max(0, columns - row.length)).fill(null),
  ]);
}

/** A benchmark figure as a CSV cell; anything non-scalar is dropped, not stringified. */
function csvScalar(value: unknown): CsvCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  return null;
}

/**
 * What a group compares itself against, measured over one baseline window. The
 * single dispatch both the JSON reports and the CSV export go through, so a
 * group cannot end up with a benchmark on screen that its download computes a
 * different way.
 */
function groupBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  groupId: string,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  switch (groupId) {
    case 'overview':
      return overviewBenchmark(tx, licenseId, window);
    // Both compare on the license's resolution split: the Breakdown's
    // dimensions and Team performance's agent rows are window-derived, so only
    // the split itself has a counterpart in the baseline window (see each
    // builder for the full reasoning).
    case 'breakdown':
    case 'team-performance':
      return splitBenchmark(tx, licenseId, window);
    case 'ai-agent':
      return aiAgentBenchmark(tx, licenseId, window);
    case 'reviews':
      return reviewsBenchmark(tx, licenseId, window);
    case 'cases':
      return casesBenchmark(tx, licenseId, window);
    case 'leads':
      return leadsBenchmark(tx, licenseId, window);
    case 'sales':
      return Promise.resolve(salesBenchmark());
    case 'topics':
      // Topics keeps each cluster's baseline volume on its own row
      // (`previous_volume`), where it can be matched to the topic it belongs
      // to; there is no window-level figure left to state.
      return Promise.resolve({});
    default:
      throw ApiError.validation(`No exporter for report group: ${groupId}.`);
  }
}

/**
 * The group's data table, before any benchmark block is appended. `baseline`
 * reaches in only where a baseline window is part of the data itself — the
 * `topics` group, whose `previous_volume` column *is* a comparison.
 */
async function groupCsvTable(
  tx: TenantClient,
  licenseId: bigint,
  groupId: string,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline,
): Promise<{ headers: string[]; rows: CsvCell[][] }> {
  switch (groupId) {
    case 'overview': {
      const totals = await windowTotals(tx, licenseId, from, to);
      const tickets = await ticketCount(tx, licenseId, from, to);
      const satisfaction = await satisfactionCounts(tx, licenseId, from, to);
      const chats = Number(totals.total_chats);
      const closed = Number(totals.closed_chats);
      const automated = Number(totals.automated);
      const assisted = Number(totals.assisted);
      const manual = Number(totals.manual);
      return {
        headers: ['metric', 'value'],
        rows: [
          ['chats', chats],
          ['tickets', tickets],
          ['total_cases', chats + tickets],
          ['closed', closed],
          ['manual', manual],
          ['assisted', assisted],
          ['automated', automated],
          ['automated_rate', resolutionRate(automated, closed)],
          ['avg_first_response_seconds', roundOrNull(totals.avg_first_response_seconds)],
          ['avg_duration_seconds', roundOrNull(totals.avg_duration_seconds)],
          ['satisfaction_score', satisfactionScore(satisfaction)],
          ['satisfaction_responses', satisfaction.good + satisfaction.bad],
        ],
      };
    }
    case 'breakdown': {
      // Four dimensions, one file, long format: `dimension` names which axis a
      // row belongs to and `key` is that axis's bucket (a date, an hour, a team
      // name, a channel label) — so the four screen tables the tab shows become
      // one CSV without inventing a second file per dimension. Same helpers the
      // `/reports/breakdown` route calls, so the download can never disagree
      // with what the tab shows for any of the four. Sequential, not
      // `Promise.all` — `tx` is one connection inside a Prisma interactive
      // transaction (see withTenant), which does not support concurrent
      // queries on the same client; the JSON route awaits these same four
      // helpers one at a time for the same reason.
      const byDay = await breakdownByDay(tx, licenseId, from, to);
      const byHour = await breakdownByHour(tx, licenseId, from, to);
      const byTeam = await breakdownByTeam(tx, licenseId, from, to);
      const byChannel = await breakdownByChannel(tx, licenseId, from, to);
      const row = (
        key: string,
        split: { chats: number; closed: number; manual: number; assisted: number; automated: number },
      ): CsvCell[] => [key, split.chats, split.closed, split.manual, split.assisted, split.automated];
      return {
        headers: ['dimension', 'key', 'chats', 'closed', 'manual', 'assisted', 'automated'],
        rows: [
          ...byDay.map((r) => ['day', ...row(r.date, r)]),
          ...byHour.map((r) => ['hour', ...row(String(r.hour), r)]),
          // `name` is null for the fan-out-free 'Unassigned' bucket (no chat_access
          // row) — the same label the UI shows for it (see breakdownByTeam).
          ...byTeam.teams.map((r) => ['team', ...row(r.name ?? 'Unassigned', r)]),
          ...byChannel.map((r) => ['channel', ...row(r.channel, r)]),
        ],
      };
    }
    case 'ai-agent': {
      const totals = await windowTotals(tx, licenseId, from, to);
      const transfers = await transferCount(tx, licenseId, from, to);
      const skillRuns = await tx.skillRun.count({
        where: { licenseId, ranAt: { gte: from, lte: to } },
      });
      const automated = Number(totals.automated);
      const closed = Number(totals.closed_chats);
      const finished = automated + transfers;
      return {
        headers: ['metric', 'value'],
        rows: [
          ['resolutions', automated],
          ['resolution_rate', resolutionRate(automated, closed)],
          ['transfers', transfers],
          ['transfer_rate', finished === 0 ? null : round(transfers / finished)],
          ['skill_runs', skillRuns],
          ['avg_automated_duration_seconds', roundOrNull(totals.avg_automated_duration_seconds)],
        ],
      };
    }
    case 'reviews': {
      const byDay = await satisfactionByDay(tx, licenseId, from, to);
      return {
        headers: ['date', 'good', 'bad', 'responses', 'score'],
        rows: byDay.map((row) => {
          const csat = csatSummary(row);
          return [row.date, csat.good, csat.bad, csat.responses, csat.score];
        }),
      };
    }
    case 'topics': {
      // Same baseline window construction as the /reports/topics route
      // (FR-MOD-07.6) — one helper, so the CSV's `previous_volume` and `trend`
      // can never be measured against a different span than the JSON's.
      const window = benchmarkWindow(from, to, baseline);
      const report = await buildTopicsReport(tx, licenseId, from, to, window.from, window.to);
      return {
        headers: ['label', 'volume', 'share', 'previous_volume', 'trend'],
        rows: report.topics.map((topic) => [
          topic.label,
          topic.volume,
          topic.share,
          topic.previous_volume,
          topic.trend,
        ]),
      };
    }
    case 'cases': {
      // Same helper the /reports/cases route calls, so the download can never
      // disagree with what the tab shows for the day split.
      const byDay = await casesByDay(tx, licenseId, from, to);
      return {
        headers: ['date', 'open', 'closed', 'total'],
        rows: byDay.map((row) => [row.date, row.open, row.closed, row.total]),
      };
    }
    case 'leads': {
      // Same helper the /reports/leads route calls, so the download can never
      // disagree with the tab's day series — and it inherits that helper's
      // license binding (see leadFirstTouch), so the CSV never lists a sibling
      // license's lead.
      const byDay = await leadsByDay(tx, licenseId, from, to);
      return {
        headers: ['date', 'count'],
        rows: byDay.map((row) => [row.date, row.count]),
      };
    }
    case 'team-performance': {
      // Same helper the /reports/team-performance route calls, so the download
      // can never disagree with the tab's per-agent rows.
      const agentRows = await teamPerformanceByAgent(tx, licenseId, from, to);
      return {
        headers: [
          'agent_id',
          'name',
          'chats',
          'closed',
          'manual',
          'assisted',
          'automated',
          'avg_first_response_seconds',
          'avg_duration_seconds',
          'csat_good',
          'csat_bad',
          'csat_responses',
          'csat_score',
          'transfers',
        ],
        rows: agentRows.map((row) => [
          row.agent_id,
          row.name,
          row.chats,
          row.closed,
          row.manual,
          row.assisted,
          row.automated,
          row.avg_first_response_seconds,
          row.avg_duration_seconds,
          row.csat.good,
          row.csat.bad,
          row.csat.responses,
          row.csat.score,
          row.transfers,
        ]),
      };
    }
    case 'sales': {
      // Same "not configured" contract as the JSON report (buildSalesReport) —
      // no sales source exists yet (FR-MOD-13.5), so this is the honest empty
      // skeleton rather than a query the license has no data for. `csvField`
      // renders every `null` as an empty cell.
      return {
        headers: ['metric', 'value'],
        rows: [
          ['configured', 'false'],
          ['tracked_sales', null],
          ['attributed_revenue_cents', null],
          ['currency', null],
          ['conversions', null],
        ],
      };
    }
    default:
      // Unreachable: the route validates the id through reportGroup() first. A
      // throw keeps the switch exhaustive rather than silently emitting an empty
      // file if a group is ever added to the catalogue but not here.
      throw ApiError.validation(`No exporter for report group: ${groupId}.`);
  }
}

/**
 * The full subscription view (`SubscriptionView`), built the same way for a read
 * and for the reply after a change — so `PATCH` returns exactly what the next
 * `GET` would, no client refetch needed.
 *
 * `seats` is the purchased count (the stored subscription, falling back to the
 * active headcount before anyone has checked out); `min_seats` is the floor the
 * stepper enforces. `estimated_total_cents` is 0 while trialing — the trial owes
 * nothing — and otherwise the cycle-aware seat charge plus this month's overage.
 */
/**
 * The metering config both billing reads pass to {@link usageSummary} — one
 * place, so the included allowances and overage prices the subscription view
 * quotes can never diverge from the ones the usage endpoint does.
 */
function usageConfig(env: Env): {
  aiOverageCents: number;
  aiIncluded: number;
  apiOverageCents: number;
  apiIncluded: number;
} {
  return {
    aiOverageCents: env.AI_OVERAGE_CENTS,
    aiIncluded: env.AI_RESOLUTIONS_INCLUDED,
    apiOverageCents: env.API_CALL_OVERAGE_CENTS,
    apiIncluded: env.API_CALLS_INCLUDED,
  };
}

async function buildSubscriptionView(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
): Promise<Record<string, unknown>> {
  const [subscription, trial, usage, activeUsers] = await Promise.all([
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    }),
    trialState(tx, tenant),
    usageSummary(tx, tenant, usageConfig(env)),
    tx.agentMembership.count({ where: { suspended: false } }),
  ]);

  const unitPrice = subscription?.unitPriceCents ?? env.UNIT_PRICE_CENTS;
  const billingCycle = (subscription?.billingCycle ?? 'monthly') as BillingCycle;
  const seats = subscription?.seats ?? activeUsers;
  const { seatChargeCents, annualSavingsCents } = priceSeats(unitPrice, seats, billingCycle);
  const trialing = trial.access === 'trialing';

  return {
    plan: subscription?.plan ?? 'growth',
    billing_cycle: billingCycle,
    status: trial.status,
    // What the workspace can still do, spelled out — a client should not have to
    // infer read-only from a status string.
    access: trial.access,
    trial: { ends_at: trial.trialEndsAt, days_remaining: trial.daysRemaining },
    seats,
    min_seats: activeUsers,
    unit_price_cents: unitPrice,
    usage,
    // Seats plus this period's metered overage — both AI resolutions and API
    // calls land on the invoice (FR-MOD-10.1.5, "aşım faturaya"). Zero while
    // trialing; the trial owes nothing.
    estimated_total_cents: trialing
      ? 0
      : seatChargeCents + usage.ai_resolutions.overage_cents + usage.api_calls.overage_cents,
    annual_savings_cents: trialing ? 0 : annualSavingsCents,
    provider: 'mock',
  };
}

// ===========================================================================
// Report builders
//
// One pure(-ish) function per report — the exact query sequence and response
// shape each `GET /reports/*` route below sends, extracted so the `get_report`
// MCP tool (08.8.3-e) can run the same report inside its own tenant
// transaction without duplicating a single query: both callers hand these a
// transaction and a license, and get back the identical body.
// ===========================================================================

/**
 * The Overview report for one window (FR-MOD-07.3). Shared by `GET
 * /reports/overview` and `get_report` so the two can never quote different
 * figures for the same license and range.
 */
export async function buildOverviewReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  const spanMs = to.getTime() - from.getTime();
  const windowHours = spanMs / 3_600_000;

  // Sequential, not Promise.all: `tx` is one connection inside a Prisma
  // interactive transaction (see withTenant), which does not support
  // concurrent queries on the same client.
  const totals = await windowTotals(tx, licenseId, from, to);
  const satisfaction = await satisfactionCounts(tx, licenseId, from, to);

  const byAgent = await tx.$queryRaw<
    Array<{ agent_id: string; name: string | null; chats: bigint }>
  >`
    SELECT t.assignee_id::text AS agent_id, a.name, count(*) AS chats
    FROM threads t
    LEFT JOIN accounts a ON a.id = t.assignee_id
    WHERE t.license_id = ${licenseId}
      AND t.assignee_id IS NOT NULL
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY t.assignee_id, a.name
    ORDER BY chats DESC
    LIMIT 20
  `;

  const topTags = await tx.$queryRaw<Array<{ name: string; count: bigint }>>`
    SELECT tg.name, count(*) AS count
    FROM thread_tags tt
    JOIN tags tg ON tg.id = tt.tag_id
    JOIN threads t ON t.id = tt.thread_id
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY tg.name
    ORDER BY count DESC
    LIMIT 10
  `;

  const queued = await tx.thread.count({
    where: { licenseId, active: true, queuePosition: { not: null } },
  });

  // "Total cases" is chats *plus* tickets (PRD §3.3). Counted here rather than
  // folded into the thread query above because the two have no join to share —
  // a ticket need not have come from a conversation at all.
  const tickets = await ticketCount(tx, licenseId, from, to);

  const good = satisfaction.good;
  const bad = satisfaction.bad;
  const rated = good + bad;
  const totalChats = Number(totals.total_chats);
  const automated = Number(totals.automated);
  const assisted = Number(totals.assisted);
  const manual = Number(totals.manual);
  const closed = Number(totals.closed_chats);

  // The baseline window carries the same headline figures the delta badges
  // compare against (FR-MOD-07.3.1) — no by-agent or by-tag depth, since
  // nothing on a KPI card needs it. The comparable figures ride along rather
  // than a pre-computed delta, so the client shows the change *and* the
  // baseline, and rounding stays on one side of the wire.
  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        chats: totalChats,
        tickets,
        // The figure the PRD's KPI card shows. Sent as its own field rather than
        // left for the client to add up, so every surface that quotes "total
        // cases" quotes the same number.
        total_cases: totalChats + tickets,
        closed,
        // PRD 07.3.2's three-way split of closed cases. Sent as three counts
        // (not left for the client to derive) so every surface agrees, and by
        // construction manual + assisted + automated === closed.
        manual,
        assisted,
        // `automated` keeps ADR-09 unchanged — it is the invoice's number too.
        automated,
        // Shares of *closed* conversations, not all of them: an open chat has
        // not resolved either way, and counting it would make the figures drop
        // whenever the inbox is busy. Null (not 0%) when nothing closed.
        manual_rate: resolutionRate(manual, closed),
        assisted_rate: resolutionRate(assisted, closed),
        automated_rate: resolutionRate(automated, closed),
        queued_now: queued,
      },
      // The Chats section cards (PRD §7.3.3): how fast the AI is clearing chats
      // and how long conversations run. `automated_per_hour` averages over the
      // window; a zero-length window would divide by zero, so it reports 0.
      chats: {
        automated_per_hour: windowHours > 0 ? round(automated / windowHours) : 0,
        automated_avg_duration_seconds: roundOrNull(totals.avg_automated_duration_seconds),
        total_duration_seconds: Math.round(Number(totals.total_duration_seconds ?? 0)),
      },
      response_times: {
        avg_first_response_seconds: roundOrNull(totals.avg_first_response_seconds),
        avg_duration_seconds: roundOrNull(totals.avg_duration_seconds),
      },
      satisfaction: {
        good,
        bad,
        // Null rather than 0% when nobody rated: an unrated period is unknown,
        // not bad, and showing 0% would read as a catastrophe.
        score: satisfactionScore(satisfaction),
        responses: rated,
      },
      by_agent: byAgent.map((row) => ({
        agent_id: row.agent_id,
        name: row.name,
        chats: Number(row.chats),
      })),
      top_tags: topTags.map((row) => ({ name: row.name, count: Number(row.count) })),
    },
    from,
    to,
    baseline,
    (window) => overviewBenchmark(tx, licenseId, window),
  );
}

/**
 * The Overview's comparable figures for a baseline window — the headline counts
 * every KPI card can show a delta against. Three license-scoped queries, the
 * same ones the requested window uses, so the baseline is measured exactly as
 * the figure it is compared with.
 */
async function overviewBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  // Sequential, not Promise.all: `tx` is one connection inside a Prisma
  // interactive transaction (see withTenant), which does not support
  // concurrent queries on the same client.
  const totals = await windowTotals(tx, licenseId, window.from, window.to);
  const satisfaction = await satisfactionCounts(tx, licenseId, window.from, window.to);
  const tickets = await ticketCount(tx, licenseId, window.from, window.to);
  const chats = Number(totals.total_chats);

  return {
    chats,
    tickets,
    total_cases: chats + tickets,
    closed: Number(totals.closed_chats),
    manual: Number(totals.manual),
    assisted: Number(totals.assisted),
    automated: Number(totals.automated),
    avg_first_response_seconds: roundOrNull(totals.avg_first_response_seconds),
    avg_duration_seconds: roundOrNull(totals.avg_duration_seconds),
    satisfaction_score: satisfactionScore(satisfaction),
  };
}

/**
 * The resolution split for a baseline window — the shape the Breakdown and Team
 * performance reports benchmark against. One query, license-scoped, the same
 * {@link windowTotals} the requested window is measured with.
 */
async function splitBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  const totals = await windowTotals(tx, licenseId, window.from, window.to);
  return {
    chats: Number(totals.total_chats),
    closed: Number(totals.closed_chats),
    manual: Number(totals.manual),
    assisted: Number(totals.assisted),
    automated: Number(totals.automated),
  };
}

/**
 * The Breakdown report for one window (FR-MOD-07.5). Shared by `GET
 * /reports/breakdown` and `get_report` so the two can never quote different
 * figures for the same license and range.
 */
export async function buildBreakdownReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  // The resolution split per UTC day — the same helper the CSV export uses, so
  // the tab and its download can never quote a different split for a day.
  const byDay = await breakdownByDay(tx, licenseId, from, to);

  // The same split per UTC hour of day — a dense 0-23 axis, so the client
  // never has to fill in the hours nothing happened in.
  const byHour = await breakdownByHour(tx, licenseId, from, to);

  // The same split per channel — the oldest inbound adapter message decides a
  // chat's channel, 'website' when it has none. The soft-FK join is locked on
  // license *and* chat id (see breakdownByChannel), so another tenant's
  // same-id row can never reclassify a chat here.
  const byChannel = await breakdownByChannel(tx, licenseId, from, to);

  // The same split per team — the groups a chat is shared with through
  // chat_access. Fan-out is intentional (a chat open to two teams counts in
  // both) and `overlapping` declares it. The join is license-locked through
  // chats and groups (see breakdownByTeam), because chat_access has no
  // license column of its own and group ids repeat across licenses.
  const byTeam = await breakdownByTeam(tx, licenseId, from, to);

  // The same split per assigned agent. An automated chat can still carry an
  // assignee (nobody replied), so it shows against the agent it sat with.
  const byAgent = await tx.$queryRaw<
    Array<{
      agent_id: string;
      name: string | null;
      chats: bigint;
      closed: bigint;
      automated: bigint;
      assisted: bigint;
      manual: bigint;
    }>
  >`
    SELECT t.assignee_id::text AS agent_id, a.name,
      ${SPLIT_COUNTS}
    FROM threads t
    LEFT JOIN accounts a ON a.id = t.assignee_id
    WHERE t.license_id = ${licenseId}
      AND t.assignee_id IS NOT NULL
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY t.assignee_id, a.name
    ORDER BY chats DESC
    LIMIT 20
  `;

  // The benchmark is the window's *totals*, not a baseline copy of all five
  // dimensions: a dimension's buckets are derived from the window (which days
  // it holds, which teams were active), so a per-bucket baseline would line up
  // rows that are not counterparts. The comparable quantity across two windows
  // is the split itself.
  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      by_day: byDay.map((row) => ({
        date: row.date,
        chats: row.chats,
        closed: row.closed,
        manual: row.manual,
        assisted: row.assisted,
        automated: row.automated,
      })),
      by_hour: byHour.map((row) => ({
        hour: row.hour,
        chats: row.chats,
        closed: row.closed,
        manual: row.manual,
        assisted: row.assisted,
        automated: row.automated,
      })),
      by_agent: byAgent.map((row) => ({
        agent_id: row.agent_id,
        name: row.name,
        chats: Number(row.chats),
        closed: Number(row.closed),
        manual: Number(row.manual),
        assisted: Number(row.assisted),
        automated: Number(row.automated),
      })),
      by_channel: byChannel.map((row) => ({
        channel: row.channel,
        chats: row.chats,
        closed: row.closed,
        manual: row.manual,
        assisted: row.assisted,
        automated: row.automated,
      })),
      by_team: byTeam.teams.map((row) => ({
        team_id: row.team_id,
        name: row.name,
        chats: row.chats,
        closed: row.closed,
        manual: row.manual,
        assisted: row.assisted,
        automated: row.automated,
      })),
      // Declares the by_team fan-out: a chat reachable by more than one team is
      // counted under each, so the rows can sum past the window total.
      overlapping: byTeam.overlapping,
    },
    from,
    to,
    baseline,
    (window) => splitBenchmark(tx, licenseId, window),
  );
}

/**
 * The AI Agent report for one window (FR-MOD-07.4). Shared by `GET
 * /reports/ai-agent` and `get_report` so the two can never quote different
 * figures for the same license and range.
 */
export async function buildAiAgentReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  const totals = await windowTotals(tx, licenseId, from, to);

  // Hand-offs to a human — the transfer system event (chat_transferred). The
  // same helper the CSV export uses, so the two agree on the count.
  const transfers = await transferCount(tx, licenseId, from, to);

  const skillRuns = await tx.skillRun.count({
    where: { licenseId, ranAt: { gte: from, lte: to } },
  });

  const automated = Number(totals.automated);
  const closed = Number(totals.closed_chats);
  // Of the chats the AI *finished* — resolved outright or handed off — the
  // share it handed off. Null when it finished none either way.
  const finished = automated + transfers;

  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      // ADR-09's figure, the same one the invoice's AI-resolution counter uses.
      resolutions: automated,
      resolution_rate: resolutionRate(automated, closed),
      transfers,
      transfer_rate: finished === 0 ? null : round(transfers / finished),
      skill_runs: skillRuns,
      avg_automated_duration_seconds: roundOrNull(totals.avg_automated_duration_seconds),
    },
    from,
    to,
    baseline,
    (window) => aiAgentBenchmark(tx, licenseId, window),
  );
}

/**
 * The AI Agent report's comparable figures for a baseline window — the three
 * counters the tab shows deltas on, plus the rate they are read against, from
 * the same license-scoped helpers the requested window uses.
 */
async function aiAgentBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  // Sequential, not Promise.all — one connection inside one interactive
  // transaction (see withTenant).
  const totals = await windowTotals(tx, licenseId, window.from, window.to);
  const transfers = await transferCount(tx, licenseId, window.from, window.to);
  const skillRuns = await tx.skillRun.count({
    where: { licenseId, ranAt: { gte: window.from, lte: window.to } },
  });
  const automated = Number(totals.automated);

  return {
    resolutions: automated,
    resolution_rate: resolutionRate(automated, Number(totals.closed_chats)),
    transfers,
    skill_runs: skillRuns,
  };
}

/**
 * The Reviews report for one window (FR-MOD-07.8). Shared by `GET
 * /reports/reviews` and `get_report` so the two can never quote different
 * figures for the same license and range.
 */
export async function buildReviewsReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  // Sequential, not Promise.all: withTenant is one interactive transaction and
  // Prisma forbids concurrent queries on its client.
  const counts = await satisfactionCounts(tx, licenseId, from, to);
  const byDay = await satisfactionByDay(tx, licenseId, from, to);

  // The baseline window's CSAT, so the tab can show the vs-previous delta the
  // PRD asks for (its "67% vs 57%").
  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      csat: csatSummary(counts),
      by_day: byDay.map((row) => ({ date: row.date, ...csatSummary(row) })),
      // Tracked-sales skeleton (FR-MOD-13.5, v2). No sales source is wired yet, so
      // the shape is present but nothing is claimed: `configured` false and every
      // figure null, so the surface renders an honest "not set up" state rather
      // than a fabricated zero.
      ecommerce: {
        configured: false,
        tracked_sales: null,
        attributed_revenue_cents: null,
        currency: null,
      },
    },
    from,
    to,
    baseline,
    (window) => reviewsBenchmark(tx, licenseId, window),
  );
}

/** The Reviews report's comparable figures: the baseline window's CSAT tally. */
async function reviewsBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  return { ...csatSummary(await satisfactionCounts(tx, licenseId, window.from, window.to)) };
}

/**
 * The Cases report for one window (FR-MOD-07.7, v2 payload). Shared by `GET
 * /reports/cases` and the `cases` CSV export so the two can never quote
 * different figures for the same license and range. Aggregate counts only
 * (§V3) — no ticket subject or customer identity crosses into this report.
 */
export async function buildCasesReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  // Sequential, not Promise.all: withTenant is one interactive transaction and
  // Prisma forbids concurrent queries on its client.
  const byDay = await casesByDay(tx, licenseId, from, to);
  const byStatus = await casesByStatus(tx, licenseId, from, to);
  const byPriority = await casesByPriority(tx, licenseId, from, to);

  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      by_day: byDay,
      by_status: byStatus,
      by_priority: byPriority,
    },
    from,
    to,
    baseline,
    (window) => casesBenchmark(tx, licenseId, window),
  );
}

/**
 * The Cases report's comparable figures: the baseline window's ticket counts,
 * summed from {@link casesByDay} rather than from `ticketCount`. The day split
 * already excludes merged tickets, and a benchmark counted a different way than
 * the series it sits next to would be a number nobody could reconcile.
 */
async function casesBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  const days = await casesByDay(tx, licenseId, window.from, window.to);
  return {
    open: days.reduce((sum, day) => sum + day.open, 0),
    closed: days.reduce((sum, day) => sum + day.closed, 0),
    total: days.reduce((sum, day) => sum + day.total, 0),
  };
}

/**
 * The Leads report for one window (FR-MOD-07.7, v2 payload). Shared by `GET
 * /reports/leads` and the `leads` CSV export so the two can never quote
 * different figures for the same license and range. Aggregate counts only
 * (§V3) — no lead identity crosses into this report; see {@link leadFirstTouch}
 * for why the count is bound to this license rather than the whole organization.
 */
export async function buildLeadsReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  // Sequential, not Promise.all: withTenant is one interactive transaction and
  // Prisma forbids concurrent queries on its client.
  const byDay = await leadsByDay(tx, licenseId, from, to);
  const totals = await leadTotals(tx, licenseId, from, to);

  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      by_day: byDay,
      totals,
    },
    from,
    to,
    baseline,
    (window) => leadsBenchmark(tx, licenseId, window),
  );
}

/**
 * The Leads report's comparable figure. It goes through {@link leadTotals} — and
 * so through {@link leadFirstTouch} — exactly as the window's own count does,
 * which is what keeps the benchmark inside this license: a lead is counted only
 * where it actually touched this license, in the baseline window as in the
 * requested one.
 */
async function leadsBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  return { ...(await leadTotals(tx, licenseId, window.from, window.to)) };
}

/**
 * The Sales report for one window (FR-MOD-07.7, v2 payload; FR-MOD-13.5
 * dependency). No sales/order model exists in the schema yet (`grep '^model '
 * schema.prisma` has no Order/Sale/Transaction) — the same honest "not set up"
 * contract the Reviews report's `ecommerce` block uses (see
 * buildReviewsReport): `configured` is `false` and every figure `null`, never
 * a fabricated zero, until FR-MOD-13.5's Sales tracker wires a real source.
 * `tx`/`licenseId` stay in the signature — unused today, matching every other
 * builder here — so 13.5 can fill this in without moving the call site or the
 * `GET /reports/sales` contract.
 */
export async function buildSalesReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      configured: false,
      tracked_sales: null,
      attributed_revenue_cents: null,
      currency: null,
      conversions: null,
    },
    from,
    to,
    baseline,
    () => Promise.resolve(salesBenchmark()),
  );
}

/**
 * The Sales report's baseline figures — `null`, like the report's own. With no
 * sales source there is nothing to have been better or worse than; emitting
 * zeros would let a surface render a "0 → 0, no change" badge that reads as a
 * measurement.
 */
function salesBenchmark(): Record<string, unknown> {
  return {
    configured: false,
    tracked_sales: null,
    attributed_revenue_cents: null,
    currency: null,
    conversions: null,
  };
}

/**
 * The Team performance report for one window (FR-MOD-07.7, v2 payload):
 * per-agent KPIs — the Breakdown tab's by-agent chat split, extended with
 * response times, CSAT and transfers (see {@link teamPerformanceByAgent}).
 * Shared by `GET /reports/team-performance` and the `team-performance` CSV
 * export so the two can never quote different figures for the same license
 * and range.
 */
export async function buildTeamPerformanceReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): Promise<Record<string, unknown>> {
  const agents = await teamPerformanceByAgent(tx, licenseId, from, to);

  // License-wide totals, not a baseline copy of the agent table. Which agents
  // the table holds is derived from the window (`LIMIT 20` over the agents with
  // a thread created in it), so the two windows would list different people and
  // a row-by-row "vs baseline" would silently compare an agent against someone
  // else — or against a blank where they did not make the earlier cut. The
  // license's own split is the quantity both windows really share; a per-agent
  // history is a different report (a trend per agent), not this one's baseline.
  return withBenchmark(
    {
      range: { from: from.toISOString(), to: to.toISOString() },
      agents,
    },
    from,
    to,
    baseline,
    (window) => splitBenchmark(tx, licenseId, window),
  );
}

// ===========================================================================
// Staffing forecast (PRD §5.3-Vardiya, WORKSCHED-g)
//
// Three histories, one grid. The arithmetic all lives in pure modules under
// services/staffing — the capacity model (`staffingForecast`), the presence
// interval walk (`presenceCoverage`) and the roster projection
// (`rosterCoverage`) — so everything here is reading rows and lining the three
// up on the same UTC weekday × hour axes. Nothing is persisted: the grid is
// recomputed per request (PLAN §5.2.22 — no StaffingForecast table).
// ===========================================================================

const SECONDS_PER_MINUTE = 60;

/**
 * The widest window the forecast will read.
 *
 * The forecast parses `rangeQuery` directly rather than going through
 * {@link resolveReportQuery} (it takes no `baseline` — see the route), so
 * {@link assertReportRange} never runs for it; this is its own bound. It needs
 * one for a second reason besides NFR-P7: unlike every other report, this
 * endpoint pulls raw rows into JavaScript to walk them, so an unbounded range
 * would size both the day loop and the event fetch by whatever a caller typed.
 * A year is already far more history than a weekly staffing pattern can be
 * argued from; past it the honest answer is "narrow the range", not a slow
 * request. Same number as {@link REPORT_MAX_RANGE_DAYS}, so the two report
 * surfaces never disagree about how much history a caller may ask for.
 */
const STAFFING_MAX_RANGE_DAYS = REPORT_MAX_RANGE_DAYS;

/**
 * The most presence rows one forecast will hold in memory.
 *
 * Deliberately a refusal rather than a `LIMIT`: truncating a *change* log
 * silently rewrites the coverage it implies (drop the tail and every agent's
 * last known status runs to the end of the window, over-reporting exactly the
 * availability that hides understaffing). A limit that changes the answer
 * without saying so is worse than an error. Set far above any real workspace's
 * year — 50 agents changing status six times a day for a year is ~110k rows.
 */
const PRESENCE_ROW_LIMIT = 250_000;

/** A window this endpoint can actually compute over, or a 400 explaining why not. */
function assertForecastRange(from: Date, to: Date): void {
  if (to.getTime() - from.getTime() > STAFFING_MAX_RANGE_DAYS * DAY_MS) {
    throw ApiError.validation(
      `The staffing forecast reads at most ${STAFFING_MAX_RANGE_DAYS} days of history; narrow \`from\`/\`to\`.`,
    );
  }
}

/**
 * Chats started per UTC (weekday, hour) — the volume half of the forecast.
 *
 * Reuses `SPLIT_COUNTS` and the same window predicate as {@link breakdownByHour}
 * over the same `threads` rows, so the `chats` figure here *is* the one the
 * Breakdown report publishes per hour (ADR-09): summing this grid's seven days
 * of a given hour reproduces `by_hour[hour].chats` exactly, by construction
 * rather than by coincidence. The extra split columns are computed and unused —
 * cheaper than a second definition of "a chat in this window" that could drift
 * from the one every other report agrees on.
 *
 * Sparse (only cells with chats come back); the forecast fills the 7 × 24 grid.
 */
async function volumeByWeekdayHour(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<VolumeCell[]> {
  const rows = await tx.$queryRaw<Array<{ day_of_week: number; hour: number; chats: bigint }>>`
    SELECT EXTRACT(DOW FROM t.created_at AT TIME ZONE 'UTC')::int  AS day_of_week,
      EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'UTC')::int      AS hour,
      ${SPLIT_COUNTS}
    FROM threads t
    WHERE t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  return rows.map((row) => ({
    dayOfWeek: row.day_of_week,
    hour: row.hour,
    chats: Number(row.chats),
  }));
}

/**
 * The presence log for a window, including each agent's state as the window
 * opened.
 *
 * That opening row is not optional: `agent_presence_events` records *changes*,
 * so an agent who went online last week and has not touched the switch since has
 * no row inside the window at all, and a window read without their last previous
 * row would count them as absent for the whole period
 * (see `presenceCoverage`, which clips whatever it is given).
 *
 * license_id-scoped and run inside `withTenant`, so RLS and the explicit
 * predicate both bound it to the caller's license (NFR-S4).
 */
async function presenceEvents(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<PresenceEvent[]> {
  const rows = await tx.$queryRaw<Array<{ agent_id: string; status: string; changed_at: Date }>>`
    WITH inside AS (
      SELECT p.agent_id, p.status, p.changed_at
      FROM agent_presence_events p
      WHERE p.license_id = ${licenseId}
        AND p.changed_at >= ${from} AND p.changed_at <= ${to}
    ), opening AS (
      SELECT DISTINCT ON (p.agent_id) p.agent_id, p.status, p.changed_at
      FROM agent_presence_events p
      WHERE p.license_id = ${licenseId} AND p.changed_at < ${from}
      ORDER BY p.agent_id, p.changed_at DESC
    )
    SELECT agent_id::text AS agent_id, status, changed_at FROM inside
    UNION ALL
    SELECT agent_id::text AS agent_id, status, changed_at FROM opening
    ORDER BY agent_id, changed_at
    LIMIT ${PRESENCE_ROW_LIMIT + 1}
  `;

  if (rows.length > PRESENCE_ROW_LIMIT) {
    // One row past the limit only proves there are more; see PRESENCE_ROW_LIMIT
    // for why this is a refusal and not a trim.
    throw ApiError.validation(
      'The requested range holds too much presence history to forecast; narrow `from`/`to`.',
    );
  }

  return rows.map((row) => ({
    agentId: row.agent_id,
    status: row.status,
    changedAt: row.changed_at,
  }));
}

/**
 * Fold the presence log into agent-minutes per UTC (weekday, hour), or `null`
 * when the log says nothing about the window.
 *
 * `presenceCoverage` buckets by hour *of day*, which is all one calendar day can
 * tell you — so the window is walked a UTC day at a time and each day's grid is
 * added to the weekday it fell on. Events are partitioned across the day slices
 * once rather than re-filtered per slice, and each slice inherits the previous
 * one's last event per agent, which is the carry-in state the module requires.
 *
 * The agent dimension is summed away here: the forecast is deliberately blind to
 * which agent supplied a minute (see `staffing-forecast.ts`), so no agent id
 * crosses into the capacity model.
 *
 * A day *before* the log's first event contributes nothing rather than "unknown"
 * — it lowers coverage for windows that reach back past the log's beginning,
 * which errs toward showing a gap rather than hiding one.
 */
function coverageByWeekdayHour(
  events: readonly PresenceEvent[],
  from: Date,
  to: Date,
): CoverageCell[] | null {
  const toMs = to.getTime();
  const minutes = new Map<number, number>();
  let known = false;

  // Events sorted by time so the carry-in state can be tracked in one pass.
  const ordered = [...events].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  let cursorEvent = 0;
  const carry = new Map<string, PresenceEvent>();

  for (let sliceStart = from.getTime(); sliceStart < toMs; ) {
    const sliceEnd = Math.min(toMs, Math.floor(sliceStart / DAY_MS) * DAY_MS + DAY_MS);
    const dayOfWeek = new Date(sliceStart).getUTCDay();

    const inside: PresenceEvent[] = [];
    while (cursorEvent < ordered.length) {
      const event = ordered[cursorEvent];
      if (!event || event.changedAt.getTime() >= sliceEnd) break;
      // Anything before this slice is carry-in, not part of it.
      if (event.changedAt.getTime() >= sliceStart) inside.push(event);
      else carry.set(event.agentId, event);
      cursorEvent += 1;
    }

    const slice = presenceCoverage(
      [...carry.values(), ...inside],
      new Date(sliceStart),
      new Date(sliceEnd),
    );
    if (slice) {
      known = true;
      for (const agent of slice) {
        for (const [hour, online] of agent.onlineMinutes.entries()) {
          if (online === 0) continue;
          const key = dayOfWeek * 24 + hour;
          minutes.set(key, (minutes.get(key) ?? 0) + online);
        }
      }
    }

    for (const event of inside) carry.set(event.agentId, event);
    sliceStart = sliceEnd;
  }

  if (!known) return null;

  return Array.from({ length: 7 * 24 }, (_, index) => ({
    dayOfWeek: Math.floor(index / 24),
    hour: index % 24,
    onlineMinutes: minutes.get(index) ?? 0,
  }));
}

/**
 * Every saved work schedule in the license, normalised.
 *
 * Only rows that exist: an agent who has never saved a schedule is absent here,
 * not defaulted to the Monday-Friday week `GET /agents/{agentId}/work-schedule`
 * pre-fills — see `rosterCoverage` for why a suggestion is not a commitment. A
 * row that will not normalise is skipped for the same reason it is treated as
 * unset when read individually: a shape no rule admits cannot be projected onto
 * a grid, and guessing at it would put invented hours in a report.
 */
async function rosterPlans(tx: TenantClient): Promise<RosterPlan[]> {
  const rows = await tx.workSchedule.findMany({
    select: { agentId: true, timezone: true, schedule: true },
    orderBy: { agentId: 'asc' },
  });

  return rows.flatMap((row) => {
    const normalised = normalizeWorkSchedule({ timezone: row.timezone, schedule: row.schedule });
    if (isWorkScheduleProblem(normalised)) return [];
    return [
      {
        agentId: row.agentId,
        timezone: normalised.timezone,
        schedule: normalised.schedule,
      },
    ];
  });
}

/**
 * The two divisors the capacity model needs, and how many agents the first was
 * taken over.
 *
 * `concurrentChatsLimit` is the mean over *non-suspended* memberships, matching
 * the candidate pool routing actually assigns from (`routing-service.ts` skips a
 * suspended agent whatever their status says) — a workspace's departed agents
 * must not dilute how much one present agent can hold. Both figures come back
 * `null` when there is nothing to average: no active agent, or nothing closed in
 * the window. Null, not a fallback constant — inventing a handling time would
 * bury a product decision inside arithmetic, which is the same line
 * `staffing-forecast.ts` draws at refusing an unstated service-level target.
 */
async function staffingInputs(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<{ concurrentChatsLimit: number | null; agents: number; averageChatMinutes: number | null }> {
  const [membership, totals] = await Promise.all([
    tx.agentMembership.aggregate({
      where: { suspended: false },
      _avg: { concurrentChatsLimit: true },
      _count: { agentId: true },
    }),
    windowTotals(tx, licenseId, from, to),
  ]);

  const limit = Number(membership._avg.concurrentChatsLimit);
  // `avg(EXTRACT(EPOCH …))` comes back as Postgres numeric, which the driver
  // hands over as a Decimal object rather than a number — coerced here so the
  // arithmetic below is arithmetic and not string concatenation.
  const seconds = Number(totals.avg_duration_seconds);

  return {
    concurrentChatsLimit: Number.isFinite(limit) && limit > 0 ? round(limit) : null,
    agents: membership._count.agentId,
    averageChatMinutes:
      Number.isFinite(seconds) && seconds > 0 ? round(seconds / SECONDS_PER_MINUTE) : null,
  };
}

/**
 * The staffing forecast for one window (PRD §5.3-Vardiya): required / scheduled
 * / rostered agents per UTC weekday-hour, plus the inputs every cell was derived
 * from so a recommendation can be argued with rather than only believed.
 *
 * The three histories are read here and the model is applied by
 * `staffingForecast`; this function's own job is the fourth number —
 * `rostered_agents` — and the honesty rules at the edges:
 *
 *   - `observed_chats` is serialised from the volume grid this function read, not
 *     from the model's echo of it, so the count stays the Breakdown report's
 *     count (ADR-09) in every branch below.
 *   - When a divisor is unknown (nothing closed, or no active agent) the volume
 *     is **withheld from the model** rather than sized against a made-up figure:
 *     every cell comes back `required_agents: null` + `low_confidence: true`,
 *     which is exactly the claim "we cannot say", and `inputs` names which
 *     figure was missing. The placeholder divisors below can never reach a cell,
 *     because with no volume no cell clears the sample bar.
 */
export async function buildStaffingForecastReport(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<Record<string, unknown>> {
  const volume = await volumeByWeekdayHour(tx, licenseId, from, to);
  const coverage = coverageByWeekdayHour(await presenceEvents(tx, licenseId, from, to), from, to);
  // The plan is read at the window's end: a standing weekly pattern has one
  // shape, and the end is the side of any DST change that reflects how the
  // roster stands now (see rosterCoverage).
  const roster = rosterCoverage(await rosterPlans(tx), to);
  const inputs = await staffingInputs(tx, licenseId, from, to);

  const sizeable = inputs.concurrentChatsLimit !== null && inputs.averageChatMinutes !== null;
  const forecast = staffingForecast({
    volume: sizeable ? volume : [],
    coverage,
    from,
    to,
    // Unreachable placeholders when `sizeable` is false — see the doc comment.
    concurrentChatsLimit: inputs.concurrentChatsLimit ?? 1,
    averageChatMinutes: inputs.averageChatMinutes ?? 1,
    minimumSampleChats: DEFAULT_MINIMUM_SAMPLE_CHATS,
  });

  const observed = new Map(volume.map((cell) => [cell.dayOfWeek * 24 + cell.hour, cell.chats]));

  return {
    range: { from: from.toISOString(), to: to.toISOString() },
    inputs: {
      concurrent_chats_limit: inputs.concurrentChatsLimit,
      average_chat_minutes: inputs.averageChatMinutes,
      minimum_sample_chats: DEFAULT_MINIMUM_SAMPLE_CHATS,
      agents: inputs.agents,
    },
    coverage_known: forecast.coverageKnown,
    roster_known: roster !== null,
    low_confidence: forecast.lowConfidence,
    cells: forecast.cells.map((cell) => {
      // Keyed by the cell's own coordinates rather than its array position: all
      // three grids happen to share an order, and nothing should depend on that
      // staying true.
      const index = cell.dayOfWeek * 24 + cell.hour;
      return {
        day_of_week: cell.dayOfWeek,
        hour: cell.hour,
        observed_chats: observed.get(index) ?? 0,
        required_agents: cell.requiredAgents,
        scheduled_agents: cell.scheduledAgents,
        rostered_agents: roster?.[index]?.rosteredAgents ?? null,
        gap: cell.gap,
        low_confidence: cell.lowConfidence,
      };
    }),
  };
}

export default async function reportRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const { env } = options;

  app.get('/reports/overview', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    const body = await request.withTenant((tx) =>
      buildOverviewReport(tx, tenant.licenseId, from, to, baseline),
    );
    return reply.send(body);
  });

  app.get('/reports/breakdown', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    const body = await request.withTenant((tx) =>
      buildBreakdownReport(tx, tenant.licenseId, from, to, baseline),
    );
    return reply.send(body);
  });

  app.get('/reports/ai-agent', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    const body = await request.withTenant((tx) =>
      buildAiAgentReport(tx, tenant.licenseId, from, to, baseline),
    );
    return reply.send(body);
  });

  app.get('/reports/reviews', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    const body = await request.withTenant((tx) =>
      buildReviewsReport(tx, tenant.licenseId, from, to, baseline),
    );
    return reply.send(body);
  });

  // Chat topics (FR-MOD-07.6): conversations clustered into topics with volume
  // and trend. Clustering is deterministic and on-the-fly (@nexa/ai-mock, no real
  // LLM); below the floor the report is an honest "not enough conversations yet"
  // — a 200 state, not an error, so no new ApiError type. Same reports_read +
  // withTenant surface as the other tabs.
  app.get('/reports/topics', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    // The baseline window is where each topic's previous volume — and so its
    // trend — is read, so `baseline` moves the comparison the trend is against,
    // not just a block of metadata. Same helper as every other group, so the
    // window arithmetic cannot drift from theirs.
    const window = benchmarkWindow(from, to, baseline);

    const report = await request.withTenant((tx) =>
      buildTopicsReport(tx, tenant.licenseId, from, to, window.from, window.to),
    );

    // Topics carries no comparable figure of its own in the block: each
    // topic's baseline volume already rides on its own row, where it can be
    // matched to the topic it belongs to.
    const body = await withBenchmark(
      {
        range: { from: from.toISOString(), to: to.toISOString() },
        min_conversations: report.min_conversations,
        analyzed: report.analyzed,
        sufficient_data: report.sufficient_data,
        topics: report.topics,
      },
      from,
      to,
      baseline,
      () => Promise.resolve({}),
    );
    return reply.send(body);
  });

  // Cases (FR-MOD-07.7, v2 payload): the asynchronous half of the inbox
  // (tickets, FR-MOD-02.6) counted by day, current status and queue priority.
  // Same reports_read + withTenant surface as the other tabs.
  app.get('/reports/cases', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    const body = await request.withTenant((tx) =>
      buildCasesReport(tx, tenant.licenseId, from, to, baseline),
    );
    return reply.send(body);
  });

  // Leads (FR-MOD-07.7, v2 payload): customers flagged as leads counted by the
  // UTC day they first touched this license. The count is license-bound through
  // a chat/ticket join, never the organization-wide is_lead total (see
  // buildLeadsReport / leadFirstTouch) — the isolation core of this report.
  // Same reports_read + withTenant surface as the other tabs.
  app.get('/reports/leads', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    const body = await request.withTenant((tx) =>
      buildLeadsReport(tx, tenant.licenseId, from, to, baseline),
    );
    return reply.send(body);
  });

  // Team performance (FR-MOD-07.7, v2 payload): the Breakdown tab's by-agent
  // chat split, extended per agent with response times, CSAT and transfers
  // (see buildTeamPerformanceReport / teamPerformanceByAgent). Same
  // reports_read + withTenant surface as the other tabs.
  app.get(
    '/reports/team-performance',
    { config: { scopes: ['reports_read'] } },
    async (request, reply) => {
      const { from, to, baseline } = resolveReportQuery(request.query);
      const tenant = request.tenant();

      const body = await request.withTenant((tx) =>
        buildTeamPerformanceReport(tx, tenant.licenseId, from, to, baseline),
      );
      return reply.send(body);
    },
  );

  // Sales (FR-MOD-07.7, v2 payload; FR-MOD-13.5 dependency): the honest
  // "not configured" skeleton until the Sales tracker wires a real source (see
  // buildSalesReport). Same reports_read + withTenant surface as the other
  // tabs, so the endpoint's permission and range handling never need to change
  // once 13.5 fills the figures in.
  app.get('/reports/sales', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const { from, to, baseline } = resolveReportQuery(request.query);
    const tenant = request.tenant();

    const body = await request.withTenant((tx) =>
      buildSalesReport(tx, tenant.licenseId, from, to, baseline),
    );
    return reply.send(body);
  });

  // Staffing forecast (PRD §5.3-Vardiya): required / scheduled / rostered agents
  // per UTC weekday-hour, derived from historical volume, the presence event log
  // and the saved work schedules (see buildStaffingForecastReport). Same
  // reports_read + withTenant surface as the other report tabs — no new scope:
  // this is aggregate reporting over data `reports_read` already covers, and a
  // scope of its own would let a token read staffing without being able to read
  // the volume every figure here is derived from.
  //
  // No `baseline` parameter, unlike the other groups: this response *is* a
  // projection from its window, and a second projection over an earlier window
  // is not what "vs previous" means — that comparison is forecast-vs-actual,
  // which needs stored forecasts (PLAN §5.2.22 open question 2, deferred).
  app.get(
    '/reports/staffing-forecast',
    { config: { scopes: ['reports_read'] } },
    async (request, reply) => {
      const parsed = rangeQuery.safeParse(request.query);
      if (!parsed.success) throw ApiError.validation('Invalid date range.');
      const { from, to } = resolveRange(parsed.data);
      assertForecastRange(from, to);
      const tenant = request.tenant();

      const body = await request.withTenant((tx) =>
        buildStaffingForecastReport(tx, tenant.licenseId, from, to),
      );
      return reply.send(body);
    },
  );

  // The report groups this caller may see (FR-MOD-07.7 permission-based
  // visibility). Deliberately *not* scope-gated at the route: a token without
  // `reports_read` gets an empty catalogue, not a 403 — "here is what you can
  // see" answers honestly with nothing rather than refusing to answer. Any
  // authenticated agent/bot may ask; the scope filter is the answer's content.
  app.get('/reports/groups', async (request, reply) => {
    const granted = scopesOf(request.requirePrincipal());
    return reply.send({
      groups: visibleReportGroups(granted).map((group) => ({ id: group.id, label: group.label })),
    });
  });

  // CSV/PDF export of one report group (FR-MOD-07.7). Route-gated on the union
  // of every group's scope, so a token holding none is refused before any group
  // is resolved; the per-group check below then refuses a group whose own scope
  // the token lacks. `format` gates nothing on its own — it only picks the
  // serialiser for the same, already-authorised table.
  //
  // The benchmark block is opt-in here, unlike the JSON reports, which always
  // carry one. A JSON object gains a key harmlessly; a CSV is positional, and a
  // trailing block would change what a script reading column 1 as a date sees.
  // So `?baseline=` appends it and its absence leaves the file byte-identical
  // to what this endpoint has always produced.
  app.get('/reports/export', { config: { scopes: EXPORT_SCOPES } }, async (request, reply) => {
    const parsed = exportQuery.safeParse(request.query);
    if (!parsed.success) {
      // Same reasoning as resolveReportQuery: name the parameter that was wrong
      // rather than blame the range for a rejected baseline.
      if (parsed.error.issues.some((issue) => issue.path[0] === 'baseline')) {
        throw ApiError.validation(`\`baseline\` must be one of: ${BENCHMARK_BASELINES.join(', ')}.`);
      }
      throw ApiError.validation('Invalid export request.');
    }
    const { from, to } = resolveRange(parsed.data);
    // Same NFR-P7 bound as the JSON groups: an export runs the very same
    // aggregation, and this is the surface most likely to be pointed at "all of
    // it" by someone reaching for a spreadsheet of the whole history.
    assertReportRange(from, to);

    const group = reportGroup(parsed.data.group);
    // A 400, not a 404: the group is a request parameter the caller got wrong,
    // not a resource whose existence is a tenant secret.
    if (!group) throw ApiError.validation(`Unknown report group: ${parsed.data.group}.`);

    // The route gate proved the caller holds *some* export scope; this proves
    // they hold *this group's*. Identical today (every group needs reports_read),
    // but a group gated on a different scope in future is refused here, not leaked.
    if (!hasAnyScope(scopesOf(request.requirePrincipal()), group.scopes)) {
      throw ApiError.authorization(`This token cannot export the ${group.id} report.`);
    }

    const tenant = request.tenant();
    const table = await request.withTenant((tx) =>
      buildGroupCsv(tx, tenant.licenseId, group.id, from, to, parsed.data.baseline),
    );

    // A report is a point-in-time snapshot; never let a shared cache serve a
    // stale one, and never let a browser sniff the bytes into something active.
    // Identical in both branches — the format changes the body, not the
    // caching/sniffing contract.
    reply.header('x-content-type-options', 'nosniff').header('cache-control', 'no-store');

    if (parsed.data.format === 'pdf') {
      const pdf = toPdf(group.label, table.headers, table.rows, {
        subtitle: `${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)}`,
      });
      return reply
        .header('content-type', 'application/pdf')
        .header(
          'content-disposition',
          `attachment; filename="${exportFilename(group.id, from, to, 'pdf')}"`,
        )
        .send(pdf);
    }

    const csv = toCsv(table.headers, table.rows);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      // A download, named for the group and window so two exports do not collide.
      .header('content-disposition', `attachment; filename="${exportFilename(group.id, from, to)}"`)
      .send(csv);
  });

  app.get(
    '/billing/subscription',
    { config: { scopes: ['billing_manage', 'billing_admin', 'reports_read'] } },
    async (request, reply) => {
      const tenant = request.tenant();

      const view = await request.withTenant((tx) => buildSubscriptionView(tx, tenant, env));
      return reply.send(view);
    },
  );

  app.patch(
    '/billing/subscription',
    // Writable while read-only: subscribing is exactly how an expired trial
    // comes back (ADR-10). `reports_read` is a read scope and so is not accepted
    // here — changing the bill needs a billing scope.
    { config: { scopes: BILLING_WRITE_SCOPES, allowWhenReadOnly: true } },
    async (request, reply) => {
      const body = parse(updateSubscriptionBody, request.body);
      const tenant = request.tenant();

      const view = await request.withTenant(async (tx) => {
        const [activeUsers, usage] = await Promise.all([
          tx.agentMembership.count({ where: { suspended: false } }),
          usageSummary(tx, tenant, usageConfig(env)),
        ]);
        await updateSubscription(
          tx,
          tenant,
          {
            ...(body.plan !== undefined ? { plan: body.plan } : {}),
            ...(body.billing_cycle !== undefined ? { billingCycle: body.billing_cycle } : {}),
            ...(body.seats !== undefined ? { seats: body.seats } : {}),
          },
          activeUsers,
          usage.ai_resolutions.used,
        );
        // Who changed the plan, and which fields — the amounts live in the
        // subscription row, so the entry records the shape of the change only.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'billing.subscription_updated',
          metadata: { fields: Object.keys(body) },
        });
        // Read the whole view back in the same transaction, so the reply is a
        // real GET rather than a hand-assembled echo that could drift from it.
        return buildSubscriptionView(tx, tenant, env);
      });

      return reply.send(view);
    },
  );

  app.get(
    '/billing/usage',
    { config: { scopes: ['billing_manage', 'billing_admin', 'reports_read'] } },
    async (request, reply) => {
      const tenant = request.tenant();
      const usage = await request.withTenant((tx) => usageSummary(tx, tenant, usageConfig(env)));

      const used = usage.ai_resolutions.used;
      const included = usage.ai_resolutions.included;

      return reply.send({
        ...usage,
        // Proactive warning at 80% (PRD §8.3 flow 5) — a quota that surprises
        // you at 100% is a support ticket.
        quota_warning: included > 0 && used / included >= 0.8,
        period_label: currentPeriod(),
      });
    },
  );

  // Invoices (FR-MOD-10.3). Derived from the subscription and usage records, not
  // an external provider (ADR-13) — the current invoice's total is the same
  // `estimated_total_cents` the subscription view quotes.
  app.get('/billing/invoices', { config: { scopes: BILLING_READ_SCOPES } }, async (request, reply) => {
    const tenant = request.tenant();
    const invoices = await request.withTenant((tx) => buildInvoices(tx, tenant, env));
    return reply.send({ invoices });
  });

  // Download one period's invoice as CSV ("fatura indirme"). 404 if the
  // workspace has no invoice for that period.
  app.get(
    '/billing/invoices/:period/download',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const { period } = parse(z.object({ period: z.string().regex(/^\d{6}$/) }), request.params);
      const tenant = request.tenant();

      const invoice = await request.withTenant(async (tx) => {
        const invoices = await buildInvoices(tx, tenant, env);
        return invoices.find((i) => i.period === period);
      });
      if (!invoice) throw ApiError.notFound(`No invoice for period ${period}.`);

      const { headers, rows } = invoiceCsvRows(invoice);
      const csv = toCsv(headers, rows);
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${invoiceFilename(period)}"`)
        // A statement snapshot: never let a shared cache serve a stale one, and
        // never let a browser sniff the bytes into something active.
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .send(csv);
    },
  );

  // The payment method on file (FR-MOD-10.3). Masked only — no card is charged
  // and a full card number has nowhere to land (PRD §11.1/1).
  app.get(
    '/billing/payment-method',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const tenant = request.tenant();
      const paymentMethod = await request.withTenant((tx) => getPaymentMethod(tx, tenant));
      return reply.send({ payment_method: paymentMethod });
    },
  );

  app.put(
    '/billing/payment-method',
    // Writable while read-only, like the subscription PATCH: putting a card on
    // file is part of how an expired trial comes back, so the trial gate must
    // not block it. Changing the payment method still needs a billing scope.
    { config: { scopes: BILLING_WRITE_SCOPES, allowWhenReadOnly: true } },
    async (request, reply) => {
      const body = parse(paymentMethodBody, request.body);
      const tenant = request.tenant();

      const paymentMethod = await request.withTenant(async (tx) => {
        const stored = await upsertPaymentMethod(tx, tenant, {
          brand: body.brand,
          last4: body.last4,
          expMonth: body.exp_month,
          expYear: body.exp_year,
          holderName: body.holder_name,
        });
        // Record who set the card and which brand/last four — never the expiry or
        // holder, which the audit log has no reason to keep.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'billing.payment_method_updated',
          metadata: { brand: stored.brand, last4: stored.last4 },
        });
        return stored;
      });

      return reply.send(paymentMethod);
    },
  );
}

function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value);
}
