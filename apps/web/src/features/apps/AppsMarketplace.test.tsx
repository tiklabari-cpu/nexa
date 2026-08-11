/**
 * Apps marketplace (FR-MOD-09.1): the card reads its status from `/settings/apps`
 * (never a hard-coded "Connected"), and "Connect" runs the consent → OAuth flow
 * — the permission step is shown before anything is connected, and authorizing
 * runs start → callback and flips the card to Connected.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
