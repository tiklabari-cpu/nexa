/**
 * The performance tab (FR-MOD-06.5): cards come from the reports the invoice
 * trusts, a rate on too few chats is flagged rather than shown bare, and when
 * the AI is off the figures are labelled as history.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { AiPerformance } = await import('./AiPerformance.js');

function mockReports(over: {
  resolution_rate?: number | null;
  resolutions?: number;
  transfers?: number;
  transfer_rate?: number | null;
  score?: number | null;
  responses?: number;
}): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/reports/ai-agent') {
      return Promise.resolve({
        resolutions: over.resolutions ?? 0,
        resolution_rate: over.resolution_rate ?? null,
        transfers: over.transfers ?? 0,
        transfer_rate: over.transfer_rate ?? null,
        skill_runs: 0,
        avg_automated_duration_seconds: null,
      });
    }
    if (path === '/reports/overview') {
      return Promise.resolve({
        satisfaction: { score: over.score ?? null, responses: over.responses ?? 0 },
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderPerf(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
});

describe('AiPerformance', () => {
  it('renders the four KPI cards from the reports', async () => {
    mockReports({ resolutions: 40, resolution_rate: 0.8, transfers: 10, transfer_rate: 0.2, score: 0.9, responses: 60 });
    renderPerf(<AiPerformance agentActive canRead />);

    expect(await screen.findByText('Resolution rate')).toBeInTheDocument();
    expect(screen.getByText('AI chats resolved')).toBeInTheDocument();
    expect(screen.getByText('CSAT')).toBeInTheDocument();
    expect(screen.getByText('Transferred')).toBeInTheDocument();
    // The resolution figure is the report's number, formatted.
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('flags a rate that rests on too few chats', async () => {
    mockReports({ resolutions: 2, resolution_rate: 1, transfers: 1, transfer_rate: 0.333 });
    renderPerf(<AiPerformance agentActive canRead />);

    expect(await screen.findAllByText(/Based on few chats/)).not.toHaveLength(0);
  });

  it('labels the figures as historical when the AI is off', async () => {
    mockReports({ resolutions: 30, resolution_rate: 0.5, responses: 30, score: 0.8 });
    renderPerf(<AiPerformance agentActive={false} canRead />);

    expect(await screen.findByText(/historical figures/i)).toBeInTheDocument();
  });

  it('does not label history when the AI is on', async () => {
    mockReports({ resolutions: 30, resolution_rate: 0.5, responses: 30, score: 0.8 });
    renderPerf(<AiPerformance agentActive canRead />);

    await screen.findByText('Resolution rate');
    expect(screen.queryByText(/historical figures/i)).not.toBeInTheDocument();
  });

  it('asks for the reports permission when the caller lacks it, and fetches nothing', () => {
    renderPerf(<AiPerformance agentActive canRead={false} />);
    expect(screen.getByText('No access to performance')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
