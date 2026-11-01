/**
 * The Queue and Queue abandonment tabs (RP-04 · tm 371): what the two
 * endpoints' figures look like on screen — the waits as durations, the shares,
 * every team on its own row, the heat map in the workspace's time zone, the
 * abandonment bands — plus the report filter riding on the address and the
 * tabs' visibility following the report-group catalogue.
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
const WINDOW = { from: '2026-06-26T00:00:00.000Z', to: '2026-07-26T00:00:00.000Z' };

const NONE = {
  entries: 0,
  assigned: 0,
  abandoned: 0,
  closed_by_agent: 0,
  transferred: 0,
  timeout: 0,
  waiting: 0,
  avg_wait_seconds: null,
  p80_wait_seconds: null,
  max_wait_seconds: null,
  abandon_avg_wait_seconds: null,
};

function heatmap(
  hits: Array<{ weekday: number; hour: number; entries: number; abandoned: number }>,
): Array<typeof NONE & { weekday: number; hour: number }> {
  const out: Array<typeof NONE & { weekday: number; hour: number }> = [];
  for (let weekday = 1; weekday <= 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const hit = hits.find((h) => h.weekday === weekday && h.hour === hour);
      out.push({
        ...NONE,
        weekday,
        hour,
        entries: hit?.entries ?? 0,
        abandoned: hit?.abandoned ?? 0,
      });
    }
  }
  return out;
}

const BANDS = [
  { key: 'under_30s', from_seconds: 0, to_seconds: 30, abandoned: 0 },
  { key: '30s_to_1m', from_seconds: 30, to_seconds: 60, abandoned: 1 },
  { key: '1m_to_2m', from_seconds: 60, to_seconds: 120, abandoned: 0 },
  { key: '2m_to_5m', from_seconds: 120, to_seconds: 300, abandoned: 0 },
  { key: '5m_to_10m', from_seconds: 300, to_seconds: 600, abandoned: 1 },
  { key: 'over_10m', from_seconds: 600, to_seconds: null, abandoned: 1 },
];

function queueReport(entries = 13, abandoned = 3): Record<string, unknown> {
  const empty = entries === 0;
  const counts = empty
    ? NONE
    : {
        ...NONE,
        entries,
        assigned: 6,
        abandoned,
        waiting: 1,
        avg_wait_seconds: 180,
        p80_wait_seconds: 300,
        max_wait_seconds: 600,
        abandon_avg_wait_seconds: 382,
      };
  return {
    range: WINDOW,
    timezone: 'Asia/Tokyo',
    totals: {
      ...counts,
      assigned_rate: empty ? null : 0.4615,
      abandonment_rate: empty ? null : 0.2308,
    },
    by_day: empty ? [] : [{ date: '2026-07-01', ...counts }],
    heatmap: heatmap(
      empty
        ? []
        : [
            { weekday: 1, hour: 9, entries: 5, abandoned: 2 },
            { weekday: 3, hour: 14, entries: 2, abandoned: 1 },
          ],
    ),
    by_team: empty
      ? []
      : [
          {
            ...counts,
            team_id: 5,
            name: 'Support',
            entries: 8,
            avg_wait_seconds: 180,
            assigned_rate: 0.625,
            abandonment_rate: 0.25,
          },
          {
            ...counts,
            team_id: 6,
            name: 'Sales',
            entries: 3,
            avg_wait_seconds: 600,
            assigned_rate: 0.3333,
            abandonment_rate: 0.3333,
          },
          {
            ...counts,
            team_id: null,
            name: null,
            entries: 2,
            avg_wait_seconds: null,
            assigned_rate: 0,
            abandonment_rate: 0,
          },
        ],
    by_wait: BANDS,
    previous_period: {
      range: WINDOW,
      baseline: 'previous_period',
      entries: 10,
      assigned: 5,
      abandoned: 2,
      avg_wait_seconds: 120,
      p80_wait_seconds: 240,
      assigned_rate: 0.5,
      abandonment_rate: 0.2,
    },
  };
}

const ALL = [
  'overview',
  'breakdown',
  'reviews',
  'team-performance',
  'missed',
  'engagement',
  'queue',
  'queue-abandonment',
];

function mockApi(opts: { groups?: string[]; entries?: number } = {}): void {
  const { groups = ALL, entries = 13 } = opts;
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/queue')) return Promise.resolve(queueReport(entries));
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

describe('ReportsPage — Queue tab', () => {
  it('shows the entries, the assigned share and the waits as durations (RP-04)', async () => {
    renderAt('/app/reports?tab=queue');

    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Entered the queue')).toBeInTheDocument();
    expect(within(panel).getAllByText('13').length).toBeGreaterThan(0);
    expect(within(panel).getByText('1 still waiting')).toBeInTheDocument();
    expect(within(panel).getByText('46%')).toBeInTheDocument();
    expect(within(panel).getByText('6 reached an agent')).toBeInTheDocument();
    // 180 s, 300 s and 600 s.
    expect(within(panel).getAllByText('3m').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('5m').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('10m').length).toBeGreaterThan(0);
    expect(requests('/reports/queue')).toHaveLength(1);
    expect(requests('/reports/queue-abandonment')).toHaveLength(0);
  });

  it('gives every team its own row, with an unassigned one (RP-04)', async () => {
    renderAt('/app/reports?tab=queue');

    const team = await screen.findByRole('table', {
      name: 'Queue entries, assignment and wait per team',
    });
    const rows = within(team).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + three teams
    const support = within(team).getByText('Support').closest('tr')!;
    expect(within(support).getByText('63%')).toBeInTheDocument();
    expect(within(support).getAllByText('3m').length).toBeGreaterThan(0);
    const sales = within(team).getByText('Sales').closest('tr')!;
    expect(within(sales).getAllByText('10m').length).toBeGreaterThan(0);
    expect(within(team).getByText('Unassigned')).toBeInTheDocument();
  });

  it('draws the 7 × 24 heat map and names the workspace time zone, not the browser’s', async () => {
    renderAt('/app/reports?tab=queue');

    const grid = await screen.findByRole('table', {
      name: 'Chats that entered the queue per weekday and hour, Asia/Tokyo',
    });
    expect(within(grid).getAllByRole('row')).toHaveLength(8);
    const monday = within(grid).getByRole('row', { name: /^Mon/ });
    const cells = within(monday).getAllByRole('cell');
    expect(cells).toHaveLength(24);
    expect(cells[9]).toHaveTextContent('5');
    expect(cells[9]).toHaveAttribute('title', '5 entered');
  });

  it('shows an empty state instead of an all-zero grid when nobody waited', async () => {
    mockApi({ entries: 0 });
    renderAt('/app/reports?tab=queue');

    expect(await screen.findByText('Nobody waited in this window')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /per weekday and hour/ })).not.toBeInTheDocument();
    // No wait to average: dashes, not "0 s".
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('sends the report filter on the address (RP-01)', async () => {
    renderAt('/app/reports?tab=queue&group_id=5');

    await waitFor(() => expect(requests('/reports/queue')).toHaveLength(1));
    const query = new URLSearchParams(requests('/reports/queue')[0]?.split('?')[1]);
    expect(query.getAll('group_id')).toEqual(['5']);
  });

  it('reads in Turkish with the same figures', async () => {
    setLocale('tr');
    renderAt('/app/reports?tab=queue');

    expect(await screen.findByText('Kuyruğa giren')).toBeInTheDocument();
    expect(screen.getByText('Ekibe göre')).toBeInTheDocument();
  });
});

describe('ReportsPage — Queue abandonment tab', () => {
  it('shows the abandoned count, the rate and the mean wait before leaving (RP-04)', async () => {
    renderAt('/app/reports?tab=queue-abandonment');

    const panel = await screen.findByRole('tabpanel');
    expect(await within(panel).findByText('Abandonment rate')).toBeInTheDocument();
    expect(within(panel).getByText('23%')).toBeInTheDocument();
    expect(within(panel).getByText('Of 13 that entered the queue')).toBeInTheDocument();
    // 382 s.
    expect(within(panel).getAllByText('6m 22s').length).toBeGreaterThan(0);
    expect(requests('/reports/queue-abandonment')).toHaveLength(1);
  });

  it('lays the six wait bands out in order, zeros included', async () => {
    renderAt('/app/reports?tab=queue-abandonment');

    const bands = await screen.findByRole('table', { name: 'Abandoned chats by time waited' });
    const rows = within(bands).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'Under 30 s',
      '30 s – 1 min',
      '1 – 2 min',
      '2 – 5 min',
      '5 – 10 min',
      'Over 10 min',
    ]);
    expect(rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent)).toEqual([
      '0',
      '1',
      '0',
      '0',
      '1',
      '1',
    ]);
  });

  it('shows the abandonment heat map by hour and the per-team share', async () => {
    renderAt('/app/reports?tab=queue-abandonment');

    const grid = await screen.findByRole('table', {
      name: 'Chats abandoned in the queue per weekday and hour, Asia/Tokyo',
    });
    const monday = within(grid).getByRole('row', { name: /^Mon/ });
    expect(within(monday).getAllByRole('cell')[9]).toHaveAttribute('title', '2 abandoned');
    const team = screen.getByRole('table', { name: 'Queue abandonment per team' });
    expect(within(team).getByText('Support')).toBeInTheDocument();
    expect(within(team).getByText('25%')).toBeInTheDocument();
  });

  it('shows an empty state when nobody left the queue', async () => {
    mockApi({ entries: 0 });
    renderAt('/app/reports?tab=queue-abandonment');

    expect(await screen.findByText('Nobody left the queue in this window')).toBeInTheDocument();
  });
});

describe('ReportsPage — queue tab visibility', () => {
  it('lists both tabs when the catalogue grants them', async () => {
    renderAt('/app/reports?tab=queue');

    expect(await screen.findByRole('tab', { name: 'Queue' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Queue abandonment' })).toBeInTheDocument();
  });

  it('hides both when the catalogue does not list them', async () => {
    mockApi({ groups: ['overview', 'breakdown', 'reviews'] });
    renderAt('/app/reports?tab=overview');

    await screen.findByRole('tab', { name: 'Overview' });
    expect(screen.queryByRole('tab', { name: 'Queue' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Queue abandonment' })).not.toBeInTheDocument();
  });
});
