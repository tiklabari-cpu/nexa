/**
 * The conversation list's priority filter (tm 307.3 · AI-12) — "Kuyrukta acil
 * sohbet normallerin önüne geçer" on the console's side.
 *
 * What is pinned: a pressing chat says so on its row (a normal one says
 * nothing); picking "urgent" asks the server for the urgent chats — not a slice
 * of the page already loaded — and puts the choice in the URL; it composes
 * with the Queued view's team tab; and the archived view, whose chats have no
 * priority, neither offers it nor sends it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

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
        agent: { scopes: ['chats--all:rw'], account_id: 'me', routing_status: 'offline' },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

const GROUPS = [
  { id: 4, name: 'Money', topic_role: 'finance' },
  { id: 7, name: 'Safer play', topic_role: 'responsible_gambling' },
];

/** The queue as the server holds it: the urgent one first. */
const QUEUE = [
  { name: 'Urgent visitor', priority: 'urgent', team: 7 },
  { name: 'High visitor', priority: 'high', team: 4 },
  { name: 'Normal visitor', priority: 'normal', team: 4 },
];

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?')));
}

function chatUrls(): string[] {
  return api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/chats?'));
}

beforeEach(() => {
  api.get.mockReset();
  localStorage.clear();
  api.get.mockImplementation((url: string) => {
    if (url === '/groups') return Promise.resolve({ items: GROUPS });
    if (url.startsWith('/chats?')) {
      const query = paramsOf(url);
      const priority = query.get('priority');
      const team = query.get('queue_group_id');
      const rows =
        query.get('view') === 'queued'
          ? QUEUE.filter(
              (row) =>
                (priority === null || row.priority === priority) &&
                (team === null || row.team === Number(team)),
            )
          : [];
      return Promise.resolve({
        items: rows.map((row, i) => ({
          id: `chat-${i}-${row.priority}`,
          customer_id: `c-${i}-${row.priority}`,
          customer_name: row.name,
          active: true,
          created_at: '2026-10-20T10:00:00.000Z',
          thread_id: `t-${i}-${row.priority}`,
          assignee_id: null,
          queue_position: i + 1,
          queue_group_id: row.team,
          priority: row.priority,
          unread_count: 0,
          last_event: null,
          tags: [],
        })),
        total: rows.length,
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
        created_at: '2026-10-20T10:00:00.000Z',
        access: { group_ids: [] },
        users: [],
        thread: null,
        visitor: null,
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
});

function renderInbox(entry = '/app/inbox'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const rail = () => screen.getByRole('navigation', { name: 'Inbox views' });
const conversations = () => screen.getByRole('region', { name: 'Conversations' });
const filter = () => within(conversations()).getByLabelText('Filter conversations by priority');

describe('the priority filter (AI-12)', () => {
  it('marks a pressing chat on its row and says nothing of a normal one', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));

    const urgent = (await within(conversations()).findByText('Urgent visitor')).closest('button');
    const high = within(conversations()).getByText('High visitor').closest('button');
    const normal = within(conversations()).getByText('Normal visitor').closest('button');
    expect(within(urgent!).getByText('Urgent')).toBeInTheDocument();
    expect(within(high!).getByText('High')).toBeInTheDocument();
    expect(within(normal!).queryByText('Normal')).toBeNull();
  });

  it('asks the server for the urgent chats rather than slicing the loaded page, and keeps the choice in the URL', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));
    await within(conversations()).findByText('Normal visitor');

    await user.selectOptions(filter(), 'Urgent');

    await waitFor(() => {
      expect(chatUrls().some((url) => paramsOf(url).get('priority') === 'urgent')).toBe(true);
    });
    const asked = chatUrls().filter((url) => paramsOf(url).get('priority') === 'urgent');
    expect(asked.every((url) => paramsOf(url).get('view') === 'queued')).toBe(true);
    expect(await within(conversations()).findByText('Urgent visitor')).toBeInTheDocument();
    await waitFor(() => expect(within(conversations()).queryByText('Normal visitor')).toBeNull());
    expect(within(conversations()).queryByText('High visitor')).toBeNull();
  });

  it('turns off again with "All priorities"', async () => {
    const user = userEvent.setup();
    renderInbox('/app/inbox?chat_priority=high');
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));
    expect(await within(conversations()).findByText('High visitor')).toBeInTheDocument();
    expect(within(conversations()).queryByText('Normal visitor')).toBeNull();
    expect(filter()).toHaveValue('high');

    await user.selectOptions(filter(), 'All priorities');
    expect(await within(conversations()).findByText('Normal visitor')).toBeInTheDocument();
    expect(filter()).toHaveValue('');
  });

  it("composes with a team's queue tab", async () => {
    const user = userEvent.setup();
    renderInbox('/app/inbox?chat_priority=high');
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));
    await within(conversations()).findByText('High visitor');

    await user.click(await screen.findByRole('tab', { name: /Safer play/ }));

    await waitFor(() => {
      const urls = chatUrls().map(paramsOf);
      expect(
        urls.some(
          (query) => query.get('queue_group_id') === '7' && query.get('priority') === 'high',
        ),
      ).toBe(true);
    });
  });

  it('ignores a garbled value instead of sending it', async () => {
    const user = userEvent.setup();
    renderInbox('/app/inbox?chat_priority=sideways');
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));
    await within(conversations()).findByText('Normal visitor');
    expect(filter()).toHaveValue('');
    expect(chatUrls().every((url) => !paramsOf(url).has('priority'))).toBe(true);
  });

  it('offers no filter on the archived view and does not send one', async () => {
    const user = userEvent.setup();
    renderInbox('/app/inbox?chat_priority=urgent');
    await user.click(await within(rail()).findByRole('button', { name: /^Archive/ }));
    await waitFor(() =>
      expect(chatUrls().some((url) => paramsOf(url).get('view') === 'archived')).toBe(true),
    );
    expect(
      within(conversations()).queryByLabelText('Filter conversations by priority'),
    ).not.toBeInTheDocument();
    const archived = chatUrls().filter((url) => paramsOf(url).get('view') === 'archived');
    expect(archived.every((url) => !paramsOf(url).has('priority'))).toBe(true);
  });
});
