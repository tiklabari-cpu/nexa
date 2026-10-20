/**
 * The Queued view's team tabs (tm 305.4 · AU-01 · ADR-08a §2.1) — "Inbox
 * kuyruk sekmeleri".
 *
 * A conversation waits in one team's queue, so the Queued view splits by
 * team. What is pinned: the tabs appear on the Queued view only, topic queues
 * first; each tab's number is the server's count of that team's queue — its
 * own `queue_group_id` read, not the loaded page sliced — and opening a tab
 * lists that queue from the server. A pressing chat says so on its row.
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
  { id: 1, name: 'General', topic_role: null },
  { id: 7, name: 'Safer play', topic_role: 'responsible_gambling' },
  { id: 4, name: 'Money', topic_role: 'finance' },
];

/** Who waits in which team's queue, as the server holds it. */
const QUEUE: Array<{ team: number; name: string; priority: string }> = [
  { team: 4, name: 'Finance visitor A', priority: 'urgent' },
  { team: 4, name: 'Finance visitor B', priority: 'normal' },
  { team: 7, name: 'Safer play visitor', priority: 'high' },
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
      const team = query.get('queue_group_id');
      const rows =
        query.get('view') === 'queued'
          ? QUEUE.filter((row) => team === null || row.team === Number(team))
          : [];
      return Promise.resolve({
        items: rows.map((row, i) => ({
          id: `chat-${row.team}-${i}`,
          customer_id: `c-${row.team}-${i}`,
          customer_name: row.name,
          active: true,
          created_at: '2026-10-20T10:00:00.000Z',
          thread_id: `t-${row.team}-${i}`,
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
    // The inbox opens the first row; its detail read needs a chat's shape.
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

function renderInbox(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const rail = () => screen.getByRole('navigation', { name: 'Inbox views' });
const conversations = () => screen.getByRole('region', { name: 'Conversations' });

describe('the Queued view split by team (AU-01)', () => {
  it('shows no team tabs outside the Queued view', async () => {
    renderInbox();
    await within(rail()).findByRole('button', { name: /^Queued/ });
    expect(screen.queryByRole('tablist', { name: 'Team queues' })).not.toBeInTheDocument();
  });

  it("gives each team a tab counting the server's own count of its queue, topic queues first (FR-MOD-08.6.1)", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));

    const tabs = await screen.findByRole('tablist', { name: 'Team queues' });
    await waitFor(() =>
      expect(
        within(tabs)
          .getAllByRole('tab')
          .map((tab) => tab.textContent),
      ).toEqual(['All teams3', 'Money2', 'Safer play1', 'General0']),
    );
    // One read per team, filtered by the server — not the loaded page sliced.
    for (const id of ['4', '7', '1']) {
      expect(chatUrls().some((url) => paramsOf(url).get('queue_group_id') === id)).toBe(true);
    }
    expect(within(tabs).getByRole('tab', { name: /All teams/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it("lists one team's queue when its tab is opened, and every queue again from All teams", async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));
    const tabs = await screen.findByRole('tablist', { name: 'Team queues' });

    await user.click(within(tabs).getByRole('tab', { name: /Safer play/ }));

    expect(await within(conversations()).findByText('Safer play visitor')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(conversations()).queryByText('Finance visitor A')).not.toBeInTheDocument(),
    );
    expect(within(tabs).getByRole('tab', { name: /Safer play/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(within(tabs).getByRole('tab', { name: /All teams/ }));
    expect(await within(conversations()).findByText('Finance visitor A')).toBeInTheDocument();
  });

  it('marks an urgent or high-priority chat on its row, and a normal one not at all', async () => {
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^Queued/ }));

    const urgentRow = (await within(conversations()).findByText('Finance visitor A')).closest(
      'button',
    )!;
    expect(within(urgentRow).getByText('Urgent')).toBeInTheDocument();
    const highRow = within(conversations()).getByText('Safer play visitor').closest('button')!;
    expect(within(highRow).getByText('High')).toBeInTheDocument();
    const normalRow = within(conversations()).getByText('Finance visitor B').closest('button')!;
    expect(within(normalRow).queryByText(/Urgent|High|Normal/)).not.toBeInTheDocument();
  });
});
