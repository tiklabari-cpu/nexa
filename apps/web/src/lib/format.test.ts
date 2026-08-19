/**
 * Locale binding for the Intl-backed formatters (I18N2).
 *
 * The assertions compare separators rather than whole strings where the exact
 * glyphs are ICU-version-dependent (currency symbol placement especially), and
 * lean on the fact that English groups with "," while Turkish groups with "." —
 * a difference stable across every ICU build.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRate,
  formatWeekday,
  setFormatLocale,
} from './format.js';

afterEach(() => {
  // Leave the module-level locale as the tests found it.
  setFormatLocale(undefined);
});

describe('explicit locale argument', () => {
  it('groups thousands the way each locale does', () => {
    expect(formatCount(1234567, 'en')).toBe('1,234,567');
    expect(formatCount(1234567, 'tr')).toBe('1.234.567');
  });

  it('formats a date differently per locale but never to null for a valid ISO', () => {
    const iso = '2026-01-15T10:00:00.000Z';
    const en = formatDate(iso, 'en');
    const tr = formatDate(iso, 'tr');
    expect(en).not.toBeNull();
    expect(tr).not.toBeNull();
    expect(en).not.toBe(tr);
  });

  it('still returns null for absent values regardless of locale', () => {
    expect(formatCount(null, 'tr')).toBeNull();
    expect(formatMoney(undefined, 'USD', 'tr')).toBeNull();
    expect(formatDate('not a date', 'tr')).toBeNull();
  });

  it('formatDateTime includes a time and rejects the same invalid inputs as formatDate', () => {
    const iso = '2026-01-15T10:00:00.000Z';
    expect(formatDateTime(iso, 'en')).not.toBeNull();
    expect(formatDateTime(iso, 'en')).not.toBe(formatDate(iso, 'en'));
    expect(formatDateTime(null, 'en')).toBeNull();
    expect(formatDateTime('not a date', 'en')).toBeNull();
  });

  it('names every weekday from a single reference date, in each locale’s own words', () => {
    expect(formatWeekday('monday', 'en')).toBe('Monday');
    expect(formatWeekday('sunday', 'en')).toBe('Sunday');
    expect(formatWeekday('monday', 'tr')).toBe('Pazartesi');
    expect(formatWeekday('sunday', 'tr')).toBe('Pazar');
  });
});

describe('active locale binding', () => {
  it('follows the locale set via setFormatLocale when no argument is passed', () => {
    setFormatLocale('tr');
    expect(formatCount(1234567)).toBe('1.234.567');

    setFormatLocale('en');
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});

describe('locale-agnostic helpers are unaffected', () => {
  it('formatRate stays a plain percentage', () => {
    expect(formatRate(0.873)).toBe('87%');
    expect(formatRate(null)).toBeNull();
  });
});
