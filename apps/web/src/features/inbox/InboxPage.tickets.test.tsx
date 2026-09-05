/**
 * The Tickets group's fourth item, and its error-empty state (FR-MOD-02.1.3).
 *
 * The PRD names four items — All, Unassigned, My open, More (grid) — but the
 * rail had grown a `solved` filter in the fourth slot instead of `More`. Both
 * survive here rather than one replacing the other: `solved` is a filter
 * agents already rely on today, and `more` is added as a fifth item — a
 * doorway into the same grid every button already opens directly (there is
 * no separate compact preview to expand from), so it never carries `active`
 * and simply lands on `all`, same as rapor-1's own
 * `grid/{all|unassigned|my-open}` route with no prior context.
 *
 * The KK's other named case is the literal string `"Ticket views unavailable"`,
 * which the grid must show when the tickets list request itself fails — not
 * when a filter is honestly empty, and without disturbing the chat list, which
 * keeps fetching in the background regardless of which pane is on screen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

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
        // the channel request and the rail under test is just the ticket views.
        agent: { scopes: ['chats--access:rw'], account_id: 'me', routing_status: 'offline' },
        setRoutingStatus,
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

const CHAT_DETAIL = {
  id: 'chat-1',
  license_id: '1',
  customer_id: 'c-1',
  active: true,
  created_at: '2026-09-05T10:00:00.000Z',
  access: { group_ids: [] },
  users: [],
  thread: {
    id: 't-1',
    chat_id: 'chat-1',
    active: true,
    assignee_id: null,
    queue_position: null,
    summary: null,
    created_at: '2026-09-05T10:00:00.000Z',
    closed_at: null,
    tags: [],
  },
  visitor: null,
};

/** One chat (so the transcript pane has something loaded) plus an empty ticket list. */
function serveChats(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      return Promise.resolve({
        items: [
          {
            id: 'chat-1',
            customer_id: 'c-1',
            customer_name: 'Ada',
            active: true,
            created_at: '2026-09-05T10:00:00.000Z',
            thread_id: 't-1',
            assignee_id: null,
            queue_position: null,
            unread_count: 0,
            last_event: null,
            tags: [],
          },
        ],
        total: 1,
      });
    }
    if (url === '/chats/chat-1') {
      return Promise.resolve(CHAT_DETAIL);
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

/** The conversation list — scoped so "Ada" is unambiguous against the transcript header. */
function chatList(): HTMLElement {
  return screen.getByRole('region', { name: 'Conversations' });
}

function ticketUrls(): string[] {
  return api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/tickets?'));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  localStorage.clear();
  serveChats();
});

describe('the Tickets group (FR-MOD-02.1.3)', () => {
  it('keeps the working Solved filter and adds More as a fifth item', async () => {
    renderInbox();

    const buttons = await within(rail()).findAllByRole('button');
    const labels = buttons.map((b) => b.textContent ?? '');
    const start = labels.findIndex((label) => label.includes('All tickets'));
    const ticketLabels = labels
      .slice(start, start + 5)
      .map((label) => label.replace(/[^A-Za-z ]/g, '').trim());
    expect(ticketLabels).toEqual(['All tickets', 'Unassigned', 'My open', 'Solved', 'More']);
  });

  it('is a doorway into the grid, not a filter — never active, lands on "all"', async () => {
    const user = userEvent.setup();
    renderInbox();

    const more = await within(rail()).findByRole('button', { name: 'More' });
    expect(more).not.toHaveAttribute('aria-current');

    await user.click(more);

    await screen.findByRole('heading', { level: 2, name: 'All tickets' });
    expect(more).not.toHaveAttribute('aria-current');
    expect(ticketUrls().some((url) => url.startsWith('/tickets?view=all'))).toBe(true);
  });

  it('shows "Ticket views unavailable" on a failed request, without disturbing the chat list', async () => {
    const user = userEvent.setup();
    api.get.mockImplementation((url: string) => {
      if (url.startsWith('/tickets?')) {
        return Promise.reject(
          new ApiClientError({ type: 'network', status: 500, message: 'boom', requestId: 'r1' }),
        );
      }
      if (url.startsWith('/chats?')) {
        return Promise.resolve({
          items: [
            {
              id: 'chat-1',
              customer_id: 'c-1',
              customer_name: 'Ada',
              active: true,
              created_at: '2026-09-05T10:00:00.000Z',
              thread_id: 't-1',
              assignee_id: null,
              queue_position: null,
              unread_count: 0,
              last_event: null,
              tags: [],
            },
          ],
          total: 1,
        });
      }
      if (url === '/chats/chat-1') {
        return Promise.resolve(CHAT_DETAIL);
      }
      return Promise.resolve({ items: [], total: 0 });
    });
    renderInbox();
    // The chat list has already loaded fine before the tickets pane is ever opened.
    await within(chatList()).findByText('Ada');

    await user.click(await within(rail()).findByRole('button', { name: 'All tickets' }));
    expect(await screen.findByText('Ticket views unavailable')).toBeInTheDocument();

    // Switching back proves the chat list's own query was never touched by the
    // ticket failure — the same customer reappears with no extra fetch needed.
    // `findAllByRole` + first match, not an exact name: the Chats "All" button
    // can carry a live count badge (`useViewCounts`), and "All tickets" also
    // starts with "All" — the Chats one renders first in document order.
    const [chatsAll] = await within(rail()).findAllByRole('button', { name: /^All\b/ });
    if (!chatsAll) throw new Error('expected an "All" button in the rail');
    await user.click(chatsAll);
    expect(await within(chatList()).findByText('Ada')).toBeInTheDocument();
  });
});
