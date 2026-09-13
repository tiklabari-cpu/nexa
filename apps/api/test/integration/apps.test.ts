/**
 * Apps marketplace (FR-MOD-09.1 / 09.2).
 *
 * The property the feature turns on is the KK "Kart → izin/OAuth akışı;
 * bağlanınca veri sohbet içinde": a card is connected through a (mock) OAuth
 * flow and then appears connected, and once connected its data is read inside a
 * conversation. Around that sit the guards that keep it honest — the OAuth state
 * is verified so a tampered one is refused, the admin/agent scope split holds,
 * disconnect is a real removal, and one tenant never sees or touches another's.
 *
 * 09.2's own criterion ("Her biri OAuth/API key") adds a second connection path
 * and a property that only holds if the two stay apart: `provider` has to select
 * the path, so each one refuses the other's card. The API-key half also carries
 * a secrecy claim the OAuth half never had — the pasted key is stored as a hash
 * and shown as four characters — and that claim is asserted against the response,
 * the log and the row, not against the code that is supposed to produce them.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface AppInstallation {
  app_id: string;
  status: string;
  external_account: string;
  scopes: string[];
  connected_at: string;
  api_key_last_four: string | null;
}

interface AppListItem {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string;
  channel: string | null;
  collections: string[];
  pricing: string;
  placement: string;
  installed: boolean;
  installation: AppInstallation | null;
}

interface AppOAuthStart {
  authorize_url: string;
  state: string;
}

interface AppChatData {
  app_id: string;
  app_name: string;
  fields: Array<{ label: string; value: string }>;
}

/** A `provider: 'oauth'` card — the OAuth pair's subject. */
const APP = 'hubspot';
/** A `provider: 'api_key'` card, and not a channel one — the connect path's subject. */
const KEY_APP = 'zendesk';
/** Long enough to clear `APP_API_KEY_MIN_LENGTH`, and unmistakable in a log. */
const API_KEY = 'zd-live-never-logged-2f9c41';

describe('apps marketplace (FR-MOD-09.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  interface AppListPage {
    items: AppListItem[];
    total: number;
    next_page_id?: string;
  }

  /** A successful read of the list, envelope and all (`?…` appended verbatim). */
  const page = async (token: string, params = ''): Promise<AppListPage> => {
    const response = await server.get(`/settings/apps${params}`, auth(token));
    expect(response.statusCode).toBe(200);
    return response.json() as AppListPage;
  };

  const list = async (token: string): Promise<AppListItem[]> => (await page(token)).items;

  /** A rejected read — the status and the error type the envelope carries (ADR-06). */
  const rejected = async (
    token: string,
    params: string,
  ): Promise<{ status: number; type: string }> => {
    const response = await server.get(`/settings/apps${params}`, auth(token));
    return {
      status: response.statusCode,
      type: (response.json() as { error: { type: string } }).error.type,
    };
  };

  /** Walks the whole result set through `next_page_id`, returning items, ids and totals in order. */
  const walk = async (
    token: string,
    params: string,
  ): Promise<{ items: AppListItem[]; ids: string[]; totals: number[] }> => {
    const items: AppListItem[] = [];
    const ids: string[] = [];
    const totals: number[] = [];
    let cursor: string | undefined;
    // Bounded (comfortably above the mock catalogue's size) so a cursor that
    // fails to advance fails the test instead of hanging.
    for (let request = 0; request < 200; request += 1) {
      const result = await page(
        token,
        `${params}${cursor ? `&page_id=${encodeURIComponent(cursor)}` : ''}`,
      );
      items.push(...result.items);
      ids.push(...result.items.map((item) => item.id));
      totals.push(result.total);
      if (!result.next_page_id) return { items, ids, totals };
      cursor = result.next_page_id;
    }
    throw new Error('pagination did not terminate');
  };

  const findItem = (items: AppListItem[], id: string): AppListItem =>
    items.find((item) => item.id === id) as AppListItem;

  // The mock OAuth flow, start → callback, returning the now-connected card.
  const connect = async (token: string, appId = APP): Promise<AppListItem> => {
    const started = await server.post(`/settings/apps/${appId}/oauth/start`, {}, auth(token));
    expect(started.statusCode).toBe(200);
    const { state } = started.json() as AppOAuthStart;
    const done = await server.post(
      `/settings/apps/${appId}/oauth/callback`,
      { state, code: 'mock-auth-code' },
      auth(token),
    );
    expect(done.statusCode).toBe(200);
    return done.json() as AppListItem;
  };

  /** The API-key path: one POST carrying the pasted key (09.2). */
  const connectWithKey = async (
    token: string,
    appId = KEY_APP,
    apiKey = API_KEY,
  ): Promise<{ status: number; body: unknown }> => {
    const response = await server.post(
      `/settings/apps/${appId}/connect`,
      { api_key: apiKey },
      auth(token),
    );
    return { status: response.statusCode, body: response.json() };
  };

  const openChat = async (token: string, customerId: string): Promise<string> => {
    const response = await server.post('/chats', { customer_id: customerId }, auth(token));
    expect([200, 201]).toContain(response.statusCode);
    return (response.json() as { id: string }).id;
  };

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      // Admin scope to manage apps, chat scope to open a chat and read its apps.
      scopes: ['access_rules:rw', 'chats--all:rw'],
    });
  });

  // --- The requirement: mock OAuth → connected appears -----------------------

  it('connects an app through the mock OAuth flow and shows it installed', async () => {
    const before = findItem(await list(adminToken), APP);
    expect(before.installed).toBe(false);
    expect(before.installation).toBeNull();

    const connected = await connect(adminToken);
    expect(connected.installed).toBe(true);
    expect(connected.installation?.status).toBe('connected');
    expect(connected.installation?.external_account).toBeTruthy();
    expect(connected.installation?.scopes.length).toBeGreaterThan(0);

    // And it stays connected on a fresh list.
    const after = findItem(await list(adminToken), APP);
    expect(after.installed).toBe(true);
    expect(after.installation?.external_account).toBe(connected.installation?.external_account);
  });

  // --- The requirement: once connected, data appears in the conversation -----

  it('surfaces a connected app’s data inside a conversation', async () => {
    const chatId = await openChat(adminToken, fx.a.customerId);

    // Nothing connected yet → no app data in the chat.
    const empty = await server.get(`/chats/${chatId}/apps`, auth(adminToken));
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { items: AppChatData[] }).items).toHaveLength(0);

    await connect(adminToken);

    const withApp = await server.get(`/chats/${chatId}/apps`, auth(adminToken));
    expect(withApp.statusCode).toBe(200);
    const items = (withApp.json() as { items: AppChatData[] }).items;
    const entry = items.find((item) => item.app_id === APP);
    expect(entry).toBeDefined();
    expect(entry?.fields.length).toBeGreaterThan(0);
    for (const field of entry!.fields) {
      expect(field.label).toBeTruthy();
      expect(field.value).toBeTruthy();
    }
  });

  // --- Disconnect ------------------------------------------------------------

  it('disconnects a connected app, and 404s a second disconnect', async () => {
    await connect(adminToken);
    const removed = await server.del(`/settings/apps/${APP}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);

    expect(findItem(await list(adminToken), APP).installed).toBe(false);

    // Disconnecting what is not connected cannot be told from another tenant's.
    const again = await server.del(`/settings/apps/${APP}`, auth(adminToken));
    expect(again.statusCode).toBe(404);
  });

  // --- OAuth state integrity -------------------------------------------------

  it('refuses a tampered or mismatched OAuth state', async () => {
    const started = await server.post(`/settings/apps/${APP}/oauth/start`, {}, auth(adminToken));
    const { state } = started.json() as AppOAuthStart;

    // A flipped last character breaks the HMAC.
    const tampered = state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A');
    const bad = await server.post(
      `/settings/apps/${APP}/oauth/callback`,
      { state: tampered, code: 'mock-auth-code' },
      auth(adminToken),
    );
    expect(bad.statusCode).toBe(400);

    // A valid state for one app cannot connect another.
    const wrongApp = await server.post(
      `/settings/apps/shopify/oauth/callback`,
      { state, code: 'mock-auth-code' },
      auth(adminToken),
    );
    expect(wrongApp.statusCode).toBe(400);
  });

  it('404s the OAuth flow for an app that does not exist', async () => {
    const started = await server.post(
      '/settings/apps/not-an-app/oauth/start',
      {},
      auth(adminToken),
    );
    expect(started.statusCode).toBe(404);
  });

  // --- The second half of 09.2's criterion: connecting with an API key -------

  it('connects an api_key card with the pasted key and shows it installed (FR-MOD-09.2)', async () => {
    const before = findItem(await list(adminToken), KEY_APP);
    expect(before.provider).toBe('api_key');
    expect(before.installed).toBe(false);

    const { status, body } = await connectWithKey(adminToken);
    expect(status).toBe(200);
    const connected = body as AppListItem;
    expect(connected.installed).toBe(true);
    expect(connected.installation?.status).toBe('connected');
    // A pasted key names no account, so what identifies the connection is the
    // key's tail — the whole of what the product may show about it.
    expect(connected.installation?.api_key_last_four).toBe('9c41');
    expect(connected.installation?.external_account).toBe('••••9c41');

    // And it stays connected on a fresh list, which is the KK's actual claim
    // (the card reads Connected afterwards, not merely that a POST returned 200).
    const after = findItem(await list(adminToken), KEY_APP);
    expect(after.installed).toBe(true);
    expect(after.installation?.api_key_last_four).toBe('9c41');

    // Re-connecting rotates the key rather than erroring — same call, new tail.
    const rotated = await connectWithKey(adminToken, KEY_APP, 'zd-live-rotated-key-77ab');
    expect(rotated.status).toBe(200);
    expect((rotated.body as AppListItem).installation?.api_key_last_four).toBe('77ab');
    expect(
      await owner.appInstallation.count({ where: { licenseId: fx.a.licenseId, appId: KEY_APP } }),
    ).toBe(1);

    // An OAuth card is untouched by any of it: still not connected.
    expect(findItem(await list(adminToken), APP).installed).toBe(false);
  });

  it('keeps the two connection paths apart — neither serves the other kind of card (FR-MOD-09.2)', async () => {
    // This is the property that makes `provider` a contract rather than a
    // label: before it, both kinds of card went down the same mock handshake
    // and the field changed no behaviour at all.

    // An api_key card cannot be started or completed as an OAuth flow…
    const started = await server.post(
      `/settings/apps/${KEY_APP}/oauth/start`,
      {},
      auth(adminToken),
    );
    expect(started.statusCode).toBe(400);
    expect((started.json() as { error: { type: string } }).error.type).toBe('validation');
    const callback = await server.post(
      `/settings/apps/${KEY_APP}/oauth/callback`,
      { state: 'anything', code: 'mock-auth-code' },
      auth(adminToken),
    );
    expect(callback.statusCode).toBe(400);

    // …and an OAuth card cannot be connected with a key.
    const wrongWay = await connectWithKey(adminToken, APP);
    expect(wrongWay.status).toBe(400);
    expect((wrongWay.body as { error: { type: string } }).error.type).toBe('validation');

    // Neither refusal left anything behind.
    expect(await owner.appInstallation.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    const items = (await page(adminToken, '?limit=100')).items;
    expect(items.every((item) => !item.installed)).toBe(true);
  });

  it('refuses a channel-typed api_key card here too, whichever path is used (FR-MOD-09.2)', async () => {
    // `telegram` is `provider: 'api_key'` *and* a channel. The provider check
    // must not let it past the channel one — a channel is set up in Settings →
    // Channels, and that cross-link is a property the audit found real.
    const channels = (await page(adminToken, '?category=channels&limit=100')).items;
    const telegram = findItem(channels, 'telegram');
    expect(telegram.provider).toBe('api_key');

    const keyed = await connectWithKey(adminToken, 'telegram');
    expect(keyed.status).toBe(400);
    expect((keyed.body as { error: { type: string } }).error.type).toBe('validation');
    expect(
      (await server.post('/settings/apps/telegram/oauth/start', {}, auth(adminToken))).statusCode,
    ).toBe(400);
    expect(await owner.appInstallation.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);

    // And not just this one: *every* channel card is turned away by *both*
    // paths, whichever provider it declares. That is what makes a channel
    // card's `provider` inert rather than a second, quieter connection method —
    // the criterion's "OAuth/API key" is about the cards the marketplace itself
    // connects, and a channel's own setup lives in Settings → Channels.
    expect(channels.length).toBeGreaterThan(1);
    for (const card of channels) {
      expect((await connectWithKey(adminToken, card.id)).status).toBe(400);
      expect(
        (await server.post(`/settings/apps/${card.id}/oauth/start`, {}, auth(adminToken)))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await server.post(
            `/settings/apps/${card.id}/oauth/callback`,
            { state: 'anything', code: 'mock-auth-code' },
            auth(adminToken),
          )
        ).statusCode,
      ).toBe(400);
      // The list keeps saying so, rather than the refusal being the only place
      // a caller can learn it: the card offers no connection of its own.
      expect(card.installed).toBe(false);
      expect(card.installation).toBeNull();
    }
    expect(await owner.appInstallation.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('rejects a key outside the bounds the console validates against (FR-MOD-09.2)', async () => {
    // A client refusing what the server would accept (or the reverse) is the
    // drift `APP_API_KEY_MIN_LENGTH`/`MAX_LENGTH` are shared to prevent, so the
    // endpoint is pinned at both edges rather than somewhere near them.
    expect((await connectWithKey(adminToken, KEY_APP, '')).status).toBe(400);
    expect((await connectWithKey(adminToken, KEY_APP, '   ')).status).toBe(400);
    expect((await connectWithKey(adminToken, KEY_APP, 'x'.repeat(15))).status).toBe(400);
    expect((await connectWithKey(adminToken, KEY_APP, 'x'.repeat(16))).status).toBe(200);
    expect((await connectWithKey(adminToken, KEY_APP, 'y'.repeat(512))).status).toBe(200);
    expect((await connectWithKey(adminToken, KEY_APP, 'y'.repeat(513))).status).toBe(400);

    const missing = await server.post(`/settings/apps/${KEY_APP}/connect`, {}, auth(adminToken));
    expect(missing.statusCode).toBe(400);
    // A key for an app that does not exist is a 404, as everywhere else here.
    const unknown = await server.post(
      '/settings/apps/not-an-app/connect',
      { api_key: API_KEY },
      auth(adminToken),
    );
    expect(unknown.statusCode).toBe(404);
  });

  it('never returns, logs or stores the API key in the clear (FR-MOD-09.2 · NFR-S9)', async () => {
    const { body } = await connectWithKey(adminToken);
    // Not in the response that reports the connection…
    expect(JSON.stringify(body)).not.toContain(API_KEY);
    // …nor in any later read of the card.
    expect(JSON.stringify(await list(adminToken))).not.toContain(API_KEY);

    // In the row: a hash, the tail, and nothing that is the key.
    const row = await owner.appInstallation.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, appId: KEY_APP },
    });
    expect(row.apiKeyHash).toBe(createHash('sha256').update(API_KEY, 'utf8').digest('base64url'));
    expect(row.apiKeyLastFour).toBe('9c41');
    // Every column, not only the two named ones — the claim is that the key is
    // nowhere in the row, and `external_account` is where it would land first.
    expect(Object.values(row).map(String).join('|')).not.toContain(API_KEY);

    // And not in the log, at the level nobody runs in production — which is
    // exactly where a credential gets left behind (device-tokens' pattern).
    class LineSink {
      readonly lines: string[] = [];
      write(chunk: string): boolean {
        this.lines.push(chunk);
        return true;
      }
      end(): void {}
      on(): void {}
      once(): void {}
      emit(): boolean {
        return false;
      }
    }
    const sink = new LineSink();
    const loud = await startTestServer(
      { LOG_LEVEL: 'trace' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
    try {
      const response = await loud.post(
        `/settings/apps/${KEY_APP}/connect`,
        { api_key: API_KEY },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(200);
      const written = sink.lines.join('\n');
      expect(written).not.toContain(API_KEY);
      // Still debuggable — the route survives, only the credential is gone.
      expect(written).toContain(`/settings/apps/${KEY_APP}/connect`);
    } finally {
      await loud.close();
    }
  });

  it('records the same audit entry as the OAuth path, carrying no key (FR-MOD-09.2)', async () => {
    expect((await connectWithKey(adminToken)).status).toBe(200);
    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'app.connected' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.target).toBe(`app_installation:${KEY_APP}`);
    expect(JSON.stringify(entries[0]?.metadata)).not.toContain(API_KEY);
  });

  // --- Channel-typed apps: managed in Channels, not connected here (09.2) -----

  it('lists the full directory and flags channel-typed apps, refusing to connect them here', async () => {
    // The catalogue now exceeds the route's page-size cap (100), so reading
    // the full directory takes a cursor walk rather than one limit=100 page.
    const { items, totals } = await walk(adminToken, '?limit=100');
    const total = totals[0]!;
    // 09.2-v2-e grew the mock catalogue to 100+ cards; no upper bound is asserted.
    expect(total).toBeGreaterThanOrEqual(100);
    expect(items.length).toBe(total);

    // 09.4-a: the two automation-platform cards are in the directory, uninstalled.
    const zapier = findItem(items, 'zapier');
    const make = findItem(items, 'make');
    expect(zapier).toBeDefined();
    expect(make).toBeDefined();
    expect(zapier.category).toBe('productivity');
    expect(make.category).toBe('productivity');
    expect(zapier.installed).toBe(false);
    expect(make.installed).toBe(false);

    // A channel-typed card carries its channel and sits under the Channels section.
    const whatsapp = findItem(items, 'whatsapp');
    expect(whatsapp.channel).toBe('whatsapp');
    expect(whatsapp.category).toBe('channels');
    expect(whatsapp.installed).toBe(false);

    // A data app carries no channel — it is connected in the marketplace.
    expect(findItem(items, APP).channel).toBeNull();

    // A channel is set up in Settings → Channels, so the marketplace OAuth flow
    // and disconnect both refuse it (KK "kanal-tipli olanlar Channels'ta da").
    const started = await server.post('/settings/apps/whatsapp/oauth/start', {}, auth(adminToken));
    expect(started.statusCode).toBe(400);
    const removed = await server.del('/settings/apps/whatsapp', auth(adminToken));
    expect(removed.statusCode).toBe(400);
  });

  // --- Search / category / pagination: rejected input first (09.2-v2-c) ------

  it('rejects a search, category, limit or cursor it cannot honour', async () => {
    // Over the length cap: an unbounded search string is an unbounded read.
    expect(await rejected(adminToken, `?query=${'x'.repeat(321)}`)).toEqual({
      status: 400,
      type: 'validation',
    });
    // …and exactly at the cap it is a normal read, so the bound is the bound.
    expect((await page(adminToken, `?query=${'x'.repeat(320)}`)).total).toBe(0);

    // Page size outside [1, 100], on both ends.
    expect((await rejected(adminToken, '?limit=0')).status).toBe(400);
    expect((await rejected(adminToken, '?limit=101')).status).toBe(400);
    expect((await rejected(adminToken, '?limit=notanumber')).status).toBe(400);

    // A category that names no section of the directory.
    expect(await rejected(adminToken, '?category=not-a-category')).toEqual({
      status: 400,
      type: 'validation',
    });

    // FR-MOD-09.1's remaining filter taxonomy: an unknown value on any of the
    // three new axes is refused exactly like an unknown category.
    expect(await rejected(adminToken, '?collection=not-a-collection')).toEqual({
      status: 400,
      type: 'validation',
    });
    expect(await rejected(adminToken, '?pricing=not-a-pricing')).toEqual({
      status: 400,
      type: 'validation',
    });
    expect(await rejected(adminToken, '?placement=not-a-placement')).toEqual({
      status: 400,
      type: 'validation',
    });

    // A cursor naming no card in the result set is a bad request, not an empty
    // page — otherwise pairing last page's cursor with a new filter would look
    // like "no more results" rather than the mistake it is.
    expect(await rejected(adminToken, '?page_id=not-a-card')).toEqual({
      status: 400,
      type: 'validation',
    });
    expect((await rejected(adminToken, '?category=channels&page_id=hubspot')).status).toBe(400);
  });

  // --- …then the narrowing it does honour ------------------------------------

  it('narrows the directory by search text and by category', async () => {
    const all = await page(adminToken, '?limit=100');

    // Free text matches the card's name or its description, case-insensitively.
    const orders = await page(adminToken, '?query=ORDERS&limit=100');
    expect(orders.items.length).toBeGreaterThan(0);
    expect(orders.items.length).toBeLessThan(all.items.length);
    for (const item of orders.items) {
      expect(`${item.name} ${item.description}`.toLowerCase()).toContain('orders');
    }
    // `total` counts the matches, not the catalogue.
    expect(orders.total).toBe(orders.items.length);

    // A whitespace-only search is no search at all.
    expect((await page(adminToken, '?query=%20%20&limit=100')).total).toBe(all.total);

    // Category narrows to one section — here the channel-typed cards, which is
    // also how the Channels cross-link is browsed (KK 09.2).
    const channels = await page(adminToken, '?category=channels&limit=100');
    expect(channels.items.length).toBeGreaterThan(0);
    for (const item of channels.items) {
      expect(item.category).toBe('channels');
      expect(item.channel).not.toBeNull();
    }
    expect(channels.items.map((item) => item.id)).toContain('whatsapp');
    expect(channels.items.map((item) => item.id)).not.toContain(APP);

    // The two narrow together (intersection), never apart.
    const both = await page(adminToken, '?category=channels&query=whatsapp&limit=100');
    expect(both.items.map((item) => item.id)).toEqual(['whatsapp']);
    expect(both.total).toBe(1);

    // A search that matches nothing is an empty page, not an error.
    const none = await page(adminToken, '?query=no-such-integration&limit=100');
    expect(none.items).toHaveLength(0);
    expect(none.total).toBe(0);
    expect(none.next_page_id).toBeUndefined();
  });

  it('narrows the directory by collection, pricing and placement — alone and intersected (FR-MOD-09.1)', async () => {
    const all = await page(adminToken, '?limit=100');

    // Each axis alone narrows to a proper, non-empty subset, and every
    // returned card actually carries the value asked for.
    const staffPicks = await page(adminToken, '?collection=staff_picks&limit=100');
    expect(staffPicks.items.length).toBeGreaterThan(0);
    expect(staffPicks.items.length).toBeLessThan(all.items.length);
    for (const item of staffPicks.items) expect(item.collections).toContain('staff_picks');
    expect(staffPicks.total).toBe(staffPicks.items.length);

    const free = await page(adminToken, '?pricing=free&limit=100');
    expect(free.items.length).toBeGreaterThan(0);
    expect(free.items.length).toBeLessThan(all.items.length);
    for (const item of free.items) expect(item.pricing).toBe('free');

    const messagebox = await page(adminToken, '?placement=messagebox&limit=100');
    expect(messagebox.items.length).toBeGreaterThan(0);
    expect(messagebox.items.length).toBeLessThan(all.items.length);
    for (const item of messagebox.items) expect(item.placement).toBe('messagebox');
    // Placement's "messagebox" is exactly the channel cross-link.
    expect(messagebox.items.map((item) => item.id).sort()).toEqual(
      (await page(adminToken, '?category=channels&limit=100')).items.map((item) => item.id).sort(),
    );

    // Collection ∩ category composes (intersection, never union) — the same
    // property already pinned for query ∩ category.
    const staffPicksCrm = await page(adminToken, '?collection=staff_picks&category=crm&limit=100');
    for (const item of staffPicksCrm.items) {
      expect(item.category).toBe('crm');
      expect(item.collections).toContain('staff_picks');
    }
    expect(staffPicksCrm.items.length).toBeLessThanOrEqual(staffPicks.items.length);

    // pricing ∩ placement, a pair not sharing either of the above axes.
    const both = await page(adminToken, '?pricing=paid&placement=details&limit=100');
    for (const item of both.items) {
      expect(item.pricing).toBe('paid');
      expect(item.placement).toBe('details');
    }
  });

  it('pages the directory with next_page_id, covering it exactly once', async () => {
    // The catalogue now exceeds the route's page-size cap (100), so reading
    // the full, unfiltered directory in order takes a walk, not one page.
    const all = await walk(adminToken, '?limit=100');

    const walked = await walk(adminToken, '?limit=10');
    // Every card, once, in the catalogue's order — no gaps, no repeats.
    expect(walked.ids).toEqual(all.ids);
    expect(new Set(walked.ids).size).toBe(walked.ids.length);
    // `total` is the match count across all pages, the same on every page.
    expect(walked.totals.every((total) => total === all.totals[0])).toBe(true);

    // One card at a time reaches the same place.
    expect((await walk(adminToken, '?limit=1')).ids).toEqual(walked.ids);

    // Filter and pagination compose: paging a category covers that category and
    // nothing else, while `total` stays the filter's count, not the page's.
    const channels = await page(adminToken, '?category=channels&limit=100');
    const pagedChannels = await walk(adminToken, '?category=channels&limit=2');
    expect(pagedChannels.ids).toEqual(channels.items.map((item) => item.id));
    expect(pagedChannels.totals.every((total) => total === channels.total)).toBe(true);
    expect(channels.total).toBeGreaterThan(2);

    // The same holds for the new axes: the cursor stays sensitive to whichever
    // filter is active, so page two never drifts back to the unfiltered set.
    const staffPicks = await page(adminToken, '?collection=staff_picks&limit=100');
    const pagedStaffPicks = await walk(adminToken, '?collection=staff_picks&limit=2');
    expect(pagedStaffPicks.ids).toEqual(staffPicks.items.map((item) => item.id));
    expect(pagedStaffPicks.totals.every((total) => total === staffPicks.total)).toBe(true);

    // A cursor from the unfiltered walk is unknown once a new filter is applied.
    const unrelatedCursor = all.ids.find((id) => !staffPicks.items.some((i) => i.id === id));
    expect(
      (await rejected(adminToken, `?collection=staff_picks&page_id=${unrelatedCursor}`)).status,
    ).toBe(400);
  });

  it('keeps a connection visible through the filtered and paged read', async () => {
    await connect(adminToken);

    // The card the workspace connected reports it under a search…
    const searched = await page(adminToken, `?query=${APP}&limit=100`);
    expect(findItem(searched.items, APP).installed).toBe(true);

    // …and on whichever page it lands on when paged one at a time.
    const { items: oneByOne } = await walk(adminToken, '?limit=1');
    expect(findItem(oneByOne, APP).installed).toBe(true);
    expect(oneByOne.filter((item) => item.installed)).toHaveLength(1);
  });

  // --- Scope split -----------------------------------------------------------

  it('lets a read-only admin list but not connect', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
    expect((await server.get('/settings/apps', auth(readToken))).statusCode).toBe(200);
    // The narrowing parameters are part of the same read — they do not need,
    // and do not grant, anything beyond `access_rules:ro`.
    expect(
      (await server.get('/settings/apps?query=hub&category=crm&limit=5', auth(readToken)))
        .statusCode,
    ).toBe(200);
    expect(
      (await server.post(`/settings/apps/${APP}/oauth/start`, {}, auth(readToken))).statusCode,
    ).toBe(403);
    // The API-key path is the same admin act, so it sits behind the same scope
    // (09.2) — a read-only admin gets no second way in.
    const keyed = await server.post(
      `/settings/apps/${KEY_APP}/connect`,
      { api_key: API_KEY },
      auth(readToken),
    );
    expect(keyed.statusCode).toBe(403);
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never shows or lets one tenant touch another's connection", async () => {
    await connect(adminToken); // tenant A connects hubspot
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['access_rules:rw', 'chats--all:rw'],
    });

    // B's catalogue shows the same card as not connected.
    expect(findItem(await list(bToken), APP).installed).toBe(false);

    // And no narrowing of that read changes it: not a search that names A's
    // app, not a category, and not any page of a one-card-at-a-time walk. The
    // filter runs against the static catalogue, the installation join stays
    // licence-scoped, so B's every page reports nothing installed (NFR-S5).
    expect(findItem((await page(bToken, `?query=${APP}&limit=100`)).items, APP).installed).toBe(
      false,
    );
    expect(
      (await page(bToken, '?category=crm&limit=100')).items.some((item) => item.installed),
    ).toBe(false);
    // The new axes are static catalogue metadata (like category), so they run
    // the same tenant-independent narrowing — B's install status stays false
    // under any of them too.
    expect(
      (await page(bToken, '?collection=staff_picks&limit=100')).items.some(
        (item) => item.installed,
      ),
    ).toBe(false);
    for (const pageSize of ['?limit=1', '?limit=3', '?limit=100']) {
      const { items } = await walk(bToken, pageSize);
      expect(items.some((item) => item.installed)).toBe(false);
      expect(items.every((item) => item.installation === null)).toBe(true);
    }

    // The API-key connection is scoped the same way (09.2): A connects one, and
    // B's catalogue still reports it unconnected and hands back no key tail.
    expect((await connectWithKey(adminToken)).status).toBe(200);
    const bKeyCard = findItem(await list(bToken), KEY_APP);
    expect(bKeyCard.installed).toBe(false);
    expect(bKeyCard.installation).toBeNull();

    // B cannot disconnect A's app — indistinguishable from it not existing.
    expect((await server.del(`/settings/apps/${APP}`, auth(bToken))).statusCode).toBe(404);
    expect((await server.del(`/settings/apps/${KEY_APP}`, auth(bToken))).statusCode).toBe(404);

    // B cannot read app data on A's chat.
    const chatId = await openChat(adminToken, fx.a.customerId);
    expect((await server.get(`/chats/${chatId}/apps`, auth(bToken))).statusCode).toBe(404);
  });
});
