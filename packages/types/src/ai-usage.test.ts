import { describe, expect, it } from 'vitest';
import {
  AI_LIVE_METERS,
  AI_USAGE_METERS,
  AI_USAGE_SURFACES,
  aiLiveMeterOf,
  aiUsageMeterFor,
  aiUsageThresholdsReached,
} from './ai-usage.js';

describe('aiUsageMeterFor', () => {
  it('counts a simulation on the test meter and every other surface on the live one', () => {
    for (const surface of AI_USAGE_SURFACES) {
      for (const live of AI_LIVE_METERS) {
        expect(aiUsageMeterFor(live, surface), `${surface} ${live}`).toBe(
          surface === 'simulation' ? `${live}_test` : live,
        );
      }
    }
  });
});

describe('aiUsageThresholdsReached', () => {
  it('reaches 80% and 100% at the exact token, never a token early', () => {
    expect(aiUsageThresholdsReached(159_999, 200_000)).toEqual([]);
    expect(aiUsageThresholdsReached(160_000, 200_000)).toEqual([80]);
    expect(aiUsageThresholdsReached(199_999, 200_000)).toEqual([80]);
    expect(aiUsageThresholdsReached(200_000, 200_000)).toEqual([80, 100]);
    expect(aiUsageThresholdsReached(250_000, 200_000)).toEqual([80, 100]);
  });

  it('reaches nothing against a cap that is not one', () => {
    expect(aiUsageThresholdsReached(10, 0)).toEqual([]);
    expect(aiUsageThresholdsReached(10, Number.NaN)).toEqual([]);
  });
});

describe('aiLiveMeterOf', () => {
  it('names the live meter every meter’s spend belongs to', () => {
    expect(Object.fromEntries(AI_USAGE_METERS.map((m) => [m, aiLiveMeterOf(m)]))).toEqual({
      llm: 'llm',
      embedding: 'embedding',
      llm_test: 'llm',
      embedding_test: 'embedding',
    });
  });
});
