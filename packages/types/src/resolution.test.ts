import { describe, expect, it } from 'vitest';
import { scanGuardrails } from './guardrails.js';
import { PERSONA_LANGUAGES } from './persona.js';
import {
  COND_FNS,
  RESOLUTION_AI_KEY,
  RESOLUTION_CRITERIA_MAX_BYTES,
  SKILL_PROCEDURE_FIELDS,
  procedureAiQuestions,
  splitSkillProcedure,
  validateProcedure,
  validateResolutionCriteria,
  validateSkillProcedure,
  type Cond,
  type Procedure,
} from './procedure.js';
import {
  DEFAULT_RESOLUTION_CRITERIA,
  RESOLUTION_PHRASES,
  readResolutionCriteria,
} from './resolution.js';

type Json = Record<string, unknown>;

const CONFIRMED: Cond = { fn: { name: 'player_confirmed', args: [] } };

/** A procedure with one slot that answers and resolves. */
function raw(extra: Json = {}): Json {
  return {
    when_to_use: 'Oyuncu bonus nedir diyor.',
    slots: [{ name: 'yontem', label: 'Yöntem', type: 'text', ask: 'Hangi yöntem?' }],
    steps: [
      { id: 'sor', type: 'collect', slots: ['yontem'] },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
    ...extra,
  };
}

function valid(value: Json): Procedure {
  const result = validateProcedure(value);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

describe('a procedure’s "resolved" criteria (K9 · tm 303.4)', () => {
  it('are a condition over its own slots, kept as written — and absent unless written', () => {
    const criteria: Cond = { all: [{ slot: { name: 'yontem', op: 'exists' } }, CONFIRMED] };
    expect(valid(raw({ resolution_criteria: criteria })).resolution_criteria).toEqual(criteria);
    expect('resolution_criteria' in valid(raw())).toBe(false);
    // Null is none: what an editor that cleared the field sends.
    expect('resolution_criteria' in valid(raw({ resolution_criteria: null }))).toBe(false);
  });

  it('are refused, in the hand-over section, when they name what the procedure does not have', () => {
    const result = validateProcedure(
      raw({ resolution_criteria: { slot: { name: 'tutar', op: 'exists' } } }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems).toEqual([
      expect.objectContaining({
        code: 'slot_unknown_reference',
        section: 'handoff',
        field: 'resolution_criteria',
        slot: 'tutar',
        path: 'resolution_criteria.slot',
      }),
    ]);
    expect(
      validateProcedure(
        raw({ resolution_criteria: { fn: { name: 'player_confirmed', args: ['x'] } } }),
      ).ok,
    ).toBe(false);
  });

  it('a procedure without them hashes as before: nothing is added to it', () => {
    expect(Object.keys(valid(raw())).sort()).toEqual([
      'examples',
      'handoff',
      'limits',
      'priority',
      'slots',
      'steps',
      'templates',
      'when_to_use',
    ]);
  });

  it('are stored in the skill’s `procedure`, and judged there', () => {
    const criteria: Cond = CONFIRMED;
    const split = splitSkillProcedure(valid(raw({ resolution_criteria: criteria })));
    expect(split.procedure.resolution_criteria).toEqual(criteria);
    expect('resolution_criteria' in splitSkillProcedure(valid(raw())).procedure).toBe(false);
    expect(SKILL_PROCEDURE_FIELDS).toContain('resolution_criteria');
    expect(validateSkillProcedure({ ...split, procedure: split.procedure }).ok).toBe(true);
  });

  it('their `ai` question is asked under its own key, one a step id cannot be', () => {
    const procedure = valid(raw({ resolution_criteria: { ai: { question: 'Memnun mu?' } } }));
    expect(procedureAiQuestions(procedure)).toEqual([
      { key: RESOLUTION_AI_KEY, question: 'Memnun mu?' },
    ]);
    expect(RESOLUTION_AI_KEY).not.toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('of a locked procedure, may not change', () => {
    const stored = valid(raw());
    const changed = validateProcedure(raw({ resolution_criteria: CONFIRMED }), { locked: stored });
    expect(!changed.ok && changed.problems.map((p) => [p.code, p.section])).toEqual([
      ['procedure_locked_change', 'handoff'],
    ]);
  });
});

describe('the workspace’s default (K9 · tm 303.4)', () => {
  it('takes the player’s yes, an `ai` question and their combinations', () => {
    for (const criteria of [
      CONFIRMED,
      { not: CONFIRMED },
      { any: [CONFIRMED, { ai: { question: 'Çözüldü dedi mi?' } }] },
    ] as Cond[]) {
      expect(validateResolutionCriteria(criteria)).toEqual({ ok: true, criteria });
    }
  });

  it('refuses a slot, a fact, a function needing one, two questions, a non-condition — and size', () => {
    const codes = (value: unknown) => {
      const result = validateResolutionCriteria(value);
      return result.ok ? [] : result.problems.map((p) => [p.code, p.section, p.field]);
    };
    expect(codes({ slot: { name: 'yontem', op: 'exists' } })).toEqual([
      ['slot_unknown_reference', 'handoff', 'resolution_criteria'],
    ]);
    expect(codes({ fact: { path: 'method.min_amount', op: 'exists' } })[0]?.[0]).toBe(
      'procedure_fact_without_source',
    );
    expect(codes({ fn: { name: 'next_window', args: ['method'], op: 'exists' } })[0]?.[0]).toBe(
      'procedure_fact_without_source',
    );
    expect(
      codes({ all: [{ ai: { question: 'Bir?' } }, { ai: { question: 'İki?' } }] })[0]?.[0],
    ).toBe('procedure_ai_condition_repeated');
    expect(codes('player_confirmed')[0]?.[0]).toBe('procedure_bad_condition');
    expect(codes(null)[0]?.[0]).toBe('procedure_bad_condition');
    const huge = {
      any: [CONFIRMED, { ai: { question: 'ş'.repeat(RESOLUTION_CRITERIA_MAX_BYTES / 2) } }],
    };
    expect(codes(huge)).toEqual([['procedure_bad_condition', 'handoff', 'resolution_criteria']]);
  });

  it('reads back what it wrote; anything else stored is no default', () => {
    expect(readResolutionCriteria(CONFIRMED)).toEqual(CONFIRMED);
    expect(readResolutionCriteria(null)).toBeNull();
    expect(readResolutionCriteria({ slot: { name: 'x', op: 'exists' } })).toBeNull();
    expect(readResolutionCriteria([CONFIRMED])).toBeNull();
  });

  it('the platform’s is the player’s yes, a function of the fixed list', () => {
    expect(DEFAULT_RESOLUTION_CRITERIA).toEqual(CONFIRMED);
    expect(COND_FNS).toContain('player_confirmed');
    expect(validateResolutionCriteria(DEFAULT_RESOLUTION_CRITERIA).ok).toBe(true);
  });
});

describe('what the AI says around the decision (K9 · tm 303.4)', () => {
  it('has every persona language, asks a question, and trips no output guardrail', () => {
    for (const lang of PERSONA_LANGUAGES) {
      const phrases = RESOLUTION_PHRASES[lang];
      for (const text of [phrases.confirm.resolved, phrases.confirm.resolved_waiting]) {
        expect(text.trim().endsWith('?'), text).toBe(true);
        expect(scanGuardrails(text, 'output'), text).toEqual([]);
      }
      expect(scanGuardrails(phrases.thanks, 'output'), phrases.thanks).toEqual([]);
    }
  });
});
