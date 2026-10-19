/**
 * The compliance-guardrails tab (tm 301.4 · AI-08): the platform's locked rules
 * read-only, the owner's crisis and complaint texts with their approval, the
 * workspace's own rules and forbidden phrases, and the log of what was caught.
 * Everything the owner writes goes through the real endpoints' shapes; an admin
 * sees the same page without a single write control.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { resetLocale, setLocale } from '../../test/i18n.js';
import type {
  AiAgent,
  ForbiddenPhrase,
  GuardrailHitRecord,
  GuardrailRule,
  GuardrailSettings,
  PlatformGuardrail,
  PlatformGuardrails,
} from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { GuardrailsPage } = await import('./GuardrailsPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const AGENT: AiAgent = {
  id: 'agent-1',
  name: 'Ada',
  kind: 'ai_agent',
  tone: null,
  avatar_url: null,
  languages: ['tr'],
  answer_length: null,
  batch_window_seconds: null,
  active: false,
  skills_count: 2,
};

const SKILLS = [
  { id: 'skill-deposit', name: 'Deposit not credited' },
  { id: 'skill-bonus', name: 'Bonus question' },
];

function platformRule(
  id: string,
  title: string,
  overrides: Partial<PlatformGuardrail> = {},
): PlatformGuardrail {
  return {
    id,
    title: { tr: `${title} (tr)`, en: title },
    prompt: { tr: `${title} satırı`, en: `${title} line` },
    category: 'responsible_gaming',
    action: 'force_handoff',
    target: null,
    priority: 'normal',
    tenant_text: null,
    stages: ['input'],
    locked: true,
    ...overrides,
  };
}

const PLATFORM: PlatformGuardrails = {
  version: '2026-10-19.1',
  rules: [
    platformRule('G1', 'Self-exclusion', { target: 'responsible_gaming' }),
    platformRule('G3', 'Self-harm', { priority: 'urgent', tenant_text: 'crisis' }),
    platformRule('G7', 'No promised outcomes', {
      category: 'money',
      action: 'block_output',
      stages: ['output'],
    }),
  ],
};

function settings(overrides: Partial<GuardrailSettings> = {}): GuardrailSettings {
  return {
    ai_agent_id: 'agent-1',
    crisis_text: null,
    complaint_text: null,
    judge_enabled: false,
    crisis_text_approved: false,
    approved_by: null,
    approved_at: null,
    crisis_text_draft: null,
    setup_problem: 'crisis_text_missing',
    updated_at: null,
    ...overrides,
  };
}

function rule(
  overrides: Partial<GuardrailRule> & Pick<GuardrailRule, 'id' | 'title'>,
): GuardrailRule {
  return {
    ai_agent_id: 'agent-1',
    body: `${overrides.title} body`,
    category: 'money',
    action: 'prompt_only',
    scope: { all: true },
    active: true,
    updated_at: '2026-10-19T10:00:00Z',
    ...overrides,
  };
}

function phrase(
  overrides: Partial<ForbiddenPhrase> & Pick<ForbiddenPhrase, 'id' | 'phrase'>,
): ForbiddenPhrase {
  return {
    ai_agent_id: 'agent-1',
    match: 'word',
    lang: null,
    scope: { all: true },
    action: 'block',
    active: true,
    updated_at: '2026-10-19T10:00:00Z',
    ...overrides,
  };
}

function hit(
  overrides: Partial<GuardrailHitRecord> & Pick<GuardrailHitRecord, 'id'>,
): GuardrailHitRecord {
  return {
    chat_id: 'CHAT0001',
    thread_id: 'THR0001',
    turn_id: '00000000-0000-4000-8000-000000000001',
    rule_key: 'G1',
    stage: 'input',
    action_taken: 'handoff',
    evidence: 'hesabımı kapatın',
    catalog_version: '2026-10-19.1',
    created_at: '2026-10-19T10:00:00Z',
    ...overrides,
  };
}

const RULE_ID = '11111111-1111-4111-8111-111111111111';
const PHRASE_ID = '22222222-2222-4222-8222-222222222222';

let state: {
  settings: GuardrailSettings;
  rules: GuardrailRule[];
  phrases: ForbiddenPhrase[];
  hits: GuardrailHitRecord[][];
};

function signIn(role: 'owner' | 'admin'): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['agents-bot--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
}

function renderTab(hasAiScope = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <GuardrailsPage agent={AGENT} skills={SKILLS} hasAiScope={hasAiScope} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  state = {
    settings: settings(),
    rules: [],
    phrases: [],
    hits: [[]],
  };
  signIn('owner');
  api.get.mockImplementation((path: string) => {
    if (path === '/ai-guardrails/platform') return Promise.resolve(PLATFORM);
    if (path.startsWith('/ai-guardrails/settings')) return Promise.resolve(state.settings);
    if (path.startsWith('/ai-guardrails/rules')) return Promise.resolve({ items: state.rules });
    if (path.startsWith('/ai-guardrails/phrases')) {
      return Promise.resolve({ items: state.phrases });
    }
    if (path.startsWith('/ai-guardrails/hits')) {
      const pageId = new URL(path, 'http://x').searchParams.get('page_id');
      const index = pageId ? Number(pageId) : 0;
      const items = state.hits[index] ?? [];
      return Promise.resolve({
        items,
        ...(index + 1 < state.hits.length ? { next_page_id: String(index + 1) } : {}),
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

afterEach(() => resetLocale());

describe('platform rules (AI-08)', () => {
  it('lists the locked catalogue by category, with its version, and offers no way to change it', async () => {
    renderTab();

    const heading = await screen.findByRole('heading', { name: 'Responsible gaming' });
    const group = heading.closest('section') as HTMLElement;
    expect(within(group).getByText('G1')).toBeInTheDocument();
    expect(within(group).getByText('Self-exclusion')).toBeInTheDocument();
    expect(within(group).getByText('Self-exclusion line')).toBeInTheDocument();
    expect(
      within(group).getByText(/Hands over to a person · Responsible gaming team/),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Money and promises' })).toBeInTheDocument();
    expect(screen.getByText('Rule set version 2026-10-19.1')).toBeInTheDocument();
    expect(screen.getAllByText('Locked')).toHaveLength(3);
    expect(screen.getByText(/Urgent · Sends your crisis text/)).toBeInTheDocument();

    // Not one control on a platform row: no switch, no edit, no delete.
    const rows = within(group).getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(api.patch).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('reads the catalogue in the console’s language', async () => {
    setLocale('tr');
    renderTab();

    expect(await screen.findByText('Self-exclusion (tr)')).toBeInTheDocument();
    expect(screen.getByText('Self-exclusion satırı')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sorumlu oyun' })).toBeInTheDocument();
  });

  it('says so when the catalogue cannot be read, with a retry', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/ai-guardrails/platform'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ items: [], ...state.settings }),
    );
    renderTab();

    expect(await screen.findByText('The platform rules couldn’t be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});

describe('crisis and complaint texts (AI-08-S1)', () => {
  it('warns that the agent cannot go live while the crisis text is missing', async () => {
    renderTab();

    expect(
      await screen.findByText(
        'The AI agent can’t go live yet: write the crisis text and approve it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('No crisis text yet.')).toBeInTheDocument();
  });

  it('saves and approves the crisis text in one request', async () => {
    api.put.mockResolvedValue(
      settings({
        crisis_text: 'We are here for you.',
        crisis_text_approved: true,
        approved_at: '2026-10-19T12:00:00Z',
        setup_problem: null,
      }),
    );
    const user = userEvent.setup();
    renderTab();

    await user.type(await screen.findByLabelText('Crisis text'), 'We are here for you.');
    expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save and approve crisis text' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/ai-guardrails/settings', {
        ai_agent_id: 'agent-1',
        crisis_text: 'We are here for you.',
        complaint_text: null,
        judge_enabled: false,
        approve_crisis_text: true,
      }),
    );
    expect(await screen.findByText(/^Approved by the owner on /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save and approve crisis text' })).toBeNull();
    // The agent card's switch reads the same gate, so its query is refreshed.
  });

  it('saves the other fields without touching the approval', async () => {
    state.settings = settings({
      crisis_text: 'Be well.',
      crisis_text_approved: true,
      approved_at: '2026-10-19T12:00:00Z',
      setup_problem: null,
    });
    api.put.mockResolvedValue({ ...state.settings, judge_enabled: true });
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText(/^Approved by the owner on /)).toBeInTheDocument();
    await user.click(
      screen.getByRole('checkbox', { name: 'Have a second check read risky replies' }),
    );
    // An edit that leaves the text alone leaves the approval standing.
    expect(screen.getByText(/^Approved by the owner on /)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save texts' }));

    await waitFor(() => expect(api.put).toHaveBeenCalled());
    const body = api.put.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({ judge_enabled: true, crisis_text: 'Be well.' });
    expect(body).not.toHaveProperty('approve_crisis_text');
  });

  it('shows an approval as lost the moment the text is edited, before any save', async () => {
    state.settings = settings({
      crisis_text: 'Be well.',
      crisis_text_approved: true,
      approved_at: '2026-10-19T12:00:00Z',
      setup_problem: null,
    });
    const user = userEvent.setup();
    renderTab();

    await screen.findByText(/^Approved by the owner on /);
    await user.type(screen.getByLabelText('Crisis text'), ' Please call.');

    expect(screen.queryByText(/^Approved by the owner on /)).toBeNull();
    expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and approve crisis text' })).toBeEnabled();
  });

  it('withdraws an approval with approve_crisis_text false', async () => {
    state.settings = settings({
      crisis_text: 'Be well.',
      crisis_text_approved: true,
      approved_at: '2026-10-19T12:00:00Z',
      setup_problem: null,
    });
    api.put.mockResolvedValue(settings({ crisis_text: 'Be well.' }));
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Withdraw approval' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/ai-guardrails/settings',
        expect.objectContaining({ approve_crisis_text: false }),
      ),
    );
  });

  it('offers the platform’s suggestion for the country and fills the field from it', async () => {
    state.settings = settings({ crisis_text_draft: 'Call the helpline 0800 000 000.' });
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText('Call the helpline 0800 000 000.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use this suggestion' }));

    expect(screen.getByLabelText('Crisis text')).toHaveValue('Call the helpline 0800 000 000.');
    // Used, so the suggestion has nothing left to offer — and it is still not approved.
    expect(screen.queryByRole('button', { name: 'Use this suggestion' })).toBeNull();
    expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
  });

  it('refuses a text over the limit before it is sent', async () => {
    const user = userEvent.setup();
    renderTab();

    const field = await screen.findByLabelText('Crisis text');
    await user.click(field);
    await user.paste('x'.repeat(1001));

    expect(screen.getByText('1001 / 1000 characters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and approve crisis text' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save texts' })).toBeDisabled();
  });

  it('says why a save was refused, in words and not as the server wrote it', async () => {
    api.put.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'raw english from the server',
        requestId: 'r-1',
        details: { reason: 'guardrail_crisis_text_missing' },
      }),
    );
    const user = userEvent.setup();
    renderTab();

    await user.type(await screen.findByLabelText('Complaint procedure'), 'Write to us.');
    await user.click(screen.getByRole('button', { name: 'Save texts' }));

    expect(
      await screen.findByText('Write the crisis text before approving it.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw english/)).toBeNull();
  });
});

describe('who may write', () => {
  it('shows an admin the page without one write control', async () => {
    signIn('admin');
    state.settings = settings({ crisis_text: 'Be well.' });
    state.rules = [rule({ id: RULE_ID, title: 'No deposits after a loss' })];
    state.phrases = [phrase({ id: PHRASE_ID, phrase: 'kesin' })];
    renderTab();

    expect(
      await screen.findByRole('switch', { name: 'Compliance rule “No deposits after a loss”' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('switch', { name: 'Forbidden phrase “kesin”' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Crisis text')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Complaint procedure')).toHaveAttribute('readonly');
    for (const name of [
      'Save texts',
      'Save and approve crisis text',
      'New compliance rule',
      'New forbidden phrase',
    ]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
    expect(
      screen.getByRole('switch', { name: 'Compliance rule “No deposits after a loss”' }),
    ).toBeDisabled();
    expect(screen.getAllByText('Only the owner can change these.').length).toBeGreaterThan(0);
  });

  it('keeps an owner without the AI scope read-only too', async () => {
    renderTab(false);

    await screen.findByLabelText('Crisis text');
    expect(screen.queryByRole('button', { name: 'New compliance rule' })).toBeNull();
  });
});

describe('the workspace’s compliance rules', () => {
  it('shows the empty state, then writes a rule with its category, action and scope', async () => {
    api.post.mockResolvedValue(rule({ id: RULE_ID, title: 'No deposits after a loss' }));
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText('No rules of your own yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New compliance rule' }));
    const form = screen.getByRole('form', { name: 'New compliance rule' });
    await user.type(within(form).getByLabelText('Title'), 'No deposits after a loss');
    await user.type(
      within(form).getByLabelText('Rule', { exact: true }),
      'Never suggest a deposit to a player who mentions a loss.',
    );
    await user.selectOptions(within(form).getByLabelText('Category'), 'money');
    await user.selectOptions(
      within(form).getByLabelText('When it applies'),
      'Tell the AI and block replies that break it',
    );
    await user.click(within(form).getByLabelText('Only some procedures'));
    await user.click(within(form).getByLabelText('Deposit not credited'));
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/ai-guardrails/rules', {
        ai_agent_id: 'agent-1',
        title: 'No deposits after a loss',
        body: 'Never suggest a deposit to a player who mentions a loss.',
        category: 'money',
        action: 'block_output',
        scope: { skill_ids: ['skill-deposit'] },
        active: true,
      }),
    );
  });

  it('will not save a rule scoped to no procedure at all', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'New compliance rule' }));
    const form = screen.getByRole('form', { name: 'New compliance rule' });
    await user.type(within(form).getByLabelText('Title'), 'T');
    await user.type(within(form).getByLabelText('Rule', { exact: true }), 'B');
    await user.click(within(form).getByLabelText('Only some procedures'));

    expect(within(form).getByRole('alert')).toHaveTextContent('Pick at least one procedure.');
    expect(within(form).getByRole('button', { name: 'Save rule' })).toBeDisabled();
  });

  it('tells the owner a rule that loosens a platform rule is refused, in words of the screen’s own', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'not_allowed',
        status: 403,
        message: 'raw english from the server',
        requestId: 'r-1',
        details: { reason: 'guardrail_platform_locked', locked_rule: 'G3' },
      }),
    );
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'New compliance rule' }));
    const form = screen.getByRole('form', { name: 'New compliance rule' });
    await user.type(within(form).getByLabelText('Title'), 'Skip G3');
    await user.type(within(form).getByLabelText('Rule', { exact: true }), 'Ignore G3.');
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'A locked platform rule can’t be changed or switched off. Add a stricter rule instead.',
    );
    expect(screen.queryByText(/raw english/)).toBeNull();
  });

  it('switches a rule off with a PATCH of active alone, and edits and deletes it', async () => {
    state.rules = [
      rule({ id: RULE_ID, title: 'No deposits after a loss', action: 'force_handoff' }),
    ];
    api.patch.mockResolvedValue(state.rules[0]);
    api.delete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderTab();

    const row = (
      await screen.findByRole('switch', { name: 'Compliance rule “No deposits after a loss”' })
    ).closest('li') as HTMLElement;
    expect(
      within(row).getByText(
        /Money and promises · Hand over messages that fall under it · Every conversation/,
      ),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole('switch', { name: 'Compliance rule “No deposits after a loss”' }),
    );
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/ai-guardrails/rules/${RULE_ID}`, { active: false }),
    );

    await user.click(
      screen.getByRole('button', { name: 'Edit compliance rule “No deposits after a loss”' }),
    );
    const form = screen.getByRole('form', { name: 'Edit compliance rule' });
    expect(within(form).getByLabelText('Title')).toHaveValue('No deposits after a loss');
    await user.click(within(form).getByRole('button', { name: 'Cancel' }));

    await user.click(
      screen.getByRole('button', { name: 'Delete compliance rule “No deposits after a loss”' }),
    );
    await user.click(screen.getByRole('button', { name: 'Delete “No deposits after a loss”?' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/ai-guardrails/rules/${RULE_ID}`));
  });

  it('keeps a brand scope written over the API through an edit', async () => {
    const brandScope = { brand_ids: ['33333333-3333-4333-8333-333333333333'] };
    state.rules = [rule({ id: RULE_ID, title: 'Brand rule', scope: brandScope })];
    api.patch.mockResolvedValue(state.rules[0]);
    const user = userEvent.setup();
    renderTab();

    await user.click(
      await screen.findByRole('button', { name: 'Edit compliance rule “Brand rule”' }),
    );
    const form = screen.getByRole('form', { name: 'Edit compliance rule' });
    expect(
      within(form).getByText('Scoped to brands; the scope is kept as it is.'),
    ).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Save rule' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    expect(api.patch.mock.calls[0]?.[1]).toMatchObject({ scope: brandScope });
  });
});

describe('forbidden phrases', () => {
  it('writes a phrase, matched as a whole word and blocking, in every language', async () => {
    api.post.mockResolvedValue(phrase({ id: PHRASE_ID, phrase: 'kesin' }));
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText('No forbidden phrases yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New forbidden phrase' }));
    const form = screen.getByRole('form', { name: 'New forbidden phrase' });
    await user.type(within(form).getByLabelText('Phrase'), 'kesin');
    await user.click(within(form).getByRole('button', { name: 'Save phrase' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/ai-guardrails/phrases', {
        ai_agent_id: 'agent-1',
        phrase: 'kesin',
        match: 'word',
        lang: null,
        scope: { all: true },
        action: 'block',
        active: true,
      }),
    );
  });

  it('refuses a pattern the API would refuse, with the reason, before it is sent', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'New forbidden phrase' }));
    const form = screen.getByRole('form', { name: 'New forbidden phrase' });
    await user.selectOptions(within(form).getByLabelText('Matches'), 'regex');
    await user.type(within(form).getByLabelText('Phrase'), '(a+)+ b');

    expect(
      within(form).getByText(/This pattern uses something that isn’t allowed/),
    ).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save phrase' })).toBeDisabled();

    // A pattern inside the dialect is accepted.
    const field = within(form).getByLabelText('Phrase');
    await user.clear(field);
    await user.type(field, 'garanti.{{0,10}yat');
    expect(within(form).getByRole('button', { name: 'Save phrase' })).toBeEnabled();
  });

  it('refuses a pattern that matches nothing at all, which would block every reply', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'New forbidden phrase' }));
    const form = screen.getByRole('form', { name: 'New forbidden phrase' });
    await user.selectOptions(within(form).getByLabelText('Matches'), 'regex');
    await user.type(within(form).getByLabelText('Phrase'), 'a?');

    expect(within(form).getByText(/can match nothing at all/)).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save phrase' })).toBeDisabled();
  });

  it('refuses a language that is not two letters', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'New forbidden phrase' }));
    const form = screen.getByRole('form', { name: 'New forbidden phrase' });
    await user.type(within(form).getByLabelText('Phrase'), 'kesin');
    await user.type(within(form).getByLabelText('Language'), 't');

    expect(within(form).getByRole('button', { name: 'Save phrase' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Language'), 'r');
    expect(within(form).getByRole('button', { name: 'Save phrase' })).toBeEnabled();
  });

  it('answers the server’s own refusals — a duplicate — in the screen’s words', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'raw english',
        requestId: 'r-1',
        details: { reason: 'forbidden_phrase_exists' },
      }),
    );
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'New forbidden phrase' }));
    const form = screen.getByRole('form', { name: 'New forbidden phrase' });
    await user.type(within(form).getByLabelText('Phrase'), 'kesin');
    await user.click(within(form).getByRole('button', { name: 'Save phrase' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'This phrase is already on the list.',
    );
  });

  it('lists each phrase with how it matches, what it does and where it applies', async () => {
    state.phrases = [
      phrase({ id: PHRASE_ID, phrase: 'garanti', match: 'exact', lang: 'tr', action: 'warn' }),
    ];
    api.patch.mockResolvedValue(state.phrases[0]);
    const user = userEvent.setup();
    renderTab();

    const row = (await screen.findByRole('switch', { name: 'Forbidden phrase “garanti”' })).closest(
      'li',
    ) as HTMLElement;
    expect(
      within(row).getByText(
        'Anywhere in a word · Only recorded · Language: tr · Every conversation',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Forbidden phrase “garanti”' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/ai-guardrails/phrases/${PHRASE_ID}`, {
        active: false,
      }),
    );
  });
});

describe('what the guardrails caught', () => {
  it('names each rule — a platform rule, the workspace’s rule, a phrase, a deleted one — and quotes the evidence', async () => {
    state.rules = [rule({ id: RULE_ID, title: 'No deposits after a loss' })];
    state.phrases = [phrase({ id: PHRASE_ID, phrase: 'kesin' })];
    state.hits = [
      [
        hit({ id: 'h-1', rule_key: 'G1' }),
        hit({
          id: 'h-2',
          rule_key: `rule:${RULE_ID}`,
          stage: 'output',
          action_taken: 'rewrite',
          evidence: 'depozito yatırın',
        }),
        hit({
          id: 'h-3',
          rule_key: `phrase:${PHRASE_ID}`,
          stage: 'output',
          action_taken: 'safe_text',
          evidence: 'kesin yatar',
        }),
        hit({
          id: 'h-4',
          rule_key: 'rule:99999999-9999-4999-8999-999999999999',
          action_taken: 'warn',
        }),
      ],
    ];
    renderTab();

    const log = (
      await screen.findByRole('heading', { name: 'What the guardrails caught' })
    ).closest('div.flex-col') as HTMLElement;
    const rows = await within(log).findAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0] as HTMLElement).getByText('G1 · Self-exclusion')).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText('Player’s message · Handed over to a person'),
    ).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('hesabımı kapatın')).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('No deposits after a loss'),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText('AI’s reply · Reply rewritten'),
    ).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Phrase “kesin”')).toBeInTheDocument();
    expect(
      within(rows[2] as HTMLElement).getByText(/Safe text sent, handed over/),
    ).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText('A rule that was deleted')).toBeInTheDocument();
  });

  it('links each hit to its conversation in the inbox', async () => {
    state.hits = [[hit({ id: 'h-1', chat_id: 'CHAT0042' })]];
    renderTab();

    const link = await screen.findByRole('link', { name: 'Open the conversation' });
    expect(link).toHaveAttribute('href', '/app/inbox?chat=CHAT0042');
    expect(screen.getByText(/CHAT0042 ·/)).toBeInTheDocument();
  });

  it('asks for the last 30 days a page at a time and loads the next page on request', async () => {
    state.hits = [
      [hit({ id: 'h-1', evidence: 'first page' })],
      [hit({ id: 'h-2', evidence: 'second page' })],
    ];
    const user = userEvent.setup();
    renderTab();

    expect(await screen.findByText('first page')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/ai-guardrails/hits?limit=25');
    expect(screen.queryByText('second page')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('second page')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/ai-guardrails/hits?limit=25&page_id=1');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('filters by rule and by stage on the server', async () => {
    state.rules = [rule({ id: RULE_ID, title: 'No deposits after a loss' })];
    state.hits = [[hit({ id: 'h-1' })]];
    const user = userEvent.setup();
    renderTab();

    await screen.findByText('hesabımı kapatın');
    await user.selectOptions(screen.getByLabelText('Filter by rule'), 'G3');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/ai-guardrails/hits?limit=25&rule_key=G3'),
    );
    await user.selectOptions(screen.getByLabelText('Filter by stage'), 'output');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/ai-guardrails/hits?limit=25&rule_key=G3&stage=output'),
    );
    await user.selectOptions(screen.getByLabelText('Filter by rule'), `rule:${RULE_ID}`);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        `/ai-guardrails/hits?limit=25&rule_key=rule%3A${RULE_ID}&stage=output`,
      ),
    );
  });

  it('shows an empty state when nothing was caught, and a failure with a retry otherwise', async () => {
    renderTab();
    expect(await screen.findByText('Nothing caught')).toBeInTheDocument();
  });

  it('shows a read failure, never the empty state', async () => {
    const original = api.get.getMockImplementation() as (path: string) => Promise<unknown>;
    api.get.mockImplementation((path: string) =>
      path.startsWith('/ai-guardrails/hits') ? Promise.reject(new Error('boom')) : original(path),
    );
    renderTab();

    expect(await screen.findByText('The guardrail log couldn’t be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Nothing caught')).toBeNull();
  });
});
