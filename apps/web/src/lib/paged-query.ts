/**
 * One place that knows how this API paginates (NFR-P5 / FR-EK-B.1).
 *
 * Every list endpoint returns the same envelope — `items`, an optional `total`
 * for the whole filter, and `next_page_id` that is absent on the last page
 * (`packages/contract/openapi/paths/*.yaml`). The server has paged with an
 * opaque keyset cursor since P6, but the client mostly sent one fixed `limit`
 * and dropped `next_page_id` on the floor, so the 51st chat simply did not
 * exist for the UI. Two screens (Audit log, Apps marketplace) did chain pages,
 * and each re-derived the same `useInfiniteQuery` wiring by hand.
 *
 * This wrapper is that wiring, once: give it a query key and a function that
 * builds the URL for a page id, get back the accumulated rows plus the three
 * controls a list needs (`hasNext`, `isFetchingNext`, `fetchNext`).
 *
 * Two deliberate non-features:
 *
 *   - It does not know the *name* of the cursor parameter. The transcript pages
 *     backwards with `before_event_id` while everything else sends `page_id`
 *     (chats.yaml `listEvents`), so the caller's `buildUrl` owns that choice.
 *   - It does not reverse or de-duplicate. `items` is the pages in arrival
 *     order; a reverse-scrolling transcript reads `pages` and flattens it its
 *     own way rather than fighting a flag here.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { useApiClient } from './auth-store.js';

/** The list envelope every paginated endpoint in the contract returns. */
export interface PagedResponse<T> {
  items: T[];
  /** Rows matching the current filter across all pages; only some lists send it. */
  total?: number;
  /** Absent on the last page — that absence is what ends the chain. */
  next_page_id?: string;
}

export interface PagedQueryOptions {
  /**
   * Cache key. Every filter the URL depends on belongs in here: it is what
   * keeps a page chain from one filter accumulating onto another's.
   */
  queryKey: readonly unknown[];
  /** The request for one page. `pageId` is `undefined` for the first one. */
  buildUrl: (pageId: string | undefined) => string;
  /** Runs the query when true (default); false leaves it idle, e.g. behind a scope check. */
  enabled?: boolean;
  staleTime?: number;
  /** Poll interval; refetches the pages already loaded, not just the first. */
  refetchInterval?: number | false;
}

export interface PagedQueryResult<T> {
  /** Every row fetched so far, pages flattened in arrival order. */
  items: T[];
  /** The raw pages, for callers that need page boundaries (reverse scroll). */
  pages: PagedResponse<T>[];
  /** The newest `total` the server reported, or undefined if this list sends none. */
  total: number | undefined;
  /** True while another page exists to fetch. */
  hasNext: boolean;
  isFetchingNext: boolean;
  /** Asks for the next page. Safe to call from a scroll handler — see below. */
  fetchNext: () => void;
  /** No page has arrived yet (first load, or a refetch of an empty cache). */
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  /** Re-requests every page already loaded, keeping the chain's length. */
  refetch: () => void;
}

/**
 * `useInfiniteQuery` over the contract's list envelope.
 *
 * `fetchNext` is single-flight, and that is the point of it existing rather
 * than handing `fetchNextPage` straight to the caller. Two guards, because they
 * fail differently:
 *
 *   - `isFetchingNext` comes from React state, so two calls in the *same* tick
 *     (a scroll handler firing twice before React re-renders) both read it as
 *     false. TanStack's `fetchNextPage` defaults to `cancelRefetch: true`, so
 *     the second call aborts the first and re-requests the identical cursor.
 *   - The ref flips synchronously, which closes exactly that window, and is
 *     cleared when the request settles — including on failure, so a dropped
 *     page can be retried rather than wedging the list shut.
 *
 * A call with no next page is a no-op: a list that has reached its end can keep
 * asking as the reader scrolls the last screenful, and no request is made.
 */
export function usePagedQuery<T>({
  queryKey,
  buildUrl,
  enabled = true,
  staleTime,
  refetchInterval,
}: PagedQueryOptions): PagedQueryResult<T> {
  const api = useApiClient();

  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<PagedResponse<T>>(buildUrl(pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PagedResponse<T>) => lastPage.next_page_id,
    enabled,
    ...(staleTime != null ? { staleTime } : {}),
    ...(refetchInterval != null ? { refetchInterval } : {}),
  });

  const pages = useMemo(() => query.data?.pages ?? [], [query.data]);
  const items = useMemo(() => pages.flatMap((page) => page.items), [pages]);

  // The last page that reported one wins: `total` tracks the current filter, so
  // the freshest response is the honest number to show beside it.
  const total = useMemo(() => {
    for (let i = pages.length - 1; i >= 0; i -= 1) {
      const value = pages[i]?.total;
      if (value != null) return value;
    }
    return undefined;
  }, [pages]);

  const inFlight = useRef(false);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;

  const fetchNext = useCallback((): void => {
    if (!hasNextPage || isFetchingNextPage || inFlight.current) return;
    inFlight.current = true;
    // Both arms, not `finally`: a rejected page has to clear the guard too, and
    // `void p.finally()` would leave that rejection unhandled. The failure
    // itself is already on `error`.
    const settle = (): void => {
      inFlight.current = false;
    };
    void fetchNextPage().then(settle, settle);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const refetchAll = useCallback((): void => {
    void refetch();
  }, [refetch]);

  return {
    items,
    pages,
    total,
    hasNext: hasNextPage,
    isFetchingNext: isFetchingNextPage,
    fetchNext,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: refetchAll,
  };
}
