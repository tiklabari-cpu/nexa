import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { TeamListScreen } from './TeamListScreen';
import { TeamContext } from './context';
import type { TeamApi } from './api';
import type { Agent } from './types';
import { ThemeProvider } from '../../theme/theme';

function agent(overrides: Partial<Agent> & { id: string }): Agent {
  return {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    avatar_url: null,
    role: 'agent',
    routing_status: 'accepting_chats',
    concurrent_chats_limit: 5,
    two_factor_enabled: false,
    suspended: false,
    expertise: [],
    ...overrides,
  };
}

function api(overrides: Partial<TeamApi> = {}): TeamApi {
  return {
    listAgents: async () => [],
    getAgentWorkSchedule: async () => {
      throw new Error('not used by this screen');
    },
    listGroups: async () => {
      throw new Error('not used by this screen');
    },
    ...overrides,
  };
}

/**
 * RNTL v14 renders through a concurrent root, so `render` returns a promise —
 * an un-awaited one leaves `screen` empty rather than failing loudly.
 */
async function mount(
  teamApi: TeamApi,
  onOpenAgent = jest.fn(),
): Promise<{ onOpenAgent: jest.Mock }> {
  const tree: ReactElement = (
    <ThemeProvider>
      <TeamContext.Provider value={teamApi}>
        <TeamListScreen onOpenAgent={onOpenAgent} />
      </TeamContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
  return { onOpenAgent };
}

describe('TeamListScreen', () => {
  it('says there is no team rather than showing a blank rectangle', async () => {
    await mount(api());

    expect(await screen.findByText('No teammates yet.')).toBeOnTheScreen();
  });

  it('says what went wrong when the roster could not be loaded', async () => {
    await mount(
      api({
        listAgents: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('lists teammates with their role and status', async () => {
    await mount(
      api({
        listAgents: async () => [
          agent({ id: 'agent-1', name: 'Ada Lovelace', role: 'admin', routing_status: 'offline' }),
        ],
      }),
    );

    expect(await screen.findByText('Ada Lovelace')).toBeOnTheScreen();
    expect(screen.getByText('Admin · ada@example.com')).toBeOnTheScreen();
    expect(screen.getByText('Offline')).toBeOnTheScreen();
  });

  it('marks a suspended teammate instead of their live routing status', async () => {
    await mount(
      api({
        listAgents: async () => [
          agent({ id: 'agent-1', suspended: true, routing_status: 'accepting_chats' }),
        ],
      }),
    );

    expect(await screen.findByText('Suspended')).toBeOnTheScreen();
    expect(screen.queryByText('Online')).not.toBeOnTheScreen();
  });

  it('opens the teammate that was tapped', async () => {
    const { onOpenAgent } = await mount(
      api({
        listAgents: async () => [agent({ id: 'agent-7', name: 'Grace Hopper' })],
      }),
    );

    await fireEvent.press(await screen.findByTestId('team-row-agent-7'));

    expect(onOpenAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'agent-7', name: 'Grace Hopper' }),
    );
  });

  it('refetches the roster on pull-to-refresh', async () => {
    const listAgents = jest.fn(async (): Promise<Agent[]> => []);
    await mount(api({ listAgents }));
    listAgents.mockClear();

    await act(async () => {
      screen.getByTestId('team-list').props.refreshControl.props.onRefresh();
    });

    expect(listAgents).toHaveBeenCalled();
  });
});
