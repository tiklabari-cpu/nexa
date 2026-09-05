/**
 * Team → Teams, the page shell around `Teams.tsx` (FR-MOD-04.1).
 *
 * `Teams.test.tsx` already covers the component's own behaviour in isolation;
 * this only proves the seam this task added — the page renders the shared
 * "Team" title, its own description, the tab bar with Teams marked current,
 * and passes a real roster down so `Teams.tsx` can resolve member names.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TeamsPage } from './TeamsPage.js';
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
      <MemoryRouter initialEntries={['/app/team/teams']}>
        <TeamsPage />
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
      scopes: ['groups--all:rw'],
      routing_status: 'accepting_chats',
    },
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/agents')) {
        return jsonResponse({ items: [{ id: 'a-1', name: 'Dana Okonkwo' }] });
      }
      if (url.includes('/groups')) {
        return jsonResponse({
          items: [{ id: 1, name: 'Support', language_code: 'en', agents: [] }],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Team module navigation (FR-MOD-04.1)', () => {
  it('renders the shared Team title, its own description, and Teams marked current', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Team', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Create teams and decide who is in each one.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Teams' })).toHaveAttribute('aria-current', 'page');
  });

  it('hands the roster down so Teams.tsx can resolve a member name', async () => {
    renderPage();

    expect(await screen.findByText('Support')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New team' })).toBeInTheDocument();
  });
});
