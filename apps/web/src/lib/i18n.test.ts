/**
 * The i18n primitive: lookup, fallback, interpolation, and locale detection.
 *
 * `translate` is pure and locale-explicit, so the fallback chain — active locale
 * → English → the key itself — is tested here without a store or React in the
 * way. The fallback is the load-bearing part: a screen half-translated must show
 * English, never a raw `some.key`, and a key that exists nowhere must not throw.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { detectLocale, translate, type Locale } from './i18n.js';

describe('translate', () => {
  it('returns the active locale’s string when it exists', () => {
    expect(translate('en', 'nav.inbox')).toBe('Inbox');
    expect(translate('tr', 'nav.inbox')).toBe('Gelen Kutusu');
  });

  it('falls back to the key itself for a key present in no catalogue', () => {
    // Missing-key safety: the UI shows the (developer-facing) key rather than
    // crashing or rendering "undefined".
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist');
    expect(translate('tr', 'does.not.exist')).toBe('does.not.exist');
  });

  it('falls back to English when a locale lacks a key', () => {
    // Simulate a partially translated locale by asking for a key through a cast
    // to a catalogue that does not carry it; English must answer.
    const partial = 'zz' as unknown as Locale;
    expect(translate(partial, 'nav.reports')).toBe('Reports');
  });

  it('interpolates named params and ignores unused ones', () => {
    expect(translate('en', 'shell.trial.remaining', { days: 3, s: 's' })).toBe(
      '3 days left in your trial.',
    );
    expect(translate('en', 'shell.trial.remaining', { days: 1, s: '' })).toBe(
      '1 day left in your trial.',
    );
    // Turkish has no plural marker, so `s` is simply never referenced.
    expect(translate('tr', 'shell.trial.remaining', { days: 5, s: 's' })).toBe(
      'Deneme sürenizde 5 gün kaldı.',
    );
  });

  it('leaves an unmatched placeholder untouched', () => {
    expect(translate('en', 'shell.trial.remaining', {})).toBe(
      '{days} day{s} left in your trial.',
    );
  });
});

describe('detectLocale', () => {
  afterEach(() => {
    globalThis.localStorage.removeItem('nexa.locale');
  });

  it('honours a remembered choice, coercing the region away', () => {
    globalThis.localStorage.setItem('nexa.locale', 'tr');
    expect(detectLocale()).toBe('tr');
    globalThis.localStorage.setItem('nexa.locale', 'tr-TR');
    expect(detectLocale()).toBe('tr');
  });

  it('falls back to English for an unsupported remembered value', () => {
    globalThis.localStorage.setItem('nexa.locale', 'de');
    expect(detectLocale()).toBe('en');
  });
});
