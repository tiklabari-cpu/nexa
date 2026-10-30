import { describe, expect, it } from 'vitest';
import {
  brandLogoUrl,
  DEFAULT_WIDGET_APPEARANCE,
  isWidgetLauncherVisibility,
  normalizeWidgetAppearance,
  WIDGET_LAUNCHER_VISIBILITIES,
} from './widget.js';

describe('launcher visibility and logo (WG-10)', () => {
  it('knows the three modes and defaults to always, logo off', () => {
    expect(WIDGET_LAUNCHER_VISIBILITIES).toEqual(['always', 'until_opened', 'never']);
    expect(DEFAULT_WIDGET_APPEARANCE.launcher_visibility).toBe('always');
    expect(DEFAULT_WIDGET_APPEARANCE.show_logo).toBe(false);
    expect(isWidgetLauncherVisibility('until_opened')).toBe(true);
    expect(isWidgetLauncherVisibility('hidden')).toBe(false);
    expect(isWidgetLauncherVisibility(undefined)).toBe(false);
  });

  it('normalises an unknown mode or a non-boolean flag back to the defaults', () => {
    const bad = normalizeWidgetAppearance({
      launcher_visibility: 'sometimes' as never,
      show_logo: 'yes' as never,
    });
    expect(bad.launcher_visibility).toBe('always');
    expect(bad.show_logo).toBe(false);
    const good = normalizeWidgetAppearance({ launcher_visibility: 'never', show_logo: true });
    expect(good.launcher_visibility).toBe('never');
    expect(good.show_logo).toBe(true);
  });

  it('lets a logo through only as an https URL without credentials', () => {
    expect(brandLogoUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
    expect(brandLogoUrl('  https://cdn.example.com/a.svg ')).toBe('https://cdn.example.com/a.svg');
    for (const bad of [
      'http://cdn.example.com/logo.png',
      'javascript:alert(1)',
      'data:image/svg+xml;base64,AAAA',
      '//cdn.example.com/logo.png',
      '/uploads/logo.png',
      'https://user:pw@cdn.example.com/logo.png',
      '',
      null,
      42,
      `https://x.example/${'a'.repeat(2100)}`,
    ]) {
      expect(brandLogoUrl(bad)).toBeNull();
    }
  });
});
