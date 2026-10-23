/**
 * Message text search (ID-07 · tm 333): the bounds `search_events` holds a
 * search to (migration 20261023120000_search_events).
 *
 * The database function is where they are enforced — whatever reaches it
 * outside them is refused (22023, or 54000 past the match cap) — and
 * `search-events.test.ts` checks the function against these values, so the two
 * cannot drift apart. The API validates against the same numbers before it
 * asks, so a caller learns which rule a query broke from a 400 rather than from
 * a refusal in the database.
 */

/** Days searched back from the end of the range when no start is given (ID-07-S1). */
export const MESSAGE_SEARCH_DEFAULT_DAYS = 90;

/** The longest range one search may cover; it also bounds how many monthly partitions it opens. */
export const MESSAGE_SEARCH_MAX_DAYS = 400;

/**
 * At least one word must hold this many letters or digits in a row once folded
 * (`siyahtus_search_fold`): a trigram is made of three, and a query without one
 * gives the index nothing to narrow the search with.
 */
export const MESSAGE_SEARCH_MIN_RUN = 3;

/** Distinct words in one query; a message must contain every one of them. */
export const MESSAGE_SEARCH_MAX_WORDS = 8;

/** Conversations on a page when none is asked for. */
export const MESSAGE_SEARCH_PAGE_SIZE = 50;

/** The most conversations one page may hold. */
export const MESSAGE_SEARCH_MAX_PAGE_SIZE = 100;

/**
 * The longest `statement_timeout` a search may run under. The function cannot
 * time itself out — PostgreSQL arms the timer when the calling statement starts
 * — so it refuses to run unless the caller's transaction already holds a
 * timeout between 1 ms and this (`SET LOCAL statement_timeout` before the call).
 */
export const MESSAGE_SEARCH_MAX_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Matching messages, among those the caller may see, that one search may read.
 * A result groups matches by conversation and names each one's newest, so it
 * has to see all of them; past this many the search is refused as too broad
 * rather than answered from an arbitrary part of the matches.
 */
export const MESSAGE_SEARCH_MATCH_CAP = 20_000;

/** The longest query, in UTF-8 bytes — the function refuses anything longer. */
export const MESSAGE_SEARCH_MAX_QUERY_BYTES = 1000;

/** The shortest query the API accepts: one trigram's worth (`MESSAGE_SEARCH_MIN_RUN`). */
export const MESSAGE_SEARCH_MIN_QUERY_LENGTH = 3;

/** Characters kept either side of the match in a result's snippet. */
export const MESSAGE_SEARCH_SNIPPET_RADIUS = 60;

/**
 * The `statement_timeout` the API arms before it calls the function — inside
 * `MESSAGE_SEARCH_MAX_STATEMENT_TIMEOUT_MS`, and far above what a search that
 * passes the match cap takes (tens to low hundreds of milliseconds, measured in
 * tm 333.2), so only a search reading a pathological share of other teams' or
 * workspaces' matches meets it.
 */
export const MESSAGE_SEARCH_STATEMENT_TIMEOUT_MS = 5_000;

/**
 * What `siyahtus_search_fold` replaces before it lower-cases (migration
 * 20261023100000_event_text_search_index), so the API cuts snippets and finds
 * matches with the same folding the index stored. The combining dot above
 * (U+0307, what "İ" leaves behind after a Unicode lower-casing) folds to
 * nothing. Lower-casing after it is the C locale's: ASCII `A`–`Z` only.
 */
export const MESSAGE_SEARCH_FOLD: Readonly<Record<string, string>> = {
  İ: 'i',
  ı: 'i',
  Î: 'i',
  î: 'i',
  Ç: 'c',
  ç: 'c',
  Ğ: 'g',
  ğ: 'g',
  Ö: 'o',
  ö: 'o',
  Ş: 's',
  ş: 's',
  Ü: 'u',
  ü: 'u',
  Û: 'u',
  û: 'u',
  Â: 'a',
  â: 'a',
  '\u0307': '',
};

/** One character the way `siyahtus_search_fold` folds it: replaced, else ASCII lower-cased. */
export function foldSearchChar(ch: string): string {
  const replaced = MESSAGE_SEARCH_FOLD[ch];
  if (replaced !== undefined) return replaced;
  const code = ch.charCodeAt(0);
  return ch.length === 1 && code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
}

/** A text the way `siyahtus_search_fold` folds it. */
export function foldForMessageSearch(text: string): string {
  let out = '';
  for (const ch of text) out += foldSearchChar(ch);
  return out;
}

export type MessageSearchRefusal = 'too_short' | 'too_long' | 'too_many_words' | 'no_trigram';

export type MessageSearchWords =
  { ok: true; query: string; words: string[] } | { ok: false; reason: MessageSearchRefusal };

/**
 * A query the way the function will read it, or the rule it breaks.
 *
 * Every Unicode space (a pasted no-break space included) becomes one ASCII
 * space and the ends are trimmed — the function splits on ASCII whitespace
 * only — then the words are folded and duplicates dropped. The rules are the
 * function's own (22023 there), checked here so a caller learns which one a
 * query broke: at least `MESSAGE_SEARCH_MIN_QUERY_LENGTH` characters, at most
 * `MESSAGE_SEARCH_MAX_QUERY_BYTES`, at most `MESSAGE_SEARCH_MAX_WORDS` distinct
 * words, and one word holding `MESSAGE_SEARCH_MIN_RUN` letters or digits in a
 * row once folded.
 */
export function messageSearchWords(raw: string): MessageSearchWords {
  const query = raw.replace(/\s+/gu, ' ').trim();
  if ([...query].length < MESSAGE_SEARCH_MIN_QUERY_LENGTH)
    return { ok: false, reason: 'too_short' };
  if (new TextEncoder().encode(query).length > MESSAGE_SEARCH_MAX_QUERY_BYTES) {
    return { ok: false, reason: 'too_long' };
  }
  const words: string[] = [];
  for (const word of query.split(' ')) {
    const folded = foldForMessageSearch(word);
    if (folded !== '' && !words.includes(folded)) words.push(folded);
  }
  if (words.length > MESSAGE_SEARCH_MAX_WORDS) return { ok: false, reason: 'too_many_words' };
  if (!words.some((word) => /[a-z0-9]{3}/.test(word))) return { ok: false, reason: 'no_trigram' };
  return { ok: true, query, words };
}

/** A character range `[start, end)` inside a snippet. */
export interface MessageSearchHighlight {
  start: number;
  end: number;
}

/**
 * The message a conversation was found by (`GET /chats?query=` items'
 * `match`): its newest matching message, cut to a snippet around the match.
 */
export interface MessageSearchMatch {
  event_id: string;
  thread_id: string;
  created_at: string;
  /** Up to `MESSAGE_SEARCH_SNIPPET_RADIUS` characters either side of the first match; `…` where cut. */
  snippet: string;
  /** Where the query's words sit in `snippet`, in order, never overlapping. */
  highlights: MessageSearchHighlight[];
  /** Matching messages in the conversation, the shown one included. */
  match_count: number;
  /** True when the message is an internal note (`recipients = 'agents'`). */
  internal: boolean;
}
