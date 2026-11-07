import { describe, expect, it } from 'vitest';
import { DEFAULT_WIDGET_APPEARANCE, normalizeWidgetAppearance } from './widget.js';

describe('widget draft preview switch (tm 417 · FR-MOD-02.9)', () => {
  it('is on until the workspace turns it off, and only a boolean turns it off', () => {
    expect(DEFAULT_WIDGET_APPEARANCE.sneak_peek_enabled).toBe(true);
    expect(normalizeWidgetAppearance(null).sneak_peek_enabled).toBe(true);
    expect(normalizeWidgetAppearance({}).sneak_peek_enabled).toBe(true);
    expect(
      normalizeWidgetAppearance({ sneak_peek_enabled: 'no' as never }).sneak_peek_enabled,
    ).toBe(true);
    expect(normalizeWidgetAppearance({ sneak_peek_enabled: false }).sneak_peek_enabled).toBe(false);
  });
});
