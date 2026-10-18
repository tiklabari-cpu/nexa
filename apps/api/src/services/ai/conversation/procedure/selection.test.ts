/**
 * Which procedure a turn runs (tm 296.3 · AI-03 §7, AI-05 §4.3; AI-03-S3) —
 * the topic change, the one topic set aside, the question about it, the
 * locked procedures — and the interim understanding that feeds it until #297.
 */
import { describe, expect, it } from 'vitest';
import { depositProcedure } from '../../../../../test/helpers/procedure-fixtures.js';
import {
  procedureHash,
  suspend,
  type ActiveProcedure,
  type SuspendedProcedure,
} from './executor.js';
import { selectProcedure } from './selection.js';
import {
  PROCEDURE_START_CONFIDENCE,
  interimUnderstanding,
  rankProcedures,
  type CatalogueEntry,
  type ProcedureUnderstanding,
} from './understanding.js';

const NOW = new Date('2026-10-18T10:50:00Z');

const DEPOSIT: CatalogueEntry = {
  key: 'deposit',
  name: 'Yatırım geçmedi',
  examples: ['param yatmadı', 'havale attım gözükmüyor'],
  priority: 50,
  locked: false,
};
const WITHDRAWAL: CatalogueEntry = {
  key: 'withdrawal',
  name: 'Çekim',
  examples: ['çekim yapamıyorum', 'para çekemiyorum'],
  priority: 100,
  locked: false,
};
const SELF_EXCLUSION: CatalogueEntry = {
  key: 'self_exclusion',
  name: 'Kendini sınırlama',
  examples: ['hesabımı kapatın'],
  priority: 100,
  locked: true,
};
const CATALOGUE = [DEPOSIT, WITHDRAWAL, SELF_EXCLUSION];

function active(
  key: string,
  stepStatus: ActiveProcedure['stepStatus'] = 'awaiting_answer',
  locked = false,
): ActiveProcedure {
  const procedure = depositProcedure();
  return {
    skillId: key,
    snapshot: { skill_name: key, ai_agent_id: null, locked, procedure },
    hash: procedureHash(procedure),
    stepId: 'yontem_zaman',
    stepStatus,
    procedureTurns: 1,
  };
}

function about(
  key: string | null,
  confidence = 0.9,
  extra: Partial<ProcedureUnderstanding> = {},
): ProcedureUnderstanding {
  return { intent: { procedure_key: key, confidence }, ...extra };
}

function select(
  understanding: ProcedureUnderstanding,
  state: { active?: ActiveProcedure | null; suspended?: SuspendedProcedure | null } = {},
) {
  return selectProcedure({
    understanding,
    catalogue: CATALOGUE,
    active: state.active ?? null,
    suspended: state.suspended ?? null,
    slots: { yontem: { status: 'filled', display: 'Papara', value: 'Papara' } },
    now: NOW,
  });
}

describe('the topic change (AI-03 §7)', () => {
  it('with nothing in progress, the best candidate starts; below the threshold, nothing does', () => {
    expect(select(about('deposit')).selection).toEqual({ kind: 'start', key: 'deposit' });
    expect(select(about('deposit', PROCEDURE_START_CONFIDENCE - 0.01)).selection).toEqual({
      kind: 'none',
    });
    expect(select(about('not_in_the_catalogue')).selection).toEqual({ kind: 'none' });
  });

  it('the active procedure carries on: the same topic, no topic, or an answer to its question', () => {
    const deposit = active('deposit');
    expect(select(about('deposit'), { active: deposit }).selection.kind).toBe('continue');
    expect(select(about(null, 0), { active: deposit }).selection.kind).toBe('continue');
    expect(
      select(about('withdrawal', 0.95, { answers_pending_question: true }), { active: deposit })
        .selection.kind,
    ).toBe('continue');
  });

  it('another topic, sure, while the active one waits: it is set aside with what it collected, and the new one starts', () => {
    const result = select(about('withdrawal'), { active: active('deposit') });
    expect(result.selection).toEqual({ kind: 'start', key: 'withdrawal' });
    expect(result.suspended).toMatchObject({
      skill_id: 'deposit',
      step_id: 'yontem_zaman',
      step_status: 'awaiting_answer',
      slots: { yontem: { status: 'filled' } },
      procedure_turns: 1,
      suspended_at: NOW.toISOString(),
      offered: false,
    });
  });

  it('at most one topic waits: a second set-aside replaces the first (AI-03-S3)', () => {
    const earlier = suspend(active('older'), {}, new Date('2026-10-18T10:00:00Z'));
    const result = select(about('withdrawal'), { active: active('deposit'), suspended: earlier });
    expect(result.suspended?.skill_id).toBe('deposit');
    expect(result.log.at(-1)?.detail).toContain('in place of older');
  });

  it('an active procedure that was not waiting for the player is left, not set aside', () => {
    const earlier = suspend(active('older'), {}, NOW);
    const result = select(about('withdrawal'), {
      active: active('deposit', 'ready'),
      suspended: earlier,
    });
    expect(result.selection).toEqual({ kind: 'start', key: 'withdrawal' });
    expect(result.suspended).toBe(earlier);
  });

  it('a locked procedure goes before everything: it takes over and the set-aside topic is dropped', () => {
    const earlier = suspend(active('older'), {}, NOW);
    const result = select(about('self_exclusion'), {
      active: active('deposit'),
      suspended: earlier,
    });
    expect(result.selection).toEqual({ kind: 'start', key: 'self_exclusion' });
    expect(result.suspended).toBeNull();

    const idle = select(about('self_exclusion'), { suspended: earlier });
    expect(idle.selection).toEqual({ kind: 'start', key: 'self_exclusion' });
    expect(idle.suspended).toBeNull();
  });

  it('nothing takes over from a locked procedure but another locked one', () => {
    const locked = active('self_exclusion', 'awaiting_answer', true);
    expect(select(about('withdrawal'), { active: locked }).selection.kind).toBe('continue');
  });
});

describe('"Önceki konuya dönelim mi?" (AI-03 §7)', () => {
  const offered = (): SuspendedProcedure => ({
    ...suspend(active('deposit'), { yontem: { status: 'filled' } }, NOW),
    offered: true,
  });

  it('yes takes the set-aside topic up where it stood', () => {
    const result = select(about(null, 0, { yes_no: 'yes' }), { suspended: offered() });
    expect(result.selection).toMatchObject({
      kind: 'resume',
      active: { skillId: 'deposit', stepId: 'yontem_zaman', stepStatus: 'awaiting_answer' },
    });
    expect(result.suspended).toBeNull();
  });

  it('no lets it go — and a turn is still taken to say so', () => {
    const result = select(about(null, 0, { yes_no: 'no' }), { suspended: offered() });
    expect(result.selection).toEqual({
      kind: 'declined',
      skillId: 'deposit',
      skillName: 'deposit',
    });
    expect(result.suspended).toBeNull();
  });

  it('no, with another topic in the same message: that topic starts and nothing stays aside', () => {
    const result = select(about('withdrawal', 0.9, { yes_no: 'no' }), { suspended: offered() });
    expect(result.selection).toEqual({ kind: 'start', key: 'withdrawal' });
    expect(result.suspended).toBeNull();
  });

  it('a message about the set-aside topic itself takes it up again, offered or not', () => {
    const waiting = suspend(active('deposit'), {}, NOW);
    expect(select(about('deposit'), { suspended: waiting }).selection.kind).toBe('resume');
  });

  it('neither yes nor no leaves the question standing', () => {
    const result = select(about(null, 0), { suspended: offered() });
    expect(result.selection).toEqual({ kind: 'none' });
    expect(result.suspended?.offered).toBe(true);
  });
});

describe('ranking the candidates (AI-05 §4.3)', () => {
  it('within the tie margin: locked first, then the smaller priority, then the higher confidence', () => {
    const ranked = (understanding: ProcedureUnderstanding) =>
      rankProcedures(understanding, CATALOGUE).map((candidate) => candidate.entry.key);
    expect(
      ranked({
        intent: {
          procedure_key: 'withdrawal',
          confidence: 0.9,
          alternatives: [{ key: 'deposit', confidence: 0.85 }],
        },
      }),
    ).toEqual(['deposit', 'withdrawal']);
    expect(
      ranked({
        intent: {
          procedure_key: 'deposit',
          confidence: 0.9,
          alternatives: [{ key: 'self_exclusion', confidence: 0.82 }],
        },
      }),
    ).toEqual(['self_exclusion', 'deposit']);
    expect(
      ranked({
        intent: {
          procedure_key: 'withdrawal',
          confidence: 0.95,
          alternatives: [{ key: 'deposit', confidence: 0.75 }],
        },
      }),
    ).toEqual(['withdrawal', 'deposit']);
  });
});

describe('the interim understanding (until #297)', () => {
  const procedure = depositProcedure();
  const read = { now: NOW, timeZone: 'Europe/Istanbul', currency: 'TRY' };
  const options = { yontem: [{ value: 'Papara' }, { value: 'Havale' }] };

  it('finds the procedure by its example sentences', () => {
    const result = interimUnderstanding({
      text: 'Param yatmadı!',
      catalogue: CATALOGUE,
      pending: null,
      read,
    });
    expect(result.intent).toMatchObject({ procedure_key: 'deposit', confidence: 1 });
    expect(result.extracted).toEqual([]);
  });

  it('reads the message only for the slots the AI is waiting on, and only where it holds something of their kind', () => {
    const pending = {
      defs: procedure.slots as never,
      slots: {},
      asked: ['yontem', 'islem_zamani'],
      key: 'deposit',
    };
    const both = interimUnderstanding({
      text: 'Papara 13:40',
      catalogue: CATALOGUE,
      pending,
      read,
      options,
    });
    expect(both.extracted).toEqual([
      { slot: 'yontem', raw_text: 'Papara 13:40' },
      { slot: 'islem_zamani', raw_text: 'Papara 13:40' },
    ]);
    expect(both.answers_pending_question).toBe(true);

    const one = interimUnderstanding({
      text: 'papara ile',
      catalogue: CATALOGUE,
      pending,
      read,
      options,
    });
    expect(one.extracted).toEqual([{ slot: 'yontem', raw_text: 'papara ile' }]);

    const other = interimUnderstanding({
      text: 'çekim yapamıyorum',
      catalogue: CATALOGUE,
      pending,
      read,
      options,
    });
    expect(other.extracted).toEqual([]);
    expect(other.answers_pending_question).toBe(false);
    expect(other.intent.procedure_key).toBe('withdrawal');
  });

  it('answers yes or no in Turkish', () => {
    const yes = interimUnderstanding({ text: 'evet', catalogue: [], pending: null, read });
    const no = interimUnderstanding({ text: 'hayır', catalogue: [], pending: null, read });
    const neither = interimUnderstanding({ text: 'bilmem', catalogue: [], pending: null, read });
    expect([yes.yes_no, no.yes_no, neither.yes_no]).toEqual(['yes', 'no', null]);
  });
});
