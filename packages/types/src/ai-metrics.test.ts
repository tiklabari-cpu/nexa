import { describe, expect, it } from 'vitest';
import {
  AI_METRIC_COUNT_KEYS,
  AI_METRIC_DEFINITIONS,
  AI_METRIC_KEYS,
  addAiMetricCounts,
  aiConsistency,
  aiMetricCountsOf,
  aiQualityRates,
  aiWaitSummary,
  finalizedOutcome,
  type AiMetricRow,
} from './ai-metrics.js';

const row = (over: Partial<AiMetricRow> = {}): AiMetricRow => ({
  outcome: 'assumed_resolved',
  ai_turns: 2,
  ended: true,
  member_key: 'member',
  human_replied: false,
  handed_over: false,
  handoff_mandatory_rule: null,
  mandatory_handoff_violation: false,
  handoff_card_rating: null,
  agent_reasked: null,
  guardrail_violations_confirmed: 0,
  guardrail_hits: 0,
  bsat: null,
  csat_after_handoff: null,
  clarification_turns: 0,
  required_slots_total: null,
  required_slots_filled: null,
  repeat_same_intent_72h: false,
  repeat_any_72h: false,
  qa_result: null,
  ...over,
});

const handedOff = (over: Partial<AiMetricRow> = {}): AiMetricRow =>
  row({ outcome: 'handed_off', handed_over: true, human_replied: true, ...over });

/**
 * The acceptance fixture: ten connections — three confirmed, four assumed
 * (one came back about the same topic 48 hours later, so the finalize job
 * made it false), three handed over (one by the responsible-gaming rule).
 */
const FIXTURE: AiMetricRow[] = [
  row({ outcome: 'confirmed_resolved' }),
  row({ outcome: 'confirmed_resolved' }),
  row({ outcome: 'confirmed_resolved' }),
  row(),
  row(),
  row(),
  row({ outcome: 'false_resolved', repeat_same_intent_72h: true, repeat_any_72h: true }),
  handedOff({ handoff_mandatory_rule: 'guardrail_rg' }),
  handedOff(),
  handedOff(),
];

describe('the AI quality metrics (tm 320.2 · AI-25)', () => {
  it('the ten-connection fixture: 30% confirmed, 30% assumed, 1/7 false, 30% handed over, 100% compliance', () => {
    const rates = aiQualityRates(aiMetricCountsOf(FIXTURE));
    expect(rates.conversations).toBe(10);
    expect(rates.confirmed_resolution).toBe(0.3);
    expect(rates.assumed_resolution).toBe(0.3);
    expect(rates.false_resolution).toBe(0.1429);
    expect(rates.handoff_rate).toBe(0.3);
    expect(rates.mandatory_handoff_compliance).toBe(1);
    expect(rates.containment).toBe(0.7);
    expect(rates.low_sample).toBe(true);
  });

  it('a mandatory hand-over QA says was missed drops compliance below 100% and the violation is due on its own', () => {
    const counts = aiMetricCountsOf([
      ...FIXTURE,
      row({ outcome: 'assumed_resolved', mandatory_handoff_violation: true }),
    ]);
    expect(counts.mandatory_due).toBe(2);
    expect(counts.mandatory_violations).toBe(1);
    expect(aiQualityRates(counts).mandatory_handoff_compliance).toBe(0.5);
    // A rule that fired but QA says came late is due once, and not compliant.
    const late = aiMetricCountsOf([
      handedOff({ handoff_mandatory_rule: 'guardrail_rg', mandatory_handoff_violation: true }),
    ]);
    expect(late.mandatory_due).toBe(1);
    expect(aiQualityRates(late).mandatory_handoff_compliance).toBe(0);
  });

  it('a pending row is "not settled yet", in N but in neither resolution', () => {
    const rates = aiQualityRates(aiMetricCountsOf([row({ outcome: 'assumed_pending' }), row()]));
    expect(rates.unsettled).toBe(1);
    expect(rates.assumed_resolution).toBe(0.5);
    expect(rates.confirmed_resolution).toBe(0);
  });

  it('a confirmed resolution stays confirmed but is false when the member came back or QA found it unsolved (K9)', () => {
    const rates = aiQualityRates(
      aiMetricCountsOf([
        row({ outcome: 'confirmed_resolved', repeat_same_intent_72h: true }),
        row({ outcome: 'assumed_resolved', qa_result: 'unresolved' }),
        row({ outcome: 'confirmed_resolved', repeat_any_72h: true }),
        row(),
      ]),
    );
    expect(rates.confirmed_resolution).toBe(0.5);
    expect(rates.false_resolution).toBe(0.5);
  });

  it('BSAT counts only the connections the AI handled alone; the person’s CSAT apart', () => {
    const rates = aiQualityRates(
      aiMetricCountsOf([
        row({ bsat: 'good' }),
        row({ bsat: 'bad' }),
        row({ bsat: 'good' }),
        // A rating with a hand-over or a person on the row is never BSAT.
        handedOff({ bsat: 'bad', csat_after_handoff: 'good' }),
        row({ bsat: 'bad', human_replied: true }),
      ]),
    );
    expect(rates.bsat).toBe(0.6667);
    expect(rates.csat_after_handoff).toBe(1);
  });

  it('N is the ended rows with an AI turn; the card, compliance and CSAT read every ended row', () => {
    const counts = aiMetricCountsOf([
      // A compliance hand-over on the first message: no AI turn.
      handedOff({
        ai_turns: 0,
        handoff_mandatory_rule: 'guardrail_self_harm',
        handoff_card_rating: 'insufficient',
        agent_reasked: true,
      }),
      handedOff({ handoff_card_rating: 'sufficient', agent_reasked: false }),
      row({ ended: false }),
      row(),
    ]);
    expect(counts.ended).toBe(3);
    expect(counts.conversations).toBe(2);
    const rates = aiQualityRates(counts);
    expect(rates.handoff_quality).toBe(0.5);
    expect(rates.reask_rate).toBe(0.5);
    expect(rates.mandatory_handoff_compliance).toBe(1);
    expect(rates.handoff_rate).toBe(0.5);
  });

  it('guardrail violations confirmed by QA and the automatic suspicions are two figures', () => {
    const rates = aiQualityRates(
      aiMetricCountsOf([
        row({ guardrail_violations_confirmed: 1, guardrail_hits: 2 }),
        row({ guardrail_hits: 1 }),
        row(),
        row(),
      ]),
    );
    expect(rates.guardrail_violation).toBe(0.25);
    expect(rates.guardrail_suspected).toBe(0.5);
  });

  it('clarification efficiency averages the asking turns where every required detail was collected', () => {
    const rates = aiQualityRates(
      aiMetricCountsOf([
        row({ required_slots_total: 2, required_slots_filled: 2, clarification_turns: 1 }),
        row({ required_slots_total: 3, required_slots_filled: 3, clarification_turns: 2 }),
        row({ required_slots_total: 3, required_slots_filled: 1, clarification_turns: 5 }),
        row(),
      ]),
    );
    expect(rates.clarification_efficiency).toBe(1.5);
  });

  it('a row with no member key falls in the "not measurable" bucket', () => {
    const counts = aiMetricCountsOf([row({ member_key: null, repeat_any_72h: null }), row()]);
    expect(aiQualityRates(counts).repeat_unmeasured).toBe(1);
  });

  it('nothing ended: every rate is null, not 0%', () => {
    const rates = aiQualityRates(aiMetricCountsOf([]));
    expect(rates.confirmed_resolution).toBeNull();
    expect(rates.false_resolution).toBeNull();
    expect(rates.mandatory_handoff_compliance).toBeNull();
    expect(rates.bsat).toBeNull();
  });

  it('counts add up day by day to the window (the rollup)', () => {
    const half = Math.floor(FIXTURE.length / 2);
    expect(
      addAiMetricCounts(
        aiMetricCountsOf(FIXTURE.slice(0, half)),
        aiMetricCountsOf(FIXTURE.slice(half)),
      ),
    ).toEqual(aiMetricCountsOf(FIXTURE));
    expect(Object.keys(aiMetricCountsOf([])).sort()).toEqual([...AI_METRIC_COUNT_KEYS].sort());
  });
});

describe('the finalize decision (AI-25-S3)', () => {
  it('settles a pending row: back about the same topic or unsolved by QA is false, else assumed', () => {
    expect(finalizedOutcome('assumed_pending', true, null)).toBe('false_resolved');
    expect(finalizedOutcome('assumed_pending', false, 'unresolved')).toBe('false_resolved');
    expect(finalizedOutcome('assumed_pending', false, 'fail')).toBe('assumed_resolved');
    // Not measurable (no member): assumed, the bucket says why.
    expect(finalizedOutcome('assumed_pending', null, null)).toBe('assumed_resolved');
  });

  it('every other outcome stays', () => {
    expect(finalizedOutcome('confirmed_resolved', true, 'unresolved')).toBe('confirmed_resolved');
    expect(finalizedOutcome('handed_off', true, null)).toBe('handed_off');
    expect(finalizedOutcome(null, true, null)).toBeNull();
  });
});

describe('consistency and the wait', () => {
  it('consistency is the share of same-topic pairs ended the same way', () => {
    // 3 settled + 1 handed over: 6 pairs, 3 agree.
    expect(aiConsistency([{ settled: 3, handedOff: 1 }])).toBe(0.5);
    expect(
      aiConsistency([
        { settled: 2, handedOff: 0 },
        { settled: 0, handedOff: 2 },
      ]),
    ).toBe(1);
    expect(aiConsistency([{ settled: 1, handedOff: 0 }])).toBeNull();
  });

  it('the wait’s median and p90 interpolate like percentile_cont', () => {
    expect(aiWaitSummary([])).toEqual({ count: 0, median_seconds: null, p90_seconds: null });
    expect(aiWaitSummary([60, 10, 30, 20, 40, 50, 70, 80, 90, 100])).toEqual({
      count: 10,
      median_seconds: 55,
      p90_seconds: 91,
    });
  });

  it('every metric has its words in both languages', () => {
    for (const key of AI_METRIC_KEYS) {
      const definition = AI_METRIC_DEFINITIONS[key];
      expect(definition.label.tr.length).toBeGreaterThan(0);
      expect(definition.label.en.length).toBeGreaterThan(0);
      expect(definition.hint.tr.length).toBeGreaterThan(20);
      expect(definition.hint.en.length).toBeGreaterThan(20);
    }
    expect(AI_METRIC_DEFINITIONS.mandatory_handoff_compliance.target).toBe(1);
  });
});
