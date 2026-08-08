/**
 * Report data queries + CSV export (FR-MOD-07.7, extracted for 07.9-sched-e).
 *
 * `buildGroupCsv` used to live in `routes/reports.ts`, reachable only by
 * importing a route file. The scheduled-report worker (07.9-sched-e) needs to
 * produce the same CSV a caller downloads from `/reports/export`, and a
 * background service importing from `routes/` would run the dependency
 * direction backwards — services do not depend on routes. Moving the
 * generator here, together with every query it and the JSON reports both
 * read from, fixes the direction without changing a single query:
 * `routes/reports.ts` now imports these back for its four `GET` report
 * routes, exactly as it did when they were local functions.
 *
 * Every data helper below is called twice — once by a `GET /reports/*` route
 * assembling its JSON body, once by `buildGroupCsv` assembling the matching
 * CSV row — which is ADR-09 for this feature: a figure computed once can
 * never disagree with itself, whether it reaches the caller as JSON or CSV.
 */
import { Prisma } from '@prisma/client';
import {
  clusterTopics,
  embed,
  similarity,
  TOPIC_MIN_CONVERSATIONS,
  TOPIC_SIMILARITY_THRESHOLD,
  type TopicDoc,
} from '@nexa/ai-mock';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import {
  benchmarkWindow,
  channelLabel,
  DEFAULT_BENCHMARK_BASELINE,
  resolutionRate,
  round,
  type BenchmarkBaseline,
} from '../../routes/reports-metrics.js';
import { type CsvCell } from '../../routes/reports-export.js';

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
export const SPLIT_COUNTS = Prisma.sql`
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
export async function windowTotals(
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
export function ticketCount(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
): Promise<number> {
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
export async function casesByDay(
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
export async function casesByStatus(
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
export async function casesByPriority(
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
export async function leadsByDay(
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
export async function leadTotals(
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
export async function satisfactionCounts(
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
export function satisfactionScore(counts: { good: number; bad: number }): number | null {
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
export function csatSummary(counts: { good: number; bad: number }): CsatSummary {
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
export async function satisfactionByDay(
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
export async function breakdownByDay(
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
export async function breakdownByHour(
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
export async function breakdownByChannel(
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
export async function breakdownByTeam(
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
export async function transferCount(
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
export async function teamPerformanceByAgent(
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
  const transfersByAgent = new Map(
    transferRows.map((row) => [row.agent_id, Number(row.transfers)]),
  );

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
export async function buildTopicsReport(
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
      ...(await benchmarkCsvRows(tx, licenseId, groupId, from, to, baseline, table.headers.length)),
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
        split: {
          chats: number;
          closed: number;
          manual: number;
          assisted: number;
          automated: number;
        },
      ): CsvCell[] => [
        key,
        split.chats,
        split.closed,
        split.manual,
        split.assisted,
        split.automated,
      ];
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

// ===========================================================================
// Benchmark comparisons — the baseline-window figure each report builder in
// routes/reports.ts passes to withBenchmark, and groupBenchmark (above) uses
// for the same group's CSV. Grouped here, after the report group is a
// benchmark before it is a query, so both sides of the group-to-comparison
// mapping in groupBenchmark are defined in this file, not split across two.
// ===========================================================================

/**
 * The Overview's comparable figures for a baseline window — the headline counts
 * every KPI card can show a delta against. Three license-scoped queries, the
 * same ones the requested window uses, so the baseline is measured exactly as
 * the figure it is compared with.
 */
export async function overviewBenchmark(
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
export async function splitBenchmark(
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
 * The AI Agent report's comparable figures for a baseline window — the three
 * counters the tab shows deltas on, plus the rate they are read against, from
 * the same license-scoped helpers the requested window uses.
 */
export async function aiAgentBenchmark(
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

/** The Reviews report's comparable figures: the baseline window's CSAT tally. */
export async function reviewsBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  return { ...csatSummary(await satisfactionCounts(tx, licenseId, window.from, window.to)) };
}

/**
 * The Cases report's comparable figures: the baseline window's ticket counts,
 * summed from {@link casesByDay} rather than from `ticketCount`. The day split
 * already excludes merged tickets, and a benchmark counted a different way than
 * the series it sits next to would be a number nobody could reconcile.
 */
export async function casesBenchmark(
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
 * The Leads report's comparable figure. It goes through {@link leadTotals} — and
 * so through {@link leadFirstTouch} — exactly as the window's own count does,
 * which is what keeps the benchmark inside this license: a lead is counted only
 * where it actually touched this license, in the baseline window as in the
 * requested one.
 */
export async function leadsBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
): Promise<Record<string, unknown>> {
  return { ...(await leadTotals(tx, licenseId, window.from, window.to)) };
}

/**
 * The Sales report's baseline figures — `null`, like the report's own. With no
 * sales source there is nothing to have been better or worse than; emitting
 * zeros would let a surface render a "0 → 0, no change" badge that reads as a
 * measurement.
 */
export function salesBenchmark(): Record<string, unknown> {
  return {
    configured: false,
    tracked_sales: null,
    attributed_revenue_cents: null,
    currency: null,
    conversions: null,
  };
}

export function roundOrNull(value: number | null | undefined): number | null {
  return value == null ? null : Math.round(value);
}
