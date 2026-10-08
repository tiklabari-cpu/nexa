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
  countryFlag,
  formatCount,
  formatDate,
  formatDateTime,
  formatDay,
  formatLanguage,
  formatMoney,
  formatPeriod,
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

  it('abbreviates the weekday when asked for the short style, for a compact row header', () => {
    expect(formatWeekday('monday', 'en', 'short')).toBe('Mon');
    expect(formatWeekday('sunday', 'en', 'short')).toBe('Sun');
    expect(formatWeekday('monday', 'tr', 'short')).toBe('Pzt');
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

describe('countryFlag (FR-MOD-03.2.3)', () => {
  it('builds the regional-indicator flag from an upper-case code', () => {
    expect(countryFlag('US')).toBe('🇺🇸');
    expect(countryFlag('DE')).toBe('🇩🇪');
  });

  it('upper-cases a lower-case code before building the flag', () => {
    expect(countryFlag('us')).toBe(countryFlag('US'));
  });

  it('returns null for anything that is not exactly two letters', () => {
    expect(countryFlag(null)).toBeNull();
    expect(countryFlag(undefined)).toBeNull();
    expect(countryFlag('')).toBeNull();
    expect(countryFlag('USA')).toBeNull();
    expect(countryFlag('1A')).toBeNull();
  });
});

describe('formatPeriod — "202610" is a month, not a number (D21)', () => {
  it('names the month in the active language', () => {
    expect(formatPeriod('202610', 'en')).toBe('October 2026');
    expect(formatPeriod('202610', 'tr')).toBe('Ekim 2026');
    expect(formatPeriod('202601', 'en')).toBe('January 2026');
  });

  it('returns anything that is not a real YYYYMM as written', () => {
    expect(formatPeriod('202613', 'en')).toBe('202613');
    expect(formatPeriod('October', 'en')).toBe('October');
    expect(formatPeriod(null)).toBeNull();
  });
});

describe('formatDay — a report bucket day keeps its day (D13)', () => {
  it('formats the UTC day in the active language', () => {
    expect(formatDay('2026-10-07', 'en')).toBe('Oct 7, 2026');
    expect(formatDay('2026-10-07', 'tr')).toBe('7 Eki 2026');
  });

  it('returns a non-day as written', () => {
    expect(formatDay('soon', 'en')).toBe('soon');
    expect(formatDay(undefined)).toBeNull();
  });
});

describe('formatLanguage — a language code is a name (O8)', () => {
  it('writes the name in the active language', () => {
    expect(formatLanguage('en', 'en')).toBe('English');
    expect(formatLanguage('tr', 'en')).toBe('Turkish');
    expect(formatLanguage('en', 'tr')).toBe('İngilizce');
  });

  it('keeps a code it cannot parse, upper-cased', () => {
    expect(formatLanguage('en_GB', 'en')).toBe('EN_GB');
    expect(formatLanguage('', 'en')).toBeNull();
  });
});
