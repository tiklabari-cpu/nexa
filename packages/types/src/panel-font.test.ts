import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL_FONT_PRESET,
  isPanelFontPreset,
  PANEL_FONT_DESIGNS,
  PANEL_FONT_PRESETS,
} from './panel-font.js';

describe('panel font presets', () => {
  it('is the closed list of five, Inter first and the default', () => {
    expect(PANEL_FONT_PRESETS).toEqual([
      'inter',
      'plus-jakarta',
      'manrope-dm-sans',
      'nunito',
      'figtree',
    ]);
    expect(DEFAULT_PANEL_FONT_PRESET).toBe('inter');
  });

  it('narrows only catalogue keys', () => {
    for (const key of PANEL_FONT_PRESETS) expect(isPanelFontPreset(key)).toBe(true);
    for (const value of ['Inter', 'comic-sans', '', null, 3]) {
      expect(isPanelFontPreset(value)).toBe(false);
    }
  });

  it('has a design for every key and keeps the mono stack out of it', () => {
    expect(Object.keys(PANEL_FONT_DESIGNS).sort()).toEqual([...PANEL_FONT_PRESETS].sort());
    for (const design of Object.values(PANEL_FONT_DESIGNS)) {
      expect(design.body).not.toMatch(/mono/i);
      expect(design.kpiWeight).toBeGreaterThanOrEqual(600);
    }
  });
});
