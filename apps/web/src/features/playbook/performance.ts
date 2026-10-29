/**
 * AI performance KPIs, derived from the reports the invoice already trusts.
 *
 * The numbers come straight from `/reports/ai-agent` and the overview's
 * satisfaction, so the resolution figure here is the same one ADR-09 bills on —
 * one definition, no second counter to drift from the bill. This module only
 * shapes those figures into cards and decides when a rate rests on too few cases
 * to trust: a 100% resolution rate over three chats is noise, and showing it
 * without a caveat invites a decision the sample cannot support (FR-MOD-06.5).
 *
 * PRD FR-MOD-06.5 names four cards: Resolution rate, AI chats, CSAT,
 * Transferred %. "AI chats" is the volume the two rates are computed over —
 * every chat the AI *finished*, whether it resolved the chat itself or handed
 * it to a human — not `report.resolutions` alone, which is only the resolved
 * subset and undercounts the AI's actual workload.
 *
 * Beside those, four of the AI quality rates (AI-25 · tm 320.3) from the same
 * response's `quality` block: confirmed and false resolution, hand-over
 * quality and mandatory hand-over compliance. They rest on N — the ended
 * conversations the AI wrote in — so the same few-samples caution applies to
 * them over N, not over the billed chats.
 */
import type { AiMetricKey, AiQualityRates } from '@siyahtus/types';

/** Below this many cases a percentage is noise, not a signal — flag, don't hide. */
export const LOW_BASE_THRESHOLD = 20;

export interface AiAgentReport {
  resolutions: number;
  resolution_rate: number | null;
  transfers: number;
  transfer_rate: number | null;
  skill_runs: number;
  avg_automated_duration_seconds: number | null;
  /** The AI quality block (tm 320.2); absent from a response that predates it. */
  quality?: AiQualityRates;
}

export interface SatisfactionSummary {
  score: number | null;
  responses: number;
}

export type PerformanceKpi =
  | { key: string; label: string; kind: 'rate'; rate: number | null; lowBase: boolean }
  | { key: string; label: string; kind: 'count'; count: number };

/**
 * A rate on `base` cases is low-confidence when there are some cases but fewer
 * than the threshold. Zero cases is *unknown*, not low-base — the rate is null
 * and reads as "—", which needs no caveat.
 */
export function isLowBase(base: number): boolean {
  return base > 0 && base < LOW_BASE_THRESHOLD;
}

export function performanceKpis(
  report: AiAgentReport,
  satisfaction: SatisfactionSummary,
): PerformanceKpi[] {
  // The AI "finished" a chat when it resolved it outright or handed it off; that
  // is the base both the resolution and transfer rates rest on.
  const finished = report.resolutions + report.transfers;

  return [
    {
      key: 'resolution_rate',
      label: 'Resolution rate',
      kind: 'rate',
      rate: report.resolution_rate,
      lowBase: isLowBase(finished),
    },
    {
      key: 'ai_chats',
      label: 'AI chats',
      kind: 'count',
      count: finished,
    },
    {
      key: 'csat',
      label: 'CSAT',
      kind: 'rate',
      rate: satisfaction.score,
      lowBase: isLowBase(satisfaction.responses),
    },
    {
      key: 'transfer_rate',
      label: 'Transferred',
      kind: 'rate',
      rate: report.transfer_rate,
      lowBase: isLowBase(finished),
    },
  ];
}

/** The quality rates the performance tab shows, in order. */
export const QUALITY_KPI_KEYS = [
  'confirmed_resolution',
  'false_resolution',
  'handoff_quality',
  'mandatory_handoff_compliance',
] as const satisfies readonly AiMetricKey[];

export interface QualityKpi {
  key: (typeof QUALITY_KPI_KEYS)[number];
  rate: number | null;
  lowBase: boolean;
}

/** The quality cards, each flagged when N is above zero but under the threshold. */
export function qualityKpis(report: AiAgentReport): QualityKpi[] {
  const quality = report.quality;
  if (!quality) return [];
  const lowBase = isLowBase(quality.conversations);
  return QUALITY_KPI_KEYS.map((key) => ({ key, rate: quality[key], lowBase }));
}
