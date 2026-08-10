import { describe, expect, it } from 'vitest';
import { REFERRER_MAX_LENGTH, sanitizeReferrer } from './referrer.js';

describe('sanitizeReferrer', () => {
  it('keeps origin and path', () => {
    expect(sanitizeReferrer('https://shop.test/pricing/plans')).toBe(
      'https://shop.test/pricing/plans',
    );
  });

  it('drops the query string, where the tokens and e-mail addresses live', () => {
    expect(sanitizeReferrer('https://mail.test/inbox?token=abc123&to=robin@example.test')).toBe(
      'https://mail.test/inbox',
    );
  });

  it('drops the fragment too', () => {
    expect(sanitizeReferrer('https://docs.test/guide#reset-token=abc')).toBe(
      'https://docs.test/guide',
    );
  });

  it('reads nothing as nothing, so a direct arrival stays null', () => {
    for (const value of [undefined, null, '', '   ']) {
      expect(sanitizeReferrer(value)).toBeNull();
    }
  });

  it('keeps a non-URL referrer as-is — it has no query string to strip', () => {
    expect(sanitizeReferrer('android-app://com.example.launcher')).toBe(
      'android-app://com.example.launcher',
    );
    expect(sanitizeReferrer('some-opaque-source')).toBe('some-opaque-source');
  });

  it('truncates to the column width rather than failing the write', () => {
    const long = `https://shop.test/${'a'.repeat(4000)}`;
    expect(sanitizeReferrer(long)).toHaveLength(REFERRER_MAX_LENGTH);
  });
});
