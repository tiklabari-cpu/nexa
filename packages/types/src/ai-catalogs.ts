/**
 * What the root panel's AI pages say (tm 389.19 · FR-ADMIN-23 ·
 * docs/platform-admin/design.md §C ai-catalogs, §B2) — the vocabulary the
 * platform API, the tenant API and the admin SPA share.
 *
 * Three things live here:
 *
 *   - the **crisis-text drafts** (AI-08-S1): per country, an English and a
 *     Turkish text the platform suggests for the responsible-gaming
 *     hand-over. They are stored under `platform_settings.ai.crisis_text_drafts`
 *     and are only ever a suggestion — a workspace reads one as "use the
 *     platform's draft", edits it and approves it itself; nothing is published
 *     on its behalf. {@link pickCrisisTextDraft} is the tenant API's side;
 *   - which **country** a workspace is in, as far as the platform can tell
 *     ({@link countryOfTimezone}): the workspace records an IANA zone, not a
 *     country, so the table below maps the zones of the markets the product
 *     serves and anything else has no draft;
 *   - the **QA rubric** the judge scores by (AI-24 a–g), with a version so the
 *     catalogue page can show which one a deployment runs.
 *
 * Literals and pure functions only: the widget loader imports this package's
 * barrel, and a top-level call would keep the module in its bundle.
 */
import type { AiTestJudgeCriterion } from './ai-testing.js';

/** A draft is plain text — no HTML, no markup — and this long at most (the tenant's own limit). */
export const PLATFORM_CRISIS_TEXT_MAX = 1000;

/** The languages a draft is written in, per country. */
export const CRISIS_DRAFT_LANGS = ['en', 'tr'] as const;
export type CrisisDraftLang = (typeof CRISIS_DRAFT_LANGS)[number];

/** An ISO 3166-1 alpha-2 code, upper case. */
export const CRISIS_DRAFT_COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** At most this many countries hold a draft — a bound on the one settings row. */
export const CRISIS_DRAFT_COUNTRIES_MAX = 60;

/** The platform setting that holds the drafts (`platform_ai_settings().crisis_text_drafts`). */
export const AI_CRISIS_TEXT_DRAFTS_SETTING_KEY = 'ai.crisis_text_drafts';

/** `{ TR: { en: '…', tr: '…' }, GB: { en: '…' } }` — a language may be missing. */
export type CrisisTextDrafts = Record<string, Partial<Record<CrisisDraftLang, string>>>;

/** Whether `value` is a well-formed draft map (the stored shape; a bad row reads as none). */
export function isCrisisTextDrafts(value: unknown): value is CrisisTextDrafts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > CRISIS_DRAFT_COUNTRIES_MAX) return false;
  return entries.every(([country, texts]) => {
    if (!CRISIS_DRAFT_COUNTRY_PATTERN.test(country)) return false;
    if (typeof texts !== 'object' || texts === null || Array.isArray(texts)) return false;
    return Object.entries(texts as Record<string, unknown>).every(
      ([lang, text]) =>
        (CRISIS_DRAFT_LANGS as readonly string[]).includes(lang) &&
        typeof text === 'string' &&
        text.length > 0 &&
        text.length <= PLATFORM_CRISIS_TEXT_MAX,
    );
  });
}

/**
 * The draft a workspace is offered: the one for its country, in the language
 * asked for, else in the other language. Null when the country has none (or
 * is unknown) — "no draft" is a normal answer, not an error.
 */
export function pickCrisisTextDraft(
  drafts: unknown,
  country: string | null,
  preferred: CrisisDraftLang,
): string | null {
  if (country === null || !isCrisisTextDrafts(drafts)) return null;
  const texts = drafts[country];
  if (!texts) return null;
  const other: CrisisDraftLang = preferred === 'tr' ? 'en' : 'tr';
  return texts[preferred] ?? texts[other] ?? null;
}

/** The language a request asks for: `tr` when its `Accept-Language` leads with Turkish, else `en`. */
export function crisisDraftLangOf(acceptLanguage: string | undefined): CrisisDraftLang {
  const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return first === 'tr' || first.startsWith('tr-') ? 'tr' : 'en';
}

/**
 * IANA zone → ISO country, for the zones of the markets the product serves.
 * A workspace records its zone (`organizations.timezone`) and no country; a
 * zone not named here (`UTC` included) leaves the country unknown, and an
 * unknown country has no draft. Extending the table is a one-line change.
 */
export const TIMEZONE_COUNTRIES: Readonly<Record<string, string>> = {
  'Europe/Istanbul': 'TR',
  'Asia/Nicosia': 'CY',
  'Europe/Nicosia': 'CY',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Malta': 'MT',
  'Europe/Berlin': 'DE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Paris': 'FR',
  'Europe/Brussels': 'BE',
  'Europe/Amsterdam': 'NL',
  'Europe/Luxembourg': 'LU',
  'Europe/Madrid': 'ES',
  'Europe/Lisbon': 'PT',
  'Europe/Rome': 'IT',
  'Europe/Athens': 'GR',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Tallinn': 'EE',
  'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Bratislava': 'SK',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Sofia': 'BG',
  'Europe/Belgrade': 'RS',
  'Europe/Zagreb': 'HR',
  'Europe/Ljubljana': 'SI',
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA',
  'Europe/Moscow': 'RU',
  'Asia/Baku': 'AZ',
  'Asia/Tbilisi': 'GE',
  'Asia/Dubai': 'AE',
  'Asia/Kolkata': 'IN',
  'Asia/Singapore': 'SG',
  'Asia/Manila': 'PH',
  'Asia/Tokyo': 'JP',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Pacific/Auckland': 'NZ',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Santiago': 'CL',
};

/** The country a workspace's zone says it is in, or null when the zone is not in the table. */
export function countryOfTimezone(zone: string | null | undefined): string | null {
  if (!zone || !Object.prototype.hasOwnProperty.call(TIMEZONE_COUNTRIES, zone)) return null;
  return TIMEZONE_COUNTRIES[zone] ?? null;
}

// ---------------------------------------------------------------------------
// Catalogue answers.
// ---------------------------------------------------------------------------

/**
 * A catalogue or a workspace summary section whose source has not shipped:
 * the table or the constant does not exist yet. The panel says so rather than
 * showing a zero it cannot stand behind.
 */
export const AI_CATALOG_STATUSES = ['available', 'not_installed'] as const;
export type AiCatalogStatus = (typeof AI_CATALOG_STATUSES)[number];

/** Bump with any change to {@link AI_QA_RUBRIC} below. */
export const AI_QA_RUBRIC_VERSION = '2026-10-27.1';

/** The score every criterion is given on, 1 (poor) to 5 (right). */
export const AI_QA_RUBRIC_SCALE = { min: 1, max: 5 } as const;

/**
 * The rubric the AI judge scores by (AI-24 "Tipler", a–g): the criteria in
 * the judge's own order, and which apply only when the conversation was handed
 * over. A literal, not a map over the judge's list, so this module stays free
 * of top-level calls; `ai-catalogs.test.ts` holds the two lists equal.
 */
export const AI_QA_RUBRIC: ReadonlyArray<{
  readonly key: AiTestJudgeCriterion;
  readonly handoff_only: boolean;
}> = [
  { key: 'topic', handoff_only: false },
  { key: 'required_info', handoff_only: false },
  { key: 'faithfulness', handoff_only: false },
  { key: 'guardrails', handoff_only: false },
  { key: 'handoff_timing', handoff_only: true },
  { key: 'handoff_summary', handoff_only: true },
  { key: 'tone', handoff_only: false },
];
