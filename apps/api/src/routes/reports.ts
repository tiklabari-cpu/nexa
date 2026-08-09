/**
 * Reports and billing.
 *
 * The "Automated" figure here and the AI-resolution counter on the invoice come
 * from the same query (ADR-09). Two independent counters would drift, and the
 * first anyone would notice is a customer disputing a bill.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  API_PACKAGE_CATALOG,
  hasAnyScope,
  isWorkScheduleProblem,
  normalizeWorkSchedule,
} from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import {
  BENCHMARK_BASELINES,
  benchmarkWindow,
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
} from './reports-export.js';
import {
  aiAgentBenchmark,
  breakdownByChannel,
  breakdownByDay,
  breakdownByHour,
  breakdownByTeam,
  buildGroupCsv,
  buildTopicsReport,
  casesBenchmark,
  casesByDay,
  casesByPriority,
  casesByStatus,
  csatSummary,
  leadsBenchmark,
  leadsByDay,
  leadTotals,
  overviewBenchmark,
  reviewsBenchmark,
  roundOrNull,
  salesBenchmark,
  satisfactionByDay,
  satisfactionCounts,
  satisfactionScore,
  splitBenchmark,
  SPLIT_COUNTS,
  teamPerformanceByAgent,
  ticketCount,
  transferCount,
  windowTotals,
} from '../services/reports/report-csv.js';
import { scopesOf } from '../services/auth/principal.js';
import { presenceCoverage, type PresenceEvent } from '../services/staffing/presence-coverage.js';
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
import {
  purchaseApiPackage,
  serialiseApiPackagePurchase,
} from '../services/billing/api-package-service.js';

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

/**
 * Which package to buy. The id is only checked for *shape* here — whether it
 * names a real package is the catalogue's answer, and an unknown one is a 404
 * from the purchase service rather than a 400: asking to buy `enterprise` is a
 * well-formed request for something that is not on sale.
 */
const purchaseApiPackageBody = z.object({
  package_id: z.string().trim().min(1).max(64),
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

  for (let sliceStart = from.getTime(); sliceStart < toMs;) {
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
): Promise<{
  concurrentChatsLimit: number | null;
  agents: number;
  averageChatMinutes: number | null;
}> {
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

  app.get(
    '/reports/breakdown',
    { config: { scopes: ['reports_read'] } },
    async (request, reply) => {
      const { from, to, baseline } = resolveReportQuery(request.query);
      const tenant = request.tenant();

      const body = await request.withTenant((tx) =>
        buildBreakdownReport(tx, tenant.licenseId, from, to, baseline),
      );
      return reply.send(body);
    },
  );

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
        throw ApiError.validation(
          `\`baseline\` must be one of: ${BENCHMARK_BASELINES.join(', ')}.`,
        );
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
    return (
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        // A download, named for the group and window so two exports do not collide.
        .header(
          'content-disposition',
          `attachment; filename="${exportFilename(group.id, from, to)}"`,
        )
        .send(csv)
    );
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
  app.get(
    '/billing/invoices',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const tenant = request.tenant();
      const invoices = await request.withTenant((tx) => buildInvoices(tx, tenant, env));
      return reply.send({ invoices });
    },
  );

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
      return (
        reply
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', `attachment; filename="${invoiceFilename(period)}"`)
          // A statement snapshot: never let a shared cache serve a stale one, and
          // never let a browser sniff the bytes into something active.
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'no-store')
          .send(csv)
      );
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

  // The API request packages on sale (FR-MOD-09.3). The catalogue is a code
  // constant, identical for every workspace — no tenant query, and deliberately
  // no per-tenant filtering: a price that differs by who is asking is a pricing
  // feature nobody asked for. Still behind the billing read scopes, because
  // what a product charges is not something an unauthenticated caller enumerates.
  app.get('/billing/api-packages', { config: { scopes: BILLING_READ_SCOPES } }, async (_, reply) =>
    reply.send({ items: API_PACKAGE_CATALOG }),
  );

  // Buy one (FR-MOD-09.3). Payment is mocked (ADR-13) — no card is charged and
  // none has to be on file — but the quota is real: the calls land in this
  // period's allowance, and the price lands on the invoice (09.3-e).
  app.post(
    '/billing/api-packages',
    // Writable while read-only, like the subscription PATCH and the payment
    // method PUT: a workspace that has run out of capacity is exactly the one
    // that needs to buy some, and the trial gate must not be what stops it.
    // `reports_read` still cannot get in here — reading prices is not spending.
    { config: { scopes: BILLING_WRITE_SCOPES, allowWhenReadOnly: true } },
    async (request, reply) => {
      const body = parse(purchaseApiPackageBody, request.body);
      const tenant = request.tenant();

      const result = await request.withTenant(async (tx) => {
        const { purchase, package: pkg } = await purchaseApiPackage(
          tx,
          tenant,
          body.package_id,
          usageConfig(env),
        );
        // What was bought and what it cost. The amounts are already on the
        // receipt row; the entry records them anyway because it is the one log
        // that answers "who spent this" — the purchase row has no actor.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'billing.api_package_purchased',
          target: `api_package_purchase:${purchase.id}`,
          metadata: {
            package_id: pkg.id,
            api_calls: pkg.api_calls,
            price_cents: pkg.price_cents,
            period: purchase.period,
          },
        });
        // Usage read back inside the same transaction, so the caller sees the
        // allowance this purchase produced rather than whatever a second,
        // later request would have found.
        return {
          purchase: serialiseApiPackagePurchase(purchase),
          usage: await usageSummary(tx, tenant, usageConfig(env)),
        };
      });

      return reply.send(result);
    },
  );

  // What this workspace has actually bought, newest first. The quota and price
  // come off the stored row rather than the catalogue, so a later price change
  // never rewrites what someone was charged — see `serialiseApiPackagePurchase`,
  // shared with the purchase response above.
  app.get(
    '/billing/api-packages/purchases',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const tenant = request.tenant();
      const purchases = await request.withTenant((tx) =>
        tx.apiPackagePurchase.findMany({
          where: { licenseId: tenant.licenseId },
          orderBy: { purchasedAt: 'desc' },
        }),
      );

      return reply.send({ items: purchases.map(serialiseApiPackagePurchase) });
    },
  );
}
