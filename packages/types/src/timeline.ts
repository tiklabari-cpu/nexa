/**
 * The conversation timeline (ID-09 · tm 334): every event of one day or one
 * connection — messages, internal notes, the AI's decisions, assignment,
 * transfer, tags, rating, SLA misses, tickets, the audit trail — in one list,
 * `GET /chats/{chatId}/timeline`, and its export,
 * `POST /chats/{chatId}/timeline/export`.
 *
 * Names follow the identity glossary (ID-01, K1 = A): `chat_id` is the
 * member's day ("Thread ID" in the panel), `thread_id` one connection inside it
 * ("Chat ID"). The export's column headers say both, so a file read without
 * the panel cannot be misread (`TIMELINE_EXPORT_COLUMNS`).
 *
 * Plain literals only: this module reaches the widget loader through the
 * barrel, and a top-level call would keep it in that bundle.
 */

/**
 * What a timeline row is, in the order two rows of the same millisecond are
 * listed: what was said first, then what the AI decided about it, then what
 * moved the conversation, then what was recorded about it.
 */
export const TIMELINE_KINDS = [
  'message',
  'note',
  'ai_decision',
  'system',
  'assignment',
  'transfer',
  'tag',
  'rating',
  'sla_breach',
  'ticket',
  'audit',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** Who a row is from: the event author types, plus `ai` for the AI's own records. */
export const TIMELINE_ACTOR_TYPES = ['agent', 'customer', 'bot', 'system', 'ai'] as const;
export type TimelineActorType = (typeof TIMELINE_ACTOR_TYPES)[number];

/** Rows per page — the screen's "Load more" step (ID-09 §3). */
export const TIMELINE_PAGE_SIZE = 200;

/** The most rows a page may ask for. */
export const TIMELINE_PAGE_MAX = 500;

/** The most rows one export writes (ID-09 §5). */
export const TIMELINE_EXPORT_MAX = 20_000;

export const TIMELINE_EXPORT_FORMATS = ['csv', 'ndjson', 'txt'] as const;
export type TimelineExportFormat = (typeof TIMELINE_EXPORT_FORMATS)[number];

/**
 * The CSV's columns, in order. The two ids carry both names — the panel's and
 * the code's — so "Thread ID" is never taken for a thread row.
 */
export const TIMELINE_EXPORT_COLUMNS = [
  'At (UTC)',
  'Kind',
  'Actor type',
  'Actor',
  'Thread ID (chat_id)',
  'Chat ID (thread_id)',
  'Event ID',
  'Text',
  'Details',
] as const;

export interface TimelineActor {
  type: TimelineActorType;
  /** The account, customer or bot id; null for the system and the AI. */
  id: string | null;
  /** A display name, when one is known. */
  name: string | null;
}

/** One row of the timeline. */
export interface TimelineItem {
  /** The row's own id within its source (event id, decision id, audit entry id…). */
  id: string;
  at: string;
  kind: TimelineKind;
  actor: TimelineActor;
  /** The day ("Thread ID"). */
  chat_id: string;
  /** The connection ("Chat ID"); null for a row about the day as a whole. */
  thread_id: string | null;
  /** The transcript event the row is, or answers; absent when none. */
  event_id?: string;
  text?: string;
  /** The row's source fields, ids and codes — what the panel shows on expand. */
  details: Record<string, unknown>;
}

/** The read's answer, one page. */
export interface TimelinePage {
  chat_id: string;
  thread_id: string | null;
  items: TimelineItem[];
  /** Present while rows remain; a page may hold fewer than `limit` rows before it. */
  next_page_id?: string;
  /**
   * Whether the audit trail is part of the rows: `included`, or
   * `not_permitted` for a caller who may not read the audit log.
   */
  audit: 'included' | 'not_permitted';
  /**
   * The audit trail's retention reaches back to here; a conversation older than
   * this has lost its audit rows to retention (ID-09: "kayıt saklama süresi
   * dolmuş"), and the panel says so instead of showing nothing.
   */
  audit_retained_since: string;
  audit_expired: boolean;
}
