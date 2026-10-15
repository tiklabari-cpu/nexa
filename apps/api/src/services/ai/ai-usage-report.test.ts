import { describe, expect, it } from 'vitest';
import {
  aiPrices,
  buildUsageReport,
  estimateCostUsd,
  usageWindowDays,
  type AiPrices,
} from './ai-usage-report.js';

const NOW = new Date('2026-10-15T21:30:00Z');
const CAPS = { llm: 200_000, embedding: 2_000_000, llm_test: 40_000, embedding_test: 400_000 };
const PRICED: AiPrices = { llm: { input: 2.5, output: 10 }, embedding: 0.02 };
const UNPRICED: AiPrices = { llm: null, embedding: null };

describe('aiPrices', () => {
  it('prices the LLM only with both halves, and the embedding on its own (AI-16-S3)', () => {
    expect(
      aiPrices({
        AI_PRICE_LLM_INPUT_USD_PER_MTOK: 2.5,
        AI_PRICE_LLM_OUTPUT_USD_PER_MTOK: undefined,
        AI_PRICE_EMBEDDING_USD_PER_MTOK: 0,
      }),
    ).toEqual({ llm: null, embedding: 0 });
    expect(
      aiPrices({
        AI_PRICE_LLM_INPUT_USD_PER_MTOK: 2.5,
        AI_PRICE_LLM_OUTPUT_USD_PER_MTOK: 10,
        AI_PRICE_EMBEDDING_USD_PER_MTOK: undefined,
      }),
    ).toEqual({ llm: { input: 2.5, output: 10 }, embedding: null });
  });
});

describe('estimateCostUsd', () => {
  it('prices input and output separately, a test meter as its live one, to a hundredth of a cent', () => {
    // 1M in × $2.50 + 200k out × $10 = $4.50.
    expect(estimateCostUsd('llm', { input: 1_000_000, output: 200_000 }, PRICED)).toBe(4.5);
    expect(estimateCostUsd('llm_test', { input: 1_000_000, output: 200_000 }, PRICED)).toBe(4.5);
    expect(estimateCostUsd('embedding', { input: 5_000_000, output: 0 }, PRICED)).toBe(0.1);
    expect(estimateCostUsd('llm', { input: 100, output: 10 }, PRICED)).toBe(0.0004);
  });

  it('answers null — unknown, not free — for a meter with no price', () => {
    expect(estimateCostUsd('llm', { input: 1, output: 1 }, UNPRICED)).toBeNull();
    expect(estimateCostUsd('embedding_test', { input: 1, output: 0 }, UNPRICED)).toBeNull();
    expect(
      estimateCostUsd('embedding', { input: 0, output: 0 }, { ...UNPRICED, embedding: 0 }),
    ).toBe(0);
  });
});

describe('usageWindowDays', () => {
  it('is 30 UTC days, oldest first, today last — across a month boundary', () => {
    const days = usageWindowDays(new Date('2026-10-02T23:59:59Z'));
    expect(days).toHaveLength(30);
    expect(days[0]).toBe('20260903');
    expect(days[29]).toBe('20261002');
    // A moment after UTC midnight is the next day, whatever the server's zone.
    expect(usageWindowDays(new Date('2026-10-03T00:00:00Z')).at(-1)).toBe('20261003');
  });
});

describe('buildUsageReport', () => {
  it('reads today off the counter against the cap, and every window day, zeros included', () => {
    const report = buildUsageReport({
      now: NOW,
      caps: CAPS,
      counters: [
        { day: '20261015', meter: 'llm', used: 160_000, reserved: 500 },
        { day: '20261001', meter: 'embedding', used: 1_234, reserved: 0 },
        // Outside the window, and a meter nobody knows: both ignored.
        { day: '20260915', meter: 'llm', used: 9_999, reserved: 0 },
        { day: '20261015', meter: 'mystery', used: 1, reserved: 0 },
      ],
      ledger: [],
      prices: UNPRICED,
    });
    expect(report.day).toBe('2026-10-15');
    expect(report.resets_at).toBe('2026-10-16T00:00:00.000Z');
    expect(report.meters[0]).toEqual({
      meter: 'llm',
      used: 160_000,
      reserved: 500,
      cap: 200_000,
      percent: 80,
    });
    expect(report.meters.map((m) => m.meter)).toEqual([
      'llm',
      'embedding',
      'llm_test',
      'embedding_test',
    ]);
    expect(report.daily).toHaveLength(30);
    expect(report.daily[0]!.day).toBe('2026-09-16');
    expect(report.daily.find((d) => d.day === '2026-10-01')!.embedding).toBe(1_234);
    expect(report.daily.reduce((s, d) => s + d.llm + d.embedding, 0)).toBe(161_234);
    expect(report).not.toHaveProperty('pricing');
  });

  it('says a share past 100% as it is, to one decimal', () => {
    const report = buildUsageReport({
      now: NOW,
      caps: { ...CAPS, llm: 3 },
      counters: [{ day: '20261015', meter: 'llm', used: 5, reserved: 0 }],
      ledger: [],
      prices: UNPRICED,
    });
    expect(report.meters[0]!.percent).toBe(166.7);
  });

  it('breaks the window down per feature and meter, largest first, and prices only what has a price', () => {
    const report = buildUsageReport({
      now: NOW,
      caps: CAPS,
      counters: [],
      ledger: [
        { day: '20261015', surface: 'ai_agent', meter: 'llm', input: 100, output: 10 },
        { day: '20261014', surface: 'ai_agent', meter: 'llm', input: 900, output: 90 },
        {
          day: '20261015',
          surface: 'knowledge_index',
          meter: 'embedding',
          input: 50_000,
          output: 0,
        },
        { day: '20261015', surface: 'simulation', meter: 'llm_test', input: 10, output: 5 },
        { day: '20260901', surface: 'copilot', meter: 'llm', input: 1e9, output: 0 },
      ],
      prices: { llm: { input: 2.5, output: 10 }, embedding: null },
    });
    expect(report.surfaces).toEqual([
      { surface: 'knowledge_index', meter: 'embedding', input_tokens: 50_000, output_tokens: 0 },
      {
        surface: 'ai_agent',
        meter: 'llm',
        input_tokens: 1_000,
        output_tokens: 100,
        cost_usd: 0.0035,
      },
      {
        surface: 'simulation',
        meter: 'llm_test',
        input_tokens: 10,
        output_tokens: 5,
        cost_usd: 0.0001,
      },
    ]);
    // Today's cost per meter is today's ledger only.
    expect(report.meters.find((m) => m.meter === 'llm')!.cost_usd).toBe(0.0004);
    expect(report.meters.find((m) => m.meter === 'embedding')).not.toHaveProperty('cost_usd');
    expect(report.pricing).toEqual({
      currency: 'USD',
      estimated: true,
      llm_input_usd_per_mtok: 2.5,
      llm_output_usd_per_mtok: 10,
    });
  });
});
