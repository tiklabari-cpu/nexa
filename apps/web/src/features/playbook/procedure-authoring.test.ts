/**
 * The procedure editor's model (AI-03 · tm 296.5): what the form does to a
 * definition, as plain functions — a goto left behind by a rename, a guard
 * silently turned into a branch, a field the form does not show dropped on
 * the way back out. Each is invisible in a rendered form and obvious here.
 */
import {
  PROC_STEP_TYPES,
  splitSkillProcedure,
  validateSkillProcedure,
  type Cond,
  type ProcStep,
  type SlotDef,
} from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { depositProcedureFields } from '../../test/procedure-fixtures.js';
import {
  EDITOR_PROC_STEP_TYPES,
  addProcStep,
  blankProcStep,
  blankSlot,
  changeProcStepType,
  changeSimpleKind,
  changeSlotType,
  condFromSimple,
  moveProcStep,
  nextStepId,
  procedureDraft,
  procedureFields,
  removeProcStep,
  renameProcStep,
  simpleCond,
  skillStepCount,
  updateProcStep,
  validateDraft,
  type ProcStepEntry,
  type ProcedureDraft,
} from './procedure-authoring.js';

function stored() {
  const result = validateSkillProcedure(depositProcedureFields());
  if (!result.ok) throw new Error(JSON.stringify(result.problems, null, 2));
  return splitSkillProcedure(result.procedure);
}

function entries(...steps: ProcStep[]): ProcStepEntry[] {
  return procedureDraft({ procedure: { steps } }).steps;
}

function ids(steps: readonly ProcStepEntry[]): string[] {
  return steps.map((entry) => entry.step.id);
}

/** A procedure that passes, to vary one step at a time. */
function small(steps: ProcStep[]): ProcedureDraft {
  return {
    ...procedureDraft({
      when_to_use: 'Oyuncu yatırımının geçmediğini söylüyor.',
      slots: [
        { ...blankSlot(), name: 'yontem', label: 'Yöntem', ask: 'Hangi yöntem?' },
        { ...blankSlot(), name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar?' },
        { ...blankSlot(), name: 'zaman', label: 'Zaman', type: 'datetime', ask: 'Ne zaman?' },
      ],
      procedure: { templates: [{ key: 'bekle', text: '{yontem} bekleniyor.' }] },
    }),
    steps: entries(...steps),
  };
}

describe('reading a definition into the form and back out (AI-03)', () => {
  it('leaves the §3.1 deposit procedure exactly as it was stored', () => {
    const before = stored();

    const after = procedureFields(procedureDraft(before));

    // Conditions the simple form cannot hold, the passive tool step, a
    // conditional `required`, the hand-over topic: all ride along untouched.
    expect(after).toStrictEqual(before);
    expect(validateSkillProcedure(after).ok).toBe(true);
  });

  it('opens a skill without a procedure on a well-formed, empty one', () => {
    const draft = procedureDraft({ when_to_use: null, procedure: null });

    expect(procedureFields(draft)).toStrictEqual({
      when_to_use: '',
      examples: [],
      priority: 100,
      slots: [],
      procedure: {
        steps: [],
        templates: [],
        handoff: { conditions: [], card_fields: [] },
        limits: { max_turns: 12 },
      },
    });
  });

  it('does not share objects with what it was read from', () => {
    const source = stored();
    const draft = procedureDraft(source);

    (draft.steps[0]!.step as { instruction?: string }).instruction = 'changed';
    draft.slots[0]!.label = 'changed';

    expect(source.procedure.steps[0]).not.toHaveProperty('instruction');
    expect(source.slots[0]!.label).toBe('Kullanıcı adı');
  });
});

describe('an emptied optional box is an absent field', () => {
  it('drops a cleared instruction, so a templated say still saves', () => {
    const draft = small([
      { id: 'sor', type: 'collect', slots: ['yontem'] },
      { id: 'bilgi', type: 'say', template_key: 'bekle', instruction: '   ' },
    ]);

    expect(procedureFields(draft).procedure.steps[1]).toStrictEqual({
      id: 'bilgi',
      type: 'say',
      template_key: 'bekle',
    });
    expect(validateDraft(draft).ok).toBe(true);
  });

  it('a say with neither a template nor an instruction is refused for its content, not its field', () => {
    const draft = small([{ id: 'bilgi', type: 'say', instruction: '' }]);

    const result = validateDraft(draft);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.map((p) => p.code)).toEqual(['procedure_say_needs_content']);
    }
  });

  it('drops blank optionals inside a check branch and on the hand-over', () => {
    const draft = small([
      { id: 'sor', type: 'collect', slots: ['tutar'] },
      {
        id: 'kontrol',
        type: 'check',
        when: { slot: { name: 'tutar', op: 'gt', value: 100 } },
        then: { type: 'say', template_key: 'bekle', instruction: '' },
      },
    ]);
    draft.handoff = { ...draft.handoff, next_step_hint: ' ' };

    const fields = procedureFields(draft);

    expect(fields.procedure.steps[1]).toMatchObject({
      then: { type: 'say', template_key: 'bekle' },
    });
    expect(fields.procedure.steps[1]).not.toHaveProperty('then.instruction');
    expect(fields.procedure.handoff).not.toHaveProperty('next_step_hint');
    expect(validateDraft(draft).ok).toBe(true);
  });
});

describe('adding, removing, moving and retyping steps', () => {
  it('names a new step after its type, never reusing an id', () => {
    let steps = addProcStep([], 'say');
    steps = addProcStep(steps, 'say');
    steps = removeProcStep(steps, 0);
    steps = addProcStep(steps, 'say');

    expect(ids(steps)).toEqual(['say_2', 'say_1']);
    expect(new Set(steps.map((entry) => entry.key)).size).toBe(steps.length);
    expect(nextStepId(steps, 'say')).toBe('say_3');
  });

  it('offers every step type but the passive tool, and a blank of each blocks the save until filled', () => {
    expect([...EDITOR_PROC_STEP_TYPES, 'tool'].sort()).toEqual([...PROC_STEP_TYPES].sort());

    for (const type of EDITOR_PROC_STEP_TYPES) {
      const blank = small([
        { id: 'sor', type: 'collect', slots: ['yontem'] },
        blankProcStep(type, 'yeni'),
      ]);
      const ok = validateDraft(blank).ok;
      // Complete as they are: their one choice has a default, or there is none.
      expect(ok, type).toBe(type === 'resolve' || type === 'answer_from_knowledge');
    }
  });

  it('moves a step with the same rule as the one-message list', () => {
    const steps = entries(
      { id: 'a', type: 'tag', tag: 'x' },
      { id: 'b', type: 'tag', tag: 'y' },
      { id: 'c', type: 'tag', tag: 'z' },
    );

    expect(ids(moveProcStep(steps, 2, 0))).toEqual(['c', 'a', 'b']);
    expect(ids(moveProcStep(steps, 0, 99))).toEqual(['b', 'c', 'a']);
    expect(moveProcStep(steps, 1, 1).map((entry) => entry.key)).toEqual(
      steps.map((entry) => entry.key),
    );
  });

  it('retypes a step keeping its row, id, instruction and guard', () => {
    const steps = entries({
      id: 'bilgi',
      type: 'say',
      instruction: 'Bekleyin.',
      when: { slot: { name: 'yontem', op: 'exists' } },
    });

    const [retyped] = changeProcStepType(steps, 0, 'tag');

    expect(retyped!.key).toBe(steps[0]!.key);
    expect(retyped!.step).toStrictEqual({
      id: 'bilgi',
      type: 'tag',
      tag: '',
      instruction: 'Bekleyin.',
      when: { slot: { name: 'yontem', op: 'exists' } },
    });
  });

  it('does not turn a guard into a branch condition, or back', () => {
    const guard: Cond = { slot: { name: 'yontem', op: 'exists' } };
    const [check] = changeProcStepType(
      entries({ id: 's', type: 'say', instruction: 'x', when: guard }),
      0,
      'check',
    );
    expect(check!.step).toStrictEqual({
      id: 's',
      type: 'check',
      instruction: 'x',
      when: { slot: { name: '', op: 'exists' } },
      then: { goto: '' },
    });

    const [say] = changeProcStepType(
      entries({ id: 'k', type: 'check', when: guard, then: { goto: 'x' } }),
      0,
      'say',
    );
    expect(say!.step).not.toHaveProperty('when');
  });

  it('removes a key set to undefined rather than storing it', () => {
    const [edited] = updateProcStep(entries({ id: 's', type: 'say', template_key: 'bekle' }), 0, {
      template_key: undefined,
      instruction: 'Bekleyin.',
    });

    expect(edited!.step).toStrictEqual({ id: 's', type: 'say', instruction: 'Bekleyin.' });
  });
});

describe('renaming a step keeps the branches that go to it', () => {
  const flow = () =>
    entries(
      {
        id: 'kontrol',
        type: 'check',
        when: { slot: { name: 'tutar', op: 'exists' } },
        then: { goto: 'bekle' },
        else: { goto: 'bekle' },
      },
      { id: 'bekle', type: 'say', instruction: 'Bekleyin.' },
      { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
    );

  it('follows the rename in then and else', () => {
    const renamed = renameProcStep(flow(), 1, 'bekleme');

    expect(renamed[0]!.step).toMatchObject({
      then: { goto: 'bekleme' },
      else: { goto: 'bekleme' },
    });
    expect(renamed[1]!.step.id).toBe('bekleme');
  });

  it('does not follow onto a name another step already has', () => {
    const renamed = renameProcStep(flow(), 1, 'devir');

    // Following would point both branches at the hand-over without anyone
    // choosing it; left alone, the validator names the duplicate.
    expect(renamed[0]!.step).toMatchObject({ then: { goto: 'bekle' } });
  });

  it('does not follow from a name two steps share', () => {
    const shared = renameProcStep(flow(), 2, 'bekle');
    const renamed = renameProcStep(shared, 2, 'bekle2');

    expect(renamed[0]!.step).toMatchObject({ then: { goto: 'bekle' } });
  });
});

describe('slots', () => {
  it('a new slot takes the validator’s defaults', () => {
    const slot: SlotDef<Cond> = { ...blankSlot(), name: 'yontem', label: 'Yöntem', ask: 'Hangi?' };
    const result = validateSkillProcedure({
      when_to_use: 'x',
      slots: [slot],
      procedure: { steps: [{ id: 'sor', type: 'collect', slots: ['yontem'] }] },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.procedure.slots[0]).toStrictEqual(slot);
  });

  it('retyping drops checks that belonged to the old type; a choice starts with no options', () => {
    const number: SlotDef<Cond> = { ...blankSlot(), type: 'money', validate: { min: 10 } };

    expect(changeSlotType(number, 'text')).not.toHaveProperty('validate');
    expect(changeSlotType(number, 'enum').validate).toStrictEqual({ enum_values: [] });
  });
});

describe('the simple condition form', () => {
  const slots = stored().slots;

  it('reads and writes back the comparisons it can show', () => {
    const conditions: Cond[] = [
      { slot: { name: 'talep_olusturuldu', op: 'eq', value: false } },
      { slot: { name: 'tutar', op: 'gt', value: 100000 } },
      { slot: { name: 'tutar', op: 'lt', value: { fact: 'method.min_amount' } } },
      { fact: { path: 'method.receipt_required', op: 'eq', value: true } },
      {
        fn: {
          name: 'elapsed_minutes',
          args: ['islem_zamani'],
          op: 'lt',
          value: { fact: 'method.expected_minutes' },
        },
      },
      { slot: { name: 'yontem', op: 'in', value: ['papara', 'havale'] } },
      { slot: { name: 'yontem', op: 'exists' } },
      { ai: { question: 'Oyuncu sinirli mi?' } },
    ];

    for (const cond of conditions) {
      const simple = simpleCond(cond);
      expect(simple, JSON.stringify(cond)).not.toBeNull();
      expect(condFromSimple(simple!, slots)).toStrictEqual(cond);
    }
  });

  it('leaves to JSON what it cannot show', () => {
    const conditions: unknown[] = [
      { not: { fn: { name: 'within_working_hours', args: ['method', 'islem_zamani'] } } },
      { any: [{ slot: { name: 'tutar', op: 'exists' } }] },
      { slot: { name: 'tutar', op: 'gt', value: { slot: 'tutar' } } },
      { slot: { name: 'tutar', op: 'gt', value: 1 }, ai: { question: 'x' } },
      'not json yet',
    ];

    for (const cond of conditions) expect(simpleCond(cond as Cond)).toBeNull();
  });

  it('types the typed value by what the subject holds', () => {
    expect(
      condFromSimple({ kind: 'slot', subject: 'tutar', op: 'gte', value: '1500,5' }, slots),
    ).toStrictEqual({ slot: { name: 'tutar', op: 'gte', value: 1500.5 } });
    expect(
      condFromSimple({ kind: 'slot', subject: 'gonderen_kendisi', op: 'eq', value: 'true' }, slots),
    ).toStrictEqual({ slot: { name: 'gonderen_kendisi', op: 'eq', value: true } });
    expect(
      condFromSimple({ kind: 'fact', subject: 'method.name', op: 'not_in', value: 'a, ,b' }, slots),
    ).toStrictEqual({ fact: { path: 'method.name', op: 'not_in', value: ['a', 'b'] } });
    // Not a number: kept as typed, for the validator to name.
    expect(
      condFromSimple({ kind: 'elapsed', subject: 'islem_zamani', op: 'gt', value: 'otuz' }, slots),
    ).toStrictEqual({
      fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'gt', value: 'otuz' },
    });
  });

  it('switching the subject keeps an operator the new one takes', () => {
    const fromSlot = { kind: 'slot', subject: 'tutar', op: 'gt', value: '5' } as const;

    expect(changeSimpleKind(fromSlot, 'elapsed', slots)).toMatchObject({ op: 'gt', subject: '' });
    expect(changeSimpleKind({ ...fromSlot, op: 'matches' }, 'elapsed', slots)).toMatchObject({
      op: 'gt',
    });
    expect(changeSimpleKind(fromSlot, 'ai', slots)).toStrictEqual({ kind: 'ai', question: '' });
  });
});

describe('the list’s step count', () => {
  it('counts a procedure’s steps, not the empty one-message list', () => {
    expect(skillStepCount({ mode: 'procedure', steps: [], procedure: stored().procedure })).toBe(
      stored().procedure.steps.length,
    );
    expect(
      skillStepCount({ mode: 'single', steps: [{ type: 'summarize' }], procedure: null }),
    ).toBe(1);
    expect(skillStepCount({ steps: [{ type: 'summarize' }] })).toBe(1);
    expect(skillStepCount({ mode: 'procedure', steps: [], procedure: null })).toBe(0);
  });
});
