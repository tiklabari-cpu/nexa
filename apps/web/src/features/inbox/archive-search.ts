/**
 * Message text search in the archive (ID-07 · tm 333.4): what the Archive view's
 * search bar sends and how it reads what comes back.
 *
 * The searched text lives in component state only — never in the address bar
 * (GV-05): `GET /chats?query=` masks it in the request log, and the view that
 * asks keeps it out of the URL, the history and `localStorage`.
 *
 * The server owns the rules (`messageSearchWords`, the date window, the match
 * cap); the checks here only save a round trip, so a query that would be refused
 * says why before it is sent. Whatever the server still refuses is read from
 * `details.reason` and worded in the console's language.
 */
import {
  messageSearchWords,
  type MessageSearchHighlight,
  type MessageSearchMatch,
  type MessageSearchRefusal,
} from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import { zonedDayBoundary } from '../../lib/format.js';
import { usePagedQuery, type PagedQueryResult } from '../../lib/paged-query.js';
import type { ChatSummary } from './types.js';

/** Rows per request; the server's own default, stated so the page size is not implicit. */
const SEARCH_PAGE_SIZE = 50;

/** What the bar holds once the agent has asked: the words and the optional day range. */
export interface ArchiveSearchRequest {
  query: string;
  /** `YYYY-MM-DD` on the agent's own calendar, or '' for "90 days back". */
  dateFrom: string;
  /** `YYYY-MM-DD` on the agent's own calendar, or '' for "now". */
  dateTo: string;
}

/**
 * The query-string for one search page. The dates are cut on the viewer's wall
 * clock (`zonedDayBoundary`): a day picked on Istanbul's calendar starts at
 * 00:00 there, not at UTC midnight. The server reads `[date_from, date_to)`, so
 * the end is the first instant of the day *after* the one picked.
 */
export function archiveSearchUrl(
  request: ArchiveSearchRequest,
  pageId: string | undefined,
): string {
  const params = new URLSearchParams({ query: request.query });
  params.set('limit', String(SEARCH_PAGE_SIZE));
  if (pageId) params.set('page_id', pageId);
  if (request.dateFrom) params.set('date_from', zonedDayBoundary(request.dateFrom, 'start'));
  if (request.dateTo) {
    const lastMs = Date.parse(zonedDayBoundary(request.dateTo, 'end'));
    params.set(
      'date_to',
      Number.isNaN(lastMs) ? request.dateTo : new Date(lastMs + 1).toISOString(),
    );
  }
  return `/chats?${params.toString()}`;
}

/** A conversation found by its text: the list row plus the message that matched. */
export type ArchiveSearchHit = ChatSummary & { match: MessageSearchMatch };

/**
 * The searched conversations, newest match first, paged by the server's cursor.
 *
 * Its key is outside the `['chats', …]` namespace on purpose: the live handlers
 * move a chat that just had activity to the top of every list under that
 * prefix, and a search result's place is its match, not its latest message.
 * A request that is `null` leaves the query idle.
 */
export function useArchiveSearch(
  request: ArchiveSearchRequest | null,
): PagedQueryResult<ArchiveSearchHit> {
  return usePagedQuery<ArchiveSearchHit>({
    queryKey: ['chat-search', request?.query ?? '', request?.dateFrom ?? '', request?.dateTo ?? ''],
    buildUrl: (pageId) => (request ? archiveSearchUrl(request, pageId) : '/chats'),
    enabled: request !== null,
    // The same words ask the same question; a re-read on every focus would
    // spend the 60-a-minute budget the search is held to.
    staleTime: 30_000,
  });
}

/** What the bar can refuse before asking (`messageSearchWords`' refusals, plus the dates). */
export type ArchiveSearchRefusal = MessageSearchRefusal | 'range_order';

/**
 * Whether the bar's contents are worth a request: the query's own rules, then
 * a start day that is not after the end day.
 */
export function checkArchiveSearch(input: ArchiveSearchRequest): ArchiveSearchRefusal | null {
  const words = messageSearchWords(input.query);
  if (!words.ok) return words.reason;
  if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) return 'range_order';
  return null;
}

/** The refusals the server names in `details.reason` that this build has a sentence for. */
const ARCHIVE_SEARCH_REASONS: readonly string[] = [
  'too_short',
  'too_long',
  'too_many_words',
  'no_trigram',
  'too_broad',
  'range_order',
  'range_too_long',
];

/**
 * The reason a failed search carries, or null when it carries none this build
 * has wording for (the caller then falls back to the error type's own sentence).
 */
export function archiveSearchReason(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  const reason = error.details?.['reason'];
  return typeof reason === 'string' && ARCHIVE_SEARCH_REASONS.includes(reason) ? reason : null;
}

/** One stretch of a snippet, shown plain or marked. */
export interface SnippetPart {
  text: string;
  marked: boolean;
}

/**
 * A snippet cut into its plain and marked stretches. The server's ranges are
 * UTF-16 offsets into the snippet and never overlap; anything out of order or
 * outside the text is dropped rather than trusted, so a malformed range cannot
 * swallow text or throw.
 */
export function splitSnippet(
  snippet: string,
  highlights: readonly MessageSearchHighlight[],
): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let at = 0;
  for (const { start, end } of highlights) {
    if (start < at || end <= start || end > snippet.length) continue;
    if (start > at) parts.push({ text: snippet.slice(at, start), marked: false });
    parts.push({ text: snippet.slice(start, end), marked: true });
    at = end;
  }
  if (at < snippet.length) parts.push({ text: snippet.slice(at), marked: false });
  return parts;
}
