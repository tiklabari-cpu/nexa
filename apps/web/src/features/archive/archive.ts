/**
 * What the Archive screen (AR-01 · tm 335.2) decides before it draws: which
 * connections the list asks for, how rows fold into days, and what a refused
 * detail means.
 *
 * The address carries the screen's state and nothing personal (GV-05): the
 * selected connection (`?c=`), whether open connections are listed too
 * (`?status=all`) and whether a day's connections are folded together
 * (`?group=day`). The searched words are not in it.
 */
import type { ArchiveConversation, ArchiveStatus } from '@siyahtus/types';
import { ARCHIVE_DEFAULT_LIMIT } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';

/** The query parameter that names the open connection (its number, `thread_id` in the API). */
export const CONNECTION_PARAM = 'c';
const STATUS_PARAM = 'status';
const GROUP_PARAM = 'group';

/** The two lists the screen offers: closed connections (AR-01-S3's default) or every one. */
export type ArchiveScope = Extract<ArchiveStatus, 'closed' | 'all'>;

/** `?status=all` is the only spelling that widens the list; anything else is the default. */
export function readScope(params: URLSearchParams): ArchiveScope {
  return params.get(STATUS_PARAM) === 'all' ? 'all' : 'closed';
}

/** "Fold the same day together" (AR-01-S1), off unless the address asks for it. */
export function readGrouped(params: URLSearchParams): boolean {
  return params.get(GROUP_PARAM) === 'day';
}

/** The address after a switch changed: a default value leaves no trace in it. */
export function writeFlag(
  params: URLSearchParams,
  key: 'scope' | 'group',
  on: boolean,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const name = key === 'scope' ? STATUS_PARAM : GROUP_PARAM;
  if (on) next.set(name, key === 'scope' ? 'all' : 'day');
  else next.delete(name);
  return next;
}

/** One page of the list. The server's keyset cursor is opaque; it is passed back as is. */
export function archiveListUrl(scope: ArchiveScope, pageId: string | undefined): string {
  const params = new URLSearchParams({ status: scope, limit: String(ARCHIVE_DEFAULT_LIMIT) });
  if (pageId) params.set('page_id', pageId);
  return `/archive/conversations?${params.toString()}`;
}

/** One connection's messages, newest first, walked backwards by event id like the inbox's. */
export function archiveTranscriptUrl(
  chatId: string,
  threadId: string,
  beforeEventId: string | undefined,
): string {
  const before = beforeEventId ? `&before_event_id=${encodeURIComponent(beforeEventId)}` : '';
  return (
    `/chats/${encodeURIComponent(chatId)}/events?thread_id=${encodeURIComponent(threadId)}` +
    `&sort=newest&limit=200${before}`
  );
}

/** A member's day in the list: the connections that share a `chat_id`, newest first. */
export interface DayGroup {
  chatId: string;
  rows: ArchiveConversation[];
}

/**
 * The loaded rows folded by day. A day sits where its newest row does and keeps
 * the list's own order inside, so unfolding changes nothing but the grouping —
 * and a day whose other connections are on a page not read yet is simply shorter
 * until that page arrives.
 */
export function groupByDay(rows: readonly ArchiveConversation[]): DayGroup[] {
  const days = new Map<string, DayGroup>();
  for (const row of rows) {
    const day = days.get(row.chat_id);
    if (day) day.rows.push(row);
    else days.set(row.chat_id, { chatId: row.chat_id, rows: [row] });
  }
  return [...days.values()];
}

/** Why a connection could not be read. */
export type ArchiveRefusal = 'retention_expired' | 'not_found' | 'other';

/**
 * The detail's answer to a refusal: a connection the retention sweep removed says
 * so (`details.reason`), a plain 404 is a number that is not (or is no longer)
 * one the caller may see, and anything else is a failure worth retrying.
 */
export function archiveRefusal(error: unknown): ArchiveRefusal {
  if (!(error instanceof ApiClientError) || error.status !== 404) return 'other';
  return error.details?.['reason'] === 'retention_expired' ? 'retention_expired' : 'not_found';
}
