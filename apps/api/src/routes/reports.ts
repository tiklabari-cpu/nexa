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
import { hasAnyScope } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { resolutionRate, round } from './reports-metrics.js';
import {
  EXPORT_SCOPES,
  exportFilename,
  reportGroup,
  toCsv,
  visibleReportGroups,
  type CsvCell,
} from './reports-export.js';
import { scopesOf } from '../services/auth/principal.js';
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
});

/** An export request: which report group, over which window (defaults to 30d). */
const exportQuery = rangeQuery.extend({ group: z.string().min(1).max(64) });

/** Default window: the last 30 days, the span every dashboard opens on. */
function resolveRange(query: z.infer<typeof rangeQuery>): { from: Date; to: Date } {
  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - 30 * 86_400_000);
  if (from > to) throw ApiError.validation('`from` must be before `to`.');
  return { from, to };
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

/**
 * One report group rendered as a CSV table — a header row and its data rows —
 * for {@link toCsv}. The two time-series groups (breakdown, reviews) serialise as
 * one row per UTC day; the two window summaries (overview, ai-agent) serialise as
 * `metric,value` pairs, the honest tabular shape for a dashboard of headline
 * figures. Every figure is the *same* one its JSON report exposes — the export
 * reuses the report's aggregation helpers rather than recomputing — so a CSV can
 * never disagree with the screen it was exported from.
 */
async function buildGroupCsv(
  tx: TenantClient,
  licenseId: bigint,
  groupId: string,
  from: Date,
  to: Date,
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
      const byDay = await breakdownByDay(tx, licenseId, from, to);
      return {
        headers: ['date', 'chats', 'closed', 'manual', 'assisted', 'automated'],
        rows: byDay.map((row) => [
          row.date,
          row.chats,
          row.closed,
          row.manual,
          row.assisted,
          row.automated,
        ]),
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

export default async function reportRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const { env } = options;

  app.get('/reports/overview', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) throw ApiError.validation('Invalid date range.');
    const { from, to } = resolveRange(parsed.data);
    const tenant = request.tenant();

    // The comparison window: the same span immediately before `from`, so a
    // "vs previous" delta compares like with like (FR-MOD-07.3.1). A millisecond
    // short of `from` keeps the two windows from sharing an instant.
    const spanMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(from.getTime() - spanMs);
    const windowHours = spanMs / 3_600_000;

    const report = await request.withTenant(async (tx) => {
      // Sequential, not Promise.all: withTenant runs in one interactive
      // transaction, and Prisma forbids concurrent queries on its client.
      const totals = await windowTotals(tx, tenant.licenseId, from, to);
      const satisfaction = await satisfactionCounts(tx, tenant.licenseId, from, to);

      const byAgent = await tx.$queryRaw<
        Array<{ agent_id: string; name: string | null; chats: bigint }>
      >`
        SELECT t.assignee_id::text AS agent_id, a.name, count(*) AS chats
        FROM threads t
        LEFT JOIN accounts a ON a.id = t.assignee_id
        WHERE t.license_id = ${tenant.licenseId}
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
        WHERE t.license_id = ${tenant.licenseId}
          AND t.created_at >= ${from} AND t.created_at <= ${to}
        GROUP BY tg.name
        ORDER BY count DESC
        LIMIT 10
      `;

      const queued = await tx.thread.count({
        where: { licenseId: tenant.licenseId, active: true, queuePosition: { not: null } },
      });

      // "Total cases" is chats *plus* tickets (PRD §3.3). Counted here rather
      // than folded into the thread query above because the two have no join to
      // share — a ticket need not have come from a conversation at all.
      const tickets = await ticketCount(tx, tenant.licenseId, from, to);

      // The previous window: the same headline figures the delta badges compare
      // against. No by-agent or by-tag depth — nothing on a KPI card needs it.
      const prevTotals = await windowTotals(tx, tenant.licenseId, prevFrom, prevTo);
      const prevSatisfaction = await satisfactionCounts(tx, tenant.licenseId, prevFrom, prevTo);
      const prevTickets = await ticketCount(tx, tenant.licenseId, prevFrom, prevTo);

      return {
        totals,
        satisfaction,
        byAgent,
        topTags,
        queued,
        tickets,
        prevTotals,
        prevSatisfaction,
        prevTickets,
      };
    });

    const good = report.satisfaction.good;
    const bad = report.satisfaction.bad;
    const rated = good + bad;
    const totalChats = Number(report.totals.total_chats);
    const automated = Number(report.totals.automated);
    const assisted = Number(report.totals.assisted);
    const manual = Number(report.totals.manual);
    const closed = Number(report.totals.closed_chats);
    const prevChats = Number(report.prevTotals.total_chats);

    return reply.send({
      range: { from: from.toISOString(), to: to.toISOString() },
      // The equal-length window before this one, so every KPI card can show a
      // vs-previous delta (FR-MOD-07.3.1). The comparable figures ride along and
      // the client subtracts — the baseline stays visible next to the change.
      previous_period: {
        range: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
        chats: prevChats,
        tickets: report.prevTickets,
        total_cases: prevChats + report.prevTickets,
        closed: Number(report.prevTotals.closed_chats),
        manual: Number(report.prevTotals.manual),
        assisted: Number(report.prevTotals.assisted),
        automated: Number(report.prevTotals.automated),
        avg_first_response_seconds: roundOrNull(report.prevTotals.avg_first_response_seconds),
        avg_duration_seconds: roundOrNull(report.prevTotals.avg_duration_seconds),
        satisfaction_score: satisfactionScore(report.prevSatisfaction),
      },
      totals: {
        chats: totalChats,
        tickets: report.tickets,
        // The figure the PRD's KPI card shows. Sent as its own field rather
        // than left for the client to add up, so every surface that quotes
        // "total cases" quotes the same number.
        total_cases: totalChats + report.tickets,
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
        queued_now: report.queued,
      },
      // The Chats section cards (PRD §7.3.3): how fast the AI is clearing chats
      // and how long conversations run. `automated_per_hour` averages over the
      // window; a zero-length window would divide by zero, so it reports 0.
      chats: {
        automated_per_hour: windowHours > 0 ? round(automated / windowHours) : 0,
        automated_avg_duration_seconds: roundOrNull(report.totals.avg_automated_duration_seconds),
        total_duration_seconds: Math.round(Number(report.totals.total_duration_seconds ?? 0)),
      },
      response_times: {
        avg_first_response_seconds: roundOrNull(report.totals.avg_first_response_seconds),
        avg_duration_seconds: roundOrNull(report.totals.avg_duration_seconds),
      },
      satisfaction: {
        good,
        bad,
        // Null rather than 0% when nobody rated: an unrated period is unknown,
        // not bad, and showing 0% would read as a catastrophe.
        score: satisfactionScore(report.satisfaction),
        responses: rated,
      },
      by_agent: report.byAgent.map((row) => ({
        agent_id: row.agent_id,
        name: row.name,
        chats: Number(row.chats),
      })),
      top_tags: report.topTags.map((row) => ({ name: row.name, count: Number(row.count) })),
    });
  });

  app.get('/reports/breakdown', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) throw ApiError.validation('Invalid date range.');
    const { from, to } = resolveRange(parsed.data);
    const tenant = request.tenant();

    const data = await request.withTenant(async (tx) => {
      // The resolution split per UTC day — the same helper the CSV export uses,
      // so the tab and its download can never quote a different split for a day.
      const byDay = await breakdownByDay(tx, tenant.licenseId, from, to);

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
        WHERE t.license_id = ${tenant.licenseId}
          AND t.assignee_id IS NOT NULL
          AND t.created_at >= ${from} AND t.created_at <= ${to}
        GROUP BY t.assignee_id, a.name
        ORDER BY chats DESC
        LIMIT 20
      `;

      return { byDay, byAgent };
    });

    return reply.send({
      range: { from: from.toISOString(), to: to.toISOString() },
      by_day: data.byDay.map((row) => ({
        date: row.date,
        chats: row.chats,
        closed: row.closed,
        manual: row.manual,
        assisted: row.assisted,
        automated: row.automated,
      })),
      by_agent: data.byAgent.map((row) => ({
        agent_id: row.agent_id,
        name: row.name,
        chats: Number(row.chats),
        closed: Number(row.closed),
        manual: Number(row.manual),
        assisted: Number(row.assisted),
        automated: Number(row.automated),
      })),
    });
  });

  app.get('/reports/ai-agent', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) throw ApiError.validation('Invalid date range.');
    const { from, to } = resolveRange(parsed.data);
    const tenant = request.tenant();

    const data = await request.withTenant(async (tx) => {
      const totals = await windowTotals(tx, tenant.licenseId, from, to);

      // Hand-offs to a human — the transfer system event (chat_transferred). The
      // same helper the CSV export uses, so the two agree on the count.
      const transfers = await transferCount(tx, tenant.licenseId, from, to);

      const skillRuns = await tx.skillRun.count({
        where: { licenseId: tenant.licenseId, ranAt: { gte: from, lte: to } },
      });

      return { totals, transfers, skillRuns };
    });

    const automated = Number(data.totals.automated);
    const closed = Number(data.totals.closed_chats);
    // Of the chats the AI *finished* — resolved outright or handed off — the
    // share it handed off. Null when it finished none either way.
    const finished = automated + data.transfers;

    return reply.send({
      range: { from: from.toISOString(), to: to.toISOString() },
      // ADR-09's figure, the same one the invoice's AI-resolution counter uses.
      resolutions: automated,
      resolution_rate: resolutionRate(automated, closed),
      transfers: data.transfers,
      transfer_rate: finished === 0 ? null : round(data.transfers / finished),
      skill_runs: data.skillRuns,
      avg_automated_duration_seconds: roundOrNull(data.totals.avg_automated_duration_seconds),
    });
  });

  app.get('/reports/reviews', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const parsed = rangeQuery.safeParse(request.query);
    if (!parsed.success) throw ApiError.validation('Invalid date range.');
    const { from, to } = resolveRange(parsed.data);
    const tenant = request.tenant();

    // The equal-length window immediately before this one, so the tab can show a
    // vs-previous CSAT delta (the PRD's "67% vs 57%") — the same construction the
    // Overview uses for its period comparison (FR-MOD-07.3.1).
    const spanMs = to.getTime() - from.getTime();
    const prevTo = new Date(from.getTime() - 1);
    const prevFrom = new Date(from.getTime() - spanMs);

    const data = await request.withTenant(async (tx) => {
      // Sequential, not Promise.all: withTenant is one interactive transaction
      // and Prisma forbids concurrent queries on its client.
      const counts = await satisfactionCounts(tx, tenant.licenseId, from, to);
      const prevCounts = await satisfactionCounts(tx, tenant.licenseId, prevFrom, prevTo);
      const byDay = await satisfactionByDay(tx, tenant.licenseId, from, to);
      return { counts, prevCounts, byDay };
    });

    return reply.send({
      range: { from: from.toISOString(), to: to.toISOString() },
      csat: csatSummary(data.counts),
      previous_period: {
        range: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
        ...csatSummary(data.prevCounts),
      },
      by_day: data.byDay.map((row) => ({ date: row.date, ...csatSummary(row) })),
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
    });
  });

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

  // CSV export of one report group (FR-MOD-07.7). Route-gated on the union of
  // every group's scope, so a token holding none is refused before any group is
  // resolved; the per-group check below then refuses a group whose own scope the
  // token lacks. PDF and benchmark comparison are v2 (PLAN §4.4.8) — not here.
  app.get('/reports/export', { config: { scopes: EXPORT_SCOPES } }, async (request, reply) => {
    const parsed = exportQuery.safeParse(request.query);
    if (!parsed.success) throw ApiError.validation('Invalid export request.');
    const { from, to } = resolveRange(parsed.data);

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
      buildGroupCsv(tx, tenant.licenseId, group.id, from, to),
    );
    const csv = toCsv(table.headers, table.rows);

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      // A download, named for the group and window so two exports do not collide.
      .header('content-disposition', `attachment; filename="${exportFilename(group.id, from, to)}"`)
      // A report is a point-in-time snapshot; never let a shared cache serve a
      // stale one, and never let a browser sniff the bytes into something active.
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store')
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
