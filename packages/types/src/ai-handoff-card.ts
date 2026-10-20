/**
 * The AI's hand-over card (tm 304.1 · SiyahTuş analysis AI-10).
 *
 * When the AI hands a connection to a person, the person should start work
 * without asking the player anything again. The card says what it was about,
 * who the player says they are, what the AI collected and what it decided on,
 * what it told the player, why it handed over, the risk and the mood, and the
 * step it suggests — built from the conversation's state, never by a model.
 *
 * One card per hand-over (`ai_handoffs`, keyed by the hand-over's id — the
 * `handoff_id` its transfer and AI-mode events carry). An agent may mark it
 * sufficient or not, once per click and the last click wins (AI-10-S2: optional).
 *
 * What a card never holds: a `pii: 'high'` slot's value (its line says only that
 * it was given), an internal note, or anything a customer token can read — the
 * card is the agents' (`GET /chats/{chatId}/ai-handoffs`), and no webhook
 * carries it.
 */
import type { GuardrailPriority } from './guardrails.js';
import type { HandoffReason } from './handoff.js';
import type { SlotSource, SlotStatus } from './slots.js';

/** An agent's verdict on a card (AI-10 §7 → AI-25 "hand-over quality"). */
export const AI_HANDOFF_FEEDBACK_VALUES = ['sufficient', 'insufficient'] as const;
export type AiHandoffFeedback = (typeof AI_HANDOFF_FEEDBACK_VALUES)[number];

export function isAiHandoffFeedback(value: unknown): value is AiHandoffFeedback {
  return (
    typeof value === 'string' && (AI_HANDOFF_FEEDBACK_VALUES as readonly string[]).includes(value)
  );
}

/** The optional why behind a verdict, in characters. */
export const AI_HANDOFF_FEEDBACK_REASON_MAX = 500;

/** How the player came across, as the understanding read their last message. */
export const AI_HANDOFF_SENTIMENTS = ['positive', 'neutral', 'negative', 'angry'] as const;
export type AiHandoffSentiment = (typeof AI_HANDOFF_SENTIMENTS)[number];

/** How many of the AI's own messages the card repeats, newest last. */
export const AI_HANDOFF_STATEMENTS_MAX = 5;
/** One of them, at most, in characters. */
export const AI_HANDOFF_STATEMENT_MAX = 600;
/** The card's plain text (the agents-only line and the archive), at most, in characters. */
export const AI_HANDOFF_CARD_TEXT_MAX = 8000;
/** The one-line summary (`threads.summary` too), at most, in characters. */
export const AI_HANDOFF_SUMMARY_MAX = 400;

/**
 * What the draft checks found on the AI's replies in the connection
 * (AI-08 output stage): a draft rewritten, a draft held back for a safe text or
 * a person, a warning. None: the AI made no promise the checks caught.
 */
export const AI_HANDOFF_OUTPUT_FLAGS = [
  'draft_rewritten',
  'draft_blocked',
  'draft_warned',
] as const;
export type AiHandoffOutputFlag = (typeof AI_HANDOFF_OUTPUT_FLAGS)[number];

/** The `system_event` of the agents-only line that carries the card's text. */
export const AI_HANDOFF_CARD_SYSTEM_EVENT = 'ai_handoff_card';

/** The player as the card shows them: their own claim (ID-03), never verified in F1. */
export interface AiHandoffPlayer {
  username: string | null;
  name: string | null;
  email: string | null;
  /** Always `declared` in F1: "oyuncu beyanı, doğrulanmadı". */
  basis: 'declared';
  /** A member token this workspace signed came with the message: "tanınan cihaz". */
  recognized_device: boolean;
}

/** One collected slot, in the procedure's order (`show_in_card` only). */
export interface AiHandoffSlotLine {
  slot: string;
  label: string;
  status: SlotStatus;
  /** The value as collected, or what stands in for it; null for a sensitive slot. */
  text: string | null;
  source: SlotSource | null;
  /** A `pii: 'high'` slot: given, kept off the card. */
  sensitive?: true;
  out_of_range?: 'below_min' | 'above_max';
}

/** A field the procedure shows as the decision's basis (`handoff.card_fields`). */
export interface AiHandoffFact {
  field: string;
  /** Its value, or null when the conversation does not know it. */
  text: string | null;
}

/** One of the AI's messages to the player. */
export interface AiHandoffStatement {
  event_id: string;
  text: string;
  created_at: string;
}

/** A file the player sent in the connection. */
export interface AiHandoffAttachment {
  event_id: string;
  name: string | null;
  created_at: string;
}

/** The card as the API serves it (`AiHandoffCard`). */
export interface AiHandoffCardView {
  id: string;
  chat_id: string;
  thread_id: string;
  skill_id: string | null;
  procedure_key: string | null;
  procedure_snapshot_hash: string | null;
  /** The procedure's name — the card's subject; null when no procedure ran. */
  topic: string | null;
  summary: string;
  /** The player's question, on a hand-over no procedure ran (a knowledge answer it lacked). */
  question: string | null;
  player: AiHandoffPlayer;
  slots: AiHandoffSlotLine[];
  decision_facts: AiHandoffFact[];
  /** What a person must check, since no tool could (AI-28 `pending_checks`). */
  checks: string[];
  ai_statements: AiHandoffStatement[];
  output_check_flags: AiHandoffOutputFlag[];
  reason_codes: HandoffReason[];
  primary_reason: HandoffReason;
  risk_flags: string[];
  sentiment: AiHandoffSentiment | null;
  suggested_next_step: string | null;
  attachments: AiHandoffAttachment[];
  target_group_id: number | null;
  priority: GuardrailPriority;
  card_text: string;
  created_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  feedback: AiHandoffFeedback | null;
  feedback_reason: string | null;
  feedback_by: string | null;
  feedback_at: string | null;
}

/** `ai_handoff_created` (RTM): a card was written; to the agents who see the conversation and the target team. */
export interface AiHandoffCreatedPush {
  chat_id: string;
  thread_id: string;
  handoff_id: string;
  primary_reason: HandoffReason;
  priority: GuardrailPriority;
  target_group_id: number | null;
}
