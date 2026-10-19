import { describe, expect, it } from 'vitest';
import { PLATFORM_GUARDRAILS_VERSION } from '@siyahtus/types';
import type { GuardrailRecord } from './conversation/guardrails/record.js';
import { turnRiskFlagRaises } from './turn-risk-flags.js';

const PLACE = { chatId: 'CH1H8CFKRV', threadId: 'TH1H8CFKRV', evidenceEventIds: ['TH1H8CFKRV_4'] };

const record = (
  risk_flags: string[],
  hits: Array<{ rule_key: string; stage: 'input' | 'output' }>,
): GuardrailRecord => ({
  catalog_version: PLATFORM_GUARDRAILS_VERSION,
  risk_flags,
  hits: hits.map((hit) => ({ ...hit, action: 'handoff', evidence: null, pattern_index: null })),
});

describe('the risk flags an AI turn raises (tm 302.2 · AI-27 §1)', () => {
  it('names the rule whose own flag it is; a signal’s flag that is no rule’s own is the classifier’s', () => {
    expect(
      turnRiskFlagRaises(
        record(
          ['self_exclusion_request', 'fraud_suspected'],
          [
            { rule_key: 'G1', stage: 'input' },
            { rule_key: 'G13', stage: 'input' },
          ],
        ),
        PLACE,
      ),
    ).toEqual([
      {
        type: 'self_exclusion_request',
        chatId: PLACE.chatId,
        threadId: PLACE.threadId,
        source: 'ai_rule',
        ruleRef: 'G1',
        raisedBy: null,
        note: null,
        evidenceEventIds: PLACE.evidenceEventIds,
      },
      expect.objectContaining({ type: 'fraud_suspected', source: 'ai_classifier', ruleRef: null }),
    ]);
  });

  it('reads input hits only, drops a type this version does not know, raises a type once', () => {
    const raises = turnRiskFlagRaises(
      record(['rg_signal', 'rg_signal', 'sensitive_shared'], [{ rule_key: 'G2', stage: 'output' }]),
      PLACE,
    );
    expect(raises).toEqual([
      expect.objectContaining({ type: 'rg_signal', source: 'ai_classifier', ruleRef: null }),
    ]);
  });

  it('raises nothing for a turn with no guardrail record', () => {
    expect(turnRiskFlagRaises(undefined, PLACE)).toEqual([]);
    expect(turnRiskFlagRaises(record([], []), PLACE)).toEqual([]);
  });
});
