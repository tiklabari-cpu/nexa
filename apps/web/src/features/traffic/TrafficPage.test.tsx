/**
 * The traffic board's status tabs (13.2-g): all seven render as a
 * `role=tablist`, the selected one fills 13.2-f's `activity` query parameter
 * rather than re-slicing an already-loaded list, an empty tab shows a
 * meaningful message (FR-EK-B.1) instead of a bare rectangle, and the
 * selection round-trips through the URL.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { TrafficVisitor } from './types.js';

const { api, scopes } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  // Mutable so a test can pin the caller's real scope set. The default is an
  // owner's, verbatim from `ADMIN_SCOPES` — write scopes only, no literal `:ro`.
  scopes: { current: ['chats--all:rw', 'customers:rw'] },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[]; account_id: string } }) => unknown) =>
      selector({ agent: { scopes: scopes.current, account_id: 'me' } }),
  };
});

const { TrafficPage, mergeTrafficHead } = await import('./TrafficPage.js');

function visitor(over: Partial<TrafficVisitor> & { customer_id: string }): TrafficVisitor {
  return {
    name: null,
    email: null,
    activity: 'browsing',
    chat_id: null,
    chatting_with: null,
    last_activity_at: null,
    ...over,
  };
}

/** A visitor with a distinct `last_activity_at` — higher `minute` sorts first. */
function v(id: string, minute: number, over: Partial<TrafficVisitor> = {}): TrafficVisitor {
  return visitor({
    customer_id: id,
    last_activity_at: `2026-08-27T10:${String(minute).padStart(2, '0')}:00.000Z`,
    ...over,
  });
}

function trafficPage(
  items: TrafficVisitor[],
  next?: string,
): { items: TrafficVisitor[]; total: number; next_page_id?: string } {
  return { items, total: items.length, ...(next != null ? { next_page_id: next } : {}) };
}

function renderPage(initialEntries: string[] = ['/']): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>
        <TrafficPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  scopes.current = ['chats--all:rw', 'customers:rw'];
});

describe('TrafficPage status tabs', () => {
  it('renders all seven tabs, All selected by default, and requests the whole board', async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Traffic status' });
    for (const name of [
      'All',
      'Chatting',
      'Supervised',
      'Queued',
      'Waiting for reply',
      'Invited',
      'Browsing',
    ]) {
      expect(within(tablist).getByRole('tab', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(within(tablist).getByRole('tab', { name: /All/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(api.get).toHaveBeenCalledWith('/traffic?limit=100');
  });

  it('shows per-tab counts on the unfiltered board and sums them to All', async () => {
    api.get.mockResolvedValue({
      items: [
        visitor({ customer_id: 'a', activity: 'chatting' }),
        visitor({ customer_id: 'b', activity: 'chatting' }),
        visitor({ customer_id: 'c', activity: 'queued' }),
      ],
      total: 3,
    });
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Traffic status' });
    const allTab = within(tablist).getByRole('tab', { name: /^All/ });
    const chattingTab = within(tablist).getByRole('tab', { name: /Chatting/ });
    const queuedTab = within(tablist).getByRole('tab', { name: /Queued/ });
    // The counts only appear once the (async) fetch resolves.
    expect(await within(allTab).findByText('3')).toBeInTheDocument();
    expect(await within(chattingTab).findByText('2')).toBeInTheDocument();
    expect(await within(queuedTab).findByText('1')).toBeInTheDocument();
  });

  it('selecting a tab requests only that state from the server (no client-side re-filtering)', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    await screen.findByRole('tablist');
    await user.click(screen.getByRole('tab', { name: /Queued/ }));

    expect(api.get).toHaveBeenLastCalledWith('/traffic?limit=100&activity=queued');
  });

  it('shows a tab-specific empty state, not a bare rectangle, when a tab has no visitors', async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage(['/?tab=queued']);

    expect(await screen.findByText('The queue is empty')).toBeInTheDocument();
    expect(
      screen.getByText('Visitors waiting for an agent to pick up their conversation appear here.'),
    ).toBeInTheDocument();
  });

  it('writes the selected tab to the URL and restores it on reload', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [], total: 0 });
    const first = renderPage();

    await screen.findByRole('tablist');
    await user.click(screen.getByRole('tab', { name: /Browsing/ }));
    expect(await screen.findByRole('tab', { name: /Browsing/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    first.unmount();

    // "Reload" — mount a fresh instance with the URL the click above produced.
    api.get.mockClear();
    renderPage(['/?tab=browsing']);
    expect(await screen.findByRole('tab', { name: /Browsing/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(api.get).toHaveBeenCalledWith('/traffic?limit=100&activity=browsing');
  });

  it('an unknown tab value in the URL falls back to All rather than erroring', async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage(['/?tab=bogus']);

    const tablist = await screen.findByRole('tablist');
    expect(within(tablist).getByRole('tab', { name: /^All/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(api.get).toHaveBeenCalledWith('/traffic?limit=100');
  });

  it('is one Tab stop with the arrows moving inside it (NFR-A11Y4)', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Traffic status' });
    const tabs = within(tablist).getAllByRole('tab');
    // Roving tabIndex: the strip is reached in one Tab press, not seven.
    expect(tabs.filter((t) => t.tabIndex === 0)).toHaveLength(1);
    expect(tabs[0]).toHaveAttribute('tabindex', '0');

    tabs[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(within(tablist).getByRole('tab', { name: /Chatting/ })).toHaveFocus();
    expect(within(tablist).getByRole('tab', { name: /Chatting/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Exactly one tab is ever selected — a strip claiming two is a lie a screen
    // reader has no way to resolve (NFR-A11Y5).
    expect(
      within(tablist)
        .getAllByRole('tab')
        .filter((t) => t.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);

    // Wrapping both ways, plus the jump keys the pattern requires.
    await user.keyboard('{ArrowLeft}');
    expect(within(tablist).getByRole('tab', { name: /^All/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(within(tablist).getByRole('tab', { name: /Browsing/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(within(tablist).getByRole('tab', { name: /^All/ })).toHaveFocus();
    await user.keyboard('{End}');
    expect(within(tablist).getByRole('tab', { name: /Browsing/ })).toHaveFocus();
  });

  it('arrow-key selection asks the server for that tab, exactly as a click does', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Traffic status' });
    within(tablist).getByRole('tab', { name: /^All/ }).focus();
    await user.keyboard('{End}');

    expect(api.get).toHaveBeenLastCalledWith('/traffic?limit=100&activity=browsing');
  });

  it('the Supervise row action registers the caller as a watcher in addition to navigating', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      items: [visitor({ customer_id: 'a', activity: 'chatting', chat_id: 'chat-1' })],
      total: 1,
    });
    api.post.mockResolvedValue({});
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Supervise chat' }));

    expect(api.post).toHaveBeenCalledWith('/chats/chat-1/supervise');
  });

  it('enables the row actions an owner’s write scopes already imply (13.2-k)', async () => {
    // The bug this pins: `chats--all:rw` expands to `chats--all:ro` on the
    // server, so `POST /chats/{id}/supervise` accepts an owner — but the row
    // tested literal membership and left Supervise disabled for every owner and
    // admin, i.e. for everybody who supervises.
    api.get.mockResolvedValue({
      items: [visitor({ customer_id: 'a', activity: 'chatting', chat_id: 'chat-1' })],
      total: 1,
    });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Supervise chat' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Assign chat to me' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit contact' })).toBeEnabled();
  });

  it('still refuses the actions a read-only caller has no scope for', async () => {
    scopes.current = ['chats--all:ro', 'customers:ro'];
    api.get.mockResolvedValue({
      items: [visitor({ customer_id: 'a', activity: 'chatting', chat_id: 'chat-1' })],
      total: 1,
    });
    renderPage();

    // Watching is a read, so it stays available; taking the chat over and
    // editing the contact are writes and must not be.
    expect(await screen.findByRole('button', { name: 'Supervise chat' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Assign chat to me' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit contact' })).toBeDisabled();
  });
});

/**
 * Paging (P5-PAGE-f). `TrafficPage`'s `useQuery` moved onto 153.1's
 * `usePagedQuery`, the same wrapper Tickets/Customers (153.4/153.5) consume —
 * `TicketGrid.test.tsx` established that a page small enough to fit the
 * virtualizer's fallback viewport already sits in `onEndReached`'s trailing
 * zone on mount, so these fixtures (two rows) walk to a second page without
 * simulating a real scroll.
 */
describe('paging (P5-PAGE-f)', () => {
  const c1 = v('c1', 14, { name: 'Alex Moreau' });
  const c2 = v('c2', 13, { name: 'Mira Haddad' });
  const c3 = v('c3', 12, { name: 'Robin Lee' });

  it('walks past the first page as the table scrolls', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=cursor-1') ? trafficPage([c3]) : trafficPage([c1, c2], 'cursor-1'),
      ),
    );
    renderPage();

    await screen.findByText('Alex Moreau');
    // Second page arrives on its own — see the block comment above.
    await screen.findByText('Robin Lee');
    expect(api.get).toHaveBeenCalledWith('/traffic?limit=100&page_id=cursor-1');
  });

  it('a tab change starts a new chain instead of appending to the loaded one', async () => {
    const user = userEvent.setup();
    const queued = v('q1', 20, { name: 'Quinn', activity: 'queued' });
    api.get.mockImplementation((url: string) => {
      if (url.includes('activity=queued')) return Promise.resolve(trafficPage([queued]));
      if (url.includes('page_id=cursor-1')) return Promise.resolve(trafficPage([c3]));
      return Promise.resolve(trafficPage([c1, c2], 'cursor-1'));
    });
    renderPage();
    // Load past the first page before switching tabs, so a chain genuinely
    // exists to be thrown away rather than appended to.
    await screen.findByText('Robin Lee');

    api.get.mockClear();
    await user.click(screen.getByRole('tab', { name: /Queued/ }));

    await screen.findByText('Quinn');
    expect(screen.queryByText('Alex Moreau')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/traffic?limit=100&activity=queued');
  });

  it('shows a visitor once even when a later page hands it back too', async () => {
    // The board shrinking between two fetches can put the same row on two
    // pages (see `TrafficPage.tsx`'s `items` comment) — this pins the fix,
    // the same de-dup `useChatList` needs for its own paged cache.
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=cursor-1')
          ? trafficPage([c2, c3])
          : trafficPage([c1, c2], 'cursor-1'),
      ),
    );
    renderPage();

    await screen.findByText('Alex Moreau');
    await screen.findByText('Robin Lee');
    expect(screen.getAllByText('Mira Haddad')).toHaveLength(1);
  });
});

/**
 * The board is live (8s poll) as well as paged — the periodic refresh must
 * re-read only the first page and fold it into the cache without discarding
 * pages the agent has already scrolled to (same rule as 153.2's chat list;
 * `mergeChatHead`'s tests are the direct precedent for testing the merge as
 * a pure function rather than driving the `setInterval` in a component test).
 */
describe('mergeTrafficHead', () => {
  const cache = {
    pages: [trafficPage([c1(), c2()], 'cursor-1'), trafficPage([c3()])],
    pageParams: [undefined, 'cursor-1'] as Array<string | undefined>,
  };

  function c1(): TrafficVisitor {
    return v('c1', 14);
  }
  function c2(): TrafficVisitor {
    return v('c2', 13);
  }
  function c3(): TrafficVisitor {
    return v('c3', 12);
  }

  it('keeps the row the arrivals pushed out of the newest window', () => {
    const merged = mergeTrafficHead(cache, trafficPage([v('c0', 15), c1()], 'cursor-fresh'));
    expect(merged?.pages[0]?.items.map((visitor) => visitor.customer_id)).toEqual([
      'c0',
      'c1',
      'c2',
    ]);
    // The cursor page 2 was fetched with, not the fresh one: replacing it
    // would leave `c3` covered by no page at all.
    expect(merged?.pages[0]?.next_page_id).toBe('cursor-1');
    expect(merged?.pages[1]).toBe(cache.pages[1]);
    expect(merged?.pageParams).toEqual([undefined, 'cursor-1']);
  });

  it('drops a row the fresh window reached and did not return', () => {
    // `c2` is inside the range the fresh page covers and is absent from it —
    // the visitor left the board (chat closed, visit aged out).
    const merged = mergeTrafficHead(cache, trafficPage([c1(), v('c3b', 12)], 'cursor-fresh'));
    expect(merged?.pages[0]?.items.map((visitor) => visitor.customer_id)).toEqual(['c1', 'c3b']);
  });

  it('takes the fresh cursor when no page follows the first', () => {
    const single = { pages: [trafficPage([c1()])], pageParams: [undefined] };
    const merged = mergeTrafficHead(single, trafficPage([v('c0', 15), c1()], 'cursor-fresh'));
    expect(merged?.pages[0]?.next_page_id).toBe('cursor-fresh');
  });

  it('an empty first page empties the whole board', () => {
    const merged = mergeTrafficHead(cache, trafficPage([]));
    expect(merged?.pages).toHaveLength(1);
    expect(merged?.pages[0]?.items).toEqual([]);
    expect(merged?.pageParams).toEqual([undefined]);
  });

  it('leaves an unloaded board alone — its own first fetch is the refresh', () => {
    expect(mergeTrafficHead(undefined, trafficPage([c1()]))).toBeUndefined();
  });
});
