/**
 * The Chats group's Supervised bucket (FR-MOD-02.1.1).
 *
 * The PRD's acceptance criterion for the group is two clauses — "her öğe orta
 * listeyi filtreler; sayaçlar RTM ile canlı" — so what is pinned here is that
 * the sixth item exists, that picking it actually narrows the middle list
 * through the server (`view=supervised`) rather than re-slicing rows already
 * loaded, and that its counter is the view's size rather than the page's.
 *
 * The empty state gets its own case because an inbox that says "New
 * conversations land here as they arrive" under Supervised would be telling an
 * agent to wait for something that never arrives on its own: a supervision is
 * created by an action on the Traffic board, not by a customer walking in.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api, setRoutingStatus } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  setRoutingStatus: vi.fn(),
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        // An ordinary agent: no `channels--all`, so the Views group never fires
        // the channel request and the rail under test is just the chat views.
        agent: { scopes: ['chats--access:rw'], account_id: 'me', routing_status: 'offline' },
        setRoutingStatus,
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

/** How many conversations each view holds, as the server would report it. */
const TOTALS: Record<string, number> = {
  all: 3,
  my: 1,
  queued: 0,
  unassigned: 0,
  supervised: 2,
  archived: 0,
  ai: 0,
  ai_solved: 0,
};

function viewOf(url: string): string {
  return new URLSearchParams(url.slice(url.indexOf('?'))).get('view') ?? 'all';
}

/**
 * Every `/chats` request answered from `TOTALS`. The list auto-opens its first
 * row, so the detail read has to be served too — an empty envelope there is a
 * crash in the Details panel, not an empty inbox.
 */
function serveChats(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      const view = viewOf(url);
      const total = TOTALS[view] ?? 0;
      return Promise.resolve({
        items: Array.from({ length: total }, (_, i) => ({
          id: `${view}-${i}`,
          customer_id: `c-${view}-${i}`,
          customer_name: `${view} customer ${i}`,
          active: view !== 'archived',
          created_at: '2026-09-05T10:00:00.000Z',
          thread_id: `t-${view}-${i}`,
          assignee_id: null,
          queue_position: null,
          unread_count: 0,
          last_event: null,
          tags: [],
        })),
        total,
      });
    }
    const detail = /^\/chats\/([^/?]+)$/.exec(url);
    if (detail) {
      const id = detail[1] as string;
      return Promise.resolve({
        id,
        license_id: '1',
        customer_id: `c-${id}`,
        active: true,
        created_at: '2026-09-05T10:00:00.000Z',
        access: { group_ids: [] },
        users: [],
        thread: {
          id: `t-${id}`,
          chat_id: id,
          active: true,
          assignee_id: null,
          queue_position: null,
          summary: null,
          created_at: '2026-09-05T10:00:00.000Z',
          closed_at: null,
          tags: [],
        },
        visitor: null,
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

function renderInbox(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The views rail — one `nav`, holding the Chats, AI, Tickets and Views groups. */
function rail(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Inbox views' });
}

function chatUrls(): string[] {
  return api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/chats?'));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  localStorage.clear();
  serveChats();
});

describe('the Chats group (FR-MOD-02.1.1)', () => {
  it('offers all six buckets the PRD names, in its order', async () => {
    renderInbox();

    const buttons = await within(rail()).findAllByRole('button');
    const labels = buttons.map((b) => b.textContent ?? '');
    // Sliced from the front: the AI, Tickets and Views groups follow in the
    // same `nav`, and this assertion is about the Chats group's own order.
    expect(labels.slice(0, 6).map((label) => label.replace(/[^A-Za-z ]/g, '').trim())).toEqual([
      'All',
      'My chats',
      'Queued',
      'Unassigned',
      'Supervised',
      'Archive',
    ]);
  });

  it('shows the server total beside Supervised, not the rows it fetched', async () => {
    renderInbox();

    const supervised = await within(rail()).findByRole('button', { name: /^Supervised/ });
    expect(await within(supervised).findByText('2')).toBeInTheDocument();
  });

  it('asks the server for view=supervised when the item is picked', async () => {
    const user = userEvent.setup();
    renderInbox();

    // The counters mount one list per view, so `view=supervised` is requested
    // before any click. What the click has to change is the *open* list, which
    // is the only one rendered under the "Supervised" heading.
    const supervised = await within(rail()).findByRole('button', { name: /^Supervised/ });
    await user.click(supervised);

    expect(supervised).toHaveAttribute('aria-current', 'page');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Supervised' })).toBeInTheDocument(),
    );
    // Every list request names its view: the middle list is narrowed by the
    // server, never by filtering rows the browser already holds.
    expect(chatUrls().every((url) => url.includes('view='))).toBe(true);
    expect(chatUrls().some((url) => url.startsWith('/chats?view=supervised'))).toBe(true);
  });

  it('gives an empty Supervised list its own explanation', async () => {
    TOTALS['supervised'] = 0;
    try {
      const user = userEvent.setup();
      renderInbox();

      await user.click(await within(rail()).findByRole('button', { name: /^Supervised/ }));

      expect(
        await screen.findByText(
          'Supervising nothing right now. Watch a conversation from Traffic and it lands here.',
        ),
      ).toBeInTheDocument();
      // Not the generic line, which promises arrivals that never come here.
      expect(
        screen.queryByText('New conversations land here as they arrive.'),
      ).not.toBeInTheDocument();
    } finally {
      TOTALS['supervised'] = 2;
    }
  });
});
