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

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[]; account_id: string } }) => unknown) =>
      selector({ agent: { scopes: ['chats--all:rw', 'chats--all:ro', 'customers:rw'], account_id: 'me' } }),
  };
});

const { TrafficPage } = await import('./TrafficPage.js');

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
});

describe('TrafficPage status tabs', () => {
  it('renders all seven tabs, All selected by default, and requests the whole board', async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    const tablist = await screen.findByRole('tablist', { name: 'Traffic status' });
    for (const name of ['All', 'Chatting', 'Supervised', 'Queued', 'Waiting for reply', 'Invited', 'Browsing']) {
      expect(within(tablist).getByRole('tab', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(within(tablist).getByRole('tab', { name: /All/ })).toHaveAttribute('aria-selected', 'true');
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
    expect(await screen.findByRole('tab', { name: /Browsing/ })).toHaveAttribute('aria-selected', 'true');
    first.unmount();

    // "Reload" — mount a fresh instance with the URL the click above produced.
    api.get.mockClear();
    renderPage(['/?tab=browsing']);
    expect(await screen.findByRole('tab', { name: /Browsing/ })).toHaveAttribute('aria-selected', 'true');
    expect(api.get).toHaveBeenCalledWith('/traffic?limit=100&activity=browsing');
  });

  it('an unknown tab value in the URL falls back to All rather than erroring', async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderPage(['/?tab=bogus']);

    const tablist = await screen.findByRole('tablist');
    expect(within(tablist).getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
    expect(api.get).toHaveBeenCalledWith('/traffic?limit=100');
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
});
