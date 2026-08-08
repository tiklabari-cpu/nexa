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
  localStorage.clear();
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

interface TeamRow {
  team_id: number | null;
  name: string | null;
  chats: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
}

interface ChannelRow {
  channel: string;
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
  by_team: undefined as TeamRow[] | undefined,
  overlapping: undefined as boolean | undefined,
  by_channel: undefined as ChannelRow[] | undefined,
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

describe('ReportsPage — Breakdown report, By team / By channel (07.5-h)', () => {
  const TEAM_ROW: TeamRow = {
    team_id: 1,
    name: 'Sales',
    chats: 5,
    closed: 4,
    manual: 2,
    assisted: 1,
    automated: 1,
  };
  const UNASSIGNED_ROW: TeamRow = {
    team_id: null,
    name: null,
    chats: 2,
    closed: 1,
    manual: 1,
    assisted: 0,
    automated: 0,
  };
  const CHANNEL_ROW: ChannelRow = {
    channel: 'website',
    chats: 7,
    closed: 6,
    manual: 3,
    assisted: 2,
    automated: 1,
  };

  it('renders team names and an Unassigned row for chats visible to no team', async () => {
    mockBreakdown({ by_team: [TEAM_ROW, UNASSIGNED_ROW] });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byTeam = screen.getByRole('region', { name: 'By team' });
    expect(within(byTeam).getByText('Sales')).toBeInTheDocument();
    expect(within(byTeam).getByText('Unassigned')).toBeInTheDocument();
  });

  it('shows the overlap footnote when overlapping is true, hides it when false', async () => {
    mockBreakdown({ by_team: [TEAM_ROW], overlapping: true });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byTeam = screen.getByRole('region', { name: 'By team' });
    expect(within(byTeam).getByText(/counted in every one of them/i)).toBeInTheDocument();
  });

  it('hides the overlap footnote when overlapping is false', async () => {
    mockBreakdown({ by_team: [TEAM_ROW], overlapping: false });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byTeam = screen.getByRole('region', { name: 'By team' });
    expect(within(byTeam).queryByText(/counted in every one of them/i)).not.toBeInTheDocument();
  });

  it('shows an empty state, not an empty table, when by_team is missing or empty', async () => {
    mockBreakdown({ by_team: undefined });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byTeam = screen.getByRole('region', { name: 'By team' });
    expect(within(byTeam).getByText('No team data yet')).toBeInTheDocument();
    expect(within(byTeam).queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders channel rows including the website fallback', async () => {
    mockBreakdown({ by_channel: [CHANNEL_ROW, { ...CHANNEL_ROW, channel: 'messenger' }] });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byChannel = screen.getByRole('region', { name: 'By channel' });
    expect(within(byChannel).getByText('website')).toBeInTheDocument();
    expect(within(byChannel).getByText('messenger')).toBeInTheDocument();
  });

  it('shows an empty state, not an empty table, when by_channel is missing or empty', async () => {
    mockBreakdown({ by_channel: [] });
    renderReports(<ReportsPage />);
    await openBreakdownTab();

    const byChannel = screen.getByRole('region', { name: 'By channel' });
    expect(within(byChannel).getByText('No channel data yet')).toBeInTheDocument();
    expect(within(byChannel).queryByRole('table')).not.toBeInTheDocument();
  });
});

// ===========================================================================

interface StaffingCellFixture {
  day_of_week: number;
  hour: number;
  observed_chats: number;
  required_agents: number | null;
  scheduled_agents: number | null;
  rostered_agents: number | null;
  gap: number | null;
  low_confidence: boolean;
}

function emptyStaffingCell(day_of_week: number, hour: number): StaffingCellFixture {
  return {
    day_of_week,
    hour,
    observed_chats: 0,
    required_agents: null,
    scheduled_agents: null,
    rostered_agents: null,
    gap: null,
    low_confidence: true,
  };
}

/** A dense 168-cell grid (matching the API's guarantee), with per-cell overrides keyed `"day-hour"`. */
function fullStaffingGrid(
  overrides: Record<string, Partial<StaffingCellFixture>> = {},
): StaffingCellFixture[] {
  const cells: StaffingCellFixture[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const base = emptyStaffingCell(day, hour);
      const override = overrides[`${day}-${hour}`];
      cells.push(override ? { ...base, ...override } : base);
    }
  }
  return cells;
}

function knownStaffingCell(day_of_week: number, hour: number): StaffingCellFixture {
  return {
    day_of_week,
    hour,
    observed_chats: 25,
    required_agents: 1,
    scheduled_agents: 3,
    rostered_agents: 1,
    gap: -2,
    low_confidence: false,
  };
}

/**
 * Same shape as `fullStaffingGrid`, but every default cell carries real
 * (non-null, non-highlighted) data — so a single overridden "unknown" cell has
 * a title distinct from the other 167, and `getByTitle` can find it uniquely.
 */
function fullKnownStaffingGrid(
  overrides: Record<string, Partial<StaffingCellFixture>> = {},
): StaffingCellFixture[] {
  const cells: StaffingCellFixture[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const base = knownStaffingCell(day, hour);
      const override = overrides[`${day}-${hour}`];
      cells.push(override ? { ...base, ...override } : base);
    }
  }
  return cells;
}

const STAFFING_BASE = {
  range: OVERVIEW.range,
  inputs: {
    concurrent_chats_limit: 4,
    average_chat_minutes: 6,
    minimum_sample_chats: 20,
    agents: 5,
  },
  coverage_known: true,
  roster_known: true,
  low_confidence: false,
  cells: fullStaffingGrid(),
};

function mockStaffing(overrides: Partial<typeof STAFFING_BASE>): void {
  const payload = { ...STAFFING_BASE, ...overrides };
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/staffing-forecast')) return Promise.resolve(payload);
    if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

async function openStaffingTab(): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name: 'Staffing' }));
  await screen.findByRole('region', { name: 'Staffing' });
}

describe('ReportsPage — Staffing report (WORKSCHED-i)', () => {
  it('renders the full 7 x 24 day-by-hour grid', async () => {
    mockStaffing({ cells: fullKnownStaffingGrid() });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    const grid = within(screen.getByRole('region', { name: 'Staffing' }));
    expect(grid.getAllByRole('row')).toHaveLength(8); // header + 7 days
    expect(grid.getAllByRole('columnheader')).toHaveLength(25); // "Day" label + 24 hours
  });

  it('highlights a cell with a positive gap (understaffed)', async () => {
    mockStaffing({
      cells: fullStaffingGrid({
        '2-14': {
          observed_chats: 40,
          required_agents: 3,
          scheduled_agents: 2,
          rostered_agents: 2,
          gap: 1,
          low_confidence: false,
        },
      }),
    });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    const cell = screen.getByTitle('Required 3 · Scheduled 2 · Gap +1');
    expect(cell).toHaveTextContent('+1');
    expect(cell).toHaveClass('bg-warning/10');
  });

  it('does not highlight a cell with a non-positive gap', async () => {
    mockStaffing({
      cells: fullStaffingGrid({
        '2-14': {
          observed_chats: 10,
          required_agents: 2,
          scheduled_agents: 3,
          rostered_agents: 2,
          gap: -1,
          low_confidence: false,
        },
      }),
    });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    const cell = screen.getByTitle('Required 2 · Scheduled 3 · Gap -1');
    expect(cell).toHaveTextContent('-1');
    expect(cell).not.toHaveClass('bg-warning/10');
  });

  it('shows "—" for a low-confidence / unknown cell, never a fabricated 0', async () => {
    // Every other cell carries real, known data (see `fullKnownStaffingGrid`),
    // so only the overridden cell is unknown — isolating the assertion below.
    mockStaffing({
      cells: fullKnownStaffingGrid({
        '2-14': {
          observed_chats: 3,
          required_agents: null,
          scheduled_agents: 1,
          rostered_agents: null,
          gap: null,
          low_confidence: true,
        },
      }),
    });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    // The KK's "0 is never written" made concrete: a cell with too little
    // history renders the unknown marker, not a fabricated 0.
    const cell = screen.getByTitle('Not enough data');
    expect(cell).toHaveTextContent('—');
    expect(cell).not.toHaveTextContent('0');
  });

  it('shows a meaningful empty state, not an empty grid, when nothing happened in the window', async () => {
    mockStaffing({ cells: fullStaffingGrid() });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    expect(screen.getByText('No staffing data in this window')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error state when the report fails to load', async () => {
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/reports/staffing-forecast')) return Promise.reject(new Error('boom'));
      if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderReports(<ReportsPage />);
    await userEvent.click(screen.getByRole('tab', { name: 'Staffing' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the staffing forecast/);
  });

  it('notes when presence data is unknown for the whole window', async () => {
    mockStaffing({
      coverage_known: false,
      cells: fullStaffingGrid({
        '2-14': {
          observed_chats: 40,
          required_agents: 3,
          scheduled_agents: null,
          rostered_agents: null,
          gap: null,
          low_confidence: false,
        },
      }),
    });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    expect(screen.getByText(/No presence data in this window/)).toBeInTheDocument();
  });

  it('notes when no agent has a saved work schedule', async () => {
    // The pair of the notice above, and the reason it is tested from this side:
    // `staffing.spec.ts` proves the end-to-end chain by asserting this notice is
    // *gone* once a week has been saved through the browser (WORKSCHED-j). An
    // absence assertion is only worth anything if the presence it denies is
    // itself proven — otherwise a renamed string would make the e2e proof pass
    // by rendering nothing at all.
    // Both notices live inside the grid branch, so the window needs volume —
    // an all-zero grid falls to the empty state and renders neither.
    mockStaffing({ roster_known: false, cells: fullKnownStaffingGrid() });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    expect(screen.getByText(/No agent has a saved work schedule yet/)).toBeInTheDocument();
  });

  it('keeps both unknown-input notices off a window that knows its roster and presence', async () => {
    mockStaffing({ coverage_known: true, roster_known: true, cells: fullKnownStaffingGrid() });
    renderReports(<ReportsPage />);
    await openStaffingTab();

    expect(screen.queryByText(/No agent has a saved work schedule yet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No presence data in this window/)).not.toBeInTheDocument();
  });

  it('queries the staffing-forecast endpoint with the selected range', async () => {
    mockStaffing({});
    renderReports(<ReportsPage />);
    await openStaffingTab();

    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/reports\/staffing-forecast\?from=.*&to=/),
    );
  });

  it('follows the shared role=tab/tabpanel + aria-controls pattern', async () => {
    mockStaffing({});
    renderReports(<ReportsPage />);
    const tab = screen.getByRole('tab', { name: 'Staffing' });
    await userEvent.click(tab);
    await screen.findByRole('region', { name: 'Staffing' });

    expect(tab).toHaveAttribute('aria-selected', 'true');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(tab).toHaveAttribute('aria-controls', panel.id);
  });
});

// ===========================================================================

interface TopicRow {
  id: string;
  label: string;
  keywords: string[];
  volume: number;
  share: number | null;
  previous_volume: number;
  trend: number | null;
}

const TOPICS_BASE = {
  range: OVERVIEW.range,
  previous_period: { range: OVERVIEW.previous_period.range },
  min_conversations: 20,
  analyzed: 0,
  sufficient_data: false,
  topics: [] as TopicRow[],
};

function mockTopics(overrides: Partial<typeof TOPICS_BASE>): void {
  const payload = { ...TOPICS_BASE, ...overrides };
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/topics')) return Promise.resolve(payload);
    if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

async function openTopicsTab(): Promise<void> {
  await userEvent.click(screen.getByRole('tab', { name: 'Chat topics' }));
  await screen.findByRole('region', { name: 'Chat topics' });
}

describe('ReportsPage — Chat topics report (07.6)', () => {
  it('renders topic rows with their volume, share and trend', async () => {
    mockTopics({
      sufficient_data: true,
      analyzed: 40,
      topics: [
        {
          id: 't1',
          label: 'Shipping',
          keywords: ['shipping'],
          volume: 12,
          share: 0.3,
          previous_volume: 8,
          trend: 0.5,
        },
        {
          id: 't2',
          label: 'Refunds',
          keywords: ['refund'],
          volume: 6,
          share: 0.15,
          previous_volume: 0,
          trend: null,
        },
      ],
    });
    renderReports(<ReportsPage />);
    await openTopicsTab();

    expect(screen.getByText('Shipping')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
    // Volume/trend (hacim/trend): an arrow plus the magnitude, not a bare percentage.
    expect(screen.getByText(/↑ 50%/)).toBeInTheDocument();

    expect(screen.getByText('Refunds')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
  });

  it('shows a meaningful empty state, not a table, when there is not enough data', async () => {
    mockTopics({ sufficient_data: false, min_conversations: 20, analyzed: 4, topics: [] });
    renderReports(<ReportsPage />);
    await openTopicsTab();

    // "Yeterli veri yoksa empty": an honest state naming the floor, not a blank table.
    expect(screen.getByText('Not enough conversations yet')).toBeInTheDocument();
    expect(screen.getByText(/needs at least 20 conversations/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders a topic missing from the previous window as "—", not 0%', async () => {
    mockTopics({
      sufficient_data: true,
      analyzed: 10,
      topics: [
        {
          id: 't1',
          label: 'New topic',
          keywords: [],
          volume: 4,
          share: 0.4,
          previous_volume: 0,
          trend: null,
        },
      ],
    });
    renderReports(<ReportsPage />);
    await openTopicsTab();

    const row = screen.getByText('New topic').closest('tr');
    expect(row).not.toBeNull();
    const cells = within(row as HTMLElement).getAllByRole('cell');
    // Last column is Trend: "—" for a topic absent from the previous window, not a
    // fabricated 0%. (Share, the column before it, is a real 40% and stays intact.)
    expect(cells[cells.length - 1]).toHaveTextContent('—');
  });

  it('queries the topics endpoint with the selected range', async () => {
    mockTopics({
      sufficient_data: true,
      analyzed: 1,
      topics: [
        { id: 't1', label: 'X', keywords: [], volume: 1, share: 1, previous_volume: 1, trend: 0 },
      ],
    });
    renderReports(<ReportsPage />);
    await openTopicsTab();

    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/topics\?from=.*&to=/));
  });
});

// ===========================================================================

describe('ReportsPage — Overview "Chat topics" promo banner (07.6-f)', () => {
  it('shows the banner on Overview, and "See chat topics" opens the Chat topics tab', async () => {
    mockReports({ resolutions: 0 });
    renderReports(<ReportsPage />);

    expect(screen.getByText('Top chat topics in one place')).toBeInTheDocument();

    // CTA opens the tab in place — same page, no new route.
    await userEvent.click(screen.getByRole('button', { name: 'See chat topics' }));
    expect(screen.getByRole('tab', { name: 'Chat topics' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('renders only on Overview, not on the Chat topics tab', async () => {
    mockTopics({ sufficient_data: false, analyzed: 0, topics: [] });
    renderReports(<ReportsPage />);
    expect(screen.getByText('Top chat topics in one place')).toBeInTheDocument();

    await openTopicsTab();
    expect(screen.queryByText('Top chat topics in one place')).not.toBeInTheDocument();
  });

  it('renders only on Overview, not on other report tabs', async () => {
    mockReports({ resolutions: 0 });
    renderReports(<ReportsPage />);

    await openAiAgentTab();
    expect(screen.queryByText('Top chat topics in one place')).not.toBeInTheDocument();
  });

  it('"Remind me later" dismisses the banner and it does not return after a remount', async () => {
    mockReports({ resolutions: 0 });
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ReportsPage />
      </QueryClientProvider>,
    );

    // "Remind me later" is Banner's persistent dismiss (id + dismissLabel), not a
    // second control — same mechanism as the 07.6 reference pattern (tm 62).
    await userEvent.click(screen.getByRole('button', { name: 'Remind me later' }));
    expect(screen.queryByText('Top chat topics in one place')).not.toBeInTheDocument();

    // A fresh mount — as a reload would be — stays dismissed.
    view.unmount();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ReportsPage />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Top chat topics in one place')).not.toBeInTheDocument();
  });

  it('dismisses even when localStorage is unavailable, without throwing', async () => {
    mockReports({ resolutions: 0 });
    renderReports(<ReportsPage />);

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Remind me later' }));
    expect(screen.queryByText('Top chat topics in one place')).not.toBeInTheDocument();

    setItem.mockRestore();
  });
});

// ===========================================================================

interface CasesDayRow {
  date: string;
  open: number;
  closed: number;
  total: number;
}

const CASES_BASE = {
  range: OVERVIEW.range,
  previous_period: { open: 0, closed: 0, total: 0 },
  by_day: [] as CasesDayRow[],
  by_status: [] as Array<{ status: string; count: number }>,
  by_priority: [] as Array<{ priority: number; count: number }>,
};

const LEADS_BASE = {
  range: OVERVIEW.range,
  previous_period: { leads: 0 },
  by_day: [] as Array<{ date: string; count: number }>,
  totals: { leads: 0 },
};

/**
 * Mocks `/reports/groups` alongside the Cases and Leads reports. `groups`
 * defaults to granting both — the "not granted" behaviour (07.7-i's "İzin
 * bazlı görünürlük" KK) gets its own call with `groups: []`.
 */
function mockGroupsCasesLeads({
  groups = [
    { id: 'cases', label: 'Cases' },
    { id: 'leads', label: 'Leads' },
  ],
  cases = {},
  leads = {},
}: {
  groups?: Array<{ id: string; label: string }>;
  cases?: Partial<typeof CASES_BASE>;
  leads?: Partial<typeof LEADS_BASE>;
} = {}): void {
  const casesPayload = { ...CASES_BASE, ...cases };
  const leadsPayload = { ...LEADS_BASE, ...leads };
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/groups')) return Promise.resolve({ groups });
    if (path.startsWith('/reports/cases')) return Promise.resolve(casesPayload);
    if (path.startsWith('/reports/leads')) return Promise.resolve(leadsPayload);
    if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

async function openCasesTab(): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: 'Cases' }));
  await screen.findByRole('region', { name: 'By status' });
}

async function openLeadsTab(): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: 'Leads' }));
  await screen.findByRole('region', { name: 'Volume' });
}

/**
 * A Cases/Leads Volume KPI card, scoped to the Volume region. Unlike `kpi()`,
 * this cannot use an unscoped `screen.getByText` — "Open"/"Closed"/"Total" and
 * "New leads" also head the by-day table rendered lower on the same tab, so an
 * unscoped lookup would match twice.
 */
function volumeKpi(label: string): HTMLElement {
  const volume = screen.getByRole('region', { name: 'Volume' });
  const labelEl = within(volume).getByText(label);
  const card = labelEl.parentElement;
  if (!card) throw new Error(`KPI "${label}" has no enclosing card`);
  return card;
}

describe('ReportsPage — Cases + Leads tabs, permission-gated visibility (07.7-i)', () => {
  it('renders the Leads and Cases tabs when /reports/groups grants them, and queries the right endpoint', async () => {
    mockGroupsCasesLeads();
    renderReports(<ReportsPage />);

    await openCasesTab();
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/cases\?from=.*&to=/));

    await openLeadsTab();
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/leads\?from=.*&to=/));
  });

  it('hides the Leads and Cases tabs when /reports/groups does not grant them (İzin bazlı görünürlük)', async () => {
    mockGroupsCasesLeads({ groups: [] });
    renderReports(<ReportsPage />);

    // Overview is ungated and renders once its own fetch resolves — proof a
    // render past the groups response has already happened.
    await screen.findByText('Conversations', { exact: true });

    expect(screen.queryByRole('tab', { name: 'Cases' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Leads' })).not.toBeInTheDocument();
  });

  it('hides only the ungranted one when /reports/groups grants Cases but not Leads', async () => {
    mockGroupsCasesLeads({ groups: [{ id: 'cases', label: 'Cases' }] });
    renderReports(<ReportsPage />);

    await screen.findByRole('tab', { name: 'Cases' });
    expect(screen.queryByRole('tab', { name: 'Leads' })).not.toBeInTheDocument();
  });

  it('shows the Cases KPI cards with a vs-previous delta (benchmark comparison)', async () => {
    mockGroupsCasesLeads({
      cases: {
        by_day: [{ date: '2026-07-20', open: 3, closed: 4, total: 7 }],
        previous_period: { open: 1, closed: 2, total: 3 },
      },
    });
    renderReports(<ReportsPage />);
    await openCasesTab();

    // Totals derive from `by_day` (open=3, closed=4, total=7), and each carries
    // its delta against `previous_period` — the same `previous_period` field the
    // Overview/Reviews cards key their badges off.
    expect(within(volumeKpi('Open')).getByText('3')).toBeInTheDocument();
    expect(within(volumeKpi('Open')).getByText(/↑ 2 vs previous/)).toBeInTheDocument();
    expect(within(volumeKpi('Closed')).getByText('4')).toBeInTheDocument();
    expect(within(volumeKpi('Closed')).getByText(/↑ 2 vs previous/)).toBeInTheDocument();
    expect(within(volumeKpi('Total')).getByText('7')).toBeInTheDocument();
    expect(within(volumeKpi('Total')).getByText(/↑ 4 vs previous/)).toBeInTheDocument();
  });

  it('renders the Cases by-day, by-status and by-priority tables', async () => {
    mockGroupsCasesLeads({
      cases: {
        by_day: [{ date: '2026-07-20', open: 1, closed: 2, total: 3 }],
        by_status: [{ status: 'open', count: 5 }, { status: 'closed', count: 9 }],
        by_priority: [{ priority: 10, count: 2 }, { priority: -5, count: 1 }],
      },
    });
    renderReports(<ReportsPage />);
    await openCasesTab();

    expect(screen.getByText('2026-07-20')).toBeInTheDocument();
    const byStatus = screen.getByRole('region', { name: 'By status' });
    expect(within(byStatus).getByText('open')).toBeInTheDocument();
    expect(within(byStatus).getByText('9')).toBeInTheDocument();
    const byPriority = screen.getByRole('region', { name: 'By priority' });
    expect(within(byPriority).getByText('10')).toBeInTheDocument();
    expect(within(byPriority).getByText('-5')).toBeInTheDocument();
  });

  it('shows a meaningful empty state per section, not an empty table, when Cases has no data', async () => {
    mockGroupsCasesLeads();
    renderReports(<ReportsPage />);
    await openCasesTab();

    expect(screen.getByText('No cases in this window')).toBeInTheDocument();
    expect(screen.getByText('No status data yet')).toBeInTheDocument();
    expect(screen.getByText('No priority data yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the Leads KPI with a vs-previous delta and a daily table', async () => {
    mockGroupsCasesLeads({
      leads: {
        totals: { leads: 12 },
        previous_period: { leads: 7 },
        by_day: [{ date: '2026-07-20', count: 12 }],
      },
    });
    renderReports(<ReportsPage />);
    await openLeadsTab();

    expect(within(volumeKpi('New leads')).getByText('12')).toBeInTheDocument();
    expect(within(volumeKpi('New leads')).getByText(/↑ 5 vs previous/)).toBeInTheDocument();
    expect(screen.getByText('2026-07-20')).toBeInTheDocument();
  });

  it('shows a meaningful empty state, not an empty table, when Leads has no data', async () => {
    mockGroupsCasesLeads();
    renderReports(<ReportsPage />);
    await openLeadsTab();

    expect(screen.getByText('No new leads in this window')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error state when the Cases report fails to load, without crashing', async () => {
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/reports/groups')) {
        return Promise.resolve({ groups: [{ id: 'cases', label: 'Cases' }] });
      }
      if (path.startsWith('/reports/cases')) return Promise.reject(new Error('boom'));
      if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderReports(<ReportsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Cases' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the Cases report/);
  });
});

interface AgentPerformanceRowFixture {
  agent_id: string;
  name: string | null;
  chats: number;
  closed: number;
  manual: number;
  assisted: number;
  automated: number;
  avg_first_response_seconds: number | null;
  avg_duration_seconds: number | null;
  csat: { good: number; bad: number; responses: number; score: number | null };
  transfers: number;
}

const SALES_BASE = {
  range: OVERVIEW.range,
  configured: false,
  tracked_sales: null as number | null,
  attributed_revenue_cents: null as number | null,
  currency: null as string | null,
  conversions: null as number | null,
};

const TEAM_PERFORMANCE_BASE = {
  range: OVERVIEW.range,
  agents: [] as AgentPerformanceRowFixture[],
};

/**
 * Mocks `/reports/groups` alongside the Sales and Team performance reports.
 * `groups` defaults to granting both — mirrors `mockGroupsCasesLeads` (07.7-i).
 */
function mockGroupsSalesTeam({
  groups = [
    { id: 'sales', label: 'Sales' },
    { id: 'team-performance', label: 'Team performance' },
  ],
  sales = {},
  teamPerformance = {},
}: {
  groups?: Array<{ id: string; label: string }>;
  sales?: Partial<typeof SALES_BASE>;
  teamPerformance?: Partial<typeof TEAM_PERFORMANCE_BASE>;
} = {}): void {
  const salesPayload = { ...SALES_BASE, ...sales };
  const teamPayload = { ...TEAM_PERFORMANCE_BASE, ...teamPerformance };
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/groups')) return Promise.resolve({ groups });
    if (path.startsWith('/reports/sales')) return Promise.resolve(salesPayload);
    if (path.startsWith('/reports/team-performance')) return Promise.resolve(teamPayload);
    if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

async function openSalesTab(): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: 'Sales' }));
  await screen.findByRole('region', { name: 'Sales' });
}

async function openTeamPerformanceTab(): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name: 'Team performance' }));
  await screen.findByRole('region', { name: 'Team performance' });
}

describe('ReportsPage — Sales + Team performance tabs, permission-gated visibility (07.7-j)', () => {
  it('renders the Sales and Team performance tabs when /reports/groups grants them, and queries the right endpoint', async () => {
    mockGroupsSalesTeam();
    renderReports(<ReportsPage />);

    await openSalesTab();
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/reports\/sales\?from=.*&to=/));

    await openTeamPerformanceTab();
    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/reports\/team-performance\?from=.*&to=/),
    );
  });

  it('hides the Sales and Team performance tabs when /reports/groups does not grant them (İzin bazlı görünürlük)', async () => {
    mockGroupsSalesTeam({ groups: [] });
    renderReports(<ReportsPage />);

    // Overview is ungated and renders once its own fetch resolves — proof a
    // render past the groups response has already happened.
    await screen.findByText('Conversations', { exact: true });

    expect(screen.queryByRole('tab', { name: 'Sales' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Team performance' })).not.toBeInTheDocument();
  });

  it('hides only the ungranted one when /reports/groups grants Sales but not Team performance', async () => {
    mockGroupsSalesTeam({ groups: [{ id: 'sales', label: 'Sales' }] });
    renderReports(<ReportsPage />);

    await screen.findByRole('tab', { name: 'Sales' });
    expect(screen.queryByRole('tab', { name: 'Team performance' })).not.toBeInTheDocument();
  });

  it('shows a meaningful empty state pointing at 13.5, never a fabricated zero, when Sales is not configured', async () => {
    mockGroupsSalesTeam();
    renderReports(<ReportsPage />);
    await openSalesTab();

    expect(screen.getByText('Sales tracking not set up')).toBeInTheDocument();
    expect(screen.getByText(/FR-MOD-13.5/)).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the Sales KPIs once a source is configured', async () => {
    mockGroupsSalesTeam({
      sales: {
        configured: true,
        tracked_sales: 42,
        attributed_revenue_cents: 12_345,
        currency: 'USD',
        conversions: 9,
      },
    });
    renderReports(<ReportsPage />);
    await openSalesTab();

    expect(within(kpi('Tracked sales')).getByText('42')).toBeInTheDocument();
    expect(within(kpi('Attributed revenue')).getByText('$123.45')).toBeInTheDocument();
    expect(within(kpi('Conversions')).getByText('9')).toBeInTheDocument();
  });

  it('renders the Team performance agent table with chats/closed/automated/assisted/manual/avg first response/CSAT', async () => {
    mockGroupsSalesTeam({
      teamPerformance: {
        agents: [
          {
            agent_id: 'agent-1',
            name: 'Ada Lovelace',
            chats: 10,
            closed: 8,
            manual: 1,
            assisted: 2,
            automated: 5,
            avg_first_response_seconds: 125,
            avg_duration_seconds: 400,
            csat: { good: 4, bad: 1, responses: 5, score: 0.8 },
            transfers: 1,
          },
        ],
      },
    });
    renderReports(<ReportsPage />);
    await openTeamPerformanceTab();

    const table = screen.getByRole('table');
    const row = within(table).getByText('Ada Lovelace').closest('tr');
    if (!row) throw new Error('agent row not found');
    expect(within(row).getByText('10')).toBeInTheDocument();
    expect(within(row).getByText('8')).toBeInTheDocument();
    expect(within(row).getByText('5')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getByText('2m 5s')).toBeInTheDocument();
    expect(within(row).getByText('80%')).toBeInTheDocument();
  });

  it("shows '—', not '0%', for an agent nobody rated in the window (CSAT null)", async () => {
    mockGroupsSalesTeam({
      teamPerformance: {
        agents: [
          {
            agent_id: 'agent-2',
            name: 'Grace Hopper',
            chats: 4,
            closed: 4,
            manual: 4,
            assisted: 0,
            automated: 0,
            avg_first_response_seconds: null,
            avg_duration_seconds: null,
            csat: { good: 0, bad: 0, responses: 0, score: null },
            transfers: 0,
          },
        ],
      },
    });
    renderReports(<ReportsPage />);
    await openTeamPerformanceTab();

    const row = screen.getByText('Grace Hopper').closest('tr');
    if (!row) throw new Error('agent row not found');
    // CSAT and avg first response both render as em dash — neither a fabricated
    // 0%/0s for "nobody rated" / "nothing closed with a first response".
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(within(row).queryByText('0%')).not.toBeInTheDocument();
  });

  it('shows a meaningful empty state, not an empty table, when no agent has activity', async () => {
    mockGroupsSalesTeam();
    renderReports(<ReportsPage />);
    await openTeamPerformanceTab();

    expect(screen.getByText('No agent activity in this window')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error state when the Sales report fails to load, without crashing', async () => {
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/reports/groups')) {
        return Promise.resolve({ groups: [{ id: 'sales', label: 'Sales' }] });
      }
      if (path.startsWith('/reports/sales')) return Promise.reject(new Error('boom'));
      if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderReports(<ReportsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Sales' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the Sales report/);
  });

  it('shows an error state when the Team performance report fails to load, without crashing', async () => {
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/reports/groups')) {
        return Promise.resolve({ groups: [{ id: 'team-performance', label: 'Team performance' }] });
      }
      if (path.startsWith('/reports/team-performance')) return Promise.reject(new Error('boom'));
      if (path.startsWith('/reports/overview')) return Promise.resolve(OVERVIEW);
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderReports(<ReportsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Team performance' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Could not load the Team performance report/,
    );
  });
});
