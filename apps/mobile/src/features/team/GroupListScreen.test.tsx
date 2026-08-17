import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { GroupListScreen } from './GroupListScreen';
import { TeamContext } from './context';
import type { TeamApi } from './api';
import type { Group } from './types';
import { ThemeProvider } from '../../theme/theme';

function group(overrides: Partial<Group> & { id: number }): Group {
  return {
    name: 'Support',
    language_code: 'en',
    agents: [],
    ...overrides,
  };
}

function api(overrides: Partial<TeamApi> = {}): TeamApi {
  return {
    listAgents: async () => [],
    getAgentWorkSchedule: async () => {
      throw new Error('not used by this screen');
    },
    listGroups: async () => [],
    ...overrides,
  };
}

async function mount(teamApi: TeamApi): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <TeamContext.Provider value={teamApi}>
        <GroupListScreen />
      </TeamContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('GroupListScreen', () => {
  it('says there are no groups rather than showing a blank rectangle', async () => {
    await mount(api());

    expect(await screen.findByText('No groups yet.')).toBeOnTheScreen();
  });

  it('says what went wrong when groups could not be loaded', async () => {
    await mount(
      api({
        listGroups: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('lists groups with their member count and language', async () => {
    await mount(
      api({
        listGroups: async () => [
          group({
            id: 1,
            name: 'Support',
            language_code: 'en',
            agents: [
              { agent_id: 'agent-1', priority: 'normal' },
              { agent_id: 'agent-2', priority: 'first' },
            ],
          }),
        ],
      }),
    );

    expect(await screen.findByText('Support')).toBeOnTheScreen();
    expect(screen.getByText('2 members · en')).toBeOnTheScreen();
  });

  it('uses the singular for a single member', async () => {
    await mount(
      api({
        listGroups: async () => [
          group({
            id: 1,
            name: 'Escalations',
            agents: [{ agent_id: 'agent-1', priority: 'primary' }],
          }),
        ],
      }),
    );

    expect(await screen.findByText('1 member · en')).toBeOnTheScreen();
  });
});
