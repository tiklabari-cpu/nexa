/**
 * A load that fails must say so (tm 259.5 · docs/ux-audit-2026-10-07.md Y2).
 *
 * `useChatList` has always returned `isError`, and `InboxPage` never read it: a
 * 500 on `GET /chats` fell through to the empty state, so an agent whose inbox
 * had failed to load was told "Nothing here yet — new conversations land here
 * as they arrive" and had no reason to suspect anything was wrong. The same
 * hole sat under the open chat (`useTranscript` had no error to return, so a
 * failed transcript was an empty thread with a live composer) and under a
 * deep-linked chat that could not be fetched ("No conversation selected").
 *
 * What is pinned here is the *absence* of the lie as much as the presence of
 * the alert: every case asserts the empty-state copy is gone, not only that an
 * alert appeared beside it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
        agent: { scopes: ['chats--access:rw'], account_id: 'me', routing_status: 'offline' },
        setRoutingStatus,
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');
const { refreshChatHeads } = await import('./useInbox.js');

function failure(status: number, type: ConstructorParameters<typeof ApiClientError>[0]['type']) {
  return new ApiClientError({ type, status, message: 'boom', requestId: 'req-1' });
}

/** Which of the three things the page reads is currently broken. */
const broken = {
  list: null as ApiClientError | null,
  chat: null as ApiClientError | null,
  events: null as ApiClientError | null,
};

function serve(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      if (broken.list) return Promise.reject(broken.list);
      return Promise.resolve({
        items: [
          {
            id: 'chat-1',
            customer_id: 'c-1',
            customer_name: 'Ada Visitor',
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
    if (/^\/chats\/[^/?]+\/events/.test(url)) {
      if (broken.events) return Promise.reject(broken.events);
      return Promise.resolve({ items: [] });
    }
    const detail = /^\/chats\/([^/?]+)$/.exec(url);
    if (detail) {
      if (broken.chat) return Promise.reject(broken.chat);
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

function renderInbox(entry = '/app/inbox'): { queryClient: QueryClient } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { queryClient };
}

function listRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Conversations' });
}

/** The `role="alert"` block that carries `text` — alerts are named by their content, not a label. */
async function alertWith(text: string): Promise<HTMLElement> {
  const node = await screen.findByText(text);
  const alert = node.closest<HTMLElement>('[role="alert"]');
  if (!alert) throw new Error(`"${text}" is not inside a role="alert" block`);
  return alert;
}

function chatListRequests(): number {
  return api.get.mock.calls.filter(([url]) => /^\/chats\?view=all&/.test(url as string)).length;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  localStorage.clear();
  broken.list = null;
  broken.chat = null;
  broken.events = null;
  serve();
});

describe('a conversation list that fails to load (Y2)', () => {
  it('shows an alert with a retry, not the empty state', async () => {
    broken.list = failure(500, 'internal');
    renderInbox();

    const alert = await within(listRegion()).findByRole('alert');
    expect(alert).toHaveTextContent("Conversations couldn't be loaded");
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    // The lie this task removes.
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    expect(
      screen.queryByText('New conversations land here as they arrive.'),
    ).not.toBeInTheDocument();
  });

  it('puts a dash where the rail counters would show a number', async () => {
    broken.list = failure(500, 'internal');
    renderInbox();

    await within(listRegion()).findByRole('alert');
    // The Chats and AI groups are the first eight buttons of the rail.
    const rail = screen.getByRole('navigation', { name: 'Inbox views' });
    const chatViews = within(rail).getAllByRole('button').slice(0, 8);
    for (const view of chatViews) {
      // Not "0" (a lie) and not a stale figure: the number is unknown.
      expect(view).not.toHaveTextContent(/\d/);
      expect(within(view).getByText('—')).toBeInTheDocument();
    }
    // The header count and the real-time tabs say the same thing.
    expect(within(listRegion()).queryByText('0')).not.toBeInTheDocument();
  });

  it('asks again on "Try again" and lands the rows when the server is back', async () => {
    const user = userEvent.setup();
    broken.list = failure(500, 'internal');
    renderInbox();

    const alert = await within(listRegion()).findByRole('alert');
    const before = chatListRequests();

    broken.list = null;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(await within(listRegion()).findByText('Ada Visitor')).toBeInTheDocument();
    expect(chatListRequests()).toBeGreaterThan(before);
    expect(within(listRegion()).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is not cleared by a realtime push — only by the list loading again', async () => {
    broken.list = failure(500, 'internal');
    const { queryClient } = renderInbox();
    await within(listRegion()).findByRole('alert');

    const { applyPush } = await import('./useInbox.js');
    await act(async () => {
      applyPush(queryClient, 'incoming_event', {
        chat_id: 'chat-1',
        event: {
          id: 'e-1',
          author_type: 'customer',
          author_id: 'c-1',
          text: 'hello?',
          created_at: '2026-09-05T10:01:00.000Z',
        },
      });
      refreshChatHeads();
    });

    expect(within(listRegion()).getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
  });
});

describe('an open conversation that fails to load (Y2)', () => {
  it('says the transcript failed, retries it, and leaves no composer to type into', async () => {
    const user = userEvent.setup();
    broken.events = failure(500, 'internal');
    renderInbox();

    const alert = await alertWith("Messages couldn't be loaded");
    expect(alert).toHaveTextContent("Messages couldn't be loaded");
    // Not an empty thread with a live reply box.
    expect(screen.queryByLabelText('Reply to the customer')).not.toBeInTheDocument();
    expect(screen.getByText(/replying is paused/i)).toBeInTheDocument();

    const eventRequests = (): number =>
      api.get.mock.calls.filter(([url]) => /\/events/.test(url as string)).length;
    const before = eventRequests();
    broken.events = null;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.queryByText("Messages couldn't be loaded")).toBeNull());
    expect(eventRequests()).toBeGreaterThan(before);
    expect(await screen.findByLabelText('Reply to the customer')).toBeInTheDocument();
  });

  it('names a chat that is gone (404) differently from one that could not be reached', async () => {
    broken.chat = failure(404, 'not_found');
    renderInbox();

    const alert = await alertWith('This conversation no longer exists');
    expect(alert).toHaveTextContent('This conversation no longer exists');
    expect(screen.queryByText('No conversation selected')).not.toBeInTheDocument();
    // Gone is final: retrying a 404 is not on offer.
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers a retry when the chat could not be fetched for any other reason', async () => {
    const user = userEvent.setup();
    broken.chat = failure(500, 'internal');
    renderInbox();

    const alert = await alertWith("This conversation couldn't be loaded");
    expect(alert).toHaveTextContent("This conversation couldn't be loaded");
    expect(screen.queryByText('No conversation selected')).not.toBeInTheDocument();

    broken.chat = null;
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Reply to the customer')).toBeInTheDocument();
  });
});
