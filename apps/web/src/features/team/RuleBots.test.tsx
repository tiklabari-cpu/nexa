/**
 * Team → Chatbots, the rule bot editor (FR-MOD-06.6): bots are listed with
 * their rules and the teams they serve, an admin can write a rule and attach
 * the bot to a team **with a priority** — the KK's second half, which is the
 * thing that cannot be done through any other surface — a read-only caller sees
 * the same list with no controls, and a caller with no bot scope is told so and
 * nothing is fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

const { RuleBots } = await import('./RuleBots.js');

const TEAMS = {
  items: [
    { id: 1, name: 'Support' },
    { id: 2, name: 'Sales' },
  ],
};

const BOTS = {
  items: [
    {
      id: 'bot-1',
      name: 'FAQ bot',
      enabled: true,
      groups: [{ group_id: 1, priority: 'first' }],
      rules: [
        {
          id: 'rule-1',
          name: 'Opening hours',
          conditions: { message_word: 'hours' },
          actions: { send_message: 'We are open 09:00-18:00.' },
          enabled: true,
          position: 0,
        },
      ],
    },
  ],
};

function renderBots(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** `/settings/bots` and `/groups` come from the same mocked client. */
function routeGets(bots: unknown = BOTS): void {
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/groups') ? TEAMS : bots),
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  auth.scopes = ['agents-bot--all:rw'];
  routeGets();
  api.post.mockResolvedValue(BOTS.items[0]);
  api.patch.mockResolvedValue(BOTS.items[0]);
  api.delete.mockResolvedValue(undefined);
  resetLocale();
});

describe('RuleBots (FR-MOD-06.6)', () => {
  it('lists each bot with its rule in plain language', async () => {
    renderBots(<RuleBots />);

    expect(await screen.findByText('FAQ bot')).toBeInTheDocument();
    expect(screen.getByText('Opening hours')).toBeInTheDocument();
    expect(
      screen.getByText(/the message has the word "hours" → reply "We are open 09:00-18:00\."/),
    ).toBeInTheDocument();
  });

  it('shows the team the bot serves and the priority it serves at', async () => {
    // The KK's second half, on screen: "Support" alone would not say at what
    // standing the bot is tried there.
    renderBots(<RuleBots />);

    await screen.findByText('FAQ bot');
    // Scoped to the assignment chip: "Support" also appears as an `<option>` in
    // the attach picker, and asserting on that would pass with no assignment at
    // all.
    const chip = screen.getByRole('button', { name: 'Detach FAQ bot from Support' })
      .parentElement as HTMLElement;
    expect(within(chip).getByText('Support')).toBeInTheDocument();
    expect(within(chip).getByText('First')).toBeInTheDocument();
  });

  it('creates a bot from the name form', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: 'Greeter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add bot' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/bots', { name: 'Greeter' }),
    );
  });

  it('writes a rule as one condition and one action', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'Refunds' } });
    fireEvent.change(screen.getByLabelText('Condition kind for FAQ bot'), {
      target: { value: 'message_contains' },
    });
    fireEvent.change(screen.getByLabelText('Match'), { target: { value: 'refund' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Refunds take 5 days.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/bots/bot-1/rules', {
        name: 'Refunds',
        conditions: { message_contains: 'refund' },
        actions: { send_message: 'Refunds take 5 days.' },
        // Appended, so a new rule cannot silently overtake one already
        // answering.
        position: 1,
      }),
    );
  });

  it('sends a transfer action as a team id, not as text', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.change(screen.getByLabelText('Rule'), { target: { value: 'To sales' } });
    fireEvent.change(screen.getByLabelText('Match'), { target: { value: 'buy' } });
    fireEvent.change(screen.getByLabelText('Action kind for FAQ bot'), {
      target: { value: 'transfer_to_group_id' },
    });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/settings/bots/bot-1/rules',
        expect.objectContaining({ actions: { transfer_to_group_id: 2 } }),
      ),
    );
  });

  it('attaches the bot to a team at the chosen priority', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.change(screen.getByLabelText('Team for FAQ bot'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Priority for FAQ bot'), {
      target: { value: 'primary' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/bots/bot-1', {
        // The existing assignment is carried, because the endpoint replaces the
        // whole list — dropping it here would silently detach the bot from
        // Support.
        groups: [
          { group_id: 1, priority: 'first' },
          { group_id: 2, priority: 'primary' },
        ],
      }),
    );
  });

  it('changes an existing team’s priority rather than adding it twice', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.change(screen.getByLabelText('Team for FAQ bot'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Priority for FAQ bot'), { target: { value: 'last' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/bots/bot-1', {
        groups: [{ group_id: 1, priority: 'last' }],
      }),
    );
  });

  it('detaches a team by sending the shorter list', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.click(screen.getByRole('button', { name: 'Detach FAQ bot from Support' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/bots/bot-1', { groups: [] }),
    );
  });

  it('switches a rule off without deleting it', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.click(screen.getByRole('button', { name: 'Disable rule Opening hours' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/bots/bot-1/rules/rule-1', {
        enabled: false,
      }),
    );
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('deletes a bot and a rule through their own endpoints', async () => {
    renderBots(<RuleBots />);
    await screen.findByText('FAQ bot');

    fireEvent.click(screen.getByRole('button', { name: 'Delete rule Opening hours' }));
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/settings/bots/bot-1/rules/rule-1'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete bot FAQ bot' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/settings/bots/bot-1'));
  });

  it('warns when a bot serves no team, because it then answers nobody', async () => {
    routeGets({ items: [{ ...BOTS.items[0], groups: [] }] });
    renderBots(<RuleBots />);

    expect(
      await screen.findByText('Not attached to a team yet, so it answers nobody.'),
    ).toBeInTheDocument();
  });

  it('gives a read-only caller the list and no controls', async () => {
    auth.scopes = ['agents-bot--all:ro'];
    renderBots(<RuleBots />);

    expect(await screen.findByText('FAQ bot')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add bot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach' })).not.toBeInTheDocument();
  });

  it('fetches nothing at all without the bot scope', async () => {
    auth.scopes = ['chats--all:ro'];
    renderBots(<RuleBots />);

    expect(await screen.findByText('No access to rule bots')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('translates the whole section', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <RuleBots />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByText('Kural botları')).toBeInTheDocument();
    // The per-bot rule form only exists once the list has loaded, so this waits
    // rather than reading the section header alone.
    expect(await screen.findByRole('button', { name: 'Kural ekle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'FAQ bot botunu sil' })).toBeInTheDocument();
  });
});
