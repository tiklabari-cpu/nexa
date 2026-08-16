import { act, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ReportsScreen } from './ReportsScreen';
import { ReportsContext } from './context';
import type { ReportsApi } from './api';
import type { ReportsOverview } from './types';
import { ThemeProvider } from '../../theme/theme';

function overview(overrides: Partial<ReportsOverview> = {}): ReportsOverview {
  return {
    range: { from: '2026-07-17T00:00:00.000Z', to: '2026-08-16T00:00:00.000Z' },
    previous_period: {
      baseline: 'previous_period',
      range: { from: '2026-06-17T00:00:00.000Z', to: '2026-07-17T00:00:00.000Z' },
      chats: 40,
      tickets: 5,
      total_cases: 45,
      closed: 38,
      manual: 20,
      assisted: 10,
      automated: 8,
      avg_first_response_seconds: 90,
      avg_duration_seconds: 600,
      satisfaction_score: 0.7,
      achieved_goals: 4,
      sla_breaches: 1,
    },
    totals: {
      chats: 50,
      tickets: 6,
      total_cases: 56,
      closed: 45,
      manual: 25,
      assisted: 12,
      automated: 8,
      manual_rate: 25 / 45,
      assisted_rate: 12 / 45,
      automated_rate: 8 / 45,
      queued_now: 0,
      achieved_goals: 5,
    },
    chats: {
      automated_per_hour: 1.2,
      automated_avg_duration_seconds: 300,
      total_duration_seconds: 27000,
    },
    response_times: { avg_first_response_seconds: 75, avg_duration_seconds: 540 },
    satisfaction: { good: 18, bad: 2, score: 0.9, responses: 20 },
    by_agent: [],
    top_tags: [],
    sla: { active: false, breaches: 0, low_confidence: false },
    ...overrides,
  };
}

function api(overrides: Partial<ReportsApi> = {}): ReportsApi {
  return {
    getOverview: async () => overview(),
    ...overrides,
  };
}

async function mount(reportsApi: ReportsApi): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <ReportsContext.Provider value={reportsApi}>
        <ReportsScreen />
      </ReportsContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

function kpi(label: string) {
  return screen.getByTestId(`reports-kpi-${label}`);
}

describe('ReportsScreen', () => {
  it('shows a loading skeleton before the overview arrives', async () => {
    let resolve: (value: ReportsOverview) => void = () => {};
    const pending = new Promise<ReportsOverview>((r) => {
      resolve = r;
    });

    const tree: ReactElement = (
      <ThemeProvider>
        <ReportsContext.Provider value={api({ getOverview: async () => pending })}>
          <ReportsScreen />
        </ReportsContext.Provider>
      </ThemeProvider>
    );
    await render(tree);

    expect(screen.getByTestId('reports-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve(overview());
    });
  });

  it('shows the volume, resolution and responsiveness KPI cards', async () => {
    await mount(api());

    expect(await screen.findByText('Volume')).toBeOnTheScreen();
    expect(within(kpi('Conversations')).getByText('50')).toBeOnTheScreen();
    expect(within(kpi('Total cases')).getByText('56')).toBeOnTheScreen();
    expect(within(kpi('Closed')).getByText('45')).toBeOnTheScreen();

    expect(within(kpi('Manual')).getByText('25')).toBeOnTheScreen();
    expect(within(kpi('Assisted')).getByText('12')).toBeOnTheScreen();
    expect(within(kpi('Automated')).getByText('8')).toBeOnTheScreen();

    expect(within(kpi('Satisfaction')).getByText('90%')).toBeOnTheScreen();
    expect(within(kpi('Negative ratings')).getByText('2')).toBeOnTheScreen();
  });

  it('shows a low-confidence hint on SLA breaches below the sample threshold (FR-MOD-07.3.2)', async () => {
    await mount(
      api({
        getOverview: async () =>
          overview({ sla: { active: true, breaches: 1, low_confidence: true } }),
      }),
    );

    expect(await screen.findByText('SLA breaches')).toBeOnTheScreen();
    expect(
      within(kpi('SLA breaches')).getByText('Not enough cases yet to read much into this'),
    ).toBeOnTheScreen();
  });

  it('reads an unconfigured SLA as "not tracked", not as a clean record of zero', async () => {
    await mount(
      api({
        getOverview: async () =>
          overview({ sla: { active: false, breaches: 0, low_confidence: false } }),
      }),
    );

    expect(await screen.findByText('SLA breaches')).toBeOnTheScreen();
    expect(within(kpi('SLA breaches')).getByText('—')).toBeOnTheScreen();
    expect(
      within(kpi('SLA breaches')).getByText('Set targets in Settings → SLA to track this'),
    ).toBeOnTheScreen();
  });

  it('reads nothing-closed as a plain note rather than a fabricated 0%', async () => {
    await mount(
      api({
        getOverview: async () =>
          overview({
            totals: {
              ...overview().totals,
              closed: 0,
              manual: 0,
              assisted: 0,
              automated: 0,
              manual_rate: null,
              assisted_rate: null,
              automated_rate: null,
            },
          }),
      }),
    );

    expect(await screen.findByText('Resolution')).toBeOnTheScreen();
    expect(within(kpi('Manual')).getAllByText('Nothing closed in this window')).toHaveLength(1);
  });

  it('says what went wrong when the overview could not be loaded', async () => {
    await mount(
      api({
        getOverview: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });
});
