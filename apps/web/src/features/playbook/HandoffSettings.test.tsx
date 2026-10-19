/**
 * The hand-over settings of the AI agent (tm 303.5 · AI-09, K9): the triggers
 * card (locked ones greyed, thresholds, who answers first), the messages by
 * reason, and the default "solved" criteria. The rules list has its own file.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_HANDOFF_TRIGGERS } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { HandoffRuleList, HandoffSettings as Settings } from './handoff.js';
import type { AiAgent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { HandoffSettings } = await import('./HandoffSettings.js');

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

const SETTINGS: Settings = {
  ai_agent_id: 'agent-1',
  assignment_mode: 'parallel',
  ai_stall_timeout_seconds: 60,
  triggers: structuredClone(DEFAULT_HANDOFF_TRIGGERS) as Settings['triggers'],
  messages: { abuse: 'Please keep it kind.' },
  after_hours: { text: null },
  resolution_criteria: null,
};

const RULES: HandoffRuleList = {
  ai_agent_id: 'agent-1',
  locked: [],
  items: [],
  examples: [],
};

function renderCard(canEdit = true, locale?: 'tr'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={queryClient}>
      <HandoffSettings agent={AGENT} skills={[]} canEdit={canEdit} />
    </QueryClientProvider>
  );
  if (locale) renderWithLocale(ui, locale);
  else render(ui);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation((path: string) =>
    Promise.resolve(
      path.endsWith('/handoff-rules') ? RULES : path === '/groups' ? { items: [] } : SETTINGS,
    ),
  );
  api.put.mockImplementation((_path: string, body: Partial<Settings>) =>
    Promise.resolve({ ...SETTINGS, ...body }),
  );
});

afterEach(() => resetLocale());

const SETTINGS_PATH = '/ai-agents/agent-1/handoff-settings';

function card(name: string): HTMLElement {
  return screen.getByRole('form', { name });
}

describe('HandoffSettings — the triggers (AI-09)', () => {
  it('lists the locked hand-overs ticked and unchangeable, apart from the ones to tune', async () => {
    renderCard();

    const triggers = await screen.findByRole('form', { name: 'When the agent hands over' });
    const locked = within(within(triggers).getByRole('region', { name: 'Always on' }));
    for (const name of ['Self-harm signals', 'Responsible gaming signals', 'Abuse']) {
      const box = locked.getByRole('checkbox', { name });
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    }
    expect(within(triggers).getByLabelText('Turns in a row')).toHaveValue('2');
    expect(within(triggers).getByLabelText('Turns per procedure')).toHaveValue('12');
    expect(within(triggers).getByRole('checkbox', { name: 'Not understood' })).toBeChecked();
  });

  it('saves a changed threshold with every trigger the card shows, and nothing else', async () => {
    const user = userEvent.setup();
    renderCard();

    const triggers = await screen.findByRole('form', { name: 'When the agent hands over' });
    const save = within(triggers).getByRole('button', { name: 'Save triggers' });
    expect(save).toBeDisabled();

    const turns = within(triggers).getByLabelText('Turns per procedure');
    await user.clear(turns);
    await user.type(turns, '20');
    await user.click(save);

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith(SETTINGS_PATH, {
      assignment_mode: 'parallel',
      triggers: {
        ...DEFAULT_HANDOFF_TRIGGERS,
        max_turns: { enabled: true, turns: 20 },
      },
    });
  });

  it('refuses a count outside its bounds before anything is sent', async () => {
    const user = userEvent.setup();
    renderCard();

    const triggers = await screen.findByRole('form', { name: 'When the agent hands over' });
    const turns = within(triggers).getByLabelText('Turns in a row');
    await user.clear(turns);
    await user.type(turns, '99');

    expect(within(triggers).getByRole('button', { name: 'Save triggers' })).toBeDisabled();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('turns a trigger off and keeps its threshold from being edited', async () => {
    const user = userEvent.setup();
    renderCard();

    const triggers = await screen.findByRole('form', { name: 'When the agent hands over' });
    await user.click(within(triggers).getByRole('checkbox', { name: 'A loop' }));
    await user.click(within(triggers).getByRole('checkbox', { name: 'Too many turns' }));
    expect(within(triggers).getByLabelText('Turns per procedure')).toBeDisabled();
    await user.click(within(triggers).getByRole('button', { name: 'Save triggers' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0]![1].triggers).toMatchObject({
      loop_detected: { enabled: false },
      max_turns: { enabled: false, turns: 12 },
    });
  });

  it('asks for the wait only while the agent answers first', async () => {
    const user = userEvent.setup();
    renderCard();

    const triggers = await screen.findByRole('form', { name: 'When the agent hands over' });
    expect(within(triggers).queryByLabelText('Seconds a player may wait on the agent')).toBeNull();

    await user.click(within(triggers).getByRole('radio', { name: /The agent answers first/ }));
    const wait = within(triggers).getByLabelText('Seconds a player may wait on the agent');
    expect(wait).toHaveValue('60');
    await user.clear(wait);
    await user.type(wait, '90');
    await user.click(within(triggers).getByRole('button', { name: 'Save triggers' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0]![1]).toMatchObject({
      assignment_mode: 'ai_first',
      ai_stall_timeout_seconds: 90,
    });
  });

  it('says in words that a locked hand-over cannot be changed, and not what the server wrote', async () => {
    api.put.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'raw english from the server',
        requestId: 'r-1',
        details: { reason: 'handoff_trigger_locked', trigger: 'abuse' },
      }),
    );
    const user = userEvent.setup();
    renderCard();

    const triggers = await screen.findByRole('form', { name: 'When the agent hands over' });
    await user.click(within(triggers).getByRole('checkbox', { name: 'A loop' }));
    await user.click(within(triggers).getByRole('button', { name: 'Save triggers' }));

    expect(await within(triggers).findByRole('alert')).toHaveTextContent(
      'That hand-over is locked on and cannot be changed.',
    );
  });

  it('shows a person without the AI scope the settings, with nothing to save', async () => {
    renderCard(false);

    const triggers = await screen.findByRole('form', { name: 'When the agent hands over' });
    expect(within(triggers).getByRole('checkbox', { name: 'A loop' })).toBeDisabled();
    expect(within(triggers).queryByRole('button', { name: 'Save triggers' })).toBeNull();
    expect(
      within(triggers).getByText('Only people with AI agent access can change these settings.'),
    ).toBeInTheDocument();
  });
});

describe('HandoffSettings — what the player is told (AI-09)', () => {
  it('shows the default sentence as a placeholder and marks the reasons with one of their own', async () => {
    renderCard();

    const messages = await screen.findByRole('form', { name: 'What the player is told' });
    const abuse = within(messages).getByLabelText('Hand-over message: Abuse');
    expect(abuse).toHaveValue('Please keep it kind.');
    const unsupported = within(messages).getByLabelText(
      'Hand-over message: A language the agent does not speak',
    );
    expect(unsupported).toHaveValue('');
    expect(unsupported).toHaveAttribute('placeholder', expect.stringMatching(/\w/));
    expect(within(messages).getAllByText('custom')).toHaveLength(1);
  });

  it('sends only the sentence that changed, and null for one that was cleared', async () => {
    const user = userEvent.setup();
    renderCard();

    const messages = await screen.findByRole('form', { name: 'What the player is told' });
    await user.clear(within(messages).getByLabelText('Hand-over message: Abuse'));
    await user.type(
      within(messages).getByLabelText('Hand-over message: Not understood'),
      'I will find someone who can help.',
    );
    await user.type(
      within(messages).getByLabelText('When nobody is available'),
      'We are back at nine.',
    );
    await user.click(within(messages).getByRole('button', { name: 'Save messages' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith(SETTINGS_PATH, {
      messages: { abuse: null, not_understood: 'I will find someone who can help.' },
      after_hours: { text: 'We are back at nine.' },
    });
  });

  it('stops a sentence over 500 characters before it is sent', async () => {
    const user = userEvent.setup();
    renderCard();

    const messages = await screen.findByRole('form', { name: 'What the player is told' });
    const field = within(messages).getByLabelText('Hand-over message: Not understood');
    await user.click(field);
    await user.paste('x'.repeat(501));

    expect(within(messages).getByRole('button', { name: 'Save messages' })).toBeDisabled();
    expect(within(messages).getByText('501 / 500 characters')).toBeInTheDocument();
  });
});

describe('HandoffSettings — the default solved criteria (AI-09 · K9)', () => {
  it('starts on the platform’s default: the player’s yes', async () => {
    renderCard();

    const resolution = await screen.findByRole('form', { name: 'Solved criteria' });
    expect(
      within(resolution).getByRole('checkbox', {
        name: 'Use my own criteria instead of the platform’s',
      }),
    ).not.toBeChecked();
    expect(within(resolution).getByText(/The platform’s default applies/)).toBeInTheDocument();
    expect(within(resolution).getByRole('button', { name: 'Save criteria' })).toBeDisabled();
  });

  it('saves the criteria the admin writes instead of the platform’s', async () => {
    const user = userEvent.setup();
    renderCard();

    const resolution = await screen.findByRole('form', { name: 'Solved criteria' });
    await user.click(
      within(resolution).getByRole('checkbox', {
        name: 'Use my own criteria instead of the platform’s',
      }),
    );
    expect(within(resolution).getByLabelText('Compare')).toHaveValue('confirmed');
    // Same as the default: nothing to save yet.
    await user.selectOptions(within(resolution).getByLabelText('Compare'), 'ai');
    await user.type(within(resolution).getByLabelText('Question'), 'Is the player satisfied?');
    await user.click(within(resolution).getByRole('button', { name: 'Save criteria' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith(SETTINGS_PATH, {
      resolution_criteria: { ai: { question: 'Is the player satisfied?' } },
    });
  });

  it('offers no kind that reads a procedure’s slots', async () => {
    const user = userEvent.setup();
    renderCard();

    const resolution = await screen.findByRole('form', { name: 'Solved criteria' });
    await user.click(
      within(resolution).getByRole('checkbox', {
        name: 'Use my own criteria instead of the platform’s',
      }),
    );
    const kinds = within(within(resolution).getByLabelText('Compare')).getAllByRole('option');
    expect(kinds.map((option) => (option as HTMLOptionElement).value)).toStrictEqual([
      'confirmed',
      'ai',
      'json',
    ]);
  });

  it('shows a stored criteria and clears it with null', async () => {
    const stored = { ai: { question: 'Is the player satisfied?' } };
    api.get.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/handoff-rules')
          ? RULES
          : path === '/groups'
            ? { items: [] }
            : { ...SETTINGS, resolution_criteria: stored },
      ),
    );
    const user = userEvent.setup();
    renderCard();

    const resolution = await screen.findByRole('form', { name: 'Solved criteria' });
    expect(within(resolution).getByLabelText('Question')).toHaveValue('Is the player satisfied?');
    await user.click(
      within(resolution).getByRole('checkbox', {
        name: 'Use my own criteria instead of the platform’s',
      }),
    );
    await user.click(within(resolution).getByRole('button', { name: 'Save criteria' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith(SETTINGS_PATH, { resolution_criteria: null });
  });

  it('words a refused criteria as the procedure problem it is', async () => {
    api.put.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'raw english from the server',
        requestId: 'r-1',
        details: {
          reason: 'procedure_bad_condition',
          section: 'handoff',
          field: 'resolution_criteria',
        },
      }),
    );
    const user = userEvent.setup();
    renderCard();

    const resolution = await screen.findByRole('form', { name: 'Solved criteria' });
    await user.click(
      within(resolution).getByRole('checkbox', {
        name: 'Use my own criteria instead of the platform’s',
      }),
    );
    await user.selectOptions(within(resolution).getByLabelText('Compare'), 'ai');
    await user.type(within(resolution).getByLabelText('Question'), 'x');
    await user.click(within(resolution).getByRole('button', { name: 'Save criteria' }));

    expect(await within(resolution).findByRole('alert')).toHaveTextContent(
      'The condition is not complete.',
    );
  });
});

describe('HandoffSettings localisation (NFR-I18N2)', () => {
  it('paints the cards in Turkish when that is the active locale', async () => {
    renderCard(true, 'tr');

    expect(await screen.findByRole('form', { name: 'Ajan ne zaman devreder' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Oyuncuya ne söylenir' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Çözüldü kriterleri' })).toBeInTheDocument();
    expect(card('Ajan ne zaman devreder')).toBeInTheDocument();
  });
});
