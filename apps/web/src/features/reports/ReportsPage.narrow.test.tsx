/**
 * Reports below 1024 px (GV-04 · tm 472.3): the sidebar's tabs are one picker
 * — sixteen tabs in a column would push the report a screen and a half down a
 * phone — and choosing from it is the same switch a tab click is. At a desktop
 * width the sidebar is unchanged.
 *
 * jsdom has no layout and no `matchMedia`, so the width is stubbed; whether
 * every report then fits 375 px with its tables as cards is a layout fact and
 * lives in `narrow-archive-reports.spec.ts` (the cards' labels: `CardTable.test.tsx`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), getFile: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ReportsPage } = await import('./ReportsPage.js');

function stubWidth(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
}

function renderAt(url: string): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const requested = (): string[] => api.get.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  // Nothing answers: which report is open is the thing under test, not its numbers.
  api.get.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Reports on a narrow window', () => {
  it('offers the reports as one picker instead of the sidebar’s tabs', () => {
    stubWidth(375);
    renderAt('/app/reports');
    const picker = screen.getByRole('combobox', { name: 'Report' });
    expect(picker).toHaveValue('overview');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    // The sidebar's categories are the picker's groups.
    expect(within(picker).getAllByRole('group').length).toBeGreaterThan(1);
    expect(within(picker).getByRole('option', { name: 'Staffing' })).toBeInTheDocument();
    // With no tab on screen the panel carries the report's name itself.
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBeInTheDocument();
  });

  it('opens the chosen report, as a tab click would', async () => {
    stubWidth(375);
    const user = userEvent.setup();
    renderAt('/app/reports');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Report' }), 'staffing');
    expect(screen.getByRole('tabpanel', { name: 'Staffing' })).toBeInTheDocument();
    await waitFor(() => expect(requested().some((url) => url.includes('staffing'))).toBe(true));
  });

  it('shows the report the address names in the picker at a tablet width', async () => {
    stubWidth(768);
    renderAt('/app/reports?tab=reviews');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Report' })).toHaveValue('reviews'),
    );
    expect(screen.getByRole('tabpanel', { name: 'Reviews' })).toBeInTheDocument();
  });

  it('keeps the sidebar’s tabs at a desktop width', () => {
    stubWidth(1024);
    renderAt('/app/reports');
    expect(screen.queryByRole('combobox', { name: 'Report' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });
});
