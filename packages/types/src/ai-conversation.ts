/**
 * The AI conversation state vocabulary (tm 292.1 · SiyahTuş analysis AI-01,
 * AI-03, AI-11) — the closed lists one `ai_conversations` row may hold, shared
 * by the table's CHECK constraints (`20261016200000_ai_conversations`), the
 * API's state store (`services/ai/conversation/state-store.ts`) and the engine
 * tasks that give each column its logic (#293 the mode, #294 the outcome, #296
 * the step). The mode is also kept on the connection itself, `threads.ai_mode`
 * (`20261017100000_thread_ai_mode`), which the same list holds. When a person
 * is assigned at all is the AI agent's `assignment_mode` (tm 293.2).
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
 * Why a connection's mode changed (tm 293.1 · AI-11) — `ai_conversations.mode_reason`
 * and the `reason` of the agents-only note the change leaves in the transcript.
 *
 *   - `agent_message`  — an agent wrote to the player: they took it over (AI-11-S2).
 *   - `takeover`       — a supervisor took the chat over.
 *   - `transfer`       — a person handed the chat to a team or an agent.
 *   - `ai_handoff`     — the AI handed the chat over.
 *   - `bot_handoff`    — a rule bot handed the chat to a team.
 *   - `rule_bot_reply` — a rule bot answered the player's message.
 *   - `return_to_ai`   — an authorised person gave the chat back to the AI (tm 293.3).
 *   - `pause`          — a supervisor held the AI back (tm 293.3).
 *   - `ai_failure`     — the AI did not answer in time and a person was sent (tm 293.6).
 */
export const AI_MODE_REASONS = [
  'agent_message',
  'takeover',
  'transfer',
  'ai_handoff',
  'bot_handoff',
  'rule_bot_reply',
  'return_to_ai',
  'pause',
  'ai_failure',
] as const;
export type AiModeReason = (typeof AI_MODE_REASONS)[number];

/**
 * When a person is assigned to a visitor's connection (tm 293.2 · AI-11 §3,
 * §7; owner decision K9) — `ai_handoff_settings.assignment_mode`, one per AI
 * agent:
 *
 *   - `ai_first` — the AI answers first: the connection opens unassigned and
 *                  outside the queue, in `ai` mode, and is routed to a person
 *                  only when the AI hands it over (or a person takes it).
 *   - `parallel` — routing assigns the connection when it opens, as it always
 *                  has; the AI answers until a person writes to the player.
 */
export const AI_ASSIGNMENT_MODES = ['ai_first', 'parallel'] as const;
export type AiAssignmentMode = (typeof AI_ASSIGNMENT_MODES)[number];

/**
 * An AI agent with no settings row. `parallel` — today's behaviour. The
 * stalled-conversation watchdog (tm 293.6) now gives an unassigned AI
 * conversation its way back to a person; making `ai_first` the default is the
 * owner's call, not a side effect of that.
 */
export const DEFAULT_AI_ASSIGNMENT_MODE: AiAssignmentMode = 'parallel';

/**
 * How long a visitor may wait on the AI before a person is sent (tm 293.6 ·
 * AI-11 §5) — `ai_handoff_settings.ai_stall_timeout_seconds`. Counted from
 * the oldest visitor message nothing from the AI has followed; past it, the
 * `ai_stall` job hands an unassigned AI conversation to a person with reason
 * `ai_failure` — a worker that died, a job that went missing (GV-02), a turn
 * the caps or residency refused.
 *
 * The bounds are the column's CHECK and the route's validation. The floor is
 * above the batch window's ceiling (`BATCH_WINDOW_SECONDS_MAX`, 10 s) so a
 * visitor still typing is never mistaken for a stall; the ceiling keeps it a
 * watchdog rather than a second queue.
 */
export const DEFAULT_AI_STALL_TIMEOUT_SECONDS = 60;
export const AI_STALL_TIMEOUT_SECONDS_MIN = 15;
export const AI_STALL_TIMEOUT_SECONDS_MAX = 600;

/**
 * What the AI does when the knowledge base has no answer (tm 298 · AI-06 §8,
 * assumption AI-06-S1) — `ai_handoff_settings.no_answer`, one per AI agent.
 * The question is put in one of these groups by its words (and the
 * understanding's risk flags): money, account, bonus, responsible gaming
 * (`rg`), anything else.
 */
export const NO_ANSWER_CATEGORIES = ['money', 'account', 'bonus', 'rg', 'other'] as const;
export type NoAnswerCategory = (typeof NO_ANSWER_CATEGORIES)[number];

/**
 * Per group: `handoff` — say so and hand over at once; `ask` — say so and ask
 * once whether to hand over (a second miss hands over without asking).
 */
export const NO_ANSWER_POLICIES = ['handoff', 'ask'] as const;
export type NoAnswerPolicy = (typeof NO_ANSWER_POLICIES)[number];

export interface AiNoAnswerSettings {
  policy_by_category: Record<NoAnswerCategory, NoAnswerPolicy>;
  /**
   * The workspace's own words for "I cannot answer this; a person will" —
   * said as written, in place of the default. Null: the default, in the
   * reply's language.
   */
  text: string | null;
}

/** AI-06-S1: money, account, bonus and responsible gaming go to a person at once. */
export const DEFAULT_NO_ANSWER: Readonly<AiNoAnswerSettings> = Object.freeze({
  policy_by_category: Object.freeze({
    money: 'handoff',
    account: 'handoff',
    bonus: 'handoff',
    rg: 'handoff',
    other: 'ask',
  }) as Record<NoAnswerCategory, NoAnswerPolicy>,
  text: null,
});

/** The longest `no_answer.text` (the route and the column's CHECK). */
export const NO_ANSWER_TEXT_MAX = 500;

/**
 * The stored `no_answer` as the engine and the API read it: every group's
 * policy, the default where the row has none or something it does not know.
 * Null (no row, or never set) is the defaults.
 */
export function readNoAnswerSettings(raw: unknown): AiNoAnswerSettings {
  const stored =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const policies =
    stored['policy_by_category'] !== null &&
    typeof stored['policy_by_category'] === 'object' &&
    !Array.isArray(stored['policy_by_category'])
      ? (stored['policy_by_category'] as Record<string, unknown>)
      : {};
  const policy_by_category = { ...DEFAULT_NO_ANSWER.policy_by_category };
  for (const category of NO_ANSWER_CATEGORIES) {
    const value = policies[category];
    if ((NO_ANSWER_POLICIES as readonly unknown[]).includes(value)) {
      policy_by_category[category] = value as NoAnswerPolicy;
    }
  }
  const text = stored['text'];
  return {
    policy_by_category,
    text: typeof text === 'string' && text.trim() !== '' ? text.trim() : null,
  };
}

/**
 * How the AI takes a connection back (tm 293.3 · AI-11 §6) — the `resume` of
 * `POST /chats/{chatId}/return-to-ai`:
 *
 *   - `continue` — where it left off: the procedure in progress and what it
 *                  collected stay.
 *   - `fresh`    — a new topic: the procedure in progress ends; what it
 *                  collected stays in the conversation's state.
 */
export const AI_RETURN_RESUMES = ['continue', 'fresh'] as const;
export type AiReturnResume = (typeof AI_RETURN_RESUMES)[number];

/**
 * The risk flags that keep a connection from going back to the AI, whoever
 * asks (tm 293.3 · AI-11 §6, AI-11-S3): responsible gaming, a self-exclusion
 * request, a suspected minor, self-harm. Names from AI-27's flag types (#302),
 * which raises them; until then a connection carries them in its
 * conversation's `signals.risk_flags`.
 */
export const AI_RETURN_BLOCKING_RISK_FLAGS = [
  'rg_signal',
  'self_exclusion_request',
  'underage_suspected',
  'self_harm',
] as const;

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
