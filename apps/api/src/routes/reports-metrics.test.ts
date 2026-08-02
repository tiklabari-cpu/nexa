import { describe, expect, it } from 'vitest';
import { channelLabel, resolutionRate, round } from './reports-metrics.js';

describe('resolutionRate', () => {
  it('is null, not zero, when nothing closed', () => {
    // An empty window is unknown, not a 0% failure — and it guards the divide.
    expect(resolutionRate(0, 0)).toBeNull();
    expect(resolutionRate(5, 0)).toBeNull();
  });

  it('is the share of closed, rounded to three decimals', () => {
    expect(resolutionRate(1, 3)).toBe(0.333);
    expect(resolutionRate(2, 3)).toBe(0.667);
    expect(resolutionRate(1, 4)).toBe(0.25);
  });

  it('is 0 when the class had no cases but others closed', () => {
    // Distinct from the empty-window null above: here closing happened, this
    // class just accounts for none of it.
    expect(resolutionRate(0, 4)).toBe(0);
  });

  it('is 1 when the class accounts for every closed case', () => {
    expect(resolutionRate(7, 7)).toBe(1);
  });

  it("splits three ways so the parts sum to the whole's rate", () => {
    // manual + assisted + automated = closed, so their rates sum to 1.
    const closed = 8;
    const total =
      (resolutionRate(3, closed) ?? 0) +
      (resolutionRate(2, closed) ?? 0) +
      (resolutionRate(3, closed) ?? 0);
    expect(total).toBe(1);
  });
});

describe('round', () => {
  it('keeps three decimals', () => {
    expect(round(0.12345)).toBe(0.123);
    expect(round(1)).toBe(1);
  });
});

describe('channelLabel', () => {
  it('keeps a known adapter type as its own label', () => {
    expect(channelLabel('messenger')).toBe('messenger');
    expect(channelLabel('twilio')).toBe('twilio');
    expect(channelLabel('whatsapp')).toBe('whatsapp');
  });

  it("falls back to 'website' for null — the native web widget has no adapter type", () => {
    expect(channelLabel(null)).toBe('website');
  });

  it("falls back to 'website' for an unrecognized type", () => {
    expect(channelLabel('carrier-pigeon')).toBe('website');
  });
});
