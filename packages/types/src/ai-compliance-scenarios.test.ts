/**
 * The platform's locked compliance pack (tm 314.4 · AI-19 §9, AI-19-S1): what
 * it covers, that every scenario is one the bench can play, that each player
 * line is what its rule is about, that nothing can change it at run time, and
 * that it cannot change without its version.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_COMPLIANCE_GATE_STATES,
  AI_COMPLIANCE_GUARDRAILS,
  AI_COMPLIANCE_LANGS,
  AI_COMPLIANCE_PACK_SIZE,
  AI_COMPLIANCE_PACK_VERSION,
  AI_COMPLIANCE_SCENARIOS,
  complianceScenario,
  complianceScenarioKey,
} from './ai-compliance-scenarios.js';
import {
  AI_TEST_SCENARIO_KEY_PATTERN,
  AI_TEST_SCENARIO_NAME_MAX,
  isComplianceScenarioKey,
  validateAiTestScenario,
} from './ai-testing.js';
import { GUARDRAIL_IDS, platformGuardrail, scanGuardrails } from './guardrails.js';

describe('the compliance pack (tm 314.4)', () => {
  it('covers G1, G2, G3, G5, G7, G11 and G16 in Turkish and English, rule by rule', () => {
    expect([...AI_COMPLIANCE_GUARDRAILS]).toEqual(['G1', 'G2', 'G3', 'G5', 'G7', 'G11', 'G16']);
    for (const id of AI_COMPLIANCE_GUARDRAILS) expect(GUARDRAIL_IDS).toContain(id);
    expect(AI_COMPLIANCE_SCENARIOS.map((scenario) => scenario.key)).toEqual(
      AI_COMPLIANCE_GUARDRAILS.flatMap((id) =>
        AI_COMPLIANCE_LANGS.map((lang) => complianceScenarioKey(id, lang)),
      ),
    );
    expect(AI_COMPLIANCE_SCENARIOS).toHaveLength(AI_COMPLIANCE_PACK_SIZE);
    for (const scenario of AI_COMPLIANCE_SCENARIOS) {
      expect(scenario.key).toBe(complianceScenarioKey(scenario.guardrail, scenario.language));
      expect(scenario.key).toMatch(AI_TEST_SCENARIO_KEY_PATTERN);
      expect(isComplianceScenarioKey(scenario.key)).toBe(true);
      expect(complianceScenario(scenario.key)).toBe(scenario);
    }
    expect(complianceScenario('compliance:G4:tr')).toBeUndefined();
    expect(complianceScenario('2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f')).toBeUndefined();
  });

  it('is a set of scripted scenarios the bench can play, each named by its rule', () => {
    for (const scenario of AI_COMPLIANCE_SCENARIOS) {
      const { outcome, ...rest } = scenario.expectations;
      const asWritten = {
        name: scenario.name,
        mode: 'scripted',
        persona: scenario.persona,
        language: scenario.language,
        turns: [...scenario.turns],
        facts: {},
        tool_outputs: {},
        // Any ending is the pack's own; the rest is a workspace scenario's shape.
        expectations: { ...rest, outcome: outcome ?? 'resolved' },
      };
      expect(validateAiTestScenario(asWritten), scenario.key).toEqual([]);
      expect(scenario.name.startsWith(`${scenario.guardrail} · `)).toBe(true);
      expect(scenario.name.length).toBeLessThanOrEqual(AI_TEST_SCENARIO_NAME_MAX);
    }
  });

  it('hands over on every rule that hands over, and takes any ending only on the output rules', () => {
    const handoff = ['G1', 'G2', 'G3', 'G5', 'G16'];
    for (const scenario of AI_COMPLIANCE_SCENARIOS) {
      const rule = platformGuardrail(scenario.guardrail);
      if (handoff.includes(scenario.guardrail)) {
        expect(rule.action, scenario.key).toBe('force_handoff');
        expect(scenario.expectations.outcome, scenario.key).toBe('handoff');
      } else {
        expect(rule.action, scenario.key).toBe('block_output');
        expect(scenario.expectations.outcome, scenario.key).toBeNull();
      }
      // A rule that raises a flag must have raised it; one of its reason, its reason.
      if (scenario.expectations.must_flags) {
        expect(scenario.expectations.must_flags).toEqual([rule.riskFlag]);
        expect(scenario.expectations.reason_code).toBe(rule.handoffReason);
      }
    }
  });

  it("says, in the player's first line, what its rule is about — the hand-over rules on the lexicon alone", () => {
    for (const scenario of AI_COMPLIANCE_SCENARIOS) {
      const rule = platformGuardrail(scenario.guardrail);
      const hits = scanGuardrails(scenario.turns[0]!, 'input').map((match) => match.rule);
      if (rule.input) {
        // G2's words are evidence the understanding call weighs; the others act on them.
        expect(hits, scenario.key).toContain(scenario.guardrail);
        expect(rule.lexiconAlone, scenario.key).toBe(scenario.guardrail !== 'G2');
      } else {
        // An output rule's player asks for what the AI must not give.
        expect(hits, scenario.key).toEqual([]);
      }
    }
  });

  it('cannot be changed at run time', () => {
    const pack = AI_COMPLIANCE_SCENARIOS as unknown as Array<Record<string, unknown>>;
    expect(() => pack.pop()).toThrow();
    const first = pack[0] as { turns: string[]; expectations: Record<string, unknown> };
    expect(() => first.turns.push('Bonus var mı?')).toThrow();
    expect(() => {
      first.expectations['max_turns'] = 30;
    }).toThrow();
    expect(() => (first.expectations['forbidden_phrases'] as string[]).pop()).toThrow();
    expect(AI_COMPLIANCE_SCENARIOS).toHaveLength(AI_COMPLIANCE_PACK_SIZE);
  });

  it('names the gate’s five states, only one of them open', () => {
    expect([...AI_COMPLIANCE_GATE_STATES]).toEqual([
      'passed',
      'failed',
      'pending',
      'stale',
      'missing',
    ]);
  });

  it('changes its fingerprint only with the version — bump AI_COMPLIANCE_PACK_VERSION with any edit', () => {
    // If this fails after an edit to ai-compliance-scenarios.ts: bump
    // AI_COMPLIANCE_PACK_VERSION, then update both values here. A run records
    // the version it played, and the publish gate opens only on the current
    // one — a silent change would let an old pass stand for the new pack.
    expect({ version: AI_COMPLIANCE_PACK_VERSION, fingerprint: fingerprint() }).toEqual({
      version: '2026-10-21.1',
      fingerprint: 'cb2dffcd',
    });
  });
});

/** FNV-1a over the whole pack. */
function fingerprint(): string {
  const canonical = JSON.stringify(AI_COMPLIANCE_SCENARIOS);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
