import { describe, expect, it } from 'vitest';
import { AI_TEST_JUDGE_CRITERIA } from './ai-testing.js';
import { HANDOFF_REASONS } from './handoff.js';
import {
  PLATFORM_QA_RUBRIC,
  QA_LOCKED_CRITERION_KEYS,
  QA_MANDATORY_HANDOFF_REASONS,
  QA_OPEN_REVIEW_STATUSES,
  QA_PRIORITY_RANK,
  QA_REASONS,
  QA_REVIEW_STATUSES,
  QA_SAMPLER_MANDATORY_REASONS,
  isQaSamplePercent,
  qaPriorityOf,
  qaRubricProblem,
  type QaRubricCriterion,
} from './qa.js';

const platform = (): QaRubricCriterion[] => PLATFORM_QA_RUBRIC.map((c) => ({ ...c }));

describe('the platform QA rubric (tm 319.1 · AI-24)', () => {
  it('is the seven criteria a–g, with guardrail compliance and hand-over timing critical and locked', () => {
    expect(PLATFORM_QA_RUBRIC.map((c) => c.key)).toEqual([
      'topic',
      'required_info',
      'faithfulness',
      'guardrails',
      'handoff_timing',
      'handoff_summary',
      'tone',
    ]);
    const locked = PLATFORM_QA_RUBRIC.filter((c) => c.locked);
    expect(locked.map((c) => c.key)).toEqual([...QA_LOCKED_CRITERION_KEYS]);
    expect(locked.every((c) => c.critical)).toBe(true);
    expect(PLATFORM_QA_RUBRIC.filter((c) => c.critical)).toEqual(locked);
    expect(qaRubricProblem(PLATFORM_QA_RUBRIC)).toBeNull();
    // The AI-19 judge scores by the same criteria.
    expect(PLATFORM_QA_RUBRIC.map((c) => c.key)).toEqual([...AI_TEST_JUDGE_CRITERIA]);
  });

  it('lets a workspace add, drop and reweigh its own criteria', () => {
    const own = platform().filter((c) => c.key !== 'tone');
    own.push({
      key: 'bonus_terms',
      label: 'Bonus terms right',
      type: 'pass_fail',
      weight: 2,
      critical: true,
      locked: false,
    });
    own[0]!.weight = 5;
    expect(qaRubricProblem(own)).toBeNull();
  });

  it('refuses a rubric that drops or softens a locked criterion, or locks its own', () => {
    expect(qaRubricProblem(platform().filter((c) => c.key !== 'handoff_timing'))).toMatch(
      /handoff_timing.*cannot be removed/,
    );
    const softened = platform();
    softened[3]!.critical = false;
    expect(qaRubricProblem(softened)).toMatch(/guardrails/);
    const retyped = platform();
    retyped[4]!.type = 'score_1_5';
    expect(qaRubricProblem(retyped)).toMatch(/handoff_timing/);
    const ownLock = platform();
    ownLock[6]!.locked = true;
    expect(qaRubricProblem(ownLock)).toMatch(/only the platform/);
  });

  it('refuses malformed criteria', () => {
    expect(qaRubricProblem('x')).toMatch(/array/);
    expect(qaRubricProblem([])).toMatch(/between 1 and 20/);
    const twice = [...platform(), { ...platform()[0]! }];
    expect(qaRubricProblem(twice)).toMatch(/used twice/);
    const bad = (patch: Partial<Record<keyof QaRubricCriterion, unknown>>) =>
      qaRubricProblem([
        ...platform(),
        {
          key: 'extra',
          label: 'Extra',
          type: 'pass_fail',
          weight: 1,
          critical: false,
          locked: false,
          ...patch,
        },
      ]);
    expect(bad({ key: 'Extra Key' })).toMatch(/key/);
    expect(bad({ label: '  ' })).toMatch(/label/);
    expect(bad({ type: 'stars' })).toMatch(/type/);
    expect(bad({ weight: 0 })).toMatch(/weight/);
    expect(bad({ weight: 1.5 })).toMatch(/weight/);
    expect(bad({ critical: 'yes' })).toMatch(/critical/);
  });
});

describe('QA reasons, priority and rate (tm 319.1 · AI-24)', () => {
  it('ranks a risk flag over a guardrail over everything else', () => {
    expect(qaPriorityOf(['random'])).toBe('normal');
    expect(qaPriorityOf(['low_bsat', 'repeat_72h'])).toBe('normal');
    expect(qaPriorityOf(['random', 'guardrail_scan'])).toBe('guardrail');
    expect(qaPriorityOf(['mandatory_handoff'])).toBe('guardrail');
    expect(qaPriorityOf(['guardrail_scan', 'risk_flag'])).toBe('risk');
    expect(QA_PRIORITY_RANK).toEqual({ normal: 0, guardrail: 1, risk: 2 });
  });

  it('keeps the sampler’s mandatory reasons and the compliance hand-overs inside their lists', () => {
    for (const reason of QA_SAMPLER_MANDATORY_REASONS) expect(QA_REASONS).toContain(reason);
    expect(QA_SAMPLER_MANDATORY_REASONS).not.toContain('random');
    for (const reason of QA_MANDATORY_HANDOFF_REASONS) expect(HANDOFF_REASONS).toContain(reason);
  });

  it('counts every status but completed as open', () => {
    expect([...QA_OPEN_REVIEW_STATUSES, 'completed'].sort()).toEqual(
      [...QA_REVIEW_STATUSES].sort(),
    );
  });

  it('accepts a whole percent from 1 to 20 (AI-24-S1)', () => {
    expect([1, 5, 20].every(isQaSamplePercent)).toBe(true);
    expect([0, 21, 2.5, '5', null].some(isQaSamplePercent)).toBe(false);
  });
});
