/**
 * The AI Agent page's Test tab (tm 314.5 · AI-19): drawn for whoever may read
 * the AI's configuration, writable only with `agents-bot--all:rw`, and absent
 * for a team member, who has neither scope in the default matrix.
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
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') return Promise.resolve({ items: [AGENT] });
    if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
    if (path.startsWith('/ai/test-scenarios?')) return Promise.resolve({ scenarios: [] });
    if (path.startsWith('/ai/test-runs?')) return Promise.resolve({ runs: [] });
    if (path.startsWith('/ai/compliance-pack?')) {
      return Promise.resolve({
        pack_version: '2026-10-21.1',
        scenarios: [],
        gate: {
          state: 'missing',
          open: false,
          run_id: null,
          run_pack_version: null,
          passed: 0,
          failed: 0,
          failing: [],
          workspace_failed: 0,
        },
      });
    }
    return Promise.resolve({ items: [] });
  });
});

describe('the Test tab (AI-19)', () => {
  it('is drawn for whoever configures the AI and opens the lab (FR-MOD-06.1)', async () => {
    const user = userEvent.setup();
    signIn(['agents-bot--all:rw']);
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Test' }));

    expect(await screen.findByRole('region', { name: 'Test lab' })).toBeInTheDocument();
    expect(screen.getByText('Publishing closed — no pre-publish run yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Talk like a player' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/ai/test-scenarios?ai_agent_id=${AGENT.id}`);
  });

  it('is drawn read-only for a reader of the configuration', async () => {
    const user = userEvent.setup();
    signIn(['agents-bot--all:ro'], 'admin');
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Test' }));

    expect(await screen.findByRole('region', { name: 'Test lab' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New scenario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pre-publish run' })).not.toBeInTheDocument();
  });

  it('is not there for a team member, who may read neither (FR-MOD-06.1)', async () => {
    signIn([], 'agent');
    renderPage();

    expect(await screen.findByRole('tab', { name: 'Skills' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Test' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringMatching(/^\/ai\/test-/));
  });
});
