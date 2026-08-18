/**
 * Rendering a component in a chosen language (NFR-I18N2).
 *
 * The locale lives in a module-level zustand store, not in a provider, because
 * the product has exactly one and threading a context through every screen buys
 * nothing. That is the right call for the app and an awkward one for tests: a
 * suite that flips the locale leaks it into whichever file vitest runs next in
 * the same worker, and the failure surfaces as an unrelated screen asserting
 * English and getting Turkish.
 *
 * `renderWithLocale` closes that: it sets the locale inside `act` (so the store
 * update is flushed before the first render rather than warning about it), and
 * hands back the usual `render` result plus a `restore()` the caller can put in
 * `afterEach`. `resetLocale()` is the same restore for suites that only need the
 * cleanup.
 */
import { act, render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useLocaleStore, type Locale } from '../lib/i18n.js';

/**
 * The language every suite starts and ends in. English rather than "whatever the
 * previous file left behind" — the default has to be a fact, not a leftover.
 */
const DEFAULT_LOCALE: Locale = 'en';

/** Put the store back in English, and forget the remembered choice it wrote. */
export function resetLocale(): void {
  act(() => useLocaleStore.getState().setLocale(DEFAULT_LOCALE));
  try {
    globalThis.localStorage?.removeItem('nexa.locale');
  } catch {
    // A storage-less environment has nothing to forget.
  }
}

/** Switch the store to `locale` without rendering anything. */
export function setLocale(locale: Locale): void {
  act(() => useLocaleStore.getState().setLocale(locale));
}

/**
 * `render(ui)` with the console in `locale`.
 *
 * The locale is set *before* the render rather than flipped after it, so what a
 * test asserts is the first paint an agent working in that language actually
 * gets — which is the case a mid-render switch would never exercise.
 */
export function renderWithLocale(
  ui: ReactElement,
  locale: Locale = DEFAULT_LOCALE,
  options?: RenderOptions,
): RenderResult & { restore: () => void } {
  setLocale(locale);
  const result = render(ui, options);
  return { ...result, restore: resetLocale };
}
