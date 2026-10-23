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
