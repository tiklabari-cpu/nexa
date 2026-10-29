/**
 * The player's rating of a connection (AR-03 · WG-11 · tm 337): writing it,
 * and the Reviews report's list of the comments left with one.
 *
 * **One rating per connection.** The widget sends the connection its prompt is
 * for (`thread_id`), so a player who opened a new conversation since still
 * rates the old one; without it the newest connection is rated, as before. A
 * connection already rated is written onto, not rated again: a changed value
 * replaces the old one and moves `created_at` (the rating's time), a comment is
 * added to it — the rating count never grows from a second call. Rows written
 * twice before this rule stay; the newest is the one shown and written onto.
 * Two calls for one connection at once are serialised on a transaction lock.
 *
 * The comment is plain text, masked at the source like every visitor write
 * (FR-MOD-08.9.5 · AI-26). Only the player rates: no agent route reaches here.
 */
import { Prisma } from '@prisma/client';
import type { RatingValue, ReviewComment, ReviewCommentList } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import type { TenantClient } from '../../lib/tenant.js';
import { ratingSubjectOf, recordOutcomeRating } from '../reports/ai-outcomes.js';
import { ratingReachSql, type RatingReach } from './rating-reach.js';

export interface RatingInput {
  value: RatingValue;
  comment?: string | undefined;
  threadId?: string | undefined;
}

export interface RecordedRating {
  id: string;
  value: RatingValue;
  chatId: string;
  threadId: string | null;
  hasComment: boolean;
  /** False when an existing rating was written onto. */
  created: boolean;
}

export async function recordRating(
  tx: TenantClient,
  licenseId: bigint,
  customerId: string,
  input: RatingInput,
): Promise<RecordedRating> {
  const target = await targetOf(tx, customerId, input.threadId);
  const comment =
    input.comment !== undefined && input.comment !== ''
      ? maskForWrite(input.comment, 'customer').text
      : undefined;

  if (target.threadId !== null) {
    // Two calls for one connection — a double click, a retry — must not both
    // find no rating and both create one.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rating:${target.threadId}`}, 0))`;
    const existing = await tx.rating.findFirst({
      where: { threadId: target.threadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, value: true, comment: true },
    });
    if (existing) {
      const changed = existing.value !== input.value;
      const subject = changed ? await ratingSubjectOf(tx, target.threadId) : undefined;
      const updated = await tx.rating.update({
        where: { id: existing.id },
        data: {
          ...(changed ? { value: input.value, subject, createdAt: new Date() } : {}),
          ...(comment !== undefined ? { comment } : {}),
        },
        select: { id: true, value: true, chatId: true, threadId: true, comment: true },
      });
      if (changed && subject) {
        await recordOutcomeRating(tx, target.threadId, subject, input.value);
      }
      return toRecorded(updated, false);
    }
  }

  // Whom it judges (tm 320.1 · AI-25-S2): the AI until a person wrote to the
  // player on the connection — BSAT and CSAT apart.
  const subject = target.threadId ? await ratingSubjectOf(tx, target.threadId) : null;
  const created = await tx.rating.create({
    data: {
      chatId: target.chatId,
      licenseId,
      threadId: target.threadId,
      value: input.value,
      subject,
      ...(comment !== undefined ? { comment } : {}),
    },
    select: { id: true, value: true, chatId: true, threadId: true, comment: true },
  });
  if (target.threadId && subject) {
    await recordOutcomeRating(tx, target.threadId, subject, input.value);
  }
  return toRecorded(created, true);
}

/**
 * The connection rated: the one named, which must be this visitor's (a 404
 * otherwise, as for a missing one), or the newest connection of the visitor's
 * newest conversation, open or not — ratings usually arrive just after one
 * closes.
 */
async function targetOf(
  tx: TenantClient,
  customerId: string,
  threadId: string | undefined,
): Promise<{ chatId: string; threadId: string | null }> {
  if (threadId !== undefined) {
    const thread = await tx.thread.findFirst({
      where: { id: threadId, chat: { customerId } },
      select: { id: true, chatId: true },
    });
    if (!thread) throw ApiError.notFound('No conversation to rate.');
    return { chatId: thread.chatId, threadId: thread.id };
  }
  const chat = await tx.chat.findFirst({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: { threads: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!chat) throw ApiError.notFound('No conversation to rate.');
  return { chatId: chat.id, threadId: chat.threads[0]?.id ?? null };
}

function toRecorded(
  row: {
    id: string;
    value: string;
    chatId: string;
    threadId: string | null;
    comment: string | null;
  },
  created: boolean,
): RecordedRating {
  return {
    id: row.id,
    value: row.value as RatingValue,
    chatId: row.chatId,
    threadId: row.threadId,
    hasComment: hasRatingComment(row.comment),
    created,
  };
}

/** Something other than white space — the archive's `has_comment` rule. */
export function hasRatingComment(comment: string | null): boolean {
  return comment !== null && comment.trim() !== '';
}

// --- The Reviews report's comments (WG-11) ---------------------------------

export interface ReviewCommentsInput {
  from: Date;
  to: Date;
  value?: RatingValue | undefined;
  limit: number;
  pageId?: string | undefined;
}

interface CommentRow {
  id: string;
  chat_id: string;
  thread_id: string;
  value: string;
  comment: string;
  created_at: Date;
  rated_key: bigint;
  customer_id: string;
  customer_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
}

/**
 * Commented ratings rated in `[from, to)`, newest first, inside the caller's
 * `ratings.view` reach and the chat visibility `visibleSql` (over `t` / `c`).
 * One rating per connection is listed — its newest, the one shown elsewhere.
 */
export async function listReviewComments(
  tx: TenantClient,
  licenseId: bigint,
  reach: RatingReach,
  visibleSql: Prisma.Sql,
  input: ReviewCommentsInput,
): Promise<ReviewCommentList> {
  const cursor = input.pageId !== undefined ? decodeCommentCursor(input.pageId) : null;
  const after = cursor
    ? Prisma.sql`AND (r.created_at < ${at(cursor.key)}
        OR (r.created_at = ${at(cursor.key)} AND r.id < ${cursor.id}::uuid))`
    : Prisma.empty;
  const rows = await tx.$queryRaw<CommentRow[]>`
    SELECT r.id, r.chat_id, r.thread_id, r.value, r.comment, r.created_at,
           (extract(epoch FROM r.created_at) * 1000000)::bigint AS rated_key,
           c.customer_id, cu.name AS customer_name, t.assignee_id, a.name AS assignee_name
      FROM ratings r
      JOIN threads t ON t.id = r.thread_id
      JOIN chats c ON c.id = t.chat_id
      JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN accounts a ON a.id = t.assignee_id
     WHERE r.license_id = ${licenseId}
       AND r.created_at >= ${input.from} AND r.created_at < ${input.to}
       AND r.comment ~ '[^[:space:]]'
       ${input.value !== undefined ? Prisma.sql`AND r.value = ${input.value}` : Prisma.empty}
       AND NOT EXISTS (
         SELECT 1 FROM ratings nr
          WHERE nr.license_id = r.license_id AND nr.thread_id = r.thread_id
            AND (nr.created_at > r.created_at OR (nr.created_at = r.created_at AND nr.id > r.id))
       )
       AND ${ratingReachSql(reach, 't')}
       AND ${visibleSql}
       ${after}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${input.limit + 1}`;
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page.at(-1);
  return {
    items: page.map(toComment),
    ...(hasMore && last ? { next_page_id: encodeCommentCursor(last.rated_key, last.id) } : {}),
  };
}

function toComment(row: CommentRow): ReviewComment {
  return {
    rating_id: row.id,
    chat_id: row.chat_id,
    thread_id: row.thread_id,
    value: row.value as RatingValue,
    comment: row.comment,
    rated_at: row.created_at.toISOString(),
    customer: { id: row.customer_id, name: row.customer_name },
    assignee:
      row.assignee_id !== null && row.assignee_name !== null
        ? { id: row.assignee_id, name: row.assignee_name }
        : null,
  };
}

/** Microseconds since the epoch as a timestamp — a `Date` cursor would lose them. */
function at(key: bigint): Prisma.Sql {
  return Prisma.sql`('epoch'::timestamptz + ${key.toString()}::bigint * interval '1 microsecond')`;
}

const CURSOR = /^r1\.(\d{1,20})\.([0-9a-f-]{36})$/;

function encodeCommentCursor(key: bigint, id: string): string {
  return `r1.${key.toString()}.${id}`;
}

export function decodeCommentCursor(pageId: string): { key: bigint; id: string } {
  const match = CURSOR.exec(pageId);
  if (!match) throw ApiError.validation('page_id: not a page this list returned.');
  return { key: BigInt(match[1]!), id: match[2]! };
}
