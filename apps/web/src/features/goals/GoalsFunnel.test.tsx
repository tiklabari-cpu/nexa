/**
 * Goal funnel (FR-MOD-13.3-h). Pins the acceptance criteria: all three
 * stages render with their labels and counts ("3 aşamalı huni"), the
 * conversion rate reads "—" rather than NaN/Infinity when nothing
 * converted, and a workspace with no goals defined sees a meaningful empty
 * state instead of an all-zero funnel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { GoalsFunnel } = await import('./GoalsFunnel.js');

function report(overrides: {
  funnel?: Partial<{
    visitors: number;
    chats: number;
    conversions: number;
    conversion_rate: number | null;
  }>;
  by_goal?: Array<{ goal_id: string; name: string; conversions: number }>;
}) {
  return {
    range: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T00:00:00.000Z' },
    funnel: {
      visitors: 0,
      chats: 0,
      conversions: 0,
      conversion_rate: null as number | null,
      ...overrides.funnel,
    },
    by_goal: overrides.by_goal ?? [{ goal_id: 'g1', name: 'Signed up', conversions: 0 }],
  };
}

function renderFunnel(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <GoalsFunnel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
});

describe('GoalsFunnel', () => {
  it('renders all three stages with their labels and counts', async () => {
    api.get.mockResolvedValue(
      report({ funnel: { visitors: 100, chats: 40, conversions: 10, conversion_rate: 0.25 } }),
    );
    renderFunnel();

    expect(await screen.findByText('Visitors')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Chats')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('Conversions')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('reads the conversion rate as "—" rather than NaN/Infinity when nothing converted', async () => {
    api.get.mockResolvedValue(report({}));
    renderFunnel();

    await screen.findByText('Conversions');
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });

  it('shows a meaningful empty state when the workspace has no goals defined', async () => {
    api.get.mockResolvedValue(report({ by_goal: [] }));
    renderFunnel();

    expect(await screen.findByText('No conversions yet')).toBeInTheDocument();
    expect(screen.queryByText('Visitors')).not.toBeInTheDocument();
  });

  it('shows an error notice when the funnel fails to load', async () => {
    api.get.mockRejectedValue(new Error('network down'));
    renderFunnel();

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the goal funnel/);
  });
});

describe('GoalsFunnel localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the stage labels in Turkish, keeping the testid stable', async () => {
    api.get.mockResolvedValue(
      report({ funnel: { visitors: 100, chats: 40, conversions: 10, conversion_rate: 0.25 } }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <GoalsFunnel />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByText('Ziyaretçiler')).toBeInTheDocument();
    expect(screen.getByText('Sohbetler')).toBeInTheDocument();
    expect(screen.getByText('Dönüşümler')).toBeInTheDocument();
    expect(screen.getByTestId('goal-funnel-conversions')).toHaveTextContent('10');
  });
});
