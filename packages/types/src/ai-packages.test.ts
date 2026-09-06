import { describe, expect, it } from 'vitest';
import {
  AI_PACKAGE_MAX_PACKS,
  AI_RESOLUTION_PACK_SIZE,
  aiPackagePriceCents,
  aiPackageResolutions,
  isBuyablePackCount,
} from './ai-packages.js';

describe('AI resolution overage packs (FR-MOD-10.1.4)', () => {
  // PRD §10.1.4 sells AI overage in packs of 50; the meter stamps the same
  // number onto every usage record (`AI_RESOLUTION_OVERAGE_UNIT`).
  it('sells fifty resolutions per pack', () => {
    expect(AI_RESOLUTION_PACK_SIZE).toBe(50);
    expect(aiPackageResolutions(1)).toBe(50);
    expect(aiPackageResolutions(3)).toBe(150);
  });

  it('prices a purchase from the per-resolution rate, not a stored pack price', () => {
    // 50 × $0.50 = $25.00 a pack — the figure the meter already quotes.
    expect(aiPackagePriceCents(1, 50)).toBe(2500);
    expect(aiPackagePriceCents(4, 50)).toBe(10_000);
    // A different configured rate moves the pack price with it; nothing here
    // remembers a price of its own.
    expect(aiPackagePriceCents(1, 75)).toBe(3750);
  });

  it('accepts only a whole number of packs inside the purchase ceiling', () => {
    expect(isBuyablePackCount(1)).toBe(true);
    expect(isBuyablePackCount(AI_PACKAGE_MAX_PACKS)).toBe(true);
    expect(isBuyablePackCount(0)).toBe(false);
    expect(isBuyablePackCount(-1)).toBe(false);
    expect(isBuyablePackCount(AI_PACKAGE_MAX_PACKS + 1)).toBe(false);
    expect(isBuyablePackCount(1.5)).toBe(false);
    expect(isBuyablePackCount('2')).toBe(false);
    expect(isBuyablePackCount(Number.NaN)).toBe(false);
  });

  it('keeps the ceiling small enough that one click cannot bill a fortune', () => {
    // 20 packs × 50 × $0.50 = $500 — the worst a single fat-fingered purchase
    // can cost at the default rate.
    expect(AI_PACKAGE_MAX_PACKS).toBe(20);
    expect(aiPackagePriceCents(AI_PACKAGE_MAX_PACKS, 50)).toBe(50_000);
  });
});
