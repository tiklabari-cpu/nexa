/**
 * The retention vocabulary, and the one property the whole design rests on:
 * "unlimited" must never be reachable as a number (NFR-C8).
 */
import { describe, expect, it } from 'vitest';
import {
  isRetentionTier,
  RETENTION_TIERS,
  retentionTierWindow,
  retentionWindowDays,
} from './retention.js';

describe('retention tiers (NFR-C8)', () => {
  it('offers exactly the four windows the PRD enumerates', () => {
    // 30/60/365/sınırsız — the PRD's own list, in the order a picker shows it.
    expect([...RETENTION_TIERS]).toEqual(['30d', '60d', '365d', 'unlimited']);
  });

  it('maps each numeric tier to its day count', () => {
    expect(retentionTierWindow('30d')).toBe(30);
    expect(retentionTierWindow('60d')).toBe(60);
    expect(retentionTierWindow('365d')).toBe(365);
  });

  it('never turns "unlimited" into a number — the table-wipe guard', () => {
    // The defect this exists to prevent: "unlimited" encoded as 0 puts the
    // cutoff at "now" and matches every row, so the sweep that was switched
    // OFF deletes everything instead. Asserted on the value, not the type,
    // because a cast would satisfy the type and not this.
    const window = retentionTierWindow('unlimited');

    expect(window).toBe('unlimited');
    expect(typeof window).not.toBe('number');
    expect(retentionWindowDays(window)).toBeNull();
    // Not 0, not Infinity, not NaN — the three encodings that survive
    // arithmetic and would each be a different way of deleting everything or
    // nothing without saying so.
    expect(Number(window)).toBeNaN();
  });

  it('reports the days of a finite window unchanged', () => {
    expect(retentionWindowDays(60)).toBe(60);
    expect(retentionWindowDays(retentionTierWindow('365d'))).toBe(365);
  });

  it('recognises only the four tiers', () => {
    expect(isRetentionTier('30d')).toBe(true);
    expect(isRetentionTier('unlimited')).toBe(true);
    // A day count is not a tier: the column stores the tier, and admitting
    // "30" here would let a caller write a value nothing can read back.
    expect(isRetentionTier('30')).toBe(false);
    expect(isRetentionTier(30)).toBe(false);
    expect(isRetentionTier('0')).toBe(false);
    expect(isRetentionTier(null)).toBe(false);
    expect(isRetentionTier(undefined)).toBe(false);
  });
});
