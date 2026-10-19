/**
 * The "resolved" decision (tm 303.4 · AI-09 · K9): whose criteria apply, and
 * what a `resolve` step and a knowledge answer decide by them — pure.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESOLUTION_CRITERIA,
  RESOLUTION_AI_KEY,
  procedureAiQuestions,
  validateProcedure,
  type Cond,
  type Procedure,
} from '@siyahtus/types';
import { NO_FACTS, type ProcedureEvalContext } from './procedure/conditions.js';
import {
  PLATFORM_RESOLUTION,
  decideResolution,
  knowledgeResolution,
  resolutionCriteriaFor,
  withResolutionCriteria,
  type ResolutionCriteria,
} from './resolution.js';

const NOW = new Date('2026-10-19T10:00:00Z');
const CONFIRMED: Cond = { fn: { name: 'player_confirmed', args: [] } };
const SLOT_A_FILLED = { a: { value: 'v', display: 'v', status: 'filled' } };

function procedure(extra: Record<string, unknown> = {}): Procedure {
  const result = validateProcedure({
    when_to_use: 'Test.',
    slots: [{ name: 'a', label: 'A', type: 'text', ask: 'A?' }],
    steps: [{ id: 'bitti', type: 'resolve', outcome: 'resolved' }],
    ...extra,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

function ctx(over: Partial<ProcedureEvalContext> = {}): ProcedureEvalContext {
  return { slots: {}, facts: NO_FACTS, now: NOW, timeZone: 'Europe/Istanbul', ...over };
}

function decide(
  resolution: ResolutionCriteria,
  asked: boolean,
  over: Partial<ProcedureEvalContext> = {},
) {
  return decideResolution({ resolution, ctx: ctx(over), asked, at: 'bitti' }).record;
}

describe('whose criteria apply (K9)', () => {
  it('the procedure’s own, else the workspace’s default, else the platform’s: the player’s yes', () => {
    const own: Cond = { slot: { name: 'a', op: 'exists' } };
    const workspace: Cond = { ai: { question: 'Çözüldü mü?' } };
    expect(resolutionCriteriaFor(procedure({ resolution_criteria: own }), workspace)).toEqual({
      criteria: own,
      basis: 'procedure',
    });
    expect(resolutionCriteriaFor(procedure(), workspace)).toEqual({
      criteria: workspace,
      basis: 'workspace',
    });
    expect(resolutionCriteriaFor(procedure(), null)).toBe(PLATFORM_RESOLUTION);
    expect(resolutionCriteriaFor(null, undefined)).toEqual({
      criteria: DEFAULT_RESOLUTION_CRITERIA,
      basis: 'platform',
    });
  });

  it('the understanding is asked the `ai` question of the criteria that apply, under its own key', () => {
    const workspace: Cond = { ai: { question: 'Oyuncu memnun mu?' } };
    const plain = procedure();
    expect(procedureAiQuestions(plain)).toEqual([]);
    const asked = withResolutionCriteria(plain, resolutionCriteriaFor(plain, workspace));
    expect(procedureAiQuestions(asked)).toEqual([
      { key: RESOLUTION_AI_KEY, question: 'Oyuncu memnun mu?' },
    ]);
    // Its own: nothing to add, the same object.
    const own = procedure({ resolution_criteria: workspace });
    expect(withResolutionCriteria(own, resolutionCriteriaFor(own, null))).toBe(own);
  });
});

describe('the decision at a resolve step (K9)', () => {
  it('not asked yet, the player’s yes all that is missing: asked', () => {
    expect(decide(PLATFORM_RESOLUTION, false)).toEqual({
      decision: 'asked',
      reason: 'awaiting_confirmation',
      basis: 'platform',
      result: 'unknown',
      unknown: ['fn player_confirmed'],
      confirmation: null,
    });
  });

  it('a yes before the question was asked is no answer to it', () => {
    expect(decide(PLATFORM_RESOLUTION, false, { confirmation: 'yes' })).toMatchObject({
      decision: 'asked',
      confirmation: null,
    });
  });

  it('asked: yes resolves, no and anything else do not', () => {
    expect(decide(PLATFORM_RESOLUTION, true, { confirmation: 'yes' })).toMatchObject({
      decision: 'resolved',
      reason: 'criteria_met',
      result: true,
      confirmation: 'yes',
    });
    expect(decide(PLATFORM_RESOLUTION, true, { confirmation: 'no' })).toMatchObject({
      decision: 'unresolved',
      reason: 'player_said_no',
      result: false,
    });
    expect(decide(PLATFORM_RESOLUTION, true, { confirmation: null })).toMatchObject({
      decision: 'unresolved',
      reason: 'not_confirmed',
      result: 'unknown',
    });
  });

  it('criteria that need more than the yes: never asked — unresolved at once, and still after a yes', () => {
    const both: ResolutionCriteria = {
      criteria: { all: [{ slot: { name: 'a', op: 'exists' } }, CONFIRMED] },
      basis: 'procedure',
    };
    expect(decide(both, false)).toMatchObject({
      decision: 'unresolved',
      reason: 'criteria_unmet',
      result: false,
      unknown: ['fn player_confirmed'],
    });
    expect(decide(both, true, { confirmation: 'yes' })).toMatchObject({
      decision: 'unresolved',
      reason: 'criteria_unmet',
    });
    expect(decide(both, false, { slots: SLOT_A_FILLED })).toMatchObject({ decision: 'asked' });
    expect(decide(both, true, { slots: SLOT_A_FILLED, confirmation: 'yes' })).toMatchObject({
      decision: 'resolved',
      basis: 'procedure',
    });
  });

  it('criteria the conversation meets resolve without asking; an `ai` answer is read under its key', () => {
    const told: ResolutionCriteria = {
      criteria: { ai: { question: 'Söyledi mi?' } },
      basis: 'workspace',
    };
    expect(decide(told, false, { aiAnswers: { [RESOLUTION_AI_KEY]: true } })).toMatchObject({
      decision: 'resolved',
      basis: 'workspace',
    });
    // Another key's answer is not this one's.
    expect(decide(told, false, { aiAnswers: { bitti: true } })).toMatchObject({
      decision: 'unresolved',
      reason: 'criteria_unmet',
      unknown: ['ai'],
    });
  });

  it('logs what it decided, by name — never a value', () => {
    const { log } = decideResolution({
      resolution: {
        criteria: { slot: { name: 'a', op: 'eq', value: 'gizli' } },
        basis: 'procedure',
      },
      ctx: ctx({ slots: { a: { value: 'özel-değer', display: 'özel-değer', status: 'filled' } } }),
      asked: false,
      at: 'bitti',
    });
    expect(log.at(-1)).toEqual({
      step: 'bitti',
      detail: 'not resolved — the procedure criteria do not hold; a person takes over',
      ok: true,
    });
    expect(JSON.stringify(log)).not.toMatch(/özel-değer|gizli/);
  });
});

describe('a knowledge answer (K9)', () => {
  it('claims nothing: the AI did not ask, so there is no yes to read', () => {
    expect(knowledgeResolution(PLATFORM_RESOLUTION, ctx({ confirmation: 'yes' }))).toEqual({
      decision: 'not_claimed',
      reason: 'awaiting_confirmation',
      basis: 'platform',
      result: 'unknown',
      unknown: ['fn player_confirmed'],
      confirmation: null,
    });
    expect(
      knowledgeResolution({ criteria: { ai: { question: 'x' } }, basis: 'workspace' }, ctx()),
    ).toMatchObject({ decision: 'not_claimed', reason: 'criteria_unmet', basis: 'workspace' });
  });

  it('criteria met without the player’s word resolve', () => {
    expect(
      knowledgeResolution(
        { criteria: { ai: { question: 'x' } }, basis: 'workspace' },
        ctx({ aiAnswers: { [RESOLUTION_AI_KEY]: true } }),
      ),
    ).toMatchObject({ decision: 'resolved', reason: 'criteria_met' });
  });
});
