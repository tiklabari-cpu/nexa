import { describe, expect, it } from 'vitest';
import { CHANNEL_TYPES } from './domain.js';
import {
  APP_API_KEY_MAX_LENGTH,
  APP_API_KEY_MIN_LENGTH,
  APP_CATALOG,
  APP_CATEGORIES,
  APP_PROVIDERS,
  PRD_NAMED_INTEGRATIONS,
  appApiKeyLastFour,
  appApiKeyProblem,
  appChatData,
  channelApps,
  connectableApps,
  filterAppCatalog,
  findApp,
  isAppId,
  isChannelApp,
  maskApiKey,
  paginateApps,
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
  // 09.2-v2-e grew the mock catalogue to 100+ cards; no upper bound is asserted.
  it('is the full mock directory (100+ cards) across both provider kinds', () => {
    expect(APP_CATALOG.length).toBeGreaterThanOrEqual(100);
    const providers = new Set(APP_CATALOG.map((entry) => entry.provider));
    expect(providers.has('oauth')).toBe(true);
    expect(providers.has('api_key')).toBe(true);
  });

  // FR-MOD-09.2's other half of "full": the row names fifteen integrations by
  // hand, and the 100+ floor above cannot tell you they are all there. Looked
  // up the way the console looks one up — free-text search over name and
  // description — because a card nobody can find by the requirement's own name
  // is not in the directory as far as a user is concerned (FR-MOD-09.2).
  it('carries every integration the requirement names, findable by that name', () => {
    const missing = PRD_NAMED_INTEGRATIONS.filter(
      (name) => filterAppCatalog(APP_CATALOG, { query: name }).length === 0,
    );
    expect(missing).toEqual([]);
    // Channel-typed and data cards both: the row's list crosses the partition,
    // so a "full" directory that dropped either side would still fail here.
    expect(filterAppCatalog(APP_CATALOG, { query: 'WhatsApp' })[0]?.channel).toBe('whatsapp');
    expect(filterAppCatalog(APP_CATALOG, { query: 'Medusa' })[0]?.channel).toBeUndefined();
    // Adobe renamed Magento; both names reach the one card, and its id — what
    // an installation row is keyed by — did not move with the rename.
    expect(filterAppCatalog(APP_CATALOG, { query: 'magento' }).map((e) => e.id)).toEqual([
      'magento',
    ]);
    expect(filterAppCatalog(APP_CATALOG, { query: 'adobe commerce' }).map((e) => e.id)).toEqual([
      'magento',
    ]);
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

  // 09.4-a: Zapier + Make marketplace cards, one OAuth and one API-key, both
  // connectable data apps (not channel-typed) that surface in-chat fields.
  it('lists Zapier and Make as connectable productivity apps', () => {
    const zapier = findApp('zapier');
    const make = findApp('make');
    expect(zapier).toBeDefined();
    expect(make).toBeDefined();
    expect(zapier!.category).toBe('productivity');
    expect(make!.category).toBe('productivity');
    expect(zapier!.provider).toBe('oauth');
    expect(make!.provider).toBe('api_key');
    expect(isChannelApp(zapier!)).toBe(false);
    expect(isChannelApp(make!)).toBe(false);
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
    const seeds = [
      'grace@example.com',
      'linus@example.com',
      'margaret@example.com',
      'alan@example.com',
    ];
    const varies = seeds.some(
      (seed) => JSON.stringify(appChatData(app, seed).fields) !== JSON.stringify(a1.fields),
    );
    expect(varies).toBe(true);
  });
});

// 09.2-v2-b: pure filter + pagination over the catalogue.
describe('filterAppCatalog', () => {
  it('narrows by name, case-insensitively', () => {
    const upper = filterAppCatalog(APP_CATALOG, { query: 'HUBSPOT' });
    const lower = filterAppCatalog(APP_CATALOG, { query: 'hubspot' });
    expect(upper.map((e) => e.id)).toEqual(['hubspot']);
    expect(lower.map((e) => e.id)).toEqual(['hubspot']);
  });

  it('narrows by description as well as name', () => {
    // Only HubSpot's description mentions "lifecycle stage".
    const result = filterAppCatalog(APP_CATALOG, { query: 'lifecycle stage' });
    expect(result.map((e) => e.id)).toEqual(['hubspot']);
  });

  it('treats an empty or missing query as "match everything"', () => {
    expect(filterAppCatalog(APP_CATALOG)).toEqual(APP_CATALOG);
    expect(filterAppCatalog(APP_CATALOG, { query: '' })).toEqual(APP_CATALOG);
    expect(filterAppCatalog(APP_CATALOG, { query: '   ' })).toEqual(APP_CATALOG);
  });

  it('narrows by category', () => {
    const result = filterAppCatalog(APP_CATALOG, { category: 'ecommerce' });
    expect(result.length).toBeGreaterThan(0);
    for (const entry of result) expect(entry.category).toBe('ecommerce');
    // Every ecommerce card in the catalogue is present — no over-narrowing.
    const expected = APP_CATALOG.filter((e) => e.category === 'ecommerce').map((e) => e.id);
    expect(result.map((e) => e.id).sort()).toEqual(expected.sort());
  });

  it('intersects query and category rather than unioning them', () => {
    // hubspot (crm) mentions "lifecycle"; salesforce (crm) does not.
    const result = filterAppCatalog(APP_CATALOG, { category: 'crm', query: 'lifecycle' });
    expect(result.map((e) => e.id)).toEqual(['hubspot']);

    // A query that matches something outside the category yields nothing.
    const empty = filterAppCatalog(APP_CATALOG, { category: 'payments', query: 'lifecycle' });
    expect(empty).toEqual([]);
  });
});

describe('paginateApps', () => {
  it('walks the full catalogue exactly once per card (union = catalogue, no repeats)', () => {
    const seen: string[] = [];
    let pageId: string | undefined;
    let pages = 0;
    for (;;) {
      const result = paginateApps(APP_CATALOG, { limit: 10, pageId });
      expect(result).not.toBeNull();
      const { page, total, nextPageId } = result!;
      expect(total).toBe(APP_CATALOG.length);
      seen.push(...page.map((e) => e.id));
      pages += 1;
      if (!nextPageId) break;
      pageId = nextPageId;
      expect(pages).toBeLessThan(APP_CATALOG.length); // guard against an infinite loop
    }
    expect(seen).toHaveLength(APP_CATALOG.length);
    expect(new Set(seen).size).toBe(APP_CATALOG.length);
    expect(seen).toEqual(APP_CATALOG.map((e) => e.id));
    expect(pages).toBeGreaterThan(1);
  });

  it('omits nextPageId on the last page', () => {
    const result = paginateApps(APP_CATALOG, { limit: APP_CATALOG.length })!;
    expect(result.page).toHaveLength(APP_CATALOG.length);
    expect(result.nextPageId).toBeUndefined();
  });

  it('returns one card per page for limit=1, in stable order', () => {
    const first = paginateApps(APP_CATALOG, { limit: 1 })!;
    expect(first.page).toHaveLength(1);
    expect(first.page[0]!.id).toBe(APP_CATALOG[0]!.id);
    expect(first.nextPageId).toBe(APP_CATALOG[0]!.id);

    const second = paginateApps(APP_CATALOG, { limit: 1, pageId: first.nextPageId })!;
    expect(second.page[0]!.id).toBe(APP_CATALOG[1]!.id);
  });

  it('returns null for a cursor that names no entry in the given list', () => {
    expect(paginateApps(APP_CATALOG, { limit: 10, pageId: 'not-a-real-id' })).toBeNull();

    // A cursor valid for the full catalogue but absent from a filtered subset
    // is unknown *for that subset* — the caller always paginates the same
    // (already-filtered) list it started with.
    const payments = filterAppCatalog(APP_CATALOG, { category: 'payments' });
    expect(paginateApps(payments, { limit: 1, pageId: 'hubspot' })).toBeNull();
  });

  it('computes total from the filtered set, not the page length', () => {
    const payments = filterAppCatalog(APP_CATALOG, { category: 'payments' });
    expect(payments.length).toBeGreaterThan(1);

    const result = paginateApps(payments, { limit: 1 })!;
    expect(result.page).toHaveLength(1);
    expect(result.total).toBe(payments.length);
  });
});

// The rule the console's form and `POST /settings/apps/{id}/connect` both apply.
// It lives here precisely so there is one of it: a validator that is stricter
// than its own endpoint silently blocks keys the server would have taken.
describe('API key rule — shared by the form and the endpoint (FR-MOD-09.2)', () => {
  const minimal = 'k'.repeat(APP_API_KEY_MIN_LENGTH);

  it('accepts a key inside the bounds and names what is wrong outside them', () => {
    expect(appApiKeyProblem(minimal)).toBeNull();
    expect(appApiKeyProblem('k'.repeat(APP_API_KEY_MAX_LENGTH))).toBeNull();

    expect(appApiKeyProblem('')).toBe('required');
    expect(appApiKeyProblem('   ')).toBe('required');
    expect(appApiKeyProblem('k'.repeat(APP_API_KEY_MIN_LENGTH - 1))).toBe('too_short');
    expect(appApiKeyProblem('k'.repeat(APP_API_KEY_MAX_LENGTH + 1))).toBe('too_long');
  });

  it('measures the trimmed value, because that is what is stored', () => {
    // Pasting a key with a trailing newline is not an error, and padding a
    // short one with spaces does not make it long enough.
    expect(appApiKeyProblem(`  ${minimal}\n`)).toBeNull();
    expect(appApiKeyProblem(`   ${'k'.repeat(APP_API_KEY_MIN_LENGTH - 1)}   `)).toBe('too_short');
  });

  it('shows four characters and no more', () => {
    expect(appApiKeyLastFour('zd-live-never-logged-2f9c41')).toBe('9c41');
    expect(maskApiKey('zd-live-never-logged-2f9c41')).toBe('••••9c41');
    // The mask is derived from the tail alone, so its length says nothing about
    // the key's — two keys of different lengths mask identically.
    expect(maskApiKey(`${'x'.repeat(200)}9c41`)).toBe('••••9c41');
    expect(maskApiKey(`  ${minimal}kkkk  `)).toBe('••••kkkk');
  });
});
