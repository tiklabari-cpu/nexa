import { describe, expect, it } from 'vitest';
import {
  isLowBase,
  LOW_BASE_THRESHOLD,
  performanceKpis,
  type AiAgentReport,
  type PerformanceKpi,
} from './performance.js';

const report = (over: Partial<AiAgentReport> = {}): AiAgentReport => ({
  resolutions: 0,
  resolution_rate: null,
  transfers: 0,
  transfer_rate: null,
  skill_runs: 0,
  avg_automated_duration_seconds: null,
  ...over,
});

function rate(kpis: PerformanceKpi[], key: string) {
  const kpi = kpis.find((k) => k.key === key);
  if (kpi?.kind !== 'rate') throw new Error(`${key} is not a rate KPI`);
  return kpi;
}

describe('isLowBase', () => {
  it('is true for a non-zero base below the threshold', () => {
    expect(isLowBase(1)).toBe(true);
    expect(isLowBase(LOW_BASE_THRESHOLD - 1)).toBe(true);
  });

  it('is false at or above the threshold', () => {
    expect(isLowBase(LOW_BASE_THRESHOLD)).toBe(false);
    expect(isLowBase(1000)).toBe(false);
  });

  it('is false for zero — that is unknown, not low-base', () => {
    expect(isLowBase(0)).toBe(false);
  });
});

describe('performanceKpis', () => {
  it('warns when the resolution rate rests on too few finished chats', () => {
    const kpis = performanceKpis(
      report({ resolutions: 2, resolution_rate: 1, transfers: 1, transfer_rate: 0.333 }),
      { score: null, responses: 0 },
    );
    // 3 finished chats < 20 → both AI rates are low-base.
    expect(rate(kpis, 'resolution_rate').lowBase).toBe(true);
    expect(rate(kpis, 'transfer_rate').lowBase).toBe(true);
  });

  it('does not warn once the sample is large enough', () => {
    const kpis = performanceKpis(
      report({ resolutions: 40, resolution_rate: 0.8, transfers: 10, transfer_rate: 0.2 }),
      { score: 0.9, responses: 50 },
    );
    expect(rate(kpis, 'resolution_rate').lowBase).toBe(false);
    expect(rate(kpis, 'csat').lowBase).toBe(false);
  });

  it('surfaces the AI resolution count straight from the report (ADR-09 figure)', () => {
    const kpis = performanceKpis(report({ resolutions: 7 }), { score: null, responses: 0 });
    const aiChats = kpis.find((k) => k.key === 'ai_resolutions');
    expect(aiChats?.kind).toBe('count');
    if (aiChats?.kind === 'count') expect(aiChats.count).toBe(7);
  });

  it('judges CSAT low-base by rating responses, independently of chat volume', () => {
    const kpis = performanceKpis(
      report({ resolutions: 100, resolution_rate: 0.9, transfers: 5 }),
      { score: 1, responses: 2 },
    );
    // Plenty of chats, but only 2 ratings — CSAT is the low-base one.
    expect(rate(kpis, 'csat').lowBase).toBe(true);
    expect(rate(kpis, 'resolution_rate').lowBase).toBe(false);
  });

  it('leaves an unknown rate null with no low-base warning', () => {
    const kpis = performanceKpis(report(), { score: null, responses: 0 });
    expect(rate(kpis, 'resolution_rate').rate).toBeNull();
    expect(rate(kpis, 'resolution_rate').lowBase).toBe(false);
  });
});
