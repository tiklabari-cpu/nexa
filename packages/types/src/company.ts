/**
 * Company details (FR-MOD-08.3 · M-CO-a) — "şirket adı/sektör/adres/saat
 * dilimi (fatura/marka/rapor temeli)". One set of facts per organization,
 * read and written through `GET`/`PATCH /settings/company`.
 *
 * `sector` is a closed list rather than free text. Every other classification
 * column this schema has (`organizations.region`, `licenses.billing_cycle`,
 * `licenses.status`, `agent_memberships.role`) is a fixed set enforced by a
 * database CHECK, not a string a caller can spell three different ways — and
 * PRD §8.4 names this triple's purpose as "rapor temeli" (report basis): a
 * report grouping workspaces by sector needs them to agree on the buckets. A
 * closed list costs flexibility a workspace in an odd niche might want, which
 * is what `other` is for, rather than force-fitting `financial_services` or
 * refusing to save at all. `organizations_sector_check` (migration
 * `20260904100324_organization_company_details`) is the same list enforced a
 * second time, at the one layer this module cannot reach.
 */

/** The closed list `sector` accepts. Keep in step with `organizations_sector_check`. */
export const COMPANY_SECTORS = [
  'ecommerce_retail',
  'saas_technology',
  'financial_services',
  'healthcare',
  'travel_hospitality',
  'education',
  'real_estate',
  'telecommunications',
  'media_entertainment',
  'gaming_gambling',
  'nonprofit_government',
  'professional_services',
  'manufacturing_logistics',
  'other',
] as const;

export type CompanySector = (typeof COMPANY_SECTORS)[number];

export function isCompanySector(value: unknown): value is CompanySector {
  return typeof value === 'string' && (COMPANY_SECTORS as readonly string[]).includes(value);
}

/**
 * Free text (FR-MOD-08.3). No closed set fits postal formats across every
 * region this product serves, and MVP collects no separate billing address to
 * reuse a structured one from — a single bounded string is what the screen
 * and the column both hold.
 */
export const COMPANY_ADDRESS_MAX_LENGTH = 500;

/** Mirrors `organizations.timezone`'s column default. */
export const DEFAULT_COMPANY_TIMEZONE = 'UTC';

/**
 * True for any zone name the runtime's own tz database recognises — the same
 * source `Intl.DateTimeFormat` reads a zone against, so a value that passes
 * this can never fail to format later. Unlike `work_schedules.timezone`
 * (`normalizeWorkSchedule`, which accepts any non-empty string), this column
 * is what FR-MOD-08.3 calls a billing/report basis, so a typo like
 * `"Europe/Istambul"` is worth refusing rather than silently storing.
 *
 * `Intl.supportedValuesOf('timeZone')` is the canonical continent/city list —
 * 418 names — but it deliberately excludes `UTC` itself along with every
 * other legacy alias (`GMT`, `PST`, `Etc/UTC`…): those are recognised by
 * `Intl.DateTimeFormat` for compatibility but normalised away from the
 * canonical set. `UTC` is carved back in by name because it is this column's
 * own default (`organizations.timezone`, `DEFAULT_COMPANY_TIMEZONE`) — a
 * validator that rejected the shipped default would refuse a value nobody
 * ever chose. The other legacy spellings stay refused: accepting `PST` and
 * `America/Los_Angeles` as two different values for reports to group by is
 * the exact fragmentation a closed list exists to prevent.
 */
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  if (value === DEFAULT_COMPANY_TIMEZONE) return true;
  try {
    return Intl.supportedValuesOf('timeZone').includes(value);
  } catch {
    return false;
  }
}

/** The `snake_case` shape `GET`/`PATCH /settings/company` both carry. */
export interface CompanyDetails {
  name: string;
  sector: CompanySector | null;
  address: string | null;
  timezone: string;
}
