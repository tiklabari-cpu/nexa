/**
 * The Archive view's message search (ID-07 · tm 333.4).
 *
 * What is pinned: the bar is on the Archive and nowhere else, a search asks the
 * server (`GET /chats?query=`) rather than filtering rows already loaded, the
 * words never reach the address bar, the matched words are marked in the
 * snippet, a refused query says which rule it broke, and "Go to this message"
 * opens the conversation at the matched message.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { zonedDayBoundary } from '../../lib/format.js';

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

const MATCHED_EVENT = 'TJ1H8CFKRV_3';
const MATCHED_THREAD = 'THREADMATCH';

function summary(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    customer_id: `c-${id}`,
    customer_name: `Customer ${id}`,
    active: false,
    created_at: '2026-09-05T10:00:00.000Z',
    thread_id: `t-${id}`,
    assignee_id: null,
    queue_position: null,
    unread_count: 0,
    last_event: null,
    tags: [],
    ...extra,
  };
}

/** "Papara ile 5000 TL": the words "Papara" (0–6) and "5000" (11–15) marked. */
function hit(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return summary(id, {
    match: {
      event_id: MATCHED_EVENT,
      thread_id: MATCHED_THREAD,
      created_at: '2026-09-04T09:30:00.000Z',
      snippet: 'Papara ile 5000 TL yatırdım',
      highlights: [
        { start: 0, end: 6 },
        { start: 11, end: 15 },
      ],
      match_count: 3,
      internal: false,
      ...extra,
    },
  });
}

function event(id: string, text: string, threadId: string): Record<string, unknown> {
  return {
    id,
    chat_id: 'found-1',
    thread_id: threadId,
    type: 'message',
    text,
    author_id: 'c-found-1',
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-09-04T09:30:00.000Z',
  };
}

function serve(search: (url: string) => Promise<unknown>): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?') && url.includes('query=')) return search(url);
    if (url.startsWith('/chats?')) return Promise.resolve({ items: [], total: 0 });
    if (/^\/chats\/[^/?]+\/events/.test(url)) {
      return Promise.resolve({
        items: [
          event(MATCHED_EVENT, 'Papara ile 5000 TL yatırdım', MATCHED_THREAD),
          event('TJ1H8CFKRV_2', 'merhaba', MATCHED_THREAD),
        ],
      });
    }
    const detail = /^\/chats\/([^/?]+)$/.exec(url);
    if (detail) {
      const id = detail[1] as string;
      return Promise.resolve({
        id,
        license_id: '1',
        customer_id: `c-${id}`,
        active: false,
        created_at: '2026-09-04T09:00:00.000Z',
        access: { group_ids: [] },
        users: [],
        thread: {
          id: MATCHED_THREAD,
          chat_id: id,
          active: false,
          assignee_id: null,
          queue_position: null,
          summary: null,
          created_at: '2026-09-04T09:00:00.000Z',
          closed_at: null,
          tags: [],
        },
        visitor: null,
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

let pathname = '';
let search = '';
function LocationProbe(): null {
  const location = useLocation();
  pathname = location.pathname;
  search = location.search;
  return null;
}

function renderInbox(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function searchUrls(): string[] {
  return api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/chats?') && url.includes('query='));
}

async function openArchive(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(
    within(screen.getByRole('navigation', { name: 'Inbox views' })).getByRole('button', {
      name: /Archive/,
    }),
  );
}

async function ask(user: ReturnType<typeof userEvent.setup>, words: string): Promise<void> {
  await user.type(screen.getByRole('searchbox', { name: 'Search message text' }), words);
  await user.click(screen.getByRole('button', { name: 'Search' }));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset().mockResolvedValue({});
  api.patch.mockReset().mockResolvedValue({});
  api.del.mockReset().mockResolvedValue({});
  pathname = '';
  search = '';
});

describe('archive message search (ID-07)', () => {
  it('puts the search bar on the Archive view and on no other', async () => {
    serve(() => Promise.resolve({ items: [], total: 0 }));
    const user = userEvent.setup();
    renderInbox();

    expect(await screen.findByRole('heading', { name: 'All', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('search', { name: 'Search archived messages' })).toBeNull();

    await openArchive(user);
    expect(screen.getByRole('search', { name: 'Search archived messages' })).toBeInTheDocument();
    expect(searchUrls()).toEqual([]);
  });

  it('asks the server, marks the matched words, and keeps the text out of the address bar', async () => {
    serve(() =>
      Promise.resolve({ items: [hit('found-1'), summary('found-2')].slice(0, 1), total: 1 }),
    );
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'papara 5000');

    const row = await screen.findByRole('button', { name: /Customer found-1/ });
    const marks = Array.from(row.querySelectorAll('mark')).map((mark) => mark.textContent);
    expect(marks).toEqual(['Papara', '5000']);
    expect(row).toHaveTextContent('3 messages');
    expect(screen.getByRole('status')).toHaveTextContent('1 conversation');

    expect(searchUrls()).toHaveLength(1);
    const params = new URLSearchParams(searchUrls()[0]!.slice('/chats?'.length));
    expect(params.get('query')).toBe('papara 5000');
    expect(params.get('limit')).toBe('50');
    expect(params.has('date_from')).toBe(false);
    expect(params.has('view')).toBe(false);

    // GV-05: a shared or bookmarked address never carries what was searched for.
    expect(pathname).toBe('/app/inbox');
    expect(search).not.toMatch(/papara|5000|query/i);
  });

  it("sends the picked days as the viewer's own calendar days, the end day included", async () => {
    serve(() => Promise.resolve({ items: [hit('found-1')], total: 1 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);

    await user.type(screen.getByLabelText('From date'), '2026-09-01');
    await user.type(screen.getByLabelText('To date'), '2026-09-30');
    await ask(user, 'papara');
    await screen.findByRole('button', { name: /Customer found-1/ });

    const params = new URLSearchParams(searchUrls()[0]!.slice('/chats?'.length));
    expect(params.get('date_from')).toBe(zonedDayBoundary('2026-09-01', 'start'));
    // `[date_from, date_to)`: the end is the first instant after the last picked day.
    expect(Date.parse(params.get('date_to')!)).toBe(
      Date.parse(zonedDayBoundary('2026-09-30', 'end')) + 1,
    );
  });

  it('says which rule a query breaks without asking the server', async () => {
    serve(() => Promise.resolve({ items: [], total: 0 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);

    await ask(user, 'ab');
    expect(await screen.findByRole('alert')).toHaveTextContent('Type at least 3 characters.');
    expect(searchUrls()).toEqual([]);

    await user.clear(screen.getByRole('searchbox', { name: 'Search message text' }));
    await ask(user, '12 34');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Include a word with at least 3 letters or digits in a row.',
    );
    expect(searchUrls()).toEqual([]);
  });

  it('refuses a start day after the end day before asking', async () => {
    serve(() => Promise.resolve({ items: [], total: 0 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);

    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-09-30' } });
    await ask(user, 'papara');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The start date must be before the end date.',
    );
    expect(searchUrls()).toEqual([]);
  });

  it("explains a refusal the server still makes, in the console's words", async () => {
    serve(() =>
      Promise.reject(
        new ApiClientError({
          type: 'validation',
          status: 400,
          message: 'too broad',
          requestId: 'r1',
          details: { reason: 'too_broad' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'merhaba');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many messages match. Add a word or narrow the dates.',
    );
  });

  it("shows the error type's own sentence, with a retry, when the search could not run", async () => {
    serve(() =>
      Promise.reject(
        new ApiClientError({
          type: 'service_unavailable',
          status: 503,
          message: 'search timed out',
          requestId: 'r2',
          details: { reason: 'search_timeout' },
        }),
      ),
    );
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'merhaba');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The search couldn't be completed");
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says so when nothing matches, rather than showing an empty archive', async () => {
    serve(() => Promise.resolve({ items: [], total: 0 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'olmayan');

    expect(await screen.findByText('No messages match')).toBeInTheDocument();
  });

  it('flags an internal note', async () => {
    serve(() => Promise.resolve({ items: [hit('found-1', { internal: true })], total: 1 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'papara');

    expect(await screen.findByText('Internal note')).toBeInTheDocument();
  });

  it('opens the conversation at the matched message from "Go to this message"', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    serve(() => Promise.resolve({ items: [hit('found-1')], total: 1 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'papara');

    await user.click(await screen.findByRole('button', { name: 'Go to this message' }));

    await waitFor(() => {
      const target = document.querySelector(`[data-event-id="${MATCHED_EVENT}"]`);
      expect(target).toHaveAttribute('data-highlighted', 'true');
    });
    expect(scrolled).toHaveBeenCalled();
    expect(
      api.get.mock.calls.some(([url]) => (url as string).startsWith('/chats/found-1/events')),
    ).toBe(true);
    // Still on the results: the search is not lost by opening one.
    expect(screen.getByRole('button', { name: /Customer found-1/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(search).toBe('');
    scrolled.mockRestore();
  });

  it('opens the conversation without a highlight from its row', async () => {
    serve(() => Promise.resolve({ items: [hit('found-1')], total: 1 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'papara');

    await user.click(await screen.findByRole('button', { name: /Customer found-1/ }));

    await screen.findByText('merhaba');
    expect(document.querySelector('[data-highlighted]')).toBeNull();
  });

  it('goes back to the archive list when the search is cleared', async () => {
    serve(() => Promise.resolve({ items: [hit('found-1')], total: 1 }));
    const user = userEvent.setup();
    renderInbox();
    await openArchive(user);
    await ask(user, 'papara');
    await screen.findByRole('button', { name: /Customer found-1/ });

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Customer found-1/ })).toBeNull(),
    );
    expect(screen.getByText('Closed conversations will appear here.')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search message text' })).toHaveValue('');
  });
});
