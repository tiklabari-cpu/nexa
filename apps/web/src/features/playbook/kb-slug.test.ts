import { describe, expect, it } from 'vitest';
import { deriveKbSlug, kbSlugError } from './kb-slug.js';

describe('deriveKbSlug', () => {
  it('lower-cases the title', () => {
    expect(deriveKbSlug('How Do I Reset My Password')).toBe('how-do-i-reset-my-password');
  });

  it('turns whitespace runs into a single hyphen', () => {
    expect(deriveKbSlug('shipping   and    returns')).toBe('shipping-and-returns');
  });

  it('collapses consecutive hyphens', () => {
    expect(deriveKbSlug('billing -- faq')).toBe('billing-faq');
  });

  it('trims leading and trailing hyphens', () => {
    expect(deriveKbSlug('-getting started-')).toBe('getting-started');
  });

  it('never rejects — a title that derives to a reserved word still comes back as text to edit', () => {
    expect(deriveKbSlug('Articles')).toBe('articles');
  });
});

describe('kbSlugError', () => {
  it('rejects an empty slug', () => {
    expect(kbSlugError('')).toMatch(/permanent address/);
    expect(kbSlugError('   ')).toMatch(/permanent address/);
  });

  it('rejects a slug carrying characters outside [a-z0-9-]', () => {
    expect(kbSlugError('Refunds!')).toMatch(/lower-case letters/);
    expect(kbSlugError('café')).toMatch(/lower-case letters/);
  });

  it('rejects every word reserved for a public-KB static route', () => {
    for (const word of ['articles', 'categories', 'sitemap.xml', 'robots.txt']) {
      expect(kbSlugError(word)).not.toBeNull();
    }
  });

  it('accepts a well-formed slug', () => {
    expect(kbSlugError('shipping-and-returns')).toBeNull();
  });
});
