/**
 * The hand-over card's pure half (tm 304.2 · AI-10): which transcript line is
 * a card's, and how a verdict replaces the card in the caches that hold it.
 */
import { describe, expect, it } from 'vitest';
import { SLOT_STATUSES } from '@siyahtus/types';
import { depositCard, knowledgeCard } from '../../test/ai-handoff.js';
import {
  SLOT_STATUS_MARK,
  handoffCardIdOf,
  isKnowledgeMissReason,
  playerParts,
  withJudgedCard,
  withJudgedCardInPage,
} from './handoffCard.js';
import type { ChatDetail, ChatEvent } from './types.js';

function line(overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    id: 'ev-1',
    chat_id: 'CHAT1',
    thread_id: 'TH1',
    type: 'system_message',
    text: 'Konu: …',
    author_id: null,
    author_type: 'system',
    recipients: 'agents',
    attachment_url: null,
    properties: { system_event: 'ai_handoff_card', ai_handoff_id: 'card-1' },
    created_at: '2026-10-20T14:00:00.000Z',
    ...overrides,
  };
}

describe('handoffCardIdOf', () => {
  it('names the card of the hand-over’s agents-only line', () => {
    expect(handoffCardIdOf(line())).toBe('card-1');
  });

  it('is null for any other line — another system event, one the visitor sees, or no card id', () => {
    expect(handoffCardIdOf(line({ properties: { system_event: 'transfer' } }))).toBeNull();
    expect(handoffCardIdOf(line({ recipients: 'all' }))).toBeNull();
    expect(handoffCardIdOf(line({ author_type: 'customer' }))).toBeNull();
    expect(handoffCardIdOf(line({ properties: { system_event: 'ai_handoff_card' } }))).toBeNull();
    expect(
      handoffCardIdOf(line({ properties: { system_event: 'ai_handoff_card', ai_handoff_id: 7 } })),
    ).toBeNull();
  });
});

describe('a verdict in the caches', () => {
  const chat = { id: 'CHAT1', latest_ai_handoff: depositCard() } as ChatDetail;

  it('replaces the chat’s newest card when it is the one judged', () => {
    const judged = depositCard({ feedback: 'sufficient' });
    expect(withJudgedCard(chat, judged)?.latest_ai_handoff).toBe(judged);
  });

  it('leaves the chat alone for another card, or a chat with none', () => {
    expect(withJudgedCard(chat, knowledgeCard({ feedback: 'sufficient' }))).toBe(chat);
    const none = { id: 'CHAT1', latest_ai_handoff: null } as ChatDetail;
    expect(withJudgedCard(none, depositCard())).toBe(none);
    expect(withJudgedCard(undefined, depositCard())).toBeUndefined();
  });

  it('replaces the judged card among the day’s cards, and only it', () => {
    const judged = depositCard({ feedback: 'insufficient' });
    const page = withJudgedCardInPage({ items: [knowledgeCard(), depositCard()] }, judged);
    expect(page?.items.map((card) => card.feedback)).toEqual([null, 'insufficient']);
    expect(withJudgedCardInPage(undefined, judged)).toBeUndefined();
  });
});

describe('what the card draws from', () => {
  it('has a mark for every slot status', () => {
    for (const status of SLOT_STATUSES) expect(SLOT_STATUS_MARK[status]).toBeTruthy();
  });

  it('knows the knowledge base’s reasons for having nothing, and nothing else', () => {
    expect(isKnowledgeMissReason('no_passages')).toBe(true);
    expect(isKnowledgeMissReason('1 saat 35 dk')).toBe(false);
    expect(isKnowledgeMissReason(null)).toBe(false);
  });

  it('lists the player’s claimed identity in the order an agent asks for it, skipping blanks', () => {
    expect(playerParts(depositCard())).toEqual(['ayse_k', 'Ayşe K.', 'ayse@example.com']);
    expect(
      playerParts(
        depositCard({
          player: {
            username: null,
            name: 'Ayşe',
            email: null,
            basis: 'declared',
            recognized_device: false,
          },
        }),
      ),
    ).toEqual(['Ayşe']);
  });
});
