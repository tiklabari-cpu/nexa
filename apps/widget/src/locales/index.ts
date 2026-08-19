/**
 * Widget locale catalogs (NFR-I18N1).
 *
 * One flat `Record<string, string>` per supported language — the widget has no
 * namespaces to split (unlike the panel's `apps/web/src/locales/{lang}/*.ts`),
 * just the one small vocabulary a chat bubble needs. Every catalog carries the
 * same key set as `en`, guarded by `locales.test.ts`; a gap falls back to
 * English at runtime (`i18n.ts`) rather than breaking.
 *
 * Adding a ninth language is a new `<lang>.ts` file plus one line here — never
 * a change to `i18n.ts` or `widget.ts`.
 */
import { ar } from './ar.js';
import { de } from './de.js';
import { en } from './en.js';
import { es } from './es.js';
import { fr } from './fr.js';
import { it } from './it.js';
import { pt } from './pt.js';
import { tr } from './tr.js';

export type WidgetLocale = 'en' | 'tr' | 'de' | 'fr' | 'es' | 'it' | 'pt' | 'ar';

export const CATALOGS: Record<WidgetLocale, Record<string, string>> = {
  en,
  tr,
  de,
  fr,
  es,
  it,
  pt,
  ar,
};

/**
 * Right-to-left locales (NFR-I18N1) — Arabic today. This set is the entire
 * mechanism's direction-awareness: `i18n.ts#isRtlLocale` and, through it,
 * `widget.ts`'s `dir="rtl"` on the document element both key off it alone.
 */
export const RTL_LOCALES: ReadonlySet<WidgetLocale> = new Set<WidgetLocale>(['ar']);
