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
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { resolutionRate, round } from './reports-metrics.js';
import type { Env } from '../config/env.js';
import type { TenantClient, TenantContext } from '../lib/tenant.js';
import { currentPeriod, trialState, usageSummary } from '../services/billing/metering.js';
import {
  BILLING_CYCLES,
  priceSeats,
  updateSubscription,
  type BillingCycle,
} from '../services/billing/subscription-service.js';

const BILLING_WRITE_SCOPES = ['billing_manage', 'billing_admin'];

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
    usageSummary(tx, tenant, {
      aiOverageCents: env.AI_OVERAGE_CENTS,
      aiIncluded: env.AI_RESOLUTIONS_INCLUDED,
    }),
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
    estimated_total_cents: trialing ? 0 : seatChargeCents + usage.ai_resolutions.overage_cents,
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
      // The resolution split per UTC day. `AT TIME ZONE 'UTC'` pins the bucket
      // boundary regardless of server timezone, so a day never drifts.
      const byDay = await tx.$queryRaw<
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
        WHERE t.license_id = ${tenant.licenseId}
          AND t.created_at >= ${from} AND t.created_at <= ${to}
        GROUP BY 1
        ORDER BY 1
      `;

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
        chats: Number(row.chats),
        closed: Number(row.closed),
        manual: Number(row.manual),
        assisted: Number(row.assisted),
        automated: Number(row.automated),
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

      // Hand-offs to a human — the transfer system event (chat_transferred).
      // Containment (`@>`) rather than `->>` so the jsonb GIN index can serve it.
      const [transfersRow] = await tx.$queryRaw<Array<{ transfers: bigint }>>`
        SELECT count(*) AS transfers
        FROM events e
        WHERE e.license_id = ${tenant.licenseId}
          AND e.properties @> '{"system_event": "chat_transferred"}'::jsonb
          AND e.created_at >= ${from} AND e.created_at <= ${to}
      `;

      const skillRuns = await tx.skillRun.count({
        where: { licenseId: tenant.licenseId, ranAt: { gte: from, lte: to } },
      });

      return { totals, transfers: Number(transfersRow?.transfers ?? 0n), skillRuns };
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
          usageSummary(tx, tenant, {
            aiOverageCents: env.AI_OVERAGE_CENTS,
            aiIncluded: env.AI_RESOLUTIONS_INCLUDED,
          }),
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
      const usage = await request.withTenant((tx) =>
        usageSummary(tx, tenant, {
          aiOverageCents: env.AI_OVERAGE_CENTS,
          aiIncluded: env.AI_RESOLUTIONS_INCLUDED,
        }),
      );

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
}

function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value);
}
