/**
 * The queue reports (RP-04 · tm 371): how many connections entered the routing
 * queue, how long they waited, how many were assigned and how many gave up.
 *
 * Everything is read from `queue_entries` (tm 291), the record that survives
 * the stay — `threads.queued_at` is cleared the moment a connection leaves the
 * queue. One row is one stay; a connection that waited twice counts twice.
 * `GET /reports/queue` and `GET /reports/queue-abandonment` and their two
 * export groups (`report-csv.ts`) read these helpers, one aggregation each for
 * the JSON and the CSV (the ADR-09 rule every report here keeps), so the screen
 * and the download quote the same number.
 *
 * Definitions (05 RP-04):
 *   - the window is when the stay began (`entered_at`);
 *   - **wait** is `left_at - entered_at`. The headline wait (average, 80th
 *     percentile, longest) is over the stays that ended in an assignment — the
 *     same sample the widget's estimate reads (WG-05, `queue-wait.ts`) — and
 *     the abandonment wait over the stays that ended in `abandoned`;
 *   - **abandoned** is a stay that ended `abandoned`: the player closed the chat
 *     while it waited or it closed for inactivity. Closing the widget window is
 *     not an event;
 *   - both rates are shares of the entries of the window, stays still waiting
 *     included, so the cards add up on screen: a rate is the card beside it
 *     over the entries card;
 *   - the team is the queue the stay waited for (`queue_entries.group_id`, the
 *     team queue of AU-01), not every team the chat is shared with — one team
 *     per stay, so the rows add up to the totals. A team deleted since keeps
 *     its row with no name; a stay with no team is `team_id: null`.
 *
 * The report filter (RP-01) narrows the stays through the connection they were
 * for (`threadFilterSql`); a team filter also holds the stay's own queue team,
 * so a Team Lead never reads another team's queue under a shared chat.
 *
 * Days and the heat map's weekday and hour are the workspace's time zone
 * (ID-04, `readDayBoundary`), never UTC: a shift is planned in local hours.
 */
import { Prisma } from '@prisma/client';
import {
  QUEUE_ABANDON_WAIT_BANDS,
  type DayBoundary,
  type QueueAbandonWaitBand,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { localDayKeySql, readDayBoundary } from '../chat/day-boundary.js';
import { threadFilterSql, type ThreadFilter } from './report-filter.js';

/** One stay's wait in seconds, over a `queue_entries` row aliased `q`. */
const WAIT = Prisma.sql`extract(epoch FROM q.left_at - q.entered_at)::float8`;

/** The stays of one window, licence-bound and filtered — every query's `WHERE`. */
function inWindow(
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null,
): Prisma.Sql {
  const team =
    filter?.groupIds === undefined
      ? Prisma.sql`TRUE`
      : Prisma.sql`q.group_id = ANY(${filter.groupIds.map(String)}::bigint[])`;
  return Prisma.sql`q.license_id = ${licenseId}
      AND q.entered_at >= ${from} AND q.entered_at <= ${to}
      AND ${team}
      AND ${threadFilterSql(filter)}`;
}

/** The stays and the connection they were for — every query's `FROM`. */
const FROM_STAYS = Prisma.sql`queue_entries q JOIN threads t ON t.id = q.thread_id`;

/** The figures of a set of stays — one row of every breakdown below. */
export interface QueueCounts {
  /** Stays that began in the set. */
  entries: number;
  assigned: number;
  abandoned: number;
  closed_by_agent: number;
  transferred: number;
  timeout: number;
  /** Stays with no end yet: still in the queue. */
  waiting: number;
  /** Mean wait, in whole seconds, of the stays that ended in an assignment; null when none did. */
  avg_wait_seconds: number | null;
  /** 80th-percentile wait of those same stays; null when none did. */
  p80_wait_seconds: number | null;
  /** Longest wait of those same stays; null when none did. */
  max_wait_seconds: number | null;
  /** Mean wait, in whole seconds, of the stays that ended in `abandoned`; null when none did. */
  abandon_avg_wait_seconds: number | null;
}

interface QueueCountRow {
  entries: bigint;
  assigned: bigint;
  abandoned: bigint;
  closed_by_agent: bigint;
  transferred: bigint;
  timeout: bigint;
  waiting: bigint;
  avg_wait: number | null;
  p80_wait: number | null;
  max_wait: number | null;
  abandon_avg_wait: number | null;
}

const QUEUE_COUNTS = Prisma.sql`
  count(*) AS entries,
  count(*) FILTER (WHERE q.outcome = 'assigned') AS assigned,
  count(*) FILTER (WHERE q.outcome = 'abandoned') AS abandoned,
  count(*) FILTER (WHERE q.outcome = 'closed_by_agent') AS closed_by_agent,
  count(*) FILTER (WHERE q.outcome = 'transferred') AS transferred,
  count(*) FILTER (WHERE q.outcome = 'timeout') AS timeout,
  count(*) FILTER (WHERE q.left_at IS NULL) AS waiting,
  avg(${WAIT}) FILTER (WHERE q.outcome = 'assigned') AS avg_wait,
  percentile_cont(0.8) WITHIN GROUP (ORDER BY ${WAIT}) FILTER (WHERE q.outcome = 'assigned') AS p80_wait,
  max(${WAIT}) FILTER (WHERE q.outcome = 'assigned') AS max_wait,
  avg(${WAIT}) FILTER (WHERE q.outcome = 'abandoned') AS abandon_avg_wait`;

const seconds = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(value);

function queueCounts(row: Partial<QueueCountRow> | undefined): QueueCounts {
  return {
    entries: Number(row?.entries ?? 0n),
    assigned: Number(row?.assigned ?? 0n),
    abandoned: Number(row?.abandoned ?? 0n),
    closed_by_agent: Number(row?.closed_by_agent ?? 0n),
    transferred: Number(row?.transferred ?? 0n),
    timeout: Number(row?.timeout ?? 0n),
    waiting: Number(row?.waiting ?? 0n),
    avg_wait_seconds: seconds(row?.avg_wait),
    p80_wait_seconds: seconds(row?.p80_wait),
    max_wait_seconds: seconds(row?.max_wait),
    abandon_avg_wait_seconds: seconds(row?.abandon_avg_wait),
  };
}

/** `part / whole`, 0..1 to four places; null when there is nothing to be a share of. */
function share(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 10_000 : null;
}

/** The window's headline: the counts and the two shares of the entries. */
export interface QueueTotals extends QueueCounts {
  /** `assigned / entries`; null when nothing entered. */
  assigned_rate: number | null;
  /** `abandoned / entries`; null when nothing entered. */
  abandonment_rate: number | null;
}

export async function queueTotals(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<QueueTotals> {
  const [row] = await tx.$queryRaw<QueueCountRow[]>`
    SELECT ${QUEUE_COUNTS}
    FROM ${FROM_STAYS}
    WHERE ${inWindow(licenseId, from, to, filter)}
  `;
  const counts = queueCounts(row);
  return {
    ...counts,
    assigned_rate: share(counts.assigned, counts.entries),
    abandonment_rate: share(counts.abandoned, counts.entries),
  };
}

/** Stays per local day of the workspace — sparse, oldest first. */
export async function queueByDay(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  boundary: DayBoundary,
  filter: ThreadFilter | null = null,
): Promise<Array<QueueCounts & { date: string }>> {
  const rows = await tx.$queryRaw<Array<QueueCountRow & { date: string }>>`
    SELECT ${localDayKeySql(Prisma.sql`q.entered_at`, boundary)} AS date,
      ${QUEUE_COUNTS}
    FROM ${FROM_STAYS}
    WHERE ${inWindow(licenseId, from, to, filter)}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((row) => ({ date: row.date, ...queueCounts(row) }));
}

/** One cell of the hour × weekday heat map. */
export interface QueueHeatCell extends QueueCounts {
  /** ISO weekday in the workspace's zone: 1 Monday … 7 Sunday. */
  weekday: number;
  /** Hour of day in the workspace's zone, 0–23, of when the stay began. */
  hour: number;
}

/**
 * Stays by the hour × weekday they began, in the workspace's zone (ID-04) —
 * when the queue fills, for shift planning. Dense: all 168 cells, Monday 00:00
 * first, zero-filled, because the axis is fixed whatever the data.
 */
export async function queueHeatmap(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  timezone: string,
  filter: ThreadFilter | null = null,
): Promise<QueueHeatCell[]> {
  const rows = await tx.$queryRaw<Array<QueueCountRow & { weekday: number; hour: number }>>`
    SELECT EXTRACT(ISODOW FROM q.entered_at AT TIME ZONE ${timezone})::int AS weekday,
      EXTRACT(HOUR FROM q.entered_at AT TIME ZONE ${timezone})::int AS hour,
      ${QUEUE_COUNTS}
    FROM ${FROM_STAYS}
    WHERE ${inWindow(licenseId, from, to, filter)}
    GROUP BY 1, 2
  `;
  const byCell = new Map(rows.map((row) => [`${row.weekday}:${row.hour}`, row]));
  const cells: QueueHeatCell[] = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      cells.push({ weekday, hour, ...queueCounts(byCell.get(`${weekday}:${hour}`)) });
    }
  }
  return cells;
}

/** The stays of one team's queue. */
export interface QueueTeamRow extends QueueCounts {
  /** The queue team (`queue_entries.group_id`); null: the stay waited for no team. */
  team_id: number | null;
  name: string | null;
  /** `assigned / entries` of this team's stays; null when none. */
  assigned_rate: number | null;
  /** `abandoned / entries` of this team's stays; null when none. */
  abandonment_rate: number | null;
}

/** Stays per team queue, busiest first. A team has its own averages — the rows are not pooled. */
export async function queueByTeam(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<QueueTeamRow[]> {
  const rows = await tx.$queryRaw<
    Array<QueueCountRow & { team_id: bigint | null; name: string | null }>
  >`
    SELECT q.group_id AS team_id, g.name AS name,
      ${QUEUE_COUNTS}
    FROM ${FROM_STAYS}
    LEFT JOIN groups g ON g.license_id = q.license_id AND g.id = q.group_id
    WHERE ${inWindow(licenseId, from, to, filter)}
    GROUP BY q.group_id, g.name
    ORDER BY entries DESC, name ASC NULLS LAST, team_id ASC NULLS LAST
  `;
  return rows.map((row) => {
    const counts = queueCounts(row);
    return {
      team_id: row.team_id === null ? null : Number(row.team_id),
      name: row.name,
      ...counts,
      assigned_rate: share(counts.assigned, counts.entries),
      abandonment_rate: share(counts.abandoned, counts.entries),
    };
  });
}

/** How many players gave up after waiting this long. */
export interface QueueWaitBandRow {
  key: QueueAbandonWaitBand;
  /** Inclusive lower bound, whole seconds. */
  from_seconds: number;
  /** Exclusive upper bound, whole seconds; null: no upper bound. */
  to_seconds: number | null;
  abandoned: number;
}

/**
 * The abandonments by how long the player had waited — all of
 * `QUEUE_ABANDON_WAIT_BANDS` in order, zeros included, so the distribution has
 * the same axis whatever the data. The bands partition `totals.abandoned`.
 */
export async function queueAbandonByWait(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<QueueWaitBandRow[]> {
  const [row] = await tx.$queryRaw<Array<Record<QueueAbandonWaitBand, bigint>>>`
    SELECT
      ${Prisma.join(
        QUEUE_ABANDON_WAIT_BANDS.map(
          (band) =>
            Prisma.sql`count(*) FILTER (WHERE ${WAIT} >= ${band.from}${
              band.to === null ? Prisma.empty : Prisma.sql` AND ${WAIT} < ${band.to}`
            }) AS ${Prisma.raw(`"${band.key}"`)}`,
        ),
      )}
    FROM ${FROM_STAYS}
    WHERE ${inWindow(licenseId, from, to, filter)} AND q.outcome = 'abandoned'
  `;
  return QUEUE_ABANDON_WAIT_BANDS.map((band) => ({
    key: band.key,
    from_seconds: band.from,
    to_seconds: band.to,
    abandoned: Number(row?.[band.key] ?? 0n),
  }));
}

/** The queue figures a baseline window is compared on — the headline, measured the same way. */
export async function queueBenchmark(
  tx: TenantClient,
  licenseId: bigint,
  window: { from: Date; to: Date },
  filter: ThreadFilter | null = null,
): Promise<Record<string, unknown>> {
  const totals = await queueTotals(tx, licenseId, window.from, window.to, filter);
  return {
    entries: totals.entries,
    assigned: totals.assigned,
    abandoned: totals.abandoned,
    avg_wait_seconds: totals.avg_wait_seconds,
    p80_wait_seconds: totals.p80_wait_seconds,
    assigned_rate: totals.assigned_rate,
    abandonment_rate: totals.abandonment_rate,
  };
}

/** Everything both queue reports and their exports show, read once. */
export interface QueueFigures {
  timezone: string;
  totals: QueueTotals;
  by_day: Array<QueueCounts & { date: string }>;
  heatmap: QueueHeatCell[];
  by_team: QueueTeamRow[];
}

/**
 * The queue figures for one window. Sequential, not `Promise.all` — `tx` is one
 * connection inside an interactive transaction.
 */
export async function queueFigures(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<QueueFigures> {
  const boundary = await readDayBoundary(tx);
  const { timezone } = boundary;
  const totals = await queueTotals(tx, licenseId, from, to, filter);
  const byDay = await queueByDay(tx, licenseId, from, to, boundary, filter);
  const heatmap = await queueHeatmap(tx, licenseId, from, to, timezone, filter);
  const byTeam = await queueByTeam(tx, licenseId, from, to, filter);
  return { timezone, totals, by_day: byDay, heatmap, by_team: byTeam };
}

/** The abandonment report adds the wait distribution to the same figures. */
export interface QueueAbandonmentFigures extends QueueFigures {
  by_wait: QueueWaitBandRow[];
}

export async function queueAbandonmentFigures(
  tx: TenantClient,
  licenseId: bigint,
  from: Date,
  to: Date,
  filter: ThreadFilter | null = null,
): Promise<QueueAbandonmentFigures> {
  const figures = await queueFigures(tx, licenseId, from, to, filter);
  const byWait = await queueAbandonByWait(tx, licenseId, from, to, filter);
  return { ...figures, by_wait: byWait };
}

type CsvTable = { headers: string[]; rows: Array<Array<string | number | null>> };

/** The `1T09` key of a heat-map cell: ISO weekday, then the local hour. */
const cellKey = (cell: QueueHeatCell) => `${cell.weekday}T${String(cell.hour).padStart(2, '0')}`;

/**
 * The `queue` export: one long-format table, `dimension` naming the axis. The
 * figures are the report's (`GET /reports/queue`), cell for cell.
 */
export function queueCsvTable(figures: QueueFigures): CsvTable {
  const cells = (row: QueueCounts & Partial<Pick<QueueTotals, 'assigned_rate'>>) => [
    row.entries,
    row.assigned,
    row.abandoned,
    row.waiting,
    row.avg_wait_seconds,
    row.p80_wait_seconds,
    row.max_wait_seconds,
  ];
  const t = figures.totals;
  return {
    headers: [
      'dimension',
      'key',
      'name',
      'entries',
      'assigned',
      'abandoned',
      'waiting',
      'avg_wait_seconds',
      'p80_wait_seconds',
      'max_wait_seconds',
    ],
    rows: [
      ['total', 'all', null, ...cells(t)],
      ...figures.by_day.map((row) => ['day', row.date, null, ...cells(row)]),
      // Only the hours something entered in — the screen shows the empty ones as empty.
      ...figures.heatmap
        .filter((cell) => cell.entries > 0)
        .map((cell) => ['hour_of_week', cellKey(cell), null, ...cells(cell)]),
      ...figures.by_team.map((row) => [
        'team',
        row.team_id === null ? 'none' : String(row.team_id),
        row.name,
        ...cells(row),
      ]),
    ],
  };
}

/** The `queue-abandonment` export, the same shape over the abandonment figures. */
export function queueAbandonmentCsvTable(figures: QueueAbandonmentFigures): CsvTable {
  const cells = (row: QueueCounts) => [
    row.entries,
    row.abandoned,
    share(row.abandoned, row.entries),
    row.abandon_avg_wait_seconds,
  ];
  return {
    headers: [
      'dimension',
      'key',
      'name',
      'entries',
      'abandoned',
      'abandonment_rate',
      'abandon_avg_wait_seconds',
    ],
    rows: [
      ['total', 'all', null, ...cells(figures.totals)],
      ...figures.by_wait.map((band) => ['wait', band.key, null, null, band.abandoned, null, null]),
      ...figures.by_day.map((row) => ['day', row.date, null, ...cells(row)]),
      ...figures.heatmap
        .filter((cell) => cell.abandoned > 0)
        .map((cell) => ['hour_of_week', cellKey(cell), null, ...cells(cell)]),
      ...figures.by_team.map((row) => [
        'team',
        row.team_id === null ? 'none' : String(row.team_id),
        row.name,
        ...cells(row),
      ]),
    ],
  };
}
