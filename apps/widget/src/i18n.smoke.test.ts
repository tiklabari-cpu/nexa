/**
 * Widget mount locale smoke test (I18N1).
 *
 * The unit tests prove `createTranslator` in isolation; this proves the wiring
 * that actually reaches the visitor: `data-language` → loader query string →
 * `readConfig` → `createTranslator` → the DOM the widget writes by hand. Mount
 * the real widget document with `language=tr` and the visible chrome must come
 * out Turkish. This is the widget's counterpart to the panel's locale smoke —
 * the widget has no runtime language switcher (its locale is fixed for the page
 * load), so "locale değişince metin değişir" is proven at mount instead.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from './widget.js';

/** Point the document at `/widget.html<search>` and give it a mount root. */
function setupRoot(search: string): void {
  window.history.replaceState({}, '', `/widget.html${search}`);
  const root = document.createElement('div');
  root.id = 'nexa-widget-root';
  document.body.replaceChildren(root);
}

afterEach(() => {
  document.body.replaceChildren();
  // `buildUi` injects a <style> into the head each mount; clear it so the two
  // cases start from an identical document.
  document.head.querySelectorAll('style').forEach((style) => style.remove());
  window.history.replaceState({}, '', '/');
});

describe('widget mount locale', () => {
  it('renders the launcher and panel chrome in Turkish when language=tr', () => {
    setupRoot('?organization_id=org-1&language=tr');
    mount(document, window);

    const launcher = document.querySelector('.nx-launcher');
    expect(launcher?.textContent).toBe('Sohbet');
    expect(launcher?.getAttribute('aria-label')).toBe('Sohbeti aç');

    expect(document.querySelector('.nx-panel')?.getAttribute('aria-label')).toBe(
      'Müşteri destek sohbeti',
    );
    expect(document.querySelector('.nx-title')?.textContent).toBe('Bizimle sohbet edin');
    expect(document.querySelector('.nx-send')?.textContent).toBe('Gönder');

    // A real relabel, not English joined by Turkish: the default strings are gone.
    expect(document.body.textContent).not.toContain('Chat with us');
  });

  it('falls back to English chrome when no language is configured', () => {
    setupRoot('?organization_id=org-1');
    mount(document, window);

    expect(document.querySelector('.nx-launcher')?.textContent).toBe('Chat');
    expect(document.querySelector('.nx-title')?.textContent).toBe('Chat with us');
    expect(document.querySelector('.nx-send')?.textContent).toBe('Send');
  });

  it('resolves a region-tagged tag (tr-TR) to Turkish', () => {
    setupRoot('?organization_id=org-1&language=tr-TR');
    mount(document, window);

    expect(document.querySelector('.nx-launcher')?.textContent).toBe('Sohbet');
  });
});
