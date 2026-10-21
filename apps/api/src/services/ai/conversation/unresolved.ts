/**
 * Whether a turn left the player's message unresolved, and why (tm 317.1 ·
 * SiyahTuş analysis AI-22 §1) — the turn's half of the unresolved-questions
 * report. Read off the finished turn: the engine attaches it to the result
 * (`TurnResult.unresolved`) and the live adapter writes it after the reply
 * (`services/chat/ai-unresolved.ts`); a preview or a simulation carries none.
 *
 *   - **The knowledge path found no answer** (`decisions.unanswered`, AI-06):
 *     with procedures and none of them taking the message, no passage either
 *     → `no_procedure_match`; an agent with no procedures and no passage →
 *     `no_knowledge`; passages that do not answer it → `low_confidence`; a
 *     draft withheld, or a skill that said nothing → `said_dont_know`.
 *   - **A hand-over for a language the persona does not speak** →
 *     `unsupported_language`; **for the turns not understood** (AI-09
 *     `not_understood`) → `not_understood_handoff`; **a person asked for after
 *     the AI had answered** → `asked_human_after_ai`.
 *   - **Never** a turn a compliance rule touched — its hand-over reason or a
 *     hit of `UNRESOLVED_EXCLUDED_GUARDRAILS` (self-exclusion, self-harm, a
 *     minor, …) — nor a message that says nothing worth grouping
 *     (`unresolvedTextOf`), nor a turn not taken.
 *
 * Assumption (AI-22 §1 "eşik − δ"): the search returns nothing below its
 * threshold, so a near miss cannot be told from no passage at all; the
 * passages-that-do-not-answer case is the observable `low_confidence`.
 */
import {
  UNRESOLVED_EXCLUDED_GUARDRAILS,
  UNRESOLVED_EXCLUDED_HANDOFF_REASONS,
  unresolvedTextOf,
  type HandoffReason,
  type UnresolvedReason,
} from '@siyahtus/types';
import type { EmbeddedQuery } from '../knowledge-service.js';
import type { UnansweredReason } from './knowledge-answer.js';
import {
  tookTurn,
  turnAgentId,
  turnsTaken,
  type TurnContext,
  type TurnMessage,
  type TurnResult,
  type TurnState,
  type UnresolvedCapture,
} from './turn.js';

const EXCLUDED_REASONS: ReadonlySet<string> = new Set(UNRESOLVED_EXCLUDED_HANDOFF_REASONS);
const EXCLUDED_RULES: ReadonlySet<string> = new Set(UNRESOLVED_EXCLUDED_GUARDRAILS);

/** What the knowledge path's miss means for the report. */
function unansweredReason(reason: UnansweredReason, decided: boolean): UnresolvedReason {
  switch (reason) {
    case 'no_passages':
      return decided ? 'no_procedure_match' : 'no_knowledge';
    case 'not_grounded':
      return 'low_confidence';
    case 'withheld':
    case 'nothing_answered':
      return 'said_dont_know';
  }
}

/** Why the turn left the message unresolved, or null when it did not. */
export function unresolvedReasonOf(state: TurnState, result: TurnResult): UnresolvedReason | null {
  const { decisions } = result;
  const reasons: readonly (HandoffReason | string)[] = [
    ...(decisions.handoffReasons ?? []),
    ...(decisions.handoffReason ? [decisions.handoffReason] : []),
  ];
  if (reasons.some((reason) => EXCLUDED_REASONS.has(reason))) return null;
  if (decisions.guardrails?.hits.some((hit) => EXCLUDED_RULES.has(hit.rule_key))) return null;
  if (reasons.includes('unsupported_language')) return 'unsupported_language';
  if (decisions.unanswered) {
    // The decision order ran (it has procedures) and none took the message.
    return unansweredReason(decisions.unanswered.reason, decisions.policy !== undefined);
  }
  if (reasons.includes('not_understood')) return 'not_understood_handoff';
  if (decisions.handoffReasons?.[0] === 'player_request' && turnsTaken(state) > 0) {
    return 'asked_human_after_ai';
  }
  return null;
}

/**
 * The turn's capture for AI-22, or null. Live turns only: what a preview or a
 * simulation could not resolve is the Test tab's to show, never the report's.
 * `embedded` is the turn's one embedding (AI-05 §2), reused when it is of the
 * message itself.
 */
export function unresolvedOf(input: {
  state: TurnState;
  message: TurnMessage;
  ctx: TurnContext;
  result: TurnResult;
  embedded: { text: string; query: EmbeddedQuery } | undefined;
}): UnresolvedCapture | null {
  const { state, message, ctx, result, embedded } = input;
  if (ctx.mode !== 'live' || !tookTurn(result)) return null;
  const reason = unresolvedReasonOf(state, result);
  if (reason === null) return null;
  const text = unresolvedTextOf(message.text);
  if (text === null) return null;
  const { decisions } = result;
  const ran = ctx.config.skills.find((skill) => skill.id === decisions.skillId);
  const aiAgentId = ran?.aiAgentId ?? turnAgentId(ctx.config.skills);
  if (!aiAgentId) return null;
  const understood = decisions.understood;
  const vector = embedded && embedded.text === message.text ? embedded.query.vector : null;
  return {
    reason,
    text: message.text,
    aiAgentId,
    brandId: ctx.brandId ?? null,
    configVersionId: ctx.configVersionId,
    language: decisions.unanswered?.language ?? understood?.language ?? null,
    intentGuess: understood?.procedure_key ?? understood?.alternatives[0]?.key ?? null,
    embedding: vector && embedded ? { space: embedded.query.space, vector } : null,
  };
}
