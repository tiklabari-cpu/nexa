/**
 * A quiet conversation in the list (WG-03 · tm 340.3): the sweep sets a
 * connection with no event for `inactive_after_seconds` aside — it stops
 * counting against its agent's limit — and the row says so, by name and by a
 * dimmer name, so the dimming is not the only signal (design-brief §3).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
        agent: { scopes: ['chats--all:rw'], account_id: 'me', routing_status: 'accepting_chats' },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

function row(id: string, name: string, inactive: boolean | undefined) {
  return {
    id,
    customer_id: `c-${id}`,
    customer_name: name,
    active: true,
    created_at: '2026-10-24T10:00:00.000Z',
    thread_id: `t-${id}`,
    assignee_id: 'me',
    queue_position: null,
    ...(inactive === undefined ? {} : { inactive }),
    unread_count: 0,
    last_event: null,
    tags: [],
  };
}

beforeEach(() => {
  api.get.mockReset();
  localStorage.clear();
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      return Promise.resolve({
        items: [
          row('quiet', 'Quiet visitor', true),
          row('lively', 'Lively visitor', false),
          row('older', 'Older server visitor', undefined),
        ],
        total: 3,
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
});

describe('an inactive conversation in the list (WG-03)', () => {
  it('names the quiet one and dims its name; a lively row and an older server’s row say nothing', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter initialEntries={['/app/inbox']}>
        <QueryClientProvider client={queryClient}>
          <InboxPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const list = screen.getByRole('region', { name: 'Conversations' });

    const quietName = await within(list).findByText('Quiet visitor');
    const quiet = quietName.closest('button')!;
    expect(within(quiet).getByText('Inactive')).toBeInTheDocument();
    expect(quietName).toHaveClass('text-content-secondary');

    for (const name of ['Lively visitor', 'Older server visitor']) {
      const label = within(list).getByText(name);
      expect(within(label.closest('button')!).queryByText('Inactive')).toBeNull();
      expect(label).not.toHaveClass('text-content-secondary');
    }
  });
});
