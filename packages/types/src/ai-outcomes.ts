/**
 * What became of each connection the AI took part in (tm 320.1 · SiyahTuş
 * analysis AI-25; owner decisions K9, K10).
 *
 * "The AI kept the player away from a person" (containment) is not success:
 * a player who got no real answer closes the window and writes again an hour
 * later. So each connection (panel "Chat ID", `thread_id`) the AI took part in
 * keeps one `ai_conversation_outcomes` row, written as the conversation
 * happens — the AI's turns, its hand-over, the first person's reply, the
 * player's "is it solved?" answer, the rating, the agent's verdict on the
 * hand-over card, the close, the risk flags, the QA review — and settled 72
 * hours after the close by the finalize job (tm 320.2), which looks for the
 * same member coming back.
 *
 * The billed "AI resolution" (ADR-09a: closed with no agent message) is not
 * this and does not change: the report shows the two side by side (AI-25-S1).
 * K9: what the AI claimed (`ai_claimed_resolved`) and what the player
 * confirmed (`resolution_confirmation`) are kept apart.
 */
import type { HandoffReason } from './handoff.js';
import { QA_MANDATORY_HANDOFF_REASONS } from './qa.js';

/**
 * How the connection ended for the AI's metrics. Null on the row while it is
 * open and nothing has settled it.
 *
 *   - `confirmed_resolved` — the player said yes to "is it solved?" (the
 *                            widget's button or in words).
 *   - `assumed_pending`    — it closed with no hand-over and no answer either
 *                            way; the finalize job (tm 320.2) decides it once
 *                            72 hours have passed.
 *   - `assumed_resolved`   — settled: nobody came back about it.
 *   - `false_resolved`     — settled: the member came back about the same
 *                            topic within 72 hours.
 *   - `handed_off`         — a person took it over: the AI's hand-over, or an
 *                            agent who wrote in (K9 "Önce AI").
 *   - `abandoned`          — the player left while the AI waited on an answer.
 *   - `declined`           — the player said no to "is it solved?" and the
 *                            connection closed without a person taking it.
 */
export const AI_OUTCOMES = [
  'confirmed_resolved',
  'assumed_pending',
  'assumed_resolved',
  'false_resolved',
  'handed_off',
  'abandoned',
  'declined',
] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

/** The player's answer to "is it solved?" (`resolution_confirmation`). */
export const AI_OUTCOME_CONFIRMATIONS = ['yes', 'no'] as const;
export type AiOutcomeConfirmation = (typeof AI_OUTCOME_CONFIRMATIONS)[number];

/**
 * What the QA review (AI-24) found (`qa_result`): `unresolved` is a failed
 * review whose failure means the player's matter was not solved — see
 * {@link QA_UNRESOLVED_CRITERIA}.
 */
export const AI_OUTCOME_QA_RESULTS = ['pass', 'fail', 'unresolved'] as const;
export type AiOutcomeQaResult = (typeof AI_OUTCOME_QA_RESULTS)[number];

/**
 * Whom a rating judges (`ratings.subject`): `ai` when no person had written to
 * the player on the connection when it was given, `human` otherwise. BSAT is
 * the `ai` ones (AI-25-S2), the person's CSAT the rest.
 */
export const RATING_SUBJECTS = ['ai', 'human'] as const;
export type RatingSubject = (typeof RATING_SUBJECTS)[number];

/**
 * The rubric criteria (`PLATFORM_QA_RUBRIC`) whose failure means the matter
 * was not solved: the AI misread the topic, went on without the details it
 * needed, or answered from nothing. A failed tone or summary is a `fail`, not
 * an `unresolved`.
 */
export const QA_UNRESOLVED_CRITERIA = ['topic', 'required_info', 'faithfulness'] as const;

/** At most this many card fields an agent names as missing (`handoff_card_missing`). */
export const AI_HANDOFF_CARD_MISSING_MAX = 20;
/** One of them, at most, in characters. */
export const AI_HANDOFF_CARD_MISSING_ITEM_MAX = 64;

/** At most this many guardrail hits a row keeps (`guardrail_hits`); later ones are dropped. */
export const AI_OUTCOME_GUARDRAIL_HITS_MAX = 50;

/** One guardrail hit as the row keeps it — the rule and what was done, never the words. */
export interface AiOutcomeGuardrailHit {
  readonly rule_key: string;
  /** `GUARDRAIL_STAGES`. */
  readonly stage: string;
  /** `GUARDRAIL_HIT_ACTIONS`. */
  readonly action: string;
}

/**
 * The event property on the AI's message that asks "is it solved?" — or
 * that says it is, unasked (K9): the widget shows its Yes / No buttons under
 * the newest such message (AI-25-S2). The value is the decision
 * (`asked` | `resolved`).
 */
export const RESOLUTION_PROMPT_PROPERTY = 'resolution_prompt';

/**
 * The mandatory reason a hand-over was made for (`handoff_mandatory_rule`):
 * the most severe of its reasons a compliance rule forces
 * (`QA_MANDATORY_HANDOFF_REASONS` — self-harm, a minor, responsible gaming, a
 * risk flag, account security, a complaint), or null.
 */
export function mandatoryHandoffRule(reasons: readonly string[]): HandoffReason | null {
  for (const reason of QA_MANDATORY_HANDOFF_REASONS) if (reasons.includes(reason)) return reason;
  return null;
}

/** What the close reads to settle a row ({@link outcomeAtClose}). */
export interface OutcomeAtCloseInput {
  /** The row's outcome as it stands. */
  readonly outcome: AiOutcome | null;
  /** `threads.ai_mode` as the connection closes. */
  readonly aiMode: string | null;
  /** `ai_conversations.outcome` as the close settled it (AI-02). */
  readonly conversationOutcome: string | null;
  readonly confirmation: AiOutcomeConfirmation | null;
}

/**
 * How the close settles a row (AI-25 "Yazma noktaları"): a settled one keeps
 * its outcome; a person who took it makes it `handed_off`; a player who left
 * while the AI waited on an answer `abandoned`; one who said no and got no
 * person `declined`; one who said yes `confirmed_resolved`; and everything
 * else waits as `assumed_pending` for the finalize job.
 */
export function outcomeAtClose(input: OutcomeAtCloseInput): AiOutcome {
  if (input.outcome !== null) return input.outcome;
  if (input.aiMode === 'human') return 'handed_off';
  if (input.conversationOutcome === 'abandoned') return 'abandoned';
  if (input.confirmation === 'no') return 'declined';
  if (input.confirmation === 'yes') return 'confirmed_resolved';
  return 'assumed_pending';
}

/** A completed QA review as the row keeps it (`qa_result`), from its verdict and failed criteria. */
export function qaResultOf(final: 'pass' | 'fail', failed: readonly string[]): AiOutcomeQaResult {
  if (final === 'pass') return 'pass';
  return failed.some((key) => (QA_UNRESOLVED_CRITERIA as readonly string[]).includes(key))
    ? 'unresolved'
    : 'fail';
}
