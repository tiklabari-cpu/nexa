/**
 * The AI quality control (QA) queue's vocabulary (tm 319 · SiyahTuş analysis
 * AI-24) — shared by the `qa_*` CHECKs (`20261117090000_qa_queue`), the
 * sampler (`services/qa/sampler.ts`, the scheduler's `qa_sampling` job), the
 * pre-score and review API (tm 319.2) and the panel (tm 319.3).
 *
 * The unit of review is one connection the AI took part in (panel "Chat ID",
 * code `thread_id`) and the first few human messages after its hand-over —
 * what the hand-over's quality is judged on. Every day, the connections that
 * closed the previous conversation day are sampled: a deterministic random
 * share ({@link QA_SAMPLE_PERCENT_DEFAULT} %, the workspace's 1–20 %) and every
 * connection in a mandatory category ({@link QA_SAMPLER_MANDATORY_REASONS}).
 * A Team Lead scores it against the workspace's rubric, whose two critical
 * criteria are the platform's and cannot be removed or softened.
 */
import type { HandoffReason } from './handoff.js';

// ---------------------------------------------------------------------------
// The rubric
// ---------------------------------------------------------------------------

/** How a criterion is scored: pass / fail, or 1 (poor) to 5 (excellent). */
export const QA_CRITERION_TYPES = ['pass_fail', 'score_1_5'] as const;
export type QaCriterionType = (typeof QA_CRITERION_TYPES)[number];

export function isQaCriterionType(value: unknown): value is QaCriterionType {
  return (QA_CRITERION_TYPES as readonly unknown[]).includes(value);
}

/** One line of a rubric (`qa_rubrics.criteria[]`). */
export interface QaRubricCriterion {
  /** `lower_snake_case`, unique in the rubric. */
  key: string;
  /** What the reviewer reads; a platform criterion's is translated by its key. */
  label: string;
  type: QaCriterionType;
  /** Its share of the overall score, 1–{@link QA_CRITERION_WEIGHT_MAX}. */
  weight: number;
  /** Failing it fails the review, and each one is confirmed on its own (AI-24 §4). */
  critical: boolean;
  /** The platform's: a workspace may not remove it, retype it or make it non-critical. */
  locked: boolean;
}

/**
 * The platform rubric (05 § AI-24 "Tipler"), the version 1 every workspace
 * starts from:
 *
 *   a. `topic`           — the AI understood what the player asked;
 *   b. `required_info`   — it asked for and used the required details;
 *   c. `faithfulness`    — it stayed with its knowledge, made nothing up;
 *   d. `guardrails`      — no compliance rule (AI-08) was broken;
 *   e. `handoff_timing`  — it handed over when it had to, and only then;
 *   f. `handoff_summary` — the hand-over card was complete;
 *   g. `tone`.
 *
 * The keys are the AI-19 judge's (`AI_TEST_JUDGE_CRITERIA`), so a scenario's
 * advice and a conversation's review speak of the same criteria.
 *
 * d and e are critical and locked: a compliance breach or a missed mandatory
 * hand-over fails the review whatever else went well.
 */
export const PLATFORM_QA_RUBRIC: readonly QaRubricCriterion[] = Object.freeze([
  Object.freeze({
    key: 'topic',
    label: 'Understood the topic',
    type: 'pass_fail',
    weight: 2,
    critical: false,
    locked: false,
  }),
  Object.freeze({
    key: 'required_info',
    label: 'Required details collected',
    type: 'pass_fail',
    weight: 2,
    critical: false,
    locked: false,
  }),
  Object.freeze({
    key: 'faithfulness',
    label: 'Faithful to knowledge, nothing made up',
    type: 'pass_fail',
    weight: 3,
    critical: false,
    locked: false,
  }),
  Object.freeze({
    key: 'guardrails',
    label: 'Compliance rules kept',
    type: 'pass_fail',
    weight: 3,
    critical: true,
    locked: true,
  }),
  Object.freeze({
    key: 'handoff_timing',
    label: 'Handed over at the right time',
    type: 'pass_fail',
    weight: 3,
    critical: true,
    locked: true,
  }),
  Object.freeze({
    key: 'handoff_summary',
    label: 'Hand-over summary complete',
    type: 'score_1_5',
    weight: 1,
    critical: false,
    locked: false,
  }),
  Object.freeze({
    key: 'tone',
    label: 'Tone',
    type: 'score_1_5',
    weight: 1,
    critical: false,
    locked: false,
  }),
] as const satisfies readonly QaRubricCriterion[]);

/** The criteria a workspace's rubric must keep exactly as the platform wrote them. */
export const QA_LOCKED_CRITERION_KEYS = ['guardrails', 'handoff_timing'] as const;

/** At most this many criteria in a rubric — one screen of the review pane. */
export const QA_RUBRIC_CRITERIA_MAX = 20;
export const QA_CRITERION_WEIGHT_MAX = 10;
export const QA_CRITERION_LABEL_MAX = 80;
const QA_CRITERION_KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Why `criteria` is not a rubric a workspace may save, or null when it is:
 * an array of 1–{@link QA_RUBRIC_CRITERIA_MAX} well-formed criteria with
 * unique keys, holding every locked platform criterion unchanged (type,
 * critical, locked). A workspace's own criterion is never `locked`. Pure.
 */
export function qaRubricProblem(criteria: unknown): string | null {
  if (!Array.isArray(criteria)) return 'criteria: must be an array.';
  if (criteria.length === 0 || criteria.length > QA_RUBRIC_CRITERIA_MAX) {
    return `criteria: between 1 and ${QA_RUBRIC_CRITERIA_MAX} criteria.`;
  }
  const keys = new Set<string>();
  for (const [index, raw] of criteria.entries()) {
    const at = `criteria[${index}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return `${at}: must be an object.`;
    }
    const c = raw as Record<string, unknown>;
    if (typeof c['key'] !== 'string' || !QA_CRITERION_KEY.test(c['key'])) {
      return `${at}.key: lower_snake_case, at most 40 characters.`;
    }
    if (keys.has(c['key'])) return `${at}.key: "${c['key']}" is used twice.`;
    keys.add(c['key']);
    const label = typeof c['label'] === 'string' ? c['label'].trim() : '';
    if (label.length === 0 || label.length > QA_CRITERION_LABEL_MAX) {
      return `${at}.label: between 1 and ${QA_CRITERION_LABEL_MAX} characters.`;
    }
    if (!isQaCriterionType(c['type'])) return `${at}.type: pass_fail or score_1_5.`;
    const weight = c['weight'];
    if (
      typeof weight !== 'number' ||
      !Number.isInteger(weight) ||
      weight < 1 ||
      weight > QA_CRITERION_WEIGHT_MAX
    ) {
      return `${at}.weight: a whole number from 1 to ${QA_CRITERION_WEIGHT_MAX}.`;
    }
    if (typeof c['critical'] !== 'boolean' || typeof c['locked'] !== 'boolean') {
      return `${at}: critical and locked are true or false.`;
    }
    const platform = PLATFORM_QA_RUBRIC.find((p) => p.key === c['key']);
    if (c['locked'] && !platform?.locked) {
      return `${at}.locked: only the platform's criteria are locked.`;
    }
    if (
      platform?.locked &&
      (c['type'] !== platform.type || c['critical'] !== true || c['locked'] !== true)
    ) {
      return `${at}: "${platform.key}" is the platform's — its type and critical flag cannot change.`;
    }
  }
  for (const key of QA_LOCKED_CRITERION_KEYS) {
    if (!keys.has(key)) return `criteria: "${key}" is the platform's and cannot be removed.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Closed lists — each is a CHECK in the migration.
// ---------------------------------------------------------------------------

/**
 * Why a connection is in the queue (05 § AI-24 "Kodlama mantığı" 2); a
 * connection picked for several carries them all:
 *
 *   - `random`               — the day's deterministic share;
 *   - `risk_flag`            — a risk flag was raised in it (AI-27);
 *   - `low_bsat`             — the player rated the AI's own connection bad;
 *   - `repeat_72h`           — the player came back within 72 hours of an
 *                              earlier AI connection;
 *   - `guardrail_scan`       — a guardrail checked the AI's draft (an output
 *                              hit) or recorded a warning (AI-08);
 *   - `mandatory_handoff`    — a compliance rule made the AI hand over,
 *                              checked that it did so properly;
 *   - `handoff_insufficient` — the agent who took it called the hand-over
 *                              card insufficient (AI-10);
 *   - `consistency`          — the weekly consistency job found its group
 *                              answered differently (tm 319.2);
 *   - `manual`               — a Team Lead sent it from the inbox (tm 319.2).
 */
export const QA_REASONS = [
  'random',
  'risk_flag',
  'low_bsat',
  'repeat_72h',
  'guardrail_scan',
  'mandatory_handoff',
  'handoff_insufficient',
  'consistency',
  'manual',
] as const;
export type QaReason = (typeof QA_REASONS)[number];

export function isQaReason(value: unknown): value is QaReason {
  return (QA_REASONS as readonly unknown[]).includes(value);
}

/**
 * The categories the daily sampler takes at 100 %, whatever the rate — the
 * workspace cannot lower them (AI-24 §2). `consistency` is mandatory too but
 * is the weekly job's to raise, `manual` a person's.
 */
export const QA_SAMPLER_MANDATORY_REASONS = [
  'risk_flag',
  'low_bsat',
  'repeat_72h',
  'guardrail_scan',
  'mandatory_handoff',
  'handoff_insufficient',
] as const satisfies readonly QaReason[];

/**
 * The hand-over reasons that are a compliance rule's (G1–G5, G13, G15 and a
 * stored risk flag): a hand-over with one of them is `mandatory_handoff`.
 * The same set the unresolved-questions list keeps out, without `abuse`.
 */
export const QA_MANDATORY_HANDOFF_REASONS = [
  'guardrail_self_harm',
  'guardrail_minor',
  'guardrail_rg',
  'risk_flag',
  'guardrail_account_security',
  'guardrail_complaint',
] as const satisfies readonly HandoffReason[];

/**
 * Where a review is:
 *
 *   - `pending_prescore` — waiting for the model's pre-score (tm 319.2);
 *   - `ready`            — in the queue, nobody has claimed it;
 *   - `in_review`        — a reviewer claimed it (`assigned_to`);
 *   - `completed`        — scored, with a `final` verdict.
 */
export const QA_REVIEW_STATUSES = ['pending_prescore', 'ready', 'in_review', 'completed'] as const;
export type QaReviewStatus = (typeof QA_REVIEW_STATUSES)[number];

/** The statuses still waiting for a verdict — the queue's open work. */
export const QA_OPEN_REVIEW_STATUSES = [
  'pending_prescore',
  'ready',
  'in_review',
] as const satisfies readonly QaReviewStatus[];

export function isQaReviewStatus(value: unknown): value is QaReviewStatus {
  return (QA_REVIEW_STATUSES as readonly unknown[]).includes(value);
}

/** A completed review's verdict. */
export const QA_FINALS = ['pass', 'fail'] as const;
export type QaFinal = (typeof QA_FINALS)[number];

/** A monthly calibration round: open while the leads score, closed with its report. */
export const QA_CALIBRATION_STATUSES = ['open', 'closed'] as const;
export type QaCalibrationStatus = (typeof QA_CALIBRATION_STATUSES)[number];

/** The conversations every Team Lead scores in a calibration round (AI-24 §7). */
export const QA_CALIBRATION_SIZE = 20;

// ---------------------------------------------------------------------------
// Priority and due date
// ---------------------------------------------------------------------------

/**
 * How pressing a review is (AI-24 §2 "risk > guardrail > diğerleri"), stored
 * as its rank (`qa_reviews.priority`, 0–2) so the queue orders by
 * `priority DESC, due_at`.
 */
export const QA_PRIORITIES = ['normal', 'guardrail', 'risk'] as const;
export type QaPriority = (typeof QA_PRIORITIES)[number];

export const QA_PRIORITY_RANK: Readonly<Record<QaPriority, number>> = Object.freeze({
  normal: 0,
  guardrail: 1,
  risk: 2,
});

/** The priority a set of reasons earns: a risk flag first, then a guardrail's. */
export function qaPriorityOf(reasons: readonly QaReason[]): QaPriority {
  if (reasons.includes('risk_flag')) return 'risk';
  if (reasons.includes('guardrail_scan') || reasons.includes('mandatory_handoff')) {
    return 'guardrail';
  }
  return 'normal';
}

/**
 * When a review is due: a risk-flagged one in {@link QA_RISK_DUE_BUSINESS_DAYS}
 * business days (CGA expects a responsible-gaming complaint answered in five),
 * every other one in {@link QA_DUE_DAYS} days.
 */
export const QA_RISK_DUE_BUSINESS_DAYS = 2;
export const QA_DUE_DAYS = 7;

// ---------------------------------------------------------------------------
// Settings (Ayarlar › AI kalite)
// ---------------------------------------------------------------------------

/** The random share sampled each day, in whole percent (AI-24-S1). */
export const QA_SAMPLE_PERCENT_DEFAULT = 5;
export const QA_SAMPLE_PERCENT_MIN = 1;
export const QA_SAMPLE_PERCENT_MAX = 20;

export function isQaSamplePercent(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= QA_SAMPLE_PERCENT_MIN &&
    value <= QA_SAMPLE_PERCENT_MAX
  );
}

/**
 * The workspace-local hour the previous conversation day is sampled at
 * (AI-24 "her gün, kiracı saat dilimine göre 02:00"); a day that ends later
 * (a day boundary after 02:00) is sampled once it has ended.
 */
export const QA_SAMPLING_LOCAL_HOUR = 2;

/**
 * How many conversation days back the sampler catches up after it could not
 * run (a stopped scheduler): a day not sampled in that window is not sampled.
 */
export const QA_SAMPLING_CATCH_UP_DAYS = 3;

/** "Repeat contact": the player's next connection within this many hours of an AI one. */
export const QA_REPEAT_CONTACT_HOURS = 72;

// ---------------------------------------------------------------------------
// The excerpt kept with a review
// ---------------------------------------------------------------------------

/**
 * One message of the masked excerpt a review keeps (`qa_reviews.excerpt_masked`),
 * so it can be read after the conversation's retention ran out (AI-24
 * "Saklama"). Masked when sampled (AI-26).
 */
export interface QaExcerptMessage {
  event_id: string;
  author_type: 'customer' | 'agent' | 'bot';
  /** The AI's own message (`author_id` `AI_BOT_ID`), not a rule bot's. */
  is_ai: boolean;
  text: string;
  created_at: string;
}

/** The human messages after the hand-over the excerpt still takes (AI-24 §1). */
export const QA_POST_HANDOFF_AGENT_MESSAGES = 3;
/** At most this many messages, from the connection's start. */
export const QA_EXCERPT_MESSAGES_MAX = 60;
/** A message longer than this is cut. */
export const QA_EXCERPT_TEXT_MAX = 2000;
/** A review's free-text comment. */
export const QA_COMMENTS_MAX = 4000;
