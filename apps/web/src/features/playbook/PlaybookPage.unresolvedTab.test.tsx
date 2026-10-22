/**
 * The AI Agent page's Unresolved questions tab (tm 317.3 · AI-22): beside
 * Performance, drawn for whoever may read the AI's configuration, acting only
 * with `agents-bot--all:rw`, and absent for a team member ("Ekip Üyesi: yok"),
 * who has neither scope in the default matrix.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { AiAgent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const AGENT: AiAgent = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Ada',
  kind: 'ai_agent',
  tone: null,
  avatar_url: null,
  languages: ['tr'],
  answer_length: null,
  batch_window_seconds: null,
  active: true,
  skills_count: 0,
};

function signIn(scopes: string[], role = 'owner'): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: 'accepting_chats',
    },
  } as never);
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PlaybookPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/ai-agents') return Promise.resolve({ items: [AGENT] });
    if (path.startsWith('/ai/unresolved/clusters?')) {
      return Promise.resolve({ clusters: [], total: 0, unclustered_count: 0, spike_threshold: 20 });
    }
    if (path === '/ai/unresolved/settings') {
      return Promise.resolve({
        spike_threshold: 20,
        default_threshold: 20,
        window_minutes: 60,
        min_threshold: 5,
        max_threshold: 1000,
      });
    }
    return Promise.resolve({ items: [] });
  });
});

describe('the Unresolved questions tab (AI-22)', () => {
  it('sits next to Performance and opens the report for whoever configures the AI', async () => {
    const user = userEvent.setup();
    signIn(['agents-bot--all:rw']);
    renderPage();

    const tabs = (await screen.findAllByRole('tab')).map((tab) => tab.textContent);
    expect(tabs.indexOf('Unresolved questions')).toBe(tabs.indexOf('Performance') + 1);

    await user.click(screen.getByRole('tab', { name: 'Unresolved questions' }));

    expect(await screen.findByTestId('ai-unresolved')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      `/ai/unresolved/clusters?ai_agent_id=${AGENT.id}&status=open&sort=count_7d`,
    );
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('is read-only for a reader of the configuration', async () => {
    const user = userEvent.setup();
    signIn(['agents-bot--all:ro'], 'admin');
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Unresolved questions' }));

    expect(await screen.findByTestId('ai-unresolved')).toBeInTheDocument();
    expect(await screen.findByLabelText('Messages in an hour')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('is not there for a team member, who may read neither', async () => {
    signIn([], 'agent');
    renderPage();

    expect(await screen.findByRole('tab', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Unresolved questions' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/ai\/unresolved\//));
  });
});
