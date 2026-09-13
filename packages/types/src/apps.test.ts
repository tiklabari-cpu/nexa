import { describe, expect, it } from 'vitest';
import { CHANNEL_TYPES } from './domain.js';
import {
  APP_API_KEY_MAX_LENGTH,
  APP_API_KEY_MIN_LENGTH,
  APP_CATALOG,
  APP_CATEGORIES,
  APP_COLLECTIONS,
  APP_PLACEMENTS,
  APP_PRICING_VALUES,
  APP_PROVIDERS,
  PRD_NAMED_INTEGRATIONS,
  appApiKeyLastFour,
  appApiKeyProblem,
  appAutomationChatData,
  appChatData,
  appCollections,
  appPlacement,
  appPricing,
  automationApps,
  channelApps,
  connectableApps,
  filterAppCatalog,
  findApp,
  formatLastRun,
  isAppId,
  isAutomationApp,
  isChannelApp,
  isNewApp,
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
      } else if (isAutomationApp(entry)) {
        // An automation card's figures are read from the workspace, never drawn
        // from a list (FR-MOD-09.4) — so every one of its fields declares a
        // `source` and carries NO options. An option list here is the defect
        // this item closed: a constant that reads like a measurement.
        expect(entry.dataFields?.length ?? 0).toBeGreaterThan(0);
        for (const field of entry.dataFields ?? []) {
          expect(field.source).toBeDefined();
          expect(field.options).toHaveLength(0);
        }
      } else {
        // A connected data app must surface at least one field, or it shows nothing.
        expect(entry.dataFields?.length ?? 0).toBeGreaterThan(0);
        for (const field of entry.dataFields ?? []) {
          expect(field.options.length).toBeGreaterThan(0);
          // Only an automation card computes a value; a mock card must not
          // claim to, or `appChatData` would blank it.
          expect(field.source).toBeUndefined();
        }
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

  // FR-MOD-09.1's remaining filter taxonomy: collections, pricing, placement.
  it('narrows by collection, pricing and placement, each alone', () => {
    for (const collection of APP_COLLECTIONS) {
      const result = filterAppCatalog(APP_CATALOG, { collection });
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(APP_CATALOG.length);
      for (const entry of result) expect(appCollections(entry)).toContain(collection);
    }
    for (const pricing of APP_PRICING_VALUES) {
      const result = filterAppCatalog(APP_CATALOG, { pricing });
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(APP_CATALOG.length);
      for (const entry of result) expect(appPricing(entry)).toBe(pricing);
    }
    for (const placement of APP_PLACEMENTS) {
      const result = filterAppCatalog(APP_CATALOG, { placement });
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(APP_CATALOG.length);
      for (const entry of result) expect(appPlacement(entry)).toBe(placement);
    }
  });

  it('intersects collection, pricing and placement with each other and with category/query', () => {
    const staffPicks = filterAppCatalog(APP_CATALOG, { collection: 'staff_picks' });
    expect(staffPicks.map((e) => e.id)).toContain('hubspot');

    // Narrowing further never grows the result.
    const staffPicksCrm = filterAppCatalog(APP_CATALOG, {
      collection: 'staff_picks',
      category: 'crm',
    });
    expect(staffPicksCrm.length).toBeLessThanOrEqual(staffPicks.length);
    for (const entry of staffPicksCrm) expect(entry.category).toBe('crm');

    // pricing ∩ placement composes the same way as any other two axes.
    const both = filterAppCatalog(APP_CATALOG, { pricing: 'free', placement: 'messagebox' });
    for (const entry of both) {
      expect(appPricing(entry)).toBe('free');
      expect(appPlacement(entry)).toBe('messagebox');
    }

    // An axis that matches nothing in the other's result is an empty set, not
    // a fallback to one side.
    const impossible = filterAppCatalog(APP_CATALOG, {
      collection: 'by_text',
      category: 'channels',
    });
    expect(impossible).toEqual([]);
  });
});

// FR-MOD-09.1's taxonomy beyond category: collections, pricing, placement —
// none stored per catalogue entry, all derived so growing the catalogue never
// means hand-authoring a new field on 100+ literals.
describe('appCollections / appPricing / appPlacement', () => {
  it('places the original five under "By Text" and a hand-picked set under "Staff Picks"', () => {
    for (const id of ['hubspot', 'shopify', 'stripe', 'mailchimp', 'google-calendar']) {
      expect(appCollections(findApp(id)!)).toContain('by_text');
    }
    for (const id of ['hubspot', 'shopify', 'stripe', 'slack', 'salesforce', 'zendesk']) {
      expect(appCollections(findApp(id)!)).toContain('staff_picks');
    }
    // A card can carry more than one collection at once.
    expect(appCollections(findApp('hubspot')!)).toEqual(
      expect.arrayContaining(['by_text', 'staff_picks']),
    );
    // Not every card is in every collection.
    expect(appCollections(findApp('jira')!)).not.toContain('by_text');
  });

  it('marks every analytics-category card "AI-Powered" and nothing else', () => {
    for (const entry of APP_CATALOG) {
      expect(appCollections(entry).includes('ai_powered')).toBe(entry.category === 'analytics');
    }
  });

  it('marks "New" for the most recently added connectable cards, never a channel', () => {
    const connectable = connectableApps();
    const newOnes = connectable.filter((entry) => isNewApp(entry));
    expect(newOnes.length).toBeGreaterThan(0);
    expect(newOnes.length).toBeLessThan(connectable.length);
    // They are a contiguous tail of the catalogue's own stable order.
    expect(newOnes.map((e) => e.id)).toEqual(connectable.slice(-newOnes.length).map((e) => e.id));
    for (const entry of channelApps()) expect(isNewApp(entry)).toBe(false);
  });

  it('is a stable, deterministic pricing split with both values represented', () => {
    for (const entry of APP_CATALOG) {
      expect(appPricing(entry)).toBe(appPricing(entry)); // same input, same output
    }
    const values = new Set(APP_CATALOG.map((entry) => appPricing(entry)));
    expect(values).toEqual(new Set(APP_PRICING_VALUES));
  });

  it('places every channel-typed card at "messagebox" and splits the rest', () => {
    for (const entry of channelApps()) expect(appPlacement(entry)).toBe('messagebox');

    const dataPlacements = new Set(connectableApps().map((entry) => appPlacement(entry)));
    // Never messagebox for a connectable (non-channel) card — that value is
    // reserved for the channel cross-link.
    expect(dataPlacements.has('messagebox')).toBe(false);
    expect(dataPlacements.has('details')).toBe(true);
    expect(dataPlacements.has('fullscreen')).toBe(true);
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

/**
 * The automation cards' figures (FR-MOD-09.4). The audit's finding was that
 * Zapier and Make "showed" an active-zap count and a last-run time that were
 * fixed `options` lists — a card that looked like it was reporting and was not.
 * These tests pin the replacement in both directions: the real reader produces
 * the workspace's own numbers, and the mock reader cannot produce a number at
 * all for these cards, so the old shape cannot come back unnoticed.
 */
describe('automation cards read the workspace, not a list of options (FR-MOD-09.4)', () => {
  const zapier = findApp('zapier')!;
  const make = findApp('make')!;

  it('marks exactly the two automation platforms', () => {
    expect(
      automationApps()
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(['make', 'zapier']);
    expect(isAutomationApp(zapier)).toBe(true);
    expect(isAutomationApp(make)).toBe(true);
    expect(isAutomationApp(findApp('hubspot')!)).toBe(false);
  });

  it('shows the registered trigger count and the last run it actually made', () => {
    const now = new Date('2026-03-10T12:00:00.000Z');
    const none = appAutomationChatData(zapier, { triggers: 0, last_run_at: null }, now);
    expect(none.fields).toEqual([
      { label: 'Active zaps', value: '0' },
      { label: 'Last zap run', value: 'Never run' },
    ]);

    const live = appAutomationChatData(
      zapier,
      { triggers: 3, last_run_at: '2026-03-10T09:30:00.000Z' },
      now,
    );
    expect(live.fields).toEqual([
      { label: 'Active zaps', value: '3' },
      { label: 'Last zap run', value: 'Today' },
    ]);

    // Make's labels differ; the values come from the same two sources.
    expect(appAutomationChatData(make, { triggers: 1, last_run_at: null }, now).fields).toEqual([
      { label: 'Active scenarios', value: '1' },
      { label: 'Last run', value: 'Never run' },
    ]);
  });

  // A card with triggers wired but nothing delivered yet is not the same card
  // as one with no triggers — the two figures are independent.
  it('separates "nothing wired" from "wired but never fired"', () => {
    const now = new Date('2026-03-10T12:00:00.000Z');
    const wired = appAutomationChatData(zapier, { triggers: 2, last_run_at: null }, now);
    expect(wired.fields[0]?.value).toBe('2');
    expect(wired.fields[1]?.value).toBe('Never run');
  });

  it('buckets the age of the last run against a supplied clock', () => {
    const now = new Date('2026-03-10T00:30:00.000Z');
    expect(formatLastRun(null, now)).toBe('Never run');
    expect(formatLastRun('not-a-date', now)).toBe('Never run');
    expect(formatLastRun('2026-03-10T00:29:00.000Z', now)).toBe('Today');
    // A run three hours ago crossed midnight: a reader calls that yesterday,
    // which is why the bucket compares calendar days and not elapsed hours.
    expect(formatLastRun('2026-03-09T21:30:00.000Z', now)).toBe('Yesterday');
    expect(formatLastRun('2026-03-07T12:00:00.000Z', now)).toBe('3 days ago');
    expect(formatLastRun('2026-02-28T12:00:00.000Z', now)).toBe('1 weeks ago');
    expect(formatLastRun('2026-01-01T12:00:00.000Z', now)).toBe('Over a month ago');
    // A clock skew that puts the run in the future reads as "Today" rather than
    // a negative age.
    expect(formatLastRun('2026-03-11T00:00:00.000Z', now)).toBe('Today');
  });

  // The loud failure mode: the mock reader has nothing to draw from for these
  // cards, so routing one through it shows em-dashes instead of a believable
  // number. That is the property that makes the split safe.
  it('yields no figure at all when read through the customer-data mock', () => {
    for (const seed of ['ada@example.com', 'grace@example.com']) {
      expect(appChatData(zapier, seed).fields.map((f) => f.value)).toEqual(['—', '—']);
      expect(appChatData(make, seed).fields.map((f) => f.value)).toEqual(['—', '—']);
    }
  });
});
