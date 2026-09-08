/**
 * Channel views (FR-MOD-02.1.4) — the half of the criterion that was missing.
 *
 * The Views group already met "kanal bağlı değilse channel-promo": with nothing
 * connected it renders a dashed CTA to Settings → Channels. What it did not do
 * was be a *view*. Each connected channel rendered as `<Link to="/app/settings">`,
 * so the one interaction the group offered when a workspace HAD connected a
 * channel was to leave the inbox — the audit's finding, and the reason the
 * requirement sat at `◐`.
 *
 * So the assertions below are about the row being a filter: it narrows the
 * middle list through the server rather than re-slicing loaded rows, it
 * composes with the base view instead of replacing it, the rail badge beside it
 * counts the same intersection the list shows, and pressing it again clears it.
 * The promo's own behaviour is re-asserted unchanged, because "fix the
 * connected case" is exactly the change most likely to take the disconnected
 * one with it.
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
        // An owner/admin: holds `channels--all`, so the Views group reads
        // channel state and the channel rows render at all.
        agent: {
          scopes: ['chats--all:rw', 'channels--all:ro'],
          account_id: 'me',
          routing_status: 'offline',
        },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

/** What `GET /channels` reports. Mutated per test; reset in `beforeEach`. */
let connected: Array<{ type: string; connected: boolean }> = [];

/**
 * How many conversations each (view, channel) pair holds, as the server counts
 * them. The point of the table is that the two axes are independent — `my` on
 * WhatsApp is neither `my` nor WhatsApp — so a client that dropped one of them
 * lands on a number that is in here for the wrong reason.
 */
function totalFor(view: string, channel: string | null): number {
  if (channel === 'whatsapp') return view === 'all' ? 2 : view === 'my' ? 1 : 0;
  if (channel === 'messenger') return view === 'all' ? 1 : 0;
  return view === 'all' ? 6 : view === 'my' ? 4 : 0;
}

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?')));
}

function serve(): void {
  api.get.mockImplementation((url: string) => {
    if (url === '/channels') return Promise.resolve({ items: connected });
    if (url.startsWith('/chats?')) {
      const query = paramsOf(url);
      const view = query.get('view') ?? 'all';
      const channel = query.get('channel');
      const total = totalFor(view, channel);
      return Promise.resolve({
        items: Array.from({ length: total }, (_, i) => ({
          id: `${channel ?? 'any'}-${view}-${i}`,
          customer_id: `c-${channel ?? 'any'}-${view}-${i}`,
          customer_name: `${channel ?? 'every channel'} ${view} ${i}`,
          active: true,
          created_at: '2026-09-08T10:00:00.000Z',
          thread_id: `t-${channel ?? 'any'}-${view}-${i}`,
          assignee_id: null,
          queue_position: null,
          unread_count: 0,
          last_event: null,
          tags: [],
        })),
        total,
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
        created_at: '2026-09-08T10:00:00.000Z',
        access: { group_ids: [] },
        users: [],
        thread: {
          id: `t-${id}`,
          chat_id: id,
          active: true,
          assignee_id: null,
          queue_position: null,
          summary: null,
          created_at: '2026-09-08T10:00:00.000Z',
          closed_at: null,
          tags: [],
        },
        visitor: null,
      });
    }
    return Promise.resolve({ items: [], total: 0 });
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

function rail(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Inbox views' });
}

/**
 * The middle list, scoped. A customer's name is on screen twice — once as a row
 * and once as the open transcript's heading — so an unscoped `getByText` finds
 * two and fails for a reason that has nothing to do with filtering.
 */
function conversations(): HTMLElement {
  return screen.getByRole('region', { name: 'Conversations' });
}

/** Every `/chats` list URL this render has asked for, newest last. */
function chatUrls(): string[] {
  return api.get.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.startsWith('/chats?'));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  localStorage.clear();
  connected = [
    { type: 'whatsapp', connected: true },
    { type: 'messenger', connected: true },
  ];
  serve();
});

describe('channel views (FR-MOD-02.1.4)', () => {
  it('renders a connected channel as a filter, not a link to Settings', async () => {
    renderInbox();

    const whatsapp = await within(rail()).findByRole('button', { name: /WhatsApp/ });
    expect(whatsapp).toHaveAttribute('aria-pressed', 'false');
    // The defect itself: the row used to be a `<Link to="/app/settings">`, so
    // the group's only interaction was leaving the inbox.
    expect(within(rail()).queryByRole('link', { name: /WhatsApp/ })).not.toBeInTheDocument();
  });

  it('narrows the middle list through the server when a channel is picked', async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(await within(rail()).findByRole('button', { name: /WhatsApp/ }));

    await waitFor(() =>
      expect(chatUrls().some((url) => paramsOf(url).get('channel') === 'whatsapp')).toBe(true),
    );
    // The rows on screen are the ones the server returned for that channel —
    // not six rows filtered down in the browser, which is what a channel view
    // built on the loaded page would have produced.
    expect(await within(conversations()).findByText('whatsapp all 0')).toBeInTheDocument();
    expect(within(conversations()).queryByText('every channel all 0')).not.toBeInTheDocument();
  });

  it('composes with the base view rather than replacing it', async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(await within(rail()).findByRole('button', { name: /^My chats/ }));
    await user.click(await within(rail()).findByRole('button', { name: /WhatsApp/ }));

    // `view` and `channel` are orthogonal axes: "my WhatsApp conversations" is
    // one request, not a choice between two filters.
    await waitFor(() => {
      const both = chatUrls()
        .map(paramsOf)
        .some((query) => query.get('view') === 'my' && query.get('channel') === 'whatsapp');
      expect(both).toBe(true);
    });
    // The base view is still the one selected — the heading did not slide back
    // to "All" under the agent.
    expect(screen.getByRole('heading', { level: 2, name: 'My chats' })).toBeInTheDocument();
    expect(await within(conversations()).findByText('whatsapp my 0')).toBeInTheDocument();
  });

  it('makes the rail badges count the channel too', async () => {
    const user = userEvent.setup();
    renderInbox();

    // `/^All \d+$/` rather than `/^All/`: the Tickets group's own "All tickets"
    // sits in the same `nav` and would match the looser pattern.
    const all = await within(rail()).findByRole('button', { name: /^All \d+$/ });
    expect(within(all).getByText('6')).toBeInTheDocument();

    await user.click(await within(rail()).findByRole('button', { name: /WhatsApp/ }));

    // A badge that ignored the filter beside it would promise six conversations
    // that clicking cannot produce — the "loaded window read as the real total"
    // defect (tm 179.4) in a new disguise.
    await waitFor(() => expect(within(all).getByText('2')).toBeInTheDocument());
    const mine = within(rail()).getByRole('button', { name: /^My chats \d+$/ });
    expect(within(mine).getByText('1')).toBeInTheDocument();
  });

  it('clears the filter when the channel already in force is pressed again', async () => {
    const user = userEvent.setup();
    renderInbox();

    const whatsapp = await within(rail()).findByRole('button', { name: /WhatsApp/ });
    await user.click(whatsapp);
    await waitFor(() => expect(whatsapp).toHaveAttribute('aria-pressed', 'true'));

    await user.click(whatsapp);
    expect(whatsapp).toHaveAttribute('aria-pressed', 'false');
    // Back to every channel, and the rows say so.
    expect(await within(conversations()).findByText('every channel all 0')).toBeInTheDocument();
  });

  it('only ever presses one channel at a time', async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(await within(rail()).findByRole('button', { name: /WhatsApp/ }));
    const messenger = within(rail()).getByRole('button', { name: /Messenger/ });
    await user.click(messenger);

    expect(messenger).toHaveAttribute('aria-pressed', 'true');
    expect(within(rail()).getByRole('button', { name: /WhatsApp/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await within(conversations()).findByText('messenger all 0')).toBeInTheDocument();
  });

  it('explains an empty channel in its own words', async () => {
    const user = userEvent.setup();
    renderInbox();

    await user.click(await within(rail()).findByRole('button', { name: /Messenger/ }));
    await user.click(await within(rail()).findByRole('button', { name: /^My chats/ }));

    // "New conversations land here as they arrive" is true of the inbox and
    // misleading of a channel nobody has written in on.
    expect(
      await screen.findByText('No conversations have arrived on this channel yet.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('New conversations land here as they arrive.'),
    ).not.toBeInTheDocument();
  });

  it('leaves the channel-promo half of the criterion exactly as it was', async () => {
    connected = [{ type: 'whatsapp', connected: false }];
    renderInbox();

    // Nothing connected → the dashed promo, and its CTA is still a link to
    // Settings: with no channel there is nothing to filter to, so navigating
    // away is the right answer here and only here.
    expect(await screen.findByTestId('channel-promo')).toBeInTheDocument();
    expect(within(rail()).getByRole('link', { name: 'Connect a channel →' })).toHaveAttribute(
      'href',
      '/app/settings',
    );
    // And no request ever carried a channel the workspace has not connected.
    await waitFor(() => expect(chatUrls().length).toBeGreaterThan(0));
    expect(chatUrls().every((url) => paramsOf(url).get('channel') === null)).toBe(true);
  });
});
