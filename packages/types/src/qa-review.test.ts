import { describe, expect, it } from 'vitest';
import { SUGGESTION_KINDS } from './ai-suggestions.js';
import { PLATFORM_QA_RUBRIC, QA_REVIEW_STATUSES } from './qa.js';
import {
  QA_CRITERION_SUGGESTION_KINDS,
  QA_REVIEW_LIST_STATUSES,
  isQaScoreValueFor,
  qaCalibrationReport,
  qaCompletionProblems,
  qaScoreFails,
  qaSuggestionKindOf,
  type QaCriterionScore,
} from './qa-review.js';

/** Every platform criterion passing, the critical ones confirmed. */
function passing(): Record<string, QaCriterionScore> {
  return Object.fromEntries(
    PLATFORM_QA_RUBRIC.map((c) => [
      c.key,
      { value: c.type === 'pass_fail' ? 'pass' : 4, confirmed: c.critical },
    ]),
  ) as Record<string, QaCriterionScore>;
}

describe('a QA review is completed only by a person (tm 319.2 · AI-24 §4)', () => {
  it('completes when every criterion has a value and every critical one is confirmed', () => {
    expect(qaCompletionProblems(PLATFORM_QA_RUBRIC, passing(), 'pass')).toEqual({
      problems: [],
      criticalFail: false,
      failed: [],
    });
  });

  it('refuses a critical criterion that was not confirmed on its own — a pre-filled value is not enough', () => {
    const scores = passing();
    scores['guardrails'] = { value: 'pass', confirmed: false };
    delete (scores['handoff_timing'] as Partial<QaCriterionScore>).confirmed;
    const { problems } = qaCompletionProblems(PLATFORM_QA_RUBRIC, scores, 'pass');
    expect(problems).toEqual([
      { field: 'scores.guardrails.confirmed', code: 'unconfirmed' },
      { field: 'scores.handoff_timing.confirmed', code: 'unconfirmed' },
    ]);
  });

  it('refuses a missing criterion, a value the criterion cannot hold, an unknown key and no verdict', () => {
    const scores: Record<string, Partial<QaCriterionScore>> = passing();
    delete scores['topic'];
    scores['tone'] = { value: 'pass' };
    scores['guardrails'] = { value: null, confirmed: true };
    scores['made_up'] = { value: 'pass' };
    const { problems } = qaCompletionProblems(PLATFORM_QA_RUBRIC, scores, undefined);
    expect(problems).toEqual([
      { field: 'scores.topic', code: 'required' },
      { field: 'scores.guardrails.value', code: 'invalid' },
      { field: 'scores.tone.value', code: 'invalid' },
      { field: 'scores.made_up', code: 'invalid' },
      { field: 'final', code: 'required' },
    ]);
  });

  it('a failed critical criterion fails the review: a "pass" verdict contradicts it', () => {
    const scores = passing();
    scores['handoff_timing'] = { value: 'fail', confirmed: true };
    scores['tone'] = { value: 2, confirmed: false };
    expect(qaCompletionProblems(PLATFORM_QA_RUBRIC, scores, 'pass')).toEqual({
      problems: [{ field: 'final', code: 'contradicts' }],
      criticalFail: true,
      failed: ['handoff_timing', 'tone'],
    });
    expect(qaCompletionProblems(PLATFORM_QA_RUBRIC, scores, 'fail').problems).toEqual([]);
  });

  it('a non-critical criterion may be not applicable; a critical one never', () => {
    const summary = PLATFORM_QA_RUBRIC.find((c) => c.key === 'handoff_summary')!;
    const timing = PLATFORM_QA_RUBRIC.find((c) => c.key === 'handoff_timing')!;
    expect(isQaScoreValueFor(summary, null)).toBe(true);
    expect(isQaScoreValueFor(timing, null)).toBe(false);
    expect(isQaScoreValueFor(summary, 6)).toBe(false);
    expect(isQaScoreValueFor(timing, 3)).toBe(false);
    expect([qaScoreFails(2), qaScoreFails(3), qaScoreFails('fail'), qaScoreFails(null)]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it('lists every status and the two aggregates as filters', () => {
    expect(QA_REVIEW_LIST_STATUSES).toEqual([...QA_REVIEW_STATUSES, 'open', 'all']);
  });
});

describe('a critical failure opens a suggestion of the kind its criterion names (AI-24 §4)', () => {
  it('maps every platform criterion to an AI-23 kind, a workspace criterion to other', () => {
    for (const criterion of PLATFORM_QA_RUBRIC) {
      expect(SUGGESTION_KINDS).toContain(QA_CRITERION_SUGGESTION_KINDS[criterion.key]);
    }
    expect(qaSuggestionKindOf('handoff_timing')).toBe('should_have_handed_off');
    expect(qaSuggestionKindOf('guardrails')).toBe('wrong_answer');
    expect(qaSuggestionKindOf('our_own')).toBe('other');
  });
});

describe('the calibration report (tm 319.2 · AI-24 §7)', () => {
  const rubric = [
    { key: 'topic', label: 'Topic' },
    { key: 'tone', label: 'Tone' },
  ];
  const entry = (review: string, reviewer: string, topic: string, tone: number) => ({
    review_id: review,
    reviewer_id: reviewer,
    scores: { topic: { value: topic as 'pass' }, tone: { value: tone as 1 } },
  });

  it('gives each criterion the share of values that match their conversation’s majority, and flags the lead who strays', () => {
    const report = qaCalibrationReport(rubric, [
      entry('r1', 'a', 'pass', 4),
      entry('r1', 'b', 'pass', 4),
      entry('r1', 'c', 'fail', 2),
      entry('r2', 'a', 'pass', 5),
      entry('r2', 'b', 'pass', 5),
      entry('r2', 'c', 'pass', 3),
    ]);
    // topic: r1 2/3 + r2 3/3 = 5/6; tone: r1 2/3 + r2 2/3 = 4/6.
    expect(report.criteria).toEqual([
      { key: 'topic', label: 'Topic', agreement_percent: 83.3, scored: 6 },
      { key: 'tone', label: 'Tone', agreement_percent: 66.7, scored: 6 },
    ]);
    expect(report.reviewers).toEqual([
      { reviewer_id: 'a', scored: 4, deviation_percent: 0, outlier: false },
      { reviewer_id: 'b', scored: 4, deviation_percent: 0, outlier: false },
      { reviewer_id: 'c', scored: 4, deviation_percent: 75, outlier: true },
    ]);
  });

  it('is 100 when every lead agreed, and says nothing of a conversation one lead scored', () => {
    const report = qaCalibrationReport(rubric, [
      entry('r1', 'a', 'pass', 4),
      entry('r1', 'b', 'pass', 4),
      entry('r2', 'a', 'fail', 1),
    ]);
    expect(report.criteria.map((c) => [c.agreement_percent, c.scored])).toEqual([
      [100, 2],
      [100, 2],
    ]);
    expect(qaCalibrationReport(rubric, []).criteria[0]!.agreement_percent).toBeNull();
  });
});
