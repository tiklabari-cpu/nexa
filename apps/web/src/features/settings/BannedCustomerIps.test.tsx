/**
 * The Settings → Blocked IP addresses list (FR-MOD-08.9.2).
 *
 * The enforcement is proven server-side; this pins the management surface: the
 * saved addresses render, adding one PATCHes the whole list with the new entry
 * appended, and removing one PATCHes it back without that entry — the shape the
 * `/settings/security` route expects.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

// Imported after the mock so the component picks up the stubbed client.
const { BannedCustomerIps } = await import('./SettingsPage.js');

const SETTINGS = {
  banned_customer_ips: ['203.0.113.5'],
  file_sharing_enabled: true,
  allowed_file_types: ['image/png'],
  max_file_size_bytes: 10_485_760,
  spam_filter_enabled: true,
  require_two_factor: false,
  updated_at: null,
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue(SETTINGS);
  api.patch.mockResolvedValue(SETTINGS);
});

describe('BannedCustomerIps', () => {
  it('lists the addresses already blocked', async () => {
    renderComponent(<BannedCustomerIps canEdit />);
    expect(await screen.findByText('203.0.113.5')).toBeInTheDocument();
  });

  it('blocks a new address by PATCHing the list with it appended', async () => {
    renderComponent(<BannedCustomerIps canEdit />);
    await screen.findByText('203.0.113.5');

    await userEvent.type(screen.getByPlaceholderText('203.0.113.5'), '198.51.100.9');
    await userEvent.click(screen.getByRole('button', { name: 'Block address' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/security', {
        banned_customer_ips: ['203.0.113.5', '198.51.100.9'],
      }),
    );
  });

  it('removes an address by PATCHing the list without it', async () => {
    renderComponent(<BannedCustomerIps canEdit />);
    await screen.findByText('203.0.113.5');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/security', {
        banned_customer_ips: [],
      }),
    );
  });

  it('offers no add or remove controls to a read-only viewer', async () => {
    renderComponent(<BannedCustomerIps canEdit={false} />);
    expect(await screen.findByText('203.0.113.5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Block address' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('BannedCustomerIps localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Blocked IP addresses in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <BannedCustomerIps canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(
      await screen.findByRole('region', { name: 'Engellenen IP adresleri' }),
    ).toBeInTheDocument();
  });
});
