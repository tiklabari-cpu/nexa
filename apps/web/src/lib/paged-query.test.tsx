/**
 * The properties every paginated list now leans on (NFR-P5):
 *
 *   1. Pages chain — `next_page_id` comes back as the next request's cursor and
 *      the rows accumulate, so the 51st row exists at all.
 *   2. `fetchNext` is single-flight — two calls in one tick request one page,
 *      not the same cursor twice.
 *   3. A list at its end stops asking — `hasNext` false makes `fetchNext` a
 *      no-op, which is what lets a scroll handler call it freely.
 *
 * The API client is mocked at the `useApiClient` seam (the `useMarkSeen` test's
 * shape), so these assert the wiring rather than HTTP.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePagedQuery, type PagedQueryOptions, type PagedResponse } from './paged-query.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('./auth-store.js', () => ({
  useApiClient: () => api,
}));

interface Row {
  id: string;
}

function page(ids: string[], next?: string, total?: number): PagedResponse<Row> {
  return {
    items: ids.map((id) => ({ id })),
    ...(next != null ? { next_page_id: next } : {}),
    ...(total != null ? { total } : {}),
  };
}

/** A promise plus the handle that settles it, for holding a page in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderPaged(overrides: Partial<PagedQueryOptions> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(
    () =>
      usePagedQuery<Row>({
        queryKey: ['rows'],
        buildUrl: (pageId) => (pageId ? `/rows?page_id=${pageId}` : '/rows'),
        ...overrides,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  api.get.mockReset();
});

describe('usePagedQuery', () => {
  it('chains pages on next_page_id and accumulates the rows', async () => {
    api.get
      .mockResolvedValueOnce(page(['a', 'b'], 'cursor-1'))
      .mockResolvedValueOnce(page(['c', 'd'], 'cursor-2'))
      .mockResolvedValueOnce(page(['e']));

    const { result } = renderPaged();

    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(api.get).toHaveBeenCalledWith('/rows');
    expect(result.current.hasNext).toBe(true);

    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(api.get).toHaveBeenLastCalledWith('/rows?page_id=cursor-1');

    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.items).toHaveLength(5));
    expect(api.get).toHaveBeenLastCalledWith('/rows?page_id=cursor-2');

    // No `next_page_id` on the last page — that absence is what ends the chain.
    expect(result.current.hasNext).toBe(false);
    expect(result.current.items.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(result.current.pages).toHaveLength(3);
  });

  it('requests one page when fetchNext is called twice in the same tick', async () => {
    const second = deferred<PagedResponse<Row>>();
    api.get.mockResolvedValueOnce(page(['a'], 'cursor-1')).mockReturnValueOnce(second.promise);

    const { result } = renderPaged();
    await waitFor(() => expect(result.current.hasNext).toBe(true));
    expect(api.get).toHaveBeenCalledTimes(1);

    // React has not re-rendered between these two, so `isFetchingNext` still
    // reads false for the second call: only the synchronous ref guard stops it.
    act(() => {
      result.current.fetchNext();
      result.current.fetchNext();
    });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith('/rows?page_id=cursor-1');

    // Still one request while that page is in flight, in later ticks too.
    act(() => result.current.fetchNext());
    expect(api.get).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.resolve(page(['b']));
      await second.promise;
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('re-arms after a failed page so a dropped request can be retried', async () => {
    api.get
      .mockResolvedValueOnce(page(['a'], 'cursor-1'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(page(['b']));

    const { result } = renderPaged();
    await waitFor(() => expect(result.current.hasNext).toBe(true));

    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.items).toHaveLength(1);

    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it('does nothing when there is no next page', async () => {
    api.get.mockResolvedValue(page(['a', 'b']));

    const { result } = renderPaged();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.hasNext).toBe(false);

    act(() => {
      result.current.fetchNext();
      result.current.fetchNext();
    });

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('stays idle while disabled', () => {
    api.get.mockResolvedValue(page(['a']));

    const { result } = renderPaged({ enabled: false });

    act(() => result.current.fetchNext());
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });

  it('reports the freshest total the server sent', async () => {
    api.get
      .mockResolvedValueOnce(page(['a'], 'cursor-1', 120))
      .mockResolvedValueOnce(page(['b'], undefined, 118));

    const { result } = renderPaged();
    await waitFor(() => expect(result.current.total).toBe(120));

    act(() => result.current.fetchNext());
    await waitFor(() => expect(result.current.total).toBe(118));
  });

  it('leaves total undefined for lists that do not send one', async () => {
    api.get.mockResolvedValue(page(['a']));

    const { result } = renderPaged();
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.total).toBeUndefined();
  });

  it('surfaces a failed first page as an error rather than an empty list', async () => {
    api.get.mockRejectedValue(new Error('boom'));

    const { result } = renderPaged();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('boom');
    expect(result.current.items).toEqual([]);
  });
});
