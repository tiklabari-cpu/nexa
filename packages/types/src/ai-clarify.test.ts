import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLARIFY_THRESHOLDS,
  clarifyThresholdsProblem,
  readClarifyThresholds,
} from './ai-clarify.js';

describe('clarify thresholds (AI-05 §4)', () => {
  it('an agent that never set them reads the defaults, 0.70 and 0.40', () => {
    expect(readClarifyThresholds(null)).toEqual({ high: 0.7, low: 0.4 });
    expect(readClarifyThresholds({ tone: 'friendly' })).toEqual(DEFAULT_CLARIFY_THRESHOLDS);
  });

  it('reads a stored pair', () => {
    expect(readClarifyThresholds({ clarifyThresholds: { high: 0.8, low: 0.5 } })).toEqual({
      high: 0.8,
      low: 0.5,
    });
  });

  it.each([
    [{ high: 0.5, low: 0.5 }],
    [{ high: 0.4, low: 0.6 }],
    [{ high: 1.2, low: 0.5 }],
    [{ high: 0.8, low: 0 }],
    [{ high: 0.8, low: '0.5' }],
    [{ high: 0.8 }],
    ['0.8'],
  ])('a malformed or contradictory pair %j reads as the defaults, both of them', (stored) => {
    expect(readClarifyThresholds({ clarifyThresholds: stored })).toEqual(
      DEFAULT_CLARIFY_THRESHOLDS,
    );
  });

  it('names what is wrong with a pair, and nothing for a good one', () => {
    expect(clarifyThresholdsProblem({ high: 0.7, low: 0.4 })).toBeNull();
    expect(clarifyThresholdsProblem({ high: 1, low: 0.05 })).toBeNull();
    expect(clarifyThresholdsProblem({ high: 0.6, low: 0.6 })).toBe('low must be below high');
    expect(clarifyThresholdsProblem({ high: 0, low: 0.4 })).toMatch(/^high/);
    expect(clarifyThresholdsProblem({ high: 0.7, low: Number.NaN })).toMatch(/^low/);
  });
});
