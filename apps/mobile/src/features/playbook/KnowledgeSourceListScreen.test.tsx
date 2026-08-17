import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { KnowledgeSourceListScreen } from './KnowledgeSourceListScreen';
import { PlaybookContext } from './context';
import type { PlaybookApi } from './api';
import type { KnowledgeSource } from './types';
import { ThemeProvider } from '../../theme/theme';

function source(overrides: Partial<KnowledgeSource> & { id: string }): KnowledgeSource {
  return {
    ai_agent_id: 'ai-agent-1',
    name: 'Refund policy',
    type: 'article',
    status: 'ready',
    source_url: null,
    chunk_count: 12,
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
    listKnowledgeSources: async () => [],
    ...overrides,
  };
}

async function mount(playbookApi: PlaybookApi): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <PlaybookContext.Provider value={playbookApi}>
        <KnowledgeSourceListScreen />
      </PlaybookContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('KnowledgeSourceListScreen', () => {
  it('says there are no sources rather than showing a blank rectangle', async () => {
    await mount(api());

    expect(await screen.findByText('No knowledge sources yet.')).toBeOnTheScreen();
  });

  it('says what went wrong when sources could not be loaded', async () => {
    await mount(
      api({
        listKnowledgeSources: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('lists sources with their type, chunk count and status', async () => {
    await mount(
      api({
        listKnowledgeSources: async () => [
          source({ id: 'src-1', name: 'Refund policy', type: 'article', chunk_count: 12 }),
        ],
      }),
    );

    expect(await screen.findByText('Refund policy')).toBeOnTheScreen();
    expect(screen.getByText('article · 12 chunks · ready')).toBeOnTheScreen();
  });

  it('uses the singular for a single chunk', async () => {
    await mount(
      api({
        listKnowledgeSources: async () => [source({ id: 'src-1', chunk_count: 1 })],
      }),
    );

    expect(await screen.findByText(/1 chunk ·/)).toBeOnTheScreen();
  });
});
