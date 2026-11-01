/**
 * The figures a summary e-mail states (RP-05 · tm 372) — and nothing else.
 *
 * Every number comes from the report helpers the Reports screens and their
 * exports read (`windowTotals`, `missedTotals`, `satisfactionCounts`,
 * `queueTotals`, `readAiMetricCounts`), called with the SAME report filter
 * (RP-01), so a summary cannot quote a different figure than the report it
 * links to for the same window. The only query written here is the one count no
 * report has as a number: the conversations a risk flag was raised in.
 *
 * **Counts only.** The type below is the whole of what can reach a template: a
 * player's name, user name, e-mail or message text is not a field on it, so the
 * guarantee that a summary carries no personal data rests on the shape rather
 * than on a template remembering to leave something out (and
 * `digest-mail.test.ts` holds the rendered body to it as well).
 *
 * A recipient's reach decides the filter: the workspace for `reports.view` =
 * `all`, the teams they lead for `team` (`ledGroupIds`, read on every sweep so
 * stepping down as lead takes effect at the next one). A lead of no team has an
 * empty filter and no summary at all (`reachOf` in the sweeper).
 */
import { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';
import { readAiMetricCounts } from '../reports/ai-metrics.js';
import { satisfactionCounts, satisfactionScore, windowTotals } from '../reports/report-csv.js';
import { missedTotals } from '../reports/missed-engagement.js';
import { queueTotals } from '../reports/queue-reports.js';
import { threadFilterSql, type ThreadFilter } from '../reports/report-filter.js';

/** One period's figures. Every field is a count, a duration in seconds or a 0..1 share. */
export interface DigestFigures {
  /** Connections that began in the period. */
  chats: number;
  /** Of those, closed. */
  closed: number;
  /** Missed connections (RP-02). */
  missed: number;
  /** Mean time to the first reply, in whole seconds; null when none was answered. */
  avg_first_response_seconds: number | null;
  /** Good ratings as a share of all ratings (0..1); null when nobody rated. */
  csat_score: number | null;
  csat_responses: number;
  /** Conversations the AI wrote in that ended in the period. */
  ai_conversations: number;
  /** Of those, resolved (confirmed or assumed) and handed to a person. */
  ai_resolved: number;
  ai_handed_off: number;
  /** Conversations a risk flag was raised in during the period — a count, never who or what. */
  risk_flagged_chats: number;
  /** Connections that entered a queue, and the 80th-percentile wait of those that were assigned. */
  queue_entries: number;
  queue_p80_wait_seconds: number | null;
}

/** The period and the one before it — what the e-mail compares. */
export interface DigestComparison {
  current: DigestFigures;
  previous: DigestFigures;
}

/** Conversations a risk flag was raised in during `[from, to]`, under the report filter. */
async function riskFlaggedChats(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null,
): Promise<number> {
  const [row] = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(DISTINCT t.id) AS n
      FROM risk_flags f
      JOIN threads t ON t.id = f.thread_id
     WHERE f.license_id = ${licenseId}
       AND t.license_id = ${licenseId}
       AND f.raised_at >= ${from} AND f.raised_at <= ${to}
       AND ${threadFilterSql(filter)}`);
  return Number(row?.n ?? 0n);
}

const secondsOrNull = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(value);

/**
 * One period's figures. Sequential on purpose: `tx` is one connection inside an
 * interactive transaction, which does not run concurrent queries.
 */
export async function digestFigures(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
  filter: ThreadFilter | null,
): Promise<DigestFigures> {
  const { from, to } = window;
  const totals = await windowTotals(tx, licenseId, from, to, filter);
  const missed = await missedTotals(tx, licenseId, from, to, filter);
  const ratings = await satisfactionCounts(tx, licenseId, from, to, filter);
  const queue = await queueTotals(tx, licenseId, from, to, filter);
  // The AI outcome table is bound by team, not by the thread filter, and its
  // window is half-open (`ended_at < to`): hand it the instant after the period.
  const ai = await readAiMetricCounts(tx, from, new Date(to.getTime() + 1), {
    teamIds: filter?.groupIds ?? null,
  });
  const risk = await riskFlaggedChats(tx, licenseId, from, to, filter);

  return {
    chats: Number(totals.total_chats),
    closed: Number(totals.closed_chats),
    missed: missed.missed,
    avg_first_response_seconds: secondsOrNull(totals.avg_first_response_seconds),
    csat_score: satisfactionScore(ratings),
    csat_responses: ratings.good + ratings.bad,
    ai_conversations: ai.conversations,
    ai_resolved: ai.confirmed + ai.assumed,
    ai_handed_off: ai.handed_off,
    risk_flagged_chats: risk,
    queue_entries: queue.entries,
    queue_p80_wait_seconds: queue.p80_wait_seconds,
  };
}

/** The period and the one before it, under one filter. */
export async function digestComparison(
  tx: TenantClient,
  licenseId: bigint,
  period: { from: Date; to: Date; previous: { from: Date; to: Date } },
  filter: ThreadFilter | null,
): Promise<DigestComparison> {
  const current = await digestFigures(tx, licenseId, period, filter);
  const previous = await digestFigures(tx, licenseId, period.previous, filter);
  return { current, previous };
}
