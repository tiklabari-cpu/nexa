import { describe, expect, it } from 'vitest';
import {
  GUARDRAIL_HANDOFF_REASONS,
  GUARDRAIL_LANGS,
  PLATFORM_GUARDRAILS,
  platformGuardrail,
  scanGuardrails,
} from './guardrails.js';
import {
  DEFAULT_HANDOFF_AFTER_HOURS_TEXT,
  DEFAULT_HANDOFF_MESSAGES,
  DEFAULT_HANDOFF_TRIGGERS,
  HANDOFF_MESSAGE_MAX,
  HANDOFF_MESSAGE_REASONS,
  HANDOFF_REASON_INFO,
  HANDOFF_REASONS,
  HANDOFF_TRIGGER_BOUNDS,
  handoffMessage,
  isLockedHandoffReason,
  LOCKED_HANDOFF_REASONS,
  mergeHandoffMessages,
  mergeHandoffTriggers,
  primaryHandoffReason,
  readHandoffAfterHours,
  readHandoffMessages,
  readHandoffTriggers,
  storedHandoffMessages,
  SWITCHABLE_HANDOFF_TRIGGERS,
} from './handoff.js';

describe('hand-over reason catalogue (AI-09 · tm 303.1)', () => {
  it("has every AI-09 code, K9's tenant_rule and AI-25's player_said_unresolved, once each", () => {
    const ai09 = [
      'player_request',
      'not_understood',
      'negative_sentiment',
      'no_knowledge',
      'guardrail_rg',
      'guardrail_self_harm',
      'guardrail_minor',
      'guardrail_account_security',
      'guardrail_complaint',
      'abuse',
      'loop_detected',
      'max_turns',
      'repeat_same_day',
      'procedure_rule',
      'missing_required_info',
      'ai_failure',
      'unsupported_language',
      'guardrail_output_block',
      'tenant_rule',
      'player_said_unresolved',
    ];
    for (const code of ai09) expect(HANDOFF_REASONS).toContain(code);
    expect(new Set(HANDOFF_REASONS).size).toBe(HANDOFF_REASONS.length);
  });

  it('holds every reason the guardrails already hand over with', () => {
    for (const reason of GUARDRAIL_HANDOFF_REASONS) expect(HANDOFF_REASONS).toContain(reason);
    for (const rule of PLATFORM_GUARDRAILS) {
      if (rule.handoffReason !== null) expect(HANDOFF_REASONS).toContain(rule.handoffReason);
    }
  });

  it('ranks the reasons in list order, 1 the most severe', () => {
    expect(Object.keys(HANDOFF_REASON_INFO).sort()).toEqual([...HANDOFF_REASONS].sort());
    HANDOFF_REASONS.forEach((reason, index) => {
      expect(HANDOFF_REASON_INFO[reason].rank).toBe(index + 1);
    });
  });

  it('locks the compliance guardrails, a person asked for and never going silent', () => {
    const locked = HANDOFF_REASONS.filter((r) => HANDOFF_REASON_INFO[r].control === 'locked');
    expect([...LOCKED_HANDOFF_REASONS].sort()).toEqual([...locked].sort());
    for (const reason of [
      'guardrail_self_harm',
      'guardrail_minor',
      'guardrail_rg',
      'guardrail_account_security',
      'guardrail_complaint',
      'abuse',
      'player_request',
      'ai_failure',
      'unsupported_language',
    ]) {
      expect(isLockedHandoffReason(reason)).toBe(true);
    }
    expect(isLockedHandoffReason('not_understood')).toBe(false);
    expect(isLockedHandoffReason('tenant_rule')).toBe(false);
  });

  it('switches exactly the triggers the settings carry an `enabled` for', () => {
    const switched = HANDOFF_REASONS.filter((r) => HANDOFF_REASON_INFO[r].control === 'switch');
    expect([...SWITCHABLE_HANDOFF_TRIGGERS].sort()).toEqual([...switched].sort());
    for (const trigger of SWITCHABLE_HANDOFF_TRIGGERS) {
      expect(DEFAULT_HANDOFF_TRIGGERS[trigger]).toHaveProperty('enabled', true);
    }
    expect(DEFAULT_HANDOFF_TRIGGERS.abuse).not.toHaveProperty('enabled');
  });

  it('judges output-sourced reasons after compose and ai_failure at any point (AI-09 §1)', () => {
    expect(HANDOFF_REASON_INFO.guardrail_output_block.stage).toBe('output');
    expect(HANDOFF_REASON_INFO.guardrail_workspace_rule.stage).toBe('output');
    expect(HANDOFF_REASON_INFO.player_request.stage).toBe('understand');
    expect(HANDOFF_REASON_INFO.missing_required_info.stage).toBe('procedure');
    expect(HANDOFF_REASON_INFO.ai_failure.stage).toBe('system');
  });

  it('picks the most severe of several reasons as the primary one', () => {
    expect(primaryHandoffReason([])).toBeNull();
    expect(primaryHandoffReason(['not_understood', 'player_request', 'abuse'])).toBe('abuse');
    expect(primaryHandoffReason(['ai_failure', 'guardrail_self_harm'])).toBe('guardrail_self_harm');
    // A procedure's own reason code ranks after every known one.
    expect(primaryHandoffReason(['kyc_docs_missing', 'max_turns'])).toBe('max_turns');
    expect(primaryHandoffReason(['kyc_docs_missing'])).toBe('kyc_docs_missing');
  });
});

describe('hand-over triggers (AI-09-S1 · AI-09-S2)', () => {
  it('defaults to 2 turns not understood (asked first), 2 warnings, 12 turns', () => {
    expect(readHandoffTriggers(null)).toEqual({
      not_understood: { enabled: true, turns: 2, ask_first: true },
      negative_sentiment: { enabled: true, consecutive: 2, ask_first: false },
      abuse: { warnings: 2 },
      loop_detected: { enabled: true },
      max_turns: { enabled: true, turns: 12 },
      repeat_same_day: { enabled: true },
    });
  });

  it("keeps G19's own warning count as the abuse default", () => {
    expect(DEFAULT_HANDOFF_TRIGGERS.abuse.warnings).toBe(
      platformGuardrail('G19').warningsBeforeHandoff ?? 2,
    );
  });

  it('reads a stored value and falls back field by field on anything unusable', () => {
    const read = readHandoffTriggers({
      not_understood: { enabled: false, turns: 3 },
      negative_sentiment: { consecutive: 0, ask_first: 'yes' },
      abuse: { warnings: 99 },
      max_turns: { turns: 2.5, enabled: false },
      loop_detected: 'off',
      unknown: { enabled: false },
    });
    expect(read.not_understood).toEqual({ enabled: false, turns: 3, ask_first: true });
    expect(read.negative_sentiment).toEqual(DEFAULT_HANDOFF_TRIGGERS.negative_sentiment);
    expect(read.abuse.warnings).toBe(2);
    expect(read.max_turns).toEqual({ enabled: false, turns: 12 });
    expect(read.loop_detected.enabled).toBe(true);
    expect(read).not.toHaveProperty('unknown');
  });

  it('honours the bounds at both ends', () => {
    const { min, max } = HANDOFF_TRIGGER_BOUNDS.max_turns;
    expect(readHandoffTriggers({ max_turns: { turns: min } }).max_turns.turns).toBe(min);
    expect(readHandoffTriggers({ max_turns: { turns: max } }).max_turns.turns).toBe(max);
    expect(readHandoffTriggers({ max_turns: { turns: max + 1 } }).max_turns.turns).toBe(12);
    expect(readHandoffTriggers({ max_turns: { turns: min - 1 } }).max_turns.turns).toBe(12);
  });

  it('merges a change over what is stored; a field left out keeps its value', () => {
    const stored = { not_understood: { turns: 4, ask_first: false } };
    const merged = mergeHandoffTriggers(stored, {
      not_understood: { enabled: false },
      abuse: { warnings: 3 },
    });
    expect(merged.not_understood).toEqual({ enabled: false, turns: 4, ask_first: false });
    expect(merged.abuse).toEqual({ warnings: 3 });
    expect(merged.max_turns).toEqual(DEFAULT_HANDOFF_TRIGGERS.max_turns);
  });
});

describe('hand-over messages (AI-09 §4)', () => {
  it('has a default in every language for every reason but no_knowledge', () => {
    expect(HANDOFF_MESSAGE_REASONS).not.toContain('no_knowledge');
    expect([...HANDOFF_MESSAGE_REASONS].sort()).toEqual(
      HANDOFF_REASONS.filter((r) => r !== 'no_knowledge').sort(),
    );
    for (const reason of HANDOFF_MESSAGE_REASONS) {
      for (const lang of GUARDRAIL_LANGS) {
        const text = DEFAULT_HANDOFF_MESSAGES[reason][lang];
        expect(text.length).toBeGreaterThan(0);
        expect(text.length).toBeLessThanOrEqual(HANDOFF_MESSAGE_MAX);
      }
    }
  });

  it('says ai_failure without a model, as AI-09 words it', () => {
    expect(DEFAULT_HANDOFF_MESSAGES.ai_failure.tr).toBe('Size bir temsilcimiz yardımcı olacak.');
  });

  it('passes every output guardrail: no default promises a time, an outcome or a check', () => {
    const texts = [
      ...HANDOFF_MESSAGE_REASONS.flatMap((r) =>
        GUARDRAIL_LANGS.map((l) => DEFAULT_HANDOFF_MESSAGES[r][l]),
      ),
      ...GUARDRAIL_LANGS.map((l) => DEFAULT_HANDOFF_AFTER_HOURS_TEXT[l]),
    ];
    for (const text of texts) expect(scanGuardrails(text, 'output'), text).toEqual([]);
  });

  it("says the workspace's message as written, else the default in the reply's language", () => {
    const messages = mergeHandoffMessages(null, { player_request: '  Hemen bağlıyorum.  ' });
    expect(handoffMessage(messages, 'player_request', 'en')).toBe('Hemen bağlıyorum.');
    expect(handoffMessage(messages, 'abuse', 'en')).toBe(DEFAULT_HANDOFF_MESSAGES.abuse.en);
    expect(handoffMessage(messages, 'abuse', 'tr')).toBe(DEFAULT_HANDOFF_MESSAGES.abuse.tr);
  });

  it('stores only what was written; null or blank goes back to the default', () => {
    const first = mergeHandoffMessages(null, { abuse: 'Bir.', max_turns: 'İki.' });
    expect(storedHandoffMessages(first)).toEqual({ abuse: 'Bir.', max_turns: 'İki.' });
    const second = mergeHandoffMessages(storedHandoffMessages(first), {
      abuse: null,
      max_turns: '   ',
    });
    expect(storedHandoffMessages(second)).toEqual({});
  });

  it('ignores stored keys it does not know and values that are not text', () => {
    const read = readHandoffMessages({ no_knowledge: 'x', abuse: 3, ai_failure: 'Tamam.' });
    expect(read.ai_failure).toBe('Tamam.');
    expect(read.abuse).toBeNull();
    expect(read).not.toHaveProperty('no_knowledge');
  });

  it('reads after-hours text, null by default', () => {
    expect(readHandoffAfterHours(null)).toEqual({ text: null });
    expect(readHandoffAfterHours({ text: ' Pazartesi 09:00 itibarıyla döneceğiz. ' })).toEqual({
      text: 'Pazartesi 09:00 itibarıyla döneceğiz.',
    });
  });
});
