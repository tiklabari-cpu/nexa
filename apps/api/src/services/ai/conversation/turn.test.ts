/**
 * The turn contract's helpers (tm 292.2): the state a turn sees, the patch a
 * live turn saves, and how its decisions become the run row.
 */
import { describe, expect, it } from 'vitest';
import { AI_CONVERSATION_PATCH_FIELDS, type AiConversationState } from './state-store.js';
import {
  describeSideEffects,
  emptyTurnState,
  skillRunRecord,
  toTurnState,
  tookTurn,
  turnStatePatch,
  turnsTaken,
  TURN_STATE_FIELDS,
  type TurnDecisions,
  type TurnResult,
} from './turn.js';

const ROW: AiConversationState = {
  id: '0b6c7a8e-1f2d-4c3b-9a4e-5d6f7a8b9c0d',
  chatId: 'C1234567890A',
  threadId: 'T1234567890A',
  ...emptyTurnState(),
  modeChangedAt: null,
  modeChangedBy: null,
  modeReason: null,
  counters: { turns: 2 },
  version: 4,
  configVersionId: null,
  createdAt: new Date('2026-10-17T09:00:00Z'),
  updatedAt: new Date('2026-10-17T09:01:00Z'),
  closedAt: null,
};

function decisions(overrides: Partial<TurnDecisions> = {}): TurnDecisions {
  return {
    outcome: 'answered',
    skillId: 'skill-1',
    skillName: 'Delivery',
    replyKind: 'answer',
    failure: null,
    capped: null,
    usage: { llmInputTokens: 10, llmOutputTokens: 2, embeddingTokens: 3 },
    log: [{ step: 'send_message', detail: 'sent the fixed reply', ok: true }],
    ...overrides,
  };
}

describe('the turn state', () => {
  it('is a subset of what a save may write — a turn cannot ask to move the lock or the identity', () => {
    for (const field of TURN_STATE_FIELDS) expect(AI_CONVERSATION_PATCH_FIELDS).toContain(field);
    expect(TURN_STATE_FIELDS).not.toContain('configVersionId');
  });

  it('reads a stored row without its identity, lock and pinned version', () => {
    const state = toTurnState(ROW);
    expect(Object.keys(state).sort()).toEqual([...TURN_STATE_FIELDS].sort());
    expect(state).not.toHaveProperty('version');
    expect(state.counters).toEqual({ turns: 2 });
  });

  it('counts the turns taken, reading a damaged counter as none', () => {
    expect(turnsTaken(emptyTurnState())).toBe(0);
    expect(turnsTaken({ ...emptyTurnState(), counters: { turns: 5 } })).toBe(5);
    expect(turnsTaken({ ...emptyTurnState(), counters: { turns: 'five' } })).toBe(0);
    expect(turnsTaken({ ...emptyTurnState(), counters: { turns: -1 } })).toBe(0);
  });
});

describe('turnStatePatch', () => {
  it('names only the fields the turn changed, compared by value', () => {
    const before = toTurnState(ROW);
    const after = {
      ...before,
      // Rebuilt, same content: not a change.
      slots: { ...before.slots },
      counters: { turns: 3 },
      stepStatus: 'awaiting_answer' as const,
    };
    expect(turnStatePatch(before, after)).toEqual({
      counters: { turns: 3 },
      stepStatus: 'awaiting_answer',
    });
  });

  it('is empty when nothing moved', () => {
    expect(turnStatePatch(emptyTurnState(), emptyTurnState())).toEqual({});
  });

  it('carries a field set back to null', () => {
    const before = { ...emptyTurnState(), stepId: 's2' };
    expect(turnStatePatch(before, { ...before, stepId: null })).toEqual({ stepId: null });
  });
});

describe('the side effects', () => {
  it('read as the preview shows them: tags in order, the hand-over, the summary', () => {
    expect(
      describeSideEffects([
        { kind: 'tag', tag: 'a' },
        { kind: 'summary', text: 'Soru: x' },
        { kind: 'tag', tag: 'b' },
        { kind: 'handoff', team: 'Finance' },
      ]),
    ).toEqual({ tags: ['a', 'b'], transferTo: 'Finance', summary: 'Soru: x' });
    expect(describeSideEffects([])).toEqual({ tags: [], transferTo: null, summary: null });
  });
});

describe('the run row', () => {
  it('is none when no skill ran', () => {
    expect(skillRunRecord(decisions({ skillId: null, outcome: 'skipped' }))).toBeNull();
  });

  it('carries the outcome in the log and the cost on the row', () => {
    expect(skillRunRecord(decisions())).toEqual({
      skillId: 'skill-1',
      status: 'succeeded',
      log: {
        outcome: 'answered',
        entries: [{ step: 'send_message', detail: 'sent the fixed reply', ok: true }],
      },
      llmInputTokens: 10,
      llmOutputTokens: 2,
      embeddingTokens: 3,
    });
  });

  it('fails on a step that could not do its job, never on a gate that did not match', () => {
    const failedStep = decisions({
      log: [{ step: 'send_message', detail: 'the model could not answer (auth)', ok: false }],
    });
    const missedGate = decisions({
      log: [
        { step: 'detect_intent', detail: 'no match for "refund"', ok: false },
        { step: 'tag', detail: 'tagged "x"', ok: true },
      ],
    });
    expect(skillRunRecord(failedStep)?.status).toBe('failed');
    expect(skillRunRecord(missedGate)?.status).toBe('succeeded');
  });
});

describe('tookTurn', () => {
  const turn = (overrides: Partial<TurnDecisions>): TurnResult => ({
    reply: null,
    decisions: decisions(overrides),
    nextState: emptyTurnState(),
    sideEffects: [],
  });

  it('is a turn when a skill ran, even one that said nothing', () => {
    expect(tookTurn(turn({ outcome: 'skipped', replyKind: null }))).toBe(true);
  });

  it('is no turn when no skill matched', () => {
    expect(tookTurn(turn({ skillId: null, skillName: null, outcome: 'skipped' }))).toBe(false);
  });
});
