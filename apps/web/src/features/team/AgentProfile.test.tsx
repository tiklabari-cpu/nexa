/**
 * The teammate profile panel (FR-MOD-04.3.4).
 *
 * Two things are worth pinning here rather than leaving to review. The panel
 * must actually carry the PRD's fields — the audit's finding was that they had
 * been scattered across roster columns and two of them ("last seen", "Chatting
 * teams") did not exist at all. And the editable limit must be *absent*, not
 * merely disabled, for a viewer the server would refuse: the server is the
 * authority either way, but an agent who can see a control to restaff a
 * colleague has been told something untrue about their own permissions.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AgentProfile, type ProfileAgent } from './AgentProfile.js';
import type { Group } from './Teams.js';
import { useAuth } from '../../lib/auth-store.js';

function profileAgent(over: Partial<ProfileAgent> = {}): ProfileAgent {
  return {
    id: 'a-2',
    name: 'Mira Haddad',
    email: 'mira@acme.localhost',
    role: 'agent',
    concurrent_chats_limit: 6,
    last_seen_at: null,
    ...over,
  };
}

function group(over: Partial<Group> = {}): Group {
  return {
    id: 1,
    name: 'Support',
    language_code: 'en',
    agents: [{ agent_id: 'a-2', priority: 'normal' }],
    ...over,
  };
}

function renderProfile(props: Partial<Parameters<typeof AgentProfile>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AgentProfile
          agent={profileAgent()}
          teams={[group()]}
          isSelf={false}
          canEdit={false}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPanel(name = 'Mira Haddad'): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: `Profile — ${name}` }));
  return screen.getByRole('dialog', { name: `Profile — ${name}` });
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

describe('teammate profile panel (FR-MOD-04.3.4)', () => {
  it('opens from the name and carries the fields the PRD names', async () => {
    renderProfile({ agent: profileAgent({ last_seen_at: '2026-09-04T09:30:00.000Z' }) });

    const dialog = await openPanel();
    expect(within(dialog).getByText('Role')).toBeInTheDocument();
    expect(within(dialog).getByText('Agent')).toBeInTheDocument();
    expect(within(dialog).getByText('Email')).toBeInTheDocument();
    expect(within(dialog).getByText('mira@acme.localhost')).toBeInTheDocument();
    expect(within(dialog).getByText('Last seen')).toBeInTheDocument();
    expect(within(dialog).getByText('Concurrent chats limit')).toBeInTheDocument();
    // "Chatting teams" is read off the team list the page already holds.
    expect(within(dialog).getByText('Chatting teams')).toBeInTheDocument();
    expect(within(dialog).getByText('Support')).toBeInTheDocument();
  });

  it('reads "Never" for someone who has not been stamped yet', async () => {
    // The distinction the audit's D4 "dead column" finding is about: an empty
    // cell reads as a rendering bug, "Never" reads as a fact.
    renderProfile({ agent: profileAgent({ last_seen_at: null }) });

    const dialog = await openPanel();
    expect(within(dialog).getByText('Never')).toBeInTheDocument();
  });

  it('shows a last-seen timestamp when there is one', async () => {
    renderProfile({ agent: profileAgent({ last_seen_at: '2026-09-04T09:30:00.000Z' }) });

    const dialog = await openPanel();
    expect(within(dialog).queryByText('Never')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/2026/)).toBeInTheDocument();
  });

  it('names only the teams this agent is actually in', async () => {
    renderProfile({
      teams: [
        group(),
        group({ id: 2, name: 'Sales', agents: [{ agent_id: 'someone-else', priority: 'normal' }] }),
      ],
    });

    const dialog = await openPanel();
    expect(within(dialog).getByText('Support')).toBeInTheDocument();
    expect(within(dialog).queryByText('Sales')).not.toBeInTheDocument();
  });

  it('says so plainly when the agent is in no team', async () => {
    renderProfile({ teams: [] });

    const dialog = await openPanel();
    expect(within(dialog).getByText('Not in any team yet.')).toBeInTheDocument();
  });

  it('hides the limit control — and shows the number read-only — for a viewer who may not edit', async () => {
    renderProfile({ canEdit: false });

    const dialog = await openPanel();
    expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save limit' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('6')).toBeInTheDocument();
  });

  it('saves a new limit through the endpoint routing reads', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({}),
        }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);
    renderProfile({ canEdit: true });

    const dialog = await openPanel();
    const field = within(dialog).getByRole('spinbutton', { name: 'Concurrent chats limit' });
    await userEvent.clear(field);
    await userEvent.type(field, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save limit' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/agents/a-2/chat-limit');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ concurrent_chats_limit: 3 });
  });

  it('refuses a limit outside the range the server enforces, without a request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderProfile({ canEdit: true });

    const dialog = await openPanel();
    const field = within(dialog).getByRole('spinbutton', { name: 'Concurrent chats limit' });
    await userEvent.clear(field);
    await userEvent.type(field, '99');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save limit' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Enter a whole number from 1 to 50.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('links to Settings for your own profile, and offers no such link for someone else', async () => {
    const { unmount } = renderProfile({ isSelf: true });
    const own = await openPanel();
    expect(within(own).getByRole('link', { name: 'Manage profile' })).toHaveAttribute(
      'href',
      '/app/settings',
    );
    unmount();

    renderProfile({ isSelf: false });
    const other = await openPanel();
    expect(within(other).queryByRole('link', { name: 'Manage profile' })).not.toBeInTheDocument();
  });
});
