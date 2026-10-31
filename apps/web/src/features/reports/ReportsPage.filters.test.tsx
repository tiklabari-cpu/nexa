/**
 * Report filters on the Reports page (RP-01 · tm 368.2): the address carries
 * them (identifiers only), the four conversation reports send them, every other
 * report does not, the export and the share link take the filter on screen, a
 * saved view stores it, and a Team Lead — who holds `reports_read--groups` — is
 * shown the teams they lead and nothing wider.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), getFile: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ReportsPage } = await import('./ReportsPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const JANE = '3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b';
const ME = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const VIP = '11111111-2222-4333-8444-555555555555';

const WINDOW = { from: '2026-06-26T00:00:00.000Z', to: '2026-07-26T00:00:00.000Z' };

function overview(goals: number | null): Record<string, unknown> {
  return {
    range: WINDOW,
    filters: {},
    previous_period: {
      range: WINDOW,
      chats: 0,
      tickets: 0,
      total_cases: 0,
      closed: 0,
      manual: 0,
      assisted: 0,
      automated: 0,
      achieved_goals: goals,
      avg_first_response_seconds: null,
      avg_duration_seconds: null,
      satisfaction_score: null,
      sla_breaches: 0,
      automated_per_hour: 0,
      automated_avg_duration_seconds: null,
      total_duration_seconds: 0,
    },
    totals: {
      chats: 0,
      tickets: 0,
      total_cases: 0,
      low_confidence: false,
      closed: 0,
      manual: 0,
      assisted: 0,
      automated: 0,
      manual_rate: null,
      assisted_rate: null,
      automated_rate: null,
      split_low_confidence: false,
      queued_now: 0,
      achieved_goals: goals,
    },
    chats: {
      automated_per_hour: 0,
      automated_avg_duration_seconds: null,
      total_duration_seconds: 0,
    },
    response_times: { avg_first_response_seconds: null, avg_duration_seconds: null },
    satisfaction: { good: 0, bad: 0, score: null, responses: 0 },
    by_agent: [],
    top_tags: [],
    sla: { active: false, breaches: 0, low_confidence: false },
  };
}

const ALL_GROUPS = [
  'overview',
  'breakdown',
  'reviews',
  'team-performance',
  'cases',
  'leads',
  'sales',
];
const FILTERABLE = ['overview', 'breakdown', 'reviews', 'team-performance'];

function groupsOf(ids: string[]): { groups: Array<{ id: string; label: string }> } {
  return { groups: ids.map((id) => ({ id, label: id })) };
}

interface Setup {
  goals?: number | null;
  reportGroups?: string[];
  teams?: Array<{ id: number; name: string; agents: Array<{ agent_id: string; lead?: boolean }> }>;
}

function mockApi({ goals = 4, reportGroups = ALL_GROUPS, teams }: Setup = {}): void {
  const defaultTeams = [
    { id: 5, name: 'Support', agents: [{ agent_id: ME, lead: true }] },
    { id: 6, name: 'Billing', agents: [{ agent_id: JANE, lead: true }] },
  ];
  api.get.mockImplementation((path: string) => {
    if (path.startsWith('/reports/overview')) return Promise.resolve(overview(goals));
    if (path === '/reports/groups') return Promise.resolve(groupsOf(reportGroups));
    if (path === '/groups') return Promise.resolve({ items: teams ?? defaultTeams });
    if (path === '/agents')
      return Promise.resolve({
        items: [
          { id: JANE, name: 'Jane Doe' },
          { id: ME, name: 'Me Myself' },
        ],
      });
    if (path === '/settings/tags') return Promise.resolve({ items: [{ id: VIP, name: 'VIP' }] });
    if (path === '/reports/share-links') return Promise.resolve({ items: [] });
    if (path.startsWith('/reports/ai-agent/breakdown'))
      return Promise.resolve({ rows: [{ key: 'refund', label: 'Refund request' }] });
    // Every other report stays loading: the request is what these tests read.
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

function Location(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(url: string): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <Location />
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const requests = (prefix: string): string[] =>
  api.get.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith(prefix));

const search = (): URLSearchParams =>
  new URLSearchParams((screen.getByTestId('location').textContent ?? '').split('?')[1] ?? '');

beforeEach(() => {
  api.get.mockReset();
  api.getFile.mockReset();
  api.post.mockReset();
  localStorage.clear();
  signIn(['reports_read']);
  mockApi();
});
afterEach(() => localStorage.clear());

describe('ReportsPage — filters in the address', () => {
  it('opens filtered by the identifiers in the address and keeps them there', async () => {
    renderAt(`/app/reports?group_id=5&agent_id=${JANE}`);

    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));
    const query = new URLSearchParams(requests('/reports/overview')[0]?.split('?')[1]);
    expect(query.getAll('group_id')).toEqual(['5']);
    expect(query.getAll('agent_id')).toEqual([JANE]);

    // The chips name them; the address still holds ids and nothing else.
    expect(await screen.findByRole('button', { name: 'Team: Support' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Agent: Jane Doe' })).toBeInTheDocument();
    expect(search().getAll('group_id')).toEqual(['5']);
    expect(screen.getByTestId('location').textContent).not.toContain('@');
  });

  it('ignores a name or e-mail where an id belongs — it is never sent', async () => {
    renderAt('/app/reports?agent_id=jane@acme.test&group_id=Support');

    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));
    const sent = requests('/reports/overview')[0] ?? '';
    expect(sent).not.toContain('agent_id');
    expect(sent).not.toContain('group_id');
    expect(sent).not.toContain('@');
  });

  it('sends no filter when none is set', async () => {
    renderAt('/app/reports');
    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));
    expect(requests('/reports/overview')[0]).not.toMatch(/agent_id|group_id|tag=|topic=/);
  });

  it('narrows to a team from the chip, writes the id to the address and asks again', async () => {
    const user = userEvent.setup();
    renderAt('/app/reports');
    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: 'Team' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Billing' }));

    await waitFor(() => expect(search().getAll('group_id')).toEqual(['6']));
    await waitFor(() =>
      expect(requests('/reports/overview').some((path) => path.includes('group_id=6'))).toBe(true),
    );
  });

  it('clears every filter at once', async () => {
    const user = userEvent.setup();
    renderAt(`/app/reports?group_id=5&tag=${VIP}`);
    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/reports$/),
    );
  });

  it('offers the topics the AI recorded, once the chip is opened', async () => {
    const user = userEvent.setup();
    renderAt('/app/reports');
    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));
    expect(requests('/reports/ai-agent/breakdown')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Topic' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Refund request' }));

    await waitFor(() => expect(search().getAll('topic')).toEqual(['refund']));
    expect(requests('/reports/ai-agent/breakdown')[0]).toContain('by=intent');
  });
});

describe('ReportsPage — which reports take the filter', () => {
  it('sends it to the four conversation reports', async () => {
    renderAt(`/app/reports?tag=${VIP}`);
    const user = userEvent.setup();
    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));
    for (const [tab, path] of [
      ['Breakdown', '/reports/breakdown'],
      ['Reviews', '/reports/reviews'],
      ['Team performance', '/reports/team-performance'],
    ] as const) {
      await user.click(await screen.findByRole('tab', { name: tab }));
      await waitFor(() => expect(requests(path).length).toBeGreaterThan(0));
      expect(new URLSearchParams(requests(path)[0]?.split('?')[1]).getAll('tag')).toEqual([VIP]);
    }
  });

  it('sends it to no other report, and says that report is not filtered', async () => {
    const user = userEvent.setup();
    renderAt(`/app/reports?group_id=5`);
    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));

    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    await waitFor(() => expect(requests('/reports/cases').length).toBeGreaterThan(0));
    expect(requests('/reports/cases')[0]).not.toContain('group_id');
    expect(await screen.findByText(/This report is not filtered/)).toBeInTheDocument();
    // The filter is still there for the tabs that take it.
    expect(search().getAll('group_id')).toEqual(['5']);
  });

  it('shows "—" for goals under a filter, never a zero', async () => {
    mockApi({ goals: null });
    renderAt('/app/reports?group_id=5');
    const label = await screen.findByText('Achieved goals');
    expect(within(label.parentElement as HTMLElement).getByText('—')).toBeInTheDocument();
  });
});

describe('ReportsPage — export and share take the filter on screen', () => {
  it('exports with the same filter the screen is showing', async () => {
    const user = userEvent.setup();
    api.getFile.mockResolvedValue({ blob: new Blob(['x']), filename: 'r.csv' });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderAt(`/app/reports?group_id=5&topic=refund`);

    await user.click(await screen.findByRole('button', { name: 'Export' }));
    await waitFor(() => expect(api.getFile).toHaveBeenCalled());
    const query = new URLSearchParams(String(api.getFile.mock.calls[0]?.[0]).split('?')[1]);
    expect(query.get('group')).toBe('overview');
    expect(query.getAll('group_id')).toEqual(['5']);
    expect(query.getAll('topic')).toEqual(['refund']);
  });

  it('exports an unfiltered report when the tab takes no filter', async () => {
    const user = userEvent.setup();
    api.getFile.mockResolvedValue({ blob: new Blob(['x']), filename: 'r.csv' });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    renderAt(`/app/reports?group_id=5`);

    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    await user.click(await screen.findByRole('button', { name: 'Export' }));
    await waitFor(() => expect(api.getFile).toHaveBeenCalled());
    expect(String(api.getFile.mock.calls[0]?.[0])).not.toContain('group_id');
  });

  it('freezes the filter into a share link', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      id: 'l1',
      group: 'overview',
      from: WINDOW.from,
      to: WINDOW.to,
      filters: { group_id: ['5'] },
      token_last_four: 'abcd',
      created_at: WINDOW.to,
      expires_at: WINDOW.to,
      revoked_at: null,
      expired: false,
      token: 'tok',
    });
    renderAt(`/app/reports?group_id=5&agent_id=${JANE}`);

    await user.click(await screen.findByRole('button', { name: 'Share this report' }));
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, body] = api.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/reports/share-links');
    expect(body['filters']).toEqual({ group_id: ['5'], agent_id: [JANE] });
  });

  it('creates an unfiltered link without a filters key', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      id: 'l1',
      group: 'overview',
      from: WINDOW.from,
      to: WINDOW.to,
      filters: {},
      token_last_four: 'abcd',
      created_at: WINDOW.to,
      expires_at: WINDOW.to,
      revoked_at: null,
      expired: false,
      token: 'tok',
    });
    renderAt('/app/reports');
    await user.click(await screen.findByRole('button', { name: 'Share this report' }));
    await user.click(await screen.findByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((api.post.mock.calls[0] as [string, Record<string, unknown>])[1]).not.toHaveProperty(
      'filters',
    );
  });
});

describe('ReportsPage — saved views keep the filter', () => {
  it('saves the filter with the view and applies it again', async () => {
    const user = userEvent.setup();
    renderAt(`/app/reports?group_id=5&tag=${VIP}`);

    await user.click(await screen.findByRole('button', { name: 'Saved views' }));
    await user.type(await screen.findByLabelText('Save this view'), 'Support VIPs');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const stored = JSON.parse(localStorage.getItem('siyahtus.reports.saved-views') ?? '[]');
    expect(stored[0].filter).toEqual({ agent_id: [], group_id: ['5'], tag: [VIP], topic: [] });

    await user.click(await screen.findByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(search().getAll('group_id')).toEqual([]));

    await user.click(screen.getByRole('button', { name: 'Saved views' }));
    await user.click(await screen.findByRole('button', { name: 'Support VIPs' }));
    await waitFor(() => expect(search().getAll('group_id')).toEqual(['5']));
    expect(search().getAll('tag')).toEqual([VIP]);
  });

  it('opens a saved view by ?view= with its filter and tidies the address', async () => {
    localStorage.setItem(
      'siyahtus.reports.saved-views',
      JSON.stringify([
        {
          id: 'v1',
          name: 'Billing',
          tab: 'breakdown',
          mode: 7,
          customFrom: '',
          customTo: '',
          baseline: null,
          filter: { group_id: ['6'] },
        },
      ]),
    );
    renderAt('/app/reports?view=v1');
    await waitFor(() => expect(search().getAll('group_id')).toEqual(['6']));
    expect(search().get('view')).toBeNull();
    await waitFor(() =>
      expect(requests('/reports/breakdown').some((path) => path.includes('group_id=6'))).toBe(true),
    );
  });

  it('still opens a view saved before filters existed', async () => {
    localStorage.setItem(
      'siyahtus.reports.saved-views',
      JSON.stringify([
        {
          id: 'v0',
          name: 'Old',
          tab: 'reviews',
          mode: 30,
          customFrom: '',
          customTo: '',
          baseline: null,
        },
      ]),
    );
    renderAt('/app/reports?view=v0');
    await waitFor(() => expect(requests('/reports/reviews').length).toBeGreaterThan(0));
    expect(requests('/reports/reviews')[0]).not.toContain('group_id');
  });
});

describe('ReportsPage — a Team Lead reads the teams they lead', () => {
  beforeEach(() => {
    signIn(['reports_read--groups'], 'team_lead');
    mockApi({ reportGroups: FILTERABLE });
  });

  it('opens the page (no redirect to the QA queue) with the four conversation reports only', async () => {
    renderAt('/app/reports');
    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));
    await screen.findByRole('tab', { name: 'Breakdown' });
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Overview', 'Breakdown', 'Reviews', 'Team performance']);
  });

  it('shows the team picker locked to their own teams', async () => {
    const user = userEvent.setup();
    renderAt('/app/reports');
    const chip = await screen.findByRole('button', { name: 'Team: Your teams' });
    // No "×": the lock cannot be switched off.
    expect(screen.queryByRole('button', { name: 'Clear Team filter' })).toBeNull();

    await user.click(chip);
    // Support is led by this account, Billing by someone else.
    expect(await screen.findByRole('checkbox', { name: 'Support' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Billing' })).toBeNull();
  });

  it('says so when the address names a team they do not lead', async () => {
    renderAt('/app/reports?group_id=6');
    expect(await screen.findByText(/not teams you lead/)).toBeInTheDocument();
  });

  it('does not offer export or share on a report the catalogue withholds', async () => {
    mockApi({ reportGroups: [] });
    renderAt('/app/reports');
    await waitFor(() => expect(requests('/reports/overview').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });
});
