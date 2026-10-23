/**
 * The archive (AR-01 · tm 335.1): past conversations, one row per connection.
 *
 * A row is a nexa thread — panel "Chat ID" — not a day: a player who wrote
 * three times is three rows, and each carries its own tags, assignee and
 * rating, never the day's newest connection's (AR-01-S1). A reopened
 * conversation is a new connection ("resume" opens a new thread), so the
 * earlier one stays here exactly as it closed.
 *
 * ## One query a page
 *
 * The page is chosen and described in one statement: a CTE picks the rows —
 * tenant, visibility, status, retention, AR-02's filters (`archive-filters.ts`)
 * and the keyset all in its WHERE — and
 * the outer SELECT reads each row's name, assignee, teams, tags, newest
 * rating, risk flags, first player message and message count beside it. No
 * read per row (N+1), and nothing filtered after the page is cut, which is
 * what keeps a page full and `next_page_id` honest (the `chatVisibilityFilter`
 * argument, `services/chat/access.ts`).
 *
 * Visibility is the chat's — the day's `chat_access` teams, or the caller
 * having been in it — the same rule as the inbox and the transcript read
 * (`GET /chats/{id}/events`), written here as SQL because the list is raw.
 *
 * ## Order and cursor
 *
 * The most recently ended first: `closed_at DESC, id DESC`, which is
 * `threads_license_id_closed_at_id_idx` read forwards. `DESC` puts NULL —
 * an open connection — first, so `status=all` is the same index with the
 * ongoing ones on top. The cursor carries `closed_at` as integer microseconds
 * read in SQL (`closed_key`), not a JS `Date`, which keeps only milliseconds:
 * a cursor rounded down would skip a row that closed in the same millisecond
 * (the trap `search_events` documents).
 *
 * ## The first message
 *
 * `events` is partitioned by month, so the lookup is bounded in time — from
 * a minute before the connection's start to a minute past its end — which lets
 * the executor prune partitions per row instead of probing every month's index.
 * The text was masked when it was written; it is masked again here (the AI's
 * second line, `maskDeep`'s argument) and shortened.
 *
 * ## Retention and erasure
 *
 * A closed connection past the workspace's retention window (NFR-C8,
 * `retention/policy.ts`, the sweep's own arithmetic) is not listed: the sweep
 * deletes it, and until it runs it is already condemned. Its detail is a 404
 * with `reason: retention_expired`. An erased member's chats are deleted with
 * them (`retention/erasure.ts`), so they have no rows to hide.
 */
import { Prisma } from '@prisma/client';
import {
  ARCHIVE_FIRST_MESSAGE_MAX,
  ARCHIVE_TOTAL_CAP,
  DEFAULT_DAY_BOUNDARY,
  RATING_VALUES,
  RISK_FLAG_TYPES,
  THREAD_HANDLED_BY,
  type ArchiveConversation,
  type ArchiveConversationDetail,
  type ArchiveConversationList,
  type ArchiveStatus,
  type RatingValue,
  type RiskFlagType,
  type ThreadHandledBy,
} from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { inHipaaScope } from '../../lib/hipaa.js';
import { maskSensitive } from '../../lib/sensitive-mask.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { resolveVisibility, type ChatVisibility } from '../chat/access.js';
import { readDayBoundary } from '../chat/day-boundary.js';
import { seesPlayerContact } from '../customers/player-contact.js';
import {
  applyTenantWindows,
  capRetentionForHipaa,
  cutoffForWindow,
  readTenantWindow,
  resolveRetentionPolicy,
} from '../retention/policy.js';
import {
  filterSql,
  needsDayBoundary,
  startedRange,
  type ArchiveFilters,
} from './archive-filters.js';

export type ArchiveRetentionEnv = Pick<
  Env,
  'RETENTION_THREAD_DAYS' | 'RETENTION_VISIT_DAYS' | 'RETENTION_MAIL_DAYS' | 'RETENTION_AUDIT_DAYS'
>;

export interface ArchiveListInput {
  status: ArchiveStatus;
  customerId?: string;
  /** AR-02's filters (`archive-filters.ts`). */
  filters?: ArchiveFilters;
  limit: number;
  pageId?: string;
}

/** How long past its close a connection's events are still looked for. */
const CLOSE_SLACK = Prisma.sql`interval '1 minute'`;

/**
 * How long before its own `created_at` a connection's events are still looked
 * for. A same-day return writes its first message with the application's clock
 * a few milliseconds before the thread row's `created_at` (measured in the e2e
 * stack, tm 335.2: 41 ms), so a bound at the row's own start dropped the very
 * message the connection was opened for.
 */
const OPEN_SLACK = Prisma.sql`interval '1 minute'`;

/** What the cursor holds: the row's `closed_at` in microseconds (null = open) and its id. */
interface Cursor {
  closedKey: bigint | null;
  id: string;
}

const OPEN_KEY = 'open';

export function encodeArchiveCursor(cursor: Cursor): string {
  const key = cursor.closedKey === null ? OPEN_KEY : cursor.closedKey.toString();
  return Buffer.from(`${key}.${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeArchiveCursor(pageId: string): Cursor {
  const raw = Buffer.from(pageId, 'base64url').toString('utf8');
  const match = /^(open|\d{1,19})\.([0-9A-Za-z]{10,12})$/.exec(raw);
  if (!match) throw ApiError.validation('page_id: not a cursor of this list.');
  const [, key, id] = match as unknown as [string, string, string];
  return { closedKey: key === OPEN_KEY ? null : BigInt(key), id };
}

/** One row as the page query returns it. */
interface Row {
  id: string;
  chat_id: string;
  created_at: Date;
  closed_at: Date | null;
  closed_key: bigint | null;
  assignee_id: string | null;
  handled_by: string | null;
  summary: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_username: string | null;
  assignee_name: string | null;
  group_ids: bigint[];
  tags: Array<{ id: string; name: string }>;
  rating_value: string | null;
  rating_comment: string | null;
  rating_at: Date | null;
  risk_flags: string[];
  first_message: string | null;
  message_count: number;
}

export class ArchiveService {
  readonly #retention: ArchiveRetentionEnv;

  constructor(retention: ArchiveRetentionEnv) {
    this.#retention = retention;
  }

  async list(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    input: ArchiveListInput,
  ): Promise<ArchiveConversationList> {
    const cursor = input.pageId ? decodeArchiveCursor(input.pageId) : undefined;
    const filters = input.filters ?? {};
    const range = startedRange(
      filters,
      needsDayBoundary(filters) ? await readDayBoundary(tx) : DEFAULT_DAY_BOUNDARY,
    );
    const visibility = await resolveVisibility(tx, principal, 'read');
    const cutoff = await this.#retentionCutoff(tx, tenant);

    // Everything that says what the list is — the cursor deliberately left
    // out, so `total` counts the list rather than what is left of it.
    const where = [
      Prisma.sql`t.license_id = ${tenant.licenseId}`,
      statusSql(input.status),
      ...(cutoff ? [Prisma.sql`(t.closed_at IS NULL OR t.closed_at >= ${cutoff})`] : []),
      ...(input.customerId ? [Prisma.sql`c.customer_id = ${input.customerId}::uuid`] : []),
      visibilitySql(visibility),
      ...filterSql(tenant.licenseId, filters, range, input.status),
    ];
    const paged = cursor ? [...where, cursorSql(cursor)] : where;

    const rows = await tx.$queryRaw<Row[]>(
      pageSql(tenant.licenseId, Prisma.join(paged, ' AND '), input.limit + 1),
    );
    const [counted] = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM threads t
        JOIN chats c ON c.id = t.chat_id
        JOIN customers cu ON cu.id = c.customer_id
        WHERE ${Prisma.join(where, ' AND ')}
        LIMIT ${ARCHIVE_TOTAL_CAP + 1}
      ) capped`;
    const n = counted?.n ?? 0;

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const contact = seesPlayerContact(principal);
    const last = page.at(-1);
    return {
      items: page.map((row) => toConversation(row, contact)),
      total: Math.min(n, ARCHIVE_TOTAL_CAP),
      total_capped: n > ARCHIVE_TOTAL_CAP,
      ...(hasMore && last
        ? { next_page_id: encodeArchiveCursor({ closedKey: last.closed_key, id: last.id }) }
        : {}),
    };
  }

  async get(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    threadId: string,
  ): Promise<ArchiveConversationDetail> {
    const visibility = await resolveVisibility(tx, principal, 'read');
    const where = Prisma.join(
      [
        Prisma.sql`t.license_id = ${tenant.licenseId}`,
        Prisma.sql`t.id = ${threadId}`,
        visibilitySql(visibility),
      ],
      ' AND ',
    );
    const [row] = await tx.$queryRaw<Row[]>(pageSql(tenant.licenseId, where, 1));
    if (!row) throw ApiError.notFound('Conversation not found.');

    const cutoff = await this.#retentionCutoff(tx, tenant);
    if (cutoff && row.closed_at && row.closed_at < cutoff) {
      throw new ApiError(
        'not_found',
        'This conversation was deleted at the end of its retention period.',
        {
          details: { reason: 'retention_expired' },
        },
      );
    }

    const conversation = toConversation(row, seesPlayerContact(principal));
    const value = ratingValue(row.rating_value);
    return {
      ...conversation,
      rating:
        value && row.rating_at
          ? {
              value,
              has_comment: hasComment(row.rating_comment),
              comment: hasComment(row.rating_comment) ? row.rating_comment : null,
              rated_at: row.rating_at.toISOString(),
            }
          : null,
      summary: row.summary,
    };
  }

  /**
   * The moment a closed connection must be newer than to be kept — the
   * sweep's own resolution for this workspace (deployment default, the
   * workspace's choice, then the HIPAA ceiling), or null for "unlimited".
   */
  async #retentionCutoff(tx: TenantClient, tenant: TenantContext): Promise<Date | null> {
    const licence = await tx.license.findUnique({
      where: { id: tenant.licenseId },
      select: { hipaaBaaSignedAt: true, retentionThreadWindow: true },
    });
    const chosen = applyTenantWindows(resolveRetentionPolicy(this.#retention), {
      threadWindow: readTenantWindow(licence?.retentionThreadWindow),
      visitWindow: null,
    });
    const policy = inHipaaScope(licence) ? capRetentionForHipaa(chosen) : chosen;
    return cutoffForWindow(policy.threadDays, new Date());
  }
}

function statusSql(status: ArchiveStatus): Prisma.Sql {
  switch (status) {
    case 'closed':
      return Prisma.sql`t.closed_at IS NOT NULL`;
    case 'open':
      return Prisma.sql`t.closed_at IS NULL`;
    case 'all':
      return Prisma.sql`TRUE`;
  }
}

/**
 * `chatVisibilityFilter` (`chat/access.ts`) as SQL over `threads t` / `chats c`: every
 * conversation for an unrestricted caller; otherwise the ones a team of theirs
 * was given, or that they took part in. A customer never reaches the archive
 * (the route's principals); their own conversations are the answer if one did.
 *
 * `OFFSET 0` keeps the team probe a probe. Without it PostgreSQL may turn an
 * EXISTS under an OR into a hashed subplan — every `chat_access` row of the
 * caller's teams read, each through its row level security check, before the
 * first thread is looked at. Measured at a million connections over five
 * teams (`measure:archive-page`): 140 000 rows and ~200 ms per page and again
 * per count, growing with the team. `OFFSET` makes the subquery one PostgreSQL
 * will not rewrite into `= ANY (hashed …)`, so each row costs one primary-key
 * lookup on `chat_access (chat_id, group_id)`.
 */
function visibilitySql(visibility: ChatVisibility): Prisma.Sql {
  if (visibility.isCustomer) return Prisma.sql`c.customer_id = ${visibility.actorId}::uuid`;
  if (visibility.unrestricted) return Prisma.sql`TRUE`;
  const groups = `{${visibility.groupIds.join(',')}}`;
  return Prisma.sql`(
    EXISTS (
      SELECT 1 FROM chat_access ca
      WHERE ca.chat_id = t.chat_id AND ca.group_id = ANY(${groups}::bigint[])
      OFFSET 0
    )
    OR EXISTS (
      SELECT 1 FROM chat_users cp
      WHERE cp.chat_id = t.chat_id AND cp.user_id = ${visibility.actorId} AND cp.user_type = 'agent'
    )
  )`;
}

/** Strictly after the cursor's row in `closed_at DESC, id DESC` (NULL first). */
function cursorSql(cursor: Cursor): Prisma.Sql {
  if (cursor.closedKey === null) {
    return Prisma.sql`((t.closed_at IS NULL AND t.id < ${cursor.id}) OR t.closed_at IS NOT NULL)`;
  }
  const at = Prisma.sql`('epoch'::timestamptz + ${cursor.closedKey}::bigint * interval '1 microsecond')`;
  return Prisma.sql`(t.closed_at <= ${at} AND (t.closed_at < ${at} OR t.id < ${cursor.id}))`;
}

/** The page: its rows chosen by `where`, then described — one statement. */
function pageSql(licenseId: bigint, where: Prisma.Sql, limit: number): Prisma.Sql {
  return Prisma.sql`
    WITH page AS (
      SELECT t.id, t.chat_id, t.created_at, t.closed_at, t.assignee_id, t.group_id,
             t.handled_by, t.summary, t.risk_flags, c.customer_id,
             (extract(epoch FROM t.closed_at) * 1000000)::bigint AS closed_key
      FROM threads t
      JOIN chats c ON c.id = t.chat_id
      JOIN customers cu ON cu.id = c.customer_id
      WHERE ${where}
      ORDER BY t.closed_at DESC, t.id DESC
      LIMIT ${limit}
    )
    SELECT p.id, p.chat_id, p.created_at, p.closed_at, p.closed_key, p.assignee_id,
           p.handled_by, p.summary, p.customer_id,
           cu.name AS customer_name, cu.username AS customer_username,
           a.name AS assignee_name,
           COALESCE(
             CASE WHEN p.group_id IS NOT NULL THEN ARRAY[p.group_id] END,
             (SELECT array_agg(ca.group_id ORDER BY ca.group_id)
                FROM chat_access ca WHERE ca.chat_id = p.chat_id),
             '{}'::bigint[]
           ) AS group_ids,
           (SELECT COALESCE(json_agg(json_build_object('id', tg.id, 'name', tg.name)
                                     ORDER BY tg.name, tg.id), '[]'::json)
              FROM thread_tags tt JOIN tags tg ON tg.id = tt.tag_id
             WHERE tt.thread_id = p.id) AS tags,
           r.value AS rating_value, r.comment AS rating_comment, r.created_at AS rating_at,
           p.risk_flags,
           fm.text AS first_message,
           (SELECT count(*)::int FROM events e
             WHERE e.thread_id = p.id AND e.type = 'message'
               AND e.created_at >= p.created_at - ${OPEN_SLACK}
               AND e.created_at <= COALESCE(p.closed_at, now()) + ${CLOSE_SLACK}) AS message_count
    FROM page p
    JOIN customers cu ON cu.id = p.customer_id
    LEFT JOIN accounts a ON a.id = p.assignee_id
    LEFT JOIN LATERAL (
      SELECT rt.value, rt.comment, rt.created_at FROM ratings rt
      WHERE rt.license_id = ${licenseId} AND rt.thread_id = p.id
      ORDER BY rt.created_at DESC, rt.id DESC
      LIMIT 1
    ) r ON TRUE
    LEFT JOIN LATERAL (
      SELECT left(e.text, 400) AS text FROM events e
      WHERE e.thread_id = p.id AND e.type = 'message' AND e.author_type = 'customer'
        AND e.created_at >= p.created_at - ${OPEN_SLACK}
        AND e.created_at <= COALESCE(p.closed_at, now()) + ${CLOSE_SLACK}
      ORDER BY e.created_at, e.id
      LIMIT 1
    ) fm ON TRUE
    ORDER BY p.closed_at DESC, p.id DESC`;
}

function toConversation(row: Row, contactVisible: boolean): ArchiveConversation {
  const value = ratingValue(row.rating_value);
  return {
    thread_id: row.id,
    chat_id: row.chat_id,
    customer: {
      id: row.customer_id,
      name: row.customer_name,
      username: contactVisible ? row.customer_username : null,
    },
    started_at: row.created_at.toISOString(),
    ended_at: row.closed_at?.toISOString() ?? null,
    assignee:
      row.assignee_id && row.assignee_name !== null
        ? { id: row.assignee_id, name: row.assignee_name }
        : null,
    group_ids: row.group_ids.map(Number),
    tags: row.tags,
    rating: value ? { value, has_comment: hasComment(row.rating_comment) } : null,
    handled_by: (THREAD_HANDLED_BY as readonly string[]).includes(row.handled_by ?? '')
      ? (row.handled_by as ThreadHandledBy)
      : null,
    risk_flags: row.risk_flags
      .filter((type): type is RiskFlagType => (RISK_FLAG_TYPES as readonly string[]).includes(type))
      .sort(),
    first_customer_message: preview(row.first_message),
    message_count: row.message_count,
  };
}

function ratingValue(value: string | null): RatingValue | null {
  return (RATING_VALUES as readonly (string | null)[]).includes(value)
    ? (value as RatingValue)
    : null;
}

function hasComment(comment: string | null): boolean {
  return comment !== null && comment.trim() !== '';
}

/** One line, masked, at most {@link ARCHIVE_FIRST_MESSAGE_MAX} characters. */
export function preview(text: string | null): string | null {
  if (text === null) return null;
  const masked = maskSensitive(text, { author: 'customer' }).text;
  const line = masked.replace(/\s+/g, ' ').trim();
  if (line === '') return null;
  const chars = Array.from(line);
  if (chars.length <= ARCHIVE_FIRST_MESSAGE_MAX) return line;
  return `${chars
    .slice(0, ARCHIVE_FIRST_MESSAGE_MAX - 1)
    .join('')
    .trimEnd()}…`;
}
