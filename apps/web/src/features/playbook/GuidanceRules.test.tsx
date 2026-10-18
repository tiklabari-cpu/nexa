/**
 * The behaviour-rules card (tm 299.2 · AI-07): rules grouped by category, a
 * counted editor, a scope picker, and the conflict check that warns on Save
 * without ever blocking it — except for a rule a locked platform rule overrides.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { AiAgent, GuidanceCheck, GuidanceRule } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { GuidanceRules } = await import('./GuidanceRules.js');

const AGENT: AiAgent = {
  id: 'agent-1',
  name: 'Ada',
  kind: 'ai_agent',
  tone: null,
  avatar_url: null,
  languages: ['tr'],
  answer_length: null,
  batch_window_seconds: null,
  active: true,
  skills_count: 2,
};

const SKILLS = [
  { id: 'skill-deposit', name: 'Deposit not credited' },
  { id: 'skill-bonus', name: 'Bonus question' },
];

function rule(overrides: Partial<GuidanceRule> & Pick<GuidanceRule, 'id' | 'title'>): GuidanceRule {
  return {
    ai_agent_id: 'agent-1',
    body: `${overrides.title} body`,
    category: 'communication',
    scope: { all: true },
    priority: 100,
    active: true,
    updated_at: '2026-10-18T10:00:00Z',
    ...overrides,
  };
}

const RULES: GuidanceRule[] = [
  rule({ id: 'r-1', title: 'Be brief', category: 'communication', priority: 10 }),
  rule({
    id: 'r-2',
    title: 'Ask the amount first',
    category: 'clarification',
    scope: { skill_ids: ['skill-deposit'] },
    priority: 20,
  }),
  rule({ id: 'r-3', title: 'Never promise a refund', category: 'prohibition', active: false }),
];

const CLEAN: GuidanceCheck = {
  locked: null,
  conflicts: [],
  duplicates: [],
  vague: [],
  compared: 3,
  checked_by: 'rules',
};

function renderCard(canEdit = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <GuidanceRules agent={AGENT} skills={SKILLS} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockResolvedValue({ items: RULES });
  api.post.mockResolvedValue(rule({ id: 'r-new', title: 'New' }));
  api.patch.mockResolvedValue(RULES[0]);
  api.delete.mockResolvedValue(undefined);
});

async function openNew(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'New rule' }));
}

async function fillRule(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Title'), 'Ask first');
  await user.type(screen.getByLabelText('Rule'), 'Ask the method before suggesting a fix.');
}

describe('GuidanceRules list', () => {
  it("reads the agent's rules and groups them by category, with a count of those on", async () => {
    renderCard();

    expect(await screen.findByRole('heading', { name: 'Communication' })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/ai-guidance?ai_agent_id=agent-1');
    expect(screen.getByRole('heading', { name: 'Clarification' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prohibitions' })).toBeInTheDocument();
    // No rule of these categories: no empty group.
    expect(screen.queryByRole('heading', { name: 'Sensitive topics' })).toBeNull();
    expect(screen.getByText('2 rules are on')).toBeInTheDocument();
  });

  it('says where a rule applies, naming the procedures it is scoped to', async () => {
    renderCard();

    expect(await screen.findByText(/Procedures: Deposit not credited/)).toBeInTheDocument();
    expect(screen.getAllByText(/Every conversation/).length).toBeGreaterThan(0);
  });

  it('shows the empty state, not a blank card, when there are no rules', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderCard();

    expect(await screen.findByText('No behaviour rules yet')).toBeInTheDocument();
  });

  it('shows a read failure with a retry, never the empty state', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    renderCard();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Behaviour rules couldn’t be loaded',
    );
    expect(screen.queryByText('No behaviour rules yet')).toBeNull();
  });

  it('switches a rule off with a PATCH of active alone', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('switch', { name: 'Rule “Be brief”' }));

    expect(api.patch).toHaveBeenCalledWith('/ai-guidance/r-1', { active: false });
  });

  it('deletes a rule only after a confirmation', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Delete rule “Be brief”' }));
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete “Be brief”?' }));

    expect(api.delete).toHaveBeenCalledWith('/ai-guidance/r-1');
  });

  it('is read-only without edit rights', async () => {
    renderCard(false);

    expect(await screen.findByRole('switch', { name: 'Rule “Be brief”' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'New rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit rule “Be brief”' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete rule “Be brief”' })).toBeNull();
  });
});

describe('GuidanceRules editor', () => {
  it('counts the body against the 600-character limit and refuses past it', async () => {
    const user = userEvent.setup();
    renderCard();
    await openNew(user);

    expect(screen.getByText('0 / 600 characters')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Title'), 'Long');
    await user.click(screen.getByLabelText('Rule'));
    await user.paste('a'.repeat(601));

    expect(screen.getByText('601 / 600 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
  });

  it('keeps Save off until the title and the rule are written', async () => {
    const user = userEvent.setup();
    renderCard();
    await openNew(user);

    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
    await fillRule(user);
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeEnabled();
  });

  it('checks first, then POSTs a clean rule with the defaults', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/ai-guidance/check' ? CLEAN : rule({ id: 'r-new', title: 'Ask first' }),
      ),
    );
    renderCard();
    await openNew(user);
    await fillRule(user);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[0]?.[0]).toBe('/ai-guidance/check');
    expect(api.post.mock.calls[1]).toEqual([
      '/ai-guidance',
      {
        ai_agent_id: 'agent-1',
        title: 'Ask first',
        body: 'Ask the method before suggesting a fix.',
        category: 'communication',
        scope: { all: true },
        priority: 100,
        active: true,
      },
    ]);
    // The editor closes on a save.
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull());
  });

  it('shows a conflict as a warning and saves on the second click, not the first', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/ai-guidance/check'
          ? {
              ...CLEAN,
              conflicts: [
                { rule_id: 'r-1', explanation: 'Asks for long answers.', severity: 'warning' },
              ],
            }
          : rule({ id: 'r-new', title: 'Ask first' }),
      ),
    );
    renderCard();
    await openNew(user);
    await fillRule(user);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    const panel = await screen.findByRole('region', { name: 'Conflict check' });
    expect(within(panel).getByText('Be brief')).toBeInTheDocument();
    expect(within(panel).getByText(/Asks for long answers/)).toBeInTheDocument();
    // Warned, not saved.
    expect(api.post).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1]?.[0]).toBe('/ai-guidance');
  });

  it('shows a repeat and a vague wording in the same panel', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      ...CLEAN,
      duplicates: [{ rule_id: 'r-1', explanation: 'Says the same as this.' }],
      vague: [{ explanation: '“Be nice” names no behaviour.' }],
    });
    renderCard();
    await openNew(user);
    await fillRule(user);
    await user.click(screen.getByRole('button', { name: 'Check for conflicts' }));

    const panel = await screen.findByRole('region', { name: 'Conflict check' });
    expect(within(panel).getByText('Repeats')).toBeInTheDocument();
    expect(within(panel).getByText(/names no behaviour/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('refuses a rule a locked platform rule overrides, whatever the second click', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      ...CLEAN,
      locked: { locked_rule: 'credentials', explanation: 'Asks the player for a password.' },
    });
    renderCard();
    await openNew(user);
    await user.type(screen.getByLabelText('Title'), 'Password');
    await user.type(screen.getByLabelText('Rule'), 'Ask the player for their password.');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(
      await screen.findByText(/asks the player for a password, an OTP or a card/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(api.post.mock.calls.every(([path]) => path === '/ai-guidance/check')).toBe(true);
  });

  it('saves anyway when the check itself cannot answer', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) =>
      path === '/ai-guidance/check'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(rule({ id: 'r-new', title: 'Ask first' })),
    );
    renderCard();
    await openNew(user);
    await fillRule(user);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1]?.[0]).toBe('/ai-guidance');
  });

  it('a changed draft makes the last check stale and runs it again', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      ...CLEAN,
      vague: [{ explanation: 'Too vague.' }],
    });
    renderCard();
    await openNew(user);
    await fillRule(user);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));
    await screen.findByRole('button', { name: 'Save anyway' });

    await user.type(screen.getByLabelText('Rule'), ' Always.');

    expect(screen.queryByRole('region', { name: 'Conflict check' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeInTheDocument();
  });

  it("scopes a rule to the procedures ticked, and won't save an empty pick", async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/ai-guidance/check' ? CLEAN : rule({ id: 'r-new', title: 'Ask first' }),
      ),
    );
    renderCard();
    await openNew(user);
    await fillRule(user);

    await user.click(screen.getByRole('radio', { name: 'Only some procedures' }));
    expect(screen.getByRole('button', { name: 'Save rule' })).toBeDisabled();
    expect(screen.getByText('Pick at least one procedure.')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Deposit not credited' }));
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1]?.[1]).toMatchObject({ scope: { skill_ids: ['skill-deposit'] } });
  });

  it('edits a rule in place and PATCHes it, keeping a brand scope as it was', async () => {
    const user = userEvent.setup();
    const brandRule = rule({
      id: 'r-9',
      title: 'Brand voice',
      scope: { brand_ids: ['brand-1', 'brand-2'] },
    });
    api.get.mockResolvedValue({ items: [brandRule] });
    api.post.mockResolvedValue(CLEAN);
    renderCard();

    expect(await screen.findByText(/2 brands/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit rule “Brand voice”' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Brand voice');
    await user.clear(screen.getByLabelText('Priority'));
    await user.type(screen.getByLabelText('Priority'), '5');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith(
      '/ai-guidance/r-9',
      expect.objectContaining({ priority: 5, scope: { brand_ids: ['brand-1', 'brand-2'] } }),
    );
    // The check names the rule being edited so it is not compared with itself.
    expect(api.post.mock.calls[0]?.[1]).toMatchObject({ rule_id: 'r-9' });
  });

  it('keeps the editor open and says why when the save is refused', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) =>
      path === '/ai-guidance/check' ? Promise.resolve(CLEAN) : Promise.reject(new Error('refused')),
    );
    renderCard();
    await openNew(user);
    await fillRule(user);
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
  });
});

describe('GuidanceRules localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the card in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <GuidanceRules agent={AGENT} skills={SKILLS} canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('heading', { name: 'İletişim' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni kural' })).toBeInTheDocument();
  });
});
