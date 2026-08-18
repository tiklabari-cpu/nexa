/**
 * Panel internationalisation (I18N1/2).
 *
 * Deliberately dependency-free: a message catalogue plus a `t()` that looks a
 * key up in the active locale, falls back to English, then to the key itself.
 * A heavier library (full ICU, lazy-loaded bundles) buys nothing at two locales
 * and this many strings, and it would pull weight into a bundle the widget half
 * of the same feature is fighting to keep small. The one piece of ICU worth
 * having — plural selection — comes from the platform's own `Intl.PluralRules`.
 *
 * The catalogue itself lives in `src/locales/<locale>/<namespace>.ts`, one file
 * per screen area; see `locales/merge.ts` for why it is split that way. This
 * module owns the *behaviour*: lookup, fallback, interpolation, plurals, the
 * store, and the hooks.
 *
 * English is the source of truth: every key a component references exists in
 * `en`, so the English column can never be missing. `tr` may be partial while
 * the product's surface is translated screen by screen — a missing Turkish key
 * shows the English text rather than a raw `some.key`, which is the whole point
 * of the fallback (the "eksik-anahtar güvenliği" the task asks for).
 *
 * Live/machine translation of conversation content is explicitly out of scope
 * (PRD §9); this is chrome only.
 */
import { useCallback } from 'react';
import { create } from 'zustand';
import { CATALOGUES, type Messages } from '../locales/index.js';
import { setFormatLocale } from './format.js';

export type Locale = 'en' | 'tr';

/** The locales offered in the switcher, in display order. */
export const LOCALES: readonly Locale[] = ['en', 'tr'];

/** How each locale names itself — shown in its own language in both catalogues. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  tr: 'Türkçe',
};

const STORAGE_KEY = 'nexa.locale';

/**
 * The catalogue, flattened from the namespace files.
 *
 * Typing it as `Record<Locale, Messages>` rather than inferring it is the
 * binding between `Locale` and `src/locales/`: a directory added without a
 * `Locale` member, or a `Locale` member without a directory, fails to compile
 * here instead of becoming a language the switcher offers and `t()` cannot
 * resolve.
 */
const MESSAGES: Record<Locale, Messages> = CATALOGUES;

export type TranslateParams = Record<string, string | number>;

/** Substitute `{name}` placeholders from `params`. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * `Intl.PluralRules` is not free to construct, and `t()` runs on every render of
 * every row, so keep one per locale.
 */
const PLURAL_RULES = new Map<Locale, Intl.PluralRules>();

function pluralCategory(locale: Locale, count: number): string {
  let rules = PLURAL_RULES.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    PLURAL_RULES.set(locale, rules);
  }
  return rules.select(count);
}

/**
 * One locale's answer for `key`, or `undefined` if it has none.
 *
 * Plurals are a key-suffix convention rather than a message syntax: a numeric
 * `count` param makes `key.<category>` (then `key.other`) preferred over `key`.
 * That keeps the rules where the language is — Turkish has no separate `one`
 * form for counted nouns and simply ships `key.other`, English ships both —
 * without teaching the interpolator a mini-language. `count` still interpolates
 * as `{count}`, so a template reads `{count} unread conversations`.
 *
 * A key with no plural forms is untouched by this: the suffixed lookups miss and
 * the plain key answers, which is why every message written before plurals
 * existed still resolves exactly as it did.
 */
function lookup(locale: Locale, key: string, params?: TranslateParams): string | undefined {
  const catalogue = MESSAGES[locale];
  if (!catalogue) return undefined;

  const count = params?.['count'];
  if (typeof count === 'number' && Number.isFinite(count)) {
    const plural =
      catalogue[`${key}.${pluralCategory(locale, count)}`] ?? catalogue[`${key}.other`];
    if (plural !== undefined) return plural;
  }
  return catalogue[key];
}

/**
 * Resolve a key in `locale`, falling back to English, then to the key itself.
 *
 * Pure and locale-explicit so the fallback is a plain unit test with no store or
 * React involved.
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
  const template = lookup(locale, key, params) ?? lookup('en', key, params) ?? key;
  return interpolate(template, params);
}

/**
 * Whether `key` has an explicit entry in `locale`'s own catalogue — unlike
 * `translate`, this does not fall back to English or the key. Catalogue
 * completeness tests (a missing translation must fail loudly) need this; UI
 * rendering never should, which is why `translate`'s fallback stays silent.
 */
export function hasMessage(locale: Locale, key: string): boolean {
  return key in MESSAGES[locale];
}

/** Narrow anything to a supported locale, defaulting to English. */
function coerceLocale(value: string | null | undefined): Locale {
  if (!value) return 'en';
  const base = value.toLowerCase().split('-')[0];
  return base === 'tr' ? 'tr' : 'en';
}

/**
 * Initial locale: a remembered choice wins, then the browser's preference, then
 * English. Wrapped because storage access throws in locked-down browsers.
 */
export function detectLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) return coerceLocale(stored);
  } catch {
    // Ignore — fall through to the browser preference.
  }
  return coerceLocale(globalThis.navigator?.language);
}

/**
 * Apply the side effects of a locale: remember it, tell the Intl formatters, and
 * set `<html lang>` so assistive tech and the browser agree on the language.
 */
function applyLocale(locale: Locale): void {
  setFormatLocale(locale);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // A locale that cannot be remembered simply resets next load — not fatal.
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const initialLocale = detectLocale();
applyLocale(initialLocale);

/** The one source of the active locale; components subscribe through the hooks. */
export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: initialLocale,
  setLocale: (locale) => {
    applyLocale(locale);
    set({ locale });
  },
}));

/** `[locale, setLocale]` — for the language switcher. */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  return { locale, setLocale };
}

export type TFunction = (key: string, params?: TranslateParams) => string;

/**
 * A `t()` bound to the active locale. Subscribing here is what re-renders a
 * component when the agent switches languages.
 *
 * Memoised on the locale so its identity is stable across renders — callers put
 * it in `useMemo`/`useEffect` dependency lists (the command palette does), and
 * a fresh function each render would thrash those.
 */
export function useTranslate(): TFunction {
  const locale = useLocaleStore((s) => s.locale);
  return useCallback((key, params) => translate(locale, key, params), [locale]);
}

/** Read the active locale without React — for the odd non-component caller. */
export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}
