/**
 * The widget's i18n primitive: locale resolution, lookup, fallback, interpolation.
 *
 * The translator is bound once at mount (the visitor's locale is fixed for the
 * page load), so the interesting behaviour is all in `createTranslator` and
 * `resolveWidgetLocale`. The fallback is the load-bearing part — a missing key
 * must surface the key itself rather than crash, mirroring the panel (I18N1).
 */
import { describe, expect, it } from 'vitest';
import { createTranslator, resolveWidgetLocale } from './i18n.js';

describe('resolveWidgetLocale', () => {
  it('maps Turkish BCP-47 tags to tr and everything else to en', () => {
    expect(resolveWidgetLocale('tr')).toBe('tr');
    expect(resolveWidgetLocale('TR-tr')).toBe('tr');
    expect(resolveWidgetLocale('en')).toBe('en');
    expect(resolveWidgetLocale('en-US')).toBe('en');
    expect(resolveWidgetLocale('de')).toBe('en');
  });

  it('defaults to English for a missing language', () => {
    expect(resolveWidgetLocale(null)).toBe('en');
    expect(resolveWidgetLocale(undefined)).toBe('en');
    expect(resolveWidgetLocale('')).toBe('en');
  });
});

describe('createTranslator', () => {
  it('returns the bound locale’s string', () => {
    expect(createTranslator('en')('send')).toBe('Send');
    expect(createTranslator('tr')('send')).toBe('Gönder');
  });

  it('resolves the locale from a region-tagged language', () => {
    expect(createTranslator('tr-TR')('launcher.text')).toBe('Sohbet');
  });

  it('falls back to the key itself when it exists in no catalogue', () => {
    // Missing-key safety: a typo'd key is visible rather than fatal.
    expect(createTranslator('en')('does.not.exist')).toBe('does.not.exist');
    expect(createTranslator('tr')('does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates named params', () => {
    expect(createTranslator('en')('status.queue', { n: 3 })).toBe('You are number 3 in the queue');
    expect(createTranslator('tr')('status.queue', { n: 2 })).toBe('Sırada 2. sıradasınız');
  });

  it('leaves an unmatched placeholder untouched', () => {
    expect(createTranslator('en')('status.queue')).toBe('You are number {n} in the queue');
  });
});
