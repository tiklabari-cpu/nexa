/**
 * The performance tab (FR-MOD-06.5): cards come from the reports the invoice
 * trusts, a rate on too few chats is flagged rather than shown bare, and when
 * the AI is off the figures are labelled as history.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AiQualityRates } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

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
  quality?: AiQualityRates;
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
        ...(over.quality ? { quality: over.quality } : {}),
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
  it('renders the four KPI cards from the reports (FR-MOD-06.5)', async () => {
    mockReports({
      resolutions: 40,
      resolution_rate: 0.8,
      transfers: 10,
      transfer_rate: 0.2,
      score: 0.9,
      responses: 60,
    });
    renderPerf(<AiPerformance agentActive canRead />);

    expect(await screen.findByText('Resolution rate')).toBeInTheDocument();
    expect(screen.getByText('AI chats')).toBeInTheDocument();
    expect(screen.getByText('CSAT')).toBeInTheDocument();
    expect(screen.getByText('Transferred')).toBeInTheDocument();
    // The resolution figure is the report's number, formatted.
    expect(screen.getByText('80%')).toBeInTheDocument();
    // "AI chats" is resolved + transferred (40 + 10), not the resolved count alone.
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('flags a rate that rests on too few chats (FR-MOD-06.5)', async () => {
    mockReports({ resolutions: 2, resolution_rate: 1, transfers: 1, transfer_rate: 0.333 });
    renderPerf(<AiPerformance agentActive canRead />);

    expect(await screen.findAllByText(/Based on few chats/)).not.toHaveLength(0);
  });

  it('labels the figures as historical when the AI is off (FR-MOD-06.5)', async () => {
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

  it('adds the quality rates beside the billed ones, cautioned over few conversations (FR-MOD-06.5)', async () => {
    const quality: AiQualityRates = {
      conversations: 10,
      low_sample: true,
      confirmed_resolution: 0.3,
      assumed_resolution: 0.3,
      unsettled: 0,
      false_resolution: 0.1429,
      containment: 0.7,
      handoff_rate: 0.3,
      handoff_quality: 0.5,
      reask_rate: 0.5,
      mandatory_handoff_compliance: 0.5,
      guardrail_violation: 0,
      guardrail_suspected: 0,
      bsat: null,
      csat_after_handoff: null,
      clarification_efficiency: null,
      repeat_unmeasured: 0,
    };
    mockReports({ resolutions: 40, resolution_rate: 0.8, transfers: 10, quality });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AiPerformance agentActive canRead />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const section = await screen.findByRole('region', { name: 'What was really solved' });
    const value = (label: string) =>
      within(section).getByText(label).nextElementSibling as HTMLElement;
    expect(value('Confirmed resolution')).toHaveTextContent('30%');
    expect(value('False resolution')).toHaveTextContent('14%');
    expect(value('Hand-over quality')).toHaveTextContent('50%');
    // Below its 100% target, and N = 10 is few: both read as a warning.
    expect(value('Mandatory hand-over compliance')).toHaveClass('text-warning');
    expect(within(section).getAllByText(/Based on few chats/)).toHaveLength(4);
    // The billed headline is untouched beside them (ADR-09a).
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('shows no quality cards for a report without the block', async () => {
    mockReports({ resolutions: 30, resolution_rate: 0.5 });
    renderPerf(<AiPerformance agentActive canRead />);
    await screen.findByText('Resolution rate');
    expect(screen.queryByRole('region', { name: 'What was really solved' })).toBeNull();
  });

  it('asks for the reports permission when the caller lacks it, and fetches nothing', () => {
    renderPerf(<AiPerformance agentActive canRead={false} />);
    expect(screen.getByText('No access to performance')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('AiPerformance localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the no-access state in Turkish when that is the active locale', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <AiPerformance agentActive canRead={false} />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByText('Performansa erişim yok')).toBeInTheDocument();
  });
});
