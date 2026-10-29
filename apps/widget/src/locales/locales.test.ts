/**
 * Catalog-completeness guard (NFR-I18N1).
 *
 * `i18n.ts#createTranslator` falls back to English for a missing key, so a gap
 * in a locale's table never crashes the widget — but it also never surfaces on
 * its own. This test is the surfacing: every catalog must carry exactly `en`'s
 * key set, so a typo or a forgotten key in, say, `ar.ts` fails here rather than
 * showing up as silent English inside an Arabic chat.
 */
import { describe, expect, it } from 'vitest';
import { WIDGET_PHRASE_DEFAULTS, WIDGET_PHRASE_KEYS, WIDGET_UI_LOCALES } from '@siyahtus/types';
import { CATALOGS, RTL_LOCALES } from './index.js';

describe('widget locale catalogs', () => {
  const locales = Object.keys(CATALOGS) as (keyof typeof CATALOGS)[];
  const englishKeys = Object.keys(CATALOGS.en).sort();

  it('ships the mechanism plus data for 8 languages (NFR-I18N1)', () => {
    expect(locales.sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'it', 'pt', 'tr']);
  });

  for (const locale of locales) {
    it(`${locale} carries exactly the English key set`, () => {
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual(englishKeys);
    });

    it(`${locale} has no empty string values`, () => {
      for (const [key, value] of Object.entries(CATALOGS[locale])) {
        expect(value.length, `${locale}['${key}'] is empty`).toBeGreaterThan(0);
      }
    });
  }

  // A visitor reads these. Requirement, decision and task codes belong in code
  // comments (tm 259.14); the panel's twin of this check is locale-copy.test.ts.
  it('shows no internal requirement or decision codes in any catalog', () => {
    const internalRef = /\b(?:N?FR-[A-Z0-9]|ADR-?\d|PRD\b|WORKSCHED|tm \d)|§\s*\d|\bNFR-[A-Z]/;
    const hits = locales.flatMap((locale) =>
      Object.entries(CATALOGS[locale])
        .filter(([, value]) => internalRef.test(value))
        .map(([key, value]) => `${locale}['${key}']: ${value}`),
    );
    expect(hits).toEqual([]);
  });

  // The panel shows a brand the widget's own text beside each field it may
  // rewrite (WG-05) from a copy in `@siyahtus/types`; the copy is this.
  it('keeps the panel copy of the rewritable texts equal to the catalogs (tm 344)', () => {
    expect([...WIDGET_UI_LOCALES].sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      for (const key of WIDGET_PHRASE_KEYS) {
        expect(WIDGET_PHRASE_DEFAULTS[locale][key], `${locale}['${key}']`).toBe(
          CATALOGS[locale][key],
        );
      }
    }
  });

  it('marks only Arabic as right-to-left', () => {
    expect([...RTL_LOCALES]).toEqual(['ar']);
  });
});
