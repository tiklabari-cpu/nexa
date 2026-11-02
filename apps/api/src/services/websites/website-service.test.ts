import {
  DEFAULT_WIDGET_APPEARANCE,
  WIDGET_UI_LOCALES,
  type WidgetAppearance,
} from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { WebsiteService } from './website-service.js';

const ORG = '0b9f6a52-7c8d-4f0e-9a43-2a1d5c3e7b10';
const service = new WebsiteService('https://widget.siyahtus.test/');

const appearance = (patch: Partial<WidgetAppearance>): WidgetAppearance => ({
  ...DEFAULT_WIDGET_APPEARANCE,
  ...patch,
});

describe('WebsiteService.snippet', () => {
  it('keeps the two scripts it always had, before the <noscript> line (FR-MOD-08.5.2)', () => {
    const lines = service.snippet(ORG).split('\n');
    expect(lines[0]).toBe('<!-- SiyahTuş widget -->');
    expect(lines[1]).toBe('<script>');
    expect(lines[2]).toBe(
      `  window.__siyahtus = { organizationId: "${ORG}", widgetOrigin: "https://widget.siyahtus.test" };`,
    );
    expect(lines[3]).toBe('</script>');
    expect(lines[4]).toBe('<script async src="https://widget.siyahtus.test/loader.js"></script>');
    expect(lines).toHaveLength(6);
  });

  it('links the <noscript> fallback to the hosted Chat page of this tenant (FR-MOD-08.5.2)', () => {
    const last = service.snippet(ORG).split('\n').at(-1);
    expect(last).toBe(
      `<noscript><a href="https://widget.siyahtus.test/chat.html?organization_id=${ORG}" lang="tr">Bizimle sohbet edin</a></noscript>`,
    );
  });

  it('follows the widget language, else the language auto falls back to (FR-MOD-08.5.2)', () => {
    const text = (patch: Partial<WidgetAppearance>): string =>
      service.snippet(ORG, appearance(patch)).split('\n').at(-1) ?? '';
    expect(text({ language: 'en' })).toContain('lang="en">Chat with us</a>');
    expect(text({ language: 'de' })).toContain('>Chatten Sie mit uns</a>');
    // `auto` is unknowable at paste time: the fallback language speaks.
    expect(text({ language: 'auto', fallback_language: 'fr' })).toContain(
      'lang="fr">Discutez avec nous</a>',
    );
    // A pinned language beats the fallback.
    expect(text({ language: 'es', fallback_language: 'fr' })).toContain('lang="es"');
    // Arabic reads right to left.
    expect(text({ language: 'ar' })).toContain('lang="ar" dir="rtl">');
    expect(text({ language: 'en' })).not.toContain('dir=');
  });

  it('has a line for every widget language, each a plain sentence (FR-MOD-08.5.2)', () => {
    for (const locale of WIDGET_UI_LOCALES) {
      const last =
        service
          .snippet(ORG, appearance({ language: locale }))
          .split('\n')
          .at(-1) ?? '';
      const match =
        /^<noscript><a href="[^"]+" lang="[a-z]{2}"(?: dir="rtl")?>([^<>"&]+)<\/a><\/noscript>$/.exec(
          last,
        );
      expect(match, locale).not.toBeNull();
      expect(match?.[1]?.length).toBeGreaterThan(3);
    }
  });

  it('cannot be turned into markup by the identifier or the appearance (FR-MOD-08.5.2)', () => {
    // The id is a validated UUID upstream; encoding it is the second line of
    // defence, and an appearance with a forged language falls back to tr.
    const hostile = service.snippet(
      '"><script>x</script>',
      appearance({ language: '"><b>' as never, fallback_language: 'tr' }),
    );
    const noscript = hostile.split('\n').at(-1) ?? '';
    expect(noscript).not.toContain('<script>');
    expect(noscript).toContain('organization_id=%22%3E%3Cscript%3Ex%3C%2Fscript%3E');
  });

  it('is unchanged for the fields the loader reads (FR-MOD-11.7)', () => {
    const custom = service.snippet(
      ORG,
      appearance({ primary_color: '#e11d48', powered_by: false }),
    );
    expect(custom).toContain('primaryColor: "#e11d48"');
    expect(custom).toContain('poweredBy: false');
    expect(custom).not.toContain('language:');
  });
});
