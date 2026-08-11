/**
 * The Settings → IP allowlist & session policy screen (FR-MOD-08.9.6).
 *
 * The enforcement, validation and self-lockout guard are proven server-side
 * (08.9.6-c/d/e/g); this pins the management surface: the saved entries and
 * policy values render, adding an entry POSTs the right body, removing one
 * DELETEs by id, the policy form PATCHes `/settings/security`, a server 400
 * shows as a field-under alert, and a read-only viewer gets no edit controls.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { IpAllowlist } = await import('./IpAllowlist.js');

const ENTRIES = {
  items: [
    {
      id: 'entry-1',
      entry: '10.0.0.0/24',
      label: 'Office VPN',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

const SECURITY = {
  banned_customer_ips: [],
  file_sharing_enabled: true,
  allowed_file_types: ['image/png'],
  max_file_size_bytes: 10_485_760,
  spam_filter_enabled: true,
  require_two_factor: false,
  ip_allowlist_enforced: false,
  session_idle_timeout_seconds: null,
  max_concurrent_sessions: null,
  updated_at: null,
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockGet(path: string): unknown {
  if (path === '/settings/ip-allowlist') return Promise.resolve(ENTRIES);
  if (path === '/settings/security') return Promise.resolve(SECURITY);
  throw new Error(`unexpected GET ${path}`);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.patch.mockReset();
  api.get.mockImplementation(mockGet);
  api.post.mockResolvedValue(ENTRIES.items[0]);
  api.delete.mockResolvedValue(undefined);
  api.patch.mockResolvedValue(SECURITY);
});

describe('IpAllowlist', () => {
  it('lists the entries already allowed', async () => {
    renderComponent(<IpAllowlist canEdit />);
    expect(await screen.findByText('10.0.0.0/24')).toBeInTheDocument();
    expect(screen.getByText('Office VPN')).toBeInTheDocument();
  });

  it('shows a meaningful empty state when no entries exist', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/settings/ip-allowlist' ? Promise.resolve({ items: [] }) : mockGet(path),
    );
    renderComponent(<IpAllowlist canEdit />);
    expect(await screen.findByText('No allowlist entries')).toBeInTheDocument();
    expect(screen.getByText(/Add the addresses your team connects from/)).toBeInTheDocument();
  });

  it('adds an entry by POSTing the entry and label', async () => {
    renderComponent(<IpAllowlist canEdit />);
    await screen.findByText('10.0.0.0/24');

    await userEvent.type(screen.getByPlaceholderText('10.0.0.0/24'), '198.51.100.9');
    await userEvent.type(screen.getByPlaceholderText('Office VPN'), 'Bastion');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/ip-allowlist', {
        entry: '198.51.100.9',
        label: 'Bastion',
      }),
    );
  });

  it('removes an entry by DELETEing its id', async () => {
    renderComponent(<IpAllowlist canEdit />);
    await screen.findByText('10.0.0.0/24');

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/settings/ip-allowlist/entry-1'));
  });

  it('shows the self-lockout rejection as a field-under alert', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message:
          'That would lock you out: the list must still include the address you are connecting from.',
        requestId: '-',
      }),
    );
    renderComponent(<IpAllowlist canEdit />);
    await screen.findByText('10.0.0.0/24');

    await userEvent.type(screen.getByPlaceholderText('10.0.0.0/24'), '198.51.100.9');
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That would lock you out');
  });

  it('sends the session policy fields in one PATCH body', async () => {
    renderComponent(<IpAllowlist canEdit />);
    await screen.findByText('10.0.0.0/24');

    await userEvent.type(screen.getByLabelText('Idle timeout (minutes)'), '30');
    await userEvent.type(screen.getByLabelText('Max concurrent sessions'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/security', {
        session_idle_timeout_seconds: 1800,
        max_concurrent_sessions: 5,
      }),
    );
  });

  it('toggles enforcement by PATCHing ip_allowlist_enforced', async () => {
    renderComponent(<IpAllowlist canEdit />);
    await screen.findByText('10.0.0.0/24');

    await userEvent.click(screen.getByRole('checkbox', { name: /Enforce the IP allowlist/ }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/security', { ip_allowlist_enforced: true }),
    );
  });

  it('shows a server rejection of the policy save as an alert', async () => {
    api.patch.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'Enter a value of 1 or more.',
        requestId: '-',
      }),
    );
    renderComponent(<IpAllowlist canEdit />);
    await screen.findByText('10.0.0.0/24');

    await userEvent.click(screen.getByRole('checkbox', { name: /Enforce the IP allowlist/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Enter a value of 1 or more.');
  });

  it('offers no edit controls to a read-only viewer', async () => {
    renderComponent(<IpAllowlist canEdit={false} />);
    expect(await screen.findByText('10.0.0.0/24')).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Add entry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Idle timeout: Off')).toBeInTheDocument();
  });
});
