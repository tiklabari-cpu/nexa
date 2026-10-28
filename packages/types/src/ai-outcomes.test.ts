import { describe, expect, it } from 'vitest';
import {
  AI_OUTCOMES,
  QA_UNRESOLVED_CRITERIA,
  mandatoryHandoffRule,
  outcomeAtClose,
  qaResultOf,
  type OutcomeAtCloseInput,
} from './ai-outcomes.js';
import { PLATFORM_QA_RUBRIC } from './qa.js';

const open: OutcomeAtCloseInput = {
  outcome: null,
  aiMode: 'ai',
  conversationOutcome: 'resolved',
  confirmation: null,
};

describe('how the close settles an AI outcome row (tm 320.1 · AI-25)', () => {
  it('keeps an outcome already settled — a hand-over or a confirmed resolution', () => {
    expect(outcomeAtClose({ ...open, outcome: 'handed_off', aiMode: 'ai' })).toBe('handed_off');
    expect(outcomeAtClose({ ...open, outcome: 'confirmed_resolved', aiMode: 'human' })).toBe(
      'confirmed_resolved',
    );
  });

  it('a person who took the connection makes it handed_off, before anything else', () => {
    expect(outcomeAtClose({ ...open, aiMode: 'human', confirmation: 'no' })).toBe('handed_off');
  });

  it('a player who left while the AI waited is abandoned; one who said no and got nobody declined', () => {
    expect(outcomeAtClose({ ...open, conversationOutcome: 'abandoned' })).toBe('abandoned');
    expect(outcomeAtClose({ ...open, confirmation: 'no' })).toBe('declined');
    expect(outcomeAtClose({ ...open, confirmation: 'yes' })).toBe('confirmed_resolved');
  });

  it('with no hand-over and no answer either way it waits as assumed_pending', () => {
    expect(outcomeAtClose(open)).toBe('assumed_pending');
    expect(outcomeAtClose({ ...open, aiMode: null, conversationOutcome: null })).toBe(
      'assumed_pending',
    );
  });

  it('never settles to an outcome only the finalize job may write', () => {
    const reachable = new Set<string>();
    for (const outcome of [null, ...AI_OUTCOMES.filter((o) => !o.startsWith('assumed_r'))]) {
      for (const aiMode of ['ai', 'human', null]) {
        for (const conversationOutcome of ['resolved', 'abandoned', null]) {
          for (const confirmation of ['yes', 'no', null] as const) {
            if (outcome === 'false_resolved') continue;
            reachable.add(outcomeAtClose({ outcome, aiMode, conversationOutcome, confirmation }));
          }
        }
      }
    }
    expect(reachable.has('assumed_resolved')).toBe(false);
    expect(reachable.has('false_resolved')).toBe(false);
  });
});

describe('the QA result an outcome row keeps', () => {
  it('a passed review is pass; a failed one is unresolved only when a solving criterion failed', () => {
    expect(qaResultOf('pass', [])).toBe('pass');
    expect(qaResultOf('fail', ['tone'])).toBe('fail');
    expect(qaResultOf('fail', ['guardrails'])).toBe('fail');
    expect(qaResultOf('fail', ['tone', 'faithfulness'])).toBe('unresolved');
  });

  it('names only criteria of the platform rubric', () => {
    const keys = PLATFORM_QA_RUBRIC.map((criterion) => criterion.key);
    for (const key of QA_UNRESOLVED_CRITERIA) expect(keys).toContain(key);
  });
});

describe('the mandatory rule a hand-over was made for', () => {
  it('is the most severe compliance reason among them, or null', () => {
    expect(mandatoryHandoffRule(['no_knowledge', 'guardrail_rg'])).toBe('guardrail_rg');
    expect(mandatoryHandoffRule(['risk_flag', 'guardrail_self_harm'])).toBe('guardrail_self_harm');
    expect(mandatoryHandoffRule(['player_request', 'player_said_unresolved'])).toBeNull();
    expect(mandatoryHandoffRule([])).toBeNull();
  });
});
