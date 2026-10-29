/**
 * The Archive screen (AR-01 · tm 335.2).
 *
 * What is pinned: a row is a connection (a player who wrote three times is three
 * rows, each with its own tags, assignee and rating); picking one loads its
 * transcript and the player panel and writes only its number to the address; a
 * pasted address opens the same conversation; a deleted or unseen one says which;
 * an empty archive says so instead of drawing a skeleton; a failed read is not an
 * empty archive; and the screen is read-only — going back to work on a
 * conversation is the separate "Open in Inbox" / "Reopen" act.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveConversation, ArchiveConversationDetail } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  auth: { scopes: ['chats--access:rw'] as string[] },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ agent: { scopes: auth.scopes, account_id: 'me', routing_status: 'offline' } }),
  };
});

const { ArchivePage } = await import('./ArchivePage.js');

const DAY_CHAT = 'CHATDAYAAA';

function row(threadId: string, extra: Partial<ArchiveConversation> = {}): ArchiveConversation {
  return {
    thread_id: threadId,
    chat_id: DAY_CHAT,
    customer: { id: 'cust-1', name: 'Mira Kaya', username: 'mira' },
    started_at: '2026-10-20T09:00:00.000Z',
    ended_at: '2026-10-20T09:30:00.000Z',
    assignee: null,
    group_ids: [],
    tags: [],
    rating: null,
    handled_by: null,
    risk_flags: [],
    first_customer_message: `first words of ${threadId}`,
    message_count: 4,
    ...extra,
  };
}

/** The same player, three connections — each with a different tag, assignee and rating. */
const THREE: ArchiveConversation[] = [
  row('THREADONE1', {
    chat_id: 'CHATDAYAAA',
    ended_at: '2026-10-22T09:30:00.000Z',
    assignee: { id: 'a1', name: 'Agent Ada' },
    tags: [{ id: 'tag-1', name: 'withdrawal' }],
    rating: { value: 'good', has_comment: false },
    handled_by: 'human',
  }),
  row('THREADTWO2', {
    chat_id: 'CHATDAYBBB',
    ended_at: '2026-10-21T09:30:00.000Z',
    assignee: { id: 'a2', name: 'Agent Bora' },
    tags: [{ id: 'tag-2', name: 'bonus' }],
    rating: { value: 'bad', has_comment: true },
    handled_by: 'ai',
  }),
  row('THREADTHR3', {
    chat_id: 'CHATDAYBBB',
    ended_at: '2026-10-20T09:30:00.000Z',
    tags: [],
    handled_by: 'mixed',
    risk_flags: ['rg_signal'],
  }),
];

function detailOf(summary: ArchiveConversation): ArchiveConversationDetail {
  return {
    ...summary,
    rating: summary.rating
      ? {
          ...summary.rating,
          comment: summary.rating.has_comment ? 'Took too long' : null,
          rated_at: '2026-10-22T10:00:00.000Z',
        }
      : null,
    summary: null,
  };
}

function event(
  id: string,
  chatId: string,
  threadId: string,
  text: string,
): Record<string, unknown> {
  return {
    id,
    chat_id: chatId,
    thread_id: threadId,
    type: 'message',
    text,
    author_id: 'cust-1',
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-10-20T09:01:00.000Z',
  };
}

interface Served {
  list?: () => Promise<unknown>;
  detail?: (threadId: string) => Promise<unknown>;
}

function serve(served: Served = {}): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/archive/conversations?')) {
      return (
        served.list ?? (() => Promise.resolve({ items: THREE, total: 3, total_capped: false }))
      )();
    }
    const one = /^\/archive\/conversations\/([^/?]+)$/.exec(url);
    if (one) {
      const id = decodeURIComponent(one[1] as string);
      if (served.detail) return served.detail(id);
      const found = THREE.find((candidate) => candidate.thread_id === id);
      return found
        ? Promise.resolve(detailOf(found))
        : Promise.reject(
            new ApiClientError({ type: 'not_found', status: 404, message: 'x', requestId: 'r' }),
          );
    }
    const events = /^\/chats\/([^/?]+)\/events\?thread_id=([^&]+)/.exec(url);
    if (events) {
      const [, chat, thread] = events as unknown as [string, string, string];
      return Promise.resolve({ items: [event(`${chat}_1`, chat, thread, `hello from ${thread}`)] });
    }
    if (/^\/chats\/[^/?]+\/customer-context/.test(url)) {
      return Promise.resolve({
        chat_id: DAY_CHAT,
        customer: {
          id: 'cust-1',
          name: 'Mira Kaya',
          username: 'mira',
          email: null,
          country_code: 'TR',
          country: 'Turkey',
          city: 'Istanbul',
          banned: false,
        },
        contact_visible: true,
        pre_chat: [],
        today: [],
        history: { items: [] },
        restricted_count: 0,
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

let location = { pathname: '', search: '' };
function LocationProbe(): null {
  const current = useLocation();
  location = { pathname: current.pathname, search: current.search };
  return null;
}

function renderArchive(path = '/app/archive'): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <ArchivePage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function listUrls(): string[] {
  return api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/archive/conversations?'));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  auth.scopes = ['chats--access:rw'];
  location = { pathname: '', search: '' };
  serve();
});

describe('Archive list', () => {
  it('lists a player who wrote three times as three rows, each with its own tag, assignee and rating', async () => {
    renderArchive();
    const list = await screen.findByRole('list', { name: 'Conversations' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    expect(within(rows[0]!).getByText('withdrawal')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Agent Ada/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Rated good')).toBeInTheDocument();

    expect(within(rows[1]!).getByText('bonus')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Agent Bora/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Rated bad (with a comment)')).toBeInTheDocument();

    // The third has none of those — they are not the day's latest connection's.
    expect(within(rows[2]!).queryByText('bonus')).toBeNull();
    expect(within(rows[2]!).queryByText('Rated good')).toBeNull();
    expect(within(rows[2]!).getByText('1 risk flag')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('first words of THREADTHR3')).toBeInTheDocument();
  });

  it('asks for the closed connections, newest first, and says how many there are', async () => {
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });
    expect(listUrls()[0]).toBe('/archive/conversations?status=closed&limit=50');
    expect(screen.getByRole('status')).toHaveTextContent('3 conversations');
  });

  it('says "more than" when the server stopped counting', async () => {
    serve({
      list: () => Promise.resolve({ items: THREE, total: 1000, total_capped: true }),
    });
    renderArchive();
    expect(await screen.findByText('More than 1,000 conversations')).toBeInTheDocument();
  });

  it('shows "No archive yet", not a skeleton, for an empty archive', async () => {
    serve({ list: () => Promise.resolve({ items: [], total: 0, total_capped: false }) });
    renderArchive();
    expect(await screen.findByText('No archive yet')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Conversations' })).toBeNull();
  });

  it('says the read failed, with a retry, rather than showing an empty archive', async () => {
    serve({
      list: () =>
        Promise.reject(
          new ApiClientError({ type: 'internal', status: 500, message: 'x', requestId: 'r' }),
        ),
    });
    const user = userEvent.setup();
    renderArchive();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The archive couldn't be loaded");
    expect(screen.queryByText('No archive yet')).toBeNull();

    serve();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Conversations' })).toBeInTheDocument();
  });

  it('adds the connections still in progress when asked, and keeps the choice in the address', async () => {
    const user = userEvent.setup();
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });

    await user.click(
      screen.getByRole('checkbox', { name: 'Also show conversations still in progress' }),
    );

    await waitFor(() => expect(listUrls()).toContain('/archive/conversations?status=all&limit=50'));
    expect(location.search).toBe('?status=all');
  });

  it('folds the connections of one day together when asked, without losing a row', async () => {
    const user = userEvent.setup();
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });

    await user.click(screen.getByRole('checkbox', { name: 'Group the same day together' }));

    expect(location.search).toBe('?group=day');
    expect(screen.getByText('2 conversations that day')).toBeInTheDocument();
    expect(screen.getByText('1 conversation that day')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Conversations' })).getAllByRole('button');
    expect(rows).toHaveLength(3);
  });
});

describe('Archive conversation', () => {
  it('opens the picked connection read-only with its player panel, and puts only its number in the address', async () => {
    const user = userEvent.setup();
    renderArchive();
    const list = await screen.findByRole('list', { name: 'Conversations' });

    await user.click(within(list).getAllByRole('button')[1]!);

    expect(await screen.findByText('hello from THREADTWO2')).toBeInTheDocument();
    expect(location.search).toBe('?c=THREADTWO2');
    expect(api.get).toHaveBeenCalledWith(
      '/chats/CHATDAYBBB/events?thread_id=THREADTWO2&sort=newest&limit=200',
    );

    // The panel: the player card, and this connection's own rating with its comment.
    const panel = screen.getByRole('complementary', { name: 'Player and conversation details' });
    expect(await within(panel).findByTestId('player-card')).toBeInTheDocument();
    const facts = within(panel).getByTestId('archive-facts');
    expect(within(facts).getByText('Agent Bora')).toBeInTheDocument();
    expect(within(facts).getByText('Rated bad (with a comment)')).toBeInTheDocument();
    expect(within(facts).getByText('Took too long')).toBeInTheDocument();
    expect(within(facts).getByText('Handled by the AI')).toBeInTheDocument();

    // Read-only: nothing here edits or sends. (The filter bar's own panels hold inputs; the
    // conversation and the player do not.)
    const inputs = screen
      .queryAllByRole('textbox')
      .filter((input) => !input.closest('[role="group"][aria-label="Filters"]'));
    expect(inputs).toEqual([]);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
  });

  it('opens the same conversation from a pasted address, without the list', async () => {
    serve({ list: () => new Promise(() => undefined) });
    renderArchive('/app/archive?c=THREADONE1');

    expect(await screen.findByText('hello from THREADONE1')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/archive/conversations/THREADONE1');
    expect(screen.getByRole('heading', { level: 2, name: 'Mira Kaya' })).toBeInTheDocument();
  });

  it('asks nothing of a conversation until one is picked', async () => {
    renderArchive();
    await screen.findByRole('list', { name: 'Conversations' });
    expect(screen.getByText('Pick a conversation')).toBeInTheDocument();
    expect(api.get.mock.calls.some(([url]) => (url as string).startsWith('/chats/'))).toBe(false);
  });

  it('says a retention-deleted conversation was deleted, and never asks for its messages', async () => {
    serve({
      detail: () =>
        Promise.reject(
          new ApiClientError({
            type: 'not_found',
            status: 404,
            message: 'x',
            requestId: 'r',
            details: { reason: 'retention_expired' },
          }),
        ),
    });
    renderArchive('/app/archive?c=THREADONE1');

    expect(await screen.findByText('This conversation was deleted')).toBeInTheDocument();
    expect(screen.getByText(/retention period ended/)).toBeInTheDocument();
    expect(api.get.mock.calls.some(([url]) => (url as string).includes('/events'))).toBe(false);
  });

  it('says "not found" for a number the caller cannot see', async () => {
    renderArchive('/app/archive?c=NOSUCHTHRD');
    expect(await screen.findByText('Conversation not found')).toBeInTheDocument();
    expect(screen.queryByText('This conversation was deleted')).toBeNull();
  });

  it('says the read failed, with a retry, when the detail fails for any other reason', async () => {
    serve({
      detail: () =>
        Promise.reject(
          new ApiClientError({ type: 'internal', status: 500, message: 'x', requestId: 'r' }),
        ),
    });
    renderArchive('/app/archive?c=THREADONE1');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The conversation couldn't be loaded");
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('Archive actions', () => {
  it('"Open in Inbox" goes to the live console at this connection', async () => {
    const user = userEvent.setup();
    renderArchive('/app/archive?c=THREADONE1');
    await user.click(await screen.findByRole('button', { name: 'Open in Inbox' }));
    expect(location.pathname).toBe('/app/inbox');
    expect(location.search).toBe('?chat=CHATDAYAAA&thread=THREADONE1');
  });

  it('"Reopen" resumes the conversation and follows the chat the server names', async () => {
    api.post.mockResolvedValue({ id: 'CHATTODAY1' });
    const user = userEvent.setup();
    renderArchive('/app/archive?c=THREADONE1');
    await user.click(await screen.findByRole('button', { name: 'Reopen' }));

    expect(api.post).toHaveBeenCalledWith('/chats/CHATDAYAAA/resume');
    await waitFor(() => expect(location.pathname).toBe('/app/inbox'));
    expect(location.search).toBe('?chat=CHATTODAY1');
  });

  it('says why when a reopen is refused, and stays on the archive', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({ type: 'chat_inactive', status: 409, message: 'x', requestId: 'r' }),
    );
    const user = userEvent.setup();
    renderArchive('/app/archive?c=THREADONE1');
    await user.click(await screen.findByRole('button', { name: 'Reopen' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(location.pathname).toBe('/app/archive');
  });

  it('offers no "Reopen" to a caller who can only read', async () => {
    auth.scopes = ['chats--access:ro'];
    renderArchive('/app/archive?c=THREADONE1');
    await screen.findByRole('button', { name: 'Open in Inbox' });
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });

  it('offers no "Reopen" on a connection that is still in progress', async () => {
    serve({
      detail: () => Promise.resolve(detailOf(row('THREADOPEN1', { ended_at: null }))),
    });
    renderArchive('/app/archive?c=THREADOPEN1');
    await screen.findByRole('button', { name: 'Open in Inbox' });
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
  });
});
