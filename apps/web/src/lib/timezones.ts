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
 * (`@nexa/types/company.ts`): that validator accepts
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
