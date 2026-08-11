/**
 * Team-side AI agents (FR-MOD-04.2): the per-agent roster is drawn from the AI
 * agents list, the Copilot bot row is left out (it is managed by its knowledge
 * base, not opened here), and the performance cards are the reused 06.5 surface
 * — gated on the reports permission and honest about too-few-chats / AI-off.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn() },
  auth: { scopes: [] as string[] },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: auth.scopes } }),
  };
});

const { TeamAiPerformance } = await import('./TeamAiPerformance.js');

const AGENTS = {
  items: [
    {
      id: 'a1',
      name: 'Nova',
      kind: 'ai_agent',
      tone: null,
      avatar_url: null,
      languages: [],
      answer_length: null,
      active: true,
      skills_count: 3,
    },
    {
      id: 'a2',
      name: 'Echo',
      kind: 'ai_agent',
      tone: null,
      avatar_url: null,
      languages: [],
      answer_length: null,
      active: false,
      skills_count: 1,
    },
    // Copilot rides on a row of its own; it must not appear in this roster.
    {
      id: 'c1',
      name: 'Copilot',
      kind: 'copilot',
      tone: null,
      avatar_url: null,
      languages: [],
      answer_length: null,
      active: true,
      skills_count: 0,
    },
  ],
};

const REPORT = {
  resolutions: 40,
  resolution_rate: 0.8,
  transfers: 10,
  transfer_rate: 0.2,
  skill_runs: 5,
  avg_automated_duration_seconds: null,
};

const OVERVIEW = { satisfaction: { score: 0.9, responses: 60 } };

function mockApi(over: { agents?: typeof AGENTS } = {}): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/ai-agents') return Promise.resolve(over.agents ?? AGENTS);
    if (path === '/reports/ai-agent') return Promise.resolve(REPORT);
    if (path === '/reports/overview') return Promise.resolve(OVERVIEW);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderTeamPerf(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  auth.scopes = [];
});

describe('TeamAiPerformance', () => {
  it('lists the customer-facing agents and leaves Copilot out of the roster', async () => {
    auth.scopes = ['reports_read'];
    mockApi();
    renderTeamPerf(<TeamAiPerformance />);

    expect(await screen.findByText('Nova')).toBeInTheDocument();
    expect(screen.getByText('Echo')).toBeInTheDocument();
    // The copilot-kind row is not something you open here.
    expect(screen.queryByText('Copilot')).not.toBeInTheDocument();
  });

  it('shows the reused performance cards when the caller may read reports', async () => {
    auth.scopes = ['reports_read'];
    mockApi();
    renderTeamPerf(<TeamAiPerformance />);

    expect(await screen.findByText('Resolution rate')).toBeInTheDocument();
    expect(screen.getByText('CSAT')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('links each agent to the Playbook, where it is managed per agent', async () => {
    auth.scopes = ['reports_read'];
    mockApi();
    renderTeamPerf(<TeamAiPerformance />);

    await screen.findByText('Nova');
    const links = screen.getAllByRole('link', { name: 'Open performance' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/app/playbook');
  });

  it('still shows the roster but withholds performance when reports are not permitted', async () => {
    auth.scopes = []; // no reports_read
    mockApi();
    renderTeamPerf(<TeamAiPerformance />);

    expect(await screen.findByText('Nova')).toBeInTheDocument();
    expect(screen.getByText('No access to performance')).toBeInTheDocument();
    // With no reports permission the report endpoints must not be hit.
    expect(api.get).not.toHaveBeenCalledWith('/reports/ai-agent');
  });

  it('labels the figures as historical when no agent is on', async () => {
    auth.scopes = ['reports_read'];
    mockApi({
      agents: {
        items: [
          {
            id: 'a2',
            name: 'Echo',
            kind: 'ai_agent',
            tone: null,
            avatar_url: null,
            languages: [],
            answer_length: null,
            active: false,
            skills_count: 1,
          },
        ],
      },
    });
    renderTeamPerf(<TeamAiPerformance />);

    expect(await screen.findByText(/historical figures/i)).toBeInTheDocument();
  });
});
