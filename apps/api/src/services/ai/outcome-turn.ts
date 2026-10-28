/**
 * What one live AI turn adds to its connection's outcome row (tm 320.1 ·
 * AI-25 "Yazma noktaları": "her AI turunda sayaçlar ve konu güncellenir"),
 * read from the turn's result — the live adapter writes it
 * (`reports/ai-outcomes.ts` `recordOutcomeTurn`) once the reply went out.
 *
 *   - **Counts.** An AI turn when it wrote to the player; the player's
 *     messages it answered; a clarification turn when its reply asked for a
 *     required detail (a `collect` question).
 *   - **Topic.** The procedure the understanding named, else the one in
 *     progress — its key, the skill id (AI-05). A knowledge answer has none:
 *     the repeat-contact search then counts "any topic" (AI-25-S3).
 *   - **Required slots.** The active procedure's slots that are not
 *     `never` required (a conditional one counts), and how many are known —
 *     collected or carried (AI-04, AI-02).
 *   - **Resolution (K9).** Whether the AI said it is solved, and the player's
 *     answer to "is it solved?" when this turn read one.
 *   - **Guardrails (AI-08).** The rule, the stage and the action of each hit,
 *     never the words.
 */
import type { AiOutcomeGuardrailHit, IdentityTrust } from '@siyahtus/types';
import { outcomeMemberKey, type OutcomeTurn } from '../reports/ai-outcomes.js';
import { slotKnown } from './conversation/daily-memory.js';
import { readSnapshot } from './conversation/procedure/executor.js';
import { turnAgentId, type TurnConfig, type TurnResult } from './conversation/turn.js';

export interface OutcomeTurnContext {
  readonly at: Date;
  readonly customerId: string;
  readonly trust: IdentityTrust | null;
  readonly config: TurnConfig;
  readonly configVersionId: string | null;
  /** The player's messages the turn answered (AI-01 §5). */
  readonly playerTurns: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function outcomeTurnOf(result: TurnResult, ctx: OutcomeTurnContext): OutcomeTurn {
  const { decisions, nextState } = result;
  const snapshot = readSnapshot(nextState.procedureSnapshot);
  const required = snapshot
    ? snapshot.procedure.slots.filter((slot) => slot.required !== 'never')
    : null;
  const procedureKey = decisions.understood?.procedure_key ?? nextState.activeSkillId ?? null;
  const procedureId = nextState.activeSkillId ?? procedureKey;
  const guardrailHits: AiOutcomeGuardrailHit[] = (decisions.guardrails?.hits ?? []).map((hit) => ({
    rule_key: hit.rule_key,
    stage: hit.stage,
    action: hit.action,
  }));
  return {
    at: ctx.at,
    memberKey: outcomeMemberKey(ctx.customerId, ctx.trust),
    aiAgentId: snapshot?.ai_agent_id ?? turnAgentId(ctx.config.skills),
    configVersionId: ctx.configVersionId,
    language: decisions.understood?.language ?? result.unresolved?.language ?? null,
    intent: procedureKey,
    procedureId: procedureId !== null && UUID.test(procedureId) ? procedureId : null,
    aiTurns: result.reply !== null ? 1 : 0,
    playerTurns: Math.max(1, ctx.playerTurns),
    clarificationTurns: decisions.replyKind === 'question' && snapshot ? 1 : 0,
    requiredSlots: required
      ? {
          total: required.length,
          filled: required.filter((slot) => slotKnown(nextState.slots, slot.name)).length,
        }
      : null,
    claimedResolved: decisions.resolution?.decision === 'resolved',
    confirmation: decisions.resolution?.confirmation ?? null,
    guardrailHits,
  };
}

/**
 * Whether the turn's reply carries the widget's "is it solved?" buttons
 * (AI-25-S2, `RESOLUTION_PROMPT_PROPERTY`): the AI asked, or said it is solved
 * without the player's yes. Null for every other reply.
 */
export function resolutionPromptOf(result: TurnResult): 'asked' | 'resolved' | null {
  const resolution = result.decisions.resolution;
  if (!resolution || result.reply === null) return null;
  if (resolution.decision === 'asked') return 'asked';
  if (resolution.decision === 'resolved' && resolution.confirmation !== 'yes') return 'resolved';
  return null;
}
