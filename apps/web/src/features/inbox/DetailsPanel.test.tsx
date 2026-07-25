/**
 * The Details panel's visitor context (FR-MOD-02.4).
 *
 * The two sections it adds — Visited pages and Visit info — must render the
 * visit when there is one and an explicit empty state when there is not: a
 * blank rectangle reads as a loading bug, not as "this visitor is anonymous".
 * The tag library query is stubbed to nothing; it is another test's concern.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailsPanel } from './DetailsPanel.js';
import type { ChatDetail, ChatVisitor } from './types.js';

function baseChat(visitor?: ChatVisitor | null): ChatDetail {
  return {
    id: 'TJ1H8CFKRV',
    license_id: '1000003',
    customer_id: 'cust-1',
    active: true,
    created_at: '2026-07-20T10:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: 'TH1',
      chat_id: 'TJ1H8CFKRV',
      active: true,
      assignee_id: null,
      queue_position: null,
      summary: null,
      created_at: '2026-07-20T10:00:00.000Z',
      closed_at: null,
      tags: [],
    },
    ...(visitor !== undefined ? { visitor } : {}),
  };
}

function renderPanel(chat: ChatDetail) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DetailsPanel chat={chat} chatId={chat.id} />
    </QueryClientProvider>,
  );
}

/** Locate a "label / value" row inside the panel by its label text. */
function rowValue(label: string): HTMLElement {
  const row = screen.getByText(label).closest('div');
  if (!row) throw new Error(`no row for ${label}`);
  return row as HTMLElement;
}

beforeEach(() => {
  // The panel fetches the tag library on mount; keep it quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: [] }),
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DetailsPanel visitor context', () => {
  it('lists the visited pages and the visit summary', () => {
    renderPanel(
      baseChat({
        visited_pages: [
          { url: 'https://shop.example/bikes', at: '2026-07-20T10:00:00.000Z' },
          { url: 'https://shop.example/bikes/brakes' },
        ],
        visit_info: {
          device: 'Chrome on macOS',
          referrer: 'https://google.com/search',
          duration_seconds: 200,
          ip: '203.0.113.7',
        },
      }),
    );

    // Both pages appear, shown as their path and linking to the full URL.
    const brakes = screen.getByRole('link', { name: '/bikes/brakes' });
    expect(brakes).toHaveAttribute('href', 'https://shop.example/bikes/brakes');
    expect(screen.getByRole('link', { name: '/bikes' })).toBeInTheDocument();

    // The summary rows carry the derived values.
    expect(within(rowValue('Device')).getByText('Chrome on macOS')).toBeInTheDocument();
    expect(within(rowValue('IP')).getByText('203.0.113.7')).toBeInTheDocument();
    // 200s renders as minutes and seconds, not a raw count.
    expect(within(rowValue('Duration')).getByText('3m 20s')).toBeInTheDocument();
  });

  it('shows an empty state for a visitor with no recorded visit', () => {
    renderPanel(baseChat(null));

    expect(screen.getByText('No pages recorded for this visitor.')).toBeInTheDocument();
    expect(screen.getByText('No visit information yet.')).toBeInTheDocument();
    // The section headings are still present — the panel does not hide them.
    expect(screen.getByText('Visited pages')).toBeInTheDocument();
    expect(screen.getByText('Visit info')).toBeInTheDocument();
  });

  it('falls back to "Direct" and a dash when fields are missing', () => {
    renderPanel(
      baseChat({
        visited_pages: [],
        visit_info: { device: null, referrer: null, duration_seconds: null, ip: null },
      }),
    );

    // A visit exists, so the info rows render — with sensible placeholders.
    expect(within(rowValue('Referring')).getByText('Direct')).toBeInTheDocument();
    expect(within(rowValue('Duration')).getByText('—')).toBeInTheDocument();
    // …but with no pages, the pages section still shows its empty state.
    expect(screen.getByText('No pages recorded for this visitor.')).toBeInTheDocument();
  });
});
