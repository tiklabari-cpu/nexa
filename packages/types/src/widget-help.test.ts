import { describe, expect, it } from 'vitest';
import { DEFAULT_WIDGET_APPEARANCE, normalizeWidgetAppearance } from './widget.js';
import { KB_SEARCH_LIMIT, KB_SEARCH_QUERY_MAX, KB_SEARCH_QUERY_MIN } from './widget-help.js';

describe('widget Help tab (WG-12)', () => {
  it('is off until the workspace turns it on, and only a boolean turns it on', () => {
    expect(DEFAULT_WIDGET_APPEARANCE.help_enabled).toBe(false);
    expect(normalizeWidgetAppearance(null).help_enabled).toBe(false);
    expect(normalizeWidgetAppearance({ help_enabled: 'yes' as never }).help_enabled).toBe(false);
    expect(normalizeWidgetAppearance({ help_enabled: true }).help_enabled).toBe(true);
  });

  it('bounds a query and a page the way the API and the database function do', () => {
    expect(KB_SEARCH_QUERY_MIN).toBeLessThan(KB_SEARCH_QUERY_MAX);
    expect(KB_SEARCH_LIMIT.default).toBeLessThanOrEqual(KB_SEARCH_LIMIT.max);
  });
});
