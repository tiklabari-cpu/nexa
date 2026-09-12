/**
 * The step editor's reorder + required-parameter behaviour (FR-MOD-06.2.4).
 *
 * The negatives lead, because they are the point: a hand-over with no team named
 * must block the save and say so, not be stored and skipped in silence. Then the
 * keyboard reorder — the accessible alternative to drag (NFR-A11Y4) — must
 * actually change the order and announce it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { confirmLeave } from '../../lib/dirty-guard.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { Skill, SkillRun, SkillStep } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { SkillEditor } = await import('./SkillEditor.js');

function makeSkill(steps: SkillStep[], overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    ai_agent_id: 'agent-1',
    name: 'Order help',
    kind: 'ai_agent',
    instruction: 'Help with orders.',
    steps,
    active: false,
    runs_count: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_name: null,
    created_by_id: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<SkillRun> = {}): SkillRun {
  return {
    id: 'run-1',
    chat_id: 'chat-1',
    status: 'succeeded',
    outcome: 'answered',
    ran_at: '2026-02-03T09:30:00.000Z',
    log: [],
    ...overrides,
  };
}

// The run log deep-links to the conversation that set the run off, so the
// editor now needs a router around it.
function renderEditor(
  skill: Skill,
  canEdit = true,
  onSaved: () => void = () => {},
  onDeleted: () => void = () => {},
): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SkillEditor skill={skill} canEdit={canEdit} onSaved={onSaved} onDeleted={onDeleted} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  api.patch.mockResolvedValue(makeSkill([]));
  api.get.mockResolvedValue({ items: [] });
});

/**
 * Steps are collapsed summaries until asked for (FR-MOD-06.2.4), so a test that
 * wants a parameter opens its step first. The disclosure's accessible name is
 * the step's own description — the most useful name the control can have.
 */
async function openStep(
  user: ReturnType<typeof userEvent.setup>,
  description: RegExp,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: description }));
}

describe('SkillEditor — required transfer target', () => {
  it('blocks the save and shows an error when the hand-over team is cleared', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([{ type: 'transfer_to_team', group: 'Support' }]));

    await openStep(user, /Hand over to Support/);
    const team = screen.getByLabelText('Team');
    await user.clear(team);

    // Empty required parameter → named error + a save that refuses.
    expect(screen.getByText(/Choose a team to hand the conversation over to/)).toBeInTheDocument();
    expect(screen.getByText(/Fix 1 step before saving/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('re-enables the save once a team is named again', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([{ type: 'transfer_to_team', group: 'Support' }]));

    await openStep(user, /Hand over to Support/);
    const team = screen.getByLabelText('Team');
    await user.clear(team);
    await user.type(team, 'Billing');

    expect(screen.queryByText(/Fix 1 step before saving/)).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeEnabled();

    await user.click(save);
    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({
        steps: [{ type: 'transfer_to_team', group: 'Billing' }],
      }),
    );
  });
});

describe('SkillEditor — required name (FR-MOD-06.2.2)', () => {
  it('blocks the save and shows a reason when the name is cleared', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([]));

    const name = screen.getByLabelText('Name');
    await user.clear(name);

    expect(screen.getByText('Give the skill a name before saving.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('rejects a name of only whitespace, matching the server’s trim threshold', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([]));

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, '   ');

    expect(screen.getByText('Give the skill a name before saving.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('re-enables the save once a non-blank name is restored, even with surrounding whitespace', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([]));

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, '  a  ');

    // The client must not be stricter than the server: `z.string().trim().min(1)`
    // accepts a name that is non-blank only after trimming.
    expect(screen.queryByText('Give the skill a name before saving.')).not.toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeEnabled();

    await user.click(save);
    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({ name: '  a  ' }),
    );
  });
});

describe('SkillEditor — keyboard reorder', () => {
  const steps: SkillStep[] = [
    { type: 'tag', tag: 'shipping' },
    { type: 'send_message', source: 'text', text: 'On it.' },
  ];

  it('moves a step up from the keyboard and announces it', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill(steps));

    const rowsBefore = screen.getAllByRole('listitem');
    expect(within(rowsBefore[0]!).getByText(/Tag the conversation/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));

    // Order actually changed: the reply is now first.
    const rowsAfter = screen.getAllByRole('listitem');
    expect(within(rowsAfter[0]!).getByText(/Reply/)).toBeInTheDocument();

    // And the move was announced for a screen-reader user.
    expect(screen.getByText(/Moved .* to position 1 of 2/)).toBeInTheDocument();

    // Reordering is a change worth saving.
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('disables the up control on the first step and down on the last', () => {
    renderEditor(makeSkill(steps));
    expect(screen.getByRole('button', { name: 'Move step 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move step 2 down' })).toBeDisabled();
  });

  it('offers no reorder controls without edit permission', () => {
    renderEditor(makeSkill(steps), false);
    expect(screen.queryByRole('button', { name: 'Move step 1 down' })).not.toBeInTheDocument();
  });
});

/**
 * Authoring the step list, not just ordering it (FR-MOD-06.2.4).
 *
 * The first test is the one that closes the requirement: before it, "New skill"
 * created a skill with `steps: []` and nothing in the editor could ever give it
 * one — every parameter but the hand-over team was read-only, and there was no
 * add, no delete and no way to change a step's type. So the assertion is not
 * that a control exists but that a step authored here reaches the `PATCH` body.
 */
describe('SkillEditor — step authoring (FR-MOD-06.2.4)', () => {
  async function addStepOfType(
    user: ReturnType<typeof userEvent.setup>,
    type: string,
  ): Promise<void> {
    await user.selectOptions(screen.getByLabelText('Step type to add'), type);
    await user.click(screen.getByRole('button', { name: 'Add step' }));
  }

  it('gives a skill with no steps one, and saves it', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([]));

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);

    await addStepOfType(user, 'tag');

    // A new step is blank, so it opens on its own: leaving it collapsed would
    // show a refusal with the form that answers it folded away.
    const tag = screen.getByLabelText('Tag');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Name the tag to apply.')).toBeInTheDocument();

    await user.type(tag, 'shipping');

    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeEnabled();
    await user.click(save);

    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({ steps: [{ type: 'tag', tag: 'shipping' }] }),
    );
  });

  /*
   * The six types are covered by two tests rather than one. `userEvent` types a
   * character at a time, and one test that fills in all six ran ~2.5 s alone —
   * long enough to cross vitest's 5 s timeout under the CPU contention of a
   * parallel workspace run, which is a flake this file would have introduced.
   */
  it('authors the two gathering steps with their own parameters', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([]));

    await addStepOfType(user, 'detect_intent');
    await user.type(screen.getByLabelText('Intent'), 'delivery');
    // A phrase with a space in it on purpose: a textarea rendered from
    // `formatPhrases(parsePhrases(text))` trims the trailing space away before
    // the next character arrives, and "my order" comes back "myorder".
    await user.type(screen.getByLabelText('Phrases'), 'my order');

    await addStepOfType(user, 'request_info');
    await user.type(screen.getByLabelText('Information to collect'), 'order_no');
    await user.type(screen.getByLabelText('Question to ask'), 'Which one?');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({
        steps: [
          { type: 'detect_intent', intent: 'delivery', phrases: ['my order'] },
          { type: 'request_info', field: 'order_no', prompt: 'Which one?' },
        ],
      }),
    );
  });

  it('authors the four acting steps with their own parameters', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([]));

    await addStepOfType(user, 'tag');
    await user.type(screen.getByLabelText('Tag'), 'ship');

    // `summarize` is the one type with nothing to fill in, and says so rather
    // than opening onto an empty box.
    await addStepOfType(user, 'summarize');
    expect(screen.getByText('This step takes no settings.')).toBeInTheDocument();

    await addStepOfType(user, 'send_message');
    await user.type(screen.getByLabelText('Reply text'), 'On it.');

    await addStepOfType(user, 'transfer_to_team');
    await user.type(screen.getByLabelText('Team'), 'Support');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({
        steps: [
          { type: 'tag', tag: 'ship' },
          { type: 'summarize' },
          { type: 'send_message', source: 'text', text: 'On it.' },
          { type: 'transfer_to_team', group: 'Support' },
        ],
      }),
    );
  });

  it('drops the old type’s parameters when a step is retyped', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([{ type: 'send_message', source: 'text', text: 'On it.' }]));

    await openStep(user, /Reply “On it/);
    await user.selectOptions(screen.getByLabelText('Step type'), 'tag');

    // The reply box is gone with the type that owned it, and the step now asks
    // for what a tag needs — not a form that edits fields the engine ignores.
    expect(screen.queryByLabelText('Reply text')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Tag'), 'shipping');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // `text`/`source` must be absent, not blank: the server reads the
    // discriminant, and stored leftovers are fields nobody meant to keep.
    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({ steps: [{ type: 'tag', tag: 'shipping' }] }),
    );
  });

  it('switching a message to a knowledge answer drops the fixed text', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([{ type: 'send_message', source: 'text', text: 'On it.' }]));

    await openStep(user, /Reply “On it/);
    await user.selectOptions(screen.getByLabelText('Reply with'), 'knowledge');

    expect(screen.queryByLabelText('Reply text')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({ steps: [{ type: 'send_message', source: 'knowledge' }] }),
    );
  });

  it('deletes a step and saves what is left', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([{ type: 'tag', tag: 'shipping' }, { type: 'summarize' }]));

    await user.click(screen.getByRole('button', { name: 'Delete step 1' }));

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({ steps: [{ type: 'summarize' }] }),
    );
  });

  it('keeps a step open, with its parameters, across a reorder', async () => {
    const user = userEvent.setup();
    renderEditor(
      makeSkill([
        { type: 'tag', tag: 'shipping' },
        { type: 'transfer_to_team', group: 'Support' },
      ]),
    );

    await openStep(user, /Hand over to Support/);
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));

    // Rows key by identity rather than position, so the open step travels with
    // its form — the whole reason a step carries a client id.
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByLabelText('Team')).toHaveValue('Support');
  });

  /**
   * The trap an accordion adds to a drag list: with the row itself draggable,
   * selecting text inside an open step's input starts a drag instead of a
   * selection. Only the handle may be draggable.
   */
  it('makes the handle draggable, not the whole row', () => {
    renderEditor(makeSkill([{ type: 'summarize' }]));

    const row = screen.getAllByRole('listitem')[0]!;
    expect(row).not.toHaveAttribute('draggable');
    expect(row.querySelector('[draggable="true"]')).not.toBeNull();
  });

  it('offers no authoring controls without edit permission', () => {
    renderEditor(makeSkill([{ type: 'tag', tag: 'shipping' }]), false);

    expect(screen.queryByRole('button', { name: 'Add step' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete step 1' })).not.toBeInTheDocument();
    // Nothing is draggable either — the handle is an edit affordance too.
    expect(screen.getAllByRole('listitem')[0]!.querySelector('[draggable="true"]')).toBeNull();
  });
});

describe('SkillEditor — preview (FR-MOD-06.2.5)', () => {
  const steps: SkillStep[] = [
    { type: 'tag', tag: 'shipping' },
    { type: 'summarize' },
    { type: 'transfer_to_team', group: 'Support' },
  ];

  it('narrates the outcome, summary, transfer target, tags and step log', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) => {
      if (path === '/skills/preview') {
        return Promise.resolve({
          outcome: 'handed_off',
          reply: null,
          tags: ['shipping'],
          transfer_to: 'Support',
          summary: 'Customer asked: Where is my order?',
          log: [
            { step: 'tag', detail: 'tagged "shipping"', ok: true },
            { step: 'summarize', detail: 'summary written', ok: true },
            { step: 'transfer_to_team', detail: 'handing over to Support', ok: true },
          ],
          errors: [],
        });
      }
      return Promise.reject(new Error(`unexpected post ${path}`));
    });

    renderEditor(makeSkill(steps));
    await user.click(screen.getByRole('button', { name: 'Run preview' }));

    // The four PRD-named actions: tag, summary, transfer — plus the outcome
    // and the per-step log that narrates how the engine got there.
    expect(await screen.findByText('Would hand over')).toBeInTheDocument();
    expect(screen.getByText('Customer asked: Where is my order?')).toBeInTheDocument();
    expect(screen.getByText('Hands over to Support')).toBeInTheDocument();
    expect(screen.getByText('Tags: shipping')).toBeInTheDocument();
    expect(screen.getByText(/tagged "shipping"/)).toBeInTheDocument();
    expect(screen.getByText(/handing over to Support/)).toBeInTheDocument();
  });

  it('shows an error banner when the preview request fails', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) => {
      if (path === '/skills/preview') return Promise.reject(new Error('boom'));
      return Promise.reject(new Error(`unexpected post ${path}`));
    });

    renderEditor(makeSkill(steps));
    await user.click(screen.getByRole('button', { name: 'Run preview' }));

    expect(await screen.findByText('Could not run the preview.')).toBeInTheDocument();
  });

  it('surfaces engine-reported errors without hiding the rest of the result', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((path: string) => {
      if (path === '/skills/preview') {
        return Promise.resolve({
          outcome: 'skipped',
          reply: null,
          tags: [],
          transfer_to: null,
          summary: null,
          log: [],
          errors: ['Step 1: transfer_to_team requires a group'],
        });
      }
      return Promise.reject(new Error(`unexpected post ${path}`));
    });

    renderEditor(makeSkill(steps));
    await user.click(screen.getByRole('button', { name: 'Run preview' }));

    expect(await screen.findByText('Would do nothing')).toBeInTheDocument();
    expect(screen.getByText('Step 1: transfer_to_team requires a group')).toBeInTheDocument();
  });
});

describe('SkillEditor localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the editor — including a step description — in Turkish', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <SkillEditor
          skill={makeSkill([{ type: 'tag', tag: 'shipping' }])}
          canEdit
          onSaved={() => {}}
          onDeleted={() => {}}
        />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByText('Adımlar')).toBeInTheDocument();
    expect(screen.getByText('Sohbeti “shipping” olarak etiketle')).toBeInTheDocument();
  });
});

/**
 * The editor's top bar (FR-MOD-06.2.1).
 *
 * The PRD counts three things along it that the editor did not have: the run
 * log, the skill's own on/off switch, and a warning before walking away from
 * unsaved work. The run log endpoint had existed and been tested for months
 * with no consumer on the web at all, which is exactly why these assert the
 * rendered panel rather than the request alone.
 */
describe('SkillEditor — run log (FR-MOD-06.2.1)', () => {
  it('lists what the skill did, newest first, once the log is opened', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      items: [
        makeRun({ id: 'run-1', outcome: 'answered' }),
        makeRun({ id: 'run-2', outcome: 'handed_off', chat_id: 'chat-2' }),
        makeRun({ id: 'run-3', status: 'failed', outcome: null, chat_id: null }),
      ],
    });
    renderEditor(makeSkill([], { runs_count: 3 }));

    // Nothing is fetched until it is asked for: an editor that pulls an audit
    // trail on every skill click is an invisible request storm.
    expect(api.get).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '3 runs' }));
    expect(api.get).toHaveBeenCalledWith('/skills/skill-1/runs');

    const log = await screen.findByRole('region', { name: 'Run log' });
    expect(within(log).getByText('Answered')).toBeInTheDocument();
    expect(within(log).getByText('Handed over')).toBeInTheDocument();

    // A run that did not finish is reported by its status, not by an outcome
    // it never got far enough to record.
    expect(within(log).getByText('Failed')).toBeInTheDocument();

    // Each run that has a chat links to it; the failed run has none, so it
    // offers no dead link.
    expect(within(log).getAllByRole('link', { name: 'Open the conversation' })).toHaveLength(2);
    expect(within(log).getAllByRole('link')[0]).toHaveAttribute('href', '/app/inbox?chat=chat-1');
  });

  it('says the skill has never run rather than showing an empty panel', async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({ items: [] });
    renderEditor(makeSkill([]));

    await user.click(screen.getByRole('button', { name: '0 runs' }));

    const log = await screen.findByRole('region', { name: 'Run log' });
    expect(within(log).getByText('This skill has not run yet')).toBeInTheDocument();
    expect(within(log).queryByRole('list')).not.toBeInTheDocument();
  });

  it('reports a run log that could not be loaded', async () => {
    const user = userEvent.setup();
    api.get.mockRejectedValue(new Error('boom'));
    renderEditor(makeSkill([]));

    await user.click(screen.getByRole('button', { name: '0 runs' }));

    expect(await screen.findByText('Could not load the run log.')).toBeInTheDocument();
  });
});

describe('SkillEditor — active toggle (FR-MOD-06.2.1)', () => {
  it('sends the same PATCH the list row sends', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([], { active: false }));

    await user.click(screen.getByRole('button', { name: 'Enable' }));

    expect(api.patch).toHaveBeenCalledWith('/skills/skill-1', { active: true });
  });

  it('offers to turn a live skill off', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([], { active: true }));

    await user.click(screen.getByRole('button', { name: 'Disable' }));

    expect(api.patch).toHaveBeenCalledWith('/skills/skill-1', { active: false });
  });

  it('falls back to the previous state and says why when the toggle is rejected', async () => {
    const user = userEvent.setup();
    api.patch.mockRejectedValue(new Error('nope'));
    renderEditor(makeSkill([], { active: false }));

    await user.click(screen.getByRole('button', { name: 'Enable' }));

    // The label still offers to enable — the skill is still off, as the server
    // left it — and the failure is named rather than swallowed.
    expect(await screen.findByText('Something went wrong — try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
  });

  it('offers no toggle without edit permission', () => {
    renderEditor(makeSkill([]), false);
    expect(screen.queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument();
    // The state is still readable — only changing it is withheld.
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
});

describe('SkillEditor — leaving with unsaved changes (FR-MOD-06.2.1)', () => {
  it('does not ask before anything has been edited', () => {
    const confirm = vi.fn(() => false);
    renderEditor(makeSkill([]));

    expect(confirmLeave(confirm)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before leaving once the skill has been edited', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    renderEditor(makeSkill([]));

    await user.type(screen.getByLabelText('Name'), '!');

    expect(confirmLeave(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith('This skill has unsaved changes. Leave and discard them?');
  });

  /**
   * The trap this closes: `onSaved` only *starts* the parent's refetch. Until
   * it lands the `skill` prop still describes the old row, so an editor that
   * measured dirtiness against the prop alone would warn about discarding a
   * skill that was saved a moment ago.
   */
  it('stops asking once the edit has been saved, before the refetch lands', async () => {
    const user = userEvent.setup();
    const confirm = vi.fn(() => false);
    const skill = makeSkill([]);
    renderEditor(skill);

    await user.type(screen.getByLabelText('Name'), '!');
    expect(confirmLeave(confirm)).toBe(false);

    const save = screen.getByRole('button', { name: 'Save changes' });
    await user.click(save);
    expect(api.patch).toHaveBeenCalledWith(
      '/skills/skill-1',
      expect.objectContaining({ name: 'Order help!' }),
    );
    // Settling back to disabled is the editor saying it has nothing left to save.
    await waitFor(() => expect(save).toBeDisabled());

    // The prop is deliberately still the pre-save skill, as it would be mid-refetch.
    expect(confirmLeave(confirm)).toBe(true);
  });
});

/**
 * Delete (tm 246) — the gap the endpoint-ui audit tracked: a skill could be
 * created, edited and toggled off, but never removed, so the list only ever
 * grew. Asks through a `Modal` (not the inline swap the KB article editor
 * uses) since this screen is not itself nested inside one.
 */
describe('SkillEditor — delete (tm 246)', () => {
  it('asks before deleting, and sends nothing when the dialog is cancelled', async () => {
    const user = userEvent.setup();
    renderEditor(makeSkill([]));

    await user.click(screen.getByRole('button', { name: 'Delete skill' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Order help');
    expect(api.delete).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Never mind' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('deletes only once the dialog is confirmed, and tells the parent', async () => {
    api.delete.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderEditor(makeSkill([]), true, () => {}, onDeleted);

    await user.click(screen.getByRole('button', { name: 'Delete skill' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete for good' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/skills/skill-1'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });

  it('reports a failed delete on the dialog rather than closing it', async () => {
    api.delete.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    renderEditor(makeSkill([]), true, () => {}, onDeleted);

    await user.click(screen.getByRole('button', { name: 'Delete skill' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete for good' }));

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('offers no delete control without edit permission', () => {
    renderEditor(makeSkill([]), false);
    expect(screen.queryByRole('button', { name: 'Delete skill' })).not.toBeInTheDocument();
  });
});
