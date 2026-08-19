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
