/**
 * The one zone list every picker in the console offers (FR-MOD-08.3 · M-CO-b).
 *
 * Two screens ask a person to choose a timezone — Settings → Company details
 * and Team → Work schedule — and they must offer the same names, because the
 * second is an *override* of the first (see `CompanyDetails.tsx` for the whole
 * decision). Two lists built independently could drift into offering a zone the
 * other cannot express, which is how a workspace ends up with `Europe/Kiev` in
 * one column and `Europe/Kyiv` in the other and a report that quietly splits
 * them.
 *
 * It is also, deliberately, the client half of the server's `isIanaTimeZone`
 * (`@siyahtus/types/company.ts`): that validator accepts
 * `Intl.supportedValuesOf('timeZone')` plus `UTC` by name, so building the
 * offer from exactly that set means a value picked here can never be refused
 * by the endpoint it is sent to. `UTC` is prepended rather than assumed because
 * the canonical list excludes it on every engine that implements the API — and
 * it is both `organizations.timezone`'s column default and
 * `DEFAULT_WORK_SCHEDULE`'s, so a picker without it could not show what a
 * fresh workspace already holds.
 *
 * The fallback branch is for a runtime with no `supportedValuesOf` at all: a
 * short workable list beats an empty `<select>`, and the field keeps working.
 */
export const IANA_TIMEZONES: readonly string[] = (() => {
  try {
    const zones = Intl.supportedValuesOf('timeZone');
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return ['UTC', 'Europe/Istanbul', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
  }
})();

/**
 * The zone's offset from UTC at `at`, as people say it: `UTC+3`, `UTC-5`,
 * `UTC+5:30`, `UTC+0`. A list of bare IANA names asks the reader to know where
 * `Africa/Dar_es_Salaam` is; the offset is what they actually compare.
 *
 * "At `at`", because a zone with daylight saving has two offsets a year —
 * `America/New_York` is UTC-5 in January and UTC-4 in July. The picker shows
 * today's, which is the one the schedule is about to be read in. Read from the
 * engine (`timeZoneName: 'longOffset'` → `GMT+05:30`), never from a table, so
 * it is right for every zone `IANA_TIMEZONES` can offer. `null` for a name the
 * engine does not know, so a stored legacy value still renders as itself.
 */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string | null {
  let named: string | undefined;
  try {
    named = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
  } catch {
    return null;
  }
  if (!named) return null;
  // `GMT` alone is offset zero; otherwise `GMT±HH:MM`.
  const match = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(named);
  if (!match) return null;
  if (!match[1]) return 'UTC+0';
  const hours = Number(match[2]);
  const minutes = match[3] === '00' ? '' : `:${match[3]}`;
  return `UTC${match[1]}${hours}${minutes}`;
}

/**
 * Labels already built today. A picker renders all ~420 zones on every render,
 * and each label is an `Intl.DateTimeFormat` of its own; keyed by the UTC day
 * so a daylight-saving change is picked up by the next day at the latest.
 */
const labelCache = new Map<string, string>();
let labelCacheDay = '';

/** What a zone picker shows for `zone`: `Europe/Istanbul (UTC+3)`; the bare name when unknown. */
export function timeZoneOptionLabel(zone: string, at?: Date): string {
  // `UTC (UTC+0)` says the same thing twice.
  if (zone === 'UTC') return zone;
  if (at) {
    const offset = utcOffsetLabel(zone, at);
    return offset ? `${zone} (${offset})` : zone;
  }
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (day !== labelCacheDay) {
    labelCache.clear();
    labelCacheDay = day;
  }
  let label = labelCache.get(zone);
  if (label === undefined) {
    label = timeZoneOptionLabel(zone, now);
    labelCache.set(zone, label);
  }
  return label;
}
