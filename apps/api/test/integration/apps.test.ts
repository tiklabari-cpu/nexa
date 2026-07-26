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

  const list = async (token: string): Promise<AppListItem[]> => {
    const response = await server.get('/settings/apps', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: AppListItem[] }).items;
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

  // --- Scope split -----------------------------------------------------------

  it('lets a read-only admin list but not connect', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
    expect((await server.get('/settings/apps', auth(readToken))).statusCode).toBe(200);
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

    // B cannot disconnect A's app — indistinguishable from it not existing.
    expect((await server.del(`/settings/apps/${APP}`, auth(bToken))).statusCode).toBe(404);

    // B cannot read app data on A's chat.
    const chatId = await openChat(adminToken, fx.a.customerId);
    expect((await server.get(`/chats/${chatId}/apps`, auth(bToken))).statusCode).toBe(404);
  });
});
