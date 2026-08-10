/**
 * Sales tracker configuration — the shape the API, the settings screen and the
 * widget's `nexa('trackSale', …)` snippet all have to agree on (FR-MOD-13.5).
 *
 * The defaults below mirror the column defaults in `schema.prisma`
 * (`model SalesTrackerSettings`) value-for-value. Signup writes no row, so a
 * workspace that has never opened the screen reads exactly this — keeping the
 * two copies here rather than reading the database means a read never has to
 * write a row to answer, and `settings.test.ts` pins them together.
 */

/**
 * The currencies tracking can be configured in. A whitelist rather than "any
 * three letters" because the code is not decoration: 13.5-c stores it on every
 * order and 13.5-d sums revenue under it, so a typo (`DOL`, `EURO`) would sit
 * in the settings looking configured while producing a report denominated in a
 * currency that does not exist and cannot be formatted. ISO 4217 alpha-3, the
 * shape the `char_length(currency) = 3` CHECK on both tables enforces.
 */
export const SALES_TRACKER_CURRENCIES = [
  'AED',
  'AUD',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'DKK',
  'EUR',
  'GBP',
  'INR',
  'JPY',
  'MXN',
  'NOK',
  'NZD',
  'PLN',
  'SAR',
  'SEK',
  'SGD',
  'TRY',
  'USD',
  'ZAR',
] as const;

export type SalesTrackerCurrency = (typeof SALES_TRACKER_CURRENCIES)[number];

export function isSalesTrackerCurrency(value: unknown): value is SalesTrackerCurrency {
  return (
    typeof value === 'string' &&
    (SALES_TRACKER_CURRENCIES as readonly string[]).includes(value.toUpperCase())
  );
}

/**
 * How long after a chat a sale can still be credited to it. The floor is 1: a
 * zero or negative window could never attribute anything (a sale always lands
 * after the chat it belongs to), which the database CHECK also refuses.
 */
export const SALES_TRACKER_ATTRIBUTION_WINDOW_MIN_DAYS = 1;

/**
 * 90 days. Past a quarter the causal claim "this chat produced this sale" is
 * not one the report can honestly make, and the attribution scan would widen
 * without bound — so it is rejected rather than stored.
 */
export const SALES_TRACKER_ATTRIBUTION_WINDOW_MAX_DAYS = 90;

/** The whole configurable surface of the sales tracker. `snake_case`: it travels over the API. */
export interface SalesTrackerConfig {
  /** Tracking is off until a workspace turns it on; nothing is ingested while false. */
  enabled: boolean;
  currency: SalesTrackerCurrency;
  /** Days after a chat during which a sale still counts as attributed to it. */
  attribution_window_days: number;
}

/** Mirrors the column defaults in `schema.prisma` — what a workspace with no row reads. */
export const DEFAULT_SALES_TRACKER_CONFIG: SalesTrackerConfig = {
  enabled: false,
  currency: 'USD',
  attribution_window_days: 7,
};
