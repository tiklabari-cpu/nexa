/**
 * Availability and Agent activity (RP-03 · tm 370): the two Reports tabs and
 * the profile's "Today's activity" — what the endpoints' figures look like on
 * screen, the strip's states told apart by pattern as well as colour (and
 * listed for screen readers), the plan laid under the day, only the agent and
 * team filter keys sent, and a 403 (someone the reader may not see) rendering
 * nothing on the profile.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { resetLocale, setLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), getFile: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { AgentActivityTab, AgentDayActivity, AvailabilityTab } =
  await import('./PresenceReports.js');
const { ReportsPage } = await import('./ReportsPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const ME = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const JANE = '3f2b8c1e-5a4d-4e6f-9b7a-0c1d2e3f4a5b';
const ZED = '4a3c9d2f-6b5e-4f70-8c8b-1d2e3f4a5b6c';
const DAY = { from: '2026-10-25T21:00:00.000Z', to: '2026-10-26T21:00:00.000Z' };
const NO_FILTER = { agent_id: [], group_id: [], tag: [], topic: [] };

const seconds = (
  accepting: number,
  notAccepting = 0,
  offline = 0,
  disconnected = 0,
  unknown = 0,
) => ({
  accepting_seconds: accepting,
  not_accepting_seconds: notAccepting,
  offline_seconds: offline,
  disconnected_seconds: disconnected,
  unknown_seconds: unknown,
});

const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(DAY.from) + ((h ?? 0) * 60 + (m ?? 0)) * 60_000).toISOString();
};

function availability(): Record<string, unknown> {
  return {
    range: DAY,
    timezone: 'Europe/Istanbul',
    agents: 2,
    totals: seconds(8 * 3600 + 15 * 3600, 3600, 6 * 3600, 9 * 3600, 9 * 3600),
    by_hour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      accepting_minutes: hour === 9 ? 120 : 0,
      not_accepting_minutes: hour === 12 ? 60 : 0,
      offline_minutes: 0,
      disconnected_minutes: 0,
      unknown_minutes: 0,
      mean_accepting_agents: hour === 9 ? 2 : 0,
    })),
    by_agent: [
      {
        agent_id: JANE,
        name: 'Jane Doe',
        ...seconds(8 * 3600, 3600, 6 * 3600, 0, 9 * 3600),
        disconnects: 0,
        unresponsive_pauses: 0,
        planned_seconds: 9 * 3600,
        planned_accepting_seconds: 7 * 3600,
      },
      {
        agent_id: ZED,
        name: 'Zeynep',
        ...seconds(15 * 3600, 0, 0, 9 * 3600),
        disconnects: 1,
        unresponsive_pauses: 0,
        planned_seconds: null,
        planned_accepting_seconds: null,
      },
    ],
  };
}

function activityPage(agents: unknown[], nextCursor: string | null = null) {
  return {
    date: '2026-10-26',
    timezone: 'Europe/Istanbul',
    range: DAY,
    as_of: DAY.to,
    agents,
    next_cursor: nextCursor,
  };
}

const JANE_DAY = {
  agent_id: JANE,
  name: 'Jane Doe',
  ...seconds(8 * 3600, 3600, 6 * 3600, 0, 9 * 3600),
  segments: [
    { state: 'unknown', source: null, from: DAY.from, to: at('09:00') },
    { state: 'accepting', source: 'manual', from: at('09:00'), to: at('12:00') },
    { state: 'not_accepting', source: 'manual', from: at('12:00'), to: at('13:00') },
    { state: 'accepting', source: 'manual', from: at('13:00'), to: at('18:00') },
    { state: 'offline', source: 'manual', from: at('18:00'), to: DAY.to },
  ],
  planned: [{ from: at('08:00'), to: at('17:00') }],
};

const ZED_DAY = {
  agent_id: ZED,
  name: 'Zeynep',
  ...seconds(15 * 3600, 0, 0, 9 * 3600),
  segments: [
    { state: 'accepting', source: 'manual', from: DAY.from, to: at('15:00') },
    { state: 'disconnected', source: 'disconnect', from: at('15:00'), to: DAY.to },
  ],
  planned: null,
};

function renderWith(element: ReactElement): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const requests = (prefix: string): string[] =>
  api.get.mock.calls.map((call) => String(call[0])).filter((path) => path.startsWith(prefix));

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

beforeEach(() => {
  api.get.mockReset();
  signIn(['reports_read']);
});
afterEach(() => resetLocale());

describe('Availability tab', () => {
  it('shows time by status, each agent against their plan, and the hour-of-day table', async () => {
    api.get.mockResolvedValue(availability());
    renderWith(<AvailabilityTab range={DAY} rangeKey="k" filter={NO_FILTER} />);

    const byAgent = await screen.findByRole('table', { name: 'Time by status for each agent' });
    const jane = within(byAgent).getByRole('row', { name: /Jane Doe/ });
    expect(within(jane).getByText('8h')).toBeInTheDocument(); // accepting
    expect(within(jane).getByText('1h')).toBeInTheDocument(); // not accepting
    expect(within(jane).getByText('9h')).toBeInTheDocument(); // planned
    expect(within(jane).getByText('78%')).toBeInTheDocument(); // 7 of 9 planned hours accepting
    const zed = within(byAgent).getByRole('row', { name: /Zeynep/ });
    expect(within(zed).getByText('No schedule')).toBeInTheDocument();

    const byHour = screen.getByRole('table', {
      name: 'Time by status per hour of day, Europe/Istanbul',
    });
    expect(within(byHour).getAllByRole('row')).toHaveLength(25);
    const nine = within(byHour).getByRole('row', { name: /^09:00/ });
    expect(within(nine).getByText('2')).toBeInTheDocument();

    expect(screen.getAllByText('No connection').length).toBeGreaterThan(0);
  });

  it('sends the agent and team keys only, and names tag and topic as not applying', async () => {
    api.get.mockResolvedValue(availability());
    renderWith(
      <AvailabilityTab
        range={DAY}
        rangeKey="k"
        filter={{ agent_id: [JANE], group_id: ['7'], tag: ['t-1'], topic: ['deposit'] }}
      />,
    );
    await screen.findByRole('table', { name: 'Time by status for each agent' });
    const [path] = requests('/reports/availability');
    expect(path).toContain(`agent_id=${JANE}`);
    expect(path).toContain('group_id=7');
    expect(path).not.toContain('tag=');
    expect(path).not.toContain('topic=');
    expect(screen.getByRole('note')).toHaveTextContent('Tag and topic filters do not apply here');
  });

  it('asks for a shorter range instead of a request the server would refuse', () => {
    renderWith(
      <AvailabilityTab
        range={{ from: '2026-07-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }}
        rangeKey="k"
        filter={NO_FILTER}
      />,
    );
    expect(screen.getByText('Choose a shorter range')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('Agent activity tab', () => {
  it('draws each agent’s day with the plan underneath and a screen-reader table of the stretches', async () => {
    api.get.mockResolvedValue(activityPage([JANE_DAY, ZED_DAY]));
    renderWith(<AgentActivityTab filter={NO_FILTER} />);

    const jane = await screen.findByRole('table', {
      name: 'Day of Jane Doe, times in Europe/Istanbul',
    });
    const rows = within(jane).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Not recorded00:0009:009h',
      'Accepting chats09:0012:003h',
      'Not accepting12:0013:001h',
      'Accepting chats13:0018:005h',
      'Offline18:0000:006h',
      'Planned shift08:0017:009h',
    ]);

    // The closed browser is its own state, drawn with its own pattern.
    const zed = screen.getByRole('table', { name: 'Day of Zeynep, times in Europe/Istanbul' });
    expect(within(zed).getByText('No connection')).toBeInTheDocument();
    const bars = document.querySelectorAll('span[data-state="disconnected"]');
    expect(bars.length).toBeGreaterThan(0);
    const styles = [...document.querySelectorAll<HTMLElement>('span[data-state]')].map(
      (el) => `${el.dataset.state}:${el.style.backgroundImage ? 'pattern' : 'solid'}`,
    );
    expect(styles).toContain('disconnected:pattern');
    expect(styles).toContain('not_accepting:pattern');
    expect(styles).toContain('accepting:solid');
    expect(document.querySelectorAll('span[data-planned="true"]')).toHaveLength(1);

    // The legend names every state and the plan.
    expect(screen.getAllByText('Planned shift').length).toBeGreaterThan(0);
  });

  it('pages agents with “Show more agents”', async () => {
    const user = userEvent.setup();
    api.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('cursor=') ? activityPage([ZED_DAY]) : activityPage([JANE_DAY], JANE),
      ),
    );
    renderWith(<AgentActivityTab filter={NO_FILTER} />);
    await user.click(await screen.findByRole('button', { name: 'Show more agents' }));
    expect(
      await screen.findByRole('table', { name: 'Day of Zeynep, times in Europe/Istanbul' }),
    ).toBeInTheDocument();
    expect(requests('/reports/agent-activity').at(-1)).toContain(`cursor=${JANE}`);
    expect(screen.queryByRole('button', { name: 'Show more agents' })).toBeNull();
  });

  it('asks for the picked day', async () => {
    api.get.mockResolvedValue(activityPage([JANE_DAY]));
    renderWith(<AgentActivityTab filter={NO_FILTER} />);
    const day = await screen.findByLabelText('Day');
    await waitFor(() => expect(day).toHaveValue('2026-10-26'));
    fireEvent.change(day, { target: { value: '2026-10-20' } });
    await waitFor(() =>
      expect(requests('/reports/agent-activity').some((p) => p.includes('date=2026-10-20'))).toBe(
        true,
      ),
    );
  });

  it('opens from the Reports sidebar in Turkish', async () => {
    setLocale('tr');
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/reports/agent-activity'))
        return Promise.resolve(activityPage([ZED_DAY]));
      if (path === '/reports/groups') return Promise.resolve({ groups: [] });
      if (path.startsWith('/reports/')) return new Promise(() => {});
      return Promise.resolve({ items: [] });
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/app/reports?tab=agent-activity']}>
          <ReportsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('tab', { name: 'Ajan aktivitesi' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const zed = await screen.findByRole('table', {
      name: 'Zeynep adlı ajanın günü, saatler Europe/Istanbul diliminde',
    });
    expect(within(zed).getByText('Bağlantı yok')).toBeInTheDocument();
  });
});

describe('Today’s activity on a profile', () => {
  it('shows the person’s strip for today', async () => {
    api.get.mockResolvedValue(activityPage([JANE_DAY]));
    renderWith(<AgentDayActivity agentId={JANE} />);
    expect(await screen.findByRole('heading', { name: 'Today’s activity' })).toBeInTheDocument();
    expect(await screen.findByText('Accepting chats for 8h')).toBeInTheDocument();
    expect(requests('/reports/agent-activity')).toEqual([
      `/reports/agent-activity?agent_id=${JANE}`,
    ]);
  });

  it('renders nothing for someone the reader may not see (403)', async () => {
    api.get.mockRejectedValue(
      new ApiClientError({ type: 'authorization', status: 403, message: 'no', requestId: 'r' }),
    );
    renderWith(<AgentDayActivity agentId={ZED} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('heading')).toBeNull());
  });
});
