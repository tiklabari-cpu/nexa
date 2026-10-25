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
  formatDecimal,
  formatDuration,
  formatLanguage,
  formatMoney,
  formatPeriod,
  formatRate,
  formatWeekday,
  setFormatLocale,
  zonedDayBoundary,
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

describe('formatRate — the percent sign follows the language (O17)', () => {
  it('writes English "45%" and Turkish "%45"', () => {
    expect(formatRate(0.45, 'en')).toBe('45%');
    expect(formatRate(0.45, 'tr')).toBe('%45');
    expect(formatRate(0.873, 'tr')).toBe('%87');
  });

  it('follows the active locale, and is null for "no data"', () => {
    setFormatLocale('tr');
    expect(formatRate(0.5)).toBe('%50');
    setFormatLocale('en');
    expect(formatRate(0.5)).toBe('50%');
    expect(formatRate(null)).toBeNull();
    expect(formatRate(Number.NaN)).toBeNull();
  });

  it('keeps 0 as a figure and rounds to whole percent', () => {
    expect(formatRate(0, 'tr')).toBe('%0');
    expect(formatRate(0.004, 'en')).toBe('0%');
    expect(formatRate(1, 'en')).toBe('100%');
  });
});

describe('formatDecimal — the decimal mark follows the language (O17)', () => {
  it('writes "0.2" in English and "0,2" in Turkish', () => {
    expect(formatDecimal(0.2, 1, 'en')).toBe('0.2');
    expect(formatDecimal(0.2, 1, 'tr')).toBe('0,2');
    expect(formatDecimal(2.5, 1, 'tr')).toBe('2,5');
  });

  it('keeps whole numbers whole and caps the fraction', () => {
    expect(formatDecimal(2, 1, 'tr')).toBe('2');
    expect(formatDecimal(2.46, 1, 'en')).toBe('2.5');
    expect(formatDecimal(null)).toBeNull();
  });
});

describe("formatDuration — units are the language's (O17)", () => {
  it('keeps the English shape', () => {
    expect(formatDuration(45, 'en')).toBe('45s');
    expect(formatDuration(303, 'en')).toBe('5m 3s');
    expect(formatDuration(300, 'en')).toBe('5m');
    expect(formatDuration(3840, 'en')).toBe('1h 4m');
    expect(formatDuration(90_000, 'en')).toBe('1d 1h');
  });

  it('writes Turkish units with a space: "5 dk 3 sn"', () => {
    expect(formatDuration(45, 'tr')).toBe('45 sn');
    expect(formatDuration(303, 'tr')).toBe('5 dk 3 sn');
    expect(formatDuration(300, 'tr')).toBe('5 dk');
    expect(formatDuration(3840, 'tr')).toBe('1 sa 4 dk');
    expect(formatDuration(90_000, 'tr')).toBe('1 g 1 sa');
  });

  it('follows the active locale and reads an unknown language in English', () => {
    setFormatLocale('tr-TR');
    expect(formatDuration(303)).toBe('5 dk 3 sn');
    setFormatLocale('de');
    expect(formatDuration(303)).toBe('5m 3s');
  });

  it('can keep counting hours past a day, and is null for "no data"', () => {
    expect(formatDuration(90_240, 'en', 'hour')).toBe('25h 4m');
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});

describe('zonedDayBoundary — a picked day is a day on the workspace clock (O17)', () => {
  it('cuts Istanbul days at local midnight (UTC+3), not at UTC midnight', () => {
    expect(zonedDayBoundary('2026-10-07', 'start', 'Europe/Istanbul')).toBe(
      '2026-10-06T21:00:00.000Z',
    );
    expect(zonedDayBoundary('2026-10-07', 'end', 'Europe/Istanbul')).toBe(
      '2026-10-07T20:59:59.999Z',
    );
  });

  it('puts local 00:30 inside its own day', () => {
    const entry = Date.parse('2026-10-06T21:30:00.000Z'); // 2026-10-07 00:30 in Istanbul
    const from = Date.parse(zonedDayBoundary('2026-10-07', 'start', 'Europe/Istanbul'));
    const to = Date.parse(zonedDayBoundary('2026-10-07', 'end', 'Europe/Istanbul'));
    expect(entry >= from && entry <= to).toBe(true);
  });

  it('leaves UTC alone and handles zones behind UTC', () => {
    expect(zonedDayBoundary('2026-07-01', 'start', 'UTC')).toBe('2026-07-01T00:00:00.000Z');
    expect(zonedDayBoundary('2026-07-15', 'end', 'UTC')).toBe('2026-07-15T23:59:59.999Z');
    expect(zonedDayBoundary('2026-01-10', 'start', 'America/New_York')).toBe(
      '2026-01-10T05:00:00.000Z',
    );
  });

  it('keeps a daylight-saving day whole (23 hours in New York on 2026-03-08)', () => {
    const from = Date.parse(zonedDayBoundary('2026-03-08', 'start', 'America/New_York'));
    const to = Date.parse(zonedDayBoundary('2026-03-08', 'end', 'America/New_York'));
    expect(from).toBe(Date.parse('2026-03-08T05:00:00.000Z'));
    expect(to).toBe(Date.parse('2026-03-09T03:59:59.999Z'));
  });

  it('returns what is not a date as written', () => {
    expect(zonedDayBoundary('soon', 'start', 'UTC')).toBe('soon');
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
