import '@testing-library/jest-dom/vitest';

import { setFormatLocale } from './src/lib/format.js';

// jsdom has no layout engine, so `Element.prototype.scrollIntoView` is absent
// — any component that calls it (e.g. keeping a keyboard-highlighted list row
// in view) throws under jsdom without a stand-in. The real scroll is a
// browser concern tests do not assert on, so a no-op is enough.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * The locale every test file formats against unless it says otherwise.
 *
 * `format.ts` formats against the *runtime's* default locale until the i18n
 * store binds one, and the runtime default is whatever the developer's OS is
 * set to. On a tr-TR machine the Billing and Reports suites therefore rendered
 * "$297,00" and "4.812" where they assert "$297.00" and "4,812": 7 failures
 * that tracked the machine rather than the code, so `pnpm -w test` could never
 * honestly exit 0 there (tm 108).
 *
 * Pinning here rather than inside `format.ts` leaves the product behaviour
 * alone — the app still follows whichever language the agent picked. The pin
 * runs before the test file is imported, so a test (or the i18n store's own
 * module init) that binds a different locale still wins.
 */
setFormatLocale('en-US');

/**
 * `NEXA_TEST_RUNTIME_LOCALE=<bcp47>` rewrites the runtime's *default* locale for
 * the whole run — the one thing a test machine cannot otherwise vary.
 *
 * Without it the pin above can only be proven on the machine that exposed the
 * bug: on an en-US laptop an unpinned suite passes for the wrong reason. With
 * it, `NEXA_TEST_RUNTIME_LOCALE=en-US` and `=tr-TR` are both runnable anywhere,
 * and both must stay green.
 */
const forcedRuntimeLocale = process.env['NEXA_TEST_RUNTIME_LOCALE'];
if (forcedRuntimeLocale) {
  forceRuntimeDefaultLocale(forcedRuntimeLocale);
}

function forceRuntimeDefaultLocale(tag: string): void {
  const RealNumberFormat = Intl.NumberFormat;
  const RealDateTimeFormat = Intl.DateTimeFormat;

  // Plain functions, not arrows: these are reached through `new`.
  function NumberFormat(
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ): Intl.NumberFormat {
    return new RealNumberFormat(locales ?? tag, options);
  }
  function DateTimeFormat(
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): Intl.DateTimeFormat {
    return new RealDateTimeFormat(locales ?? tag, options);
  }

  Intl.NumberFormat = NumberFormat as unknown as typeof Intl.NumberFormat;
  Intl.DateTimeFormat = DateTimeFormat as unknown as typeof Intl.DateTimeFormat;

  // The `Date.prototype.toLocale*` call sites (transcript timestamps, chat
  // details) read the same runtime default and are not routed through
  // `format.ts`, so they have to be redirected too or the simulation is
  // incomplete.
  const realToLocaleString = Date.prototype.toLocaleString;
  const realToLocaleDateString = Date.prototype.toLocaleDateString;
  const realToLocaleTimeString = Date.prototype.toLocaleTimeString;

  Date.prototype.toLocaleString = function toLocaleString(
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return realToLocaleString.call(this, locales ?? tag, options);
  };
  Date.prototype.toLocaleDateString = function toLocaleDateString(
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return realToLocaleDateString.call(this, locales ?? tag, options);
  };
  Date.prototype.toLocaleTimeString = function toLocaleTimeString(
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ): string {
    return realToLocaleTimeString.call(this, locales ?? tag, options);
  };
}
