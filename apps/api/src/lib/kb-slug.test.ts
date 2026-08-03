import { describe, expect, it } from 'vitest';
import { normalizeKbSlug } from './kb-slug.js';

describe('normalizeKbSlug', () => {
  it('lower-cases', () => {
    expect(normalizeKbSlug('BILLING')).toBe('billing');
    expect(normalizeKbSlug('How-To-Pay')).toBe('how-to-pay');
  });

  it('turns runs of whitespace into single hyphens', () => {
    expect(normalizeKbSlug('how to pay')).toBe('how-to-pay');
    expect(normalizeKbSlug('a   b\tc')).toBe('a-b-c');
  });

  it('collapses consecutive hyphens', () => {
    expect(normalizeKbSlug('a---b')).toBe('a-b');
    expect(normalizeKbSlug('refund -- policy')).toBe('refund-policy');
  });

  it('trims leading and trailing hyphens', () => {
    expect(normalizeKbSlug('-hello-')).toBe('hello');
    expect(normalizeKbSlug('  spaced  ')).toBe('spaced');
  });

  it('keeps an already-clean slug unchanged', () => {
    expect(normalizeKbSlug('how-to-pay')).toBe('how-to-pay');
    expect(normalizeKbSlug('v2-release-2026')).toBe('v2-release-2026');
  });

  it('rejects an input that normalises to nothing', () => {
    expect(normalizeKbSlug('')).toBeNull();
    expect(normalizeKbSlug('   ')).toBeNull();
    expect(normalizeKbSlug('---')).toBeNull();
  });

  it('rejects a non-ASCII input rather than transliterating it', () => {
    expect(normalizeKbSlug('Ürünler')).toBeNull();
    expect(normalizeKbSlug('café')).toBeNull();
    expect(normalizeKbSlug('naïve-guide')).toBeNull();
    expect(normalizeKbSlug('ürün fiyatları')).toBeNull();
  });

  it('rejects surviving punctuation that is not a hyphen', () => {
    expect(normalizeKbSlug('a.b.c')).toBeNull();
    expect(normalizeKbSlug('under_score')).toBeNull();
    expect(normalizeKbSlug('slash/here')).toBeNull();
  });
});
