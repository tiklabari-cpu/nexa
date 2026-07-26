import { describe, expect, it } from 'vitest';
import {
  APP_CATALOG,
  APP_CATEGORIES,
  APP_PROVIDERS,
  appChatData,
  findApp,
  isAppId,
} from './apps.js';

describe('app catalogue', () => {
  it('has unique ids and complete cards', () => {
    const ids = APP_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of APP_CATALOG) {
      expect(entry.name).not.toBe('');
      expect(APP_CATEGORIES).toContain(entry.category);
      expect(APP_PROVIDERS).toContain(entry.provider);
      // A card that asks for no permission has no consent step to show.
      expect(entry.scopes.length).toBeGreaterThan(0);
      // A connected app must surface at least one field, or it shows nothing.
      expect(entry.dataFields.length).toBeGreaterThan(0);
      for (const field of entry.dataFields) expect(field.options.length).toBeGreaterThan(0);
    }
  });

  it('resolves ids and rejects unknown ones', () => {
    expect(findApp(APP_CATALOG[0]!.id)?.id).toBe(APP_CATALOG[0]!.id);
    expect(findApp('not-an-app')).toBeUndefined();
    expect(isAppId(APP_CATALOG[0]!.id)).toBe(true);
    expect(isAppId('not-an-app')).toBe(false);
    expect(isAppId(42)).toBe(false);
  });
});

describe('appChatData (deterministic mock)', () => {
  const app = findApp('hubspot')!;

  it('produces one value per field, drawn from that field’s options', () => {
    const data = appChatData(app, 'ada@example.com');
    expect(data.app_id).toBe('hubspot');
    expect(data.fields).toHaveLength(app.dataFields.length);
    for (const field of data.fields) {
      const source = app.dataFields.find((f) => f.label === field.label)!;
      expect(source.options).toContain(field.value);
    }
  });

  it('is stable for the same customer and varies across customers', () => {
    const a1 = appChatData(app, 'ada@example.com');
    const a2 = appChatData(app, 'ada@example.com');
    expect(a2).toEqual(a1);

    // Across many seeds at least one produces a different field set, so the
    // stub is keyed off the customer rather than returning a constant.
    const seeds = ['grace@example.com', 'linus@example.com', 'margaret@example.com', 'alan@example.com'];
    const varies = seeds.some(
      (seed) => JSON.stringify(appChatData(app, seed).fields) !== JSON.stringify(a1.fields),
    );
    expect(varies).toBe(true);
  });
});
