/**
 * Team → AI agents, the page shell around the chatbots table, AI performance
 * and Copilot knowledge sections (FR-MOD-04.1).
 *
 * `TeamAiPerformance.test.tsx` and `CopilotKnowledge.test.tsx` already cover
 * those two components in isolation; this only proves the seam this task
 * added — the page renders the shared "Team" title, its own description, the
 * chatbots table this file now owns, and the tab bar with AI agents marked
 * current.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TeamAiAgentsPage } from './TeamAiAgentsPage.js';
import { useAuth } from '../../lib/auth-store.js';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/team/ai-agents']}>
        <TeamAiAgentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/ai-agents')) {
        return jsonResponse({
          items: [{ id: 'bot-1', name: 'Nova', active: true, avatar_url: null, skills_count: 3 }],
        });
      }
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({
          error: { type: 'not_found', message: 'Not found.', request_id: '-' },
        }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Team module navigation (FR-MOD-04.1)', () => {
  it('renders the shared Team title, its own description, and AI agents marked current', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Team', level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText('Bot accounts, how the AI is performing, and what Copilot may draw on.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI agents' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders the chatbots table this page now owns', async () => {
    renderPage();

    const table = await screen.findByRole('table', { name: 'Bot accounts on this licence' });
    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(table).toBeInTheDocument();
  });
});
