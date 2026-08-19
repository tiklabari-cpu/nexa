/**
 * Widget RTL layout smoke test (NFR-I18N1).
 *
 * `i18n.smoke.test.ts` proves locale text reaches the DOM; this proves the
 * direction-dependent half — `dir="rtl"` on the document element for Arabic,
 * and that the fixed-position rules (launcher, greeting card) are written with
 * logical CSS (`inset-inline-*`) rather than `left`/`right`, so they mirror
 * instead of staying pinned to the physical side once RTL is set. jsdom does
 * not run layout, so this checks the injected stylesheet's source and the
 * resulting document attributes rather than rendered pixels.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from './widget.js';

function setupRoot(search: string): void {
  window.history.replaceState({}, '', `/widget.html${search}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.replaceChildren(root);
}

afterEach(() => {
  document.body.replaceChildren();
  // `buildUi` injects a <style> into the head each mount; clear it so every
  // case starts from an identical document.
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
  window.history.replaceState({}, '', '/');
});

describe('widget RTL mount', () => {
  it('sets dir="rtl" and lang="ar" for Arabic', () => {
    setupRoot('?organization_id=org-1&language=ar');
    mount(document, window);

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.querySelector('.nx-send')?.textContent).toBe('إرسال');
  });

  it('sets dir="ltr" and the matching lang for every non-Arabic locale', () => {
    for (const language of ['en', 'tr', 'de', 'fr', 'es', 'it', 'pt']) {
      setupRoot(`?organization_id=org-1&language=${language}`);
      mount(document, window);

      expect(document.documentElement.dir, language).toBe('ltr');
      expect(document.documentElement.lang, language).toBe(language);

      document.body.replaceChildren();
      document.head.querySelectorAll('style').forEach((style) => style.remove());
    }
  });

  it('falls back to ltr/en for an unrecognised language', () => {
    setupRoot('?organization_id=org-1&language=ja');
    mount(document, window);

    expect(document.documentElement.dir).toBe('ltr');
    expect(document.documentElement.lang).toBe('en');
  });

  it('positions the launcher and greeting card with logical CSS, not left/right', () => {
    setupRoot('?organization_id=org-1&language=ar');
    mount(document, window);

    const css = document.head.querySelector('style')?.textContent ?? '';
    expect(css).toContain('inset-inline-end');
    expect(css).toContain('inset-inline-start');
    // Regression guard: these two rules used to set `right`/`left` directly,
    // which stays pinned to the physical side under dir="rtl" instead of
    // mirroring to the reading-direction end/start.
    expect(css).not.toMatch(/\.nx-launcher\s*\{[^}]*\bright:/);
    expect(css).not.toMatch(/\.nx-greeting\s*\{[^}]*\bright:/);
    expect(css).not.toMatch(/\.nx-left \.nx-launcher\s*\{[^}]*\bleft:/);
    expect(css).not.toMatch(/\.nx-left \.nx-greeting\s*\{[^}]*\bleft:/);
  });
});
