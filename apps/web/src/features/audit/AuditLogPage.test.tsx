/**
 * Audit log screen (08.9.7-i/j). The read/write/filter/pagination logic is
 * proven server-side (08.9.7-a/b); this pins the render surface: rows show the
 * fields a reviewer needs, an empty trail says so instead of showing a bare
 * table, loading shows a skeleton, a failed fetch shows an error notice, a
 * caller without `audit_log--all:ro` sees neither a fetch nor the list, the
 * action/date filters narrow the request, "load more" only appears when the
 * server says there is one, and the filter selection round-trips through the
 * URL.
 *
 * Row assertions are scoped to the `<table>`: the action filter's options
 * carry the same raw action strings the table cells do (e.g. `auth.login`),
 * so an unscoped `getByText` can match the wrong element.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

const LOGIN_ENTRY = {
  id: 'entry-1',
  action: 'member.role_changed',
  actor_id: 'a1111111-1111-1111-1111-111111111111',
  actor_type: 'agent' as const,
  target: 'account:b2222222-2222-2222-2222-222222222222',
  metadata: { from: 'agent', to: 'admin' },
  ip: '203.0.113.5',
  created_at: '2026-08-01T10:00:00.000Z',
};

const ENTRIES = { items: [LOGIN_ENTRY] };

function renderPage(ui: ReactElement, initialEntries: string[] = ['/']): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The audit table only exists once a page has loaded; querying it also waits for that. */
function table(): HTMLElement {
  return screen.getByRole('table');
}

beforeEach(() => {
  currentScopes = ADMIN_SCOPES;
  api.get.mockReset();
});

describe('AuditLogPage', () => {
  it('renders a row with its action, actor and time once entries load', async () => {
    api.get.mockResolvedValue(ENTRIES);
    renderPage(<AuditLogPage />);

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('member.role_changed')).toBeInTheDocument();
    expect(rows.getByText('Agent')).toBeInTheDocument();
    expect(rows.getByText('a1111111-1111-1111-1111-111111111111')).toBeInTheDocument();
    expect(rows.getByText('account:b2222222-2222-2222-2222-222222222222')).toBeInTheDocument();
    expect(rows.getByText('203.0.113.5')).toBeInTheDocument();
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

  it('shows the default 30-day window before any filter is applied', async () => {
    api.get.mockResolvedValue(ENTRIES);
    renderPage(<AuditLogPage />);

    expect(await screen.findByText(/last 30 days/i)).toBeInTheDocument();
  });

  it('does not render "Load more" when the page carries no next_page_id', async () => {
    api.get.mockResolvedValue(ENTRIES);
    renderPage(<AuditLogPage />);

    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('fetches and appends the next page when "Load more" is clicked', async () => {
    const secondEntry = { ...LOGIN_ENTRY, id: 'entry-2', action: 'auth.login' };
    api.get
      .mockResolvedValueOnce({ items: [LOGIN_ENTRY], next_page_id: 'cursor-1' })
      .mockResolvedValueOnce({ items: [secondEntry] });
    renderPage(<AuditLogPage />);

    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    await userEvent.click(loadMore);

    await waitFor(() => expect(within(table()).getByText('auth.login')).toBeInTheDocument());
    expect(within(table()).getByText('member.role_changed')).toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/audit-log?page_id=cursor-1');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('sends the action filter as a query parameter and narrows the results', async () => {
    api.get
      .mockResolvedValueOnce(ENTRIES)
      .mockResolvedValueOnce({ items: [{ ...LOGIN_ENTRY, id: 'entry-3', action: 'auth.login' }] });
    renderPage(<AuditLogPage />);

    await screen.findByRole('table');

    await userEvent.selectOptions(screen.getByLabelText('Filter by action'), 'auth.login');

    await waitFor(() => expect(within(table()).getByText('auth.login')).toBeInTheDocument());
    expect(within(table()).queryByText('member.role_changed')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenLastCalledWith('/audit-log?action=auth.login');
  });

  it('sends a custom date range that overrides the default 30 days', async () => {
    api.get.mockResolvedValue(ENTRIES);
    renderPage(<AuditLogPage />);

    await screen.findByRole('table');
    api.get.mockClear();
    api.get.mockResolvedValue(ENTRIES);

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-07-15' } });

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/audit-log?date_from=2026-07-01T00%3A00%3A00.000Z&date_to=2026-07-15T23%3A59%3A59.999Z',
      ),
    );
  });

  it('writes the filter selection to the URL and restores it on reload', async () => {
    api.get.mockResolvedValue(ENTRIES);
    renderPage(<AuditLogPage />, ['/?action=auth.login&date_from=2026-07-01&date_to=2026-07-15']);

    await screen.findByRole('table');
    expect(api.get).toHaveBeenCalledWith(
      '/audit-log?action=auth.login&date_from=2026-07-01T00%3A00%3A00.000Z&date_to=2026-07-15T23%3A59%3A59.999Z',
    );

    expect(screen.getByLabelText('Filter by action')).toHaveValue('auth.login');
    expect(screen.getByLabelText('From date')).toHaveValue('2026-07-01');
    expect(screen.getByLabelText('To date')).toHaveValue('2026-07-15');
  });
});
