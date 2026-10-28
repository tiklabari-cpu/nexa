/**
 * The QA review's vocabulary (tm 319.2 · SiyahTuş analysis AI-24 §3–§7) —
 * the scores a reviewer writes, the model's pre-score, a critical failure's
 * follow-ups, the weekly consistency job and the monthly calibration. Shared
 * by the API (`routes/qa.ts`, `services/qa/*`) and the panel (tm 319.3); the
 * queue's own lists are `qa.ts`.
 */
import type { SuggestionKind } from './ai-suggestions.js';
import { QA_REVIEW_STATUSES, type QaRubricCriterion } from './qa.js';

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/** A criterion's value: `pass` / `fail`, or 1–5; null — does not apply (a hand-over criterion with none). */
export type QaScoreValue = 'pass' | 'fail' | 1 | 2 | 3 | 4 | 5 | null;

/** One criterion as a reviewer scored it (`qa_reviews.scores[key]`). */
export interface QaCriterionScore {
  value: QaScoreValue;
  /**
   * The reviewer looked at this critical criterion on its own and stands by
   * the value (AI-24 §4 "tek tek onaylanmadan kayıt yapılamaz"). Never set
   * from the pre-score: only a person's request writes it.
   */
  confirmed: boolean;
}

export type QaScores = Record<string, QaCriterionScore>;

/** At or under this, a 1–5 criterion counts as failed — a critical one fails the review. */
export const QA_SCORE_FAIL_AT = 2;

/** Whether `value` is one `criterion` can hold (null: not applicable — never for a critical one). */
export function isQaScoreValueFor(
  criterion: Pick<QaRubricCriterion, 'type' | 'critical'>,
  value: unknown,
): value is QaScoreValue {
  if (value === null) return !criterion.critical;
  if (criterion.type === 'pass_fail') return value === 'pass' || value === 'fail';
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Whether `value` fails its criterion: `fail`, or {@link QA_SCORE_FAIL_AT} and under. */
export function qaScoreFails(value: QaScoreValue): boolean {
  if (value === null) return false;
  if (typeof value === 'number') return value <= QA_SCORE_FAIL_AT;
  return value === 'fail';
}

/** A field and what is wrong with it — the `problems` of a 400. */
export interface QaProblem {
  field: string;
  code: 'required' | 'invalid' | 'unconfirmed' | 'contradicts';
}

/**
 * Whether `scores` and `final` complete a review against `rubric`: every
 * criterion has a value it can hold, nothing outside the rubric is scored,
 * every critical criterion is confirmed by the person, and a failed critical
 * criterion makes the review a `fail` (AI-24 §4). Returns what is wrong
 * (empty: nothing), whether a critical criterion failed and every criterion
 * that did. Pure — the review's and the calibration's one rule.
 */
export function qaCompletionProblems(
  rubric: readonly QaRubricCriterion[],
  scores: Readonly<Record<string, Partial<QaCriterionScore> | undefined>>,
  final: unknown,
): { problems: QaProblem[]; criticalFail: boolean; failed: string[] } {
  const problems: QaProblem[] = [];
  const failed: string[] = [];
  let criticalFail = false;
  for (const criterion of rubric) {
    const score = scores[criterion.key];
    if (score === undefined || !('value' in score)) {
      problems.push({ field: `scores.${criterion.key}`, code: 'required' });
      continue;
    }
    if (!isQaScoreValueFor(criterion, score.value)) {
      problems.push({ field: `scores.${criterion.key}.value`, code: 'invalid' });
      continue;
    }
    if (criterion.critical && score.confirmed !== true) {
      problems.push({ field: `scores.${criterion.key}.confirmed`, code: 'unconfirmed' });
    }
    if (qaScoreFails(score.value ?? null)) {
      failed.push(criterion.key);
      if (criterion.critical) criticalFail = true;
    }
  }
  for (const key of Object.keys(scores)) {
    if (!rubric.some((criterion) => criterion.key === key)) {
      problems.push({ field: `scores.${key}`, code: 'invalid' });
    }
  }
  if (final !== 'pass' && final !== 'fail') {
    problems.push({ field: 'final', code: 'required' });
  } else if (criticalFail && final === 'pass') {
    problems.push({ field: 'final', code: 'contradicts' });
  }
  return { problems, criticalFail, failed };
}

/** What a reviewer does with a review they hold (`PUT /qa/reviews/{id}` `action`). */
export const QA_REVIEW_ACTIONS = ['save', 'complete', 'release'] as const;
export type QaReviewAction = (typeof QA_REVIEW_ACTIONS)[number];

/** The list's filters (`GET /qa/reviews` `status`): a status, the open ones, or all. */
export const QA_REVIEW_LIST_STATUSES = [...QA_REVIEW_STATUSES, 'open', 'all'] as const;
export type QaReviewListStatus = (typeof QA_REVIEW_LIST_STATUSES)[number];
export const QA_REVIEW_LIST_LIMIT_DEFAULT = 50;
export const QA_REVIEW_LIST_LIMIT_MAX = 100;

/** The matrix row that reviews the queue (RL-02): a Team Lead their led teams', an admin all. */
export const QA_REVIEW_CAPABILITY = 'ai.qa.review' as const;

/** A hand-sent review's note (`POST /qa/reviews` `note`), kept in `comments` until reviewed. */
export const QA_MANUAL_NOTE_MAX = 1000;

// ---------------------------------------------------------------------------
// The model's pre-score (AI-24 §3, AI-24-S2)
// ---------------------------------------------------------------------------

/** One criterion as the model scored it, with the messages it rests on. */
export interface QaPrescoreCriterion {
  key: string;
  value: QaScoreValue;
  /** Event ids of this connection — any other and the whole pre-score is dropped. */
  evidence_event_ids: string[];
  rationale: string;
}

/** `qa_reviews.prescore`: the model's reading, offered to the reviewer, never a verdict. */
export interface QaPrescore {
  criteria: QaPrescoreCriterion[];
  /** Critical criteria the model thinks failed — where the reviewer looks first. */
  critical_candidates: string[];
  overall: 'pass' | 'fail';
  scored_at: string;
}

/** The rationale of a pre-scored criterion is cut to this. */
export const QA_PRESCORE_RATIONALE_MAX = 500;
/** At most this many evidence ids per criterion. */
export const QA_PRESCORE_EVIDENCE_MAX = 10;
/** Reviews pre-scored per workspace per pass of `qa_prescore`. */
export const QA_PRESCORE_BATCH = 20;

// ---------------------------------------------------------------------------
// A critical failure's follow-ups (AI-24 §4)
// ---------------------------------------------------------------------------

/**
 * The AI-23 suggestion kind a failed criterion opens: the platform's
 * criteria by what they say, a workspace's own `other`.
 */
export const QA_CRITERION_SUGGESTION_KINDS: Readonly<Record<string, SuggestionKind>> = {
  topic: 'wrong_answer',
  required_info: 'missing_info',
  faithfulness: 'wrong_answer',
  guardrails: 'wrong_answer',
  handoff_timing: 'should_have_handed_off',
  handoff_summary: 'other',
  tone: 'tone',
};

export function qaSuggestionKindOf(criterionKey: string): SuggestionKind {
  return QA_CRITERION_SUGGESTION_KINDS[criterionKey] ?? 'other';
}

/**
 * The criterion whose failure is a mandatory hand-over violation: the AI did
 * not hand over when it had to (AI-24 §4, AI-25 `mandatory_handoff_violation`).
 */
export const QA_MANDATORY_HANDOFF_CRITERION = 'handoff_timing';

// ---------------------------------------------------------------------------
// Consistency (AI-24 §6)
// ---------------------------------------------------------------------------

/**
 * The endings the weekly consistency job compares within a group: a
 * connection the AI settled (`resolved`, `resolved_waiting`) against one it
 * handed over. An abandoned connection is the player's doing, not the AI's.
 */
export const QA_CONSISTENCY_ENDINGS = ['settled', 'handed_off'] as const;
/** At most this many pairs a workspace's week puts in the queue. */
export const QA_CONSISTENCY_PAIRS_MAX = 25;

// ---------------------------------------------------------------------------
// Calibration (AI-24 §7)
// ---------------------------------------------------------------------------

/** A lead whose values differ from the round's majority more often than this is an outlier. */
export const QA_CALIBRATION_OUTLIER_PERCENT = 30;
/** How far back a round looks for completed reviews to hand out. */
export const QA_CALIBRATION_LOOKBACK_DAYS = 60;

/** One lead's scores on one conversation of a round. */
export interface QaCalibrationEntry {
  review_id: string;
  reviewer_id: string;
  scores: Readonly<Record<string, Pick<QaCriterionScore, 'value'>>>;
}

export interface QaCalibrationReport {
  /** Per criterion: the share of the leads' values equal to their conversation's majority. */
  criteria: Array<{ key: string; label: string; agreement_percent: number | null; scored: number }>;
  /** Per lead: the share of their values off the majority; `outlier` past {@link QA_CALIBRATION_OUTLIER_PERCENT}. */
  reviewers: Array<{
    reviewer_id: string;
    scored: number;
    deviation_percent: number | null;
    outlier: boolean;
  }>;
}

/** The most common value; a tie goes to the value that sorts first, so the report is stable. */
function majorityOf(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [value, count] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (count > most) {
      best = value;
      most = count;
    }
  }
  return best;
}

function percentOf(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

/**
 * The calibration report (AI-24 §7): for each criterion, the share of the
 * leads' values equal to the majority value on their conversation — 100 when
 * every lead scored every conversation alike —, and for each lead the share
 * of their values off it. A conversation fewer than two leads scored says
 * nothing about agreement and is left out. Values compare exactly (4 is not
 * 5); a not-applicable value is a value. Pure.
 */
export function qaCalibrationReport(
  rubric: readonly Pick<QaRubricCriterion, 'key' | 'label'>[],
  entries: readonly QaCalibrationEntry[],
): QaCalibrationReport {
  const byReview = new Map<string, QaCalibrationEntry[]>();
  for (const entry of entries) {
    const list = byReview.get(entry.review_id) ?? [];
    list.push(entry);
    byReview.set(entry.review_id, list);
  }
  const reviewerTotals = new Map<string, { scored: number; off: number }>();
  const criteria = rubric.map((criterion) => {
    let agreeing = 0;
    let scored = 0;
    for (const list of byReview.values()) {
      const values = list.flatMap((entry) => {
        const score = entry.scores[criterion.key];
        return score === undefined
          ? []
          : [{ reviewer: entry.reviewer_id, value: JSON.stringify(score.value) }];
      });
      if (values.length < 2) continue;
      const majority = majorityOf(values.map((v) => v.value));
      for (const { reviewer, value } of values) {
        const totals = reviewerTotals.get(reviewer) ?? { scored: 0, off: 0 };
        totals.scored += 1;
        scored += 1;
        if (value === majority) agreeing += 1;
        else totals.off += 1;
        reviewerTotals.set(reviewer, totals);
      }
    }
    return {
      key: criterion.key,
      label: criterion.label,
      agreement_percent: percentOf(agreeing, scored),
      scored,
    };
  });
  const reviewers = [...reviewerTotals.entries()]
    .map(([reviewer_id, totals]) => {
      const deviation = percentOf(totals.off, totals.scored);
      return {
        reviewer_id,
        scored: totals.scored,
        deviation_percent: deviation,
        outlier: deviation !== null && deviation > QA_CALIBRATION_OUTLIER_PERCENT,
      };
    })
    .sort((a, b) => (a.reviewer_id < b.reviewer_id ? -1 : 1));
  return { criteria, reviewers };
}
