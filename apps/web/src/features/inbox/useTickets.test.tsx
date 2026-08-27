/**
 * The paged Tickets grid (PRD FR-MOD-02.7, NFR-P5). `ticket-grid.test.ts`
 * proves the sort maths itself; what belongs here is the paging wiring around
 * it — a scrolled grid asks for the next page, and a sort change starts a
 * fresh chain from page one rather than resorting a stale, partial window
 * (`ticketsKey` folds `sort` into the cache key for exactly that reason).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTicketList } from './useTickets.js';
import { DEFAULT_TICKET_SORT, type TicketSort } from './ticket-grid.js';
import type { PagedResponse } from '../../lib/paged-query.js';
import type { Ticket } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

function ticket(id: string, over: Partial<Ticket> = {}): Ticket {
  return {
    id,
    subject: `Ticket ${id}`,
    status: 'open',
    priority: 0,
    assignee_id: null,
    assignee_name: null,
    group_id: null,
    customer_id: `customer-${id}`,
    customer_name: id,
    customer_email: null,
    source_chat_id: null,
    merged_into_id: null,
    last_message_at: '2026-08-27T10:00:00.000Z',
    created_at: '2026-08-27T09:00:00.000Z',
    ...over,
  };
}

function ticketPage(items: Ticket[], next?: string): PagedResponse<Ticket> {
  return { items, total: items.length, ...(next != null ? { next_page_id: next } : {}) };
}

function renderTickets(sort: TicketSort = DEFAULT_TICKET_SORT) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = renderHook(({ s }: { s: TicketSort }) => useTicketList('all', s, true), {
    initialProps: { s: sort },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, queryClient };
}

describe('useTicketList — paging', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it('walks past the first page', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=cursor-1')
          ? ticketPage([ticket('TCK3')])
          : ticketPage([ticket('TCK1'), ticket('TCK2')], 'cursor-1'),
      ),
    );

    const { result } = renderTickets();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasNext).toBe(true);

    act(() => {
      result.current.fetchNext();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map((t) => t.id)).toEqual(['TCK1', 'TCK2', 'TCK3']);
    expect(result.current.hasNext).toBe(false);
  });

  it('a sort change starts a new chain instead of resorting a partial window', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=cursor-1')
          ? ticketPage([ticket('TCK3')])
          : ticketPage([ticket('TCK1'), ticket('TCK2')], 'cursor-1'),
      ),
    );

    const { result, rerender } = renderTickets();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => {
      result.current.fetchNext();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    api.get.mockClear();
    rerender({ s: { key: 'subject', order: 'asc' } });

    // The old chain's second page is gone rather than resorted — the grid is
    // back to page one under the new sort's cache key.
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasNext).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(String(api.get.mock.calls[0]?.[0])).not.toContain('page_id=');
  });
});
