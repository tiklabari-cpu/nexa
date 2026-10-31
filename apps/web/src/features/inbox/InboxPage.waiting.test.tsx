/**
 * The waiting counter in the inbox list (IN-03 · tm 361): a row shows how long
 * its player has waited — from the server's `waiting_since`, or the queue entry
 * for a queued row — and turns at the thresholds the list itself carries, so an
 * agent without the settings scope sees the workspace's own pair.
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

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

function row(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    customer_id: `c-${id}`,
    customer_name: name,
    active: true,
    created_at: '2026-10-24T10:00:00.000Z',
    thread_id: `t-${id}`,
    assignee_id: 'me',
    queue_position: null,
    waiting_since: null,
    queued_at: null,
    unread_count: 0,
    last_event: null,
    tags: [],
    ...over,
  };
}

let thresholds: { warn_seconds: number; alert_seconds: number } | undefined;

beforeEach(() => {
  api.get.mockReset();
  localStorage.clear();
  thresholds = undefined;
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      return Promise.resolve({
        items: [
          row('fresh', 'Fresh player', { waiting_since: ago(20) }),
          row('late', 'Late player', { waiting_since: ago(200) }),
          row('answered', 'Answered player'),
          row('queued', 'Queued player', {
            assignee_id: null,
            queue_position: 2,
            queued_at: ago(3 * 60),
            waiting_since: ago(10 * 60),
          }),
          row('closed', 'Closed player', { active: false, waiting_since: ago(900) }),
        ],
        total: 5,
        ...(thresholds ? { waiting_thresholds: thresholds } : {}),
      });
    }
    // The first row opens on its own: a bare detail keeps the side panel quiet.
    const opened = /^\/chats\/([^/?]+)$/.exec(url);
    if (opened) {
      return Promise.resolve({
        id: opened[1],
        license_id: '1',
        customer_id: 'c',
        active: true,
        created_at: '2026-10-24T10:00:00.000Z',
        access: { group_ids: [] },
        users: [],
        thread: null,
        local_day: null,
        connections: [],
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
});

function renderInbox() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return screen.getByRole('region', { name: 'Conversations' });
}

async function rowOf(list: HTMLElement, name: string): Promise<HTMLElement> {
  return (await within(list).findByText(name)).closest('button')!;
}

describe('the waiting counter in the inbox list (IN-03)', () => {
  it('shows each open row’s wait from the server, on the default thresholds', async () => {
    const list = renderInbox();

    const fresh = within(await rowOf(list, 'Fresh player')).getByTestId('waiting-timer');
    expect(fresh).toHaveTextContent('just now');
    expect(fresh.dataset['level']).toBe('normal');

    const late = within(await rowOf(list, 'Late player')).getByTestId('waiting-timer');
    expect(late).toHaveTextContent('3 min');
    expect(late.dataset['level']).toBe('warn');
  });

  it('shows nothing on an answered row and on a closed one', async () => {
    const list = renderInbox();
    expect(within(await rowOf(list, 'Answered player')).queryByTestId('waiting-timer')).toBeNull();
    expect(within(await rowOf(list, 'Closed player')).queryByTestId('waiting-timer')).toBeNull();
  });

  it('shows a queued row’s time in the queue, not its older wait', async () => {
    const list = renderInbox();
    const queued = within(await rowOf(list, 'Queued player')).getByTestId('waiting-timer');
    expect(queued).toHaveTextContent('in queue 3 min');
  });

  it('turns at the pair the list carries', async () => {
    thresholds = { warn_seconds: 10, alert_seconds: 30 };
    const list = renderInbox();
    const fresh = within(await rowOf(list, 'Fresh player')).getByTestId('waiting-timer');
    expect(fresh.dataset['level']).toBe('warn');
    const late = within(await rowOf(list, 'Late player')).getByTestId('waiting-timer');
    expect(late.dataset['level']).toBe('alert');
  });
});
