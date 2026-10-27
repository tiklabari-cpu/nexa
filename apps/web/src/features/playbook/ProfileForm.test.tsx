/**
 * The persona form's contract (FR-MOD-06.4): a required name gates Save, edits
 * flow to the live preview, and a change to any persona field — including the
 * multi-select languages — makes the form dirty enough to save.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPersona, shapeAnswer } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { AiAgent } from './types.js';

const { api } = vi.hoisted(() => ({ api: { patch: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ProfileForm, PERSONA_PREVIEW_PASSAGES } = await import('./ProfileForm.js');

const AGENT: AiAgent = {
  id: 'agent-1',
  name: 'Ada',
  kind: 'ai_agent',
  tone: 'friendly',
  avatar_url: null,
  languages: ['en'],
  answer_length: 'short',
  batch_window_seconds: null,
  active: true,
  skills_count: 2,
};

function renderForm(agent: AiAgent = AGENT, canEdit = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ProfileForm agent={agent} canEdit={canEdit} onSaved={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.patch.mockReset();
  api.patch.mockResolvedValue(AGENT);
});

describe('ProfileForm', () => {
  it('disables Save until a change is made', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('disables Save and shows an error when the required name is cleared', async () => {
    const user = userEvent.setup();
    renderForm();

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.tab(); // blur to surface the error

    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    expect(screen.getByText(/Give the assistant a name/)).toBeInTheDocument();
  });

  it('enables Save once a field changes and PATCHes the persona', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Answer length'), 'long');
    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(save).toBeEnabled();

    await user.click(save);
    expect(api.patch).toHaveBeenCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ answer_length: 'long', name: 'Ada' }),
    );
  });

  it('offers the batch window as the workspace default, an immediate answer, or 1–10 seconds', () => {
    renderForm();

    const select = screen.getByLabelText('Wait for the visitor to stop typing');
    const options = Array.from(select.querySelectorAll('option')).map((o) => [o.value, o.text]);
    expect(options[0]).toEqual(['', 'Workspace default']);
    expect(options[1]).toEqual(['0', 'Answer at once']);
    expect(options[2]).toEqual(['1', '1 second']);
    expect(options.at(-1)).toEqual(['10', '10 seconds']);
    expect(options).toHaveLength(12);
    // No value saved: the default is the one shown.
    expect(select).toHaveValue('');
  });

  it('PATCHes the batch window as whole seconds, and 0 is not the default', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, batch_window_seconds: 3 });

    const select = screen.getByLabelText('Wait for the visitor to stop typing');
    expect(select).toHaveValue('3');
    await user.selectOptions(select, '0');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ batch_window_seconds: 0 }),
    );
  });

  it('clears the batch window back to the workspace default with null', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, batch_window_seconds: 5 });

    await user.selectOptions(screen.getByLabelText('Wait for the visitor to stop typing'), '');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ batch_window_seconds: null }),
    );
  });

  it('shows same-day memory on, recalling an unresolved topic, when the agent never set it (tm 294)', () => {
    renderForm();

    expect(
      screen.getByLabelText("Remember the visitor's earlier conversations today"),
    ).toBeChecked();
    const recall = screen.getByLabelText('Bring the earlier conversation up');
    expect(recall).toHaveValue('auto_if_unresolved');
    expect(Array.from(recall.querySelectorAll('option')).map((o) => o.value)).toEqual([
      'auto_if_unresolved',
      'on_topic_only',
    ]);
  });

  it('PATCHes same-day memory only when it changed, both fields together (tm 294)', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(
      screen.getByLabelText('Bring the earlier conversation up'),
      'on_topic_only',
    );
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(api.patch).toHaveBeenLastCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ daily_memory: { enabled: true, recall: 'on_topic_only' } }),
    );
  });

  it('leaves same-day memory out of a save that did not touch it (tm 294)', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.selectOptions(screen.getByLabelText('Answer length'), 'long');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(api.patch.mock.calls.at(-1)![1]).not.toHaveProperty('daily_memory');
  });

  it('turns same-day memory off and greys the recall choice out (tm 294)', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, daily_memory: { enabled: true, recall: 'on_topic_only' } });

    await user.click(screen.getByLabelText("Remember the visitor's earlier conversations today"));
    expect(screen.getByLabelText('Bring the earlier conversation up')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ daily_memory: { enabled: false, recall: 'on_topic_only' } }),
    );
  });

  it('shows the clarifying thresholds at 0.70 and 0.40 when the agent never set them (tm 297.2)', () => {
    renderForm();
    expect(screen.getByLabelText('Start a procedure at')).toHaveValue('0.70');
    expect(screen.getByLabelText('Ask which one from')).toHaveValue('0.40');
  });

  it('PATCHes the thresholds as a pair, only when one changed (AI-05 §4)', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, clarify_thresholds: { high: 0.72, low: 0.4 } });
    // A stored value off the 0.05 grid is still a choice.
    expect(screen.getByLabelText('Start a procedure at')).toHaveValue('0.72');
    await user.selectOptions(screen.getByLabelText('Ask which one from'), '0.50');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(api.patch).toHaveBeenLastCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ clarify_thresholds: { high: 0.72, low: 0.5 } }),
    );
  });

  it('refuses a pair that leaves no room to ask: an error, and no Save', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText('Ask which one from'), '0.80');
    expect(screen.getByText('The second number must be below the first.')).toBeInTheDocument();
    expect(screen.getByLabelText('Start a procedure at')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('leaves the thresholds out of a save that did not touch them', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(api.patch.mock.calls.at(-1)![1]).not.toHaveProperty('clarify_thresholds');
  });

  it('reflects the name in the live preview as it is typed', async () => {
    const user = userEvent.setup();
    renderForm();

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Nova');

    // The preview panel renames with the field.
    expect(screen.getByText('Nova')).toBeInTheDocument();
  });

  it('toggles a language and treats it as a change worth saving', async () => {
    const user = userEvent.setup();
    renderForm();

    const german = screen.getByRole('switch', { name: 'Deutsch' });
    expect(german).toHaveAttribute('aria-checked', 'false');
    await user.click(german);
    expect(german).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeEnabled();
  });

  it('is read-only without edit permission', () => {
    renderForm(AGENT, false);
    expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    // The preview still renders so a viewer sees the current persona.
    const previews = screen.getAllByText('Ada');
    expect(previews.length).toBeGreaterThan(0);
  });
});

describe('PersonaPreview shapes a sample reply with the same helper as the engine (FR-MOD-06.4)', () => {
  it('shows exactly what shapeAnswer(readPersona(...)) produces for the current fields', () => {
    // Not a second, hand-rolled approximation of the rule: the same functions
    // the engine calls (`conversation-engine.ts`), given the same persona shape, must
    // produce the exact string this component renders.
    renderForm({ ...AGENT, tone: 'friendly', languages: ['en'], answer_length: 'short' });

    const persona = readPersona({ tone: 'friendly', languages: ['en'], answerLength: 'short' });
    const expected = shapeAnswer(PERSONA_PREVIEW_PASSAGES, persona, { language: 'en' }).text;

    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('grows the sample reply when answer length changes from short to long', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, tone: null, languages: ['en'], answer_length: 'short' });

    const shortPersona = readPersona({ languages: ['en'], answerLength: 'short' });
    const shortReply = shapeAnswer(PERSONA_PREVIEW_PASSAGES, shortPersona, { language: 'en' }).text;
    expect(screen.getByText(shortReply)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Answer length'), 'long');

    const longPersona = readPersona({ languages: ['en'], answerLength: 'long' });
    const longReply = shapeAnswer(PERSONA_PREVIEW_PASSAGES, longPersona, { language: 'en' }).text;
    expect(screen.getByText(longReply)).toBeInTheDocument();
    expect(longReply.length).toBeGreaterThan(shortReply.length);
  });
});

describe('ProfileForm style (tm 299.2 · AI-07)', () => {
  it('shows an agent that never set a style as unset, with 2 questions as the default', () => {
    renderForm();

    expect(screen.getByLabelText('Address the player as')).toHaveValue('');
    expect(screen.getByLabelText('Emoji')).toHaveValue('');
    const questions = screen.getByLabelText('Questions per message');
    expect(questions).toHaveValue('');
    expect(Array.from(questions.querySelectorAll('option')).map((o) => o.value)).toEqual([
      '',
      '1',
      '2',
      '3',
    ]);
  });

  it('PATCHes the three style fields, and only those that changed', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, emoji: 'few' });

    await user.selectOptions(screen.getByLabelText('Address the player as'), 'sen');
    await user.selectOptions(screen.getByLabelText('Questions per message'), '1');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    const body = api.patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).toMatchObject({ address_form: 'sen', max_questions_per_message: 1 });
    expect(body).not.toHaveProperty('emoji');
  });

  it('clears a style back to unset with null', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, address_form: 'siz', emoji: 'none', max_questions_per_message: 3 });

    expect(screen.getByLabelText('Address the player as')).toHaveValue('siz');
    expect(screen.getByLabelText('Emoji')).toHaveValue('none');
    expect(screen.getByLabelText('Questions per message')).toHaveValue('3');
    await user.selectOptions(screen.getByLabelText('Address the player as'), '');
    await user.selectOptions(screen.getByLabelText('Emoji'), '');
    await user.selectOptions(screen.getByLabelText('Questions per message'), '');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ address_form: null, emoji: null, max_questions_per_message: null }),
    );
  });

  it('sends no style field when only the name changed', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, address_form: 'siz' });

    await user.type(screen.getByLabelText('Name'), '2');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    const body = api.patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('address_form');
    expect(body).not.toHaveProperty('emoji');
    expect(body).not.toHaveProperty('max_questions_per_message');
  });

  it('locks the style selects for a reader without edit rights', () => {
    renderForm({ ...AGENT, emoji: 'few' }, false);

    expect(screen.getByLabelText('Emoji')).toBeDisabled();
    expect(screen.getByLabelText('Questions per message')).toBeDisabled();
  });
});

describe('ProfileForm localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the form in Turkish when that is the active locale', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <ProfileForm agent={AGENT} canEdit onSaved={() => {}} />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByRole('button', { name: 'Profili kaydet' })).toBeInTheDocument();
  });
});

describe('ProfileForm opening message and agent button (tm 308 · AI-29)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('shows the locked disclosure before the opening words, as the first reply will', async () => {
    const user = userEvent.setup();
    renderForm();

    const preview = screen.getByTestId('ai-opening-preview');
    expect(preview).toHaveTextContent('Always first — cannot be removed');
    expect(preview).toHaveTextContent('I am Ada, Brand’s AI assistant.');

    await user.type(screen.getByLabelText('Opening message'), 'How can I help?');
    expect(preview).toHaveTextContent('I am Ada, Brand’s AI assistant. How can I help?');
    // Words that drop the sentence do not drop it from the preview either.
    await user.clear(screen.getByLabelText('Opening message'));
    await user.type(screen.getByLabelText('Opening message'), 'Hi!');
    expect(preview).toHaveTextContent('I am Ada, Brand’s AI assistant. Hi!');
  });

  it('PATCHes the opening words and the button text, and clears them with null', async () => {
    const user = userEvent.setup();
    renderForm({ ...AGENT, welcome_message: 'Hello.', human_button_label: null });

    await user.clear(screen.getByLabelText('Opening message'));
    await user.type(screen.getByLabelText('Text of the “Talk to an agent” button'), 'Live support');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/ai-agents/agent-1',
      expect.objectContaining({ welcome_message: null, human_button_label: 'Live support' }),
    );
  });

  it('sends neither when only the name changed', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText('Name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    const body = api.patch.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('welcome_message');
    expect(body).not.toHaveProperty('human_button_label');
  });

  it('says the sentence in Turkish for a Turkish console', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <ProfileForm agent={AGENT} canEdit onSaved={() => {}} />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByTestId('ai-opening-preview')).toHaveTextContent(
      "Ada, Marka'nın yapay zekâ asistanıyım.",
    );
    expect(screen.getByLabelText('“Temsilciyle görüş” butonunun metni')).toHaveAttribute(
      'placeholder',
      'Temsilciyle görüş',
    );
  });
});
