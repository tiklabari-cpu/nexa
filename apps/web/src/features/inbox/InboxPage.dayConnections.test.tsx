/**
 * A member's whole day in the console (ID-02 · tm 286.4).
 *
 * A member who came back the same day has one chat with two connections
 * (`Chat.connections`). The transcript used to read only the newest one, so
 * the agent answering the return never saw what was said that morning. These
 * pin the console end to end against a mocked API: the earlier connection is
 * read by its `thread_id` and drawn above the newest one, each behind a
 * separator naming its number, time and team; the header names the day and the
 * newest connection; the Details panel lists the day's connections; the list
 * row counts them. And a chat with one connection asks for nothing more.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { ChatConnection, ChatEvent } from './types.js';

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

const CHAT_ID = 'TJ1H8CFKRV';
const MORNING = 'C1MORNING0';
const AFTERNOON = 'C2AFTERNO0';

function message(threadId: string, seq: number, text: string, at: string): ChatEvent {
  return {
    id: `${threadId}_${seq}`,
    chat_id: CHAT_ID,
    thread_id: threadId,
    type: 'message',
    text,
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: at,
  };
}

const MORNING_MESSAGE = message(
  MORNING,
  1,
  'My Papara deposit is missing',
  '2026-10-15T07:00:00.000Z',
);
const AFTERNOON_MESSAGE = message(AFTERNOON, 1, 'Me again about it', '2026-10-15T11:02:00.000Z');

function connection(
  id: string,
  at: string,
  overrides: Partial<ChatConnection> = {},
): ChatConnection {
  return {
    id,
    active: false,
    created_at: at,
    closed_at: null,
    assignee_id: null,
    opened_via: 'first_of_day',
    group_id: null,
    ...overrides,
  };
}

let connections: ChatConnection[] = [];

function serve(): void {
  api.get.mockImplementation((url: string) => {
    if (url.startsWith('/chats?')) {
      const all = new URLSearchParams(url.slice(url.indexOf('?'))).get('view') === 'all';
      const items = all
        ? [
            {
              id: CHAT_ID,
              customer_id: 'cust-1',
              customer_name: 'Ada Visitor',
              active: true,
              created_at: '2026-10-15T07:00:00.000Z',
              thread_id: connections.at(-1)!.id,
              assignee_id: null,
              queue_position: null,
              unread_count: 0,
              connection_count: connections.length,
              last_event: connections.length > 1 ? AFTERNOON_MESSAGE : MORNING_MESSAGE,
              tags: [],
            },
          ]
        : [];
      return Promise.resolve({ items, total: items.length });
    }
    if (url === '/groups') {
      return Promise.resolve({ items: [{ id: 7, name: 'Bonus' }] });
    }
    if (url === `/chats/${CHAT_ID}`) {
      const newest = connections.at(-1)!;
      return Promise.resolve({
        id: CHAT_ID,
        license_id: '1',
        customer_id: 'cust-1',
        active: true,
        created_at: '2026-10-15T07:00:00.000Z',
        access: { group_ids: [7] },
        users: [],
        thread: {
          id: newest.id,
          chat_id: CHAT_ID,
          active: true,
          assignee_id: null,
          queue_position: null,
          summary: null,
          created_at: newest.created_at,
          closed_at: null,
          tags: [],
        },
        local_day: '2026-10-15',
        connections,
      });
    }
    if (url.startsWith(`/chats/${CHAT_ID}/events`)) {
      // No `thread_id` reads the newest connection, as the route does.
      const asked = new URLSearchParams(url.slice(url.indexOf('?'))).get('thread_id');
      const threadId = asked ?? connections.at(-1)!.id;
      const items = threadId === MORNING ? [MORNING_MESSAGE] : [AFTERNOON_MESSAGE];
      return Promise.resolve({ items });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

function renderInbox(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/app/inbox?chat=${CHAT_ID}`]}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const eventUrls = (): string[] =>
  api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith(`/chats/${CHAT_ID}/events`));

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({});
  connections = [];
});

describe('a member back the same day (ID-02 · tm 286.4)', () => {
  beforeEach(() => {
    connections = [
      connection(MORNING, '2026-10-15T07:00:00.000Z', { closed_at: '2026-10-15T07:30:00.000Z' }),
      connection(AFTERNOON, '2026-10-15T11:02:00.000Z', {
        active: true,
        opened_via: 'same_day_return',
        group_id: 7,
      }),
    ];
    serve();
  });

  it("draws the morning's connection above the return, each behind its own separator", async () => {
    renderInbox();
    const log = await screen.findByRole('log');

    expect(await within(log).findByText('My Papara deposit is missing')).toBeInTheDocument();
    expect(within(log).getByText('Me again about it')).toBeInTheDocument();
    // The morning was read by its own number; the newest by the default read.
    expect(eventUrls().some((url) => url.includes(`thread_id=${MORNING}`))).toBe(true);
    expect(eventUrls().some((url) => url.includes(`thread_id=${AFTERNOON}`))).toBe(false);

    const separators = within(log).getAllByTestId('connection-separator');
    expect(separators.map((node) => node.textContent)).toEqual([
      // The time is the runner's zone and locale; only its place is pinned.
      expect.stringMatching(new RegExp(`^Chat ID ${MORNING} · \\d{2}:\\d{2}[^·]*$`)),
      expect.stringMatching(new RegExp(`^Chat ID ${AFTERNOON} · \\d{2}:\\d{2}[^·]* · Bonus$`)),
    ]);

    // Oldest first: the morning, its separator before it, then the return.
    const text = log.textContent ?? '';
    expect(text.indexOf(MORNING)).toBeLessThan(text.indexOf('My Papara deposit is missing'));
    expect(text.indexOf('My Papara deposit is missing')).toBeLessThan(text.indexOf(AFTERNOON));
    expect(text.indexOf(AFTERNOON)).toBeLessThan(text.indexOf('Me again about it'));
  });

  it('names the day and the newest connection in the header', async () => {
    renderInbox();
    await screen.findByRole('log');
    // A header inside `main` has no landmark role, so it is found as an element.
    const header = await waitFor(() => {
      const found = Array.from(document.querySelectorAll('header')).find((node) =>
        node.textContent?.includes(AFTERNOON),
      );
      expect(found).toBeDefined();
      return found;
    });
    expect(header).toBeDefined();
    expect(within(header!).getByText('Thread ID')).toBeInTheDocument();
    expect(within(header!).getByText(CHAT_ID)).toBeInTheDocument();
    expect(within(header!).getByText('Chat ID')).toBeInTheDocument();
  });

  it("lists today's connections in Details and counts them on the list row", async () => {
    renderInbox();
    const panel = await screen.findByRole('complementary', { name: 'Conversation details' });
    expect(await within(panel).findByText("Today's connections")).toBeInTheDocument();
    const list = within(panel).getByRole('list', { name: 'Chat ID' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(MORNING);
    expect(rows[0]).toHaveTextContent('First of the day');
    expect(rows[0]).toHaveTextContent('Closed');
    expect(rows[1]).toHaveTextContent(AFTERNOON);
    await waitFor(() => expect(rows[1]).toHaveTextContent('Came back · Bonus'));
    expect(rows[1]).toHaveTextContent('Open');

    expect(await screen.findByText('2 connections')).toBeInTheDocument();
  });
});

describe('a chat with a single connection', () => {
  beforeEach(() => {
    connections = [connection(MORNING, '2026-10-15T07:00:00.000Z', { active: true })];
    serve();
  });

  it('reads nothing beyond its one connection and draws no separator or count', async () => {
    renderInbox();
    const log = await screen.findByRole('log');
    expect(await within(log).findByText('My Papara deposit is missing')).toBeInTheDocument();

    expect(eventUrls().every((url) => !url.includes('thread_id='))).toBe(true);
    expect(within(log).queryByTestId('connection-separator')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d connections?$/)).not.toBeInTheDocument();
  });
});
