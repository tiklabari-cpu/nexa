/**
 * The AI's hand-over card in the console (tm 304.2 · SiyahTuş analysis AI-10)
 * — the pure half: cache keys, which transcript line is a card's, and how a
 * verdict lands in the caches that hold the card.
 *
 * A card reaches the console three ways, and all three show the same object:
 * with the chat (`ChatDetail.latest_ai_handoff`, the Details panel's top), as
 * one of the day's cards (`GET /chats/{chatId}/ai-handoffs`, what the
 * transcript's card lines open) and as a push (`ai_handoff_created`), which
 * re-reads both.
 */
import {
  AI_HANDOFF_CARD_SYSTEM_EVENT,
  type AiHandoffCardView,
  type GuardrailPriority,
  type SlotStatus,
} from '@siyahtus/types';
import type { ChatDetail, ChatEvent } from './types.js';

/** Every chat's card list — what an `ai_handoff_created` push re-reads. */
export const AI_HANDOFFS_KEY = ['ai-handoffs'] as const;

/** One chat's cards, newest first (its whole day). */
export function chatAiHandoffsKey(chatId: string): readonly [string, string] {
  return [AI_HANDOFFS_KEY[0], chatId];
}

export interface AiHandoffPage {
  items: AiHandoffCardView[];
}

/**
 * The card a transcript line stands for: the agents-only system line the
 * hand-over writes (`system_event: ai_handoff_card`) names it. Null for any
 * other line — a customer cannot write one, since a customer's event never
 * carries `recipients: 'agents'`.
 */
export function handoffCardIdOf(event: ChatEvent): string | null {
  if (event.recipients !== 'agents' || event.author_type !== 'system') return null;
  const properties = event.properties ?? {};
  if (properties['system_event'] !== AI_HANDOFF_CARD_SYSTEM_EVENT) return null;
  const id = properties['ai_handoff_id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** The chat with a judged card in place of the one it held; anything else untouched. */
export function withJudgedCard(
  chat: ChatDetail | undefined,
  card: AiHandoffCardView,
): ChatDetail | undefined {
  if (!chat?.latest_ai_handoff || chat.latest_ai_handoff.id !== card.id) return chat;
  return { ...chat, latest_ai_handoff: card };
}

/** The day's cards with a judged one in place. */
export function withJudgedCardInPage(
  page: AiHandoffPage | undefined,
  card: AiHandoffCardView,
): AiHandoffPage | undefined {
  if (!page) return page;
  return { items: page.items.map((item) => (item.id === card.id ? card : item)) };
}

/**
 * A slot's status as a mark beside its line. Decoration only: the status is
 * also written out (`playbook.procedure.slotStatus.*`), so a screen reader
 * hears the word, not the glyph.
 */
export const SLOT_STATUS_MARK: Readonly<Record<SlotStatus, string>> = {
  filled: '✓',
  carried: '↺',
  partial: '◐',
  missing: '–',
  invalid: '✗',
  refused: '✗',
  unknown: '?',
};

/** How loud the card's priority chip is. */
export const PRIORITY_TONE: Readonly<Record<GuardrailPriority, string>> = {
  urgent: 'bg-danger/10 text-danger',
  high: 'bg-warning/10 text-warning',
  normal: 'bg-inset text-content-secondary',
};

/** Why the knowledge base had nothing (`decision_facts` `knowledge`, a knowledge hand-over). */
export const KNOWLEDGE_MISS_REASONS = [
  'no_passages',
  'not_grounded',
  'withheld',
  'nothing_answered',
] as const;

export function isKnowledgeMissReason(
  value: string | null,
): value is (typeof KNOWLEDGE_MISS_REASONS)[number] {
  return value !== null && (KNOWLEDGE_MISS_REASONS as readonly string[]).includes(value);
}

/** The player's own words for who they are, in the order an agent asks for them. */
export function playerParts(card: AiHandoffCardView): string[] {
  const { username, name, email } = card.player;
  return [username, name, email].filter((part): part is string => Boolean(part));
}
