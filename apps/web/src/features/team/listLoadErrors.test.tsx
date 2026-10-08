/**
 * A failed list read is not an empty list (tm 259.6, audit O10).
 *
 * Teams, AI agents and the suspended-teammates list fell through to their
 * "nothing yet" empty state when the request failed — and the Teams one even
 * offered "New team" next to it, for a workspace that may already have eight.
 * Each list now has four states: loading, an alert with "Try again", empty, rows.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TeamAiAgentsPage } from './TeamAiAgentsPage.js';
import { TeamPage } from './TeamPage.js';
import { TeamsPage } from './TeamsPage.js';
import { useAuth } from '../../lib/auth-store.js';
import { resetLocale } from '../../test/i18n.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function failure(status = 500): Response {
  return jsonResponse(
    { error: { type: status === 500 ? 'internal' : 'not_found', message: 'x', request_id: '-' } },
    status,
  );
}

/** Routes by path; `broken` paths answer 500 until `heal()` is called. */
function stubApi(routes: Record<string, unknown>, broken: string[]): { heal: () => void } {
  let healed = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = Object.keys(routes).find((candidate) => url.includes(candidate));
      if (path === undefined) return failure(404);
      if (broken.includes(path) && !healed) return failure();
      return jsonResponse(routes[path]);
    }),
  );
  return {
    heal: () => {
      healed = true;
    },
  };
}

function renderIn(page: React.ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetLocale();
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
      scopes: ['groups--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Teams list', () => {
  it('says the read failed — no empty state, no New team button — and Try again refetches', async () => {
    const api = stubApi({ '/agents': { items: [] }, '/groups': { items: [] } }, ['/groups']);
    renderIn(<TeamsPage />);

    const title = await screen.findByText("Teams couldn't be loaded");
    expect(title.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText('No teams yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New team' })).not.toBeInTheDocument();

    api.heal();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
    expect(screen.queryByText("Teams couldn't be loaded")).not.toBeInTheDocument();
  });

  it('still shows the empty state, with the create button, for a 200 with no teams', async () => {
    stubApi({ '/agents': { items: [] }, '/groups': { items: [] } }, []);
    renderIn(<TeamsPage />);

    expect(await screen.findByText('No teams yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New team' })).toBeInTheDocument();
    expect(screen.queryByText("Teams couldn't be loaded")).not.toBeInTheDocument();
  });
});

describe('AI agents list', () => {
  it('says the read failed instead of "No chatbots yet", and Try again refetches', async () => {
    const api = stubApi(
      {
        '/ai-agents': {
          items: [{ id: 'bot-1', name: 'Nova', active: true, avatar_url: null, skills_count: 3 }],
        },
      },
      ['/ai-agents'],
    );
    renderIn(<TeamAiAgentsPage />);

    const title = await screen.findByText("AI agents couldn't be loaded");
    expect(title.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText('No chatbots yet')).not.toBeInTheDocument();

    api.heal();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Nova')).toBeInTheDocument();
    expect(screen.queryByText("AI agents couldn't be loaded")).not.toBeInTheDocument();
  });

  it('shows the empty state for a 200 with no chatbots', async () => {
    stubApi({ '/ai-agents': { items: [] } }, []);
    renderIn(<TeamAiAgentsPage />);

    expect(await screen.findByText('No chatbots yet')).toBeInTheDocument();
    expect(screen.queryByText("AI agents couldn't be loaded")).not.toBeInTheDocument();
  });
});

describe('Suspended teammates list', () => {
  const routes = {
    '/agents?status=suspended': {
      items: [
        {
          id: 'old-1',
          name: 'Olga Reyes',
          email: 'olga@acme.localhost',
          avatar_url: null,
          role: 'agent',
          routing_status: 'offline',
          concurrent_chats_limit: 5,
          two_factor_enabled: false,
          suspended: true,
          last_seen_at: null,
          expertise: [],
        },
      ],
    },
    '/agents': { items: [] },
    '/ai-agents': { items: [] },
    '/groups': { items: [] },
  };

  it('says the read failed instead of "Nobody is suspended", and Try again refetches', async () => {
    const api = stubApi(routes, ['/agents?status=suspended']);
    renderIn(<TeamPage />);

    const title = await screen.findByText("Suspended teammates couldn't be loaded");
    expect(title.closest('[role="alert"]')).not.toBeNull();
    expect(screen.queryByText('Nobody is suspended')).not.toBeInTheDocument();

    api.heal();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Olga Reyes')).toBeInTheDocument();
    expect(screen.queryByText("Suspended teammates couldn't be loaded")).not.toBeInTheDocument();
  });

  it('shows "Nobody is suspended" for a 200 with no one suspended', async () => {
    stubApi({ ...routes, '/agents?status=suspended': { items: [] } }, []);
    renderIn(<TeamPage />);

    await waitFor(() => expect(screen.getByText('Nobody is suspended')).toBeInTheDocument());
    expect(screen.queryByText("Suspended teammates couldn't be loaded")).not.toBeInTheDocument();
  });
});
