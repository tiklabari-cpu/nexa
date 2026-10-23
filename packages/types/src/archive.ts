/**
 * The archive (AR-01 · tm 335): `GET /archive/conversations` and
 * `GET /archive/conversations/{threadId}`.
 *
 * A row is one **connection** — a nexa thread, "Chat ID" in the panel — not a
 * day: a player who wrote three times is three rows, each with its own tags,
 * assignee and rating (AR-01-S1). Names follow the identity glossary (ID-01,
 * K1 = A): `chat_id` is the member's day ("Thread ID"), `thread_id` the
 * connection ("Chat ID").
 *
 * The archive is read-only and not live: no push keeps it current, a closed
 * conversation appears when the list is read again.
 */
import type { RatingValue } from './domain.js';
import type { RiskFlagType } from './risk-flags.js';

/**
 * Who answered a connection, written once as it closes (`threads.handled_by`,
 * AR-01 / AR-02). `ai` is exactly ADR-09a's "AI resolution" — the predicate
 * the invoice counts, no other — `human` a person and no bot, `mixed` the
 * rest (a bot and a person, or a hand-off nobody answered). Null on an open
 * connection and on one closed before the column existed.
 */
export const THREAD_HANDLED_BY = ['ai', 'human', 'mixed'] as const;
export type ThreadHandledBy = (typeof THREAD_HANDLED_BY)[number];

/** Which connections the list holds: closed ones by default (AR-01-S3). */
export const ARCHIVE_STATUSES = ['closed', 'open', 'all'] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

/**
 * The rating filter (AR-02), read on a connection's newest rating — the one
 * the row shows. `any` is rated at all, `commented` any rating with a comment.
 */
export const ARCHIVE_RATING_FILTERS = [
  'any',
  'not_rated',
  'good',
  'bad',
  'commented',
  'good_commented',
  'bad_commented',
] as const;
export type ArchiveRatingFilter = (typeof ARCHIVE_RATING_FILTERS)[number];

/**
 * How the chosen tags combine (AR-02): `any` — at least one of them, `all` —
 * every one, `exclude` — none of them.
 */
export const ARCHIVE_TAG_MODES = ['any', 'all', 'exclude'] as const;
export type ArchiveTagMode = (typeof ARCHIVE_TAG_MODES)[number];

/** At most this many tags in one filter (AR-02, LiveChat's limit). */
export const ARCHIVE_MAX_TAGS = 20;

/** At most this many agents, or teams, in one filter — the address stays an address. */
export const ARCHIVE_MAX_FILTER_IDS = 50;

export const ARCHIVE_DEFAULT_LIMIT = 50;
export const ARCHIVE_MAX_LIMIT = 100;

/**
 * Where `total` stops counting. A count over a million connections is a scan;
 * past this the list says "more than" (`total_capped`) instead.
 */
export const ARCHIVE_TOTAL_CAP = 1000;

/** How much of the player's first message a row carries, in characters. */
export const ARCHIVE_FIRST_MESSAGE_MAX = 140;

/** One archive row: one connection. */
export interface ArchiveConversation {
  /** The connection ("Chat ID") — the row's id. */
  thread_id: string;
  /** The day it belongs to ("Thread ID"). */
  chat_id: string;
  customer: {
    id: string;
    name: string | null;
    /** Null when not given, or the caller may not see it (`customers.contact.view`). */
    username: string | null;
  };
  started_at: string;
  /** Null while it is still open. */
  ended_at: string | null;
  /** Who had it — at the close, for a closed one. */
  assignee: { id: string; name: string } | null;
  /** The team it went to; the day's teams for a connection opened before ID-02 recorded one. */
  group_ids: number[];
  tags: Array<{ id: string; name: string }>;
  /** The player's newest rating of this connection (AR-03). */
  rating: { value: RatingValue; has_comment: boolean } | null;
  handled_by: ThreadHandledBy | null;
  /** The kinds of risk flag raised in this connection (AI-27), cleared ones included. */
  risk_flags: RiskFlagType[];
  /** The player's first message, at most {@link ARCHIVE_FIRST_MESSAGE_MAX} characters, masked. */
  first_customer_message: string | null;
  /** Messages in it, internal notes included. */
  message_count: number;
}

export interface ArchiveConversationList {
  items: ArchiveConversation[];
  /** Rows the list holds, counted up to {@link ARCHIVE_TOTAL_CAP}. */
  total: number;
  /** True: there are more than `total`. */
  total_capped: boolean;
  next_page_id?: string;
}

/** One connection in full: the row, and the rating with its comment. */
export interface ArchiveConversationDetail extends Omit<ArchiveConversation, 'rating'> {
  rating: {
    value: RatingValue;
    has_comment: boolean;
    comment: string | null;
    rated_at: string;
  } | null;
  /** The connection's written summary, if anyone wrote one. */
  summary: string | null;
}
