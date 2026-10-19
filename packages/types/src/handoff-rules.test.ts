import { describe, expect, it } from 'vitest';
import { platformGuardrail } from './guardrails.js';
import { HANDOFF_REASON_INFO, isHandoffReason, isLockedHandoffReason } from './handoff.js';
import {
  AI_UNRESOLVED_HANDOFF_REASONS,
  FIRING_HANDOFF_RULE_TRIGGERS,
  HANDOFF_RULE_EXAMPLES,
  HANDOFF_RULE_TOPICS,
  HANDOFF_RULE_TRIGGER_TYPES,
  LOCKED_HANDOFF_RULE_IDS,
  LOCKED_HANDOFF_RULES,
  ROUTING_HANDOFF_RULE_TRIGGERS,
  isLockedHandoffRuleId,
  readHandoffRuleTarget,
  readHandoffRuleTrigger,
} from './handoff-rules.js';

describe('hand-over rules catalogue (AI-09 · K9 · tm 303.3)', () => {
  it('every trigger type either hands over itself or routes, never both', () => {
    const all = [...FIRING_HANDOFF_RULE_TRIGGERS, ...ROUTING_HANDOFF_RULE_TRIGGERS];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...HANDOFF_RULE_TRIGGER_TYPES].sort());
  });

  it("K9's locked rows are G1–G5, G13 and G15, read off the guardrail catalogue", () => {
    expect(LOCKED_HANDOFF_RULES.map((rule) => rule.id)).toEqual([
      'G1',
      'G2',
      'G3',
      'G4',
      'G5',
      'G13',
      'G15',
    ]);
    for (const row of LOCKED_HANDOFF_RULES) {
      const guardrail = platformGuardrail(row.id);
      expect(row.title).toEqual(guardrail.title);
      expect(row.priority).toBe(guardrail.priority);
      expect(row.reason).toBe(guardrail.handoffReason);
      expect(row.target).toEqual(guardrail.target ? { topic: guardrail.target } : null);
      // Each hand-over reason a locked row gives is one no workspace turns off.
      if (row.reason !== null) expect(isLockedHandoffReason(row.reason)).toBe(true);
    }
    // G4 blocks bonus talk; it hands nothing over.
    expect(LOCKED_HANDOFF_RULES.find((row) => row.id === 'G4')?.reason).toBeNull();
  });

  it('a locked id is told apart from a rule id', () => {
    for (const id of LOCKED_HANDOFF_RULE_IDS) expect(isLockedHandoffRuleId(id)).toBe(true);
    expect(isLockedHandoffRuleId('G16')).toBe(false);
    expect(isLockedHandoffRuleId('3f1e0c2a-6a43-4c55-9d7b-0f6f3a3b9a01')).toBe(false);
  });

  it("K9's three ready-made examples read back as the triggers they are", () => {
    expect(HANDOFF_RULE_EXAMPLES.map((example) => example.key)).toEqual([
      'ai_unresolved',
      'account_recovery',
      'deposit',
    ]);
    expect(HANDOFF_RULE_EXAMPLES.map((example) => example.title.tr)).toEqual([
      'AI çözemedi',
      'Hesap ve şifre kurtarma',
      'Para yatırma',
    ]);
    for (const example of HANDOFF_RULE_EXAMPLES) {
      expect(readHandoffRuleTrigger(example.trigger.type, example.trigger.value)).toEqual(
        example.trigger,
      );
    }
  });

  it('"AI could not solve it" is the AI\'s own reasons — no guardrail, no person asked for', () => {
    for (const reason of AI_UNRESOLVED_HANDOFF_REASONS) {
      expect(isHandoffReason(reason)).toBe(true);
      expect(reason.startsWith('guardrail_')).toBe(false);
    }
    expect(AI_UNRESOLVED_HANDOFF_REASONS).not.toContain('player_request');
    expect(AI_UNRESOLVED_HANDOFF_REASONS).not.toContain('tenant_rule');
    // A rule's own hand-over is less severe than every locked compliance reason.
    expect(HANDOFF_REASON_INFO.tenant_rule.rank).toBeGreaterThan(
      HANDOFF_REASON_INFO.guardrail_complaint.rank,
    );
  });

  it('a stored trigger reads as what the API writes, or as none', () => {
    expect(readHandoffRuleTrigger('topic', 'deposit')).toEqual({ type: 'topic', value: 'deposit' });
    expect(readHandoffRuleTrigger('topic', 'trading')).toBeNull();
    expect(readHandoffRuleTrigger('risk_flag', 'fraud_suspected')).toEqual({
      type: 'risk_flag',
      value: 'fraud_suspected',
    });
    expect(readHandoffRuleTrigger('risk_flag', 'nope')).toBeNull();
    expect(readHandoffRuleTrigger('phrase', '  ')).toBeNull();
    expect(readHandoffRuleTrigger('ai_unresolved', 'x')).toEqual({
      type: 'ai_unresolved',
      value: null,
    });
    expect(readHandoffRuleTrigger('teleport', null)).toBeNull();
    expect(HANDOFF_RULE_TOPICS).toContain('account_recovery');
  });

  it('a stored target reads as a team, a topic, or the usual routing', () => {
    expect(readHandoffRuleTarget(7n, null)).toEqual({ group_id: 7 });
    expect(readHandoffRuleTarget(null, 'finance')).toEqual({ topic: 'finance' });
    expect(readHandoffRuleTarget(null, null)).toBeNull();
  });
});
