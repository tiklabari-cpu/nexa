import { describe, expect, it } from 'vitest';
import { IGAMING_PLATFORMS } from './igaming-platforms.js';

describe('iGaming platform catalogue (KN-06 F1, K15)', () => {
  it('lists one or two platforms, every one still coming soon', () => {
    expect(IGAMING_PLATFORMS.length).toBeGreaterThanOrEqual(1);
    expect(IGAMING_PLATFORMS.length).toBeLessThanOrEqual(2);
    for (const platform of IGAMING_PLATFORMS) {
      expect(platform.status).toBe('coming_soon');
    }
  });

  it('has unique lowercase slugs and a non-empty brand name', () => {
    const vendors = IGAMING_PLATFORMS.map((p) => p.vendor);
    expect(new Set(vendors).size).toBe(vendors.length);
    for (const platform of IGAMING_PLATFORMS) {
      expect(platform.vendor).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(platform.name.trim().length).toBeGreaterThan(0);
    }
  });
});
