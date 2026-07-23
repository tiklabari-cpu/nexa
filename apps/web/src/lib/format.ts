/**
 * Display formatting.
 *
 * Every function here takes `null | undefined` and returns `null` for it, rather
 * than coercing to zero. "No data" and "zero" are different facts, and a
 * dashboard that shows 0% for an unrated period reads as a catastrophe rather
 * than as silence.
 */

/** `142` → `"142"`, with thousands separators. */
export function formatCount(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat().format(value);
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
export function formatMoney(cents: number | null | undefined, currency = 'USD'): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
}

/** ISO timestamp → a short absolute date. */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
