/**
 * Panel internationalisation (I18N1/2).
 *
 * Deliberately dependency-free: a flat message catalogue plus a `t()` that looks
 * a key up in the active locale, falls back to English, then to the key itself.
 * A heavier library (ICU, plural rules, lazy-loaded bundles) buys nothing at two
 * locales and this many strings, and it would pull weight into a bundle the
 * widget half of the same feature is fighting to keep small.
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
 * The catalogue. `en` is complete by construction; `tr` fills in what has been
 * translated and leans on the fallback for the rest. Interpolation is `{name}`,
 * substituted from the params object — unknown params are left untouched and
 * unused ones ignored, so a template can differ between languages (English
 * pluralises "day/days"; Turkish does not, and simply omits the marker).
 */
const MESSAGES: Record<Locale, Record<string, string>> = {
  en: {
    // Shell chrome
    'shell.modules': 'Modules',
    'shell.subscribe': 'Subscribe',
    'shell.trial.ended': 'Your trial has ended — subscribe to start new conversations.',
    'shell.trial.remaining': '{days} day{s} left in your trial.',
    'shell.account': 'Account',
    'shell.account.agentFallback': 'Agent',
    'shell.account.signOut': 'Sign out',
    'shell.account.language': 'Language',
    'shell.brand': 'Brand',

    // Navigation (rail + command palette)
    'nav.home': 'Home',
    'nav.inbox': 'Inbox',
    'nav.customers': 'Customers',
    'nav.team': 'Team',
    'nav.playbook': 'Playbook',
    'nav.reports': 'Reports',
    'nav.billing': 'Billing',
    'nav.settings': 'Settings',

    // Command palette
    'palette.label': 'Command palette',
    'palette.search': 'Search or jump to',
    'palette.placeholder':
      'Search customers, conversations, tickets — or jump to a module…',
    'palette.searching': 'Searching…',
    'palette.noMatches': 'No matches.',
    'palette.group.goTo': 'Go to',
    'palette.group.customers': 'Customers',
    'palette.group.conversations': 'Conversations',
    'palette.group.tickets': 'Tickets',
    'palette.unnamedVisitor': 'Unnamed visitor',
    'palette.visitor': 'Visitor',
  },
  tr: {
    // Shell chrome
    'shell.modules': 'Modüller',
    'shell.subscribe': 'Abone Ol',
    'shell.trial.ended':
      'Deneme süreniz sona erdi — yeni sohbetler başlatmak için abone olun.',
    'shell.trial.remaining': 'Deneme sürenizde {days} gün kaldı.',
    'shell.account': 'Hesap',
    'shell.account.agentFallback': 'Temsilci',
    'shell.account.signOut': 'Çıkış Yap',
    'shell.account.language': 'Dil',
    'shell.brand': 'Marka',

    // Navigation
    'nav.home': 'Ana Sayfa',
    'nav.inbox': 'Gelen Kutusu',
    'nav.customers': 'Müşteriler',
    'nav.team': 'Ekip',
    'nav.playbook': 'Senaryolar',
    'nav.reports': 'Raporlar',
    'nav.billing': 'Faturalandırma',
    'nav.settings': 'Ayarlar',

    // Command palette
    'palette.label': 'Komut paleti',
    'palette.search': 'Ara veya git',
    'palette.placeholder': 'Müşteri, sohbet, talep ara — veya bir modüle atla…',
    'palette.searching': 'Aranıyor…',
    'palette.noMatches': 'Eşleşme yok.',
    'palette.group.goTo': 'Git',
    'palette.group.customers': 'Müşteriler',
    'palette.group.conversations': 'Sohbetler',
    'palette.group.tickets': 'Talepler',
    'palette.unnamedVisitor': 'İsimsiz ziyaretçi',
    'palette.visitor': 'Ziyaretçi',
  },
};

export type TranslateParams = Record<string, string | number>;

/** Substitute `{name}` placeholders from `params`. */
function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Resolve a key in `locale`, falling back to English, then to the key itself.
 *
 * Pure and locale-explicit so the fallback is a plain unit test with no store or
 * React involved.
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
  const template = MESSAGES[locale]?.[key] ?? MESSAGES.en[key] ?? key;
  return interpolate(template, params);
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
