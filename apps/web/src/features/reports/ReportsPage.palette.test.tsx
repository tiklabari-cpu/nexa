/**
 * The Reports page opens the view its address names (IN-11): the command
 * palette sends `?tab=<tab>` or `?view=<saved view id>`; the page applies it
 * once and clears the parameter, so choosing the same entry again still counts
 * as a change.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), getFile: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ReportsPage } = await import('./ReportsPage.js');

function Probe(): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => navigate('/app/reports?tab=reviews')}>
        go reviews
      </button>
    </>
  );
}

function renderAt(url: string): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <Probe />
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const selectedTab = (): string | undefined =>
  screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true')
    ?.textContent ?? undefined;

beforeEach(() => {
  // Nothing answers: the tab selection is the thing under test, not a report.
  api.get.mockImplementation(() => new Promise(() => {}));
  localStorage.removeItem('siyahtus.reports.saved-views');
});
afterEach(() => {
  localStorage.removeItem('siyahtus.reports.saved-views');
  vi.clearAllMocks();
});

describe('ReportsPage — opens the view named in the address (IN-11)', () => {
  it('opens on Overview with no parameter', () => {
    renderAt('/app/reports');
    expect(selectedTab()).toBe('Overview');
  });

  it('opens the tab named by ?tab= and clears the parameter', async () => {
    renderAt('/app/reports?tab=staffing');
    expect(selectedTab()).toBe('Staffing');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/reports$/),
    );
  });

  it('ignores a tab it does not know', async () => {
    renderAt('/app/reports?tab=nope');
    expect(selectedTab()).toBe('Overview');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/reports$/),
    );
  });

  it('switches when the palette sends the page a new ?tab= while it is open', async () => {
    renderAt('/app/reports?tab=staffing');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/reports$/),
    );

    screen.getByRole('button', { name: 'go reviews' }).click();
    await waitFor(() => expect(selectedTab()).toBe('Reviews'));
  });

  it('applies a saved view by ?view= — its tab, its range', async () => {
    localStorage.setItem(
      'siyahtus.reports.saved-views',
      JSON.stringify([
        {
          id: 'view-9',
          name: 'Weekly staffing',
          tab: 'staffing',
          mode: 7,
          customFrom: '',
          customTo: '',
          baseline: null,
        },
      ]),
    );
    renderAt('/app/reports?view=view-9');
    await waitFor(() => expect(selectedTab()).toBe('Staffing'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/reports$/),
    );
    const range = api.get.mock.calls
      .map((call) => String(call[0]))
      .find((p) => p.includes('staffing'));
    expect(range).toBeDefined();
  });

  it('drops a ?view= whose saved view no longer exists, leaving Overview', async () => {
    renderAt('/app/reports?view=gone');
    expect(selectedTab()).toBe('Overview');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/reports$/),
    );
  });
});
