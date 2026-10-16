/**
 * The AI conversation state vocabulary (tm 292.1 · SiyahTuş analysis AI-01,
 * AI-03, AI-11) — the closed lists one `ai_conversations` row may hold, shared
 * by the table's CHECK constraints (`20261016200000_ai_conversations`), the
 * API's state store (`services/ai/conversation/state-store.ts`) and the engine
 * tasks that give each column its logic (#293 the mode, #294 the outcome, #296
 * the step).
 *
 * One row per connection (panel "Chat ID" = `thread_id`; its day container,
 * panel "Thread ID", is `chat_id` — K1=A). It is a record of where the AI is in
 * that conversation, not configuration (ADR-14b §2.2): the configuration the
 * conversation runs on is the version it pinned when the row opened.
 */

/**
 * Who answers the connection.
 *
 *   - `ai`     — the AI agent takes the player's turns.
 *   - `human`  — a person took over (a handoff, or an agent writing to the
 *                player); the AI stays silent.
 *   - `paused` — the AI is held back on this connection without a person
 *                having taken it.
 */
export const AI_CONVERSATION_MODES = ['ai', 'human', 'paused'] as const;
export type AiConversationMode = (typeof AI_CONVERSATION_MODES)[number];

/**
 * Where the active procedure step stands (AI-03). Null on the row when no
 * step is active.
 *
 *   - `awaiting_answer` — the step asked the player something and waits.
 *   - `ready`           — the step can run on the next turn.
 *   - `done`            — the step has finished.
 */
export const AI_CONVERSATION_STEP_STATUSES = ['awaiting_answer', 'ready', 'done'] as const;
export type AiConversationStepStatus = (typeof AI_CONVERSATION_STEP_STATUSES)[number];

/**
 * How the connection ended for the AI (AI-02 digest). Null while it is open
 * and nothing is settled.
 *
 *   - `resolved`         — the AI solved it.
 *   - `resolved_waiting` — solved on the AI's side, the player waits on
 *                          something outside the conversation (a payment).
 *   - `handed_off`       — a person took it over.
 *   - `abandoned`        — the player left mid-procedure.
 *   - `no_ai`            — the AI never ran a turn on it.
 */
export const AI_CONVERSATION_OUTCOMES = [
  'resolved',
  'resolved_waiting',
  'handed_off',
  'abandoned',
  'no_ai',
] as const;
export type AiConversationOutcome = (typeof AI_CONVERSATION_OUTCOMES)[number];
