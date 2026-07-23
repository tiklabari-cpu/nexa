/**
 * Reports and billing.
 *
 * The "Automated" figure here and the AI-resolution counter on the invoice come
 * from the same query (ADR-09). Two independent counters would drift, and the
 * first anyone would notice is a customer disputing a bill.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import type { Env } from '../config/env.js';
import { currentPeriod, trialState, usageSummary } from '../services/billing/metering.js';

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

    const report = await request.withTenant(async (tx) => {
      const [totals] = await tx.$queryRaw<
        Array<{
          total_chats: bigint;
          closed_chats: bigint;
          automated: bigint;
          avg_first_response_seconds: number | null;
          avg_duration_seconds: number | null;
        }>
      >`
        SELECT
          count(*)                                            AS total_chats,
          count(*) FILTER (WHERE NOT t.active)                AS closed_chats,
          -- ADR-09: a thread with no agent-authored event resolved without a
          -- human. Same predicate the billing counter uses.
          count(*) FILTER (
            WHERE NOT t.active
              AND NOT EXISTS (
                SELECT 1 FROM events e
                WHERE e.thread_id = t.id AND e.author_type = 'agent'
              )
          )                                                   AS automated,
          avg(EXTRACT(EPOCH FROM (t.first_response_at - t.created_at)))
            FILTER (WHERE t.first_response_at IS NOT NULL)    AS avg_first_response_seconds,
          avg(EXTRACT(EPOCH FROM (t.closed_at - t.created_at)))
            FILTER (WHERE t.closed_at IS NOT NULL)            AS avg_duration_seconds
        FROM threads t
        WHERE t.license_id = ${tenant.licenseId}
          AND t.created_at >= ${from} AND t.created_at <= ${to}
      `;

      const [satisfaction] = await tx.$queryRaw<Array<{ good: bigint; bad: bigint }>>`
        SELECT
          count(*) FILTER (WHERE value = 'good') AS good,
          count(*) FILTER (WHERE value = 'bad')  AS bad
        FROM ratings
        WHERE license_id = ${tenant.licenseId}
          AND created_at >= ${from} AND created_at <= ${to}
      `;

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
      const tickets = await tx.ticket.count({
        where: { licenseId: tenant.licenseId, createdAt: { gte: from, lte: to } },
      });

      return { totals, satisfaction, byAgent, topTags, queued, tickets };
    });

    const good = Number(report.satisfaction?.good ?? 0n);
    const bad = Number(report.satisfaction?.bad ?? 0n);
    const rated = good + bad;
    const totalChats = Number(report.totals?.total_chats ?? 0n);
    const automated = Number(report.totals?.automated ?? 0n);
    const closed = Number(report.totals?.closed_chats ?? 0n);

    return reply.send({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        chats: totalChats,
        tickets: report.tickets,
        // The figure the PRD's KPI card shows. Sent as its own field rather
        // than left for the client to add up, so every surface that quotes
        // "total cases" quotes the same number.
        total_cases: totalChats + report.tickets,
        closed,
        // Share of *closed* conversations, not all of them: an open chat has
        // not resolved either way, and counting it would make the figure drop
        // whenever the inbox is busy.
        automated,
        automated_rate: closed === 0 ? null : round(automated / closed),
        queued_now: report.queued,
      },
      response_times: {
        avg_first_response_seconds: roundOrNull(report.totals?.avg_first_response_seconds),
        avg_duration_seconds: roundOrNull(report.totals?.avg_duration_seconds),
      },
      satisfaction: {
        good,
        bad,
        // Null rather than 0% when nobody rated: an unrated period is unknown,
        // not bad, and showing 0% would read as a catastrophe.
        score: rated === 0 ? null : round(good / rated),
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

  app.get(
    '/billing/subscription',
    { config: { scopes: ['billing_manage', 'billing_admin', 'reports_read'] } },
    async (request, reply) => {
      const tenant = request.tenant();

      const result = await request.withTenant(async (tx) => {
        const [subscription, trial, usage, seats] = await Promise.all([
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
        return { subscription, trial, usage, seats };
      });

      const unitPrice = result.subscription?.unitPriceCents ?? env.UNIT_PRICE_CENTS;
      const seatCost = unitPrice * result.seats;

      return reply.send({
        plan: result.subscription?.plan ?? 'growth',
        billing_cycle: result.subscription?.billingCycle ?? 'monthly',
        status: result.trial.status,
        // What the workspace can still do, spelled out — a client should not
        // have to infer read-only from a status string.
        access: result.trial.access,
        trial: {
          ends_at: result.trial.trialEndsAt,
          days_remaining: result.trial.daysRemaining,
        },
        seats: result.seats,
        unit_price_cents: unitPrice,
        usage: result.usage,
        // Trial bills nothing, which is worth stating rather than implying.
        estimated_total_cents:
          result.trial.access === 'trialing'
            ? 0
            : seatCost + result.usage.ai_resolutions.overage_cents,
        provider: 'mock',
      });
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value);
}
