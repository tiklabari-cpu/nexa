/**
 * Apps marketplace (FR-MOD-09.1).
 *
 * The property the feature turns on is the KK "Kart → izin/OAuth akışı;
 * bağlanınca veri sohbet içinde": a card is connected through a (mock) OAuth
 * flow and then appears connected, and once connected its data is read inside a
 * conversation. Around that sit the guards that keep it honest — the OAuth state
 * is verified so a tampered one is refused, the admin/agent scope split holds,
 * disconnect is a real removal, and one tenant never sees or touches another's.
 */
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
}

interface AppListItem {
  id: string;
  name: string;
  description: string;
  category: string;
  channel: string | null;
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

const APP = 'hubspot';

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
  const rejected = async (token: string, params: string): Promise<{ status: number; type: string }> => {
    const response = await server.get(`/settings/apps${params}`, auth(token));
    return { status: response.statusCode, type: (response.json() as { error: { type: string } }).error.type };
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
      const result = await page(token, `${params}${cursor ? `&page_id=${encodeURIComponent(cursor)}` : ''}`);
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
    const started = await server.post('/settings/apps/not-an-app/oauth/start', {}, auth(adminToken));
    expect(started.statusCode).toBe(404);
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
      (await server.get('/settings/apps?query=hub&category=crm&limit=5', auth(readToken))).statusCode,
    ).toBe(200);
    expect(
      (await server.post(`/settings/apps/${APP}/oauth/start`, {}, auth(readToken))).statusCode,
    ).toBe(403);
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
    expect(findItem((await page(bToken, `?query=${APP}&limit=100`)).items, APP).installed).toBe(false);
    expect((await page(bToken, '?category=crm&limit=100')).items.some((item) => item.installed)).toBe(
      false,
    );
    for (const pageSize of ['?limit=1', '?limit=3', '?limit=100']) {
      const { items } = await walk(bToken, pageSize);
      expect(items.some((item) => item.installed)).toBe(false);
      expect(items.every((item) => item.installation === null)).toBe(true);
    }

    // B cannot disconnect A's app — indistinguishable from it not existing.
    expect((await server.del(`/settings/apps/${APP}`, auth(bToken))).statusCode).toBe(404);

    // B cannot read app data on A's chat.
    const chatId = await openChat(adminToken, fx.a.customerId);
    expect((await server.get(`/chats/${chatId}/apps`, auth(bToken))).statusCode).toBe(404);
  });
});
