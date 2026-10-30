/**
 * The widget's "Help" tab (WG-12 · tm 348): a visitor searches the workspace's
 * published knowledge base articles without opening a chat. The bounds below
 * are shared by the API (`GET /customer/kb/search`), the database function that
 * runs the search (`kb_search_published`) and the widget's search box, so the
 * three refuse and accept the same queries.
 *
 * Constants only. The widget's lazily loaded help module keeps its own copies
 * (`apps/widget/src/help.ts`, held equal by its test): a second importer of this
 * package's entry would split the entry's top-level statements into a chunk
 * every page fetches.
 */

/** The longest query the search accepts, in characters. */
export const KB_SEARCH_QUERY_MAX = 200;

/**
 * The shortest query worth sending. One letter matches every article that has
 * a word starting with it (the search is by word prefix), which is a list, not
 * an answer.
 */
export const KB_SEARCH_QUERY_MIN = 2;

/** How many words of a query count; the rest are ignored. */
export const KB_SEARCH_MAX_WORDS = 8;

/** Results per search: a short list that fits the widget's panel. */
export const KB_SEARCH_LIMIT = { default: 10, max: 20 } as const;
