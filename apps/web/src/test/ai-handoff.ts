/**
 * The AI's hand-over cards as the API serves them, for the inbox's tests
 * (tm 304.2): a deposit that did not arrive, after the research's §3.1 example
 * card, and a knowledge hand-over — the question and why there was no answer.
 */
import type { AiHandoffCardView } from '@siyahtus/types';

export function depositCard(overrides: Partial<AiHandoffCardView> = {}): AiHandoffCardView {
  return {
    id: '7d0f5a52-4c1e-4b55-9d65-0d3c1f1e2a10',
    chat_id: 'CHAT1',
    thread_id: 'TH1',
    skill_id: 'skill-1',
    procedure_key: 'deposit_missing',
    procedure_snapshot_hash: 'abc123',
    topic: 'Yatırım geçmedi',
    summary: 'Yatırım geçmedi: Papara, 2.500 TL, 13:42.',
    question: null,
    player: {
      username: 'ayse_k',
      name: 'Ayşe K.',
      email: 'ayse@example.com',
      basis: 'declared',
      recognized_device: false,
    },
    slots: [
      {
        slot: 'method',
        label: 'Yöntem',
        status: 'filled',
        text: 'Papara',
        source: 'player',
      },
      {
        slot: 'amount',
        label: 'Tutar',
        status: 'filled',
        text: '2.500 TL',
        source: 'player',
      },
      {
        slot: 'paid_at',
        label: 'Ödeme saati',
        status: 'partial',
        text: '13:42',
        source: 'player',
      },
      {
        slot: 'iban',
        label: 'IBAN',
        status: 'filled',
        text: null,
        source: 'player',
        sensitive: true,
      },
    ],
    decision_facts: [
      { field: 'elapsed_minutes', text: '1 saat 35 dk' },
      { field: 'expected_minutes', text: null },
    ],
    checks: ['Papara işlem kaydı'],
    ai_statements: [
      {
        event_id: 'ev-ai-1',
        text: 'Papara yatırımları genellikle 30 dakika içinde hesaba geçer.',
        created_at: '2026-10-20T13:50:00.000Z',
      },
    ],
    output_check_flags: ['draft_rewritten'],
    reason_codes: ['procedure_rule', 'negative_sentiment'],
    primary_reason: 'procedure_rule',
    risk_flags: ['complaint_formal'],
    sentiment: 'negative',
    suggested_next_step: 'Papara kaydını kontrol edip oyuncuya süre verin.',
    attachments: [
      { event_id: 'ev-file-1', name: 'dekont.png', created_at: '2026-10-20T13:48:00.000Z' },
    ],
    target_group_id: 2,
    priority: 'high',
    card_text: 'Konu: Yatırım geçmedi\nÖzet: Yatırım geçmedi: Papara, 2.500 TL, 13:42.',
    created_at: '2026-10-20T14:00:00.000Z',
    accepted_by: null,
    accepted_at: null,
    feedback: null,
    feedback_reason: null,
    feedback_by: null,
    feedback_at: null,
    ...overrides,
  };
}

export function knowledgeCard(overrides: Partial<AiHandoffCardView> = {}): AiHandoffCardView {
  const question = 'USDT cüzdan adresimi nasıl değiştiririm?';
  return depositCard({
    id: '0b6e4d4a-1d7d-4a8e-8c55-6d1c0f6a3b21',
    skill_id: null,
    procedure_key: null,
    procedure_snapshot_hash: null,
    topic: null,
    summary: `Soru: ${question}`,
    question,
    slots: [],
    decision_facts: [{ field: 'knowledge', text: 'no_passages' }],
    checks: [],
    ai_statements: [],
    output_check_flags: [],
    reason_codes: ['no_knowledge'],
    primary_reason: 'no_knowledge',
    risk_flags: [],
    sentiment: null,
    suggested_next_step: null,
    attachments: [],
    priority: 'normal',
    card_text: `Soru: ${question}\nDevir nedeni: no_knowledge (öncelik normal)`,
    ...overrides,
  });
}
