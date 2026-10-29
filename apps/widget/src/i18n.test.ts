/**
 * The widget's i18n primitive: locale resolution, lookup, fallback, interpolation.
 *
 * The translator is bound once at mount (the visitor's locale is fixed for the
 * page load), so the interesting behaviour is all in `createTranslator` and
 * `resolveWidgetLocale`. The fallback is the load-bearing part — a missing key
 * must surface the key itself rather than crash, mirroring the panel (I18N1).
 */
import { describe, expect, it } from 'vitest';
import { WIDGET_UI_LOCALES } from '@siyahtus/types';
import {
  browserLanguages,
  createTranslator,
  isRtlLocale,
  pickWidgetLocale,
  resolveWidgetLocale,
} from './i18n.js';
import { CATALOGS } from './locales/index.js';

describe('resolveWidgetLocale', () => {
  it('maps each supported BCP-47 primary tag to its locale', () => {
    expect(resolveWidgetLocale('tr')).toBe('tr');
    expect(resolveWidgetLocale('TR-tr')).toBe('tr');
    expect(resolveWidgetLocale('en')).toBe('en');
    expect(resolveWidgetLocale('en-US')).toBe('en');
    expect(resolveWidgetLocale('de')).toBe('de');
    expect(resolveWidgetLocale('de-DE')).toBe('de');
    expect(resolveWidgetLocale('fr-CA')).toBe('fr');
    expect(resolveWidgetLocale('es-MX')).toBe('es');
    expect(resolveWidgetLocale('it')).toBe('it');
    expect(resolveWidgetLocale('pt-BR')).toBe('pt');
    expect(resolveWidgetLocale('AR-eg')).toBe('ar');
  });

  it('defaults to English for a language with no catalogue', () => {
    // Unlike the six added this round, these have never been supported.
    expect(resolveWidgetLocale('ja')).toBe('en');
    expect(resolveWidgetLocale('zh-CN')).toBe('en');
  });

  it('defaults to English for a missing language', () => {
    expect(resolveWidgetLocale(null)).toBe('en');
    expect(resolveWidgetLocale(undefined)).toBe('en');
    expect(resolveWidgetLocale('')).toBe('en');
  });
});

describe('isRtlLocale', () => {
  it('is true only for Arabic', () => {
    expect(isRtlLocale('ar')).toBe(true);
    for (const locale of ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt'] as const) {
      expect(isRtlLocale(locale)).toBe(false);
    }
  });
});

describe('createTranslator', () => {
  it("returns the bound locale's string", () => {
    expect(createTranslator('en')('send')).toBe('Send');
    expect(createTranslator('tr')('send')).toBe('Gönder');
  });

  it('resolves the locale from a region-tagged language', () => {
    expect(createTranslator('tr-TR')('launcher.text')).toBe('Sohbet');
  });

  it('translates the same action across every supported locale (NFR-I18N1)', () => {
    expect(createTranslator('de')('send')).toBe('Senden');
    expect(createTranslator('fr')('send')).toBe('Envoyer');
    expect(createTranslator('es')('send')).toBe('Enviar');
    expect(createTranslator('it')('send')).toBe('Invia');
    expect(createTranslator('pt')('send')).toBe('Enviar');
    expect(createTranslator('ar')('send')).toBe('إرسال');
  });

  it('falls back to the key itself when it exists in no catalogue', () => {
    // Missing-key safety: a typo'd key is visible rather than fatal.
    expect(createTranslator('en')('does.not.exist')).toBe('does.not.exist');
    expect(createTranslator('tr')('does.not.exist')).toBe('does.not.exist');
    expect(createTranslator('ar')('does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates named params, including right-to-left text', () => {
    expect(createTranslator('en')('status.queue', { n: 3 })).toBe('You are number 3 in the queue');
    expect(createTranslator('tr')('status.queue', { n: 2 })).toBe('Sırada 2. sıradasınız');
    expect(createTranslator('ar')('status.queue', { n: 5 })).toBe('أنت رقم 5 في قائمة الانتظار');
  });

  it('leaves an unmatched placeholder untouched', () => {
    expect(createTranslator('en')('status.queue')).toBe('You are number {n} in the queue');
  });

  it('falls back to English chrome for an unrecognised language', () => {
    expect(createTranslator('ja')('send')).toBe('Send');
    expect(createTranslator('ja')('launcher.text')).toBe('Chat');
  });
});

describe('createTranslator with brand texts (tm 344 · WG-05)', () => {
  const brand = {
    'status.offline': 'Değerli üyemiz, şu an kapalıyız.',
    'status.queue': 'Sıranız: {n}',
  };

  it('reads the brand text first, then the catalog, then English, then the key', () => {
    const t = createTranslator('tr', brand);
    expect(t('status.offline')).toBe('Değerli üyemiz, şu an kapalıyız.');
    expect(t('status.queue', { n: 4 })).toBe('Sıranız: 4');
    expect(t('input.placeholder')).toBe(CATALOGS.tr['input.placeholder']);
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('leaves another language and a translator without texts untouched', () => {
    expect(createTranslator('tr')('status.offline')).toBe(CATALOGS.tr['status.offline']);
    // An empty text is no text: the catalog speaks.
    expect(createTranslator('tr', { 'status.offline': '' })('status.offline')).toBe(
      CATALOGS.tr['status.offline'],
    );
  });
});

describe('pickWidgetLocale (WG-02)', () => {
  it('lets the snippet beat the panel, the browser and the fallback', () => {
    expect(
      pickWidgetLocale({ snippet: 'de', panel: 'en', browser: ['tr-TR'], fallback: 'fr' }),
    ).toBe('de');
  });

  it('uses the panel language over the browser unless it is auto', () => {
    expect(pickWidgetLocale({ panel: 'en', browser: ['tr-TR'], fallback: 'tr' })).toBe('en');
    expect(pickWidgetLocale({ panel: 'auto', browser: ['tr-TR'], fallback: 'en' })).toBe('tr');
  });

  it('reads auto from the first browser language it ships, by primary subtag', () => {
    expect(pickWidgetLocale({ panel: 'auto', browser: ['ja', 'PT-br', 'de'] })).toBe('pt');
    expect(pickWidgetLocale({ panel: 'auto', browser: ['ar-EG'] })).toBe('ar');
  });

  it('falls to the panel fallback when the browser speaks none of them', () => {
    expect(pickWidgetLocale({ panel: 'auto', browser: ['ja', 'zh-CN'], fallback: 'tr' })).toBe(
      'tr',
    );
    expect(pickWidgetLocale({ panel: 'auto', browser: [], fallback: 'de' })).toBe('de');
  });

  it('ends in English when nothing is known, as it did before the setting', () => {
    expect(pickWidgetLocale({})).toBe('en');
    expect(pickWidgetLocale({ browser: ['ja'], fallback: 'xx' })).toBe('en');
  });

  it('passes over a snippet language it does not ship', () => {
    expect(pickWidgetLocale({ snippet: 'ru', browser: ['tr'] })).toBe('tr');
    expect(pickWidgetLocale({ snippet: 'ru', panel: 'de', browser: ['tr'] })).toBe('de');
  });

  it('reads navigator.languages, else navigator.language', () => {
    expect(browserLanguages({ language: 'en-US', languages: ['tr-TR', 'en'] })).toEqual([
      'tr-TR',
      'en',
    ]);
    expect(browserLanguages({ language: 'de-DE', languages: [] })).toEqual(['de-DE']);
    expect(browserLanguages({ language: '', languages: [] })).toEqual([]);
  });

  it('is built on the same eight languages the panel and the database allow', () => {
    expect([...WIDGET_UI_LOCALES].sort()).toEqual(Object.keys(CATALOGS).sort());
  });
});
