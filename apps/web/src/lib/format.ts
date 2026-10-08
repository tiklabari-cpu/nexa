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

/**
 * `0.873` → `"87%"` (English) / `"%87"` (Turkish). Rates arrive as fractions,
 * never as percentages; the sign's side and spacing are the locale's to say.
 */
export function formatRate(
  value: number | null | undefined,
  locale: string | undefined = activeLocale,
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    value,
  );
}

/**
 * `0.25` → `"0.3"` (English) / `"0,3"` (Turkish): at most `fractionDigits`
 * decimals, none when the value is whole. For figures that are not money and
 * not counts — a staffing level of 2.5 agents.
 */
export function formatDecimal(
  value: number | null | undefined,
  fractionDigits = 1,
  locale: string | undefined = activeLocale,
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: fractionDigits }).format(value);
}

/** The four duration units, as each language abbreviates them. */
interface DurationUnits {
  day: string;
  hour: string;
  minute: string;
  second: string;
  /** Between the number and its unit: `"5m"` in English, `"5 dk"` in Turkish. */
  gap: string;
}

/**
 * Unit table rather than `Intl.DurationFormat`. The built-in is engine- and
 * ICU-dependent, and for Turkish its narrow style prints minutes as `"d"`
 * (`"5d 3sn"`), which reads as five days. A table keyed by language says the
 * same thing in every browser. A language with no entry reads in English.
 */
const DURATION_UNITS: Record<string, DurationUnits> = {
  en: { day: 'd', hour: 'h', minute: 'm', second: 's', gap: '' },
  tr: { day: 'g', hour: 'sa', minute: 'dk', second: 'sn', gap: ' ' },
};

function durationUnits(locale: string | undefined): DurationUnits {
  const language = locale?.split('-')[0]?.toLowerCase() ?? 'en';
  return DURATION_UNITS[language] ?? DURATION_UNITS['en']!;
}

/**
 * Seconds → the coarsest unit that still reads precisely.
 *
 * "2m 14s" rather than "134s": an agent comparing response times reasons in
 * minutes, and a raw second count makes them do the division. In Turkish the
 * same figure reads "2 dk 14 sn".
 *
 * `largestUnit: 'hour'` keeps counting hours past a day (`"25h 4m"`), for a
 * visit length where "1d 1h" would read as a different kind of number.
 */
export function formatDuration(
  seconds: number | null | undefined,
  locale: string | undefined = activeLocale,
  largestUnit: 'day' | 'hour' = 'day',
): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;

  const u = durationUnits(locale);
  const part = (n: number, unit: string): string => `${n}${u.gap}${unit}`;
  const pair = (n: number, unit: string, rest: number, restUnit: string): string =>
    rest === 0 ? part(n, unit) : `${part(n, unit)} ${part(rest, restUnit)}`;

  const whole = Math.round(seconds);
  if (whole < 60) return part(whole, u.second);

  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return pair(minutes, u.minute, whole % 60, u.second);

  const hours = Math.floor(minutes / 60);
  if (hours < 24 || largestUnit === 'hour') return pair(hours, u.hour, minutes % 60, u.minute);

  return pair(Math.floor(hours / 24), u.day, hours % 24, u.hour);
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

/** The viewer's own IANA zone — what a day means when the workspace names none. */
export function browserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * How far a zone's wall clock is ahead of UTC at `instant`, in milliseconds
 * (Istanbul: `+3h`). Read back from `Intl` rather than from a table, so the
 * zone's own daylight-saving history decides.
 */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const field = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );
  return wallAsUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant a `YYYY-MM-DD` wall-clock day begins in `timeZone`. */
function zonedDayStart(year: number, month: number, day: number, timeZone: string): number {
  const wall = Date.UTC(year, month - 1, day);
  // The offset is a property of the instant, and the instant is what we are
  // solving for: guess with the offset at the wall time read as UTC, then
  // correct once with the offset at the guess. That lands on the right side of
  // a daylight-saving jump for every real zone.
  const first = wall - zoneOffsetMs(wall, timeZone);
  return wall - zoneOffsetMs(first, timeZone);
}

/**
 * A date input's `YYYY-MM-DD` → the first or last millisecond of that day on
 * the wall clock of `timeZone`, as an ISO instant. The audit log's date filter
 * is a day the person picked on their own calendar: cutting it at UTC midnight
 * puts Istanbul's 00:00–03:00 into the day before. The end is one millisecond
 * short of the next day's start, so a 23- or 25-hour day is still whole.
 * Anything that is not a date comes back as written.
 */
export function zonedDayBoundary(
  day: string,
  edge: 'start' | 'end',
  timeZone: string = browserTimeZone(),
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  try {
    const instant =
      edge === 'start'
        ? zonedDayStart(year, month, date, timeZone)
        : zonedDayStart(year, month, date + 1, timeZone) - 1;
    return new Date(instant).toISOString();
  } catch {
    return day;
  }
}
