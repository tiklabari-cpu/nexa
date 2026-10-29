/**
 * The inbox's "My team" view (RL-03 · tm 326): a lead's worklist — every open
 * chat of the teams they lead, the AI's included — with Watch and Take over on
 * each row.
 *
 * What is pinned: the rail offers the view only to someone who leads a team
 * (`GET /groups` `agents[].lead`), and nobody else's browser asks for it; the
 * list is the server's `view=team` read; Watch registers the watch and opens
 * the conversation; Take over asks first and calls the takeover endpoint;
 * a lead the Founder kept from taking over (`chats.takeover` `none`) gets Watch
 * alone.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api, me } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  me: {
    agent: {
      scopes: ['chats--access:rw'],
      account_id: 'lead-1',
      role: 'team_lead',
      routing_status: 'offline',
      capabilities: { 'chats.takeover': 'team' } as Record<string, string>,
    },
  },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ agent: me.agent, setRoutingStatus: vi.fn() }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

/** Sales is led by `lead-1`; Support only has them as a member. */
const LEADING = [
  { id: 7, name: 'Sales', agents: [{ agent_id: 'lead-1', lead: true }] },
  { id: 8, name: 'Support', agents: [{ agent_id: 'lead-1', lead: false }] },
];
const MEMBER_ONLY = [{ id: 8, name: 'Support', agents: [{ agent_id: 'lead-1', lead: false }] }];

const TEAM_ROWS = [
  { id: 'chat-held', name: 'Held visitor', assignee: 'agent-9' },
  { id: 'chat-ai', name: 'AI visitor', assignee: null },
];

function viewOf(url: string): string | null {
  return new URLSearchParams(url.slice(url.indexOf('?'))).get('view');
}

function serve(groups: unknown[]): void {
  api.get.mockImplementation((url: string) => {
    if (url === '/groups') return Promise.resolve({ items: groups });
    if (url === '/agents') {
      return Promise.resolve({ items: [{ id: 'agent-9', name: 'Priya' }] });
    }
    if (url.startsWith('/chats?')) {
      const rows = viewOf(url) === 'team' ? TEAM_ROWS : [];
      return Promise.resolve({
        items: rows.map((row) => ({
          id: row.id,
          customer_id: `c-${row.id}`,
          customer_name: row.name,
          active: true,
          created_at: '2026-10-29T10:00:00.000Z',
          thread_id: `t-${row.id}`,
          assignee_id: row.assignee,
          queue_position: null,
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
        created_at: '2026-10-29T10:00:00.000Z',
        access: { group_ids: [7] },
        users: [],
        thread: null,
        visitor: null,
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  localStorage.clear();
  me.agent.capabilities = { 'chats.takeover': 'team' };
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
const teamListReads = () =>
  api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/chats?') && viewOf(url) === 'team');

describe('the inbox "My team" view (RL-03)', () => {
  it('is offered to a lead, counted by the server, and lists their teams’ open chats', async () => {
    serve(LEADING);
    const user = userEvent.setup();
    renderInbox();

    const view = await within(rail()).findByRole('button', { name: /^My team/ });
    await waitFor(() => expect(view).toHaveTextContent('2'));
    await user.click(view);

    expect(await within(conversations()).findByText('Held visitor')).toBeInTheDocument();
    expect(within(conversations()).getByText('AI visitor')).toBeInTheDocument();
    expect(teamListReads().length).toBeGreaterThan(0);
  });

  it('is not offered to someone who leads no team, and is never read for them', async () => {
    serve(MEMBER_ONLY);
    renderInbox();

    await within(rail()).findByRole('button', { name: /^My chats/ });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/groups'));
    expect(within(rail()).queryByRole('button', { name: /^My team/ })).not.toBeInTheDocument();
    expect(teamListReads()).toEqual([]);
  });

  it('Watch registers the watch and opens the conversation', async () => {
    serve(LEADING);
    api.post.mockResolvedValue({});
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^My team/ }));

    await user.click(await screen.findByRole('button', { name: 'Watch AI visitor' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/chats/chat-ai/supervise'));
    const row = within(conversations()).getByText('AI visitor').closest('button');
    await waitFor(() => expect(row).toHaveAttribute('aria-current', 'true'));
  });

  it('Take over asks first, naming who holds it, then calls the takeover endpoint', async () => {
    serve(LEADING);
    api.post.mockResolvedValue({});
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^My team/ }));

    await user.click(await screen.findByRole('button', { name: 'Take over Held visitor' }));
    const dialog = await screen.findByRole('dialog', { name: 'Take over this chat?' });
    expect(await within(dialog).findByText(/taking it from Priya/)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Take over' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/chats/chat-held/takeover', undefined),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('gives a lead the Founder kept from taking over Watch alone (RL-02 matrix)', async () => {
    me.agent.capabilities = { 'chats.takeover': 'none' };
    serve(LEADING);
    const user = userEvent.setup();
    renderInbox();
    await user.click(await within(rail()).findByRole('button', { name: /^My team/ }));

    expect(await screen.findByRole('button', { name: 'Watch Held visitor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take over/ })).not.toBeInTheDocument();
  });
});
