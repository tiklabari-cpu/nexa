/**
 * Reopening an archived conversation from the Details panel (FR-MOD-02.6).
 *
 * `POST /chats/{id}/resume` already carries its own server-side test
 * (`chat-service.ts` resume() — new thread + a `chat_resumed` system event,
 * the one-active-chat rule preserved). What the audit found missing was the
 * UI path: does pressing Reopen in the actual console make the transcript
 * show the reopened line, and does the composer — which an archived chat
 * replaces with a notice — turn back into a real textbox. Neither follows
 * from the server test alone; both are wiring `InboxPage` owns.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { ChatEvent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        agent: { scopes: ['chats--access:rw'], account_id: 'me', routing_status: 'offline' },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

const CHAT_ID = 'CHAT-REOPEN-1';

const FIRST_MESSAGE: ChatEvent = {
  id: `${CHAT_ID}_1`,
  chat_id: CHAT_ID,
  thread_id: 'T1',
  type: 'message',
  text: 'Still waiting on my order',
  author_id: null,
  author_type: 'customer',
  recipients: 'all',
  attachment_url: null,
  properties: {},
  created_at: '2026-09-05T10:00:00.000Z',
};

/** What `chat-service.ts#resume` appends — same text, same `properties`. */
const RESUMED_EVENT: ChatEvent = {
  id: `${CHAT_ID}_2`,
  chat_id: CHAT_ID,
  thread_id: 'T2',
  type: 'system_message',
  text: 'Chat reopened',
  author_id: 'agent-1',
  author_type: 'system',
  recipients: 'all',
  attachment_url: null,
  properties: { system_event: 'chat_resumed' },
  created_at: '2026-09-05T11:00:00.000Z',
};

function viewOf(url: string): string {
  return new URLSearchParams(url.slice(url.indexOf('?'))).get('view') ?? 'all';
}

/** Archived until the mocked `POST /resume` flips it, as the real route does. */
let active = false;

function chatDetail(): unknown {
  return {
    id: CHAT_ID,
    license_id: '1',
    customer_id: 'cust-1',
    active,
    created_at: '2026-09-05T09:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: active ? 'T2' : 'T1',
      chat_id: CHAT_ID,
      active,
      assignee_id: null,
      queue_position: null,
      summary: null,
      created_at: '2026-09-05T09:00:00.000Z',
      closed_at: active ? null : '2026-09-05T10:30:00.000Z',
      tags: [],
    },
  };
}

function serveArchivedChat(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      const items =
        viewOf(url) === 'all'
          ? [
              {
                id: CHAT_ID,
                customer_id: 'cust-1',
                customer_name: 'Ada Visitor',
                active,
                created_at: '2026-09-05T09:00:00.000Z',
                thread_id: 'T1',
                assignee_id: null,
                queue_position: null,
                unread_count: 0,
                last_event: null,
                tags: [],
              },
            ]
          : [];
      return Promise.resolve({ items, total: items.length });
    }
    if (url === `/chats/${CHAT_ID}`) return Promise.resolve(chatDetail());
    if (url.startsWith(`/chats/${CHAT_ID}/events`)) {
      // The transcript page is read newest-first; `flattenTranscriptPages`
      // reverses it for display.
      return Promise.resolve({ items: active ? [RESUMED_EVENT, FIRST_MESSAGE] : [FIRST_MESSAGE] });
    }
    return Promise.resolve({ items: [], total: 0 });
  });

  api.post.mockImplementation((url: string) => {
    if (url === `/chats/${CHAT_ID}/resume`) {
      active = true;
      return Promise.resolve(chatDetail());
    }
    return Promise.resolve({});
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

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  active = false;
  serveArchivedChat();
});

describe('reopening an archived chat from the Details panel (FR-MOD-02.6)', () => {
  it('shows the reopened system event and turns the composer writable again', async () => {
    const user = userEvent.setup();
    renderInbox();

    // Archived: the composer is a notice, not a textbox, and the panel offers
    // Reopen rather than Archive.
    expect(
      await screen.findByText('This conversation is archived. Reopen it to reply.'),
    ).toBeInTheDocument();
    const reopen = await screen.findByRole('button', { name: 'Reopen conversation' });

    await user.click(reopen);

    expect(api.post).toHaveBeenCalledWith(`/chats/${CHAT_ID}/resume`);
    expect(await screen.findByText('Chat reopened')).toBeInTheDocument();
    expect(
      screen.queryByText('This conversation is archived. Reopen it to reply.'),
    ).not.toBeInTheDocument();
    expect(await screen.findByPlaceholderText(/Type your reply/)).toBeInTheDocument();
  });
});
