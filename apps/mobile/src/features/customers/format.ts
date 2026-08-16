/**
 * Display formatting local to this feature — mirrors `apps/web/src/lib/format.ts`
 * in behaviour, not in code: a web module cannot be imported across the
 * workspace boundary into a Metro bundle, and the phone has no i18n store yet
 * (`13.7-j` scope) for a shared locale binding to hang off.
 */

/** ISO timestamp → a short absolute date, or `null` for "no data" (never "0"). */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
