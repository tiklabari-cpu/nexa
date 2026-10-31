/**
 * Missed conversations and who started them (RP-02 · tm 369.1).
 *
 * Two halves, one module, so the rule that writes a missed reason and the
 * queries that count it sit side by side:
 *
 *   - **the close** — {@link recordMissedReason}, called by
 *     `ChatService.#closeConversation` in the transaction that closes the
 *     connection, writes `threads.missed_reason` once (05 RP-02 "değer
 *     kapanışta bir kez yazılır"). The reports read the column and never
 *     recompute it, so a figure cannot shift when the transcript later changes;
 *   - **the reports** — `GET /reports/missed` and `GET /reports/engagement`
 *     and their export groups (`report-csv.ts`) read these helpers, one
 *     aggregation each for the JSON and the CSV (the ADR-09 rule every report
 *     here keeps).
 *
 * Connections are windowed by `created_at`, like every conversation report, and
 * take the report filter (RP-01, `threadFilterSql`). Days and the heat map's
 * weekday and hour are the workspace's time zone (ID-04, `readDayBoundary`),
 * never UTC: a shift is planned in local hours.
 *
 * Names follow the identity glossary (ID-01, K1 = A): a row is one connection
 * (nexa thread, "Chat ID" in the panel).
 */
import { Prisma } from '@prisma/client';
import {
  ENGAGEMENT_INITIATORS,
  type EngagementInitiator,
  type MissedReason,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { BOT_WROTE, HANDED_OFF } from '../billing/ai-resolution.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import { threadFilterSql, type ThreadFilter } from './report-filter.js';

// ===========================================================================
// The close
// ===========================================================================

/**
 * Was the connection missed, over a `threads` row aliased `t`? 05 RP-02
 * decision 1: it needed a person (`needs_human_since`) and no agent ever
 * answered the player (`first_response_at`, which only an agent's public
 * message sets). Not a connection the AI kept: a bot that answered and never
 * handed over handled it ("AI ile başlayıp AI ile kapanan kaçan sayılmaz") —
 * which covers the `parallel` AI mode too, where an agent is assigned on open
 * while the AI answers.
 */
export const MISSED_SQL = Prisma.sql`(
  t.needs_human_since IS NOT NULL
  AND t.first_response_at IS NULL
  AND (${HANDED_OFF} OR NOT ${BOT_WROTE})
)`;

/**
 * Why a missed connection was missed, over a `threads` row aliased `t` as it
 * closes (see `MISSED_REASONS`): a hand-over from the AI or a rule bot first —
 * "devir sonrası kaçan" whoever held it after — then an assignee who never
 * wrote, else a wait nobody took. `assignee_id` is the close's own: the close
 * leaves it as it was, so it is who held the connection when it ended.
 */
export const MISSED_REASON_SQL = Prisma.sql`(CASE
  WHEN ${HANDED_OFF} THEN 'unanswered_after_ai'
  WHEN t.assignee_id IS NOT NULL THEN 'unanswered_assigned'
  ELSE 'queue_abandoned'
END)`;

/**
 * Write `missed_reason` on a connection that has just closed, in the
 * transaction that closes it (after `active`/`closed_at` and the last event),
 * and return it — null when it was not missed. Once: a row that already
 * carries a reason is left alone, so a replayed close cannot rewrite it.
 */
export async function recordMissedReason(
  tx: TenantClient,
  threadId: string,
): Promise<MissedReason | null> {
  const rows = await tx.$queryRaw<Array<{ missed_reason: MissedReason }>>`
    UPDATE threads t SET missed_reason = ${MISSED_REASON_SQL}
    WHERE t.id = ${threadId} AND NOT t.active AND t.missed_reason IS NULL AND ${MISSED_SQL}
    RETURNING t.missed_reason
  `;
  return rows[0]?.missed_reason ?? null;
}

/**
 * Stamp the moment a connection came to need a person, if nothing has yet —
 * the AI's hand-over (AI-11: in "önce AI" the wait starts at the hand-over).
 * The queue and the assignee are stamped by the trigger
 * `threads_needs_human_since`; this covers a hand-over that routed nobody.
 */
export async function markNeedsHuman(tx: TenantClient, threadId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE threads SET needs_human_since = now()
    WHERE id = ${threadId} AND active AND needs_human_since IS NULL
  `;
}

// ===========================================================================
// The missed-conversations report
// ===========================================================================

/** Missed connections by reason — one row of every breakdown below. */
export interface MissedCounts {
  missed: number;
  queue_abandoned: number;
  unanswered_assigned: number;
  unanswered_after_ai: number;
}

interface MissedCountRow {
  missed: bigint;
  queue_abandoned: bigint;
  unanswered_assigned: bigint;
  unanswered_after_ai: bigint;
}

const MISSED_COUNTS = Prisma.sql`
  count(*) FILTER (WHERE t.missed_reason IS NOT NULL) AS missed,
  count(*) FILTER (WHERE t.missed_reason = 'queue_abandoned') AS queue_abandoned,
  count(*) FILTER (WHERE t.missed_reason = 'unanswered_assigned') AS unanswered_assigned,
  count(*) FILTER (WHERE t.missed_reason = 'unanswered_after_ai') AS unanswered_after_ai`;

function missedCounts(row: Partial<MissedCountRow> | undefined): MissedCounts {
  return {
    missed: Number(row?.missed ?? 0n),
    queue_abandoned: Number(row?.queue_abandoned ?? 0n),
    unanswered_assigned: Number(row?.unanswered_assigned ?? 0n),
    unanswered_after_ai: Number(row?.unanswered_after_ai ?? 0n),
  };
}

/** The connections of one window, licence-bound and filtered — every query's `WHERE`. */
function inWindow(
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null,
): Prisma.Sql {
  return Prisma.sql`t.license_id = ${licenseId}
      AND t.created_at >= ${from} AND t.created_at <= ${to}
      AND ${threadFilterSql(filter)}`;
}

/** The window's headline: closed connections, the missed ones by reason, and the estimates among them. */
export interface MissedTotals extends MissedCounts {
  /** Closed connections created in the window — what `missed` is a share of. */
  closed: number;
  /** `missed / closed`, 0..1 rounded to four places; null when nothing closed. */
  missed_rate: number | null;
  /**
   * Missed connections whose reason the backfill inferred (no
   * `needs_human_since`): the part of `missed` that is an estimate, not a
   * recorded value — the report's "kesin değil" note. 0 for any window that
   * starts after the fields were written.
   */
  estimated: number;
}

export async function missedTotals(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<MissedTotals> {
  const [row] = await tx.$queryRaw<Array<MissedCountRow & { closed: bigint; estimated: bigint }>>`
    SELECT count(*) FILTER (WHERE NOT t.active) AS closed,
      count(*) FILTER (WHERE t.missed_reason IS NOT NULL AND t.needs_human_since IS NULL) AS estimated,
      ${MISSED_COUNTS}
    FROM threads t
    WHERE ${inWindow(licenseId, from, to, filter)}
  `;
  const counts = missedCounts(row);
  const closed = Number(row?.closed ?? 0n);
  return {
    closed,
    ...counts,
    missed_rate: closed > 0 ? Math.round((counts.missed / closed) * 10_000) / 10_000 : null,
    estimated: Number(row?.estimated ?? 0n),
  };
}

/** Missed connections per local day of the workspace — sparse, oldest first. */
export async function missedByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  timezone: string,
  filter: ThreadFilter | null = null,
): Promise<Array<MissedCounts & { date: string }>> {
  const rows = await tx.$queryRaw<Array<MissedCountRow & { date: string }>>`
    SELECT to_char((t.created_at AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS date,
      ${MISSED_COUNTS}
    FROM threads t
    WHERE ${inWindow(licenseId, from, to, filter)} AND t.missed_reason IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({ date: row.date, ...missedCounts(row) }));
}

/** One cell of the hour × weekday heat map. */
export interface MissedHeatCell extends MissedCounts {
  /** ISO weekday in the workspace's zone: 1 Monday … 7 Sunday. */
  weekday: number;
  /** Hour of day in the workspace's zone, 0–23. */
  hour: number;
}

/**
 * Missed connections by hour × weekday, in the workspace's zone (ID-04) — when
 * players are lost, for shift planning. Dense: all 168 cells, Monday 00:00
 * first, zero-filled, because the axis is fixed whatever the data.
 */
export async function missedHeatmap(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  timezone: string,
  filter: ThreadFilter | null = null,
): Promise<MissedHeatCell[]> {
  const rows = await tx.$queryRaw<Array<MissedCountRow & { weekday: number; hour: number }>>`
    SELECT EXTRACT(ISODOW FROM t.created_at AT TIME ZONE ${timezone})::int AS weekday,
      EXTRACT(HOUR FROM t.created_at AT TIME ZONE ${timezone})::int AS hour,
      ${MISSED_COUNTS}
    FROM threads t
    WHERE ${inWindow(licenseId, from, to, filter)} AND t.missed_reason IS NOT NULL
    GROUP BY 1, 2
  `;
  const byCell = new Map(rows.map((row) => [`${row.weekday}:${row.hour}`, row]));
  const cells: MissedHeatCell[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ weekday, hour, ...missedCounts(byCell.get(`${weekday}:${hour}`)) });
    }
  }
  return cells;
}

/** Missed connections by the team that had them. */
export interface MissedTeamRow extends MissedCounts {
  /** `threads.group_id` — routing's team, or the one a transfer gave it; null: no team. */
  team_id: number | null;
  name: string | null;
}

/**
 * Missed connections per team. The team is the connection's own
 * (`threads.group_id`, ID-02: the team routing chose or a transfer handed it
 * to), not every team the chat is shared with — one team per connection, so
 * the rows add up to `totals.missed` without the Breakdown's fan-out. A team
 * deleted since keeps its row with no name. Most missed first.
 */
export async function missedByTeam(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<MissedTeamRow[]> {
  const rows = await tx.$queryRaw<
    Array<MissedCountRow & { team_id: bigint | null; name: string | null }>
  >`
    SELECT t.group_id AS team_id, g.name AS name,
      ${MISSED_COUNTS}
    FROM threads t
    LEFT JOIN groups g ON g.license_id = t.license_id AND g.id = t.group_id
    WHERE ${inWindow(licenseId, from, to, filter)} AND t.missed_reason IS NOT NULL
    GROUP BY t.group_id, g.name
    ORDER BY missed DESC, name ASC NULLS LAST
  `;
  return rows.map((row) => ({
    team_id: row.team_id === null ? null : Number(row.team_id),
    name: row.name,
    ...missedCounts(row),
  }));
}

/** Missed connections by the agent who held them. */
export interface MissedAgentRow extends MissedCounts {
  agent_id: string;
  name: string | null;
}

/**
 * Missed connections per agent who held them at the close — so a queue
 * abandonment, held by nobody, appears in no row. Most missed first, capped at
 * 20 like the other per-agent tables.
 */
export async function missedByAgent(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<MissedAgentRow[]> {
  const rows = await tx.$queryRaw<
    Array<MissedCountRow & { agent_id: string; name: string | null }>
  >`
    SELECT t.assignee_id::text AS agent_id, a.name AS name,
      ${MISSED_COUNTS}
    FROM threads t
    LEFT JOIN accounts a ON a.id = t.assignee_id
    WHERE ${inWindow(licenseId, from, to, filter)}
      AND t.missed_reason IS NOT NULL AND t.assignee_id IS NOT NULL
    GROUP BY t.assignee_id, a.name
    ORDER BY missed DESC, name ASC NULLS LAST, agent_id ASC
    LIMIT 20
  `;
  return rows.map((row) => ({ agent_id: row.agent_id, name: row.name, ...missedCounts(row) }));
}

/** The missed figures a baseline window is compared on — the headline, measured the same way. */
export async function missedBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
  filter: ThreadFilter | null = null,
): Promise<Record<string, unknown>> {
  const totals = await missedTotals(tx, licenseId, window.from, window.to, filter);
  return {
    closed: totals.closed,
    missed: totals.missed,
    queue_abandoned: totals.queue_abandoned,
    unanswered_assigned: totals.unanswered_assigned,
    unanswered_after_ai: totals.unanswered_after_ai,
  };
}

/** Everything the missed report and its export show, read once. */
export interface MissedFigures {
  timezone: string;
  totals: MissedTotals;
  by_day: Array<MissedCounts & { date: string }>;
  heatmap: MissedHeatCell[];
  by_team: MissedTeamRow[];
  by_agent: MissedAgentRow[];
}

/**
 * The missed report's figures for one window. Sequential, not `Promise.all` —
 * `tx` is one connection inside an interactive transaction.
 */
export async function missedFigures(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<MissedFigures> {
  const { timezone } = await readDayBoundary(tx);
  const totals = await missedTotals(tx, licenseId, from, to, filter);
  const byDay = await missedByDay(tx, licenseId, from, to, timezone, filter);
  const heatmap = await missedHeatmap(tx, licenseId, from, to, timezone, filter);
  const byTeam = await missedByTeam(tx, licenseId, from, to, filter);
  const byAgent = await missedByAgent(tx, licenseId, from, to, filter);
  return { timezone, totals, by_day: byDay, heatmap, by_team: byTeam, by_agent: byAgent };
}

/** The `missed` export: one long-format table, `dimension` naming the axis. */
export function missedCsvTable(figures: MissedFigures): {
  headers: string[];
  rows: Array<Array<string | number | null>>;
} {
  const counts = (row: MissedCounts) => [
    row.missed,
    row.queue_abandoned,
    row.unanswered_assigned,
    row.unanswered_after_ai,
  ];
  const t = figures.totals;
  return {
    headers: [
      'dimension',
      'key',
      'name',
      'missed',
      'queue_abandoned',
      'unanswered_assigned',
      'unanswered_after_ai',
    ],
    rows: [
      ['total', 'all', null, ...counts(t)],
      // The estimate and the denominator, as the screen's note and rate show them.
      ['total', 'estimated', null, t.estimated, null, null, null],
      ['total', 'closed', null, t.closed, null, null, null],
      ...figures.by_day.map((row) => ['day', row.date, null, ...counts(row)]),
      // `1T09` — ISO weekday, then the local hour; only the cells with a miss.
      ...figures.heatmap
        .filter((cell) => cell.missed > 0)
        .map((cell) => [
          'hour_of_week',
          `${cell.weekday}T${String(cell.hour).padStart(2, '0')}`,
          null,
          ...counts(cell),
        ]),
      ...figures.by_team.map((row) => [
        'team',
        row.team_id === null ? 'none' : String(row.team_id),
        row.name,
        ...counts(row),
      ]),
      ...figures.by_agent.map((row) => ['agent', row.agent_id, row.name, ...counts(row)]),
    ],
  };
}

// ===========================================================================
// The engagement report — who started the conversations
// ===========================================================================

/** One opener's connections in the window. */
export interface EngagementRow {
  initiated_by: EngagementInitiator;
  chats: number;
  closed: number;
  /** Connections an agent answered (`first_response_at` set). */
  answered: number;
  missed: number;
}

interface EngagementCountRow {
  initiated_by: string | null;
  chats: bigint;
  closed: bigint;
  answered: bigint;
  missed: bigint;
}

const ENGAGEMENT_COUNTS = Prisma.sql`
  count(*) AS chats,
  count(*) FILTER (WHERE NOT t.active) AS closed,
  count(*) FILTER (WHERE t.first_response_at IS NOT NULL) AS answered,
  count(*) FILTER (WHERE t.missed_reason IS NOT NULL) AS missed`;

/** A stored opener as its report bucket: NULL — and anything unlisted — is `unknown`. */
function initiatorBucket(value: string | null): EngagementInitiator {
  return (ENGAGEMENT_INITIATORS as readonly string[]).includes(value ?? '')
    ? (value as EngagementInitiator)
    : 'unknown';
}

function engagementRows(rows: EngagementCountRow[]): EngagementRow[] {
  const byInitiator = new Map<EngagementInitiator, EngagementRow>(
    ENGAGEMENT_INITIATORS.map((initiated_by) => [
      initiated_by,
      { initiated_by, chats: 0, closed: 0, answered: 0, missed: 0 },
    ]),
  );
  for (const row of rows) {
    const acc = byInitiator.get(initiatorBucket(row.initiated_by))!;
    acc.chats += Number(row.chats);
    acc.closed += Number(row.closed);
    acc.answered += Number(row.answered);
    acc.missed += Number(row.missed);
  }
  return ENGAGEMENT_INITIATORS.map((initiated_by) => byInitiator.get(initiated_by)!);
}

/**
 * The window's connections per opener — dense: every `ENGAGEMENT_INITIATORS`
 * row in that order, zeros included, so a campaign's row is there to read even
 * in a window it started nothing (RP-02 KK: "kampanyadan başlayanlar ayrı
 * satırda"). The rows partition the window: `SUM(chats)` is its total.
 */
export async function engagementByInitiator(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<EngagementRow[]> {
  const rows = await tx.$queryRaw<EngagementCountRow[]>`
    SELECT t.initiated_by, ${ENGAGEMENT_COUNTS}
    FROM threads t
    WHERE ${inWindow(licenseId, from, to, filter)}
    GROUP BY t.initiated_by
  `;
  return engagementRows(rows);
}

/** Connections per local day and opener — sparse, oldest day first, openers in list order. */
export async function engagementByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  timezone: string,
  filter: ThreadFilter | null = null,
): Promise<Array<EngagementRow & { date: string }>> {
  const rows = await tx.$queryRaw<Array<EngagementCountRow & { date: string }>>`
    SELECT to_char((t.created_at AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS date,
      t.initiated_by, ${ENGAGEMENT_COUNTS}
    FROM threads t
    WHERE ${inWindow(licenseId, from, to, filter)}
    GROUP BY 1, 2
    ORDER BY 1
  `;
  const byDate = new Map<string, EngagementCountRow[]>();
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  const out: Array<EngagementRow & { date: string }> = [];
  for (const [date, dayRows] of byDate) {
    for (const row of engagementRows(dayRows)) if (row.chats > 0) out.push({ date, ...row });
  }
  return out;
}

/** The engagement figures a baseline window is compared on: connections per opener. */
export async function engagementBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
  filter: ThreadFilter | null = null,
): Promise<Record<string, unknown>> {
  const rows = await engagementByInitiator(tx, licenseId, window.from, window.to, filter);
  return {
    chats: rows.reduce((total, row) => total + row.chats, 0),
    ...Object.fromEntries(rows.map((row) => [row.initiated_by, row.chats])),
  };
}

/** Everything the engagement report and its export show, read once. */
export interface EngagementFigures {
  timezone: string;
  totals: { chats: number };
  by_initiator: EngagementRow[];
  by_day: Array<EngagementRow & { date: string }>;
}

export async function engagementFigures(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<EngagementFigures> {
  const { timezone } = await readDayBoundary(tx);
  const byInitiator = await engagementByInitiator(tx, licenseId, from, to, filter);
  const byDay = await engagementByDay(tx, licenseId, from, to, timezone, filter);
  return {
    timezone,
    totals: { chats: byInitiator.reduce((total, row) => total + row.chats, 0) },
    by_initiator: byInitiator,
    by_day: byDay,
  };
}

/** The `engagement` export: the openers, then the same per local day. */
export function engagementCsvTable(figures: EngagementFigures): {
  headers: string[];
  rows: Array<Array<string | number | null>>;
} {
  const cells = (row: EngagementRow) => [
    row.initiated_by,
    row.chats,
    row.closed,
    row.answered,
    row.missed,
  ];
  return {
    headers: ['dimension', 'key', 'initiated_by', 'chats', 'closed', 'answered', 'missed'],
    rows: [
      ...figures.by_initiator.map((row) => ['total', 'all', ...cells(row)]),
      ...figures.by_day.map((row) => ['day', row.date, ...cells(row)]),
    ],
  };
}
