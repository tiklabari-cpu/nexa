/**
 * Who answers a connection — the AI or a person (tm 293.1 · SiyahTuş analysis
 * AI-11; owner decisions K9, K10).
 *
 * Until now the AI answered every visitor message whoever else was in the
 * chat: an agent and the AI could talk to the same player at once, and a
 * supervisor's takeover did not quieten it. Each connection now has a mode,
 * kept on the connection (`threads.ai_mode`, 20261017100000) and, for a
 * connection the AI took part in, on its conversation row too
 * (`ai_conversations.mode` with the who, when and why):
 *
 *   null     → the AI has not taken part; it may still answer.
 *   'ai'     → the AI took a turn and keeps answering.
 *   'human'  → a person has it; the AI stays silent.
 *   'paused' → the AI is held back without a person having taken it.
 *
 * The edges, and what drives them (05 AI-11 §1):
 *
 *   null   → ai      the AI's first turn commits ({@link claimAiTurn})
 *   null   → human   a person takes part before the AI ever did
 *   ai     → human   an agent writes to the player, a takeover, a transfer
 *                    (the AI's own hand-over included), a rule bot that took
 *                    the conversation
 *   ai     → paused  a supervisor holds the AI back (tm 293.3)
 *   human  → ai      an authorised person gives it back (tm 293.3)
 *   paused → ai      the same
 *   paused → human   a person takes it
 *
 * The three properties this file exists to hold:
 *
 *   1. **A person always wins a race with the AI.** Every mode write takes the
 *      thread's row lock (`FOR UPDATE`), and the AI checks the mode once more
 *      inside its reply's own transaction, under that same lock. An agent who
 *      wrote while the model was thinking committed 'human' first; the AI's
 *      check then sees it and the draft rolls back unsent. One that wrote a
 *      moment after the reply committed reads after the reply, which is the
 *      order the player saw them in.
 *   2. **A change fences a running turn twice.** The write to
 *      `ai_conversations` bumps its `version` (the table's trigger), so a turn
 *      that read the conversation before the change also loses its optimistic
 *      save (`state-store.ts`) — the AI never relies on one check alone.
 *   3. **Only this file writes the mode.** The chat core calls it from the
 *      transactions that make a person take part (`chat-service.ts`); the AI
 *      calls {@link claimAiTurn}. The state machine is {@link aiModeStep} and
 *      nothing else decides an edge.
 *
 * Beside the chat core rather than under `services/ai/`: the chat core and the
 * rule bot both reach it, and the rule bot reaches no AI module at all
 * (FR-MOD-06.6, `bots/rule-bot-isolation.test.ts`).
 */
import {
  AI_RETURN_BLOCKING_RISK_FLAGS,
  type AiConversationMode,
  type AiModeReason,
} from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** One connection: `threadId` the connection (panel "Chat ID"), `chatId` its day (panel "Thread ID"). */
export interface AiModeRef {
  readonly chatId: string;
  readonly threadId: string;
}

/** A change of mode as it was written. `from` null: the AI had not taken part. */
export interface AiModeChange {
  readonly from: AiConversationMode | null;
  readonly to: AiConversationMode;
  /** An account id, a bot id (`ai-agent` for the AI) — never a name. */
  readonly by: string;
  readonly reason: AiModeReason;
}

/**
 * The `by` of a change nobody asked for — the stall watchdog's (tm 293.6). Its
 * transcript line has no author, as the idle-chat sweep's close has none.
 */
export const AI_MODE_SYSTEM_ACTOR = 'system';

/** What a caller asks for; who asks is the caller's principal. */
export interface AiModeRequest {
  readonly to: AiConversationMode;
  readonly reason: AiModeReason;
}

/**
 * The legal edges. A target not listed for a mode is refused rather than
 * ignored: "pause the AI" on a connection a person has is a request that
 * cannot mean anything, and its caller should hear so (tm 293.3 answers 409).
 */
const EDGES: Readonly<Record<AiConversationMode | 'none', readonly AiConversationMode[]>> = {
  none: ['ai', 'human'],
  ai: ['human', 'paused'],
  human: ['ai'],
  paused: ['ai', 'human'],
};

/** What moving from `from` to `to` is: a change, nothing to do, or not allowed. */
export function aiModeStep(
  from: AiConversationMode | null,
  to: AiConversationMode,
): 'change' | 'same' | 'refused' {
  if (from === to) return 'same';
  return EDGES[from ?? 'none'].includes(to) ? 'change' : 'refused';
}

/** Whether the AI may answer a connection in this mode. */
export function aiMayAnswer(mode: AiConversationMode | null): boolean {
  return mode === null || mode === 'ai';
}

/** The transition is not an edge of the state machine. */
export class AiModeTransitionError extends Error {
  readonly code = 'ai_mode_transition_refused';

  constructor(
    readonly from: AiConversationMode | null,
    readonly to: AiConversationMode,
  ) {
    super(`ai mode cannot move from ${from ?? 'none'} to ${to}`);
    this.name = 'AiModeTransitionError';
  }
}

/**
 * The AI may not answer the connection any more: a person took it (or the AI
 * was held back) after the turn began. Thrown inside the reply's transaction,
 * so the reply rolls back with it.
 */
export class AiModeChangedError extends Error {
  readonly code = 'ai_mode_changed';

  constructor(readonly mode: AiConversationMode) {
    super(`the connection is in ${mode} mode; the ai may not answer it`);
    this.name = 'AiModeChangedError';
  }
}

/** The connection's mode, read without a lock — the AI's first look. */
export async function readAiMode(
  tx: TenantClient,
  ref: AiModeRef,
): Promise<AiConversationMode | null> {
  const thread = await tx.thread.findFirst({
    where: { id: ref.threadId, chatId: ref.chatId },
    select: { aiMode: true },
  });
  return (thread?.aiMode ?? null) as AiConversationMode | null;
}

/**
 * The connection's mode under the thread's row lock, held to the end of the
 * caller's transaction. Null for a thread this workspace cannot see.
 */
async function lockAiMode(
  tx: TenantClient,
  ref: AiModeRef,
): Promise<{ mode: AiConversationMode | null } | null> {
  const rows = await tx.$queryRaw<Array<{ ai_mode: string | null }>>`
    SELECT ai_mode FROM threads
     WHERE id = ${ref.threadId} AND chat_id = ${ref.chatId}
     FOR UPDATE`;
  const row = rows[0];
  return row ? { mode: row.ai_mode as AiConversationMode | null } : null;
}

/**
 * Move the connection to `request.to`, in the caller's transaction. Returns
 * the change, or null when there was none to make — the mode was already
 * `request.to`, or the thread is not this workspace's.
 *
 * Writes the thread and, if the AI opened one, its conversation row: the
 * mode with who, when and why. That row's trigger bumps its `version`, which
 * is what fences an AI turn still holding the version it read.
 *
 * Throws {@link AiModeTransitionError} for a move the state machine does not
 * have ({@link aiModeStep}).
 */
export async function writeAiMode(
  tx: TenantClient,
  ref: AiModeRef,
  request: AiModeRequest & { by: string },
): Promise<AiModeChange | null> {
  const locked = await lockAiMode(tx, ref);
  if (!locked) return null;
  const from = locked.mode;
  const step = aiModeStep(from, request.to);
  if (step === 'same') return null;
  if (step === 'refused') throw new AiModeTransitionError(from, request.to);

  await tx.$executeRaw`UPDATE threads SET ai_mode = ${request.to} WHERE id = ${ref.threadId}`;
  await tx.$executeRaw`
    UPDATE ai_conversations
       SET mode = ${request.to}, mode_changed_at = now(),
           mode_changed_by = ${request.by}, mode_reason = ${request.reason}
     WHERE thread_id = ${ref.threadId} AND chat_id = ${ref.chatId}`;
  return { from, to: request.to, by: request.by, reason: request.reason };
}

/**
 * The AI's own check, in the transaction that commits its turn (with the
 * reply, when there is one): the connection must still be the AI's to answer.
 * A connection the AI has not taken part in becomes `ai` here — the AI's
 * first turn is what makes it so.
 *
 * Throws {@link AiModeChangedError} when a person took the connection (or the
 * AI was held back) after the turn read it, which rolls the turn back. Writes
 * the thread only: its conversation row is the turn's own to save, and a
 * write here would bump the version the turn is about to save against.
 *
 * True when this turn is the one that made the connection `ai` — the change
 * the caller announces once the turn commits (tm 293.5).
 */
export async function claimAiTurn(tx: TenantClient, ref: AiModeRef): Promise<boolean> {
  const locked = await lockAiMode(tx, ref);
  // A thread this workspace cannot see is the reply's problem, not the mode's:
  // nothing here claims it.
  if (!locked) return false;
  if (!aiMayAnswer(locked.mode)) throw new AiModeChangedError(locked.mode!);
  if (locked.mode !== null) return false;
  await tx.$executeRaw`UPDATE threads SET ai_mode = 'ai' WHERE id = ${ref.threadId}`;
  return true;
}

/**
 * The risk flags that keep a connection from going back to the AI (tm 293.3 ·
 * AI-11 §6, AI-11-S3) — the one place a hand-back asks, so the check has one
 * definition whoever gives the connection back. Empty: nothing blocks it.
 *
 * Today the flags are what the connection's conversation carries in its state,
 * `ai_conversations.signals.risk_flags` (05 AI-01's `signals`); AI-27 (#302)
 * raises them as rows of its own, chat- and member-scoped, and reads those
 * here too. A connection the AI never opened a conversation on carries none.
 */
export async function aiReturnBlockers(tx: TenantClient, ref: AiModeRef): Promise<string[]> {
  const conversation = await tx.aiConversation.findFirst({
    where: { threadId: ref.threadId, chatId: ref.chatId },
    select: { signals: true },
  });
  const signals = conversation?.signals as { risk_flags?: unknown } | null | undefined;
  const raised = Array.isArray(signals?.risk_flags) ? (signals.risk_flags as unknown[]) : [];
  return AI_RETURN_BLOCKING_RISK_FLAGS.filter((flag) => raised.includes(flag));
}

/**
 * End the procedure the AI was in on this connection, for a hand-back that
 * starts a new topic (`resume: 'fresh'`, tm 293.3 · AI-11 §6). What it
 * collected stays in `slots`, which the AI still reads with the conversation.
 * In the caller's transaction; the row's trigger bumps its `version`, as
 * {@link writeAiMode}'s write does.
 */
export async function endAiProcedure(tx: TenantClient, ref: AiModeRef): Promise<void> {
  await tx.$executeRaw`
    UPDATE ai_conversations
       SET active_skill_id = NULL, procedure_snapshot = NULL, procedure_snapshot_hash = NULL,
           step_id = NULL, step_status = NULL
     WHERE thread_id = ${ref.threadId} AND chat_id = ${ref.chatId}`;
}

/**
 * The agents-only line a change leaves in the transcript (05 AI-11 §9), in
 * the words of the other system lines ("Chat transferred", "Chat taken over").
 */
export function aiModeNoteText(change: Pick<AiModeChange, 'to' | 'reason'>): string {
  if (change.to === 'ai') return 'AI answering again';
  if (change.to === 'paused') return 'AI paused';
  switch (change.reason) {
    case 'agent_message':
      return 'AI stopped: an agent replied';
    case 'takeover':
      return 'AI stopped: chat taken over';
    case 'ai_handoff':
      return 'AI handed the chat over';
    case 'bot_handoff':
      return 'AI stopped: a rule bot transferred the chat';
    case 'rule_bot_reply':
      return 'AI stopped: a rule bot answered';
    case 'transfer':
      return 'AI stopped: chat transferred';
    case 'ai_failure':
      return 'AI stopped: no answer in time';
    default:
      return 'AI stopped';
  }
}
