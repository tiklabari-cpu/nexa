/**
 * Guard for the suite-wide locale pin (tm 108).
 *
 * The Billing and Reports suites assert en-US money and counts — "$297.00",
 * "4,812". They get them from `format.ts`, which falls through to the runtime's
 * default locale whenever nothing bound one, i.e. to whichever OS locale the
 * machine running the suite happens to use. `vitest.setup.ts` pins that locale
 * so the gate measures the code instead of the laptop.
 *
 * The assertions below make the runtime default hostile (tr-TR: comma decimals,
 * dot grouping) and show the helpers still emit en-US. That is only possible
 * while the pin is in place, so this file goes red on *every* machine if the pin
 * is removed — unlike the component suites, which would only go red on a
 * non-English one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formatCount, formatDate, formatMoney } from './format.js';

const HOSTILE = 'tr-TR';

let realNumberFormat: typeof Intl.NumberFormat;
let realDateTimeFormat: typeof Intl.DateTimeFormat;

beforeEach(() => {
  realNumberFormat = Intl.NumberFormat;
  realDateTimeFormat = Intl.DateTimeFormat;

  // Plain functions, not arrows: `format.ts` reaches these through `new`.
  function NumberFormat(
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ): Intl.NumberFormat {
    return new realNumberFormat(locales ?? HOSTILE, options);
  }
  function DateTimeFormat(
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormat {
    return new realDateTimeFormat(locales ?? HOSTILE, options);
  }

  Intl.NumberFormat = NumberFormat as unknown as typeof Intl.NumberFormat;
  Intl.DateTimeFormat = DateTimeFormat as unknown as typeof Intl.DateTimeFormat;
});

afterEach(() => {
  Intl.NumberFormat = realNumberFormat;
  Intl.DateTimeFormat = realDateTimeFormat;
});

describe('formatters under a hostile runtime default locale', () => {
  it('the hostile default is genuinely hostile', () => {
    // Without this the rest of the file would pass vacuously.
    expect(new Intl.NumberFormat().format(1234.5)).toBe('1.234,5');
  });

  it('formats money the way BillingPage asserts it', () => {
    expect(formatMoney(29700)).toBe('$297.00');
    expect(formatMoney(50)).toBe('$0.50');
    expect(formatMoney(5900)).toBe('$59.00');
  });

  it('groups counts the way BillingPage and ReportsPage assert them', () => {
    expect(formatCount(4812)).toBe('4,812');
    expect(formatCount(150000)).toBe('150,000');
  });

  it('formats dates in the English shape, not the Turkish one', () => {
    // Shape rather than an exact string: the calendar day depends on the
    // runner's time zone, which is a separate axis from the locale.
    const rendered = formatDate('2026-07-31T12:00:00.000Z');
    expect(rendered).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  });

  it('still honours an explicit locale argument', () => {
    // The pin sets a default; it does not override a caller that names one,
    // which is what keeps the product's "follow the agent's language" behaviour.
    expect(formatCount(1234567, 'tr')).toBe('1.234.567');
    expect(formatCount(1234567, 'en')).toBe('1,234,567');
  });
});
