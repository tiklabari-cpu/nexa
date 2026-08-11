/**
 * Apps marketplace (FR-MOD-09.1): the card reads its status from `/settings/apps`
 * (never a hard-coded "Connected"), and "Connect" runs the consent → OAuth flow
 * — the permission step is shown before anything is connected, and authorizing
 * runs start → callback and flips the card to Connected.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppListItem, AppListResponse } from '@nexa/types';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { AppsMarketplace } = await import('./AppsMarketplace.js');

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const notConnected = {
  id: 'hubspot',
  name: 'HubSpot',
  category: 'crm',
  provider: 'oauth',
  icon: '🧡',
  description: 'See a contact’s lifecycle stage and open deals while you chat.',
  scopes: ['contacts.read', 'deals.read'],
  installed: false,
  installation: null,
};

const connected = {
  ...notConnected,
  installed: true,
  installation: {
    app_id: 'hubspot',
    status: 'connected',
    external_account: 'nexa+1@hubspot.example',
    scopes: ['contacts.read', 'deals.read'],
    connected_at: '2026-07-27T00:00:00.000Z',
  },
};

// A channel-typed app (09.2): managed in Channels, not connected in the marketplace.
const channelApp = {
  id: 'whatsapp',
  name: 'WhatsApp',
  category: 'channels',
  provider: 'oauth',
  icon: '📱',
  description: 'Answer WhatsApp messages. Connected in Settings → Channels.',
  scopes: ['whatsapp_business_messaging'],
  channel: 'whatsapp',
  installed: false,
  installation: null,
};

describe('AppsMarketplace', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
  });

  it('renders a card with the status read from the API', async () => {
    api.get.mockResolvedValue({ items: [notConnected] });
    renderComponent(<AppsMarketplace />);
    expect(await screen.findByText('HubSpot')).toBeInTheDocument();
    // Not-connected shows Connect and no Disconnect — the status is read, not faked.
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });

  it('shows the consent step, then connects through the OAuth flow', async () => {
    // The list starts not-connected and flips once the callback records it, so
    // the invalidation refetch returns the connected card.
    let installed = false;
    api.get.mockImplementation(() =>
      Promise.resolve({ items: [installed ? connected : notConnected] }),
    );
    api.post.mockImplementation((path: string) => {
      if (path.endsWith('/oauth/start')) {
        return Promise.resolve({ authorize_url: 'https://mock/authorize', state: 'signed-state' });
      }
      if (path.endsWith('/oauth/callback')) {
        installed = true;
        return Promise.resolve(connected);
      }
      return Promise.resolve({});
    });

    renderComponent(<AppsMarketplace />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    // The permission step lists the scopes before anything is connected.
    expect(await screen.findByText('Connect HubSpot')).toBeInTheDocument();
    expect(screen.getByText('contacts.read')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Authorize' }));

    // The card flips to connected once the refetch returns the installed item.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/settings/apps/hubspot/oauth/start');
    expect(api.post).toHaveBeenCalledWith('/settings/apps/hubspot/oauth/callback', {
      state: 'signed-state',
      code: 'mock-auth-code',
    });
  });

  it('disconnects a connected app', async () => {
    api.get.mockResolvedValue({ items: [connected] });
    api.delete.mockResolvedValue(undefined);
    renderComponent(<AppsMarketplace />);

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(api.delete).toHaveBeenCalledWith('/settings/apps/hubspot');
  });

  // KK 09.2: a channel-typed card sends you to Channels instead of Connect.
  it('links a channel-typed app to Channels instead of offering Connect', async () => {
    api.get.mockResolvedValue({ items: [channelApp] });
    renderComponent(<AppsMarketplace />);

    expect(await screen.findByText('WhatsApp')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Manage in Channels' });
    expect(link).toHaveAttribute('href', '/app/settings#section-channels');
    // No marketplace connect for a channel — it is set up in Channels.
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(screen.getByText('In Channels')).toBeInTheDocument();
  });

  // 09.2-v2-f: search + category filter, empty/skeleton states.
  it('debounces the search box before querying the API', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [notConnected], total: 1 });
    renderComponent(<AppsMarketplace />);
    await screen.findByText('HubSpot');

    const callsBeforeTyping = api.get.mock.calls.length;
    await user.type(screen.getByPlaceholderText('Search apps…'), 'hub');

    // Four keystrokes, but the request only fires once typing settles — not
    // once per keystroke (each one would count against the rate limit).
    expect(api.get.mock.calls.length).toBe(callsBeforeTyping);

    await waitFor(() => {
      const lastUrl = api.get.mock.calls.at(-1)?.[0] as string;
      expect(lastUrl).toContain('query=hub');
    });
  });

  it('filters by category through the chip row and marks it aria-pressed', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [notConnected], total: 1 });
    renderComponent(<AppsMarketplace />);
    await screen.findByText('HubSpot');

    const allChip = screen.getByRole('button', { name: 'All' });
    const crmChip = screen.getByRole('button', { name: 'CRM' });
    expect(allChip).toHaveAttribute('aria-pressed', 'true');
    expect(crmChip).toHaveAttribute('aria-pressed', 'false');

    await user.click(crmChip);

    expect(crmChip).toHaveAttribute('aria-pressed', 'true');
    expect(allChip).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      const lastUrl = api.get.mock.calls.at(-1)?.[0] as string;
      expect(lastUrl).toContain('category=crm');
    });
  });

  it('shows a skeleton while the first page is loading', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    renderComponent(<AppsMarketplace />);

    expect(document.querySelector('[aria-hidden="true"].animate-pulse')).not.toBeNull();
  });

  it('shows a meaningful empty state with no filter active', async () => {
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderComponent(<AppsMarketplace />);

    expect(await screen.findByText('No apps yet')).toBeInTheDocument();
    expect(
      screen.getByText('Connect the tools your team already uses from the marketplace.'),
    ).toBeInTheDocument();
  });

  it('shows a different empty state once a search is filtering the results', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [], total: 0 });
    renderComponent(<AppsMarketplace />);
    await screen.findByText('No apps yet');

    await user.type(screen.getByPlaceholderText('Search apps…'), 'zzz');

    await waitFor(() => {
      expect(screen.getByText('No apps match')).toBeInTheDocument();
    });
    expect(screen.getByText('Try a shorter search, or a different category.')).toBeInTheDocument();
  });

  // 09.2-v2-g: virtualized grid + page chain.
  describe('virtualization and paging', () => {
    const catalogueCard: AppListItem = {
      id: 'app-0',
      name: 'App 0',
      category: 'crm',
      provider: 'oauth',
      icon: '🧩',
      description: 'A catalogue card.',
      scopes: ['contacts.read'],
      channel: null,
      installed: false,
      installation: null,
    };

    /** The component's fixed row height — the unit the window maths work in. */
    const ROW_HEIGHT = 188;

    /**
     * jsdom has no layout, so scrolling is simulated the way the `VirtualList`
     * suite does it: pin `scrollTop`, then dispatch the scroll event the
     * component listens to.
     */
    function scrollTo(container: HTMLElement, top: number): void {
      Object.defineProperty(container, 'scrollTop', { configurable: true, value: top });
      fireEvent.scroll(container);
    }

    /** A page of catalogue cards named `<prefix> 0`, `<prefix> 1`, … */
    function page(prefix: string, count: number, nextPageId?: string): AppListResponse {
      return {
        items: Array.from({ length: count }, (_, i) => ({
          ...catalogueCard,
          id: `${prefix}-${i}`,
          name: `${prefix} ${i}`,
        })),
        total: 102,
        ...(nextPageId ? { next_page_id: nextPageId } : {}),
      };
    }

    // NFR-P4, birebir: "10.000+ satırda 60 fps; yalnız görünür satır DOM'da".
    it('keeps only the visible window in the DOM for a 100+ card catalogue', async () => {
      api.get.mockResolvedValue(page('app', 102));
      renderComponent(<AppsMarketplace />);
      await screen.findByText('app 0');

      const cards = screen.getAllByRole('listitem');
      // Well under the 102 cards the response carried: the window is the
      // viewport plus overscan, and nothing else is in the tree.
      expect(cards.length).toBeGreaterThan(0);
      expect(cards.length).toBeLessThan(30);
      expect(document.querySelectorAll('[data-testid^="app-"]').length).toBe(cards.length);
      // The cards past the window are genuinely absent, not merely hidden.
      expect(screen.queryByText('app 101')).toBeNull();
    });

    it('spaces the scroller for the rows it did not render', async () => {
      api.get.mockResolvedValue(page('app', 102));
      renderComponent(<AppsMarketplace />);
      await screen.findByText('app 0');

      // The un-rendered rows below the window become one aria-hidden spacer, so
      // the scrollbar still measures the whole list.
      const list = screen.getByRole('list', { name: 'Apps' });
      const spacers = Array.from(list.children).filter(
        (child): child is HTMLElement => child.getAttribute('aria-hidden') === 'true',
      );
      expect(spacers).toHaveLength(1); // nothing above the window at scrollTop 0
      expect(spacers[0]?.style.height).not.toBe('');
    });

    it('derives the column count from the measured container width', async () => {
      // jsdom reports 0 for every box, so the width is stubbed: at 1200px four
      // 260px cards fit, and the rows must be cut to four. This also pins the
      // measurement actually happening — the measured element is mounted for
      // the skeleton too, so the column count is not stranded at 1 once the
      // cards arrive.
      const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1200);
      try {
        api.get.mockResolvedValue(page('app', 102));
        renderComponent(<AppsMarketplace />);
        await screen.findByText('app 0');

        const row = screen.getByText('app 0').closest('[role="none"]');
        expect(row).toBeInTheDocument();
        expect((row as HTMLElement).style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
        const cards = screen.getAllByRole('listitem');
        expect(cards.length % 4).toBe(0);
        expect(cards.length).toBeLessThan(102); // still windowed, four across
      } finally {
        width.mockRestore();
      }
    });

    it('keeps the list/listitem contract, one listitem per app', async () => {
      api.get.mockResolvedValue(page('app', 3));
      renderComponent(<AppsMarketplace />);
      await screen.findByText('app 0');

      expect(screen.getByRole('list', { name: 'Apps' })).toBeInTheDocument();
      // Three apps, three listitems — the layout row itself is presentational.
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('asks for one page at a time and chains the next one onto the list', async () => {
      const user = userEvent.setup();
      api.get.mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('page_id=cursor-2') ? page('second', 2) : page('first', 50, 'cursor-2'),
        ),
      );
      renderComponent(<AppsMarketplace />);
      await screen.findByText('first 0');

      // The first request is bounded and cursor-less.
      const firstUrl = api.get.mock.calls[0]?.[0] as string;
      expect(firstUrl).toContain('limit=50');
      expect(firstUrl).not.toContain('page_id');

      await user.click(screen.getByRole('button', { name: 'Load more' }));
      await waitFor(() => {
        expect(api.get.mock.calls.at(-1)?.[0]).toContain('page_id=cursor-2');
      });
      // The chain ended, so the button retires itself.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      });

      // The second page was appended, not swapped in — it sits below the 50
      // cards of page one, so it is only in the DOM once the window gets there.
      expect(screen.queryByText('second 0')).toBeNull();
      scrollTo(screen.getByRole('list', { name: 'Apps' }), 52 * ROW_HEIGHT);

      expect(await screen.findByText('second 0')).toBeInTheDocument();
      expect(screen.getByText('second 1')).toBeInTheDocument();
      // …and page one has left the window rather than being duplicated.
      expect(screen.queryByText('first 0')).toBeNull();
      expect(screen.getAllByRole('listitem').length).toBeLessThan(30);
    });

    it('hides Load more on the last page', async () => {
      // No `next_page_id` — the chain is over and there is nothing to offer.
      api.get.mockResolvedValue(page('app', 10));
      renderComponent(<AppsMarketplace />);
      await screen.findByText('app 0');

      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('reaches Load more from the keyboard (NFR-A11Y6)', async () => {
      const user = userEvent.setup();
      api.get.mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('page_id=cursor-2') ? page('second', 2) : page('first', 50, 'cursor-2'),
        ),
      );
      renderComponent(<AppsMarketplace />);
      await screen.findByText('first 0');

      // A real button, so paging never depends on a scroll a keyboard user
      // cannot perform.
      const loadMore = screen.getByRole('button', { name: 'Load more' });
      loadMore.focus();
      expect(loadMore).toHaveFocus();
      await user.keyboard('{Enter}');

      await waitFor(() => {
        expect(api.get.mock.calls.at(-1)?.[0]).toContain('page_id=cursor-2');
      });
    });

    it('pulls the next page once the window reaches the last row (infinite scroll)', async () => {
      // Short first page: with the whole list inside the window there is nothing
      // left to scroll to, so the chain advances without a click.
      api.get.mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('page_id=cursor-2') ? page('second', 2) : page('first', 3, 'cursor-2'),
        ),
      );
      renderComponent(<AppsMarketplace />);

      expect(await screen.findByText('second 0')).toBeInTheDocument();
      expect(api.get).toHaveBeenCalledTimes(2);
    });

    it('starts the chain over when a filter changes', async () => {
      const user = userEvent.setup();
      api.get.mockImplementation((url: string) =>
        Promise.resolve(
          url.includes('category=crm')
            ? page('crm', 2)
            : url.includes('page_id=cursor-2')
              ? page('second', 2)
              : page('first', 50, 'cursor-2'),
        ),
      );
      renderComponent(<AppsMarketplace />);
      await screen.findByText('first 0');
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      // Both pages are loaded once the chain runs out of cursors.
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
      });

      await user.click(screen.getByRole('button', { name: 'CRM' }));

      // The narrowed list replaces both accumulated pages — a cursor from the
      // unfiltered chain must never be applied to a filtered one.
      expect(await screen.findByText('crm 0')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(2);
      expect(screen.queryByText('first 0')).toBeNull();
      expect(api.get.mock.calls.at(-1)?.[0]).not.toContain('page_id');
    });
  });
});
