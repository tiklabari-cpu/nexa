import { describe, expect, it } from 'vitest';
import type { AiHandoffStatement } from '@siyahtus/types';
import { depositFacts, depositProcedure } from '../../../../../test/helpers/procedure-fixtures.js';
import { procedureHash } from '../procedure/executor.js';
import type { AiStateObject } from '../state-store.js';
import { emptyTurnState, type TurnDecisions, type TurnState } from '../turn.js';
import { buildHandoffCard, playerSummaryLine, type HandoffCardSource } from './card-builder.js';

const SKILL_ID = '11111111-1111-4111-8111-111111111111';
// 13:42 in Istanbul on 14 October is 10:42Z; the card is built 95 minutes on.
const NOW = new Date('2026-10-14T12:17:00Z');

function slot(display: string, value: unknown, extra: Record<string, unknown> = {}): AiStateObject {
  return {
    value,
    display,
    status: 'filled',
    source: 'player',
    confidence: 0.9,
    turn: 1,
    attempts: 1,
    previous_values: [],
    ...extra,
  };
}

const DEPOSIT_SLOTS: AiStateObject = {
  kullanici_adi: slot('ali123', 'ali123'),
  yontem: slot('Papara', 'Papara'),
  tutar: slot('2.500 TRY', { amount: 2500, currency: 'TRY' }),
  islem_zamani: slot('14.10.2026 13:42', {
    date: '2026-10-14',
    time: '13:42',
    time_zone: 'Europe/Istanbul',
  }),
  talep_olusturuldu: slot('Evet', true),
  gonderen_kendisi: slot('Evet', true),
  referans: slot('PPR-2026-8841', 'PPR-2026-8841'),
};

function depositState(
  slots: AiStateObject = DEPOSIT_SLOTS,
  edit?: (raw: Record<string, unknown>) => void,
): TurnState {
  const procedure = depositProcedure(edit);
  return {
    ...emptyTurnState(),
    activeSkillId: SKILL_ID,
    procedureSnapshot: {
      skill_name: 'Yatırım hesaba geçmedi',
      ai_agent_id: null,
      locked: false,
      procedure,
    } as unknown as AiStateObject,
    procedureSnapshotHash: procedureHash(procedure),
    stepId: 'finansa_devir',
    stepStatus: 'done',
    slots,
    signals: { risk_flags: ['complaint_formal'] },
  };
}

function decisions(extra: Partial<TurnDecisions> = {}): TurnDecisions {
  return {
    outcome: 'handed_off',
    skillId: SKILL_ID,
    skillName: 'Yatırım hesaba geçmedi',
    replyKind: 'answer',
    failure: null,
    capped: null,
    usage: { llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 0 },
    log: [],
    sentiment: 'negative',
    ...extra,
  };
}

function statements(count: number): AiHandoffStatement[] {
  return Array.from({ length: count }, (_, i) => ({
    event_id: `T${i}_1`,
    text: `AI cevabı ${i + 1}`,
    created_at: new Date(NOW.getTime() - (count - i) * 60_000).toISOString(),
  }));
}

function source(extra: Partial<HandoffCardSource> = {}): HandoffCardSource {
  return {
    reasonCodes: ['procedure_rule'],
    primaryReason: 'procedure_rule',
    priority: 'high',
    targetGroupId: 7,
    state: depositState(),
    decisions: decisions(),
    player: { username: 'ali123', name: 'Ali Veli', email: 'ali@example.com' },
    trust: 'verified',
    firstMessage: 'papara ile yatırdım düşmedi',
    turnText: 'evet kendi hesabımdan',
    statements: statements(2),
    earlierOutputActions: [],
    storedRiskFlags: [],
    attachments: [{ event_id: 'T1_4', name: 'dekont.png', created_at: NOW.toISOString() }],
    now: NOW,
    timeZone: 'Europe/Istanbul',
    facts: depositFacts(),
    ...extra,
  };
}

describe('buildHandoffCard — a deposit hand-over (AI-10 §1 · research §3.1)', () => {
  it('carries every field of the research card, built from the state alone', () => {
    const card = buildHandoffCard(source());

    expect(card.topic).toBe('Yatırım hesaba geçmedi');
    expect(card.skillId).toBe(SKILL_ID);
    expect(card.procedureSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
    expect(card.summary).toBe(
      'Yatırım hesaba geçmedi: ali123, Papara, 2.500 TRY, 14.10.2026 13:42, Evet, Evet, PPR-2026-8841.',
    );
    expect(card.question).toBeNull();
    expect(card.player).toEqual({
      username: 'ali123',
      name: 'Ali Veli',
      email: 'ali@example.com',
      basis: 'declared',
      recognized_device: true,
    });
    // The procedure's `show_in_card` slots, in its order; the file never given is left off.
    expect(card.slots.map((line) => [line.slot, line.text, line.source])).toEqual([
      ['kullanici_adi', 'ali123', 'player'],
      ['yontem', 'Papara', 'player'],
      ['tutar', '2.500 TRY', 'player'],
      ['islem_zamani', '14.10.2026 13:42', 'player'],
      ['talep_olusturuldu', 'Evet', 'player'],
      ['gonderen_kendisi', 'Evet', 'player'],
      ['referans', 'PPR-2026-8841', 'player'],
    ]);
    // The decision's basis: the method's expected time and the time elapsed.
    expect(card.decisionFacts.map((fact) => fact.field)).toEqual([
      'method.expected_minutes',
      'elapsed_minutes(islem_zamani)',
    ]);
    expect(card.decisionFacts[0]?.text).toMatch(/30/);
    // 13:42 → 15:17 Istanbul: 95 minutes.
    expect(card.decisionFacts[1]?.text).toBe('1 saat 35 dk');
    expect(card.suggestedNextStep).toBe(
      'Papara referansı ile ödeme sağlayıcı panelinde eşleştirme.',
    );
    expect(card.reasonCodes).toEqual(['procedure_rule']);
    expect(card.primaryReason).toBe('procedure_rule');
    expect(card.priority).toBe('high');
    expect(card.targetGroupId).toBe(7);
    expect(card.sentiment).toBe('negative');
    expect(card.riskFlags).toEqual(['complaint_formal']);
    expect(card.outputCheckFlags).toEqual([]);
    expect(card.attachments).toHaveLength(1);
    expect(card.aiStatements.map((statement) => statement.text)).toEqual([
      'AI cevabı 1',
      'AI cevabı 2',
    ]);

    const lines = card.cardText.split('\n');
    expect(lines[0]).toBe('Konu: Yatırım hesaba geçmedi');
    expect(card.cardText).toContain('Oyuncu: kullanıcı adı "ali123" · Ali Veli · ali@example.com');
    expect(card.cardText).toContain('(oyuncu beyanı, doğrulanmadı; tanınan cihaz)');
    expect(card.cardText).toContain(
      'Toplanan bilgiler: Kullanıcı adı: ali123 | Ödeme yöntemi: Papara',
    );
    expect(card.cardText).toMatch(
      /Karar dayanağı: method\.expected_minutes: .*30.* \| elapsed_minutes/,
    );
    expect(card.cardText).toContain('AI\'ın söyledikleri: "AI cevabı 1" | "AI cevabı 2"');
    expect(card.cardText).toContain('Çıkış denetimi: söz verilmedi');
    expect(card.cardText).toContain('Devir nedeni: procedure_rule (öncelik high)');
    expect(card.cardText).toContain('Risk/duygu: complaint_formal; olumsuz');
    expect(card.cardText).toContain('Ekler: 1 dosya');
    expect(card.cardText).toContain(
      'Önerilen adım: Papara referansı ile ödeme sağlayıcı panelinde eşleştirme.',
    );
    expect(card.cardText).not.toContain('Customer asked');

    // The transcript note is one event for every viewer, and seeing the
    // player's contact details is a per-person answer (tm 325.6): the note
    // keeps the name and drops the pre-chat username and the address — from
    // the Oyuncu line and from anywhere else it quotes them (the collected
    // "Kullanıcı adı" slot and the summary built from it here).
    expect(card.noteText).toContain(
      'Oyuncu: Ali Veli (oyuncu beyanı, doğrulanmadı; tanınan cihaz)',
    );
    expect(card.noteText).not.toContain('ali@example.com');
    expect(card.noteText).not.toContain('ali123');
    expect(card.noteText).toContain(
      'Toplanan bilgiler: Kullanıcı adı: ••• | Ödeme yöntemi: Papara',
    );
    // Nothing else moves.
    expect(card.noteText).toBe(
      card.cardText
        .replace(/^Oyuncu: .*$/m, 'Oyuncu: Ali Veli (oyuncu beyanı, doğrulanmadı; tanınan cihaz)')
        .replaceAll('ali123', '•••'),
    );
  });

  it('keeps a pii: high value off the card entirely — the line says only that it was given', () => {
    const state = depositState(
      { ...DEPOSIT_SLOTS, referans: slot('PPR-2026-8841', 'PPR-2026-8841', { pii: 'high' }) },
      (raw) => {
        const slots = raw['slots'] as Array<Record<string, unknown>>;
        const referans = slots.find((entry) => entry['name'] === 'referans');
        if (referans) referans['pii'] = 'high';
      },
    );
    const card = buildHandoffCard(source({ state }));

    expect(card.slots.find((line) => line.slot === 'referans')).toMatchObject({
      text: null,
      sensitive: true,
    });
    expect(JSON.stringify(card)).not.toContain('8841');
    expect(card.cardText).toContain('Referans no: paylaşıldı (kartta gösterilmez)');
  });

  it('says "oyuncu beyanı" without the device when the visitor proved nothing', () => {
    const card = buildHandoffCard(source({ trust: 'claimed' }));
    expect(card.player.recognized_device).toBe(false);
    expect(card.cardText).toContain('(oyuncu beyanı, doğrulanmadı)');
  });

  it('keeps the last five of the AI messages, oldest first', () => {
    const card = buildHandoffCard(source({ statements: statements(7) }));
    expect(card.aiStatements.map((statement) => statement.text)).toEqual([
      'AI cevabı 3',
      'AI cevabı 4',
      'AI cevabı 5',
      'AI cevabı 6',
      'AI cevabı 7',
    ]);
  });

  it('flags a draft the checks rewrote or held back, this turn or before', () => {
    const card = buildHandoffCard(
      source({
        earlierOutputActions: ['rewrite', 'prompt_block'],
        decisions: decisions({
          guardrails: {
            catalog_version: '1',
            hits: [
              {
                rule_key: 'G7',
                stage: 'output',
                action: 'safe_text',
                evidence: null,
                pattern_index: null,
              },
              {
                rule_key: 'G1',
                stage: 'input',
                action: 'warn',
                evidence: null,
                pattern_index: null,
              },
            ],
            risk_flags: ['abusive'],
          },
        }),
        storedRiskFlags: ['complaint_formal', 'rg_signal'],
      }),
    );
    expect(card.outputCheckFlags).toEqual(['draft_rewritten', 'draft_blocked']);
    expect(card.cardText).toContain(
      'Çıkış denetimi: bir taslak yeniden yazıldı; dikkat: bir taslak engellendi',
    );
    expect(card.riskFlags).toEqual(['abusive', 'complaint_formal', 'rg_signal']);
  });

  it('lists what a tool step could not check (AI-28 pending_checks)', () => {
    const state = {
      ...depositState(),
      signals: { pending_checks: [{ tool: 'deposit_lookup' }, 'deposit_lookup', 'kyc_status'] },
    };
    const card = buildHandoffCard(source({ state }));
    expect(card.checks).toEqual(['deposit_lookup', 'kyc_status']);
    expect(card.cardText).toContain('Kontrol edilmesi gereken: deposit_lookup, kyc_status');
  });

  it('leaves the next step empty when its variables are unknown', () => {
    const { yontem: _yontem, ...withoutMethod } = DEPOSIT_SLOTS;
    const card = buildHandoffCard(source({ state: depositState(withoutMethod) }));
    expect(card.suggestedNextStep).toBeNull();
    expect(card.cardText).not.toContain('Önerilen adım');
  });
});

describe('buildHandoffCard — a hand-over no procedure ran', () => {
  it('shows the question and why the knowledge base had no answer (AI-06 §8)', () => {
    const card = buildHandoffCard(
      source({
        reasonCodes: ['no_knowledge'],
        primaryReason: 'no_knowledge',
        priority: 'normal',
        targetGroupId: null,
        state: emptyTurnState(),
        decisions: decisions({
          skillId: null,
          skillName: null,
          unanswered: {
            language: 'tr',
            category: 'other',
            policy: 'handoff',
            reason: 'no_passages',
          } as TurnDecisions['unanswered'],
        }),
        firstMessage: 'Çekim limitim ne kadar?',
        turnText: 'Çekim limitim ne kadar?',
      }),
    );
    expect(card.topic).toBeNull();
    expect(card.summary).toBe('Soru: Çekim limitim ne kadar?');
    expect(card.question).toBe('Çekim limitim ne kadar?');
    expect(card.slots).toEqual([]);
    expect(card.decisionFacts).toEqual([{ field: 'knowledge', text: 'no_passages' }]);
    expect(card.cardText).toContain('Konu: Prosedür dışı soru');
    expect(card.cardText).toContain('Soru: Çekim limitim ne kadar?');
    expect(card.cardText).toContain('Devir nedeni: no_knowledge');
    expect(card.cardText).toContain('Karar dayanağı: knowledge: no_passages');
  });

  it("keeps the turn's own summary line — the same day's contact count — where it wrote one", () => {
    const card = buildHandoffCard(
      source({
        state: emptyTurnState(),
        decisions: decisions({ skillId: null, skillName: null }),
        firstMessage: 'Hâlâ gelmedi',
        turnText: 'Hâlâ gelmedi',
        turnSummary: 'Aynı gün, 2. temas · Soru: Hâlâ gelmedi',
      }),
    );
    expect(card.summary).toBe('Aynı gün, 2. temas · Soru: Hâlâ gelmedi');
    // A procedure's card has its own line, whatever the turn wrote.
    expect(buildHandoffCard(source({ turnSummary: 'Soru: x' })).summary).toMatch(
      /^Yatırım hesaba geçmedi: /,
    );
  });

  it('builds a card when no turn ran (the day cap): the reason and the player', () => {
    const card = buildHandoffCard(
      source({
        reasonCodes: ['ai_failure'],
        primaryReason: 'ai_failure',
        priority: 'normal',
        state: null,
        decisions: null,
        firstMessage: null,
        turnText: null,
        statements: [],
        attachments: [],
      }),
    );
    expect(card.summary).toBe('AI devretti (ai_failure).');
    expect(card.skillId).toBeNull();
    expect(card.sentiment).toBeNull();
    expect(card.cardText).toContain('Risk/duygu: risk bayrağı yok; duygu okunmadı');
  });
});

describe('playerSummaryLine (AI-10-S1)', () => {
  it("tells the player the values they gave, in one message, in the procedure's order", () => {
    expect(playerSummaryLine(depositState(), 'tr')).toBe(
      'Şu bilgileri ilettim: ali123, Papara, 2.500 TRY, 14.10.2026 13:42, Evet, Evet, PPR-2026-8841. Yanlış bir bilgi varsa yazabilirsiniz.',
    );
  });

  it('leaves out a pii: high value, a carried one, an inferred one and a refused one', () => {
    const state = depositState(
      {
        kullanici_adi: slot('ali123', 'ali123', { source: 'carried', status: 'carried' }),
        yontem: slot('Papara', 'Papara', { source: 'inferred' }),
        tutar: slot('2.500 TRY', { amount: 2500, currency: 'TRY' }),
        islem_zamani: slot('14.10.2026 13:42', null, { status: 'refused' }),
        referans: slot('PPR-2026-8841', 'PPR-2026-8841', { pii: 'high' }),
      },
      (raw) => {
        const slots = raw['slots'] as Array<Record<string, unknown>>;
        const referans = slots.find((entry) => entry['name'] === 'referans');
        if (referans) referans['pii'] = 'high';
      },
    );
    expect(playerSummaryLine(state, 'tr')).toBe(
      'Şu bilgileri ilettim: 2.500 TRY. Yanlış bir bilgi varsa yazabilirsiniz.',
    );
  });

  it('speaks English to an English conversation and stays silent in others', () => {
    expect(playerSummaryLine(depositState({ yontem: slot('Papara', 'Papara') }), 'en')).toBe(
      'I passed on: Papara. If anything is wrong, just write it here.',
    );
    expect(playerSummaryLine(depositState(), 'de')).toBeNull();
  });

  it('says nothing without a procedure or without a value', () => {
    expect(playerSummaryLine(emptyTurnState(), 'tr')).toBeNull();
    expect(playerSummaryLine(depositState({}), 'tr')).toBeNull();
  });
});
