/**
 * The chat list sort control — Oldest / Newest (PRD FR-MOD-02.2.1).
 *
 * Unlike the Tickets grid (`ticket-grid.ts`), which re-orders an already-loaded
 * page client-side, this asks the server for a different page chain: the list
 * is keyset-paginated by the server's own order, and `GET /chats`'s `sort`
 * param (`chats.ts`, `newest`/`oldest`) already exists for it — re-sorting a
 * partial window client-side would be honest for a grid but not for a list
 * that keeps paging past what is loaded. The choice lives in the URL so a
 * sorted list is shareable and survives a reload, the same "URL is the source
 * of truth" the grid's sort already established.
 */
export type ChatSort = 'newest' | 'oldest';

export const CHAT_SORT_PARAM = 'chat_sort';

/** Matches the server's own default (`listQuery`'s `sort`). */
export const DEFAULT_CHAT_SORT: ChatSort = 'newest';

/** Tolerates a missing or garbled param — anything but the literal `oldest` reads as the default. */
export function parseChatSort(params: URLSearchParams): ChatSort {
  return params.get(CHAT_SORT_PARAM) === 'oldest' ? 'oldest' : DEFAULT_CHAT_SORT;
}

/**
 * A copy of `params` with the sort written in. Omitted entirely at the
 * default so a plain inbox URL stays free of it — there is nothing to share
 * or restore that reload would not already give back.
 */
export function writeChatSort(params: URLSearchParams, sort: ChatSort): URLSearchParams {
  const next = new URLSearchParams(params);
  if (sort === DEFAULT_CHAT_SORT) next.delete(CHAT_SORT_PARAM);
  else next.set(CHAT_SORT_PARAM, sort);
  return next;
}
