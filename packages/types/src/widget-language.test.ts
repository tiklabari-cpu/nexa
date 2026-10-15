import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIDGET_APPEARANCE,
  WIDGET_UI_LOCALES,
  isWidgetUiLocale,
  normalizeWidgetAppearance,
} from './widget.js';

describe('widget language (WG-02)', () => {
  it('defaults to automatic with the new-workspace fallback, Turkish', () => {
    expect(DEFAULT_WIDGET_APPEARANCE.language).toBe('auto');
    expect(DEFAULT_WIDGET_APPEARANCE.fallback_language).toBe('tr');
    expect(normalizeWidgetAppearance(null)).toMatchObject({
      language: 'auto',
      fallback_language: 'tr',
    });
  });

  it('ships exactly the eight languages — no RU/AZ (K25)', () => {
    expect([...WIDGET_UI_LOCALES]).toEqual(['en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar']);
    expect(isWidgetUiLocale('ru')).toBe(false);
    expect(isWidgetUiLocale('az')).toBe(false);
    expect(isWidgetUiLocale('auto')).toBe(false);
  });

  it('keeps a valid language and fallback', () => {
    expect(normalizeWidgetAppearance({ language: 'ar', fallback_language: 'de' })).toMatchObject({
      language: 'ar',
      fallback_language: 'de',
    });
    expect(normalizeWidgetAppearance({ language: 'auto' }).language).toBe('auto');
  });

  it('reads an unusable language as the default, never as a language', () => {
    const bad = normalizeWidgetAppearance({
      language: 'ru' as never,
      fallback_language: 'auto' as never,
    });
    expect(bad.language).toBe('auto');
    expect(bad.fallback_language).toBe('tr');
  });
});
