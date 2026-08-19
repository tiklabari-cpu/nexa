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

  it('marks only Arabic as right-to-left', () => {
    expect([...RTL_LOCALES]).toEqual(['ar']);
  });
});
