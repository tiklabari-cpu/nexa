/**
 * The risk flags an AI turn raises (tm 302.2 · AI-27 §1): the flag types its
 * guardrails put on the conversation (`decisions.guardrails.risk_flags`), as
 * the rows `AiResponder` writes with the turn's hand-over.
 *
 * Who raised each one: the guardrail rule whose own flag it is, when that
 * rule's hit is on the turn (`ai_rule`, `rule_ref` G1…G19) — G1's
 * `self_exclusion_request`, G3's `self_harm`; otherwise the understanding
 * call's risk signal that named it (`ai_classifier`) — G13's signal of fraud
 * raises `fraud_suspected`, which is not G13's own flag. Types this version
 * does not know are left out, never guessed. Pure.
 */
import {
  isGuardrailId,
  isRiskFlagType,
  platformGuardrail,
  type RiskFlagType,
} from '@siyahtus/types';
import type { GuardrailRecord } from './conversation/guardrails/record.js';
import type { RiskFlagRaise } from '../risk/risk-flags.js';

export interface TurnRiskFlagPlace {
  readonly chatId: string;
  readonly threadId: string;
  /** The visitor's message the turn answered, when it is known. */
  readonly evidenceEventIds: readonly string[];
}

export function turnRiskFlagRaises(
  record: GuardrailRecord | undefined,
  place: TurnRiskFlagPlace,
): RiskFlagRaise[] {
  if (!record) return [];
  const types = [...new Set(record.risk_flags)].filter(isRiskFlagType);
  return types.map((type: RiskFlagType): RiskFlagRaise => {
    const hit = record.hits.find(
      (candidate) =>
        candidate.stage === 'input' &&
        isGuardrailId(candidate.rule_key) &&
        platformGuardrail(candidate.rule_key).riskFlag === type,
    );
    return {
      type,
      chatId: place.chatId,
      threadId: place.threadId,
      source: hit ? 'ai_rule' : 'ai_classifier',
      ruleRef: hit ? hit.rule_key : null,
      raisedBy: null,
      note: null,
      evidenceEventIds: place.evidenceEventIds,
    };
  });
}
