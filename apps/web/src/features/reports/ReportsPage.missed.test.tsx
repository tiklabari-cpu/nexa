/**
 * The Missed chats and Engagement tabs (RP-02 · tm 369.2): what the two
 * endpoints' figures look like on screen, the heat map in the workspace's time
 * zone, the "not exact" note when a partial backfill fed the figures, the
 * campaign row apart from the customer row, and the tabs' visibility following
 * the report-group catalogue.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { resetLocale, setLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), getFile: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ReportsPage } = await import('./ReportsPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const ME = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const JANE = '3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b';
const WINDOW = { from: '2026-06-26T00:00:00.000Z', to: '2026-07-26T00:00:00.000Z' };

const NONE = {
  missed: 0,
  queue_abandoned: 0,
  unanswered_assigned: 0,
  unanswered_after_ai: 0,
};

function heatmap(
  hits: Array<{ weekday: number; hour: number; missed: number }>,
): Array<typeof NONE & { weekday: number; hour: number }> {
  const out: Array<typeof NONE & { weekday: number; hour: number }> = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const hit = hits.find((h) => h.weekday === weekday && h.hour === hour);
      out.push({ ...NONE, weekday, hour, missed: hit?.missed ?? 0 });
    }
  }
  return out;
}

function missedReport(estimated = 0, missed = 7): Record<string, unknown> {
  return {
    range: WINDOW,
    timezone: 'Asia/Tokyo',
    totals: {
      missed,
      queue_abandoned: missed === 0 ? 0 : 4,
      unanswered_assigned: missed === 0 ? 0 : 1,
      unanswered_after_ai: missed === 0 ? 0 : 2,
      closed: 40,
      missed_rate: missed / 40,
      estimated,
    },
    by_day:
      missed === 0
        ? []
        : [
            {
              date: '2026-07-01',
              missed,
              queue_abandoned: 4,
              unanswered_assigned: 1,
              unanswered_after_ai: 2,
            },
          ],
    heatmap: heatmap(
      missed === 0
        ? []
        : [
            { weekday: 1, hour: 9, missed: 5 },
            { weekday: 3, hour: 14, missed: 2 },
          ],
    ),
    by_team:
      missed === 0
        ? []
        : [
            {
              team_id: 5,
              name: 'Support',
              missed: 6,
              queue_abandoned: 3,
              unanswered_assigned: 1,
              unanswered_after_ai: 2,
            },
            {
              team_id: null,
              name: null,
              missed: 1,
              queue_abandoned: 1,
              unanswered_assigned: 0,
              unanswered_after_ai: 0,
            },
          ],
    by_agent:
      missed === 0
        ? []
        : [
            {
              agent_id: JANE,
              name: 'Jane Doe',
              missed: 3,
              queue_abandoned: 0,
              unanswered_assigned: 1,
              unanswered_after_ai: 2,
            },
          ],
    previous_period: { range: WINDOW, ...NONE, missed: 4, closed: 20 },
  };
}

function engagementReport(): Record<string, unknown> {
  const row = (
    initiated_by: string,
    chats: number,
    closed: number,
    answered: number,
    missed: number,
  ) => ({
    initiated_by,
    chats,
    closed,
    answered,
    missed,
  });
  return {
    range: WINDOW,
    timezone: 'Asia/Tokyo',
    totals: { chats: 30 },
    by_initiator: [
      row('customer', 20, 18, 15, 3),
      row('agent', 4, 4, 4, 0),
      row('campaign', 5, 3, 2, 1),
      row('ai', 0, 0, 0, 0),
      row('channel', 0, 0, 0, 0),
      row('unknown', 1, 1, 0, 0),
    ],
    by_day: [
      { date: '2026-07-01', ...row('customer', 20, 18, 15, 3) },
      { date: '2026-07-01', ...row('campaign', 5, 3, 2, 1) },
    ],
    previous_period: {
      range: WINDOW,
      chats: 25,
      customer: 18,
      agent: 3,
      campaign: 3,
      ai: 0,
      channel: 0,
      unknown: 1,
    },
  };
}

const ALL = ['overview', 'breakdown', 'reviews', 'team-performance', 'missed', 'engagement'];

function mockApi(opts: { groups?: string[]; estimated?: number; missed?: number } = {}): void {
  const { groups = ALL, estimated = 0, missed = 7 } = opts;
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/missed')) return Promise.resolve(missedReport(estimated, missed));
    if (path.startsWith('/reports/engagement')) return Promise.resolve(engagementReport());
    if (path === '/reports/groups')
      return Promise.resolve({ groups: groups.map((id) => ({ id, label: id })) });
    if (path === '/groups') return Promise.resolve({ items: [] });
    if (path === '/agents') return Promise.resolve({ items: [] });
    if (path === '/settings/tags') return Promise.resolve({ items: [] });
    if (path === '/reports/share-links') return Promise.resolve({ items: [] });
    if (path.startsWith('/reports/')) return new Promise(() => {});
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function signIn(scopes: string[], role = 'admin'): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: ME,
      email: 'me@acme.localhost',
      name: 'Me Myself',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: 'accepting_chats',
    },
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

const requests = (prefix: string): string[] =>
  api.get.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith(prefix));

beforeEach(() => {
  api.get.mockReset();
  api.getFile.mockReset();
  localStorage.clear();
  signIn(['reports_read']);
  mockApi();
});
afterEach(() => {
  localStorage.clear();
  resetLocale();
});

describe('ReportsPage — Missed chats tab', () => {
  it('shows the totals, the reasons and the missed rate from the endpoint', async () => {
    renderAt('/app/reports?tab=missed');

    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Missed rate')).toBeInTheDocument();
    // 7 of 40 closed.
    expect(within(panel).getByText('18%')).toBeInTheDocument();
    expect(within(panel).getByText('Of 40 closed')).toBeInTheDocument();
    expect(within(panel).getAllByText('Left in queue').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('Missed after AI handover').length).toBeGreaterThan(0);
    expect(requests('/reports/missed')).toHaveLength(1);
  });

  it('draws the 7 × 24 heat map and names the workspace time zone, not the browser’s', async () => {
    renderAt('/app/reports?tab=missed');

    const grid = await screen.findByRole('table', {
      name: 'Missed chats per weekday and hour, Asia/Tokyo',
    });
    expect(within(grid).getAllByRole('row')).toHaveLength(8); // header + 7 weekdays
    const monday = within(grid).getByRole('row', { name: /^Mon/ });
    const cells = within(monday).getAllByRole('cell');
    expect(cells).toHaveLength(24);
    expect(cells[9]).toHaveTextContent('5');
    expect(cells[9]).toHaveAttribute('title', '5 missed');
    expect(cells[10]).toHaveTextContent('0');
    expect(
      screen.getByText(/by weekday and hour, in the workspace time zone \(Asia\/Tokyo\)/),
    ).toBeInTheDocument();
  });

  it('says the figures are not exact when a partial backfill fed them', async () => {
    mockApi({ estimated: 3 });
    renderAt('/app/reports?tab=missed');

    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('3 of the missed chats');
    expect(note).toHaveTextContent('not exact');
  });

  it('shows no estimate note when every reason was recorded', async () => {
    renderAt('/app/reports?tab=missed');
    await screen.findByText('Missed rate');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('shows the by-team table with an unassigned row and the by-agent table', async () => {
    renderAt('/app/reports?tab=missed');

    const team = await screen.findByRole('table', {
      name: 'Missed chats per team, split by reason',
    });
    expect(within(team).getByText('Support')).toBeInTheDocument();
    expect(within(team).getByText('Unassigned')).toBeInTheDocument();
    const agent = screen.getByRole('table', { name: 'Missed chats per agent, split by reason' });
    expect(within(agent).getByText('Jane Doe')).toBeInTheDocument();
  });

  it('shows an empty state instead of an all-zero heat map when nothing was missed', async () => {
    mockApi({ missed: 0 });
    renderAt('/app/reports?tab=missed');

    expect(await screen.findByText('No missed chats in this window')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /per weekday and hour/ })).not.toBeInTheDocument();
  });

  it('sends the report filter on the address (RP-01)', async () => {
    renderAt('/app/reports?tab=missed&group_id=5');

    await waitFor(() => expect(requests('/reports/missed')).toHaveLength(1));
    const query = new URLSearchParams(requests('/reports/missed')[0]?.split('?')[1]);
    expect(query.getAll('group_id')).toEqual(['5']);
  });
});

describe('ReportsPage — Engagement tab', () => {
  it('lists all six openers, the campaign on a row of its own', async () => {
    renderAt('/app/reports?tab=engagement');

    const table = await screen.findByRole('table', { name: 'Chats by who started them' });
    const names = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');
    expect(names).toEqual([
      'Customer',
      'Agent',
      'Campaign',
      'AI',
      'Channel',
      'UnknownThe channel did not say how the chat began',
    ]);
    const campaign = within(table).getByRole('row', { name: /^Campaign/ });
    expect(within(campaign).getAllByRole('cell')[1]).toHaveTextContent('5');
    expect(within(campaign).getAllByRole('cell')[3]).toHaveTextContent('1');
  });

  it('pivots the per-day rows into one line per day', async () => {
    renderAt('/app/reports?tab=engagement');

    const byDay = await screen.findByRole('table', {
      name: 'Chats started per day, by who started them',
    });
    expect(within(byDay).getAllByRole('row')).toHaveLength(2); // header + one day
  });

  it('sends the report filter on the address (RP-01)', async () => {
    renderAt('/app/reports?tab=engagement&agent_id=' + JANE);

    await waitFor(() => expect(requests('/reports/engagement')).toHaveLength(1));
    const query = new URLSearchParams(requests('/reports/engagement')[0]?.split('?')[1]);
    expect(query.getAll('agent_id')).toEqual([JANE]);
  });
});

describe('ReportsPage — the two tabs follow the report-group catalogue', () => {
  it('offers both tabs under a category when the catalogue lists them', async () => {
    renderAt('/app/reports');

    expect(await screen.findByRole('tab', { name: 'Missed chats' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Engagement' })).toBeInTheDocument();
  });

  it('hides them when the catalogue withholds them', async () => {
    mockApi({ groups: ['overview', 'breakdown'] });
    renderAt('/app/reports');

    await screen.findByRole('tab', { name: 'Overview' });
    await waitFor(() => expect(requests('/reports/groups')).not.toHaveLength(0));
    expect(screen.queryByRole('tab', { name: 'Missed chats' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Engagement' })).not.toBeInTheDocument();
  });

  it('opens them for a Team Lead who reads only the teams they lead', async () => {
    signIn(['reports_read--groups'], 'team_lead');
    mockApi({
      groups: ['overview', 'breakdown', 'reviews', 'team-performance', 'missed', 'engagement'],
    });
    renderAt('/app/reports?tab=missed');

    expect(await screen.findByRole('tab', { name: 'Missed chats' })).toBeInTheDocument();
    expect(await screen.findByText('Missed rate')).toBeInTheDocument();
  });
});

describe('ReportsPage — Missed chats (Turkish)', () => {
  it('names the tabs in the panel language', async () => {
    setLocale('tr');
    renderAt('/app/reports?tab=missed');
    expect(await screen.findByRole('tab', { name: 'Kaçan sohbetler' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Etkileşim' })).toBeInTheDocument();
    expect(
      await screen.findByRole('table', {
        name: 'Gün ve saate göre kaçan sohbetler, Asia/Tokyo',
      }),
    ).toBeInTheDocument();
  });
});
