/**
 * The inbox list's one-line preview of a chat whose newest line is the server's
 * "Chat archived" (tm 398): said in the console's language, not the wire's.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { resetLocale, setLocale } from '../../test/i18n.js';

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

const archivedLine = {
  id: 'closed_9',
  chat_id: 'closed',
  thread_id: 't-closed',
  type: 'system_message',
  text: 'Chat archived',
  author_id: 'me',
  author_type: 'system',
  recipients: 'all',
  attachment_url: null,
  properties: { system_event: 'chat_deactivated' },
  created_at: '2026-11-04T10:00:00.000Z',
};

beforeEach(() => {
  api.get.mockReset();
  localStorage.clear();
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      return Promise.resolve({
        items: [
          {
            id: 'closed',
            customer_id: 'c-closed',
            customer_name: 'Closed player',
            active: false,
            created_at: '2026-11-04T09:00:00.000Z',
            thread_id: 't-closed',
            assignee_id: 'me',
            queue_position: null,
            waiting_since: null,
            queued_at: null,
            unread_count: 0,
            last_event: archivedLine,
            tags: [],
          },
        ],
        total: 1,
      });
    }
    // The first row opens on its own: a bare detail keeps the side panel quiet.
    const opened = /^\/chats\/([^/?]+)$/.exec(url);
    if (opened) {
      return Promise.resolve({
        id: opened[1],
        license_id: '1',
        customer_id: 'c',
        active: false,
        created_at: '2026-11-04T09:00:00.000Z',
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

afterEach(() => resetLocale());

async function previewOf(region: string): Promise<HTMLElement> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const list = screen.getByRole('region', { name: region });
  return (await within(list).findByText('Closed player')).closest('button')!;
}

describe('the inbox list preview of an archived chat (tm 398)', () => {
  it('reads "Sohbet arşivlendi" on a Turkish console', async () => {
    setLocale('tr');
    const row = await previewOf('Sohbetler');
    expect(within(row).getByText('Sohbet arşivlendi')).toBeInTheDocument();
    expect(within(row).queryByText('Chat archived')).toBeNull();
  });

  it('reads "Chat archived" on an English console', async () => {
    const row = await previewOf('Conversations');
    expect(within(row).getByText('Chat archived')).toBeInTheDocument();
  });
});
