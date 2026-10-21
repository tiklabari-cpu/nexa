import { describe, expect, it } from 'vitest';
import {
  AI_TEST_FACTS_MAX,
  AI_TEST_LIST_MAX,
  AI_TEST_MAX_TURNS_DEFAULT,
  AI_TEST_MAX_TURNS_LIMIT,
  AI_TEST_SCENARIO_KEY_PATTERN,
  AI_TEST_SCENARIO_NAME_MAX,
  AI_TEST_SCENARIO_TURNS_MAX,
  AI_TEST_TURN_TEXT_MAX,
  SCENARIO_PERSONAS,
  defaultAiTestExpectations,
  isAiTestMoment,
  isComplianceScenarioKey,
  validateAiTestExpectations,
  validateAiTestScenario,
  type AiTestProblem,
} from './ai-testing.js';

const codes = (problems: AiTestProblem[]) => problems.map((p) => `${p.field}:${p.code}`);

/** 05 § AI-19's acceptance scenario, as the editor would save it. */
const papara = {
  name: 'Papara yatırım geçmedi',
  mode: 'scripted',
  persona: 'normal',
  language: 'tr',
  simulated_now: '2026-10-18T13:52:00+03:00',
  turns: [
    'Yatırımım hesaba geçmedi',
    'Papara ile yatırdım',
    '13:42 civarı, talep de oluşturdum',
    'Dekontu ekledim',
  ],
  facts: { yontem: 'Papara', tutar: 2500, talep_olusturuldu: true },
  tool_outputs: { deposit_lookup: { status: 'pending' } },
  expectations: {
    outcome: 'handoff',
    topic: 'finance',
    reason_code: 'deposit_delayed',
    required_slots: ['method', 'deposit_time', 'site_request', 'receipt'],
    forbidden_phrases: ['5 dakikaya yatar'],
    must_not_flags: ['rg_signal'],
    max_turns: 6,
  },
};

describe('AI test scenarios (AI-19 · tm 314.1)', () => {
  it('accepts the Papara scenario as written', () => {
    expect(validateAiTestScenario(papara)).toEqual([]);
  });

  it('a script has at least one player message; a simulated player has a goal instead', () => {
    expect(codes(validateAiTestScenario({ ...papara, turns: [] }))).toEqual(['turns:required']);
    const simulated = { ...papara, mode: 'simulated', persona: 'sabirsiz', turns: [] };
    expect(codes(validateAiTestScenario(simulated))).toEqual(['goal:required']);
    expect(
      validateAiTestScenario({ ...simulated, goal: 'Yatırımının neden geçmediğini öğrenmek' }),
    ).toEqual([]);
  });

  it('bounds the name, the turns and the facts', () => {
    expect(
      codes(validateAiTestScenario({ ...papara, name: 'a'.repeat(AI_TEST_SCENARIO_NAME_MAX + 1) })),
    ).toEqual(['name:too_long']);
    expect(codes(validateAiTestScenario({ ...papara, name: '   ' }))).toEqual(['name:required']);
    const many = Array.from({ length: AI_TEST_SCENARIO_TURNS_MAX + 1 }, () => 'merhaba');
    expect(codes(validateAiTestScenario({ ...papara, turns: many }))).toEqual(['turns:too_many']);
    expect(
      codes(
        validateAiTestScenario({
          ...papara,
          turns: ['ok', 'x'.repeat(AI_TEST_TURN_TEXT_MAX + 1), ''],
        }),
      ),
    ).toEqual(['turns[1]:too_long', 'turns[2]:required']);
    const facts = Object.fromEntries(
      Array.from({ length: AI_TEST_FACTS_MAX + 1 }, (_, i) => [`f${i}`, i]),
    );
    expect(codes(validateAiTestScenario({ ...papara, facts }))).toEqual(['facts:too_many']);
    expect(
      codes(validateAiTestScenario({ ...papara, facts: { tutar: Number.NaN, nesne: { a: 1 } } })),
    ).toEqual(['facts.tutar:invalid', 'facts.nesne:invalid']);
  });

  it('closed lists: mode, persona, language; a tool output is an object under a tool key', () => {
    expect(SCENARIO_PERSONAS).toContain('sorumlu_oyun_sinyali');
    expect(
      codes(
        validateAiTestScenario({
          ...papara,
          mode: 'live',
          persona: 'angry',
          language: 'TR',
          tool_outputs: { 'Deposit-Lookup': {}, deposit_lookup: 'credited' },
        }),
      ),
    ).toEqual([
      'mode:invalid',
      'persona:invalid',
      'language:invalid',
      'tool_outputs.Deposit-Lookup:invalid',
      'tool_outputs.deposit_lookup:invalid',
    ]);
  });

  it('the frozen clock starts from a moment with its offset', () => {
    expect(isAiTestMoment('2026-10-18T13:42:00+03:00')).toBe(true);
    expect(isAiTestMoment('2026-10-18T10:42:00.123Z')).toBe(true);
    expect(isAiTestMoment('2026-10-18T13:42:00')).toBe(false);
    expect(isAiTestMoment('2026-13-45T13:42:00Z')).toBe(false);
    expect(codes(validateAiTestScenario({ ...papara, simulated_now: '18.10.2026 13:42' }))).toEqual(
      ['simulated_now:invalid'],
    );
    expect(validateAiTestScenario({ ...papara, simulated_now: null })).toEqual([]);
  });
});

describe('AI test expectations (AI-19 · tm 314.1)', () => {
  it('outcome and max_turns are required; a new scenario starts from the defaults', () => {
    expect(codes(validateAiTestExpectations({}))).toEqual([
      'expectations.outcome:required',
      'expectations.max_turns:required',
    ]);
    expect(defaultAiTestExpectations()).toEqual({
      outcome: 'resolved',
      max_turns: AI_TEST_MAX_TURNS_DEFAULT,
    });
    expect(validateAiTestExpectations(defaultAiTestExpectations())).toEqual([]);
    expect(
      codes(
        validateAiTestExpectations({ outcome: 'resolved', max_turns: AI_TEST_MAX_TURNS_LIMIT + 1 }),
      ),
    ).toEqual(['expectations.max_turns:out_of_range']);
  });

  it("a hand-over's team, topic and reason belong to a hand-over only", () => {
    expect(
      codes(
        validateAiTestExpectations({
          outcome: 'resolved_waiting',
          max_turns: 4,
          team_id: 3,
          topic: 'finance',
          reason_code: 'deposit_delayed',
        }),
      ),
    ).toEqual([
      'expectations.team_id:not_allowed',
      'expectations.topic:not_allowed',
      'expectations.reason_code:not_allowed',
    ]);
    expect(
      codes(
        validateAiTestExpectations({
          outcome: 'handoff',
          max_turns: 4,
          team_id: 0,
          topic: 'sales',
        }),
      ),
    ).toEqual(['expectations.team_id:invalid', 'expectations.topic:invalid']);
  });

  it('flags are AI-27 types, never both required and forbidden; unknown keys are refused', () => {
    expect(
      codes(
        validateAiTestExpectations({
          outcome: 'handoff',
          max_turns: 4,
          must_flags: ['self_exclusion_request', 'vip'],
          must_not_flags: ['self_exclusion_request'],
          judge: true,
        }),
      ),
    ).toEqual([
      'expectations.judge:not_allowed',
      'expectations.must_flags[1]:invalid',
      'expectations.must_not_flags:invalid',
    ]);
    const long = Array.from({ length: AI_TEST_LIST_MAX + 1 }, (_, i) => `slot_${i}`);
    expect(
      codes(
        validateAiTestExpectations({ outcome: 'resolved', max_turns: 4, required_slots: long }),
      ),
    ).toEqual(['expectations.required_slots:too_many']);
  });
});

describe('result keys (AI-19-S1 · tm 314.1)', () => {
  it("a compliance scenario's key names its guardrail and language; a workspace scenario's is its id", () => {
    expect(AI_TEST_SCENARIO_KEY_PATTERN.test('compliance:G3:tr')).toBe(true);
    expect(AI_TEST_SCENARIO_KEY_PATTERN.test('compliance:G16:en')).toBe(true);
    expect(AI_TEST_SCENARIO_KEY_PATTERN.test('compliance:G20:en')).toBe(false);
    expect(AI_TEST_SCENARIO_KEY_PATTERN.test('0b6c2f0e-6d2a-4c47-9a83-0c4f5d7e9a11')).toBe(true);
    expect(AI_TEST_SCENARIO_KEY_PATTERN.test('papara')).toBe(false);
    expect(isComplianceScenarioKey('compliance:G1:tr')).toBe(true);
    expect(isComplianceScenarioKey('0b6c2f0e-6d2a-4c47-9a83-0c4f5d7e9a11')).toBe(false);
  });
});
