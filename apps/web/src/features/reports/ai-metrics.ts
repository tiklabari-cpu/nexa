/**
 * The AI quality metrics' wire shapes and the helpers their screens share
 * (tm 320.3 · SiyahTuş analysis AI-25) — Raporlar › AI Agent's quality panel
 * (`AiMetricsPanel`), the Team Lead's "Metrics" view of Raporlar › AI Kalite
 * and the Playbook's performance cards (`AiPerformance`).
 *
 * The shapes are `paths/reports.yaml`'s (`AiQuality`, `AiQualityBreakdown`,
 * `AiMetricConversations`); the words and tooltips are
 * `AI_METRIC_DEFINITIONS` in `@siyahtus/types` — the same table the API's
 * rollup is documented against — so the panel never words a figure one way
 * and computes it another.
 *
 * These figures are not the billed one. ADR-09a's AI resolution stays the
 * invoice's number and is shown beside them, labelled apart (AI-25-S1).
 */
import {
  AI_METRIC_DEFINITIONS,
  type AiMetricCounts,
  type AiMetricKey,
  type AiMetricsBreakdownDimension,
  type AiMetricsConversationList,
  type AiQualityRates,
  type AiWaitSummary,
} from '@siyahtus/types';
import type { Locale } from '../../lib/i18n.js';

export type AiQualityRatesWire = AiQualityRates & { counts: AiMetricCounts };

export interface AiQualityWire extends AiQualityRatesWire {
  /** What the AI said beside what the player answered (K9). */
  claims: {
    ai_claimed_resolved: number;
    player_confirmed: number;
    player_denied: number;
    claimed_unanswered: number;
  };
  handoff_reasons: Array<{ reason: string; count: number }>;
  handoff_wait: {
    all: AiWaitSummary;
    /** Null with no work schedule saved. */
    in_hours: AiWaitSummary | null;
    out_of_hours: AiWaitSummary | null;
  };
  consistency: number | null;
  /** Newest 50. */
  mandatory_violations: Array<{
    thread_id: string;
    chat_id: string;
    ended_at: string;
    handoff_mandatory_rule: string | null;
  }>;
}

export interface AiQualityBreakdownWire {
  range: { from: string; to: string };
  by: AiMetricsBreakdownDimension;
  total: AiQualityWire;
  rows: Array<{ key: string | null; label: string | null; quality: AiQualityRatesWire }>;
}

export interface AiMetricConversationRow {
  id: string;
  /** The connection (`ids.chat`). */
  thread_id: string;
  /** The day container (`ids.thread`). */
  chat_id: string;
  started_at: string;
  ended_at: string;
  outcome: string | null;
  intent: string | null;
  language: string | null;
  config_version_id: string | null;
  team_id: string | null;
  brand_id: string | null;
  ai_turns: number;
  ai_claimed_resolved: boolean;
  resolution_confirmation: string | null;
  handoff_reason: string | null;
  handoff_mandatory_rule: string | null;
  mandatory_handoff_violation: boolean;
  repeat_same_intent_72h: boolean | null;
  repeat_any_72h: boolean | null;
  qa_result: string | null;
  finalized_at: string | null;
}

export interface AiMetricConversationsWire {
  range: { from: string; to: string };
  metric: AiMetricsConversationList;
  conversations: AiMetricConversationRow[];
  next_cursor: string | null;
}

/**
 * The filters both endpoints take. Set by picking a row of the breakdown
 * ("only this group"), so every value is one the server just returned.
 * `reason` is a grouping, not a filter — the API has no hand-over-reason
 * parameter.
 */
export interface AiMetricsFilters {
  team_id?: string;
  brand_id?: string;
  intent?: string;
  config_version_id?: string;
  language?: string;
}

export type AiMetricsFilterKey = keyof AiMetricsFilters;

/** Which filter a breakdown row of this dimension sets; null for `reason`. */
export function filterKeyOf(by: AiMetricsBreakdownDimension): AiMetricsFilterKey | null {
  switch (by) {
    case 'intent':
      return 'intent';
    case 'version':
      return 'config_version_id';
    case 'language':
      return 'language';
    case 'brand':
      return 'brand_id';
    case 'team':
      return 'team_id';
    case 'reason':
      return null;
  }
}

/** A filter chip remembers the label its row carried (`v12`, a team's name). */
export interface AiMetricsFilterChip {
  key: AiMetricsFilterKey;
  value: string;
  label: string;
}

export function filtersOf(chips: readonly AiMetricsFilterChip[]): AiMetricsFilters {
  const filters: AiMetricsFilters = {};
  for (const chip of chips) filters[chip.key] = chip.value;
  return filters;
}

/** The query string: the range, then the filters in a fixed order, then `extra`. */
export function aiMetricsQuery(
  range: { from: string; to: string },
  filters: AiMetricsFilters,
  extra: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  for (const key of ['team_id', 'brand_id', 'intent', 'config_version_id', 'language'] as const) {
    const value = filters[key];
    if (value !== undefined) params.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) params.set(key, value);
  return params.toString();
}

export const aiMetricsKeys = {
  all: ['reports', 'ai-metrics'] as const,
  breakdown: (rangeKey: string, by: AiMetricsBreakdownDimension, filters: AiMetricsFilters) =>
    ['reports', 'ai-metrics', 'breakdown', rangeKey, by, filters] as const,
  conversations: (rangeKey: string, metric: AiMetricsConversationList, filters: AiMetricsFilters) =>
    ['reports', 'ai-metrics', 'conversations', rangeKey, metric, filters] as const,
};

/** A metric's name in the panel's language. */
export function metricLabel(key: AiMetricKey, locale: Locale): string {
  return AI_METRIC_DEFINITIONS[key].label[locale];
}

/** A metric's tooltip: what the figure counts. */
export function metricHint(key: AiMetricKey, locale: Locale): string {
  return AI_METRIC_DEFINITIONS[key].hint[locale];
}

/**
 * Whether a share misses the workspace's target (only mandatory hand-over
 * compliance has one: 100%). Null — nothing was due — misses nothing.
 */
export function missesTarget(key: AiMetricKey, value: number | null): boolean {
  const target = AI_METRIC_DEFINITIONS[key].target;
  return target !== undefined && value !== null && value < target;
}

/** The hand-over reasons, largest first, with each one's share of the hand-overs. */
export function reasonShares(
  reasons: readonly { reason: string; count: number }[],
): Array<{ reason: string; count: number; share: number }> {
  const total = reasons.reduce((sum, row) => sum + row.count, 0);
  return [...reasons]
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .map((row) => ({ ...row, share: total > 0 ? row.count / total : 0 }));
}

/**
 * The list a KPI opens (`GET /reports/ai-agent/conversations?metric=`), for
 * the metrics that count connections one by one. A rate over judged cards or
 * ratings has no list of its own.
 */
export const METRIC_LIST: Partial<Record<AiMetricKey, AiMetricsConversationList>> = {
  confirmed_resolution: 'confirmed_resolved',
  assumed_resolution: 'assumed_resolved',
  unsettled: 'unsettled',
  false_resolution: 'false_resolution',
  handoff_rate: 'handed_off',
  mandatory_handoff_compliance: 'mandatory_handoff_violation',
  guardrail_violation: 'guardrail_violation',
  guardrail_suspected: 'guardrail_suspected',
  repeat_unmeasured: 'repeat_unmeasured',
};
