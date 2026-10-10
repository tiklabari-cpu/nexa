/**
 * Live Apps connections and the live Telegram channel, end to end (tm 263).
 *
 * The whole server runs with `APPS_LIVE_PROVIDERS` switched on and its provider
 * client pinned to a local HTTPS stand-in (`fake-provider.ts`) — no request
 * leaves the machine, and the stand-in refuses any host but its own, so an
 * adaptor that reached for the real provider would fail here rather than leak.
 *
 * What is asserted is what a user and an attacker would see, not what the code
 * intends: the provider's verdict decides the connection; a refused key writes
 * nothing and leaves an earlier connection alone; an old mock install of a card
 * that went live reads "reconnect needed" and is not deleted; the chat panel
 * shows the provider's data or says it could not — never demo values; and the
 * pasted key, the bot token and the webhook secret appear in no response, no log
 * line (at `trace`), no audit entry and no database column in the clear.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptCredential, appCredentialAad } from '../../src/lib/credential-cipher.js';
import type { ProviderEndpoints } from '../../src/services/apps/verifiers/types.js';
import { LineSink } from '../helpers/ai-workspace.js';
import {
  json,
  startFakeProvider,
  type FakeProvider,
  type ProviderRequest,
} from '../helpers/fake-provider.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const CREDENTIAL_KEY = 'e5'.repeat(32);
const BREVO_KEY = 'xkeysib-live-test-Vq83Lm2Zt9Rb4Xc7';
const BREVO_BAD_KEY = 'xkeysib-revoked-Hw35Kd8Np1Qs6Jy0';
const FRESHDESK_KEY = 'fdlive-test-Tg72Vb5Nc4Mz9Qa1';
const BOT_TOKEN = '7123456789:AAHlive-test-token-Qp4Wn8Rt2Ys6Uv0Xz';
const CUSTOMER_EMAIL = 'ada.live@customer.test';

const SECRETS = [BREVO_KEY, BREVO_BAD_KEY, FRESHDESK_KEY, BOT_TOKEN];
/** Every form a careless line could carry a credential in: whole, its ends, base64. */
const SECRET_TRACES = SECRETS.flatMap((value) => [
  value,
  value.slice(0, 14),
  value.slice(-10),
  Buffer.from(value).toString('base64'),
]);

function endpoints(base: string): ProviderEndpoints {
  return {
    brevo: `${base}/brevo`,
    freshdesk: (sub) => `${base}/freshdesk/${sub}`,
    telegram: `${base}/telegram`,
  };
}

const basic = (key: string): string => `Basic ${Buffer.from(`${key}:X`).toString('base64')}`;

/** Brevo, Freshdesk and Telegram as their documented endpoints answer. */
function providerHandler(state: { down: boolean; telegramCalls: ProviderRequest[] }) {
  return (request: ProviderRequest, response: import('node:http').ServerResponse): void => {
    if (state.down) {
      json(response, 503, { message: 'maintenance' });
      return;
    }
    const { path, headers } = request;
    if (path === '/brevo/v3/account') {
      if (headers['api-key'] === BREVO_KEY) {
        json(response, 200, { email: 'owner@acme.test', companyName: 'Acme Ltd' });
      } else {
        // A provider that echoes the key back — the response must not carry it on.
        json(response, 401, {
          code: 'unauthorized',
          message: `Key not found: ${String(headers['api-key'])}`,
        });
      }
      return;
    }
    if (path.startsWith('/brevo/v3/contacts/')) {
      if (headers['api-key'] !== BREVO_KEY) {
        json(response, 401, { code: 'unauthorized' });
        return;
      }
      if (path.startsWith(`/brevo/v3/contacts/${encodeURIComponent(CUSTOMER_EMAIL)}`)) {
        json(response, 200, {
          email: CUSTOMER_EMAIL,
          emailBlacklisted: true,
          listIds: [3],
          statistics: { opened: [{ campaignId: 9 }] },
        });
      } else {
        json(response, 404, { message: 'Contact does not exist' });
      }
      return;
    }
    if (path.startsWith('/freshdesk/nohelp/')) {
      json(response, 404, {});
      return;
    }
    if (path.startsWith('/freshdesk/slow/')) return; // never answers
    if (path === '/freshdesk/acme/api/v2/agents/me') {
      if (headers['authorization'] === basic(FRESHDESK_KEY)) {
        json(response, 200, { contact: { email: 'agent@acme.test', name: 'Agent' } });
      } else {
        json(response, 401, {
          code: 'invalid_credentials',
          message: 'You have to be logged in to perform this action.',
        });
      }
      return;
    }
    if (path.startsWith('/telegram/')) {
      state.telegramCalls.push(request);
      const ok = path.startsWith(`/telegram/bot${BOT_TOKEN}/`);
      if (!ok) {
        json(response, 401, { ok: false, error_code: 401, description: 'Unauthorized' });
        return;
      }
      const method = path.slice(`/telegram/bot${BOT_TOKEN}/`.length);
      if (method === 'getMe') {
        json(response, 200, {
          ok: true,
          result: { id: 7123456789, is_bot: true, username: 'acme_live_bot' },
        });
      } else if (method === 'sendMessage') {
        json(response, 200, { ok: true, result: { message_id: 4242 } });
      } else {
        json(response, 200, { ok: true, result: true });
      }
      return;
    }
    json(response, 404, {});
  };
}

describe('live Apps connections (tm 263 · FR-MOD-09.2 · FR-MOD-09.1)', () => {
  let owner: PrismaClient;
  let provider: FakeProvider;
  let server: TestServer;
  let mockServer: TestServer;
  let fx: Fixtures;
  let admin: string;
  let adminB: string;
  const sink = new LineSink();
  const state = { down: false, telegramCalls: [] as ProviderRequest[] };
  const responses: string[] = [];

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const connect = async (
    body: Record<string, unknown>,
    appId: string,
    token = admin,
    on = server,
  ) => {
    const response = await on.post(`/settings/apps/${appId}/connect`, body, auth(token));
    responses.push(response.body);
    return response;
  };

  const listItem = async (appId: string, token = admin, on = server) => {
    const response = await on.get(`/settings/apps?query=${appId}`, auth(token));
    expect(response.statusCode).toBe(200);
    responses.push(response.body);
    return (response.json() as { items: Array<Record<string, any>> }).items.find(
      (i) => i.id === appId,
    )!;
  };

  const openChat = async (customerId: string): Promise<string> => {
    const response = await server.post('/chats', { customer_id: customerId }, auth(admin));
    expect([200, 201]).toContain(response.statusCode);
    return (response.json() as { id: string }).id;
  };

  const chatApps = async (chatId: string) => {
    const response = await server.get(`/chats/${chatId}/apps`, auth(admin));
    expect(response.statusCode).toBe(200);
    responses.push(response.body);
    return (response.json() as { items: Array<Record<string, any>> }).items;
  };

  beforeAll(async () => {
    owner = ownerClient();
    provider = await startFakeProvider(providerHandler(state));
    server = await startTestServer(
      {
        LOG_LEVEL: 'trace',
        APPS_LIVE_PROVIDERS: 'brevo,freshdesk',
        APPS_CREDENTIAL_KEY: CREDENTIAL_KEY,
      },
      {
        appsHttp: provider.http({ timeoutMs: 400 }),
        appsEndpoints: endpoints(provider.base),
        logStream: sink as unknown as NodeJS.WritableStream,
      },
    );
    // The same database with every card on its mock — "before the card went live".
    mockServer = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await mockServer.close();
    await provider.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    state.down = false;
    provider.requests.length = 0;
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    admin = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'chats--all:rw'],
    });
    adminB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['access_rules:rw', 'chats--all:rw'],
    });
  });

  it('marks which cards are live and leaves the rest on their mock', async () => {
    expect(await listItem('brevo')).toMatchObject({ live_available: true, installed: false });
    expect(await listItem('freshdesk')).toMatchObject({ live_available: true });
    expect(await listItem('zendesk')).toMatchObject({ live_available: false });
    expect(await listItem('hubspot')).toMatchObject({ live_available: false });

    // A mock card connects exactly as before: no provider call, a masked label.
    const mock = await connect({ api_key: 'zd-mock-key-0123456789' }, 'zendesk');
    expect(mock.statusCode).toBe(200);
    expect(mock.json()).toMatchObject({
      installation: { status: 'connected', live: false, external_account: '••••6789' },
    });
    expect(provider.requests).toEqual([]);
  });

  it('connects a live card only with the provider’s yes, and stores the key encrypted', async () => {
    const response = await connect({ api_key: BREVO_KEY }, 'brevo');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      installed: true,
      live_available: true,
      installation: {
        status: 'connected',
        live: true,
        external_account: 'Acme Ltd',
        api_key_last_four: BREVO_KEY.slice(-4),
      },
    });
    // Exactly one call, carrying only this provider's key.
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.headers['api-key']).toBe(BREVO_KEY);
    expect(provider.requests[0]!.headers['authorization']).toBeUndefined();

    const row = await owner.appInstallation.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, appId: 'brevo' },
    });
    expect(row.live).toBe(true);
    expect(row.verifiedAt).toBeInstanceOf(Date);
    expect(row.credentialCiphertext).not.toContain(BREVO_KEY);
    expect(
      JSON.parse(
        decryptCredential(
          row.credentialCiphertext!,
          CREDENTIAL_KEY,
          appCredentialAad(String(fx.a.licenseId), 'brevo'),
        ),
      ),
    ).toEqual({ apiKey: BREVO_KEY });
  });

  it('refuses a key the provider refuses, writes nothing, and keeps a working connection', async () => {
    expect((await connect({ api_key: BREVO_KEY }, 'brevo')).statusCode).toBe(200);
    const before = await owner.appInstallation.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, appId: 'brevo' },
    });

    const refused = await connect({ api_key: BREVO_BAD_KEY }, 'brevo');
    expect(refused.statusCode).toBe(400);
    const error = (refused.json() as { error: { type: string; details: Record<string, string> } })
      .error;
    expect(error.type).toBe('validation');
    expect(error.details).toMatchObject({
      reason: 'app_credentials_invalid',
      provider_reason: 'invalid_key',
    });
    // The provider's words, with the key it echoed taken out.
    expect(error.details['provider_message']).toMatch(/^Key not found: /);
    expect(refused.body).not.toContain(BREVO_BAD_KEY);

    const after = await owner.appInstallation.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, appId: 'brevo' },
    });
    expect(after.credentialCiphertext).toBe(before.credentialCiphertext);
    expect(after.externalAccount).toBe('Acme Ltd');

    // And on a card with nothing connected, a refusal leaves nothing behind.
    await owner.appInstallation.deleteMany({ where: { licenseId: fx.a.licenseId } });
    expect((await connect({ api_key: BREVO_BAD_KEY }, 'brevo')).statusCode).toBe(400);
    expect(await owner.appInstallation.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('says the provider could not be reached (503) rather than calling the key wrong', async () => {
    state.down = true;
    const down = await connect({ api_key: BREVO_KEY }, 'brevo');
    expect(down.statusCode).toBe(503);
    expect(
      (down.json() as { error: { details: Record<string, string> } }).error.details,
    ).toMatchObject({
      reason: 'app_provider_unavailable',
      provider_reason: 'provider_error',
    });
    state.down = false;
    const slow = await connect({ api_key: FRESHDESK_KEY, subdomain: 'slow' }, 'freshdesk');
    expect(slow.statusCode).toBe(503);
    expect(
      (slow.json() as { error: { details: Record<string, string> } }).error.details,
    ).toMatchObject({
      provider_reason: 'unreachable',
    });
  });

  it('asks Freshdesk at the named helpdesk, and never builds a host from anything but a label (SSRF)', async () => {
    const missing = await connect({ api_key: FRESHDESK_KEY }, 'freshdesk');
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toMatch(/subdomain/);

    for (const subdomain of ['evil.test', '127.0.0.1', 'acme:8443', 'acme/../x', 'a b']) {
      const refused = await connect({ api_key: FRESHDESK_KEY, subdomain }, 'freshdesk');
      expect(refused.statusCode).toBe(400);
    }
    expect(provider.requests).toEqual([]);

    const unknown = await connect({ api_key: FRESHDESK_KEY, subdomain: 'nohelp' }, 'freshdesk');
    expect(unknown.statusCode).toBe(400);
    expect(
      (unknown.json() as { error: { details: Record<string, string> } }).error.details,
    ).toMatchObject({
      provider_reason: 'not_found',
    });

    // Pasted the way a browser shows it: read as its label.
    const ok = await connect(
      { api_key: FRESHDESK_KEY, subdomain: 'https://ACME.freshdesk.com/' },
      'freshdesk',
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      installation: { live: true, external_account: 'agent@acme.test (acme.freshdesk.com)' },
    });
    const row = await owner.appInstallation.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, appId: 'freshdesk' },
    });
    expect(row.credentialConfig).toEqual({ subdomain: 'acme' });
  });

  it('reads an install from before the card went live as "reconnect needed", and keeps it', async () => {
    // Connected while brevo was a mock (the other server shares the database).
    expect(
      (await connect({ api_key: 'old-mock-brevo-key-1234' }, 'brevo', admin, mockServer))
        .statusCode,
    ).toBe(200);
    expect((await listItem('brevo', admin, mockServer)).installation).toMatchObject({
      status: 'connected',
      live: false,
    });

    const item = await listItem('brevo');
    expect(item.installed).toBe(true);
    expect(item.installation).toMatchObject({ status: 'needs_reconnect', live: false });
    expect(
      await owner.appInstallation.count({ where: { licenseId: fx.a.licenseId, appId: 'brevo' } }),
    ).toBe(1);

    // Its chat entry says it cannot be read — not the demo values it used to show.
    await owner.customer.update({
      where: { id: fx.a.customerId },
      data: { email: CUSTOMER_EMAIL },
    });
    const chatId = await openChat(fx.a.customerId);
    expect((await chatApps(chatId)).find((i) => i.app_id === 'brevo')).toMatchObject({
      live: true,
      unavailable: true,
      fields: [],
    });

    // A new key replaces it.
    expect((await connect({ api_key: BREVO_KEY }, 'brevo')).statusCode).toBe(200);
    expect((await listItem('brevo')).installation).toMatchObject({
      status: 'connected',
      live: true,
    });
  });

  it('shows the provider’s own data in the chat, beside the mock cards’ demo data', async () => {
    await owner.customer.update({
      where: { id: fx.a.customerId },
      data: { email: CUSTOMER_EMAIL },
    });
    expect((await connect({ api_key: BREVO_KEY }, 'brevo')).statusCode).toBe(200);
    expect((await connect({ api_key: 'zd-mock-key-0123456789' }, 'zendesk')).statusCode).toBe(200);
    const chatId = await openChat(fx.a.customerId);

    const items = await chatApps(chatId);
    expect(items.find((i) => i.app_id === 'brevo')).toMatchObject({
      live: true,
      fields: [
        { label: 'Subscribed', value: 'No' },
        { label: 'Campaigns opened (90d)', value: '1' },
        { label: 'Lists', value: '1' },
      ],
    });
    expect(items.find((i) => i.app_id === 'brevo')!['unavailable']).toBeUndefined();
    expect(items.find((i) => i.app_id === 'zendesk')).toMatchObject({ live: false });

    // The provider down: "could not be read", never invented values.
    state.down = true;
    expect((await chatApps(chatId)).find((i) => i.app_id === 'brevo')).toMatchObject({
      live: true,
      unavailable: true,
      fields: [],
    });
  });

  it('keeps one workspace’s credential out of another’s reach', async () => {
    expect((await connect({ api_key: BREVO_KEY }, 'brevo')).statusCode).toBe(200);
    expect((await listItem('brevo', adminB)).installed).toBe(false);

    // Even a ciphertext copied into the other workspace's row does not open
    // there: it is bound to the row it was written for.
    const mine = await owner.appInstallation.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, appId: 'brevo' },
    });
    await owner.appInstallation.create({
      data: {
        licenseId: fx.b.licenseId,
        appId: 'brevo',
        externalAccount: 'copied',
        apiKeyHash: mine.apiKeyHash,
        apiKeyLastFour: mine.apiKeyLastFour,
        live: true,
        credentialCiphertext: mine.credentialCiphertext,
        verifiedAt: new Date(),
      },
    });
    await owner.customer.update({
      where: { id: fx.b.customerId },
      data: { email: CUSTOMER_EMAIL },
    });
    const opened = await server.post('/chats', { customer_id: fx.b.customerId }, auth(adminB));
    const chatB = (opened.json() as { id: string }).id;
    provider.requests.length = 0;
    const response = await server.get(`/chats/${chatB}/apps`, auth(adminB));
    expect((response.json() as { items: Array<Record<string, unknown>> }).items[0]).toMatchObject({
      app_id: 'brevo',
      unavailable: true,
    });
    expect(provider.requests).toEqual([]);
  });

  it('meters connection attempts per person, refused ones included', async () => {
    const limited = await startTestServer(
      {
        APPS_LIVE_PROVIDERS: 'brevo',
        APPS_CREDENTIAL_KEY: CREDENTIAL_KEY,
        RATE_LIMIT_APPS_CONNECT_PER_HOUR: '3',
      },
      { appsHttp: provider.http({ timeoutMs: 400 }), appsEndpoints: endpoints(provider.base) },
    );
    try {
      await clearRateLimits(limited.app);
      for (let i = 0; i < 3; i += 1) {
        expect(
          (await connect({ api_key: BREVO_BAD_KEY }, 'brevo', admin, limited)).statusCode,
        ).toBe(400);
      }
      const before = provider.requests.length;
      const fourth = await connect({ api_key: BREVO_KEY }, 'brevo', admin, limited);
      expect(fourth.statusCode).toBe(429);
      // Refused before the provider is asked.
      expect(provider.requests.length).toBe(before);
      // Someone else in the same workspace has their own budget.
      const colleague = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['access_rules:rw'],
      });
      expect(
        (await connect({ api_key: BREVO_KEY }, 'brevo', colleague, limited)).statusCode,
      ).not.toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('writes the connection to the audit trail without the key or the account', async () => {
    expect((await connect({ api_key: BREVO_KEY }, 'brevo')).statusCode).toBe(200);
    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'app.connected' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).toMatchObject({ app_id: 'brevo', live: true });
    const text = JSON.stringify(entries, (_k, v: unknown) =>
      typeof v === 'bigint' ? String(v) : v,
    );
    for (const trace of SECRET_TRACES) expect(text).not.toContain(trace);
    expect(text).not.toContain('Acme Ltd');
  });

  describe('live Telegram channel (FR-MOD-08.5.8)', () => {
    let tg: TestServer;
    let tgAdmin: string;
    let tgAgent: string;

    const tgAuth = () => auth(tgAdmin);

    beforeAll(async () => {
      tg = await startTestServer(
        {
          LOG_LEVEL: 'trace',
          APPS_LIVE_PROVIDERS: 'telegram',
          APPS_CREDENTIAL_KEY: CREDENTIAL_KEY,
          API_BASE_URL: 'https://api.siyahtus.test',
        },
        {
          appsHttp: provider.http({ timeoutMs: 400 }),
          appsEndpoints: endpoints(provider.base),
          logStream: sink as unknown as NodeJS.WritableStream,
        },
      );
    });
    afterAll(async () => {
      await tg.close();
    });
    beforeEach(async () => {
      state.telegramCalls.length = 0;
      await clearRateLimits(tg.app);
      // A channel belongs to a brand; the shared fixtures seed none.
      await seedDefaultBrand(owner, fx.a.licenseId);
      tgAdmin = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['channels--all:rw', 'chats--all:rw'],
      });
      tgAgent = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
    });

    const connectBot = async (token = BOT_TOKEN) => {
      const response = await tg.post(
        '/channels/telegram/connect',
        { bot_token: token, bot_username: 'spoofed' },
        tgAuth(),
      );
      responses.push(response.body);
      return response;
    };

    const webhookCall = () => {
      const call = state.telegramCalls.find((c) => c.path.endsWith('/setWebhook'));
      return JSON.parse(call!.body) as {
        url: string;
        secret_token: string;
        allowed_updates: string[];
      };
    };

    const update = (text: string | undefined, extra: Record<string, unknown> = {}) => ({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 555001, type: 'private' },
        from: { id: 555001, is_bot: false, first_name: 'Ada', last_name: 'Live' },
        ...(text === undefined ? {} : { text }),
        ...extra,
      },
    });

    it('verifies the token with Telegram, takes the bot name from Telegram, and registers a secret webhook', async () => {
      const response = await connectBot();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        type: 'telegram',
        connected: true,
        live: true,
        address: 'acme_live_bot',
      });

      const row = await owner.channel.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, type: 'telegram' },
      });
      const hook = webhookCall();
      expect(hook.url).toBe(`https://api.siyahtus.test/api/v1/channels/telegram/webhook/${row.id}`);
      expect(hook.allowed_updates).toEqual(['message']);
      expect(hook.secret_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(row.webhookSecretHash).toBe(
        createHash('sha256').update(hook.secret_token).digest('hex'),
      );
      expect(row.credentialCiphertext).not.toContain(BOT_TOKEN);
      expect(JSON.stringify(row.config)).not.toContain(BOT_TOKEN);
      expect(JSON.stringify(row.config)).not.toContain('spoofed');
    });

    it('refuses a token Telegram refuses, and one that is not a token at all without asking', async () => {
      const wrong = await connectBot('7123456789:AAHwrong-token-Zz9Yy8Xx7Ww6Vv5Uu4Tt');
      expect(wrong.statusCode).toBe(400);
      expect(
        (wrong.json() as { error: { details: Record<string, string> } }).error.details,
      ).toMatchObject({
        reason: 'app_credentials_invalid',
        provider_reason: 'invalid_key',
      });
      const calls = state.telegramCalls.length;
      expect((await connectBot('not-a-token')).statusCode).toBe(400);
      expect(state.telegramCalls.length).toBe(calls);
      expect(
        await owner.channel.count({ where: { licenseId: fx.a.licenseId, type: 'telegram' } }),
      ).toBe(0);
    });

    it('accepts an update only with the registered secret, and turns it into a chat', async () => {
      expect((await connectBot()).statusCode).toBe(200);
      const row = await owner.channel.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, type: 'telegram' },
      });
      const { secret_token: secret } = webhookCall();
      const path = `/channels/telegram/webhook/${row.id}`;

      expect((await tg.post(path, update('hello'))).statusCode).toBe(401);
      expect(
        (await tg.post(path, update('hello'), { 'x-telegram-bot-api-secret-token': 'wrong' }))
          .statusCode,
      ).toBe(401);
      // An id that does not exist answers exactly like a wrong secret.
      expect(
        (
          await tg.post(
            '/channels/telegram/webhook/00000000-0000-4000-8000-000000000000',
            update('hi'),
            {
              'x-telegram-bot-api-secret-token': secret,
            },
          )
        ).statusCode,
      ).toBe(401);
      // The flat mock door is closed for a live bot: it authenticates nobody.
      expect(
        (
          await tg.post('/channels/telegram/webhook', {
            recipient: { id: 'acme_live_bot' },
            sender: { id: '1' },
            message: { text: 'forged' },
          })
        ).statusCode,
      ).toBe(404);

      const accepted = await tg.post(path, update('where is my order?'), {
        'x-telegram-bot-api-secret-token': secret,
      });
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({ status: 'accepted' });
      const { chat_id: chatId, customer_id: customerId } = accepted.json() as {
        chat_id: string;
        customer_id: string;
      };
      const customer = await owner.customer.findUniqueOrThrow({ where: { id: customerId } });
      expect(customer.name).toBe('Ada Live');

      // A sticker, an edit, a group: answered 200 and dropped, so Telegram stops retrying.
      const sticker = await tg.post(path, update(undefined, { sticker: {} }), {
        'x-telegram-bot-api-secret-token': secret,
      });
      expect(sticker.statusCode).toBe(200);
      expect(sticker.json()).toMatchObject({ status: 'ignored' });

      // The agent's reply leaves through the real Bot API, to that private chat.
      const posted = await tg.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'on its way', recipients: 'all' },
        auth(tgAgent),
      );
      expect(posted.statusCode).toBe(201);
      const send = state.telegramCalls.find((c) => c.path.endsWith('/sendMessage'));
      expect(JSON.parse(send!.body)).toEqual({ chat_id: '555001', text: 'on its way' });
      const logged = await owner.channelMessage.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, direction: 'outbound' },
      });
      expect(logged.providerMessageId).toBe('tg.4242');
    });

    it('sends nothing through a bot connected while Telegram was a mock — it asks for a reconnect', async () => {
      // Connected on the mock server (same database), before the channel went live.
      const mockConnect = await mockServer.post(
        '/channels/telegram/connect',
        { bot_token: '1:mock-token', bot_username: 'old_mock_bot' },
        tgAuth(),
      );
      expect(mockConnect.statusCode).toBe(200);
      const sent = await tg.post(
        '/channels/telegram/messages',
        { external_id: '555001', text: 'hello' },
        tgAuth(),
      );
      expect(sent.statusCode).toBe(400);
      expect(
        (sent.json() as { error: { details: Record<string, string> } }).error.details,
      ).toMatchObject({
        reason: 'channel_needs_reconnect',
      });
      expect(state.telegramCalls).toEqual([]);
      expect(await owner.channelMessage.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('removes the webhook at Telegram and forgets the token on disconnect', async () => {
      expect((await connectBot()).statusCode).toBe(200);
      const done = await tg.post('/channels/telegram/disconnect', {}, tgAuth());
      expect(done.statusCode).toBe(204);
      expect(state.telegramCalls.some((c) => c.path.endsWith('/deleteWebhook'))).toBe(true);
      const row = await owner.channel.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, type: 'telegram' },
      });
      expect(row.status).toBe('off');
      expect(row.credentialCiphertext).toBeNull();
      expect(row.webhookSecretHash).toBeNull();
    });

    it('refuses to go live where Telegram cannot deliver (no public https API_BASE_URL)', async () => {
      const plain = await startTestServer(
        { APPS_LIVE_PROVIDERS: 'telegram', APPS_CREDENTIAL_KEY: CREDENTIAL_KEY },
        { appsHttp: provider.http({ timeoutMs: 400 }), appsEndpoints: endpoints(provider.base) },
      );
      try {
        const response = await plain.post(
          '/channels/telegram/connect',
          { bot_token: BOT_TOKEN },
          tgAuth(),
        );
        expect(response.statusCode).toBe(400);
        expect(
          (response.json() as { error: { details: Record<string, string> } }).error.details,
        ).toMatchObject({
          reason: 'telegram_webhook_unreachable',
        });
        expect(state.telegramCalls).toEqual([]);
      } finally {
        await plain.close();
      }
    });
  });

  afterEach(() => {
    // Checked after every test, against everything any test wrote so far.
    const everything = [sink.text, ...responses].join('\n');
    for (const trace of SECRET_TRACES) expect(everything).not.toContain(trace);
  });

  it('leaves no credential in any response or log line, at trace level', () => {
    // The afterEach above is the assertion; this pins that it had material.
    expect(sink.lines.length).toBeGreaterThan(0);
    expect(responses.length).toBeGreaterThan(5);
  });
});
