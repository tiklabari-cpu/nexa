/**
 * The AI quality control queue's wire shapes and the helpers its screens
 * share (tm 319.3 · SiyahTuş analysis AI-24) — Raporlar › AI Kalite
 * (`QaQueue`, `QaReview`, `QaCalibration`), Ayarlar › AI kalite (`AiQuality`)
 * and the inbox's "QA'ya gönder".
 *
 * The shapes are `paths/qa.yaml`'s; the rules are `@siyahtus/types`
 * (`qaCompletionProblems` — the server runs the same function, so what this
 * screen says is missing is what the API would refuse).
 */
import {
  qaCompletionProblems,
  type QaCriterionScore,
  type QaFinal,
  type QaPriority,
  type QaProblem,
  type QaReason,
  type QaReviewListStatus,
  type QaReviewStatus,
  type QaRubricCriterion,
  type QaScoreValue,
} from '@siyahtus/types';
import type { QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../../lib/api-client.js';

export interface QaExcerptMessage {
  event_id: string;
  author_type: 'customer' | 'agent' | 'bot';
  is_ai: boolean;
  /** Masked when queued; empty when the caller may not read a responsible-gaming conversation. */
  text: string;
  created_at: string;
}

export interface QaReviewRow {
  id: string;
  chat_id: string;
  thread_id: string;
  ai_agent_id: string;
  config_version_id: string | null;
  team_id: number | null;
  brand_id: string | null;
  reasons: QaReason[];
  priority: QaPriority;
  status: QaReviewStatus;
  sample_day: string | null;
  assigned_to: string | null;
  claimed_at: string | null;
  due_at: string;
  overdue: boolean;
  rubric_id: string;
  prescored: boolean;
  final: QaFinal | null;
  critical_fail: boolean;
  reviewer_id: string | null;
  reviewed_at: string | null;
  comments: string | null;
  created_at: string;
  updated_at: string;
}

export interface QaReviewList {
  reviews: QaReviewRow[];
  total: number;
  open_count: number;
}

export interface QaPrescoreCriterion {
  key: string;
  value: QaScoreValue;
  evidence_event_ids: string[];
  rationale: string;
}

export interface QaPrescore {
  criteria: QaPrescoreCriterion[];
  critical_candidates: string[];
  overall: QaFinal;
  scored_at: string;
}

export interface QaTrace {
  decisions: Array<Record<string, unknown>>;
  guardrail_hits: Array<Record<string, unknown>>;
  handoffs: Array<Record<string, unknown>>;
  risk_flags: Array<Record<string, unknown>>;
}

export interface QaReviewDetail extends QaReviewRow {
  rubric: { id: string; version: number | null; criteria: QaRubricCriterion[] };
  prescore: QaPrescore | null;
  scores: Record<string, QaCriterionScore>;
  excerpt: QaExcerptMessage[];
  excerpt_restricted: boolean;
  trace: QaTrace;
  follow_ups: {
    suggestion_id: string | null;
    scenario_id: string | null;
    mandatory_handoff_violation?: boolean;
  };
}

export interface QaSettings {
  sample_percent: number;
  sample_percent_min: number;
  sample_percent_max: number;
  prescore_enabled: boolean;
  conflict_check: boolean;
}

export interface QaRubric {
  id: string;
  version: number;
  criteria: QaRubricCriterion[];
  created_by: string | null;
  created_at: string;
}

export interface QaCalibration {
  id: string;
  period: string;
  rubric_id: string;
  status: 'open' | 'closed';
  reviews: number;
  my_scored: number;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface QaCalibrationItem {
  review_id: string;
  chat_id: string;
  thread_id: string;
  reasons: QaReason[];
  excerpt: QaExcerptMessage[];
  excerpt_restricted: boolean;
  my_scores: Record<string, QaCriterionScore> | null;
  my_final: QaFinal | null;
}

export interface QaCalibrationReport {
  criteria: Array<{ key: string; label: string; agreement_percent: number | null; scored: number }>;
  reviewers: Array<{
    reviewer_id: string;
    scored: number;
    deviation_percent: number | null;
    outlier: boolean;
  }>;
}

export interface QaCalibrationDetail extends QaCalibration {
  rubric: { id: string; version: number | null; criteria: QaRubricCriterion[] };
  items: QaCalibrationItem[];
  report: QaCalibrationReport | null;
}

export interface QaSummary {
  from: string;
  to: string;
  open: number;
  overdue: number;
  completed: number;
  passed: number;
  failed: number;
  critical_failed: number;
  by_reason: Record<string, number>;
  criteria_failed: Record<string, number>;
  mandatory_handoff: { reviewed: number; violations: number };
  guardrail_violations_confirmed: number;
  false_resolutions: number;
}

/** The queue's filters as the list request carries them. */
export interface QaQueueFilter {
  status: QaReviewListStatus;
  reason: QaReason | '';
  mine: boolean;
}

/** One namespace, so a write anywhere refreshes every QA read. */
export const qaKeys = {
  all: ['qa'] as const,
  list: (filter: QaQueueFilter) => ['qa', 'reviews', filter] as const,
  review: (id: string) => ['qa', 'review', id] as const,
  summary: ['qa', 'summary'] as const,
  settings: ['qa', 'settings'] as const,
  rubric: ['qa', 'rubric'] as const,
  calibrations: ['qa', 'calibrations'] as const,
  calibration: (id: string) => ['qa', 'calibration', id] as const,
};

/**
 * After a write that answered with the row: the lists and figures it moves,
 * not the row itself (its answer is already in the cache).
 */
export function refreshQaLists(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['qa', 'reviews'] });
  void queryClient.invalidateQueries({ queryKey: qaKeys.summary });
}

export const QA_PATH = '/app/reports/ai-quality';

export function qaReviewHref(id: string): string {
  return `${QA_PATH}/${encodeURIComponent(id)}`;
}

export function qaListPath(filter: QaQueueFilter): string {
  const params = new URLSearchParams({ status: filter.status });
  if (filter.reason) params.set('reason', filter.reason);
  if (filter.mine) params.set('mine', 'true');
  return `/qa/reviews?${params.toString()}`;
}

/** A platform criterion's label is the catalogue's; a workspace's own is what it wrote. */
export const PLATFORM_CRITERION_KEYS = new Set([
  'topic',
  'required_info',
  'faithfulness',
  'guardrails',
  'handoff_timing',
  'handoff_summary',
  'tone',
]);

export function criterionLabel(
  t: (key: string) => string,
  criterion: Pick<QaRubricCriterion, 'key' | 'label'>,
): string {
  return PLATFORM_CRITERION_KEYS.has(criterion.key)
    ? t(`reports.qa.criterion.${criterion.key}`)
    : criterion.label;
}

// ---------------------------------------------------------------------------
// Scoring drafts — the review pane's and the calibration's
// ---------------------------------------------------------------------------

/** A criterion as the reviewer is scoring it; `value` undefined: not scored yet. */
export interface DraftScore {
  value: QaScoreValue | undefined;
  confirmed: boolean;
}

export type ScoreDraft = Record<string, DraftScore>;

export function draftFromScores(
  rubric: readonly QaRubricCriterion[],
  scores: Readonly<Record<string, QaCriterionScore>> | null,
): ScoreDraft {
  const draft: ScoreDraft = {};
  for (const criterion of rubric) {
    const stored = scores?.[criterion.key];
    draft[criterion.key] = stored
      ? { value: stored.value, confirmed: stored.confirmed === true }
      : { value: undefined, confirmed: false };
  }
  return draft;
}

/**
 * The pre-score's values over what the reviewer has not scored yet — a
 * starting point, never a confirmation: every critical criterion stays
 * unconfirmed until the person ticks it (AI-24 §4).
 */
export function draftWithPrescore(
  rubric: readonly QaRubricCriterion[],
  draft: ScoreDraft,
  prescore: QaPrescore,
): ScoreDraft {
  const next: ScoreDraft = { ...draft };
  for (const criterion of rubric) {
    const current = next[criterion.key];
    if (current && current.value !== undefined) continue;
    const suggested = prescore.criteria.find((row) => row.key === criterion.key);
    if (!suggested) continue;
    if (suggested.value === null && criterion.critical) continue;
    next[criterion.key] = { value: suggested.value, confirmed: false };
  }
  return next;
}

/** The scored criteria as the API takes them; an unscored one is left out. */
export function scoresBody(draft: ScoreDraft): Record<string, QaCriterionScore> {
  const body: Record<string, QaCriterionScore> = {};
  for (const [key, score] of Object.entries(draft)) {
    if (score.value === undefined) continue;
    body[key] = { value: score.value, confirmed: score.confirmed };
  }
  return body;
}

/** What still keeps the draft from completing — `qaCompletionProblems` on it. */
export function draftProblems(
  rubric: readonly QaRubricCriterion[],
  draft: ScoreDraft,
  final: QaFinal | null,
): { problems: QaProblem[]; criticalFail: boolean } {
  const { problems, criticalFail } = qaCompletionProblems(rubric, scoresBody(draft), final);
  return { problems, criticalFail };
}

/** `details.problems` of a refused save, when the server sent them. */
export function serverProblems(error: unknown): Array<{ field: string; code: string }> {
  if (!(error instanceof ApiClientError) || error.type !== 'validation') return [];
  const problems = error.details?.['problems'];
  if (!Array.isArray(problems)) return [];
  return problems.filter(
    (problem): problem is { field: string; code: string } =>
      typeof problem === 'object' &&
      problem !== null &&
      typeof (problem as { field?: unknown }).field === 'string' &&
      typeof (problem as { code?: unknown }).code === 'string',
  );
}

/**
 * The QA-specific sentence for a refusal, when there is one: whose review it
 * is, the conflict check, a conversation still open or one the AI took no
 * part in. Null: the generic `common.errors.*` sentence fits.
 */
export function qaErrorKey(error: unknown): string | null {
  if (!(error instanceof ApiClientError)) return null;
  const reason = error.details?.['reason'];
  if (error.type === 'qa_review_state' && typeof reason === 'string') {
    return QA_STATE_REASONS.has(reason) ? `reports.qa.error.${reason}` : null;
  }
  if (error.type === 'authorization' && typeof reason === 'string') {
    return QA_REFUSAL_REASONS.has(reason) ? `reports.qa.error.${reason}` : null;
  }
  if (error.type === 'validation') {
    const codes = serverProblems(error).map((problem) => `${problem.field}:${problem.code}`);
    if (codes.includes('thread_id:open')) return 'reports.qa.error.thread_open';
    if (codes.includes('thread_id:no_ai')) return 'reports.qa.error.thread_no_ai';
  }
  return null;
}

const QA_STATE_REASONS = new Set([
  'claimed',
  'pending_prescore',
  'completed',
  'not_claimed',
  'calibration_exists',
  'calibration_closed',
]);

const QA_REFUSAL_REASONS = new Set([
  'conflict_of_interest',
  'outside_reach',
  'capability_required',
  'role_required',
]);
