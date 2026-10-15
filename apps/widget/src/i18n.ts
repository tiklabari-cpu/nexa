/**
 * Widget internationalisation (I18N1).
 *
 * The widget cannot afford the panel's React-bound i18n store: it renders to the
 * DOM by hand under a 50 KB budget (NFR-P3), and its locale is fixed for the
 * life of a page load — the embedding site chooses it via `data-language` and it
 * never changes underneath the visitor. So this is the smallest thing that
 * works: flat per-locale string tables (`./locales/<lang>.ts`, NFR-I18N1) and a
 * translator bound once at mount.
 *
 * The fallback chain matches the panel — active locale → English → the key — so
 * a gap in a locale's table shows English rather than a raw key, and a typo'd
 * key is visible rather than fatal.
 */
import { CATALOGS, RTL_LOCALES, type WidgetLocale } from './locales/index.js';

export type { WidgetLocale };

export type WidgetTranslate = (key: string, params?: Record<string, string | number>) => string;

const SUPPORTED_LOCALES = Object.keys(CATALOGS) as WidgetLocale[];

/**
 * BCP-47 tag → a supported locale, defaulting to English. Only the primary
 * subtag is matched, so a region (`ar-EG`, `pt-BR`, `TR-tr`) resolves the same
 * as the bare tag. Supporting a ninth language never touches this function —
 * it reads whatever `locales/index.ts` exports.
 */
export function resolveWidgetLocale(language: string | null | undefined): WidgetLocale {
  const primary = (language ?? '').toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.includes(primary as WidgetLocale) ? (primary as WidgetLocale) : 'en';
}

/** A BCP-47 tag's primary subtag, when it is one of the supported languages. */
function supportedLocale(tag: string | null | undefined): WidgetLocale | null {
  const primary = (tag ?? '').toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(primary as WidgetLocale) ? (primary as WidgetLocale) : null;
}

/** The languages the visitor's browser prefers, most preferred first. */
export function browserLanguages(nav: Pick<Navigator, 'language' | 'languages'>): string[] {
  const list = nav.languages?.length ? nav.languages : [nav.language];
  return list.filter((tag): tag is string => typeof tag === 'string' && tag !== '');
}

export interface WidgetLanguageSources {
  /** A `language` the embedding page wrote into its install snippet. */
  snippet?: string | null;
  /** The panel's choice from the token mint — absent until the mint lands. */
  panel?: string | null;
  /** The panel's fallback from the token mint. */
  fallback?: string | null;
  /** `navigator.languages`. */
  browser?: readonly string[];
}

/**
 * Which language the widget shows (WG-02), in this order:
 *
 * 1. a language the embedding page's snippet names — the site owner's explicit
 *    word beats the panel (the panel says so beside the picker);
 * 2. the panel's language, unless it is `auto`;
 * 3. `auto`: the first of the browser's languages we ship (primary subtag, so
 *    `tr-TR` is Turkish);
 * 4. the panel's fallback language.
 *
 * A snippet language we do not ship (`ru`) is no choice at all and falls
 * through, instead of pinning English the way the old single-value lookup did.
 * Before the mint the panel's half is unknown, so `panel` and `fallback` are
 * absent: the answer is then snippet → browser → English, which for the common
 * case (a browser language we ship, panel on auto) is already the final answer
 * and nothing is redrawn when the mint lands.
 */
export function pickWidgetLocale(sources: WidgetLanguageSources): WidgetLocale {
  const fromSnippet = supportedLocale(sources.snippet);
  if (fromSnippet) return fromSnippet;
  if (sources.panel && sources.panel !== 'auto') {
    const pinned = supportedLocale(sources.panel);
    if (pinned) return pinned;
  }
  for (const tag of sources.browser ?? []) {
    const match = supportedLocale(tag);
    if (match) return match;
  }
  return supportedLocale(sources.fallback) ?? 'en';
}

/** Whether `locale` reads right-to-left (NFR-I18N1) — Arabic today. */
export function isRtlLocale(locale: WidgetLocale): boolean {
  return RTL_LOCALES.has(locale);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** A translator bound to `language` for the life of the widget. */
export function createTranslator(language: string | null | undefined): WidgetTranslate {
  const locale = resolveWidgetLocale(language);
  const catalog = CATALOGS[locale];
  return (key, params) => {
    const template = catalog[key] ?? CATALOGS.en[key] ?? key;
    return interpolate(template, params);
  };
}
