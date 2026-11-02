/**
 * Live Messenger and Instagram, end to end (tm 381 · KN-02 · FR-MOD-08.5.4 ·
 * FR-MOD-08.5.7).
 *
 * The whole server runs with `messenger,instagram` in `APPS_LIVE_PROVIDERS`
 * and the Graph API pinned to a local HTTPS stand-in (`fake-provider.ts`) — no
 * request leaves the machine; the Meta app's values are made up. Webhook
 * deliveries are signed here exactly as Meta signs them (HMAC-SHA256 of the
 * raw body under the app secret), with the payload shapes Meta documents for
 * `object: page` and `object: instagram`.
 *
 * What is asserted is what a business, its customer and an attacker would
 * see: a login lists the pages without handing any token to the browser; the
 * connected page's DM opens a chat in that workspace and nowhere else and the
 * agent's reply reaches Graph as a RESPONSE; an unsigned or wrongly signed
 * delivery writes nothing; a redelivered `mid` is one message; past the
 * 24-hour window nothing is sent; a page token Meta refuses marks the channel.
 */
import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ServerResponse } from 'node:http';
import type { ProviderEndpoints } from '../../src/services/apps/verifiers/types.js';
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
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const CREDENTIAL_KEY = 'b8'.repeat(32);
const APP_SECRET = 'meta-test-app-secret-71c0d2';
const VERIFY_TOKEN = 'meta-test-verify-token-9a4e';
const GOOD_CODE = 'login-code-ok';
const GOOD_CODE_B = 'login-code-ok-b';
const SHORT_TOKEN = 'EAAGshort-user-token-A';
const SHORT_TOKEN_B = 'EAAGshort-user-token-B';
const LONG_TOKEN = 'EAAGlong-user-token-A-Kd93';
const LONG_TOKEN_B = 'EAAGlong-user-token-B-Lm20';
const PAGE_TOKEN = 'EAAGpage-token-A-Hy71Qw';
const PAGE_TOKEN_NOIG = 'EAAGpage-token-noig-Pz55';
const PAGE_TOKEN_B = 'EAAGpage-token-B-Tr08Xc';
const PAGE_A = '104771234567001';
const PAGE_NOIG = '104771234567002';
const PAGE_B = '104771234567003';
const IG_A = '17841400000000001';
const PSID = '6789012345678901';
const IGSID = '1122334455667788';

interface GraphState {
  calls: ProviderRequest[];
  revoked: boolean;
  sent: number;
}

function endpoints(base: string): ProviderEndpoints {
  return {
    brevo: `${base}/brevo`,
    freshdesk: (sub) => `${base}/freshdesk/${sub}`,
    telegram: `${base}/telegram`,
    whatsapp: `${base}/graph`,
  };
}

const PAGE_TOKENS = new Set([PAGE_TOKEN, PAGE_TOKEN_NOIG, PAGE_TOKEN_B]);

/** Graph as its documented Messenger / Instagram endpoints answer. */
function graphHandler(state: GraphState) {
  return (request: ProviderRequest, response: ServerResponse): void => {
    const url = new URL(request.path, 'https://graph.local');
    const path = url.pathname;
    if (!path.startsWith('/graph/')) {
      json(response, 404, {});
      return;
    }
    state.calls.push(request);
    if (path === '/graph/v21.0/oauth/access_token') {
      if (url.searchParams.get('client_secret') !== APP_SECRET) {
        json(response, 400, { error: { message: 'Error validating client secret.', code: 1 } });
        return;
      }
      if (url.searchParams.get('grant_type') === 'fb_exchange_token') {
        const short = url.searchParams.get('fb_exchange_token');
        const long =
          short === SHORT_TOKEN ? LONG_TOKEN : short === SHORT_TOKEN_B ? LONG_TOKEN_B : null;
        if (long)
          json(response, 200, { access_token: long, token_type: 'bearer', expires_in: 5183944 });
        else json(response, 400, { error: { message: 'Invalid OAuth access token.', code: 190 } });
        return;
      }
      const code = url.searchParams.get('code');
      if (code === GOOD_CODE || code === GOOD_CODE_B) {
        json(response, 200, { access_token: code === GOOD_CODE ? SHORT_TOKEN : SHORT_TOKEN_B });
      } else {
        json(response, 400, {
          error: { message: `This authorization code has expired. (${String(code)})`, code: 100 },
        });
      }
      return;
    }
    const bearer = (request.headers['authorization'] ?? '').replace(/^Bearer /, '');
    if (path === '/graph/v21.0/me/accounts') {
      if (bearer === LONG_TOKEN) {
        json(response, 200, {
          data: [
            {
              id: PAGE_A,
              name: 'Acme Bet',
              access_token: PAGE_TOKEN,
              instagram_business_account: { id: IG_A, username: 'acmebet' },
            },
            { id: PAGE_NOIG, name: 'Acme Destek', access_token: PAGE_TOKEN_NOIG },
          ],
        });
      } else if (bearer === LONG_TOKEN_B) {
        json(response, 200, {
          data: [{ id: PAGE_B, name: 'Beta Bet', access_token: PAGE_TOKEN_B }],
        });
      } else {
        json(response, 401, { error: { message: 'Invalid OAuth access token.', code: 190 } });
      }
      return;
    }
    if (state.revoked || !PAGE_TOKENS.has(bearer)) {
      json(response, 401, {
        error: { message: 'Error validating access token: Session has expired', code: 190 },
      });
      return;
    }
    if (path.endsWith('/subscribed_apps') && request.method === 'POST') {
      json(response, 200, { success: true });
      return;
    }
    if (path.endsWith('/messages') && request.method === 'POST') {
      state.sent += 1;
      const body = JSON.parse(request.body) as { recipient?: { id?: string } };
      json(response, 200, { recipient_id: body.recipient?.id, message_id: `m_out-${state.sent}` });
      return;
    }
    json(response, 404, { error: { message: 'Unknown path', code: 803 } });
  };
}

/** A Messenger delivery (`object: page`) as Meta sends it. */
function pageDelivery(pageId: string, messaging: unknown[]): Record<string, unknown> {
  return { object: 'page', entry: [{ id: pageId, time: Date.now(), messaging }] };
}

/** An Instagram delivery (`object: instagram`) as Meta sends it. */
function igDelivery(igId: string, messaging: unknown[]): Record<string, unknown> {
  return { object: 'instagram', entry: [{ id: igId, time: Date.now(), messaging }] };
}

function dm(from: string, to: string, mid: string, text: string, at = Date.now()) {
  return { sender: { id: from }, recipient: { id: to }, timestamp: at, message: { mid, text } };
}

const bigintSafe = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

function signed(body: unknown, secret = APP_SECRET): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` };
}

const LIVE_ENV = {
  APPS_LIVE_PROVIDERS: 'messenger,instagram',
  APPS_CREDENTIAL_KEY: CREDENTIAL_KEY,
  WHATSAPP_APP_ID: '2233445566',
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
  WEB_APP_URL: 'https://app.siyahtus.test',
};

describe('live Messenger / Instagram channels (tm 381 · FR-MOD-08.5.4 · FR-MOD-08.5.7)', () => {
  let owner: PrismaClient;
  let provider: FakeProvider;
  let server: TestServer;
  let fx: Fixtures;
  let adminA: string;
  let adminB: string;
  let agentA: string;
  const mailer = new MemoryMailer();
  const state: GraphState = { calls: [], revoked: false, sent: 0 };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const post = (body: unknown, signature: string | undefined) =>
    server.app.inject({
      method: 'POST',
      url: '/api/v1/channels/meta/messaging-webhook',
      headers: {
        'content-type': 'application/json',
        ...(signature !== undefined ? { 'x-hub-signature-256': signature } : {}),
      },
      payload: typeof body === 'string' ? body : JSON.stringify(body),
    });

  const deliver = async (body: unknown) => {
    const { raw, signature } = signed(body);
    const response = await post(raw, signature);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as {
      status: string;
      accepted: number;
      duplicates: number;
      ignored: number;
    };
  };

  const login = async (token = adminA, code = GOOD_CODE) => {
    const response = await server.post('/channels/meta/pages', { code }, auth(token));
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as {
      selection_id: string;
      pages: Array<{
        id: string;
        name: string;
        instagram: { id: string; username: string } | null;
      }>;
    };
  };

  const connect = async (type: 'messenger' | 'instagram', pageId = PAGE_A, token = adminA) => {
    const selection = await login(token, token === adminB ? GOOD_CODE_B : GOOD_CODE);
    return server.post(
      `/channels/${type}/connect`,
      { selection_id: selection.selection_id, page_id: pageId },
      auth(token),
    );
  };

  const inboundChat = async (licenseId: bigint) =>
    owner.chat.findFirst({ where: { licenseId }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    owner = ownerClient();
    provider = await startFakeProvider(graphHandler(state));
    server = await startTestServer(LIVE_ENV, {
      appsHttp: provider.http({ timeoutMs: 1000 }),
      appsEndpoints: endpoints(provider.base),
      mailer,
    });
  });

  afterAll(async () => {
    await server.close();
    await provider.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    state.calls.length = 0;
    state.revoked = false;
    state.sent = 0;
    mailer.clear();
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await seedDefaultBrand(owner, fx.a.licenseId);
    await seedDefaultBrand(owner, fx.b.licenseId);
    adminA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:rw', 'chats--all:rw'],
    });
    adminB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['channels--all:rw', 'chats--all:rw'],
    });
    agentA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
  });

  it('reports both channels live and hands the cards the login configuration, behind the channel scope', async () => {
    const deployment = await server.get('/deployment');
    expect((deployment.json() as { live_apps: string[] }).live_apps).toEqual(
      expect.arrayContaining(['messenger', 'instagram']),
    );
    const config = await server.get('/channels/meta/login-config', auth(adminA));
    expect(config.statusCode).toBe(200);
    expect(config.json()).toMatchObject({
      app_id: '2233445566',
      graph_version: 'v21.0',
      redirect_uri: 'https://app.siyahtus.test/channels/meta/callback',
      scopes: {
        messenger: expect.arrayContaining(['pages_messaging']),
        instagram: expect.arrayContaining(['instagram_manage_messages']),
      },
    });
    expect(config.body).not.toContain(APP_SECRET);
    expect((await server.get('/channels/meta/login-config', auth(agentA))).statusCode).toBe(403);
    expect(
      (await server.post('/channels/meta/pages', { code: GOOD_CODE }, auth(agentA))).statusCode,
    ).toBe(403);
  });

  it("answers Meta's subscription handshake only with the verify token", async () => {
    const ok = await server.get(
      `/channels/meta/messaging-webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=7720114`,
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('7720114');
    const wrong = await server.get(
      '/channels/meta/messaging-webhook?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1',
    );
    expect(wrong.statusCode).toBe(403);
  });

  it('lists the pages a login opened without any token, then connects one: token encrypted, page subscribed (FR-MOD-08.5.4)', async () => {
    const selection = await login();
    expect(selection.pages).toEqual([
      { id: PAGE_A, name: 'Acme Bet', instagram: { id: IG_A, username: 'acmebet' } },
      { id: PAGE_NOIG, name: 'Acme Destek', instagram: null },
    ]);
    for (const secret of [SHORT_TOKEN, LONG_TOKEN, PAGE_TOKEN, PAGE_TOKEN_NOIG, APP_SECRET]) {
      expect(JSON.stringify(selection)).not.toContain(secret);
    }
    // The short-lived token was made long-lived before the pages were read.
    expect(state.calls.some((c) => c.path.includes('grant_type=fb_exchange_token'))).toBe(true);

    const response = await server.post(
      '/channels/messenger/connect',
      { selection_id: selection.selection_id, page_id: PAGE_A },
      auth(adminA),
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      type: 'messenger',
      connected: true,
      live: true,
      address: PAGE_A,
      display_address: 'Acme Bet',
      needs_reconnect: false,
    });
    const subscribe = state.calls.find((c) => c.path.endsWith(`/${PAGE_A}/subscribed_apps`));
    expect(subscribe?.headers['authorization']).toBe(`Bearer ${PAGE_TOKEN}`);
    expect(JSON.parse(subscribe!.body)).toEqual({
      subscribed_fields: 'messages,messaging_postbacks',
    });

    const row = await owner.channel.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, type: 'messenger' },
    });
    expect(row.credentialCiphertext).toBeTruthy();
    expect(JSON.stringify(row, bigintSafe)).not.toContain(PAGE_TOKEN);
    expect(row.webhookSecretHash).toBeNull();
    const audit = await owner.auditLogEntry.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, action: 'channel.connected' },
    });
    expect(JSON.stringify(audit, bigintSafe)).not.toContain(PAGE_TOKEN);

    // Used once.
    const again = await server.post(
      '/channels/messenger/connect',
      { selection_id: selection.selection_id, page_id: PAGE_A },
      auth(adminA),
    );
    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({
      error: { details: { reason: 'meta_selection_invalid' } },
    });
  });

  it('refuses a code Meta refuses, a page outside the selection and another workspace’s selection', async () => {
    const badCode = await server.post('/channels/meta/pages', { code: 'expired' }, auth(adminA));
    expect(badCode.statusCode).toBe(400);
    expect(badCode.json()).toMatchObject({
      error: { details: { reason: 'app_credentials_invalid' } },
    });
    expect(badCode.body).not.toContain(APP_SECRET);

    const selection = await login();
    const notInIt = await server.post(
      '/channels/messenger/connect',
      { selection_id: selection.selection_id, page_id: PAGE_B },
      auth(adminA),
    );
    expect(notInIt.statusCode).toBe(400);
    expect(notInIt.json()).toMatchObject({
      error: { details: { reason: 'meta_selection_invalid' } },
    });

    // Workspace B presents A's selection: it is not B's, so it does not open.
    const stolen = await server.post(
      '/channels/messenger/connect',
      { selection_id: selection.selection_id, page_id: PAGE_A },
      auth(adminB),
    );
    expect(stolen.statusCode).toBe(400);
    expect(await owner.channel.count({ where: { type: 'messenger', status: 'connected' } })).toBe(
      0,
    );
  });

  it('connects Instagram through the page it is linked to, and refuses a page with none (FR-MOD-08.5.7)', async () => {
    const none = await connect('instagram', PAGE_NOIG);
    expect(none.statusCode).toBe(400);
    expect(none.json()).toMatchObject({
      error: { details: { reason: 'instagram_account_not_linked' } },
    });

    const response = await connect('instagram', PAGE_A);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      type: 'instagram',
      live: true,
      address: IG_A,
      display_address: '@acmebet',
    });
  });

  it('refuses an unsigned or wrongly signed delivery with 401 and writes nothing', async () => {
    expect((await connect('messenger')).statusCode).toBe(200);
    const body = pageDelivery(PAGE_A, [dm(PSID, PAGE_A, 'm_forged', 'hello')]);
    const { raw, signature } = signed(body);
    const before = {
      messages: await owner.channelMessage.count(),
      customers: await owner.customer.count(),
      chats: await owner.chat.count(),
    };

    expect((await post(raw, undefined)).statusCode).toBe(401);
    expect((await post(raw, signed(body, 'not-the-app-secret').signature)).statusCode).toBe(401);
    expect((await post(raw, 'sha256=' + '0'.repeat(64))).statusCode).toBe(401);
    expect((await post(raw.replace('hello', 'hellp'), signature)).statusCode).toBe(401);
    // The flat mock door is closed for a live channel: it authenticates nobody.
    expect(
      (
        await server.post('/channels/messenger/webhook', {
          recipient: { id: PAGE_A },
          sender: { id: PSID },
          message: { text: 'forged' },
        })
      ).statusCode,
    ).toBe(404);

    expect({
      messages: await owner.channelMessage.count(),
      customers: await owner.customer.count(),
      chats: await owner.chat.count(),
    }).toEqual(before);
  });

  it('a DM to the connected page opens a chat in its workspace only, and the reply reaches Graph as a RESPONSE (FR-MOD-08.5.4)', async () => {
    expect((await connect('messenger')).statusCode).toBe(200);
    expect((await connect('messenger', PAGE_B, adminB)).statusCode).toBe(200);
    const chatsInB = await owner.chat.count({ where: { licenseId: fx.b.licenseId } });

    const received = await deliver(
      pageDelivery(PAGE_A, [dm(PSID, PAGE_A, 'm_in-1', 'Çekimim bekliyor')]),
    );
    expect(received).toEqual({ status: 'received', accepted: 1, duplicates: 0, ignored: 0 });

    const chat = await inboundChat(fx.a.licenseId);
    expect(chat).not.toBeNull();
    expect(await owner.chat.count({ where: { licenseId: fx.b.licenseId } })).toBe(chatsInB);
    const inbound = await owner.channelMessage.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, direction: 'inbound', channelType: 'messenger' },
    });
    expect(inbound).toMatchObject({
      providerMessageId: 'm_in-1',
      externalId: PSID,
      chatId: chat!.id,
      text: 'Çekimim bekliyor',
    });
    expect(inbound.channelId).not.toBeNull();

    const window = await server.get(`/chats/${chat!.id}/reply-window`, auth(agentA));
    expect(window.json()).toMatchObject({ channel: 'messenger', live: true, open: true });
    const posted = await server.post(
      `/chats/${chat!.id}/events`,
      { type: 'message', text: 'Kontrol ediyorum', recipients: 'all' },
      auth(agentA),
    );
    expect(posted.statusCode).toBe(201);
    const send = state.calls.find((c) => c.path === `/graph/v21.0/${PAGE_A}/messages`);
    expect(send?.headers['authorization']).toBe(`Bearer ${PAGE_TOKEN}`);
    expect(JSON.parse(send!.body)).toEqual({
      recipient: { id: PSID },
      messaging_type: 'RESPONSE',
      message: { text: 'Kontrol ediyorum' },
    });
    const outbound = await owner.channelMessage.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, direction: 'outbound', channelType: 'messenger' },
    });
    expect(outbound).toMatchObject({
      providerMessageId: 'm_out-1',
      status: 'sent',
      externalId: PSID,
    });

    // Tenant B cannot see the chat or its window (NFR-S5).
    expect((await server.get(`/chats/${chat!.id}/reply-window`, auth(adminB))).statusCode).toBe(
      404,
    );
  });

  it('an Instagram DM to the linked account opens a chat, and the reply goes out through the page (FR-MOD-08.5.7)', async () => {
    expect((await connect('instagram')).statusCode).toBe(200);
    const received = await deliver(
      igDelivery(IG_A, [dm(IGSID, IG_A, 'aWdfZAG1-in-1', 'Bonusum yüklenmedi')]),
    );
    expect(received.accepted).toBe(1);
    const chat = await inboundChat(fx.a.licenseId);
    const identity = await owner.channelIdentity.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, channelType: 'instagram' },
    });
    expect(identity).toMatchObject({ externalId: IGSID, customerId: chat!.customerId });

    const posted = await server.post(
      `/chats/${chat!.id}/events`,
      { type: 'message', text: 'Hemen bakıyorum', recipients: 'all' },
      auth(agentA),
    );
    expect(posted.statusCode).toBe(201);
    const send = state.calls.find((c) => c.path === `/graph/v21.0/${PAGE_A}/messages`);
    expect(send?.headers['authorization']).toBe(`Bearer ${PAGE_TOKEN}`);
    expect(JSON.parse(send!.body)).toMatchObject({
      recipient: { id: IGSID },
      messaging_type: 'RESPONSE',
    });
  });

  it('takes a message delivered twice in once (mid)', async () => {
    expect((await connect('messenger')).statusCode).toBe(200);
    const body = pageDelivery(PAGE_A, [dm(PSID, PAGE_A, 'm_twice', 'tek mesaj')]);
    expect(await deliver(body)).toMatchObject({ accepted: 1, duplicates: 0 });
    expect(await deliver(body)).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(
      await owner.channelMessage.count({
        where: { licenseId: fx.a.licenseId, providerMessageId: 'm_twice' },
      }),
    ).toBe(1);
    const chat = await inboundChat(fx.a.licenseId);
    expect(
      await owner.event.count({
        where: { chatId: chat!.id, authorType: 'customer', text: 'tek mesaj' },
      }),
    ).toBe(1);
  });

  it('drops echoes and receipts, says story replies and attachments, takes a postback as its title', async () => {
    expect((await connect('instagram')).statusCode).toBe(200);
    const now = Date.now();
    const result = await deliver(
      igDelivery(IG_A, [
        // The account's own message coming back.
        {
          sender: { id: IG_A },
          recipient: { id: IGSID },
          timestamp: now,
          message: { mid: 'm_echo', text: 'biz', is_echo: true },
        },
        // A read receipt: nothing to read.
        { sender: { id: IGSID }, recipient: { id: IG_A }, timestamp: now, read: { mid: 'm_echo' } },
        {
          sender: { id: IGSID },
          recipient: { id: IG_A },
          timestamp: now + 1,
          message: {
            mid: 'm_story',
            text: 'bu ne?',
            reply_to: { story: { id: 's1', url: 'https://x' } },
          },
        },
        {
          sender: { id: IGSID },
          recipient: { id: IG_A },
          timestamp: now + 2,
          message: {
            mid: 'm_img',
            attachments: [{ type: 'image', payload: { url: 'https://cdn.example/x.jpg' } }],
          },
        },
        {
          sender: { id: IGSID },
          recipient: { id: IG_A },
          timestamp: now + 3,
          postback: { mid: 'm_pb', title: 'Canlı desteğe bağlan', payload: 'HUMAN' },
        },
      ]),
    );
    expect(result).toMatchObject({ accepted: 3, duplicates: 0 });
    const texts = (
      await owner.channelMessage.findMany({
        where: { licenseId: fx.a.licenseId, direction: 'inbound' },
        orderBy: { createdAt: 'asc' },
      })
    ).map((row) => row.text);
    expect(texts).toEqual(['[Story reply] bu ne?', '[Instagram image]', 'Canlı desteğe bağlan']);
    // The CDN address of the file is not kept.
    expect(JSON.stringify(texts)).not.toContain('cdn.example');
  });

  it('acknowledges a message to a page no live channel answers to, and writes nothing', async () => {
    const before = await owner.chat.count();
    expect(
      await deliver(pageDelivery('999000111', [dm(PSID, '999000111', 'm_stray', 'merhaba')])),
    ).toEqual({
      status: 'received',
      accepted: 0,
      duplicates: 0,
      ignored: 1,
    });
    expect(await owner.chat.count()).toBe(before);
  });

  it('refuses a reply past the 24-hour window, sends nothing, and reopens when the customer writes', async () => {
    expect((await connect('messenger')).statusCode).toBe(200);
    await deliver(pageDelivery(PAGE_A, [dm(PSID, PAGE_A, 'm_old', 'merhaba')]));
    const chat = await inboundChat(fx.a.licenseId);
    await owner.channelIdentity.updateMany({
      where: { licenseId: fx.a.licenseId, channelType: 'messenger' },
      data: { lastCustomerMessageAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const window = await server.get(`/chats/${chat!.id}/reply-window`, auth(agentA));
    expect(window.json()).toMatchObject({ channel: 'messenger', live: true, open: false });
    const eventsBefore = await owner.event.count({ where: { chatId: chat!.id } });
    const posted = await server.post(
      `/chats/${chat!.id}/events`,
      { type: 'message', text: 'geç kalmış yanıt', recipients: 'all' },
      auth(agentA),
    );
    expect(posted.statusCode).toBe(400);
    expect(posted.json()).toMatchObject({
      error: { details: { reason: 'channel_window_closed' } },
    });
    expect(posted.json().error.message).toContain('Messenger');
    expect(await owner.event.count({ where: { chatId: chat!.id } })).toBe(eventsBefore);
    expect(state.calls.some((c) => c.path.endsWith('/messages'))).toBe(false);

    await deliver(pageDelivery(PAGE_A, [dm(PSID, PAGE_A, 'm_new', 'hala bekliyorum')]));
    const reopened = await server.get(`/chats/${chat!.id}/reply-window`, auth(agentA));
    expect(reopened.json()).toMatchObject({ open: true });
  });

  it('marks the channel "reconnect needed" when Meta refuses the page token (190)', async () => {
    expect((await connect('messenger')).statusCode).toBe(200);
    await deliver(pageDelivery(PAGE_A, [dm(PSID, PAGE_A, 'm_r', 'merhaba')]));
    const chat = await inboundChat(fx.a.licenseId);
    state.revoked = true;

    for (const text of ['ilk', 'ikinci']) {
      const posted = await server.post(
        `/chats/${chat!.id}/events`,
        { type: 'message', text, recipients: 'all' },
        auth(agentA),
      );
      expect(posted.statusCode).toBe(201);
    }
    const list = await server.get('/channels', auth(adminA));
    expect((list.json() as { items: Array<Record<string, unknown>> }).items).toContainEqual(
      expect.objectContaining({ type: 'messenger', needs_reconnect: true }),
    );
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'channel.reconnect_required' },
      }),
    ).toBe(1);
    expect(state.calls.filter((c) => c.path.endsWith('/messages')).length).toBe(1);

    state.revoked = false;
    expect((await connect('messenger')).json()).toMatchObject({ needs_reconnect: false });
  });
});

describe('Messenger / Instagram stay mocks without the Meta app (tm 381)', () => {
  it('keeps the routes closed when the channels are not live', async () => {
    const server = await startTestServer({ APPS_LIVE_PROVIDERS: '' });
    try {
      expect(
        (await server.get('/channels/meta/messaging-webhook?hub.mode=subscribe')).statusCode,
      ).toBe(404);
      const env = testEnv({
        APPS_LIVE_PROVIDERS: 'messenger',
        APPS_CREDENTIAL_KEY: CREDENTIAL_KEY,
      });
      expect(env.APPS_LIVE_PROVIDERS).not.toContain('messenger');
    } finally {
      await server.close();
    }
  });
});
