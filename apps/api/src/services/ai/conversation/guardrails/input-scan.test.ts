/**
 * The input scan (tm 301.3 · AI-08 §1–§3): which rules the player's words set
 * off on their own, which the understanding call's signals set off, and which
 * matches are only evidence. Pure — no model, no settings.
 */
import { describe, expect, it } from 'vitest';
import { platformGuardrail, type GuardrailId } from '@siyahtus/types';
import {
  leadingTrigger,
  mergeTriggers,
  raisedRiskFlags,
  scanInput,
  signalTriggers,
  triggerEvidence,
  type GuardrailTrigger,
} from './input-scan.js';

const ids = (triggers: readonly GuardrailTrigger[]) => triggers.map((t) => t.rule.id);

/** An understanding with these risk signals raised, the rest not. */
function signals(raised: Record<string, string | null>) {
  const names = [
    'self_exclusion',
    'rg_signal',
    'self_harm',
    'minor',
    'fraud_aml',
    'complaint_formal',
    'account_takeover',
  ];
  return {
    risk: Object.fromEntries(
      names.map((name) => [
        name,
        name in raised
          ? { flag: true, evidence_quote: raised[name] }
          : { flag: false, evidence_quote: null },
      ]),
    ),
  };
}

function trigger(id: GuardrailId): GuardrailTrigger {
  return { rule: platformGuardrail(id), matches: [], signals: [], signalQuote: null };
}

describe('the lexicon alone (AI-08 §2)', () => {
  it.each([
    ['artık oynamak istemiyorum, hesabımı kapatın', 'G1'],
    ['kendimi öldüreceğim', 'G3'],
    ['16 yaşındayım', 'G5'],
    ['yatırım limitimi yükseltin lütfen', 'G6'],
    ['müşteri temsilcisiyle görüşmek istiyorum', 'G16'],
  ] as const)('“%s” sets %s off before any model is asked', (text, rule) => {
    const scan = scanInput(text);
    expect(ids(scan.triggered)).toEqual([rule]);
    expect(scan.triggered[0]!.matches[0]!.quote.length).toBeGreaterThan(0);
  });

  it('G2, G13 and G15 are evidence only: matched, never set off by their words', () => {
    for (const text of [
      'kaybımı geri almam lazım',
      'hesabım çalındı galiba',
      'avukatımla görüşeceğim',
    ]) {
      const scan = scanInput(text);
      expect(scan.triggered).toEqual([]);
      expect(scan.matches.length).toBeGreaterThan(0);
    }
  });

  it('G19 is returned apart, for its warnings — not a trigger yet', () => {
    const scan = scanInput('aptal mısınız siz');
    expect(scan.triggered).toEqual([]);
    expect(scan.abuse.map((match) => match.rule)).toEqual(['G19']);
  });

  it('an ordinary message sets nothing off', () => {
    const scan = scanInput('Papara ile yatırdığım para hesabıma geçmedi, ne yapmalıyım?');
    expect(scan).toEqual({ matches: [], triggered: [], abuse: [] });
  });
});

describe('the understanding call’s signals (AI-08 §2)', () => {
  it('each signal sets its rule off on its own, with its quote', () => {
    const scan = scanInput('her şeyimi kaybettim');
    const triggers = signalTriggers(signals({ rg_signal: 'her şeyimi kaybettim' }), scan);
    expect(ids(triggers)).toEqual(['G2']);
    expect(triggers[0]).toMatchObject({
      signals: ['rg_signal'],
      signalQuote: 'her şeyimi kaybettim',
    });
  });

  it.each([
    ['self_exclusion', 'G1'],
    ['self_harm', 'G3'],
    ['minor', 'G5'],
    ['fraud_aml', 'G13'],
    ['account_takeover', 'G13'],
    ['complaint_formal', 'G15'],
  ] as const)('%s → %s', (signal, rule) => {
    expect(ids(signalTriggers(signals({ [signal]: null }), scanInput('merhaba')))).toEqual([rule]);
  });

  it('an understanding with no signals — a handed-in one — sets nothing off', () => {
    expect(
      signalTriggers({ intent: { procedure_key: null, confidence: 0 } }, scanInput('x')),
    ).toEqual([]);
    expect(signalTriggers(null, scanInput('x'))).toEqual([]);
  });
});

describe('what the triggers decide', () => {
  it('self-harm leads whatever else is set off; then the most urgent; then the catalogue', () => {
    expect(leadingTrigger([trigger('G15'), trigger('G3'), trigger('G1')])?.rule.id).toBe('G3');
    expect(leadingTrigger([trigger('G15'), trigger('G5')])?.rule.id).toBe('G5');
    expect(leadingTrigger([trigger('G13'), trigger('G15')])?.rule.id).toBe('G13');
    expect(leadingTrigger([])).toBeNull();
  });

  it('raises the rule’s flag and each signal’s — G13 names its own by signal', () => {
    expect(raisedRiskFlags([trigger('G1'), trigger('G5')])).toEqual([
      'self_exclusion_request',
      'underage_suspected',
    ]);
    const takeover = { ...trigger('G13'), signals: ['account_takeover', 'fraud_aml'] as const };
    expect(raisedRiskFlags([{ ...takeover, signals: [...takeover.signals] }])).toEqual([
      'account_takeover_suspected',
      'fraud_suspected',
    ]);
    expect(raisedRiskFlags([trigger('G6')])).toEqual([]);
  });

  it('merges a rule found twice — the lexicon’s matches and the signal — into one', () => {
    const scan = scanInput('hesabımı kapatın');
    const merged = mergeTriggers(
      scan.triggered,
      signalTriggers(signals({ self_exclusion: 'hesabımı kapatın' }), scan),
    );
    expect(ids(merged)).toEqual(['G1']);
    expect(merged[0]!.signals).toEqual(['self_exclusion']);
    expect(triggerEvidence(merged[0]!)).toMatchObject({ quote: 'hesabımı kapatın' });
  });
});
