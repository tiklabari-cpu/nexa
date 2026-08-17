import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { SkillListScreen } from './SkillListScreen';
import { PlaybookContext } from './context';
import type { PlaybookApi } from './api';
import type { Skill } from './types';
import { ThemeProvider } from '../../theme/theme';

function skill(overrides: Partial<Skill> & { id: string }): Skill {
  return {
    ai_agent_id: null,
    name: 'Password reset',
    kind: 'workspace',
    instruction: null,
    steps: [],
    active: true,
    runs_count: 0,
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function api(overrides: Partial<PlaybookApi> = {}): PlaybookApi {
  return {
    listSkills: async () => [],
    getSkill: async () => {
      throw new Error('not used by this screen');
    },
    listSkillRuns: async () => {
      throw new Error('not used by this screen');
    },
    listKnowledgeSources: async () => {
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
  playbookApi: PlaybookApi,
  onOpenSkill = jest.fn(),
): Promise<{ onOpenSkill: jest.Mock }> {
  const tree: ReactElement = (
    <ThemeProvider>
      <PlaybookContext.Provider value={playbookApi}>
        <SkillListScreen onOpenSkill={onOpenSkill} />
      </PlaybookContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
  return { onOpenSkill };
}

describe('SkillListScreen', () => {
  it('says there are no skills rather than showing a blank rectangle', async () => {
    await mount(api());

    expect(await screen.findByText('No skills yet.')).toBeOnTheScreen();
  });

  it('says what went wrong when skills could not be loaded', async () => {
    await mount(
      api({
        listSkills: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('lists skills with their status and run count', async () => {
    await mount(
      api({
        listSkills: async () => [
          skill({ id: 'skill-1', name: 'Password reset', active: false, runs_count: 3 }),
        ],
      }),
    );

    expect(await screen.findByText('Password reset')).toBeOnTheScreen();
    expect(screen.getByText('Inactive')).toBeOnTheScreen();
    expect(screen.getByText(/3 runs/)).toBeOnTheScreen();
  });

  it('uses the singular for a single run', async () => {
    await mount(
      api({
        listSkills: async () => [skill({ id: 'skill-1', runs_count: 1 })],
      }),
    );

    expect(await screen.findByText(/1 run(?!s)/)).toBeOnTheScreen();
  });

  it('opens the skill that was tapped', async () => {
    const { onOpenSkill } = await mount(
      api({
        listSkills: async () => [skill({ id: 'skill-7', name: 'Refund lookup' })],
      }),
    );

    await fireEvent.press(await screen.findByTestId('skill-row-skill-7'));

    expect(onOpenSkill).toHaveBeenCalledWith({ skillId: 'skill-7', title: 'Refund lookup' });
  });

  it('refetches the list on pull-to-refresh', async () => {
    const listSkills = jest.fn(async (): Promise<Skill[]> => []);
    await mount(api({ listSkills }));
    listSkills.mockClear();

    await act(async () => {
      screen.getByTestId('skill-list').props.refreshControl.props.onRefresh();
    });

    expect(listSkills).toHaveBeenCalled();
  });
});
