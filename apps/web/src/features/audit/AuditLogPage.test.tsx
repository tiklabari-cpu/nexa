/**
 * Audit log screen (08.9.7-i). The read/write/filter/pagination logic is
 * proven server-side (08.9.7-a/b); this pins the render surface: rows show the
 * fields a reviewer needs, an empty trail says so instead of showing a bare
 * table, loading shows a skeleton, a failed fetch shows an error notice, and a
 * caller without `audit_log--all:ro` sees neither a fetch nor the list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

const ADMIN_SCOPES = ['audit_log--all:ro'];

let currentScopes = ADMIN_SCOPES;

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: currentScopes } }),
  };
});

const { AuditLogPage } = await import('./AuditLogPage.js');

const ENTRIES = {
  items: [
    {
      id: 'entry-1',
      action: 'member.role_changed',
      actor_id: 'a1111111-1111-1111-1111-111111111111',
      actor_type: 'agent' as const,
      target: 'account:b2222222-2222-2222-2222-222222222222',
      metadata: { from: 'agent', to: 'admin' },
      ip: '203.0.113.5',
      created_at: '2026-08-01T10:00:00.000Z',
    },
  ],
};

function renderPage(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  currentScopes = ADMIN_SCOPES;
  api.get.mockReset();
});

describe('AuditLogPage', () => {
  it('renders a row with its action, actor and time once entries load', async () => {
    api.get.mockResolvedValue(ENTRIES);
    renderPage(<AuditLogPage />);

    expect(await screen.findByText('member.role_changed')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('a1111111-1111-1111-1111-111111111111')).toBeInTheDocument();
    expect(screen.getByText('account:b2222222-2222-2222-2222-222222222222')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.5')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/audit-log');
  });

  it('shows a meaningful empty state when the trail has no entries', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderPage(<AuditLogPage />);

    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
    expect(screen.getByText(/will appear here as they happen/)).toBeInTheDocument();
  });

  it('shows a skeleton while the first page is loading', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    renderPage(<AuditLogPage />);

    expect(document.querySelector('[aria-hidden="true"].animate-pulse')).not.toBeNull();
  });

  it('shows an error notice when the fetch fails', async () => {
    api.get.mockRejectedValue(new Error('network down'));
    renderPage(<AuditLogPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the audit log');
  });

  it('neither fetches nor renders the list for a caller without audit_log--all:ro', () => {
    currentScopes = [];
    renderPage(<AuditLogPage />);

    expect(screen.getByText('Audit log not available')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
