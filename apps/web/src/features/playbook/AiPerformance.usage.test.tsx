/**
 * The performance tab's token and cost card (tm 283.4 · AI-16): the same
 * numbers as Settings › AI usage, for the people allowed to read them.
 * An agent may read reports but `GET /ai/usage` is admin+, so for one the card
 * is absent and the endpoint is never asked; money appears only if priced.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { AiPerformance } = await import('./AiPerformance.js');

const METERS = [
  { meter: 'llm', used: 160_000, reserved: 0, cap: 200_000, percent: 80 },
  { meter: 'embedding', used: 5_000, reserved: 0, cap: 1_000_000, percent: 0.5 },
];

function serve(meters: Array<Record<string, unknown>>): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/reports/ai-agent') {
      return Promise.resolve({
        resolutions: 40,
        resolution_rate: 0.8,
        transfers: 10,
        transfer_rate: 0.2,
        skill_runs: 0,
        avg_automated_duration_seconds: null,
      });
    }
    if (path === '/reports/overview') {
      return Promise.resolve({ satisfaction: { score: 0.9, responses: 60 } });
    }
    if (path === '/ai/usage') return Promise.resolve({ meters });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderPerf(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AiPerformance agentActive canRead />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
});

describe('AiPerformance usage card (AI-16)', () => {
  it('shows today’s tokens against the allowance and links to the usage screen', async () => {
    serve(METERS);
    renderPerf();

    expect(await screen.findByText('AI tokens today')).toBeInTheDocument();
    expect(screen.getByText('160,000')).toBeInTheDocument();
    expect(screen.getByText('80% of the daily allowance')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See AI usage' })).toHaveAttribute(
      'href',
      '/app/settings/ai-usage',
    );
  });

  it('shows no money card when nothing was priced', async () => {
    serve(METERS);
    renderPerf();

    await screen.findByText('AI tokens today');
    expect(screen.queryByText('Estimated cost today')).not.toBeInTheDocument();
  });

  it('labels the cost as an estimate when the server priced the meters', async () => {
    serve([
      { ...METERS[0], cost_usd: 0.4 },
      { ...METERS[1], cost_usd: 0.0001 },
    ]);
    renderPerf();

    expect(await screen.findByText('Estimated cost today')).toBeInTheDocument();
    expect(screen.getByText('$0.4001')).toBeInTheDocument();
    expect(screen.getByText(/An estimate — it will not match an invoice/)).toBeInTheDocument();
  });

  it('never asks for the usage when the caller is an agent', async () => {
    currentRole = 'agent';
    serve(METERS);
    renderPerf();

    await screen.findByText('Resolution rate');
    expect(api.get).not.toHaveBeenCalledWith('/ai/usage');
    expect(screen.queryByText('AI tokens today')).not.toBeInTheDocument();
  });
});
