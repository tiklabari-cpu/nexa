/**
 * The archive's filters (AR-02 · tm 336.1): what `GET /archive/conversations`
 * narrows by, compiled to conditions over `threads t` / `chats c`.
 *
 * Each filter is one condition, appended to the list's own `where` — the same
 * array the page and `total` read (`archive-service.ts`), so nothing is
 * filtered after the page is cut and the count counts what is listed.
 * Different filters AND together; the values of one filter OR (`agent_id=a&
 * agent_id=b` is "a or b"); tags combine as `tag_mode` says. Filters that
 * cannot both hold are applied as asked: the screen warns, the API does not
 * silently drop one (the LiveChat mistake AR-02 names).
 *
 * ## Dates are the workspace's days
 *
 * `date_from`/`date_to` are conversation days on the workspace's own calendar
 * — its zone and the hour its day starts (ID-04) — turned into instants by
 * {@link localDayStart}, the inverse of the `localDayKey` that files
 * conversations, so "yesterday" is the day the inbox filed them under, and a
 * player writing at 23:30 Istanbul time is on that day, not the next UTC one.
 * The range is by when a connection started (AR-02-S1), the order
 * `threads_license_id_created_at_id_idx` reads, and the window the AI report
 * counts — so `handled_by=ai` over a range is that report's `resolutions`.
 *
 * ## Denormalised where the probe would be per row
 *
 * The agent and risk filters read arrays on the thread (`agent_ids`,
 * `risk_flags`) rather than `events` / `risk_flags` per candidate. Not
 * GIN-indexed: `&&` is not leakproof, so under row level security it is a
 * filter on the rows the date and team conditions narrow to, never an index
 * condition (PLAN §D350). The agent list is written once as the thread closes
 * ({@link agentIdsSql}); an open connection has none yet and is read live,
 * which costs a probe only for the open rows `status=open|all` brings in.
 * Tags, the rating and the channel are probes on narrow indexes —
 * `thread_tags (thread_id, tag_id)`, `ratings (license_id, thread_id,
 * created_at DESC)`, `channel_messages (license_id, chat_id)`.
 */
import { Prisma } from '@prisma/client';
import {
  localDayStart,
  shiftDayKey,
  type AdapterChannelType,
  type ArchiveRatingFilter,
  type ArchiveStatus,
  type ArchiveTagMode,
  type DayBoundary,
  type RiskFlagType,
  type ThreadHandledBy,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';

/** What the list is narrowed by, as the route parsed it. Every field optional. */
export interface ArchiveFilters {
  /** Conversation days, `YYYY-MM-DD`, on the workspace's calendar; both included. */
  dateFrom?: string;
  dateTo?: string;
  /** Exact instants: started at or after `from`, before `to`. */
  from?: Date;
  to?: Date;
  agentIds?: string[];
  groupIds?: bigint[];
  rating?: ArchiveRatingFilter;
  tags?: string[];
  tagMode?: ArchiveTagMode;
  untagged?: boolean;
  handledBy?: ThreadHandledBy[];
  riskFlags?: RiskFlagType[];
  channel?: AdapterChannelType;
}

/** The instants a connection's start must fall in: `[from, to)`, either end open. */
export interface StartedRange {
  from?: Date;
  to?: Date;
}

/**
 * The start-time window the filters ask for. Days are turned into instants on
 * the workspace's calendar (`boundary`); exact instants are taken as given.
 * The two forms do not mix, and a range that ends before it begins is a 400 —
 * an empty list would read as "nothing happened" rather than "you swapped
 * the dates".
 */
export function startedRange(filters: ArchiveFilters, boundary: DayBoundary): StartedRange {
  const days = filters.dateFrom !== undefined || filters.dateTo !== undefined;
  const instants = filters.from !== undefined || filters.to !== undefined;
  if (days && instants) {
    throw ApiError.validation('date_from/date_to and from/to are two forms of one filter.', {
      reason: 'date_mixed',
    });
  }
  const range: StartedRange = days
    ? {
        ...(filters.dateFrom !== undefined
          ? { from: localDayStart(filters.dateFrom, boundary.timezone, boundary.hour) }
          : {}),
        ...(filters.dateTo !== undefined
          ? {
              to: localDayStart(shiftDayKey(filters.dateTo, 1), boundary.timezone, boundary.hour),
            }
          : {}),
      }
    : {
        ...(filters.from !== undefined ? { from: filters.from } : {}),
        ...(filters.to !== undefined ? { to: filters.to } : {}),
      };
  if (range.from && range.to && range.from >= range.to) {
    throw ApiError.validation('The range ends before it begins.', { reason: 'range_order' });
  }
  return range;
}

/** Whether any filter needs the workspace's day boundary to be read. */
export function needsDayBoundary(filters: ArchiveFilters): boolean {
  return filters.dateFrom !== undefined || filters.dateTo !== undefined;
}

/** How far before a connection's start its events are looked for (`OPEN_SLACK`'s reason). */
const OPEN_SLACK = Prisma.sql`interval '1 minute'`;

/** How far a close may be stamped before its own start, by clocks that disagree. */
const CLOSE_SLACK = Prisma.sql`interval '1 minute'`;

/**
 * An agent wrote to the player: an agent-authored event every participant
 * sees. An internal note (`recipients = 'agents'`) is not writing to the
 * player. `author_id` is free text on `events`; only a well-formed uuid is
 * cast, so no row can make the close fail.
 */
const AGENT_TO_PLAYER = Prisma.sql`e.author_type = 'agent' AND e.recipients = 'all'
  AND e.author_id ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'`;

/**
 * The agents who wrote to the player in a thread aliased `t`, sorted — what
 * `threads.agent_ids` holds. The backfill (20261023180100) spells the same
 * expression out; `archive-backfill.test.ts` holds the two together.
 */
export function agentIdsSql(): Prisma.Sql {
  return Prisma.sql`ARRAY(
    SELECT DISTINCT e.author_id::uuid FROM events e
     WHERE e.thread_id = t.id AND ${AGENT_TO_PLAYER}
     ORDER BY 1
  )`;
}

/**
 * Write `agent_ids` on a thread that has just closed, in the transaction that
 * closes it — beside `handled_by` (`recordHandledBy`), after the last event.
 */
export async function recordAgentIds(tx: TenantClient, threadId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE threads t SET agent_ids = ${agentIdsSql()}
    WHERE t.id = ${threadId} AND NOT t.active`;
}

/**
 * The conditions the filters add, over `threads t` / `chats c` of workspace
 * `licenseId`. Empty when nothing is asked; `range` is {@link startedRange}'s.
 */
export function filterSql(
  licenseId: bigint,
  filters: ArchiveFilters,
  range: StartedRange,
  status: ArchiveStatus = 'closed',
  /** Where the caller may see a rating (`ratingReachSql` over `t`); everywhere by default. */
  ratingReach: Prisma.Sql = Prisma.sql`TRUE`,
): Prisma.Sql[] {
  const where: Prisma.Sql[] = [];

  if (range.from) where.push(Prisma.sql`t.created_at >= ${range.from}`);
  if (range.to) where.push(Prisma.sql`t.created_at < ${range.to}`);
  if (range.from && status === 'closed') {
    // Implied, and stated for the planner: a connection that started in the
    // range closed after it began. As an index condition on `closed_at` it
    // lets the list's own order (`threads_license_id_closed_at_id_idx`) stop
    // at the range instead of the start-time index reading the whole range
    // and sorting it — measured at a million connections, a Team Member's
    // last week went from ~310 ms to ~120 ms (HANDOFF tm 336.1). A minute of slack
    // for a close stamped by a clock a little behind the database's.
    where.push(Prisma.sql`t.closed_at >= ${range.from}::timestamptz - ${CLOSE_SLACK}`);
  }

  if (filters.agentIds?.length) {
    const agents = filters.agentIds.map((id) => id.toLowerCase());
    // Closed: the list written at close. Open: nobody wrote it yet — ask the
    // events, bounded below by the connection's start so the month
    // partitions before it are pruned.
    where.push(Prisma.sql`(
      t.agent_ids && ${agents}::uuid[]
      OR (t.closed_at IS NULL AND EXISTS (
        SELECT 1 FROM events e
         WHERE e.thread_id = t.id AND ${AGENT_TO_PLAYER}
           AND lower(e.author_id) = ANY(${agents}::text[])
           AND e.created_at >= t.created_at - ${OPEN_SLACK}
      ))
    )`);
  }

  if (filters.groupIds?.length) {
    const groups = filters.groupIds.map(String);
    // The row's own `group_ids`: the connection's team, or — for one opened
    // before ID-02 recorded it — its day's. `OFFSET 0`: `visibilitySql`'s
    // reason, a probe rather than a hashed subplan over the team's rows.
    where.push(Prisma.sql`(
      t.group_id = ANY(${groups}::bigint[])
      OR (t.group_id IS NULL AND EXISTS (
        SELECT 1 FROM chat_access ca
         WHERE ca.chat_id = t.chat_id AND ca.group_id = ANY(${groups}::bigint[])
        OFFSET 0
      ))
    )`);
  }

  if (filters.rating) where.push(ratingSql(licenseId, filters.rating, ratingReach));

  if (filters.tags?.length) {
    const tags = [...new Set(filters.tags.map((id) => id.toLowerCase()))];
    const tagged = Prisma.sql`FROM thread_tags tt
      WHERE tt.thread_id = t.id AND tt.tag_id = ANY(${tags}::uuid[])`;
    switch (filters.tagMode ?? 'any') {
      case 'any':
        where.push(Prisma.sql`EXISTS (SELECT 1 ${tagged})`);
        break;
      case 'all':
        // Every chosen tag present: one primary-key probe per tag. The same
        // set as `count(*) = n` over the key `(thread_id, tag_id)`, but a
        // correlated count hides its selectivity from the planner — measured at
        // a million connections, a page cost ~340 ms that way (HANDOFF tm 336.1).
        for (const tag of tags) {
          where.push(
            Prisma.sql`EXISTS (SELECT 1 FROM thread_tags tt WHERE tt.thread_id = t.id AND tt.tag_id = ${tag}::uuid)`,
          );
        }
        break;
      case 'exclude':
        where.push(Prisma.sql`NOT EXISTS (SELECT 1 ${tagged})`);
        break;
    }
  }
  if (filters.untagged) {
    where.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM thread_tags tt WHERE tt.thread_id = t.id)`);
  }

  if (filters.handledBy?.length) {
    where.push(Prisma.sql`t.handled_by = ANY(${filters.handledBy}::text[])`);
  }

  if (filters.riskFlags?.length) {
    where.push(Prisma.sql`t.risk_flags && ${filters.riskFlags}::text[]`);
  }

  if (filters.channel) {
    // The inbox's definition (`chatIdsOnChannel`): the day's oldest inbound
    // adapter message. `channel_messages.chat_id` is a soft reference, so the
    // licence is pinned explicitly as well as by row level security.
    where.push(Prisma.sql`(
      SELECT cm.channel_type FROM channel_messages cm
       WHERE cm.license_id = ${licenseId} AND cm.chat_id = t.chat_id
         AND cm.direction = 'inbound'
       ORDER BY cm.created_at, cm.id
       LIMIT 1
    ) = ${filters.channel}`);
  }

  return where;
}

/**
 * The rating filter, on the connection's newest rating — the one the row
 * shows (`pageSql`'s lateral read, same order). "Has a comment" is the row's
 * `has_comment`: something other than white space. A rating outside the
 * caller's `ratingReach` is no rating, as the row shows it (AR-03-S1).
 */
function ratingSql(licenseId: bigint, rating: ArchiveRatingFilter, reach: Prisma.Sql): Prisma.Sql {
  const ratings = Prisma.sql`FROM ratings rt
    WHERE rt.license_id = ${licenseId} AND rt.thread_id = t.id`;
  const newest = (condition: Prisma.Sql): Prisma.Sql => Prisma.sql`(${reach} AND EXISTS (
    SELECT 1 FROM (
      SELECT rt.value, rt.comment ${ratings}
      ORDER BY rt.created_at DESC, rt.id DESC
      LIMIT 1
    ) lr WHERE ${condition}
  ))`;
  const commented = Prisma.sql`lr.comment ~ '[^[:space:]]'`;
  switch (rating) {
    case 'any':
      return Prisma.sql`(${reach} AND EXISTS (SELECT 1 ${ratings}))`;
    case 'not_rated':
      return Prisma.sql`NOT (${reach} AND EXISTS (SELECT 1 ${ratings}))`;
    case 'good':
    case 'bad':
      return newest(Prisma.sql`lr.value = ${rating}`);
    case 'commented':
      return newest(commented);
    case 'good_commented':
      return newest(Prisma.sql`lr.value = 'good' AND ${commented}`);
    case 'bad_commented':
      return newest(Prisma.sql`lr.value = 'bad' AND ${commented}`);
  }
}
