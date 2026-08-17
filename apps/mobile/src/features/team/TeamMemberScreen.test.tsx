import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { TeamMemberScreen } from './TeamMemberScreen';
import { TeamContext } from './context';
import type { TeamApi } from './api';
import type { Agent, AgentWorkSchedule } from './types';
import { ThemeProvider } from '../../theme/theme';

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatar_url: null,
    role: 'agent',
    routing_status: 'accepting_chats',
    concurrent_chats_limit: 5,
    two_factor_enabled: true,
    suspended: false,
    expertise: [],
    ...overrides,
  };
}

function schedule(overrides: Partial<AgentWorkSchedule> = {}): AgentWorkSchedule {
  return {
    timezone: 'Europe/Istanbul',
    schedule: [
      { day: 'monday', start: '09:00', end: '18:00', enabled: true },
      { day: 'saturday', start: '09:00', end: '18:00', enabled: false },
    ],
    ...overrides,
  };
}

function api(overrides: Partial<TeamApi> = {}): TeamApi {
  return {
    listAgents: async () => [],
    getAgentWorkSchedule: async () => schedule(),
    listGroups: async () => [],
    ...overrides,
  };
}

async function mount(teamApi: TeamApi, subject: Agent = agent()): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <TeamContext.Provider value={teamApi}>
        <TeamMemberScreen agent={subject} />
      </TeamContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('TeamMemberScreen', () => {
  it('shows the identity card built from the roster row', async () => {
    await mount(
      api(),
      agent({
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        role: 'admin',
        concurrent_chats_limit: 8,
      }),
    );

    expect(await screen.findByText('Ada Lovelace')).toBeOnTheScreen();
    expect(screen.getByText('ada@example.com')).toBeOnTheScreen();
    expect(screen.getByText('8')).toBeOnTheScreen();
    expect(screen.getByText('Enabled')).toBeOnTheScreen();
  });

  it('marks a suspended teammate', async () => {
    await mount(api(), agent({ suspended: true }));

    expect(await screen.findAllByText('Suspended')).not.toHaveLength(0);
  });

  it('lists expertise areas, or says there are none', async () => {
    await mount(api(), agent({ expertise: [{ id: 1, name: 'Billing', slug: 'billing' }] }));

    expect(await screen.findByText('Billing')).toBeOnTheScreen();
  });

  it('says there is no expertise set rather than an empty card', async () => {
    await mount(api(), agent({ expertise: [] }));

    expect(await screen.findByText('No expertise areas set.')).toBeOnTheScreen();
  });

  it('shows a loading state before the work schedule arrives', async () => {
    let resolve: (value: AgentWorkSchedule) => void = () => {};
    const pending = new Promise<AgentWorkSchedule>((r) => {
      resolve = r;
    });

    const tree: ReactElement = (
      <ThemeProvider>
        <TeamContext.Provider value={api({ getAgentWorkSchedule: async () => pending })}>
          <TeamMemberScreen agent={agent()} />
        </TeamContext.Provider>
      </ThemeProvider>
    );
    await render(tree);

    expect(screen.getByTestId('team-member-schedule-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve(schedule());
    });
  });

  it('shows the weekly plan, day by day', async () => {
    await mount(api({ getAgentWorkSchedule: async () => schedule() }));

    expect(await screen.findByText('Timezone: Europe/Istanbul')).toBeOnTheScreen();
    expect(screen.getByText('Monday')).toBeOnTheScreen();
    expect(screen.getByText('09:00–18:00')).toBeOnTheScreen();
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);
  });

  it('says what went wrong when the schedule could not be loaded', async () => {
    await mount(
      api({
        getAgentWorkSchedule: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });
});
