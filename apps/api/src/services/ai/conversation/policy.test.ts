/**
 * The decision order (tm 297.2 · AI-05 §4, §7; assumption AI-05-S1), pure:
 * an understanding in, a decision and the rule that made it out.
 */
import { describe, expect, it } from 'vitest';
import { readPersona } from '@siyahtus/types';
import {
  CLARIFY_SIGNAL,
  clarifyQuestion,
  clarifySignal,
  decide,
  languageVerdict,
  readClarifyMark,
  turnThresholds,
  type ClarifyMark,
} from './policy.js';
import type { ActiveProcedure } from './procedure/executor.js';
import type { CatalogueEntry, ProcedureUnderstanding } from './procedure/understanding.js';

const NOW = new Date('2026-10-18T10:50:00Z');

const entry = (key: string, name: string, extra: Partial<CatalogueEntry> = {}): CatalogueEntry => ({
  key,
  name,
  examples: [],
  priority: 100,
  locked: false,
  ...extra,
});

const DEPOSIT = entry('deposit', 'Yatırım');
const WITHDRAWAL = entry('withdrawal', 'Çekim');
const BONUS = entry('bonus', 'Bonus');
const CATALOGUE = [DEPOSIT, WITHDRAWAL, BONUS];

function reading(
  key: string | null,
  confidence: number,
  alternatives: Array<{ key: string; confidence: number }> = [],
  extra: Partial<ProcedureUnderstanding> = {},
  intent: Partial<ProcedureUnderstanding['intent']> = {},
): ProcedureUnderstanding {
  return {
    intent: { procedure_key: key, confidence, alternatives, ...intent },
    ...extra,
  };
}

function run(
  understanding: ProcedureUnderstanding,
  more: {
    active?: ActiveProcedure | null;
    clarified?: ClarifyMark | null;
    turnsTaken?: number;
    thresholds?: { high: number; low: number };
  } = {},
) {
  return decide({
    understanding,
    catalogue: CATALOGUE,
    active: more.active ?? null,
    suspended: null,
    slots: {},
    now: NOW,
    thresholds: more.thresholds ?? { high: 0.7, low: 0.4 },
    clarified: more.clarified ?? null,
    turnsTaken: more.turnsTaken ?? 0,
  });
}

describe('the decision order (AI-05 §4)', () => {
  it('3 — at high or above the procedure starts; the rule and the thresholds are on the record', () => {
    const result = run(reading('deposit', 0.82));
    expect(result.decision).toEqual({ kind: 'start', key: 'deposit' });
    expect(result.record).toEqual({ step: 3, rule: 'start', high: 0.7, low: 0.4 });
  });

  it('4 — between low and high, one question between the two likeliest (AI-05-S1)', () => {
    const result = run(
      reading('deposit', 0.55, [
        { key: 'withdrawal', confidence: 0.5 },
        { key: 'bonus', confidence: 0.45 },
      ]),
    );
    expect(result.decision).toEqual({ kind: 'clarify', options: [DEPOSIT, WITHDRAWAL] });
    expect(result.record).toEqual({
      step: 4,
      rule: 'clarify',
      options: ['deposit', 'withdrawal'],
      high: 0.7,
      low: 0.4,
    });
  });

  it('4 — a tie between the two goes to the smaller priority first, as at 3', () => {
    const catalogue = [DEPOSIT, { ...WITHDRAWAL, priority: 5 }, BONUS];
    const result = decide({
      understanding: reading('deposit', 0.55, [{ key: 'withdrawal', confidence: 0.52 }]),
      catalogue,
      active: null,
      suspended: null,
      slots: {},
      now: NOW,
      thresholds: { high: 0.7, low: 0.4 },
      clarified: null,
      turnsTaken: 0,
    });
    expect(result.decision).toMatchObject({
      kind: 'clarify',
      options: [{ key: 'withdrawal' }, { key: 'deposit' }],
    });
  });

  it('4 — only one likely: "is it about X?"', () => {
    const result = run(reading('bonus', 0.5, [{ key: 'deposit', confidence: 0.2 }]));
    expect(result.decision).toEqual({ kind: 'clarify', options: [BONUS] });
  });

  it('4 — never a second question straight after the first; the knowledge path instead', () => {
    const asked = { keys: ['deposit', 'withdrawal'], turn: 3 };
    const unclear = run(reading('bonus', 0.5), { clarified: asked, turnsTaken: 3 });
    expect(unclear.decision).toEqual({ kind: 'knowledge' });
    expect(unclear.log).toContainEqual({
      step: 'policy',
      detail: 'still unclear after the clarifying question — no second one is asked',
      ok: true,
    });
  });

  it('4 — the answer: a procedure the question offered, at low or above, starts', () => {
    const asked = { keys: ['deposit', 'withdrawal'], turn: 3 };
    const result = run(reading('withdrawal', 0.45), { clarified: asked, turnsTaken: 3 });
    expect(result.decision).toEqual({ kind: 'start', key: 'withdrawal' });
    expect(result.record).toMatchObject({ step: 4, rule: 'clarified' });
  });

  it('4 — the same unsure message again is no answer: both offered still tie', () => {
    const asked = { keys: ['deposit', 'withdrawal'], turn: 3 };
    const again = run(reading('deposit', 0.5, [{ key: 'withdrawal', confidence: 0.5 }]), {
      clarified: asked,
      turnsTaken: 3,
    });
    expect(again.decision).toEqual({ kind: 'knowledge' });
  });

  it('4 — a plain yes answers a one-option question; a yes to two options does not', () => {
    const one = { keys: ['bonus'], turn: 1 };
    expect(
      run(reading(null, 0, [], { yes_no: 'yes' }), { clarified: one, turnsTaken: 1 }).decision,
    ).toEqual({ kind: 'start', key: 'bonus' });
    const two = { keys: ['deposit', 'bonus'], turn: 1 };
    expect(
      run(reading(null, 0, [], { yes_no: 'yes' }), { clarified: two, turnsTaken: 1 }).decision,
    ).toEqual({ kind: 'knowledge' });
  });

  it('4 — a question from an earlier turn is not "straight after": it may be asked again', () => {
    const old = { keys: ['deposit', 'withdrawal'], turn: 1 };
    expect(run(reading('bonus', 0.5), { clarified: old, turnsTaken: 4 }).decision).toMatchObject({
      kind: 'clarify',
    });
  });

  it('4 — with a procedure in progress nothing is asked: it carries on (2)', () => {
    const active = {
      skillId: 'deposit',
      snapshot: { skill_name: 'Yatırım', ai_agent_id: null, locked: false, procedure: {} },
      hash: 'h',
      stepId: 'yontem',
      stepStatus: 'awaiting_answer',
      procedureTurns: 1,
    } as unknown as ActiveProcedure;
    const result = run(reading('bonus', 0.5), { active });
    expect(result.decision).toMatchObject({ kind: 'continue' });
    expect(result.record).toMatchObject({ step: 2, rule: 'continue' });
  });

  it('5 — below low: the knowledge path; small talk gets its short reply instead', () => {
    expect(run(reading('deposit', 0.39)).decision).toEqual({ kind: 'knowledge' });
    expect(run(reading('deposit', 0.39)).record).toMatchObject({ step: 5, rule: 'knowledge' });
    const hello = run(reading(null, 0, [], {}, { smalltalk: true }));
    expect(hello.decision).toEqual({ kind: 'smalltalk' });
    expect(hello.record).toMatchObject({ step: 5, rule: 'smalltalk' });
  });

  it('the agent’s thresholds move every boundary', () => {
    const strict = { high: 0.9, low: 0.6 };
    expect(run(reading('deposit', 0.85), { thresholds: strict }).decision).toMatchObject({
      kind: 'clarify',
    });
    expect(run(reading('deposit', 0.55), { thresholds: strict }).decision).toEqual({
      kind: 'knowledge',
    });
  });
});

describe('the clarifying question', () => {
  it('names the procedures in the reply’s language', () => {
    expect(clarifyQuestion([DEPOSIT, WITHDRAWAL], 'tr')).toBe(
      'Tam anlayamadım: “Yatırım” konusunda mı, yoksa “Çekim” konusunda mı yardım istiyorsunuz?',
    );
    expect(clarifyQuestion([DEPOSIT], 'en')).toBe('Just to be sure — is this about “Yatırım”?');
    expect(clarifyQuestion([DEPOSIT, WITHDRAWAL], null)).toMatch(/^Tam anlayamadım/);
  });

  it('is kept as keys and the turn; anything else reads as none', () => {
    const signal = clarifySignal([DEPOSIT, WITHDRAWAL], 2);
    expect(readClarifyMark({ [CLARIFY_SIGNAL]: signal })).toEqual({
      keys: ['deposit', 'withdrawal'],
      turn: 2,
    });
    expect(readClarifyMark({})).toBeNull();
    expect(readClarifyMark({ [CLARIFY_SIGNAL]: { keys: [], turn: 2 } })).toBeNull();
    expect(readClarifyMark({ [CLARIFY_SIGNAL]: { keys: ['a'], turn: '2' } })).toBeNull();
  });
});

describe('the language check (AI-05 §7)', () => {
  const turkish = readPersona({ tone: null, languages: ['tr'], persona: null });

  it('a language the rule cannot tell, read by the understanding, is unsupported', () => {
    expect(languageVerdict('Здравствуйте, депозит не пришёл', turkish, 'ru')).toEqual({
      detected: null,
      answerIn: null,
      unsupported: true,
    });
  });

  it('a guess at a language the rule knows does not overrule it: an order number is in none', () => {
    expect(languageVerdict('ORD-99231', turkish, 'en').unsupported).toBe(false);
  });

  it('no reading: the rule alone, as before', () => {
    const english = 'Hello, I would like to know when my deposit will arrive in my account please';
    expect(languageVerdict(english, turkish, null).unsupported).toBe(true);
    expect(languageVerdict('param yatmadı', turkish, undefined).unsupported).toBe(false);
  });

  it('a persona that declares nothing serves every language', () => {
    const open = readPersona({ tone: null, languages: [], persona: null });
    expect(languageVerdict('Здравствуйте', open, 'ru').unsupported).toBe(false);
  });
});

describe('several agents’ thresholds', () => {
  it('none: the defaults; several: the stricter of each', () => {
    expect(turnThresholds([])).toEqual({ high: 0.7, low: 0.4 });
    expect(
      turnThresholds([
        { high: 0.8, low: 0.3 },
        { high: 0.6, low: 0.5 },
      ]),
    ).toEqual({ high: 0.8, low: 0.5 });
  });
});
