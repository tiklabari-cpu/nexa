/**
 * What one live AI turn adds to its connection's outcome row (tm 320.1 ·
 * AI-25 "her AI turunda sayaçlar ve konu güncellenir"), and when its reply
 * carries the widget's "is it solved?" buttons (AI-25-S2, K9).
 */
import { describe, expect, it } from 'vitest';
import { validateProcedure, type Procedure, type ResolutionRecord } from '@siyahtus/types';
import { outcomeTurnOf, resolutionPromptOf, type OutcomeTurnContext } from './outcome-turn.js';
import { emptyTurnState, type TurnDecisions, type TurnResult } from './conversation/turn.js';

const SKILL = '3f1c6c1e-6c34-4a46-8b52-0b6b8f1f1a01';
const AGENT = '7d3f2a90-1b9e-4c55-9d1e-4f0a8f6b2c02';

function procedure(): Procedure {
  const result = validateProcedure({
    when_to_use: 'Yatırım geçmedi.',
    slots: [
      { name: 'yontem', label: 'Yöntem', type: 'text', ask: 'Hangi yöntemle?' },
      { name: 'zaman', label: 'Zaman', type: 'datetime', ask: 'Ne zaman?' },
      { name: 'not', label: 'Not', type: 'text', ask: 'Not?', required: 'never' },
    ],
    steps: [
      { id: 'sor', type: 'collect', slots: ['yontem', 'zaman'] },
      { id: 'bitti', type: 'resolve', outcome: 'resolved' },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

const decided = (more: Partial<TurnDecisions> = {}): TurnDecisions => ({
  outcome: 'answered',
  skillId: SKILL,
  skillName: 'Yatırım',
  replyKind: 'answer',
  failure: null,
  capped: null,
  usage: { llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 0 },
  log: [],
  ...more,
});

const resolution = (more: Partial<ResolutionRecord>): ResolutionRecord => ({
  decision: 'asked',
  reason: 'awaiting_confirmation',
  basis: 'platform',
  result: 'unknown',
  unknown: [],
  confirmation: null,
  ...more,
});

function result(more: Partial<TurnResult> = {}): TurnResult {
  return {
    reply: 'Hangi yöntemle yatırdınız?',
    decisions: decided(),
    nextState: {
      ...emptyTurnState(),
      activeSkillId: SKILL,
      procedureSnapshot: {
        skill_name: 'Yatırım',
        ai_agent_id: AGENT,
        locked: false,
        procedure: procedure(),
      },
      slots: { yontem: { value: 'papara', display: 'Papara', status: 'filled' } },
    },
    sideEffects: [],
    ...more,
  };
}

const ctx: OutcomeTurnContext = {
  at: new Date('2026-10-28T10:00:00Z'),
  customerId: 'cust-1',
  trust: 'verified',
  config: { skills: [] },
  configVersionId: null,
  playerTurns: 2,
};

describe('a turn’s contribution to the outcome row (AI-25)', () => {
  it('counts the turn and the messages it answered; a collect question is a clarification turn', () => {
    const turn = outcomeTurnOf(result({ decisions: decided({ replyKind: 'question' }) }), ctx);
    expect(turn).toMatchObject({
      aiTurns: 1,
      playerTurns: 2,
      clarificationTurns: 1,
      intent: SKILL,
      procedureId: SKILL,
      aiAgentId: AGENT,
      memberKey: 'cust-1',
    });
  });

  it('counts the procedure’s required slots — a never-required one not — and the known ones', () => {
    expect(outcomeTurnOf(result(), ctx).requiredSlots).toEqual({ total: 2, filled: 1 });
    const none = outcomeTurnOf(
      result({ nextState: emptyTurnState(), reply: 'Bonus kuralları şöyle.' }),
      ctx,
    );
    expect(none).toMatchObject({ requiredSlots: null, clarificationTurns: 0, intent: null });
  });

  it('a turn with no reply is no AI turn; a claimed visitor has no member key (K4)', () => {
    const turn = outcomeTurnOf(result({ reply: null }), { ...ctx, trust: 'claimed' });
    expect(turn).toMatchObject({ aiTurns: 0, memberKey: null });
  });

  it('keeps what the AI claimed and what the player answered apart (K9)', () => {
    const asked = outcomeTurnOf(
      result({ decisions: decided({ resolution: resolution({}) }) }),
      ctx,
    );
    expect(asked).toMatchObject({ claimedResolved: false, confirmation: null });
    const yes = outcomeTurnOf(
      result({
        decisions: decided({
          resolution: resolution({
            decision: 'resolved',
            reason: 'criteria_met',
            confirmation: 'yes',
          }),
        }),
      }),
      ctx,
    );
    expect(yes).toMatchObject({ claimedResolved: true, confirmation: 'yes' });
  });

  it('keeps the guardrail hits as rule, stage and action — never the words', () => {
    const turn = outcomeTurnOf(
      result({
        decisions: decided({
          guardrails: {
            hits: [
              {
                rule_key: 'G3',
                stage: 'input',
                action: 'handoff',
                evidence: 'oynamak istemiyorum',
                pattern_index: 0,
              },
            ],
            catalog_version: '1',
          } as unknown as TurnDecisions['guardrails'],
        }),
      }),
      ctx,
    );
    expect(turn.guardrailHits).toEqual([{ rule_key: 'G3', stage: 'input', action: 'handoff' }]);
  });
});

describe('the widget’s "is it solved?" buttons (AI-25-S2)', () => {
  it('go under a reply that asks, or that says solved without the player’s yes', () => {
    const with_ = (record: ResolutionRecord, reply: string | null = 'Çözüldü mü?') =>
      resolutionPromptOf(result({ reply, decisions: decided({ resolution: record }) }));
    expect(with_(resolution({}))).toBe('asked');
    expect(with_(resolution({ decision: 'resolved', reason: 'criteria_met' }))).toBe('resolved');
    expect(
      with_(resolution({ decision: 'resolved', reason: 'criteria_met', confirmation: 'yes' })),
    ).toBeNull();
    expect(with_(resolution({ decision: 'unresolved', reason: 'player_said_no' }))).toBeNull();
    expect(with_(resolution({}), null)).toBeNull();
    expect(resolutionPromptOf(result())).toBeNull();
  });
});
