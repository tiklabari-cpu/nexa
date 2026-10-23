/**
 * Message text search, the API half (ID-07 · tm 333.3).
 *
 * The search itself is the database's: `search_events` (migrations
 * 20261023120000 + 20261023140000) runs as the owner of `events` so its LIKE
 * reaches the trigram index, and applies the tenant and the caller's
 * visibility inside, per message, before anything is counted. This module is
 * what every caller goes through to reach it — `GET /chats?query=` and
 * `GET /search` with `types=message` — and adds what the function leaves to its
 * caller:
 *
 *   - **The caller's visibility, resolved here.** `resolveVisibility(…,
 *     'read')` — the same answer `listChats` gets — becomes the function's
 *     `unrestricted`, `group_ids` and `actor_id`. A customer never gets this
 *     far (the routes are agent and bot only), and a customer-shaped
 *     visibility finds nothing even if one did. Internal notes are searched
 *     for agents and bots (ID-07-S2): both read them in the transcript.
 *   - **The rules, checked first.** `messageSearchWords` (`@siyahtus/types`) is
 *     the function's own rule set, so a query it would refuse is a 400 naming
 *     the rule (`details.reason`) instead of a refusal from the database; the
 *     date range likewise (default the 90 days before `date_to`, at most 400).
 *   - **The timeout the function requires.** It cannot time itself out, so it
 *     refuses to run unless the transaction already holds a statement timeout
 *     (55000). `set_config('statement_timeout', …, true)` arms one for the call
 *     only — the previous value is put back afterwards, so the rest of the
 *     request's transaction runs as before.
 *   - **Errors in the API's words.** 54000 (more than 20 000 visible matches) is
 *     a 400 `too_broad`; 57014 (the timeout fired) a 503 `search_timeout`.
 *   - **The snippet.** The function returns the whole message: under
 *     SQL_ASCII `substr` counts bytes, so the ±60 characters are cut here,
 *     where characters are characters, with the same folding the index stored
 *     (`foldSearchChar`) so the cut lands on the match the database found.
 *   - **The cursor.** Opaque, prefixed so a list cursor is not mistaken for a
 *     search one: the last row's millisecond time and message id (the
 *     function's keyset), the total, which an empty follow-up page would
 *     otherwise not know, and how many conversations earlier pages handed out
 *     (at the function's maximum page there is no room for a look-ahead row).
 */
import { Prisma } from '@prisma/client';
import {
  foldSearchChar,
  messageSearchWords,
  MESSAGE_SEARCH_DEFAULT_DAYS,
  MESSAGE_SEARCH_MAX_DAYS,
  MESSAGE_SEARCH_MAX_PAGE_SIZE,
  MESSAGE_SEARCH_SNIPPET_RADIUS,
  MESSAGE_SEARCH_STATEMENT_TIMEOUT_MS,
  parseEventId,
  type MessageSearchHighlight,
  type MessageSearchMatch,
  type MessageSearchRefusal,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { resolveVisibility } from './access.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Searches one account may start per minute, across both routes. */
export const MESSAGE_SEARCHES_PER_MINUTE = 60;

const REFUSAL_MESSAGES: Record<MessageSearchRefusal, string> = {
  too_short: 'query: give at least three characters.',
  too_long: 'query: the query is too long.',
  too_many_words: 'query: at most eight words.',
  no_trigram: 'query: one word needs at least three letters or digits in a row.',
};

export interface MessageSearchInput {
  query: string;
  /** Inclusive; default `MESSAGE_SEARCH_DEFAULT_DAYS` before `to`. */
  from?: Date;
  /** Exclusive; default now. */
  to?: Date;
  limit: number;
  pageId?: string;
}

export interface MessageSearchHit {
  chatId: string;
  match: MessageSearchMatch;
}

export interface MessageSearchPage {
  hits: MessageSearchHit[];
  /** Matching conversations across all pages. */
  total: number;
  nextPageId?: string;
}

interface SearchRow {
  chat_id: string;
  thread_id: string;
  event_id: string;
  created_at: Date;
  recipients: string;
  text: string;
  match_count: number;
  chat_count: number;
}

interface SearchCursor {
  at: Date;
  eventId: string;
  total: number;
  /** Conversations handed out on the pages before this one. */
  seen: number;
}

/**
 * The words a query searches for, or a 400 naming the rule it breaks — before
 * any database work, so the routes can refuse a query without a transaction.
 */
export function messageSearchWordsOrThrow(query: string): string[] {
  const parsed = messageSearchWords(query);
  if (!parsed.ok) {
    throw ApiError.validation(REFUSAL_MESSAGES[parsed.reason], { reason: parsed.reason });
  }
  return parsed.words;
}

/** `[from, to)` with the defaults applied, or a 400. */
export function messageSearchRange(from: Date | undefined, to: Date | undefined, now: Date) {
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - MESSAGE_SEARCH_DEFAULT_DAYS * DAY_MS);
  if (start.getTime() >= end.getTime()) {
    throw ApiError.validation('date_from: must be before date_to.', { reason: 'range_order' });
  }
  if (end.getTime() - start.getTime() > MESSAGE_SEARCH_MAX_DAYS * DAY_MS) {
    throw ApiError.validation(
      `date_from: a search covers at most ${MESSAGE_SEARCH_MAX_DAYS} days.`,
      {
        reason: 'range_too_long',
      },
    );
  }
  return { from: start, to: end };
}

/**
 * One page of conversations whose messages contain every word of the query,
 * newest match first, inside what the caller may see.
 */
export async function searchMessages(
  tx: TenantClient,
  principal: Principal,
  input: MessageSearchInput,
): Promise<MessageSearchPage> {
  const words = messageSearchWordsOrThrow(input.query);
  const range = messageSearchRange(input.from, input.to, new Date());
  const cursor = decodeSearchCursor(input.pageId);

  const visibility = await resolveVisibility(tx, principal, 'read');
  if (visibility.isCustomer) return { hits: [], total: 0 };

  const groups = `{${visibility.groupIds.join(',')}}`;
  // One row past the page says another page exists — except at the function's
  // own maximum, where there is no room for it: there the conversations handed
  // out so far, against the total, say it.
  const fetch = Math.min(input.limit + 1, MESSAGE_SEARCH_MAX_PAGE_SIZE);
  const seen = cursor?.seen ?? 0;
  const [setting] = await tx.$queryRaw<Array<{ previous: string }>>`
    SELECT current_setting('statement_timeout') AS previous`;
  const previous = setting?.previous ?? '0';
  await tx.$executeRaw`
    SELECT set_config('statement_timeout', ${String(MESSAGE_SEARCH_STATEMENT_TIMEOUT_MS)}, true)`;

  let rows: SearchRow[];
  try {
    rows = await tx.$queryRaw<SearchRow[]>`
      SELECT chat_id, thread_id, event_id, created_at, recipients, text, match_count, chat_count
      FROM search_events(
        ${principal.licenseId}::bigint, ${input.query.replace(/\s+/gu, ' ').trim()}::text,
        ${range.from}::timestamptz, ${range.to}::timestamptz,
        ${visibility.unrestricted}::boolean, ${groups}::bigint[], ${visibility.actorId}::text,
        true, ${fetch}::integer,
        ${cursor?.at ?? null}::timestamptz, ${cursor?.eventId ?? null}::text
      )`;
  } catch (error) {
    throw messageSearchError(error);
  }
  // Put back for the rest of the request's transaction — only reached when the
  // search succeeded; a failed statement has aborted the transaction anyway.
  await tx.$executeRaw`SELECT set_config('statement_timeout', ${previous}, true)`;

  const page = rows.slice(0, input.limit);
  const total = page[0]?.chat_count ?? cursor?.total ?? 0;
  const hasMore =
    rows.length > input.limit ||
    (fetch === input.limit && page.length === input.limit && seen + page.length < total);
  const hits = page.map((row) => {
    const { snippet, highlights } = cutSnippet(row.text, words);
    return {
      chatId: row.chat_id,
      match: {
        event_id: row.event_id,
        thread_id: row.thread_id,
        created_at: row.created_at.toISOString(),
        snippet,
        highlights,
        match_count: row.match_count,
        internal: row.recipients === 'agents',
      },
    };
  });
  const last = page.at(-1);
  return {
    hits,
    total,
    ...(hasMore && last
      ? {
          nextPageId: encodeSearchCursor({
            at: last.created_at,
            eventId: last.event_id,
            total,
            seen: seen + page.length,
          }),
        }
      : {}),
  };
}

/**
 * Spend one search from the caller's per-minute budget, or refuse with a 429.
 * Fails open when the limiter is unreachable, like every budget here: the
 * statement timeout still bounds each search.
 */
export async function spendMessageSearch(
  limiter: {
    consume(
      key: string,
      limit: number,
      windowMs: number,
    ): Promise<{ allowed: boolean; resetMs: number }>;
  },
  principal: Principal,
  onUnavailable: (error: unknown) => void,
): Promise<void> {
  const actor =
    principal.kind === 'agent'
      ? principal.accountId
      : principal.kind === 'bot'
        ? principal.botId
        : 'other';
  let decision: { allowed: boolean; resetMs: number };
  try {
    decision = await limiter.consume(
      `rl:msgsearch:${principal.licenseId}:${actor}`,
      MESSAGE_SEARCHES_PER_MINUTE,
      60_000,
    );
  } catch (error) {
    onUnavailable(error);
    return;
  }
  if (!decision.allowed) {
    throw ApiError.tooManyRequests(
      Math.max(1, Math.ceil(decision.resetMs / 1000)),
      'Too many searches; try again in a moment.',
    );
  }
}

/** The function's refusals in the API's words; anything else unchanged. */
export function messageSearchError(error: unknown): unknown {
  switch (sqlStateOf(error)) {
    case '54000':
      return ApiError.validation(
        'query: matches too many messages; add a word or narrow the dates.',
        { reason: 'too_broad' },
      );
    case '57014':
      return new ApiError(
        'service_unavailable',
        'The search took too long; add a word or narrow the dates.',
        { details: { reason: 'search_timeout' }, cause: error },
      );
    // 22023 is not mapped: every rule it enforces is checked above first, so
    // reaching it means the two drifted — a defect, answered as one (500).
    default:
      return error;
  }
}

function sqlStateOf(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const code = (error.meta as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

const CURSOR_PREFIX = 'msg';

function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(
    `${CURSOR_PREFIX}|${cursor.at.toISOString()}|${cursor.eventId}|${cursor.total}|${cursor.seen}`,
  ).toString('base64url');
}

const COUNT = /^\d{1,9}$/;

/** The page a cursor names, or a 400 — a list cursor here is a client bug, not a fresh start. */
function decodeSearchCursor(pageId: string | undefined): SearchCursor | null {
  if (pageId === undefined) return null;
  const [prefix, iso, eventId, total, seen, extra] = Buffer.from(pageId, 'base64url')
    .toString('utf8')
    .split('|');
  const at = new Date(iso ?? '');
  if (
    prefix !== CURSOR_PREFIX ||
    extra !== undefined ||
    Number.isNaN(at.getTime()) ||
    !eventId ||
    !parseEventId(eventId) ||
    !COUNT.test(total ?? '') ||
    !COUNT.test(seen ?? '')
  ) {
    throw ApiError.validation('page_id: not a page of this search.', { reason: 'invalid_page' });
  }
  return { at, eventId, total: Number(total), seen: Number(seen) };
}

/**
 * The message around its first match, and where every word sits in the cut.
 *
 * Matching runs on the folded text (`foldSearchChar`, the function the index
 * stored), with a map from each folded character back to the original one, so
 * the ranges point into the text as written — "İSTANBUL" is highlighted whole
 * when "istanbul" was searched. A word's occurrences are taken left to right
 * without overlap; ranges of different words that touch or overlap merge.
 */
export function cutSnippet(
  text: string,
  words: readonly string[],
  radius: number = MESSAGE_SEARCH_SNIPPET_RADIUS,
): { snippet: string; highlights: MessageSearchHighlight[] } {
  // For every folded code unit, the original character it came from.
  let folded = '';
  const spans: MessageSearchHighlight[] = [];
  let offset = 0;
  for (const ch of text) {
    const out = foldSearchChar(ch);
    for (let k = 0; k < out.length; k += 1) spans.push({ start: offset, end: offset + ch.length });
    folded += out;
    offset += ch.length;
  }

  const ranges: MessageSearchHighlight[] = [];
  for (const word of words) {
    if (word === '') continue;
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + word.length)) {
      const first = spans[at];
      const last = spans[at + word.length - 1];
      if (first && last) ranges.push({ start: first.start, end: last.end });
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: MessageSearchHighlight[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }

  const anchor = merged[0] ?? { start: 0, end: 0 };
  let start = Math.max(0, anchor.start - radius);
  let end = Math.min(text.length, anchor.end + radius);
  // Never split a surrogate pair at either edge.
  if (start > 0 && isLowSurrogate(text.charCodeAt(start))) start -= 1;
  if (end < text.length && isLowSurrogate(text.charCodeAt(end))) end += 1;

  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const shift = prefix.length - start;
  const highlights = merged
    .filter((range) => range.end > start && range.start < end)
    .map((range) => ({
      start: Math.max(range.start, start) + shift,
      end: Math.min(range.end, end) + shift,
    }));
  return { snippet: `${prefix}${text.slice(start, end)}${suffix}`, highlights };
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
