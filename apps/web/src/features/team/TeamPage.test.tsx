/**
 * Teammates search + filters (FR-MOD-04.3.2).
 *
 * The roster table already showed role/availability/2FA — this covers the
 * controls that were missing: a debounced name/email search plus role,
 * availability and 2FA dropdowns, all client-side (the roster arrives on one
 * `GET /agents` request, no server-side query params to drive). A filtered
 * result of zero must read differently from an actually-empty roster.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TeamPage } from './TeamPage.js';
import { useAuth } from '../../lib/auth-store.js';

/**
 * The roster table only — `WorkSchedule.tsx` further down the page renders
 * every teammate's name a second time as an `<option>` in its own picker, so
 * an unscoped `getByText` collides on any fixture with more than one agent.
 */
function rosterTable(): HTMLElement {
  return screen.getByRole('table', { name: 'Agents on this licence' });
}

interface AgentFixture {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: 'owner' | 'viceowner' | 'admin' | 'agent';
  routing_status: 'accepting_chats' | 'not_accepting_chats' | 'offline';
  concurrent_chats_limit: number;
  two_factor_enabled: boolean;
  suspended: boolean;
  expertise: unknown[];
}

function agent(id: string, over: Partial<AgentFixture> = {}): AgentFixture {
  return {
    id,
    name: id,
    email: `${id.toLowerCase()}@acme.localhost`,
    avatar_url: null,
    role: 'agent',
    routing_status: 'accepting_chats',
    concurrent_chats_limit: 5,
    two_factor_enabled: false,
    suspended: false,
    expertise: [],
    ...over,
  };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function stubRoster(items: AgentFixture[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/agents?status=suspended')) return jsonResponse({ items: [] });
      if (url.includes('/agents')) return jsonResponse({ items });
      if (url.includes('/ai-agents')) return jsonResponse({ items: [] });
      if (url.includes('/groups')) return jsonResponse({ items: [] });
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TeamPage />
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Teammates search + filters (FR-MOD-04.3.2)', () => {
  it('search filters the roster by name or email once the debounce settles', async () => {
    stubRoster([agent('A1', { name: 'Alex Moreau' }), agent('A2', { name: 'Mira Haddad' })]);
    renderPage();

    await screen.findByRole('table', { name: 'Agents on this licence' });
    expect(within(rosterTable()).getByText('Alex Moreau')).toBeInTheDocument();
    expect(within(rosterTable()).getByText('Mira Haddad')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search teammates' }), {
      target: { value: 'mira' },
    });

    await waitFor(() => {
      expect(within(rosterTable()).queryByText('Alex Moreau')).not.toBeInTheDocument();
    });
    expect(within(rosterTable()).getByText('Mira Haddad')).toBeInTheDocument();
  });

  it('the role filter narrows the roster to the selected role', async () => {
    stubRoster([
      agent('A1', { name: 'Alex Moreau', role: 'admin' }),
      agent('A2', { name: 'Mira Haddad', role: 'agent' }),
    ]);
    renderPage();

    await screen.findByRole('table', { name: 'Agents on this licence' });
    fireEvent.change(screen.getByLabelText('Filter by role'), { target: { value: 'admin' } });

    await waitFor(() => {
      expect(within(rosterTable()).queryByText('Mira Haddad')).not.toBeInTheDocument();
    });
    expect(within(rosterTable()).getByText('Alex Moreau')).toBeInTheDocument();
  });

  it('the availability filter narrows the roster by routing status', async () => {
    stubRoster([
      agent('A1', { name: 'Alex Moreau', routing_status: 'accepting_chats' }),
      agent('A2', { name: 'Mira Haddad', routing_status: 'offline' }),
    ]);
    renderPage();

    await screen.findByRole('table', { name: 'Agents on this licence' });
    fireEvent.change(screen.getByLabelText('Filter by availability'), {
      target: { value: 'offline' },
    });

    await waitFor(() => {
      expect(within(rosterTable()).queryByText('Alex Moreau')).not.toBeInTheDocument();
    });
    expect(within(rosterTable()).getByText('Mira Haddad')).toBeInTheDocument();
  });

  it('the 2FA filter narrows the roster by two-factor state', async () => {
    stubRoster([
      agent('A1', { name: 'Alex Moreau', two_factor_enabled: true }),
      agent('A2', { name: 'Mira Haddad', two_factor_enabled: false }),
    ]);
    renderPage();

    await screen.findByRole('table', { name: 'Agents on this licence' });
    fireEvent.change(screen.getByLabelText('Filter by 2FA'), { target: { value: 'on' } });

    await waitFor(() => {
      expect(within(rosterTable()).queryByText('Mira Haddad')).not.toBeInTheDocument();
    });
    expect(within(rosterTable()).getByText('Alex Moreau')).toBeInTheDocument();
  });

  it('an empty filtered result shows the no-matches empty state, not the no-teammates one', async () => {
    stubRoster([agent('A1', { name: 'Alex Moreau' })]);
    renderPage();

    await screen.findByRole('table', { name: 'Agents on this licence' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search teammates' }), {
      target: { value: 'zzz-no-match' },
    });

    await waitFor(() => {
      expect(screen.getByText('No teammates match')).toBeInTheDocument();
    });
    expect(screen.queryByText('No teammates yet')).not.toBeInTheDocument();
  });
});
