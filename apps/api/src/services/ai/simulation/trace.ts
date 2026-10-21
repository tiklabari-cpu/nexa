/**
 * The decision trace of one simulated AI turn (tm 314.2 · SiyahTuş analysis
 * AI-19 §8 "karar izi"): what a run's transcript and a sandbox reply carry
 * beside the AI's words — the procedure and why it was picked, what the AI has
 * collected, the knowledge it used, the guardrails that fired, the hand-over,
 * the flags it raised, and what the turn cost.
 *
 * Read off the engine's own `TurnResult`, never worked out again: the decision
 * is the one the live adapter files (`skillDecision`), the slots are the ones
 * an agent sees in the inbox (`conversationView`). Keys and labels only — a
 * guardrail's evidence (the words that set it off) stays out, as it stays out
 * of the decision record.
 */
import {
  SLOT_SETTLED_STATUSES,
  handoffTopicRole,
  isRiskFlagType,
  type AiTestTurnTrace,
} from '@siyahtus/types';
import type { TenantClient } from '../../../lib/tenant.js';
import { conversationView } from '../conversation/conversation-view.js';
import { handoffOf, type TurnDecisions, type TurnResult } from '../conversation/turn.js';
import { skillDecision } from '../decision-log.js';

/** Why the procedure ran: the decision order's rule (AI-05 §4), or a one-message skill's gate. */
function procedureReason(decisions: TurnDecisions): string {
  return decisions.policy?.rule ?? 'intent_match';
}

/** What a turn cost, in tokens — the model's both ways and the embedding's. */
export function turnTokens(result: TurnResult): number {
  const { llmInputTokens, llmOutputTokens, embeddingTokens } = result.decisions.usage;
  return llmInputTokens + llmOutputTokens + embeddingTokens;
}

/**
 * The trace of one turn. `teamId` is where its hand-over would land (the
 * runner's read-only resolution; null: routing decides); `titles` names the
 * knowledge sources it cited (`sourceTitles`).
 */
export function turnTrace(
  result: TurnResult,
  context: { teamId: number | null; titles: ReadonlyMap<string, string> },
): AiTestTurnTrace {
  const { decisions } = result;
  const effect = handoffOf(result.sideEffects);
  const slots: Record<string, string> = {};
  for (const slot of conversationView(result.nextState).slots) {
    if (slot.display !== null && SLOT_SETTLED_STATUSES.includes(slot.status)) {
      slots[slot.name] = slot.display;
    }
  }
  const guardrails: AiTestTurnTrace['guardrails'] = [];
  for (const hit of decisions.guardrails?.hits ?? []) {
    if (!guardrails.some((kept) => kept.rule_key === hit.rule_key && kept.action === hit.action)) {
      guardrails.push({ rule_key: hit.rule_key, action: hit.action });
    }
  }
  const handedOver = effect !== null || decisions.outcome === 'handed_off';
  return {
    decision: skillDecision(result)?.decision ?? 'silent',
    procedure:
      decisions.skillId !== null && decisions.skillName !== null
        ? {
            skill_id: decisions.skillId,
            name: decisions.skillName,
            reason: procedureReason(decisions),
          }
        : null,
    slots,
    sources: (decisions.knowledge?.source_ids ?? []).map((id) => ({
      source_id: id,
      title: context.titles.get(id) ?? '',
      page: null,
    })),
    guardrails,
    handoff: handedOver
      ? {
          reason:
            decisions.handoffReason ??
            effect?.reason ??
            decisions.handoffReasons?.[0] ??
            effect?.reasons?.[0] ??
            'handoff',
          topic: handoffTopicRole(effect?.topic ?? null),
          team_id: context.teamId,
        }
      : null,
    flags: [...new Set(decisions.guardrails?.risk_flags ?? [])].filter(isRiskFlagType),
    tokens: turnTokens(result),
  };
}

/** The knowledge sources the turn cited, by id → name, in the simulation's transaction. */
export async function sourceTitles(
  tx: TenantClient,
  results: readonly TurnResult[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(results.flatMap((result) => result.decisions.knowledge?.source_ids ?? [])),
  ];
  if (ids.length === 0) return new Map();
  const rows = await tx.knowledgeSource.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}
