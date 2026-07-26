/**
 * The AI Agent report (FR-MOD-07.4).
 *
 * The report's headline — AI resolutions — is ADR-09's figure, the same number
 * the invoice bills. The backend guarantees the equality (one shared query, seen
 * in the reports-billing integration test); this test guards the surface a
 * customer actually reads: the AI Agent tab must show that resolution count, its
 * deflection metrics (transfers, transfer rate, skills), and say plainly that
 * the number is the one on the bill — so nobody reads the report and the invoice
 * as two different things.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ReportsPage } = await import('./ReportsPage.js');

interface AiAgent {
  resolutions?: number;
  resolution_rate?: number | null;
  transfers?: number;
  transfer_rate?: number | null;
  skill_runs?: number;
  avg_automated_duration_seconds?: number | null;
}

/**
 * A complete Overview payload so the default tab renders past its loading state
 * before we switch away; the figures under test all live on `/reports/ai-agent`.
 */
const OVERVIEW = {
  range: { from: '2026-06-26T00:00:00.000Z', to: '2026-07-26T00:00:00.000Z' },
  previous_period: {
    range: { from: '2026-05-27T00:00:00.000Z', to: '2026-06-25T23:59:59.999Z' },
    chats: 0,
    tickets: 0,
    total_cases: 0,
    closed: 0,
    manual: 0,
    assisted: 0,
    automated: 0,
    avg_first_response_seconds: null,
    avg_duration_seconds: null,
    satisfaction_score: null,
  },
  totals: {
    chats: 0,
    tickets: 0,
    total_cases: 0,
    closed: 0,
    manual: 0,
    assisted: 0,
    automated: 0,
    manual_rate: null,
    assisted_rate: null,
    automated_rate: null,
    queued_now: 0,
  },
  chats: { automated_per_hour: 0, automated_avg_duration_seconds: null, total_duration_seconds: 0 },
  response_times: { avg_first_response_seconds: null, avg_duration_seconds: null },
  satisfaction: { good: 0, bad: 0, score: null, responses: 0 },
  by_agent: [],
  top_tags: [],
};

function mockReports(aiAgent: AiAgent): void {
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/ai-agent')) {
      return Promise.resolve({
        range: OVERVIEW.range,
        resolutions: aiAgent.resolutions ?? 0,
        resolution_rate: aiAgent.resolution_rate ?? null,
        transfers: aiAgent.transfers ?? 0,
        transfer_rate: aiAgent.transfer_rate ?? null,
        skill_runs: aiAgent.skill_runs ?? 0,
        avg_automated_duration_seconds: aiAgent.avg_automated_duration_seconds ?? null,
      });
    }
    if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderReports(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** The card enclosing a KPI, found by its label; scopes value/hint assertions. */
function kpi(label: string): HTMLElement {
  const labelEl = screen.getByText(label);
  const card = labelEl.parentElement;
  if (!card) throw new Error(`KPI "${label}" has no enclosing card`);
  return card;
}

async function openAiAgentTab(): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name: 'AI Agent' }));
  await screen.findByText('AI resolutions');
}

beforeEach(() => {
  api.get.mockReset();
});

describe('ReportsPage — AI Agent report (07.4)', () => {
  it('shows the AI resolution count and its deflection metrics', async () => {
    mockReports({
      resolutions: 128,
      resolution_rate: 0.8,
      transfers: 30,
      transfer_rate: 0.2,
      skill_runs: 12,
      avg_automated_duration_seconds: 134,
    });
    renderReports(<ReportsPage />);
    await openAiAgentTab();

    // Resolution: the ADR-09 headline plus its rate and average duration.
    expect(within(kpi('AI resolutions')).getByText('128')).toBeInTheDocument();
    expect(within(kpi('Resolution rate')).getByText('80%')).toBeInTheDocument();
    expect(within(kpi('Automated chat duration')).getByText('2m 14s')).toBeInTheDocument();

    // Deflection: hand-offs, the derived transfer rate and skills run.
    expect(within(kpi('Transfers to a human')).getByText('30')).toBeInTheDocument();
    expect(within(kpi('Transfer rate')).getByText('20%')).toBeInTheDocument();
    expect(within(kpi('Skills run')).getByText('12')).toBeInTheDocument();
  });

  it('states that the resolution figure is the one the invoice bills (ADR-09)', async () => {
    mockReports({ resolutions: 128, resolution_rate: 0.8 });
    renderReports(<ReportsPage />);
    await openAiAgentTab();

    // The KK made visible: the report ties its number to the billing counter, so
    // a reader never treats the report and the invoice as two separate figures.
    expect(screen.getByText(/the same figure the invoice bills/i)).toBeInTheDocument();
  });

  it('queries the shared ADR-09 endpoint with the selected range', async () => {
    mockReports({ resolutions: 1 });
    renderReports(<ReportsPage />);
    await openAiAgentTab();

    // The same `/reports/ai-agent` query the AI Performance screen (06.5-a) reads,
    // scoped to the header's range control.
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/ai-agent\?from=.*&to=/));
  });

  it('reads an empty window as unknown, not as 0%', async () => {
    mockReports({ resolutions: 0, resolution_rate: null, transfers: 0, transfer_rate: null });
    renderReports(<ReportsPage />);
    await openAiAgentTab();

    // A rate is null (not 0%) when nothing closed / nothing was finished: 0%
    // would read as a failure rather than as an absence of data.
    expect(within(kpi('Resolution rate')).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Nothing closed in this window')).toBeInTheDocument();
    expect(within(kpi('Transfer rate')).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('The AI finished nothing in this window')).toBeInTheDocument();
  });
});
