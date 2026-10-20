/**
 * The legacy skill adapter (tm 292.2 · SiyahTuş analysis AI-03 §10; ADR-14a
 * §3 "Tek motor").
 *
 * Every skill stored today is a single-message step list in the six-step
 * vocabulary of `@siyahtus/ai-mock` (`detect_intent`, `request_info`, `tag`,
 * `summarize`, `send_message`, `transfer_to_team`). There is one engine, and
 * it runs procedures; a stored skill reaches it through {@link adaptLegacySkill}
 * as a one-turn procedure (`mode: 'single'`), so no second engine keeps the
 * old vocabulary alive beside the new one. The mapping:
 *
 *   detect_intent    → the procedure's `whenToUse` gate (all must match)
 *   request_info     → collect
 *   send_message     → say (a fixed text) · answer_from_knowledge
 *   transfer_to_team → handoff
 *   tag              → tag
 *   summarize        → summarize, until the hand-over card (AI-10) writes the
 *                      summary for every hand-over and the step has nothing
 *                      left to do
 *
 * Each adapted step keeps the type it was written as (`authored`), and that is
 * the name the run log and the decision record use: an admin reads the steps
 * they wrote, and the run history written before this adapter stays
 * comparable with the one written after it.
 *
 * The procedure vocabulary here is the subset a one-turn procedure needs. The
 * full one — conditions, `check`, `resolve`, templates, the tool slot — and the
 * stored `mode: 'procedure'` skill are tm 296's (`packages/types` procedure
 * types); this adapter's output is a value of that vocabulary, not a parallel
 * one.
 */
import type { SkillStep, SkillStepType } from '@siyahtus/ai-mock';

interface AdaptedStep {
  /** The legacy step type this was adapted from — the name the run log shows. */
  readonly authored?: SkillStepType;
}

/** Send a fixed text, exactly as written (FR-MOD-06.4: a human's words are never reshaped). */
export interface SayStep extends AdaptedStep {
  readonly type: 'say';
  readonly text: string;
}

/** Answer the message from the knowledge base (FR-MOD-06.3). */
export interface AnswerFromKnowledgeStep extends AdaptedStep {
  readonly type: 'answer_from_knowledge';
}

/** Ask for a piece of information unless the message already carries it. */
export interface CollectStep extends AdaptedStep {
  readonly type: 'collect';
  readonly slot: string;
  readonly prompt: string;
}

/**
 * Hand the conversation to a team; nothing after it runs. The team by id
 * first (AI-12 · tm 307.1), by its name for a step saved before ids.
 */
export interface HandoffStep extends AdaptedStep {
  readonly type: 'handoff';
  readonly target: string | null;
  readonly groupId?: number;
}

export interface TagStep extends AdaptedStep {
  readonly type: 'tag';
  readonly tag: string;
}

/** Write a one-line summary for the person who picks the conversation up. */
export interface SummarizeStep extends AdaptedStep {
  readonly type: 'summarize';
}

export type ProcedureStep =
  SayStep | AnswerFromKnowledgeStep | CollectStep | HandoffStep | TagStep | SummarizeStep;

/** A gate on the message: the intent's phrases, matched by `matchIntent`. */
export interface IntentGate {
  readonly intent: string;
  /** Phrases to look for. Falls back to the intent name when empty. */
  readonly phrases: readonly string[];
}

/** A procedure that runs to its end within one turn. */
export interface SingleTurnProcedure {
  readonly mode: 'single';
  /** Every gate must match for the procedure to apply; none means it applies to everything. */
  readonly whenToUse: readonly IntentGate[];
  readonly steps: readonly ProcedureStep[];
}

/**
 * A validated legacy step list as a one-turn procedure. The step order is
 * kept; the `detect_intent` gates leave the list for `whenToUse`, because a
 * gate decides whether the procedure runs at all — wherever in the list the
 * admin put it, it was always evaluated before any other step.
 */
export function adaptLegacySkill(steps: readonly SkillStep[]): SingleTurnProcedure {
  const whenToUse: IntentGate[] = [];
  const adapted: ProcedureStep[] = [];
  for (const step of steps) {
    switch (step.type) {
      case 'detect_intent':
        whenToUse.push({ intent: step.intent, phrases: step.phrases ?? [] });
        break;
      case 'request_info':
        adapted.push({
          type: 'collect',
          slot: step.field,
          prompt: step.prompt,
          authored: 'request_info',
        });
        break;
      case 'send_message':
        adapted.push(
          step.source === 'text'
            ? // Validation refuses a fixed reply without text (`send_message_needs_text`).
              { type: 'say', text: step.text ?? '', authored: 'send_message' }
            : { type: 'answer_from_knowledge', authored: 'send_message' },
        );
        break;
      case 'transfer_to_team':
        adapted.push({
          type: 'handoff',
          target: step.group ?? null,
          ...(step.group_id !== undefined ? { groupId: step.group_id } : {}),
          authored: 'transfer_to_team',
        });
        break;
      case 'tag':
        adapted.push({ type: 'tag', tag: step.tag, authored: 'tag' });
        break;
      case 'summarize':
        adapted.push({ type: 'summarize', authored: 'summarize' });
        break;
    }
  }
  return { mode: 'single', whenToUse, steps: adapted };
}

/** The name a step goes by in the run log and the decision record. */
export function stepLogName(step: ProcedureStep): string {
  return step.authored ?? step.type;
}
