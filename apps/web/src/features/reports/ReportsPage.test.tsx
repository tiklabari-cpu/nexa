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

// ===========================================================================

interface DayRow {
  date: string;
  good: number;
  bad: number;
  responses: number;
  score: number | null;
}

const REVIEWS_BASE = {
  range: OVERVIEW.range,
  csat: { good: 0, bad: 0, responses: 0, score: null as number | null },
  previous_period: {
    range: OVERVIEW.previous_period.range,
    good: 0,
    bad: 0,
    responses: 0,
    score: null as number | null,
  },
  by_day: [] as DayRow[],
  ecommerce: {
    configured: false,
    tracked_sales: null as number | null,
    attributed_revenue_cents: null as number | null,
    currency: null as string | null,
  },
};

function mockReviews(overrides: Partial<typeof REVIEWS_BASE>): void {
  const payload = { ...REVIEWS_BASE, ...overrides };
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/reviews')) return Promise.resolve(payload);
    if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

async function openReviewsTab(): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name: 'Reviews' }));
  await screen.findByText('Satisfaction (CSAT)');
}

describe('ReportsPage — Reviews report (07.8)', () => {
  it('shows the CSAT donut split and the previous-period comparison', async () => {
    mockReviews({
      csat: { good: 67, bad: 33, responses: 100, score: 0.67 },
      previous_period: {
        range: OVERVIEW.previous_period.range,
        good: 57,
        bad: 43,
        responses: 100,
        score: 0.57,
      },
    });
    renderReports(<ReportsPage />);
    await openReviewsTab();

    // The donut centre carries the current CSAT; the note carries the baseline —
    // the PRD's "67% vs 57%" made visible on one card.
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('vs 57% previous period')).toBeInTheDocument();
    // The good/bad split the donut draws.
    expect(screen.getByText('Rated good')).toBeInTheDocument();
    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.getByText('33')).toBeInTheDocument();
  });

  it('reads an unrated window as unknown, not as 0%', async () => {
    mockReviews({});
    renderReports(<ReportsPage />);
    await openReviewsTab();

    // Nobody rated: an empty state, never a red 0% that reads as a catastrophe.
    expect(screen.getByText('No ratings yet')).toBeInTheDocument();
    expect(screen.getByText('No ratings in this window')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('renders a daily bar row for each rated day', async () => {
    mockReviews({
      by_day: [
        { date: '2026-07-20', good: 3, bad: 1, responses: 4, score: 0.75 },
        { date: '2026-07-21', good: 0, bad: 2, responses: 2, score: 0 },
      ],
    });
    renderReports(<ReportsPage />);
    await openReviewsTab();

    expect(screen.getByText('2026-07-20')).toBeInTheDocument();
    expect(screen.getByText('2026-07-21')).toBeInTheDocument();
    // A day that did get rated shows its real CSAT — including a true 0% when
    // every rating that day was bad. That 0% is data, not the unknown case.
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('shows the tracked-sales skeleton as not set up (FR-MOD-13.5, v2)', async () => {
    mockReviews({});
    renderReports(<ReportsPage />);
    await openReviewsTab();

    expect(screen.getByText('Sales tracking not set up')).toBeInTheDocument();
  });

  it('renders tracked sales once a source is configured', async () => {
    mockReviews({
      ecommerce: {
        configured: true,
        tracked_sales: 12,
        attributed_revenue_cents: 34_500,
        currency: 'USD',
      },
    });
    renderReports(<ReportsPage />);
    await openReviewsTab();

    expect(within(kpi('Tracked sales')).getByText('12')).toBeInTheDocument();
    expect(within(kpi('Attributed revenue')).getByText('$345.00')).toBeInTheDocument();
  });

  it('queries the reviews endpoint with the selected range', async () => {
    mockReviews({});
    renderReports(<ReportsPage />);
    await openReviewsTab();

    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/reviews\?from=.*&to=/));
  });
});

// ===========================================================================

interface HourRow {
  hour: number;
  chats: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
}

const BREAKDOWN_BASE = {
  range: OVERVIEW.range,
  by_day: [] as Array<{ date: string } & Omit<HourRow, 'hour'>>,
  by_agent: [] as Array<{ agent_id: string; name: string | null } & Omit<HourRow, 'hour'>>,
  by_hour: undefined as HourRow[] | undefined,
};

function mockBreakdown(overrides: Partial<typeof BREAKDOWN_BASE>): void {
  const payload = { ...BREAKDOWN_BASE, ...overrides };
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/breakdown')) return Promise.resolve(payload);
    if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

async function openBreakdownTab(): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name: 'Breakdown' }));
  await screen.findByRole('region', { name: 'By day' });
}

describe('ReportsPage — Breakdown report, By hour (07.5-g)', () => {
  it('renders a row for each of the 24 hours with 00:00 / 23:00 labels', async () => {
    const by_hour: HourRow[] = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      chats: hour + 1,
      closed: hour,
      manual: 0,
      assisted: 0,
      automated: hour,
    }));
    mockBreakdown({ by_hour });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byHour = screen.getByRole('region', { name: 'By hour' });
    expect(within(byHour).getByText('00:00')).toBeInTheDocument();
    expect(within(byHour).getByText('23:00')).toBeInTheDocument();
    expect(within(byHour).getAllByRole('row')).toHaveLength(25); // header + 24 hours
  });

  it('shows an empty state, not an empty table, when by_hour is missing', async () => {
    mockBreakdown({ by_hour: undefined });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byHour = screen.getByRole('region', { name: 'By hour' });
    expect(within(byHour).getByText('No hourly data yet')).toBeInTheDocument();
    expect(within(byHour).queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an empty state, not an empty table, when by_hour is an empty array', async () => {
    mockBreakdown({ by_hour: [] });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byHour = screen.getByRole('region', { name: 'By hour' });
    expect(within(byHour).getByText('No hourly data yet')).toBeInTheDocument();
    expect(within(byHour).queryByRole('table')).not.toBeInTheDocument();
  });
});
