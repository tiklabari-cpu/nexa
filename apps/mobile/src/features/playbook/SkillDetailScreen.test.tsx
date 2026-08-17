import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { SkillDetailScreen } from './SkillDetailScreen';
import { PlaybookContext } from './context';
import type { PlaybookApi } from './api';
import type { SkillDetail, SkillRun } from './types';
import { ThemeProvider } from '../../theme/theme';

function skill(overrides: Partial<SkillDetail> = {}): SkillDetail {
  return {
    id: 'skill-1',
    ai_agent_id: null,
    name: 'Password reset',
    kind: 'workspace',
    instruction: 'Ask for the account email, then send the reset link.',
    steps: [{ type: 'send_message', source: 'text', text: 'Here is your reset link.' }],
    active: true,
    runs_count: 4,
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<SkillRun> & { id: string }): SkillRun {
  return {
    chat_id: null,
    status: 'succeeded',
    outcome: 'answered',
    ran_at: '2026-08-01T00:00:00.000Z',
    log: [],
    ...overrides,
  };
}

function api(overrides: Partial<PlaybookApi> = {}): PlaybookApi {
  return {
    listSkills: async () => [],
    getSkill: async () => skill(),
    listSkillRuns: async () => [],
    listKnowledgeSources: async () => [],
    ...overrides,
  };
}

async function mount(playbookApi: PlaybookApi, skillId = 'skill-1'): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <PlaybookContext.Provider value={playbookApi}>
        <SkillDetailScreen skillId={skillId} />
      </PlaybookContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('SkillDetailScreen', () => {
  it('shows a loading skeleton before the skill arrives', async () => {
    let resolve: (value: SkillDetail) => void = () => {};
    const pending = new Promise<SkillDetail>((r) => {
      resolve = r;
    });

    const tree: ReactElement = (
      <ThemeProvider>
        <PlaybookContext.Provider value={api({ getSkill: async () => pending })}>
          <SkillDetailScreen skillId="skill-1" />
        </PlaybookContext.Provider>
      </ThemeProvider>
    );
    await render(tree);

    expect(screen.getByTestId('skill-detail-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve(skill());
    });
  });

  it('shows the skill fields', async () => {
    await mount(
      api({
        getSkill: async () => skill({ name: 'Password reset', active: true }),
      }),
    );

    expect(await screen.findByText('Password reset')).toBeOnTheScreen();
    expect(screen.getByText('Active')).toBeOnTheScreen();
    expect(screen.getByText(/Workspace skill/)).toBeOnTheScreen();
    expect(
      screen.getByText('Ask for the account email, then send the reset link.'),
    ).toBeOnTheScreen();
  });

  it('marks an inactive skill', async () => {
    await mount(api({ getSkill: async () => skill({ active: false }) }));

    expect(await screen.findByText('Inactive')).toBeOnTheScreen();
  });

  it('says there is no instruction rather than an empty card', async () => {
    await mount(api({ getSkill: async () => skill({ instruction: null }) }));

    expect(
      await screen.findByText('No instruction on file — built from steps directly.'),
    ).toBeOnTheScreen();
  });

  it('says what went wrong when the skill could not be loaded', async () => {
    await mount(
      api({
        getSkill: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('shows a loading state before the run history arrives', async () => {
    let resolve: (value: SkillRun[]) => void = () => {};
    const pending = new Promise<SkillRun[]>((r) => {
      resolve = r;
    });

    const tree: ReactElement = (
      <ThemeProvider>
        <PlaybookContext.Provider value={api({ listSkillRuns: async () => pending })}>
          <SkillDetailScreen skillId="skill-1" />
        </PlaybookContext.Provider>
      </ThemeProvider>
    );
    await render(tree);

    expect(await screen.findByTestId('skill-detail-runs-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve([]);
    });
  });

  it('says the skill has not run yet, rather than showing an empty list', async () => {
    await mount(api({ listSkillRuns: async () => [] }));

    expect(await screen.findByText('This skill has not run yet.')).toBeOnTheScreen();
  });

  it('lists recent runs with their outcome', async () => {
    await mount(
      api({
        listSkillRuns: async () => [
          run({ id: 'run-1', status: 'succeeded', outcome: 'answered' }),
          run({ id: 'run-2', status: 'failed', outcome: null }),
        ],
      }),
    );

    expect(await screen.findByText('Succeeded')).toBeOnTheScreen();
    expect(screen.getByText('Failed')).toBeOnTheScreen();
    expect(screen.getByText('answered')).toBeOnTheScreen();
  });

  it('says what went wrong when runs could not be loaded', async () => {
    await mount(
      api({
        listSkillRuns: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findAllByText('Could not reach the server.')).not.toHaveLength(0);
  });
});
