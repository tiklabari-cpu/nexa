/**
 * AI performance KPIs, derived from the reports the invoice already trusts.
 *
 * The numbers come straight from `/reports/ai-agent` and the overview's
 * satisfaction, so the resolution figure here is the same one ADR-09 bills on —
 * one definition, no second counter to drift from the bill. This module only
 * shapes those figures into cards and decides when a rate rests on too few cases
 * to trust: a 100% resolution rate over three chats is noise, and showing it
 * without a caveat invites a decision the sample cannot support (FR-MOD-06.5).
 */

/** Below this many cases a percentage is noise, not a signal — flag, don't hide. */
export const LOW_BASE_THRESHOLD = 20;

export interface AiAgentReport {
  resolutions: number;
  resolution_rate: number | null;
  transfers: number;
  transfer_rate: number | null;
  skill_runs: number;
  avg_automated_duration_seconds: number | null;
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
      key: 'ai_resolutions',
      label: 'AI chats resolved',
      kind: 'count',
      count: report.resolutions,
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
