/**
 * Display formatting local to this feature — mirrors `apps/web/src/lib/format.ts`
 * in behaviour, not in code (same reasoning as `features/customers/format.ts`:
 * a web module cannot be imported across the workspace boundary into a Metro
 * bundle, and the phone has no i18n store yet for a shared locale binding to
 * hang off).
 *
 * Every function takes `null | undefined` and returns `null` for it, rather
 * than coercing to zero — "no data" and "zero" are different facts, and a KPI
 * card that reads 0% for an empty window looks like a catastrophe rather than
 * silence (same rule the web formatters follow).
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
 * Seconds → the coarsest unit that still reads precisely, e.g. `"2m 14s"`
 * rather than `"134s"`.
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
