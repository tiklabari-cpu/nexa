/**
 * The conversation list re-orders itself on a realtime event (FR-MOD-02.2.2 —
 * «Tıklama transcript açar; RTM'de yukarı taşınır + unread»).
 *
 * `useInbox.test.tsx` pins what the push does to the cache. What is pinned here
 * is the part an agent actually experiences, and the part a cache-level test
 * cannot see: the row that spoke is the first one on screen afterwards, and the
 * conversation the agent had open is still open. The second half is not a
 * detail — a list that re-orders under a selection tracked by position would
 * silently swap the transcript in front of somebody mid-reply.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { ChatEvent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        // An ordinary agent: no `channels--all`, so the Views group never fires
        // the channel request and the middle list is all that is under test.
        agent: { scopes: ['chats--access:rw'], account_id: 'me', routing_status: 'offline' },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');
const { applyPush } = await import('./useInbox.js');

/** Three conversations, oldest last — the order the server returns them in. */
const VISITORS = ['Ada', 'Ben', 'Cara'] as const;

function chatRow(name: string, minute: number) {
  return {
    id: `chat-${name}`,
    customer_id: `c-${name}`,
    customer_name: name,
    active: true,
    created_at: `2026-09-05T10:${String(minute).padStart(2, '0')}:00.000Z`,
    thread_id: `t-${name}`,
    assignee_id: null,
    queue_position: null,
    unread_count: 0,
    last_event: null,
    tags: [],
  };
}

function serveChats(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      const view = new URLSearchParams(url.slice(url.indexOf('?'))).get('view') ?? 'all';
      // Only the open list carries rows: the rail mounts a list per view for its
      // counters, and rows on those would add buttons this test would have to
      // exclude by name anyway.
      const items = view === 'all' ? VISITORS.map((name, i) => chatRow(name, 30 - i)) : [];
      return Promise.resolve({ items, total: items.length });
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

function message(chatId: string, text: string): ChatEvent {
  return {
    id: `${chatId}_9`,
    chat_id: chatId,
    thread_id: `t-${chatId}`,
    type: 'message',
    text,
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-09-05T11:00:00.000Z',
  };
}

function renderInbox(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return queryClient;
}

/**
 * The conversation rows, in the order they are on screen.
 *
 * Scoped to the scrolling list panel rather than the whole page: the open
 * conversation's own header and its Details panel repeat the visitor's name, so
 * a page-wide query by name would mix the transcript side into the list's order.
 */
function listPanel(): HTMLElement {
  return screen.getByRole('tabpanel');
}

function rowOrder(): string[] {
  return within(listPanel())
    .getAllByRole('button')
    .map((button) => VISITORS.find((name) => button.textContent?.includes(name)) ?? '')
    .filter((name) => name !== '');
}

function row(name: string): HTMLElement {
  return within(listPanel()).getByRole('button', { name: new RegExp(name) });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  localStorage.clear();
  serveChats();
});

describe('the conversation list on a realtime event (FR-MOD-02.2.2)', () => {
  it('moves the row that just spoke to the top and marks it unread', async () => {
    const queryClient = renderInbox();
    await waitFor(() => expect(rowOrder()).toEqual(['Ada', 'Ben', 'Cara']));

    applyPush(queryClient, 'incoming_event', {
      chat_id: 'chat-Cara',
      event: message('chat-Cara', 'are you still there?'),
    });

    // The bottom row climbs to the top. Before this change the list ordered on
    // `created_at`, so Cara stayed exactly where she was and only her preview
    // line changed — the message arrived, but not where the agent was looking.
    await waitFor(() => expect(rowOrder()).toEqual(['Cara', 'Ada', 'Ben']));
    // «+ unread» is the same clause of the same criterion.
    expect(await within(listPanel()).findByLabelText('1 unread')).toBeInTheDocument();
  });

  it('keeps the open conversation open while the list re-orders around it', async () => {
    const user = userEvent.setup();
    const queryClient = renderInbox();
    await waitFor(() => expect(rowOrder()).toEqual(['Ada', 'Ben', 'Cara']));

    // The agent is reading Ben — the middle row, so a selection tracked by
    // index would land on a different conversation whichever way the list moves.
    await user.click(row('Ben'));
    await waitFor(() => expect(row('Ben')).toHaveAttribute('aria-current', 'true'));

    applyPush(queryClient, 'incoming_event', {
      chat_id: 'chat-Cara',
      event: message('chat-Cara', 'hello?'),
    });

    await waitFor(() => expect(rowOrder()).toEqual(['Cara', 'Ada', 'Ben']));
    // Selection is held by id, so the row Ben is on moved and the selection
    // moved with it. Cara — now first — is not selected.
    expect(row('Ben')).toHaveAttribute('aria-current', 'true');
    expect(row('Cara')).not.toHaveAttribute('aria-current');
  });
});
