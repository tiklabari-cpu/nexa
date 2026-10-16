/**
 * The AI decision record vocabulary (tm 288.2 · SiyahTuş analysis ID-08) —
 * what one row of `ai_decision_logs` says the AI did with a turn, shared by the
 * table's CHECK constraint (`20261016100000_ai_decision_logs`), the API's
 * writer (`services/ai/decision-log.ts`) and the screens that will read it.
 *
 * The record answers "why did the AI say that to this player?" by number, not
 * by text: it carries ids, scores, flags and counts, never the message, the
 * reply or the prompt (ID-08 rule).
 */

/**
 * What the AI did with one turn.
 *
 *   - `answered`    — it replied to the customer.
 *   - `asked`       — it replied with a question (information it still needs).
 *   - `handoff`     — it gave the conversation to a human or a team.
 *   - `silent`      — it ran and chose not to reply (no match, a miss, a
 *                     language it does not speak); a human picks it up.
 *   - `blocked`     — a guardrail or policy stopped the reply.
 *   - `expired`     — the turn was overtaken (a newer message, a closed chat)
 *                     before the reply went out.
 *   - `cap_reached` — the workspace's daily AI allowance refused the turn.
 */
export const AI_DECISIONS = [
  'answered',
  'asked',
  'handoff',
  'silent',
  'blocked',
  'expired',
  'cap_reached',
] as const;
export type AiDecision = (typeof AI_DECISIONS)[number];

/**
 * The ceiling on a row's `details` object, in bytes of its JSON text. The
 * column's CHECK enforces it; the writer trims to it first so a turn is never
 * left unrecorded because its details ran long.
 */
export const AI_DECISION_DETAILS_MAX_BYTES = 8192;
