/**
 * Who answers the open conversation — the AI agent, a person, or the AI held
 * back (AI-11 · tm 293.5) — as the transcript header shows it, and what the
 * agent looking at it may do about it.
 *
 * Pure, so the rules are tested apart from the header that draws them:
 *
 *   - **The badge** (`aiModeBadge`) shows while the AI answers (`ai`), while
 *     it is held back (`paused`), and once a person has a connection the AI
 *     answered in (`human` + `ai_took_part`). A connection a person answered
 *     from the start — every chat of a workspace without an AI agent — shows
 *     none: "with a person" is news only where the AI was.
 *   - **The actions** (`aiModeActions`) are the server's own rules
 *     (`POST /chats/{chatId}/return-to-ai`, `/pause-ai`): the assignee or
 *     an admin or owner may give the chat back or hold the AI back. Taking
 *     the chat off the AI needs no action of its own: an agent writes to the
 *     visitor (AI-11-S2) — the badge's hint says so — and a supervisor has the
 *     takeover the Details panel already offers, which turns it `human` too.
 *   - **The push** (`withAiModeChange`) moves the cached chat at once.
 */
import type { AiReturnResume } from '@siyahtus/types';
import type { AiMode, ChatDetail } from './types.js';

/** `POST /chats/{chatId}/return-to-ai` and `/pause-ai`'s answer (`ChatAiMode`). */
export interface ChatAiModeResult {
  chat_id: string;
  thread_id: string;
  ai_mode: AiMode;
  previous_ai_mode: AiMode | null;
  changed: boolean;
  assignee_id: string | null;
}

/** What a return asks for: the AI's note, and whether it picks up where it left off. */
export interface AiReturnInput {
  note?: string;
  resume: AiReturnResume;
}

/** The badge the header shows for a chat, or null for none. */
export function aiModeBadge(chat: ChatDetail): AiMode | null {
  const thread = chat.thread;
  if (!chat.active || !thread?.active) return null;
  const mode = thread.ai_mode ?? null;
  if (mode === 'ai' || mode === 'paused') return mode;
  if (mode === 'human' && thread.ai_took_part === true) return 'human';
  return null;
}

/** What the caller may do about the badge. */
export interface AiModeActions {
  /** Hold the AI back: the AI is answering. */
  pause: boolean;
  /** Give the chat back to the AI: a person has it, or the AI is held back. */
  giveBack: boolean;
}

const NONE: AiModeActions = { pause: false, giveBack: false };

export function aiModeActions(
  badge: AiMode | null,
  caller: {
    /** The caller is the connection's assignee. */
    isAssignee: boolean;
    /** The caller is an admin or owner (`SUPERVISOR_ROLES`). */
    isSupervisor: boolean;
  },
): AiModeActions {
  if (badge === null) return NONE;
  const mayHand = caller.isAssignee || caller.isSupervisor;
  return {
    pause: mayHand && badge === 'ai',
    giveBack: mayHand && badge !== 'ai',
  };
}

/**
 * A cached chat with a `chat_ai_mode_changed` push folded in. Only the
 * connection the push names moves; a push for an older connection, or one the
 * cache does not hold, leaves it as it was. The AI's own first turn (no
 * `reason`) is the proof it took part.
 */
export function withAiModeChange(
  current: ChatDetail | undefined,
  payload: Record<string, unknown>,
): ChatDetail | undefined {
  const thread = current?.thread;
  const mode = payload['ai_mode'];
  if (!current || !thread || thread.id !== payload['thread_id']) return current;
  if (mode !== 'ai' && mode !== 'human' && mode !== 'paused') return current;
  return {
    ...current,
    thread: {
      ...thread,
      ai_mode: mode,
      ai_took_part: thread.ai_took_part === true || payload['reason'] === null,
    },
  };
}
