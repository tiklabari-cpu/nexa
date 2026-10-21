/**
 * The procedure skill editor (AI-03 · tm 296.5): the sections, the save gate,
 * SOP drafts and the multi-turn preview.
 *
 * The refusals lead, one per AI-03 acceptance line: a save must refuse a goto
 * to a step that is not there, a loop that asks nothing, a three-slot collect,
 * an undefined template variable, a "şifre" slot and a team the workspace does
 * not have — and say which, in place, before anything reaches the server.
 */
import { splitSkillProcedure, validateSkillProcedure, type ProcStep } from '@siyahtus/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import { resetLocale, setLocale } from '../../test/i18n.js';
import { depositProcedureFields } from '../../test/procedure-fixtures.js';
import type { Skill, SkillPreview } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { SkillEditor } = await import('./SkillEditor.js');

// The §3.1 procedure renders 19 steps and five sections, and these tests find
// things by role across that tree — 1–3 s each on an idle machine, and the
// first one went past the default 5 s inside the full DoD gate, where every
// package's suite runs at once (as `auth-store.test.ts` measured, tm 259.1).
// 20 s was not enough either: the first test, which also pays for the first
// render, timed out at 20 s in the tm 311.3 gate.
vi.setConfig({ testTimeout: 60_000 });

function depositRow() {
  const result = validateSkillProcedure(depositProcedureFields());
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return splitSkillProcedure(result.procedure);
}

function procedureSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skill-1',
    ai_agent_id: 'agent-1',
    name: 'Yatırım geçmedi',
    kind: 'ai_agent',
    instruction: 'Yöntem ve saati sor, süreyle karşılaştır.',
    steps: [],
    active: false,
    runs_count: 0,
    updated_at: '2026-10-18T00:00:00.000Z',
    created_by_name: null,
    created_by_id: null,
    mode: 'procedure',
    ...depositRow(),
    locked: false,
    template_key: null,
    template_version: null,
    is_fallback: false,
    ...overrides,
  };
}

/** A two-step procedure, for the refusals the deposit one cannot show. */
function smallSkill(steps: ProcStep[], extra: Partial<Skill> = {}): Skill {
  return procedureSkill({
    when_to_use: 'Oyuncu yatırımının geçmediğini söylüyor.',
    examples: [],
    priority: 100,
    slots: [
      {
        name: 'yontem',
        label: 'Yöntem',
        type: 'text',
        ask: 'Hangi yöntem?',
        required: 'always',
        pii: 'none',
        show_in_card: true,
        max_attempts: 2,
        confirm: 'never',
      },
    ],
    procedure: {
      steps,
      templates: [],
      handoff: { conditions: [], card_fields: [] },
      limits: { max_turns: 12 },
    },
    ...extra,
  });
}

function renderEditor(
  skill: Skill,
  props: { isNew?: boolean; onCreated?: (skill: Skill) => void } = {},
): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <SkillEditor
          skill={skill}
          canEdit
          onSaved={() => {}}
          onDeleted={() => {}}
          isNew={props.isNew}
          onCreated={props.onCreated}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function stepList(): HTMLElement {
  return screen.getByRole('list', { name: 'Steps' });
}

async function openStep(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
): Promise<HTMLElement> {
  const toggle = within(stepList()).getByRole('button', { name });
  await user.click(toggle);
  return toggle.closest('li') as HTMLElement;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === '/groups' ? { items: [{ id: 1, name: 'Finans' }] } : { items: [] }),
  );
  api.patch.mockResolvedValue(procedureSkill());
});

afterEach(() => resetLocale());

describe('SkillEditor — a procedure skill opens on its sections', () => {
  it('shows when to use, examples, priority, information, steps, templates and hand-over', () => {
    renderEditor(procedureSkill());

    for (const name of [
      'When to use',
      'Information to collect',
      'Steps',
      'Reply templates',
      'Hand-over',
    ]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByLabelText('When to use it')).toHaveValue(
      'Oyuncu yaptığı yatırımın hesabına geçmediğini söylüyor.',
    );
    expect(screen.getByLabelText('Example sentences')).toHaveValue(
      'param yatmadı\nhavale attım gözükmüyor\nusdt gönderdim gelmedi',
    );
    expect(screen.getByLabelText('Priority')).toHaveValue('50');
    expect(within(stepList()).getAllByRole('listitem')).toHaveLength(19);
    expect(within(stepList()).getByText(/Say the “giris” template/)).toBeInTheDocument();
    // The text is the SOP a draft is compiled from.
    expect(screen.getByLabelText('Procedure text (SOP)')).toBeInTheDocument();
    // Nothing edited, nothing wrong: no refusal, nothing to save.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

describe('SkillEditor — the save refuses what AI-03 lists, and says where', () => {
  it('a template variable that is not collected, a table value or a function', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    const template = screen.getByRole('listitem', { name: 'giris' });
    await user.type(within(template).getByLabelText('Text'), ' {{bilinmeyen}');

    expect(
      within(template).getByText(
        /“bilinmeyen” is not collected information, a table value or a function/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Fix 1 problem before saving.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('a step that asks for three pieces of information at once', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    const step = await openStep(user, /Ask for yontem, islem_zamani/);
    await user.click(within(step).getByRole('checkbox', { name: 'tutar' }));

    expect(
      within(step).getByText('A step asks for at most 2 pieces of information at once.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('a slot that asks for a password', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    await user.click(screen.getByRole('button', { name: 'Add information' }));
    const slots = within(screen.getByRole('list', { name: 'Information to collect' }));
    // Named by its label, which a new one does not have yet.
    const added = slots.getByRole('listitem', { name: 'Information' });
    await user.type(within(added).getByLabelText('Key'), 'sifre');
    await user.type(within(added).getByLabelText('Label'), 'Şifre');
    await user.type(within(added).getByLabelText('Question to ask'), 'Şifrenizi yazar mısınız?');

    // Both the label and the question read as asking for one; each is named.
    expect(
      within(added).getAllByText(/This asks for something the AI must never collect/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('a branch that goes to a step that is no longer there', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    const steps = within(stepList()).getAllByRole('listitem');
    const waitIndex = steps.findIndex((li) => li.textContent?.includes('normal_sure'));
    await user.click(screen.getByRole('button', { name: `Delete step ${waitIndex + 1}` }));

    expect(
      within(stepList()).getByText('Goes to “bekleme”, which is not a step.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('a branch back to an earlier step with nothing asked on the way', () => {
    renderEditor(
      smallSkill([
        { id: 'bilgi', type: 'say', instruction: 'Bakıyorum.' },
        {
          id: 'kontrol',
          type: 'check',
          when: { slot: { name: 'yontem', op: 'exists' } },
          then: { goto: 'bilgi' },
        },
      ]),
    );

    expect(
      within(stepList()).getByText(/Goes back to an earlier step without asking anything/),
    ).toBeInTheDocument();
  });

  it('a hand-over to a team the workspace does not have', async () => {
    renderEditor(
      smallSkill([
        { id: 'sor', type: 'collect', slots: ['yontem'] },
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance', target: { group_id: 99 } },
      ]),
    );

    // Judged once the workspace's teams are in.
    expect(
      await within(stepList()).findByText('That team is not in this workspace any more.'),
    ).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/groups');
  });

  it('a refusal the client did not foresee is worded from the server’s code', async () => {
    const user = userEvent.setup();
    api.patch.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'step devir: team 1 does not exist',
        requestId: 'rq-1',
        details: {
          reason: 'procedure_unknown_target',
          section: 'steps',
          position: 2,
          step_id: 'devir',
          reference: '1',
        },
      }),
    );
    renderEditor(
      smallSkill([
        { id: 'sor', type: 'collect', slots: ['yontem'] },
        { id: 'devir', type: 'handoff', reason_code: 'needs_finance', target: { group_id: 1 } },
      ]),
    );

    await user.type(screen.getByLabelText('When to use it'), ' Acil.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Step 2 (devir): That team is not in this workspace any more.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/does not exist/)).not.toBeInTheDocument();
  });
});

describe('SkillEditor — saving a procedure', () => {
  it('sends the definition with its mode, unchanged parts as they were', async () => {
    const user = userEvent.setup();
    const row = depositRow();
    renderEditor(procedureSkill());

    const priority = screen.getByLabelText('Priority');
    await user.clear(priority);
    await user.type(priority, '20');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/skills/skill-1', {
      name: 'Yatırım geçmedi',
      instruction: 'Yöntem ve saati sor, süreyle karşılaştır.',
      mode: 'procedure',
      ...row,
      priority: 20,
    });
  });

  it('writes the procedure’s own “solved” criteria, and drops them when the box is unticked (AI-09 · K9)', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    const handoff = screen.getByRole('region', { name: 'Hand-over' });
    const own = within(handoff).getByRole('checkbox', {
      name: 'This procedure has its own criteria',
    });
    expect(within(handoff).getByText(/The agent’s default applies/)).toBeInTheDocument();
    await user.click(own);
    // Starts on the platform's default; the author can ask for more.
    await user.selectOptions(
      within(handoff).getByLabelText('Compare', { selector: '#procedure-resolution-kind' }),
      'slot',
    );
    await user.selectOptions(
      within(handoff).getByLabelText('Information', { selector: '#procedure-resolution-subject' }),
      'tutar',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]![1].procedure.resolution_criteria).toStrictEqual({
      slot: { name: 'tutar', op: 'exists' },
    });

    await user.click(own);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(api.patch.mock.calls[1]![1].procedure).not.toHaveProperty('resolution_criteria');
  });

  it('keeps a stored “solved” criteria through an unrelated edit (AI-09 · K9)', async () => {
    const user = userEvent.setup();
    const criteria = {
      all: [
        { slot: { name: 'tutar', op: 'exists' } },
        { fn: { name: 'player_confirmed', args: [] } },
      ],
    };
    const base = procedureSkill();
    renderEditor({
      ...base,
      procedure: { ...base.procedure!, resolution_criteria: criteria } as Skill['procedure'],
    });

    const handoff = screen.getByRole('region', { name: 'Hand-over' });
    expect(
      within(handoff).getByRole('checkbox', { name: 'This procedure has its own criteria' }),
    ).toBeChecked();
    const priority = screen.getByLabelText('Priority');
    await user.clear(priority);
    await user.type(priority, '20');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]![1].procedure.resolution_criteria).toStrictEqual(criteria);
  });

  it('switching back to one message sends the mode, and keeps the step list', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill({ steps: [{ type: 'summarize' }] }));

    await user.selectOptions(screen.getByLabelText('Skill type'), 'single');
    expect(screen.queryByRole('region', { name: 'Hand-over' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/skills/skill-1', {
      name: 'Yatırım geçmedi',
      instruction: 'Yöntem ve saati sor, süreyle karşılaştır.',
      steps: [{ type: 'summarize' }],
      mode: 'single',
    });
  });

  it('a locked copy keeps its mode', () => {
    renderEditor(procedureSkill({ locked: true }));

    expect(screen.getByLabelText('Skill type')).toBeDisabled();
  });

  it('moves a step with the keyboard and says where it went (FR-MOD-06.2.4)', async () => {
    const user = userEvent.setup();
    renderEditor(
      smallSkill([
        { id: 'sor', type: 'collect', slots: ['yontem'] },
        { id: 'etiket', type: 'tag', tag: 'yatirim' },
      ]),
    );

    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));

    const items = within(stepList()).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Tag the conversation “yatirim”');
    expect(
      screen.getByText(/Moved “Tag the conversation “yatirim”” to position 1 of 2/),
    ).toBeInTheDocument();
  });
});

describe('SkillEditor — conditions and branches', () => {
  it('edits a simple comparison in the form', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    const step = await openStep(user, /If talep_olusturuldu = false: go to talep_kalibi/);
    expect(within(step).getByLabelText('Compare')).toHaveValue('slot');
    expect(within(step).getByLabelText('Information')).toHaveValue('talep_olusturuldu');
    expect(within(step).getByLabelText('Target step')).toHaveValue('talep_kalibi');

    await user.selectOptions(within(step).getByLabelText('Value'), 'true');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    const body = api.patch.mock.calls[0]![1] as { procedure: { steps: ProcStep[] } };
    expect(body.procedure.steps.find((s) => s.id === 'talep_yok')).toStrictEqual({
      id: 'talep_yok',
      type: 'check',
      when: { slot: { name: 'talep_olusturuldu', op: 'eq', value: true } },
      then: { goto: 'talep_kalibi' },
    });
  });

  it('keeps a condition the form cannot show as JSON, and refuses JSON that does not parse', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    const step = await openStep(user, /If a combined condition: go to mesai/);
    const json = within(step).getByLabelText('Condition');
    expect(JSON.parse((json as HTMLTextAreaElement).value)).toStrictEqual({
      not: { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } },
    });

    await user.type(json, '{{');

    expect(within(step).getByText('This is not valid JSON yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('renaming a step carries the branches that go to it', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    const step = await openStep(user, /Say the “talep_yok” template/);
    const key = within(step).getByLabelText('Step key');
    await user.clear(key);
    await user.type(key, 'talep_uyari');

    expect(
      within(stepList()).getByRole('button', {
        name: /If talep_olusturuldu = false: go to talep_uyari/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/which is not a step/)).not.toBeInTheDocument();
  });
});

describe('SkillEditor — drafting a procedure from an SOP', () => {
  it('fills the form from the draft and creates the skill closed', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const draft = {
      name: 'Para yatırma',
      when_to_use: 'Oyuncu yatırımının geçmediğini söylüyor.',
      examples: ['param yatmadı'],
      priority: 100,
      slots: [
        {
          name: 'yontem',
          label: 'yöntem',
          type: 'text',
          ask: 'yöntem paylaşır mısınız?',
          required: 'always',
          pii: 'none',
          show_in_card: true,
          max_attempts: 2,
          confirm: 'never',
        },
      ],
      procedure: {
        steps: [
          { id: 'collect_1', type: 'collect', slots: ['yontem'] },
          { id: 'handoff_2', type: 'handoff', reason_code: 'sop_handoff' },
        ],
        templates: [],
        handoff: { conditions: [], card_fields: [] },
        limits: { max_turns: 12 },
      },
      source: 'rules',
      problems: [],
      warnings: [],
    };
    api.post.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/skills/compile'
          ? { mode: 'procedure', steps: [], unrecognised: ['Eğer süre geçtiyse'], draft }
          : { ...procedureSkill(), id: 'skill-new' },
      ),
    );
    renderEditor(
      procedureSkill({
        id: '',
        name: '',
        instruction: null,
        mode: 'single',
        when_to_use: null,
        examples: [],
        priority: 100,
        slots: [],
        procedure: null,
      }),
      { isNew: true, onCreated },
    );

    await user.selectOptions(screen.getByLabelText('Skill type'), 'procedure');
    await user.type(screen.getByLabelText('Procedure text (SOP)'), 'Yöntemi sor. Finansa devret.');
    await user.click(screen.getByRole('button', { name: 'Draft from SOP' }));

    expect(api.post).toHaveBeenCalledWith('/skills/compile', {
      mode: 'procedure',
      sop_text: 'Yöntemi sor. Finansa devret.',
    });
    expect(
      await screen.findByDisplayValue('Oyuncu yatırımının geçmediğini söylüyor.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Para yatırma');
    expect(within(stepList()).getByText('Ask for yontem')).toBeInTheDocument();
    // What the draft could not turn into a step is the author's to write.
    expect(screen.getByText(/Eğer süre geçtiyse/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create skill' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [, body] = api.post.mock.calls.find(([path]) => path === '/skills')!;
    expect(body).toStrictEqual({
      name: 'Para yatırma',
      instruction: 'Yöntemi sor. Finansa devret.',
      mode: 'procedure',
      when_to_use: draft.when_to_use,
      examples: draft.examples,
      priority: 100,
      slots: draft.slots,
      procedure: draft.procedure,
      ai_agent_id: 'agent-1',
    });
  });
});

describe('SkillEditor — previewing a procedure over several turns', () => {
  const answer = (overrides: Partial<SkillPreview> = {}): SkillPreview => ({
    outcome: 'answered',
    reply: 'Hangi yöntemle ve saat kaçta yatırdınız?',
    tags: [],
    transfer_to: null,
    summary: null,
    log: [],
    errors: [],
    procedure_problems: [],
    state: {
      mode: 'ai',
      procedure: {
        skill_id: 'preview',
        skill_name: 'Yatırım geçmedi',
        snapshot_hash: 'abc',
        step_id: 'yontem_zaman',
        step_status: 'awaiting_answer',
      },
      slots: [
        {
          name: 'yontem',
          label: 'Ödeme yöntemi',
          type: 'enum',
          status: 'missing',
          display: null,
          source: 'player',
          attempts: 1,
          sensitive: false,
        },
      ],
      suspended: null,
      turns: 1,
      outcome: null,
    },
    ...overrides,
  });

  it('sends the definition, shows where the turn leaves it, and carries the exchange into the next', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(answer());
    renderEditor(procedureSkill());

    const sample = screen.getByLabelText('A message a customer might send');
    fireEvent.change(sample, { target: { value: 'param yatmadı' } });
    await user.click(screen.getByRole('button', { name: 'Run preview' }));

    const state = await screen.findByRole('region', { name: 'Where the turn leaves it' });
    expect(
      within(state).getByText('Step yontem_zaman — waiting for an answer'),
    ).toBeInTheDocument();
    expect(within(state).getByText(/Ödeme yöntemi: — · not given/)).toBeInTheDocument();
    expect(api.post).toHaveBeenLastCalledWith('/skills/preview', {
      mode: 'procedure',
      ...depositRow(),
      message: 'param yatmadı',
      ai_agent_id: 'agent-1',
    });

    fireEvent.change(sample, { target: { value: 'papara, 14:05' } });
    await user.click(screen.getByRole('button', { name: 'Run preview' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1]![1]).toMatchObject({
      message: 'papara, 14:05',
      conversation: [
        { role: 'visitor', text: 'param yatmadı' },
        { role: 'ai', text: 'Hangi yöntemle ve saat kaçta yatırdınız?' },
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'Start over' }));
    expect(screen.queryByRole('list', { name: 'Conversation so far' })).not.toBeInTheDocument();
  });

  it('shows why the server would not run it', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(
      answer({
        outcome: 'skipped',
        reply: null,
        procedure_problems: [
          { reason: 'procedure_unknown_target', section: 'handoff', reference: '4' },
        ],
      }),
    );
    renderEditor(procedureSkill());

    await user.click(screen.getByRole('button', { name: 'Run preview' }));

    expect(
      await screen.findByText('Hand-over: That team is not in this workspace any more.'),
    ).toBeInTheDocument();
  });

  it('does not run a definition the save would refuse', async () => {
    const user = userEvent.setup();
    renderEditor(procedureSkill());

    await user.clear(screen.getByLabelText('When to use it'));

    expect(screen.getByRole('button', { name: 'Run preview' })).toBeDisabled();
    expect(screen.getByText('Fix the problems above to try the procedure.')).toBeInTheDocument();
  });
});

describe('SkillEditor — a procedure in Turkish (NFR-I18N2)', () => {
  it('words the sections and a refusal in Turkish', async () => {
    const user = userEvent.setup();
    setLocale('tr');
    renderEditor(procedureSkill());

    expect(screen.getByRole('region', { name: 'Toplanacak bilgiler' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Hangi durumda kullanılır'));

    expect(
      screen.getByText('Bu prosedürün ne zaman kullanılacağını yazın (en fazla 1000 karakter).'),
    ).toBeInTheDocument();
  });
});
