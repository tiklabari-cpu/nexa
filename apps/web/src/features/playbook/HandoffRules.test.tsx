/**
 * The hand-over rules card (tm 303.5 · AI-09, K9): the locked platform rows
 * above the workspace's ordered list, turning rules on and off, reordering,
 * the ready-made examples and the rule form.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { HandoffRule, HandoffRuleList } from './handoff.js';
import type { AiAgent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { HandoffRules } = await import('./HandoffRules.js');

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

const BASE = '/ai-agents/agent-1/handoff-rules';

function rule(id: string, over: Partial<HandoffRule> = {}): HandoffRule {
  return {
    id,
    ai_agent_id: 'agent-1',
    position: 1,
    active: true,
    title: `Rule ${id}`,
    trigger: { type: 'topic', value: 'deposit' },
    target: { topic: 'finance' },
    priority: 'high',
    ...over,
  };
}

const LIST: HandoffRuleList = {
  ai_agent_id: 'agent-1',
  locked: [
    {
      id: 'G1',
      title: { tr: 'Kendine zarar', en: 'Self-harm' },
      reason: 'guardrail_self_harm',
      target: { topic: 'responsible_gaming' },
      priority: 'urgent',
    },
    {
      id: 'G4',
      title: { tr: 'Bonus sözü', en: 'Bonus promises' },
      reason: null,
      target: null,
      priority: 'normal',
    },
  ],
  items: [
    rule('a', {
      title: 'Deposits to finance',
      position: 1,
      trigger: { type: 'topic', value: 'deposit' },
      target: { group_id: 4 },
    }),
    rule('b', {
      title: 'Bonus wording',
      position: 2,
      active: false,
      trigger: { type: 'phrase', value: 'free spins' },
      target: null,
      priority: 'normal',
    }),
  ],
  examples: [
    {
      key: 'ai_unresolved',
      title: { tr: 'AI çözemedi', en: 'The AI could not solve it' },
      trigger: { type: 'ai_unresolved', value: null },
      target: null,
      priority: 'normal',
    },
    {
      key: 'deposit',
      title: { tr: 'Para yatırma', en: 'Deposits' },
      trigger: { type: 'topic', value: 'deposit' },
      target: { topic: 'finance' },
      priority: 'high',
    },
  ],
};

const SKILLS = [
  { id: 'skill-deposit', name: 'Deposit not credited', mode: 'procedure' },
  { id: 'skill-faq', name: 'Opening hours', mode: 'single' },
];

function renderCard(canEdit = true, locale?: 'tr'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={queryClient}>
      <HandoffRules agent={AGENT} skills={SKILLS} canEdit={canEdit} />
    </QueryClientProvider>
  );
  if (locale) renderWithLocale(ui, locale);
  else render(ui);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === '/groups' ? { items: [{ id: 4, name: 'Finans' }] } : LIST),
  );
  api.post.mockResolvedValue(rule('new'));
  api.patch.mockResolvedValue(rule('a'));
  api.delete.mockResolvedValue(undefined);
  api.put.mockResolvedValue({ ...LIST, items: [LIST.items[1]!, LIST.items[0]!] });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLocale();
});

function refusal(reason: string): ApiClientError {
  return new ApiClientError({
    type: 'validation',
    status: 400,
    message: 'raw english from the server',
    requestId: 'r-1',
    details: { reason },
  });
}

describe('HandoffRules — the list (AI-09 · K9)', () => {
  it('heads the workspace’s rules with the platform’s locked ones, greyed and without controls', async () => {
    renderCard();

    const locked = await screen.findByRole('list', { name: 'Platform rules (locked)' });
    const g1 = within(locked).getByTestId('handoff-locked-G1');
    expect(g1).toHaveTextContent('G1 · Self-harm');
    expect(g1).toHaveTextContent('urgent');
    expect(g1).toHaveTextContent('locked');
    expect(within(g1).queryByRole('checkbox')).toBeNull();
    expect(within(g1).queryByRole('button')).toBeNull();
    // G4 blocks a topic and hands nothing over.
    expect(within(locked).getByTestId('handoff-locked-G4')).toHaveTextContent(
      'blocks the topic, hands nothing over',
    );
  });

  it('numbers the workspace’s rules in the order they are tried, with when, where and how urgent', async () => {
    renderCard();

    const list = await screen.findByRole('list', { name: 'Your hand-over rules' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('1');
    expect(first).toHaveTextContent('Deposits to finance');
    expect(first).toHaveTextContent('the message is about Deposits → Finans · high');
    expect(second).toHaveTextContent('2');
    expect(second).toHaveTextContent('the message says “free spins” → the usual routing · normal');
    expect(within(first!).getByRole('checkbox')).toBeChecked();
    expect(within(second!).getByRole('checkbox')).not.toBeChecked();
  });

  it('turns a rule off and on without touching the others', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(
      await screen.findByRole('checkbox', { name: 'Rule “Deposits to finance” is on' }),
    );
    expect(api.patch).toHaveBeenCalledWith(`${BASE}/a`, { active: false });

    await user.click(screen.getByRole('checkbox', { name: 'Rule “Bonus wording” is on' }));
    expect(api.patch).toHaveBeenLastCalledWith(`${BASE}/b`, { active: true });
  });

  it('moves a rule with the buttons and sends every rule once, in the new order', async () => {
    const user = userEvent.setup();
    renderCard();

    expect(
      await screen.findByRole('button', { name: 'Move “Deposits to finance” up' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move “Bonus wording” down' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move “Deposits to finance” down' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith(`${BASE}/order`, { rule_ids: ['b', 'a'] });
    expect(
      await screen.findByText('Moved “Deposits to finance” to position 2 of 2.'),
    ).toBeInTheDocument();
  });

  it('moves a rule by dragging its handle onto another row', async () => {
    renderCard();

    const list = await screen.findByRole('list', { name: 'Your hand-over rules' });
    const [first, second] = within(list).getAllByRole('listitem');
    const handle = first!.querySelector('[draggable="true"]') as HTMLElement;
    fireEvent.dragStart(handle);
    fireEvent.dragOver(second!);
    fireEvent.drop(second!);

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(`${BASE}/order`, { rule_ids: ['b', 'a'] }),
    );
  });

  it('deletes a rule only after it is confirmed', async () => {
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const user = userEvent.setup();
    renderCard();

    const del = await screen.findByRole('button', { name: 'Delete “Bonus wording”' });
    await user.click(del);
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(del);

    expect(confirm).toHaveBeenLastCalledWith('Delete the rule “Bonus wording”?');
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${BASE}/b`));
  });

  it('says in words why the server refused, and not what it wrote', async () => {
    api.put.mockRejectedValue(refusal('handoff_rules_order_mismatch'));
    const user = userEvent.setup();
    renderCard();

    await user.click(
      await screen.findByRole('button', { name: 'Move “Deposits to finance” down' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The list changed while you were reordering it. Reload and try again.',
    );
  });

  it('explains an empty list instead of showing nothing', async () => {
    api.get.mockImplementation((path: string) =>
      Promise.resolve(path === '/groups' ? { items: [] } : { ...LIST, items: [] }),
    );
    renderCard();

    expect(await screen.findByText('No rules of your own yet')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Platform rules (locked)' })).toBeInTheDocument();
  });

  it('shows a person without the AI scope the rules, with nothing to change', async () => {
    renderCard(false);

    const list = await screen.findByRole('list', { name: 'Your hand-over rules' });
    expect(within(list).getAllByRole('checkbox')[0]).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add hand-over rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move /u })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete /u })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ready-made rules' })).toBeNull();
    expect(
      screen.getByText('Only people with AI agent access can change these settings.'),
    ).toBeInTheDocument();
  });
});

describe('HandoffRules — the ready-made rules (AI-09 · K9)', () => {
  it('offers the examples that are not in the list yet, and adds one in the console’s language', async () => {
    const user = userEvent.setup();
    renderCard();

    const examples = await screen.findByRole('region', { name: 'Ready-made rules' });
    // “Deposits” (topic = deposit) is already a rule of the workspace.
    expect(within(examples).queryByText('Deposits')).toBeNull();
    await user.click(
      within(examples).getByRole('button', { name: 'Add the rule “The AI could not solve it”' }),
    );

    expect(api.post).toHaveBeenCalledWith(BASE, {
      title: 'The AI could not solve it',
      trigger: { type: 'ai_unresolved', value: null },
      target: null,
      priority: 'normal',
    });
  });

  it('adds the Turkish title in a Turkish console', async () => {
    const user = userEvent.setup();
    renderCard(true, 'tr');

    await user.click(await screen.findByRole('button', { name: '“AI çözemedi” kuralını ekle' }));

    expect(api.post).toHaveBeenCalledWith(BASE, expect.objectContaining({ title: 'AI çözemedi' }));
    expect(screen.getByRole('heading', { name: 'Devir kuralları' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Platform kuralları (kilitli)' })).toBeInTheDocument();
  });
});

describe('HandoffRules — the rule form (AI-09 · K9)', () => {
  it('asks for a name, then for what the trigger needs, before it sends anything', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Add hand-over rule' }));
    const form = screen.getByRole('form', { name: 'New hand-over rule' });
    await user.selectOptions(within(form).getByLabelText('When'), 'phrase');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    const problems = within(form).getByRole('alert');
    expect(problems).toHaveTextContent('Give the rule a name.');
    expect(problems).toHaveTextContent('Write the phrase the message must contain.');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('posts a phrase rule that hands over to a team, with its priority', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Add hand-over rule' }));
    const form = screen.getByRole('form', { name: 'New hand-over rule' });
    await user.type(within(form).getByLabelText('Name'), 'Chargebacks');
    await user.selectOptions(within(form).getByLabelText('When'), 'phrase');
    await user.type(within(form).getByLabelText('Phrase'), 'chargeback');
    await user.selectOptions(await within(form).findByLabelText('Hand over to'), 'group:4');
    await user.selectOptions(within(form).getByLabelText('Priority'), 'urgent');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(BASE, {
      title: 'Chargebacks',
      trigger: { type: 'phrase', value: 'chargeback' },
      target: { group_id: 4 },
      priority: 'urgent',
    });
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New hand-over rule' })).toBeNull(),
    );
  });

  it('offers only the procedures of the agent, and posts the one chosen', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Add hand-over rule' }));
    const form = screen.getByRole('form', { name: 'New hand-over rule' });
    await user.type(within(form).getByLabelText('Name'), 'Hand over deposits');
    await user.selectOptions(within(form).getByLabelText('When'), 'procedure');
    const options = within(within(form).getByLabelText('Procedure')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toStrictEqual([
      'Choose…',
      'Deposit not credited',
    ]);
    await user.selectOptions(within(form).getByLabelText('Procedure'), 'skill-deposit');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0]![1]).toMatchObject({
      trigger: { type: 'procedure', value: 'skill-deposit' },
      target: null,
      priority: 'normal',
    });
  });

  it('takes no value for a trigger that only routes, and says what it does', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Add hand-over rule' }));
    const form = screen.getByRole('form', { name: 'New hand-over rule' });
    await user.type(within(form).getByLabelText('Name'), 'Asked for a person');
    await user.selectOptions(within(form).getByLabelText('When'), 'player_request');

    expect(within(form).queryByLabelText('Topic')).toBeNull();
    expect(
      within(form).getByText(/The agent hands over because the player asked/),
    ).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0]![1]).toMatchObject({
      trigger: { type: 'player_request', value: null },
    });
  });

  it('opens a rule on what it holds and patches the whole of it', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Edit “Bonus wording”' }));
    const form = screen.getByRole('form', { name: 'Edit hand-over rule' });
    expect(within(form).getByLabelText('Name')).toHaveValue('Bonus wording');
    expect(within(form).getByLabelText('Phrase')).toHaveValue('free spins');
    await user.selectOptions(within(form).getByLabelText('Priority'), 'high');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith(`${BASE}/b`, {
      title: 'Bonus wording',
      trigger: { type: 'phrase', value: 'free spins' },
      target: null,
      priority: 'high',
    });
  });

  it('keeps the form open and says why when the server refuses the rule', async () => {
    api.post.mockRejectedValue(refusal('handoff_rules_limit'));
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: 'Add hand-over rule' }));
    const form = screen.getByRole('form', { name: 'New hand-over rule' });
    await user.type(within(form).getByLabelText('Name'), 'One too many');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'An agent can have at most 50 hand-over rules.',
    );
    expect(screen.getByRole('form', { name: 'New hand-over rule' })).toBeInTheDocument();
  });
});
