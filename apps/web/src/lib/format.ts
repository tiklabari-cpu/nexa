/**
 * Display formatting.
 *
 * Every function here takes `null | undefined` and returns `null` for it, rather
 * than coercing to zero. "No data" and "zero" are different facts, and a
 * dashboard that shows 0% for an unrated period reads as a catastrophe rather
 * than as silence.
 *
 * The Intl-backed helpers format against the active UI locale (I18N2). The
 * locale is held module-level and updated by the i18n store rather than threaded
 * through every call site, so a `formatDate(iso)` in a component simply follows
 * whatever language the agent chose. Passing an explicit locale still works and
 * is what the unit tests do, since a default argument is read at call time.
 */

/**
 * The locale the Intl helpers format against when a call does not name one.
 * `undefined` means "the runtime's default", which is the state in a bare unit
 * test that never touched i18n — so importing this module in isolation behaves
 * exactly as it did before the locale binding existed.
 */
let activeLocale: string | undefined;

/** Point the Intl helpers at a locale. Called by the i18n store on every change. */
export function setFormatLocale(locale: string | undefined): void {
  activeLocale = locale;
}

/** `142` → `"142"`, with thousands separators. */
export function formatCount(
  value: number | null | undefined,
  locale: string | undefined = activeLocale,
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(locale).format(value);
}

/** `0.873` → `"87%"`. Rates arrive as fractions, never as percentages. */
export function formatRate(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

/**
 * Seconds → the coarsest unit that still reads precisely.
 *
 * "2m 14s" rather than "134s": an agent comparing response times reasons in
 * minutes, and a raw second count makes them do the division.
 */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;

  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;

  const minutes = Math.floor(whole / 60);
  if (minutes < 60) {
    const remainder = whole % 60;
    return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours < 24) {
    return remainderMinutes === 0 ? `${hours}h` : `${hours}h ${remainderMinutes}m`;
  }

  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours === 0 ? `${days}d` : `${days}d ${remainderHours}h`;
}

/** Cents → `"$99.00"`. Money is stored in cents; never format a float. */
export function formatMoney(
  cents: number | null | undefined,
  currency = 'USD',
  locale: string | undefined = activeLocale,
): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

/**
 * ISO 3166-1 alpha-2 code → its flag emoji, via the Unicode regional indicator
 * symbols (each letter maps to `U+1F1E6..U+1F1FF`, offset from `A`). `null` for
 * anything that is not exactly two letters, so a caller can fall back to
 * showing no flag rather than a mangled one.
 *
 * Purely decorative — some platforms render the two-letter code instead of a
 * flag glyph, and a flag alone says nothing to a screen reader either way.
 * Pair it with the country's name as real text (FR-MOD-03.2.3); never use this
 * as the accessible name on its own.
 */
export function countryFlag(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  const points = [...code.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65);
  return String.fromCodePoint(...points);
}

/** ISO timestamp → a short absolute date. */
export function formatDate(
  iso: string | null | undefined,
  locale: string | undefined = activeLocale,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

/** ISO timestamp → a short absolute date and time. For logs, where the day alone is ambiguous. */
export function formatDateTime(
  iso: string | null | undefined,
  locale: string | undefined = activeLocale,
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

/** A weekday key, in `WorkScheduleDay`'s own spelling — Monday first. */
export type Weekday =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/**
 * `Weekday` → its offset from Monday, so the name can be read off a single
 * known Monday (2024-01-01, UTC) rather than hard-coding seven strings per
 * locale — the day name becomes whatever `Intl` says that weekday is called.
 */
const WEEKDAY_OFFSET: Record<Weekday, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/**
 * `'monday'` → `"Monday"` (or `"Pazartesi"` in Turkish) — the long weekday name.
 * `style: 'short'` gives the abbreviated form (`"Mon"` / `"Pzt"`), for a
 * compact row header (the Staffing grid) rather than prose.
 */
export function formatWeekday(
  day: Weekday,
  locale: string | undefined = activeLocale,
  style: 'long' | 'short' = 'long',
): string {
  const reference = new Date(Date.UTC(2024, 0, 1 + WEEKDAY_OFFSET[day]));
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(reference);
}

/**
 * A language code → its name, written in the active UI language: `"en"` →
 * `"English"` / `"İngilizce"`. A code the runtime cannot name (or a malformed
 * one) comes back upper-cased as written, so a stored value is never hidden.
 */
export function formatLanguage(
  code: string | null | undefined,
  locale: string | undefined = activeLocale,
): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(locale, { type: 'language' }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/**
 * A billing period `"202610"` → `"October 2026"` in the active UI language.
 * Anything that is not six digits with a real month is returned as written.
 * Formatted in UTC: a period is a calendar month, not an instant, so the
 * viewer's time zone must not move it into the month before.
 */
export function formatPeriod(
  period: string | null | undefined,
  locale: string | undefined = activeLocale,
): string | null {
  if (!period) return null;
  const match = /^(\d{4})(0[1-9]|1[0-2])$/.exec(period);
  if (!match) return period;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * A calendar day `"2026-10-07"` (the reports' UTC day buckets) → a short date
 * in the active UI language. Formatted in UTC for the same reason as
 * {@link formatPeriod}: the day is a label, not a moment. Not a `YYYY-MM-DD`
 * → returned as written.
 */
export function formatDay(
  day: string | null | undefined,
  locale: string | undefined = activeLocale,
): string | null {
  if (!day) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
