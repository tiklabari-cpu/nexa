/**
 * Team and customer destructive actions ask first (tm 259.8, UX audit Y3 + Y4 + D19).
 *
 * Suspending a teammate, deleting a team, removing a member, revoking an
 * invitation, banning a customer, deleting a rule bot / rule and deleting a
 * Copilot source all fired on one click. Each now opens the shared
 * `ConfirmDialog`: no request leaves until the danger button is pressed, Cancel
 * and Escape send nothing, the confirmed click sends exactly one. Suspension,
 * invitation revoke and ban also had no error path — a refused write left the
 * screen looking as if it had worked — so each shows an inline `role="alert"`.
 *
 * Everything goes through a stubbed `fetch`, so the assertion is on the wire:
 * the list of non-GET requests the screen made.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { CopilotKnowledge } from './CopilotKnowledge.js';
import { PendingInvitations } from './InviteTeammates.js';
import { RuleBots } from './RuleBots.js';
import { TeamPage } from './TeamPage.js';
import { Teams, type Group } from './Teams.js';
import { CustomersPage } from '../customers/CustomersPage.js';
import { useAuth } from '../../lib/auth-store.js';
import { resetLocale } from '../../test/i18n.js';

interface Reply {
  status?: number;
  body?: unknown;
}

/** The non-GET requests the screen made, as `"PUT /agents/a-2/suspension"`. */
let writes: string[] = [];
/** Overrides, matched by `"METHOD path"` substring before the fixtures. */
let refused: Record<string, Reply> = {};

function response({ status = 200, body }: Reply): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const SERVER_ERROR: Reply = {
  status: 500,
  body: { error: { type: 'internal', message: 'x', request_id: '-' } },
};

function stubApi(reads: (path: string) => unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\/v1/, '');
      if (method !== 'GET') {
        writes.push(`${method} ${path}`);
        const key = Object.keys(refused).find((candidate) =>
          `${method} ${path}`.includes(candidate),
        );
        if (key !== undefined) return response(refused[key]!);
        return response({ status: 204 });
      }
      return response({ body: reads(path) ?? { items: [] } });
    }),
  );
}

function renderIn(ui: ReactElement, path = '/'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function signIn(scopes: string[]): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'me',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: 'accepting_chats',
    },
  });
}

beforeEach(() => {
  resetLocale();
  writes = [];
  refused = {};
  signIn([
    'groups--all:rw',
    'accounts--all:rw',
    'agents--all:rw',
    'agents-bot--all:rw',
    'customers:rw',
    'customers.ban:rw',
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function agentRow(id: string, name: string, over: Record<string, unknown> = {}): unknown {
  return {
    id,
    name,
    email: `${id}@acme.localhost`,
    avatar_url: null,
    role: 'agent',
    routing_status: 'accepting_chats',
    concurrent_chats_limit: 5,
    two_factor_enabled: false,
    suspended: false,
    last_seen_at: null,
    expertise: [],
    ...over,
  };
}

// --- Suspension (Y4) ------------------------------------------------------------

describe('suspending a teammate', () => {
  function stubRoster(): void {
    stubApi((path) => {
      if (path.includes('/agents?status=suspended')) {
        return { items: [agentRow('sam', 'Sam Rivera', { suspended: true })] };
      }
      if (path.includes('/agents')) {
        return {
          items: [
            agentRow('me', 'Dana Okonkwo', { role: 'owner' }),
            agentRow('mira', 'Mira Haddad'),
          ],
        };
      }
      return undefined;
    });
  }

  it('asks first, names the consequence, and sends one request on confirm', async () => {
    stubRoster();
    const user = userEvent.setup();
    renderIn(<TeamPage />);

    await user.click(await screen.findByRole('button', { name: 'Suspend' }));

    const dialog = screen.getByRole('dialog', { name: 'Suspend Mira Haddad?' });
    expect(writes).toEqual([]);
    // The sentence says what suspension does — the Suspended section's own language.
    expect(dialog).toHaveTextContent('cannot sign in');
    expect(dialog).toHaveTextContent('take chats');
    expect(dialog).toHaveTextContent('reinstate');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));

    await waitFor(() => expect(writes).toEqual(['PUT /agents/mira/suspension']));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Cancel and Escape send nothing', async () => {
    stubRoster();
    const user = userEvent.setup();
    renderIn(<TeamPage />);

    await user.click(await screen.findByRole('button', { name: 'Suspend' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(writes).toEqual([]);
  });

  it('shows an alert when the server refuses, and the roster stays', async () => {
    stubRoster();
    refused = { 'PUT /agents/mira/suspension': SERVER_ERROR };
    const user = userEvent.setup();
    renderIn(<TeamPage />);

    await user.click(await screen.findByRole('button', { name: 'Suspend' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Suspend' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Mira Haddad');
    expect(alert).toHaveTextContent('could not be suspended');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Still on the roster, still suspendable — nothing pretends it worked.
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeEnabled();
  });

  it('reinstating asks nothing (it is the safe direction) but a refusal still shows', async () => {
    stubRoster();
    refused = { 'PUT /agents/sam/suspension': SERVER_ERROR };
    const user = userEvent.setup();
    renderIn(<TeamPage />);

    await user.click(await screen.findByRole('button', { name: 'Reinstate' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sam Rivera');
    expect(alert).toHaveTextContent('could not be reinstated');
  });
});

// --- Teams (Y3) -------------------------------------------------------------------

const SUPPORT: Group = {
  id: 1,
  name: 'Support',
  language_code: 'en',
  agents: [{ agent_id: 'agent-1', priority: 'primary' }],
};

const TEAM_AGENTS = [
  { id: 'agent-1', name: 'Sam Rivera' },
  { id: 'agent-2', name: 'Mira Haddad' },
];

describe('deleting a team', () => {
  async function openEditor(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    stubApi((path) => (path.startsWith('/groups') ? { items: [SUPPORT] } : undefined));
    renderIn(<Teams agents={TEAM_AGENTS} canManage />);
    await user.click(await screen.findByRole('button', { name: /Edit team/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete team' }));
  }

  it('asks first, and only the confirmed click deletes', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    const dialog = screen.getByRole('dialog', { name: 'Delete team “Support”?' });
    expect(writes).toEqual([]);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(writes).toEqual(['DELETE /groups/1']));
  });

  it('Escape closes the question, not the editor behind it', async () => {
    const user = userEvent.setup();
    await openEditor(user);

    await user.keyboard('{Escape}');

    expect(
      screen.queryByRole('dialog', { name: 'Delete team “Support”?' }),
    ).not.toBeInTheDocument();
    // The editor is still there, with its Delete button to try again.
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it('shows the refusal inside the editor when the team is in use', async () => {
    refused = {
      'DELETE /groups/1': {
        status: 409,
        body: { error: { type: 'group_in_use', message: 'x', request_id: '-' } },
      },
    };
    const user = userEvent.setup();
    await openEditor(user);

    await user.click(
      within(screen.getByRole('dialog', { name: 'Delete team “Support”?' })).getByRole('button', {
        name: 'Delete',
      }),
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(
      screen.queryByRole('dialog', { name: 'Delete team “Support”?' }),
    ).not.toBeInTheDocument();
  });
});

describe('removing a member from a team', () => {
  it('asks first, naming the person and the team', async () => {
    stubApi((path) => (path.startsWith('/groups') ? { items: [SUPPORT] } : undefined));
    const user = userEvent.setup();
    renderIn(<Teams agents={TEAM_AGENTS} canManage />);

    await user.click(await screen.findByRole('button', { name: /Manage members/ }));
    await user.click(
      await screen.findByRole('button', { name: 'Remove Sam Rivera from this team' }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Remove Sam Rivera from Support?' });
    expect(writes).toEqual([]);
    expect(dialog).toHaveTextContent('keeps their account');

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(writes).toEqual(['DELETE /groups/1/agents/agent-1']));
  });

  it('Escape closes the question only', async () => {
    stubApi((path) => (path.startsWith('/groups') ? { items: [SUPPORT] } : undefined));
    const user = userEvent.setup();
    renderIn(<Teams agents={TEAM_AGENTS} canManage />);

    await user.click(await screen.findByRole('button', { name: /Manage members/ }));
    await user.click(
      await screen.findByRole('button', { name: 'Remove Sam Rivera from this team' }),
    );
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toHaveAccessibleName(/members/i);
    expect(writes).toEqual([]);
  });
});

// --- Invitations (Y3) ---------------------------------------------------------------

describe('revoking an invitation', () => {
  const INVITES = {
    items: [
      {
        id: 'inv-1',
        email: 'new@acme.localhost',
        role: 'agent',
        invited_by_name: 'Dana',
        created_at: '2026-10-01T00:00:00.000Z',
      },
    ],
    seats: { headcount: 3, purchased: null, unit_price_cents: null, ceiling: 200 },
  };

  it('asks first, and the confirmed click revokes once', async () => {
    stubApi((path) => (path.startsWith('/invitations') ? INVITES : undefined));
    const user = userEvent.setup();
    renderIn(<PendingInvitations />);

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    const dialog = screen.getByRole('dialog', {
      name: 'Revoke the invitation to new@acme.localhost?',
    });
    expect(writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(writes).toEqual(['DELETE /invitations/inv-1']));
  });

  it('shows an alert when the revoke is refused', async () => {
    stubApi((path) => (path.startsWith('/invitations') ? INVITES : undefined));
    refused = { 'DELETE /invitations/inv-1': SERVER_ERROR };
    const user = userEvent.setup();
    renderIn(<PendingInvitations />);

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('new@acme.localhost');
    expect(alert).toHaveTextContent('could not be revoked');
    // The row is still there: the invitation is still live.
    expect(screen.getByText('new@acme.localhost')).toBeInTheDocument();
  });
});

// --- Rule bots and Copilot sources (Y3) ----------------------------------------------

describe('deleting a rule bot, a rule, or a Copilot source', () => {
  const BOTS = {
    items: [
      {
        id: 'bot-1',
        name: 'FAQ bot',
        enabled: true,
        groups: [],
        rules: [
          {
            id: 'rule-1',
            name: 'Opening hours',
            conditions: { message_word: 'hours' },
            actions: { send_message: 'Nine to six.' },
            enabled: true,
            position: 0,
          },
        ],
      },
    ],
  };

  function stubBots(): void {
    stubApi((path) => {
      if (path.startsWith('/settings/bots')) return BOTS;
      if (path.startsWith('/groups')) return { items: [] };
      return undefined;
    });
  }

  it('a rule: asks, then deletes through its own endpoint', async () => {
    stubBots();
    const user = userEvent.setup();
    renderIn(<RuleBots />);

    await user.click(await screen.findByRole('button', { name: 'Delete rule Opening hours' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete rule “Opening hours”?' });
    expect(writes).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(writes).toEqual(['DELETE /settings/bots/bot-1/rules/rule-1']));
  });

  it('a bot: says its rules go with it, and Cancel sends nothing', async () => {
    stubBots();
    const user = userEvent.setup();
    renderIn(<RuleBots />);

    await user.click(await screen.findByRole('button', { name: 'Delete bot FAQ bot' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete bot “FAQ bot”?' });
    expect(dialog).toHaveTextContent('its rules');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(writes).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Delete bot FAQ bot' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(writes).toEqual(['DELETE /settings/bots/bot-1']));
  });

  it('a Copilot source: asks, then deletes', async () => {
    stubApi((path) =>
      path.startsWith('/copilot/knowledge')
        ? {
            items: [
              {
                id: 's1',
                name: 'Refund policy',
                type: 'article',
                status: 'ready',
                source_url: null,
                chunk_count: 4,
                updated_at: '2026-07-20T00:00:00.000Z',
              },
            ],
          }
        : undefined,
    );
    const user = userEvent.setup();
    renderIn(<CopilotKnowledge />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete “Refund policy”?' });
    expect(writes).toEqual([]);
    expect(dialog).toHaveTextContent('Copilot');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(writes).toEqual(['DELETE /copilot/knowledge/s1']));
  });

  // 259.9: these three used to close the dialog on a refusal and say nothing.
  it('a refused rule delete stays in the dialog with the reason (tm 259.9)', async () => {
    stubBots();
    refused = { 'DELETE /settings/bots/bot-1/rules/rule-1': SERVER_ERROR };
    const user = userEvent.setup();
    renderIn(<RuleBots />);

    await user.click(await screen.findByRole('button', { name: 'Delete rule Opening hours' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "“Opening hours” couldn't be deleted. Something went wrong on our side — try again.",
    );
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('a refused bot delete stays in the dialog with the reason (tm 259.9)', async () => {
    stubBots();
    refused = { 'DELETE /settings/bots/bot-1': SERVER_ERROR };
    const user = userEvent.setup();
    renderIn(<RuleBots />);

    await user.click(await screen.findByRole('button', { name: 'Delete bot FAQ bot' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "“FAQ bot” couldn't be deleted. Something went wrong on our side — try again.",
    );
  });

  it('a refused Copilot source delete stays in the dialog with the reason (tm 259.9)', async () => {
    refused = { 'DELETE /copilot/knowledge/s1': SERVER_ERROR };
    stubApi((path) =>
      path.startsWith('/copilot/knowledge')
        ? {
            items: [
              {
                id: 's1',
                name: 'Refund policy',
                type: 'article',
                status: 'ready',
                source_url: null,
                chunk_count: 4,
                updated_at: '2026-07-20T00:00:00.000Z',
              },
            ],
          }
        : undefined,
    );
    const user = userEvent.setup();
    renderIn(<CopilotKnowledge />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "“Refund policy” couldn't be deleted.",
    );
  });
});

// --- Customer ban (Y3) ------------------------------------------------------------------

describe('banning a customer', () => {
  function summary(banned: boolean): Record<string, unknown> {
    return {
      id: 'C1',
      name: 'Ada Visitor',
      email: 'ada@example.com',
      phone: null,
      country_code: null,
      country: null,
      is_lead: false,
      banned,
      chats_count: 0,
      tickets_count: 0,
      last_activity_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      table_custom_fields: [],
    };
  }

  function stubCustomers(banned: boolean): void {
    stubApi((path) => {
      if (/\/customers\/C1$/.test(path)) {
        return {
          ...summary(banned),
          banned_at: banned ? '2026-10-01T00:00:00.000Z' : null,
          visits_count: 0,
          groups: [],
          visits: [],
          chats: [],
          custom_fields: [],
        };
      }
      if (path.startsWith('/customers')) return { items: [summary(banned)], total: 1 };
      return undefined;
    });
  }

  it('asks first, says what a ban does, and sends one request on confirm', async () => {
    stubCustomers(false);
    const user = userEvent.setup();
    renderIn(<CustomersPage />, '/app/customers?customer=C1');

    await user.click(await screen.findByRole('button', { name: 'Ban customer' }));

    const dialog = screen.getByRole('dialog', { name: 'Ban Ada Visitor?' });
    expect(writes).toEqual([]);
    expect(dialog).toHaveTextContent('not be able to start');
    expect(dialog).toHaveTextContent('history is kept');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: 'Ban' }));

    await waitFor(() => expect(writes).toEqual(['POST /customers/C1/ban']));
  });

  it('Cancel sends nothing', async () => {
    stubCustomers(false);
    const user = userEvent.setup();
    renderIn(<CustomersPage />, '/app/customers?customer=C1');

    await user.click(await screen.findByRole('button', { name: 'Ban customer' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));

    expect(writes).toEqual([]);
  });

  it('shows an alert in the panel when the ban is refused', async () => {
    stubCustomers(false);
    refused = { 'POST /customers/C1/ban': SERVER_ERROR };
    const user = userEvent.setup();
    renderIn(<CustomersPage />, '/app/customers?customer=C1');

    await user.click(await screen.findByRole('button', { name: 'Ban customer' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ban' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not be banned');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ban customer' })).toBeEnabled();
  });

  it('lifting a ban asks nothing — it is the safe direction', async () => {
    stubCustomers(true);
    const user = userEvent.setup();
    renderIn(<CustomersPage />, '/app/customers?customer=C1');

    await user.click(await screen.findByRole('button', { name: 'Lift ban' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(writes).toEqual(['DELETE /customers/C1/ban']));
  });
});
