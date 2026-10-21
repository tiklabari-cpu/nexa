import { describe, expect, it } from 'vitest';
import type { HandoffReason } from '@siyahtus/types';
import type { EmbeddedQuery } from '../knowledge-service.js';
import type { UnansweredReason } from './knowledge-answer.js';
import {
  emptyTurnState,
  type TurnContext,
  type TurnDecisions,
  type TurnMessage,
  type TurnResult,
  type TurnState,
} from './turn.js';
import { unresolvedOf, unresolvedReasonOf } from './unresolved.js';

const AGENT = '00000000-0000-4000-8000-0000000000a1';
const OTHER_AGENT = '00000000-0000-4000-8000-0000000000a2';
const SKILL = '00000000-0000-4000-8000-0000000000b1';
const TEXT = 'Canlı casino masaları hangi saatlerde açık?';

const decided = (over: Partial<TurnDecisions> = {}): TurnDecisions => ({
  outcome: 'answered',
  skillId: null,
  skillName: null,
  replyKind: 'answer',
  failure: null,
  capped: null,
  usage: { llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 0 },
  log: [],
  ...over,
});

const turn = (over: Partial<TurnDecisions> = {}, reply: string | null = 'yanıt'): TurnResult => ({
  reply,
  decisions: decided(over),
  nextState: emptyTurnState(),
  sideEffects: over.handoffReasons ? [{ kind: 'handoff', team: null }] : [],
});

const unanswered = (reason: UnansweredReason) => ({
  language: 'tr' as const,
  category: 'other' as const,
  policy: 'ask' as const,
  reason,
});

const handedOver = (...reasons: HandoffReason[]): Partial<TurnDecisions> => ({
  outcome: 'handed_off',
  handoffReasons: reasons,
});

const POLICY = { step: 6, rule: 'unmatched' } as unknown as TurnDecisions['policy'];

const answeredBefore: TurnState = { ...emptyTurnState(), counters: { turns: 2 } };

function context(over: Partial<TurnContext> = {}): TurnContext {
  return {
    mode: 'live',
    chatId: 'CHAT0000001',
    brandId: null,
    configVersionId: null,
    config: {
      skills: [
        { id: SKILL, name: 'İadeler', aiAgentId: AGENT },
        { id: 'x', name: 'Diğer', aiAgentId: OTHER_AGENT },
      ],
    },
    ...over,
  } as unknown as TurnContext;
}

const message = (text = TEXT): TurnMessage => ({ text }) as TurnMessage;
const embedded = (text: string, vector: string | null = '[0.1,0.2]') => ({
  text,
  query: { space: 'mock:lexical-v1', vector, usage: { inputTokens: 3 } } as EmbeddedQuery,
});

describe('unresolvedReasonOf — why a turn left the message unresolved (AI-22 §1 · tm 317.1)', () => {
  const state = emptyTurnState();

  it('reads the knowledge path’s miss: no procedure, no knowledge, no grounding, said it cannot', () => {
    expect(
      unresolvedReasonOf(state, turn({ unanswered: unanswered('no_passages'), policy: POLICY })),
    ).toBe('no_procedure_match');
    expect(unresolvedReasonOf(state, turn({ unanswered: unanswered('no_passages') }))).toBe(
      'no_knowledge',
    );
    expect(unresolvedReasonOf(state, turn({ unanswered: unanswered('not_grounded') }))).toBe(
      'low_confidence',
    );
    expect(unresolvedReasonOf(state, turn({ unanswered: unanswered('withheld') }))).toBe(
      'said_dont_know',
    );
    expect(unresolvedReasonOf(state, turn({ unanswered: unanswered('nothing_answered') }))).toBe(
      'said_dont_know',
    );
  });

  it('reads the hand-over: a language not spoken, turns not understood, a person asked for after an answer', () => {
    expect(unresolvedReasonOf(state, turn(handedOver('unsupported_language')))).toBe(
      'unsupported_language',
    );
    expect(unresolvedReasonOf(state, turn(handedOver('not_understood')))).toBe(
      'not_understood_handoff',
    );
    expect(unresolvedReasonOf(answeredBefore, turn(handedOver('player_request')))).toBe(
      'asked_human_after_ai',
    );
    // A person asked for first thing is a request, not a gap.
    expect(unresolvedReasonOf(state, turn(handedOver('player_request')))).toBeNull();
  });

  it('leaves out an answered turn and the hand-overs that are not a gap', () => {
    expect(unresolvedReasonOf(state, turn())).toBeNull();
    expect(unresolvedReasonOf(state, turn(handedOver('max_turns')))).toBeNull();
    expect(unresolvedReasonOf(state, turn(handedOver('missing_required_info')))).toBeNull();
  });

  it('never lists a compliance hand-over — self-exclusion, self-harm, a minor, a complaint (AI-22 acceptance)', () => {
    for (const reason of [
      'guardrail_rg',
      'guardrail_self_harm',
      'guardrail_minor',
      'guardrail_account_security',
      'guardrail_complaint',
      'risk_flag',
      'abuse',
    ] as const) {
      // Even when the knowledge path had found nothing as well.
      expect(
        unresolvedReasonOf(
          state,
          turn({ ...handedOver(reason, 'no_knowledge'), unanswered: unanswered('no_passages') }),
        ),
      ).toBeNull();
    }
  });

  it('never lists a turn a compliance rule touched without handing over (G4, G2)', () => {
    for (const rule of ['G4', 'G2']) {
      const guardrails = {
        catalog_version: 'v',
        hits: [
          {
            rule_key: rule,
            stage: 'input',
            action: 'evidence',
            evidence: null,
            pattern_index: null,
          },
        ],
        risk_flags: [],
      } as unknown as TurnDecisions['guardrails'];
      expect(
        unresolvedReasonOf(state, turn({ unanswered: unanswered('no_passages'), guardrails })),
      ).toBeNull();
    }
    // A workspace's own phrase is not compliance.
    const own = {
      catalog_version: 'v',
      hits: [
        {
          rule_key: 'phrase:00000000-0000-4000-8000-000000000001',
          stage: 'output',
          action: 'block',
        },
      ],
      risk_flags: [],
    } as unknown as TurnDecisions['guardrails'];
    expect(
      unresolvedReasonOf(state, turn({ unanswered: unanswered('withheld'), guardrails: own })),
    ).toBe('said_dont_know');
  });
});

describe('unresolvedOf — the live turn’s capture (AI-22 §1–§3 · tm 317.1)', () => {
  const missed = turn({
    unanswered: unanswered('no_passages'),
    policy: POLICY,
    understood: {
      procedure_key: null,
      confidence: 0.2,
      alternatives: [{ key: 'deposit_not_credited', confidence: 0.2 }],
      language: 'tr',
      tries: 1,
    },
  });

  it('keeps why, the words as they came, the agent, the brand, the language and the guess', () => {
    const capture = unresolvedOf({
      state: emptyTurnState(),
      message: message(),
      ctx: context({ brandId: 'b0000000-0000-4000-8000-000000000001' }),
      result: missed,
      embedded: undefined,
    });
    expect(capture).toEqual({
      reason: 'no_procedure_match',
      text: TEXT,
      aiAgentId: AGENT,
      brandId: 'b0000000-0000-4000-8000-000000000001',
      configVersionId: null,
      language: 'tr',
      intentGuess: 'deposit_not_credited',
      embedding: null,
    });
  });

  it('reuses the turn’s own embedding of the message, never one of another text (AI-22 §3)', () => {
    const of = (e: ReturnType<typeof embedded> | undefined) =>
      unresolvedOf({
        state: emptyTurnState(),
        message: message(),
        ctx: context(),
        result: missed,
        embedded: e,
      })?.embedding;
    expect(of(embedded(TEXT))).toEqual({ space: 'mock:lexical-v1', vector: '[0.1,0.2]' });
    expect(of(embedded('a step’s hint'))).toBeNull();
    expect(of(embedded(TEXT, null))).toBeNull();
  });

  it('files it under the agent of the skill that ran', () => {
    const capture = unresolvedOf({
      state: emptyTurnState(),
      message: message(),
      ctx: context(),
      result: turn({ skillId: 'x', unanswered: unanswered('nothing_answered') }),
      embedded: undefined,
    });
    expect(capture?.aiAgentId).toBe(OTHER_AGENT);
  });

  it('captures nothing outside a live turn, for a turn not taken, or for words not worth grouping', () => {
    const base = {
      state: emptyTurnState(),
      message: message(),
      result: missed,
      embedded: undefined,
    };
    expect(unresolvedOf({ ...base, ctx: context({ mode: 'preview' }) })).toBeNull();
    expect(unresolvedOf({ ...base, ctx: context({ mode: 'simulation' }) })).toBeNull();
    expect(
      unresolvedOf({ ...base, ctx: context(), result: { ...turn({}, null), sideEffects: [] } }),
    ).toBeNull();
    for (const text of ['merhaba', '?', '👍']) {
      expect(unresolvedOf({ ...base, ctx: context(), message: message(text) })).toBeNull();
    }
    expect(
      unresolvedOf({
        ...base,
        ctx: context({ config: { skills: [{ id: SKILL, name: 'x', aiAgentId: null }] } } as never),
      }),
    ).toBeNull();
  });
});
