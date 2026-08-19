/**
 * The widget's i18n primitive: locale resolution, lookup, fallback, interpolation.
 *
 * The translator is bound once at mount (the visitor's locale is fixed for the
 * page load), so the interesting behaviour is all in `createTranslator` and
 * `resolveWidgetLocale`. The fallback is the load-bearing part — a missing key
 * must surface the key itself rather than crash, mirroring the panel (I18N1).
 */
import { describe, expect, it } from 'vitest';
import { createTranslator, isRtlLocale, resolveWidgetLocale } from './i18n.js';

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
