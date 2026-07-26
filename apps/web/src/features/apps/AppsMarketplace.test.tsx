/**
 * Apps marketplace (FR-MOD-09.1): the card reads its status from `/settings/apps`
 * (never a hard-coded "Connected"), and "Connect" runs the consent → OAuth flow
 * — the permission step is shown before anything is connected, and authorizing
 * runs start → callback and flips the card to Connected.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
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
});
