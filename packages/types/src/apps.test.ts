import { describe, expect, it } from 'vitest';
import { CHANNEL_TYPES } from './domain.js';
import {
  APP_CATALOG,
  APP_CATEGORIES,
  APP_PROVIDERS,
  appChatData,
  channelApps,
  connectableApps,
  findApp,
  isAppId,
  isChannelApp,
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
      if (isChannelApp(entry)) {
        // A channel app is set up in Channels, not connected here — no in-chat data.
        expect(entry.dataFields).toBeUndefined();
        expect(entry.dataLabel).toBeUndefined();
      } else {
        // A connected data app must surface at least one field, or it shows nothing.
        expect(entry.dataFields?.length ?? 0).toBeGreaterThan(0);
        for (const field of entry.dataFields ?? []) expect(field.options.length).toBeGreaterThan(0);
      }
    }
  });

  // KK 09.2: "Her biri OAuth/API key" — the full directory, both provider kinds.
  it('is the full directory (15–20 cards) across both provider kinds', () => {
    expect(APP_CATALOG.length).toBeGreaterThanOrEqual(15);
    expect(APP_CATALOG.length).toBeLessThanOrEqual(20);
    const providers = new Set(APP_CATALOG.map((entry) => entry.provider));
    expect(providers.has('oauth')).toBe(true);
    expect(providers.has('api_key')).toBe(true);
  });

  // KK 09.2: "kanal-tipli olanlar Channels'ta da yönetilir" — the cross-link.
  it('cross-links channel-typed apps to a real channel and partitions the rest', () => {
    const channelled = channelApps();
    const data = connectableApps();
    // Both kinds are present, and together they are the whole catalogue.
    expect(channelled.length).toBeGreaterThan(0);
    expect(data.length).toBeGreaterThan(0);
    expect(channelled.length + data.length).toBe(APP_CATALOG.length);

    for (const entry of channelled) {
      // Each channel app names a channel that Channels actually manages.
      expect(CHANNEL_TYPES).toContain(entry.channel);
      expect(entry.category).toBe('channels');
    }
    // A data app carries no channel — it is connected in the marketplace.
    for (const entry of data) expect(entry.channel).toBeUndefined();
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
  // hubspot is a data app, so its fields are present.
  const dataFields = app.dataFields!;

  it('produces one value per field, drawn from that field’s options', () => {
    const data = appChatData(app, 'ada@example.com');
    expect(data.app_id).toBe('hubspot');
    expect(data.fields).toHaveLength(dataFields.length);
    for (const field of data.fields) {
      const source = dataFields.find((f) => f.label === field.label)!;
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
