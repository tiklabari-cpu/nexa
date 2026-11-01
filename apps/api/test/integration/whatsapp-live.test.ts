/**
 * The live WhatsApp Cloud API channel, end to end (tm 380 · KN-01 · FR-MOD-08.5.6).
 *
 * The whole server runs with `whatsapp` in `APPS_LIVE_PROVIDERS` and the Graph
 * API pinned to a local HTTPS stand-in (`fake-provider.ts`) — no request
 * leaves the machine; the Meta app's values are made up. Webhook deliveries
 * are signed here exactly as Meta signs them (HMAC-SHA256 of the raw body
 * under the app secret).
 *
 * What is asserted is what a business, its customer and an attacker would
 * see: a message to a workspace's number opens a chat in that workspace and
 * nowhere else, and the agent's reply reaches Graph; an unsigned or wrongly
 * signed delivery writes nothing; a redelivered message is one message; past
 * the 24-hour window nothing is sent and the composer is told why; a file is
 * kept only under the workspace's file-sharing rules; a token Meta refuses
 * marks the channel and tells the admins once.
 */
import { createHmac } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { buildSchedulerJobs } from '../../src/services/scheduler/jobs.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { silentLogger } from '../helpers/scheduler.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const CREDENTIAL_KEY = 'a7'.repeat(32);
const APP_SECRET = 'wa-test-app-secret-5e1d9c';
const VERIFY_TOKEN = 'wa-test-verify-token-2b8f';
const BUSINESS_TOKEN = 'EAAGwa-test-business-token-Qx81Lm';
const BUSINESS_TOKEN_B = 'EAAGwa-test-business-token-B-Zt27Kp';
const GOOD_CODE = 'signup-code-ok';
const GOOD_CODE_B = 'signup-code-ok-b';
const WABA = '102290129340398';
const WABA_B = '102290129340399';
const NUMBER_A = '106540352242922';
const NUMBER_B = '106540352242933';
const CUSTOMER = '905321112233';
/** The smallest PNG there is: a 1×1 transparent pixel. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

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

/** Graph as its documented endpoints answer, for two businesses. */
function graphHandler(state: GraphState, base: () => string) {
  return (request: ProviderRequest, response: ServerResponse): void => {
    const url = new URL(request.path, 'https://graph.local');
    const path = url.pathname;
    if (!path.startsWith('/graph/')) {
      json(response, 404, {});
      return;
    }
    state.calls.push(request);
    const bearer = request.headers['authorization'];
    const tokenOk =
      !state.revoked &&
      (bearer === `Bearer ${BUSINESS_TOKEN}` || bearer === `Bearer ${BUSINESS_TOKEN_B}`);
    if (path === '/graph/v21.0/oauth/access_token') {
      const code = url.searchParams.get('code');
      if (url.searchParams.get('client_secret') !== APP_SECRET) {
        json(response, 400, { error: { message: 'Error validating client secret.', code: 1 } });
      } else if (code === GOOD_CODE || code === GOOD_CODE_B) {
        json(response, 200, {
          access_token: code === GOOD_CODE ? BUSINESS_TOKEN : BUSINESS_TOKEN_B,
          token_type: 'bearer',
        });
      } else {
        json(response, 400, {
          error: { message: `This authorization code has expired. (${String(code)})`, code: 100 },
        });
      }
      return;
    }
    if (!tokenOk) {
      json(response, 401, {
        error: { message: 'Error validating access token: Session has expired', code: 190 },
      });
      return;
    }
    if (
      path === `/graph/v21.0/${WABA}/phone_numbers` ||
      path === `/graph/v21.0/${WABA_B}/phone_numbers`
    ) {
      const own = path.includes(WABA_B) ? NUMBER_B : NUMBER_A;
      json(response, 200, {
        data: [{ id: own, display_phone_number: '+90 555 000 11 22', verified_name: 'Acme Bet' }],
      });
      return;
    }
    if (path.endsWith('/subscribed_apps')) {
      json(response, 200, { success: true });
      return;
    }
    if (path.endsWith('/messages')) {
      state.sent += 1;
      json(response, 200, {
        messaging_product: 'whatsapp',
        contacts: [{ input: CUSTOMER, wa_id: CUSTOMER }],
        messages: [{ id: `wamid.out-${state.sent}` }],
      });
      return;
    }
    if (path === '/graph/v21.0/media-png') {
      json(response, 200, {
        url: `${base()}/graph/download/media-png`,
        mime_type: 'image/png',
        file_size: PNG.length,
        id: 'media-png',
      });
      return;
    }
    if (path === '/graph/download/media-png') {
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(PNG.length),
      });
      response.end(PNG);
      return;
    }
    json(response, 404, { error: { message: 'Unknown path', code: 803 } });
  };
}

/** A Cloud API delivery as Meta sends it. */
function delivery(
  phoneNumberId: string,
  value: { messages?: unknown[]; statuses?: unknown[] },
): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: WABA,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '905550001122', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Ada Kaya' }, wa_id: CUSTOMER }],
              ...value,
            },
          },
        ],
      },
    ],
  };
}

function textMessage(wamid: string, body: string, at = Math.floor(Date.now() / 1000)) {
  return { from: CUSTOMER, id: wamid, timestamp: String(at), type: 'text', text: { body } };
}

/** JSON.stringify cannot write a BigInt (licence ids); a test reading for leaks writes it as text. */
const bigintSafe = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

function signed(body: unknown, secret = APP_SECRET): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` };
}

/** The live deployment's Meta values — made up; Graph is the local stand-in. */
const LIVE_ENV = {
  APPS_LIVE_PROVIDERS: 'whatsapp',
  APPS_CREDENTIAL_KEY: CREDENTIAL_KEY,
  WHATSAPP_APP_ID: '1234567890',
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
  WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: '998877',
  WEB_APP_URL: 'https://app.siyahtus.test',
};

describe('live WhatsApp channel (tm 380 · FR-MOD-08.5.6)', () => {
  let owner: PrismaClient;
  let provider: FakeProvider;
  let server: TestServer;
  let fx: Fixtures;
  let adminA: string;
  let adminB: string;
  let agentA: string;
  let brandA: string;
  const mailer = new MemoryMailer();
  const state: GraphState = { calls: [], revoked: false, sent: 0 };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const post = (body: unknown, signature: string | undefined) =>
    server.app.inject({
      method: 'POST',
      url: '/api/v1/channels/whatsapp/cloud-webhook',
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
    await settled();
    return response;
  };

  /** Until the queue holds nothing pending — the drain runs after the answer. */
  const settled = async () => {
    for (let i = 0; i < 100; i += 1) {
      const pending = await owner.whatsappInboundEvent.count({ where: { state: 'pending' } });
      if (pending === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('whatsapp inbound queue did not settle');
  };

  const connect = async (token = adminA, code = GOOD_CODE, waba = WABA, number = NUMBER_A) =>
    server.post(
      '/channels/whatsapp/connect',
      { code, waba_id: waba, phone_number_id: number },
      auth(token),
    );

  const inboundChat = async (licenseId: bigint) =>
    owner.chat.findFirst({ where: { licenseId }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    owner = ownerClient();
    let base = '';
    provider = await startFakeProvider(graphHandler(state, () => base));
    base = provider.base;
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
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
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

  afterEach(async () => {
    await settled();
  });

  it('hands the Settings card the signup configuration, and only behind the channel scope', async () => {
    const config = await server.get('/channels/whatsapp/signup-config', auth(adminA));
    expect(config.statusCode).toBe(200);
    expect(config.json()).toEqual({
      app_id: '1234567890',
      config_id: '998877',
      graph_version: 'v21.0',
      redirect_uri: 'https://app.siyahtus.test/channels/whatsapp/callback',
    });
    expect(JSON.stringify(config.json())).not.toContain(APP_SECRET);
    expect((await server.get('/channels/whatsapp/signup-config', auth(agentA))).statusCode).toBe(
      403,
    );
  });

  it("answers Meta's subscription handshake only with the verify token", async () => {
    const ok = await server.get(
      `/channels/whatsapp/cloud-webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`,
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('1158201444');
    expect(ok.headers['content-type']).toMatch(/^text\/plain/);
    const wrong = await server.get(
      '/channels/whatsapp/cloud-webhook?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1',
    );
    expect(wrong.statusCode).toBe(403);
  });

  it('connects through the embedded signup: token exchanged and encrypted, number checked, app subscribed', async () => {
    const response = await connect();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      type: 'whatsapp',
      connected: true,
      live: true,
      address: NUMBER_A,
      display_address: '+90 555 000 11 22',
      needs_reconnect: false,
    });
    expect(response.body).not.toContain(BUSINESS_TOKEN);
    expect(
      state.calls.some((c) => c.path.endsWith(`/${WABA}/subscribed_apps`) && c.method === 'POST'),
    ).toBe(true);
    const row = await owner.channel.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, type: 'whatsapp' },
    });
    expect(row.credentialCiphertext).toBeTruthy();
    expect(row.credentialCiphertext).not.toContain(BUSINESS_TOKEN);
    expect(JSON.stringify(row.config)).not.toContain(BUSINESS_TOKEN);
    expect(row.webhookSecretHash).toBeNull();
    const audit = await owner.auditLogEntry.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, action: 'channel.connected' },
    });
    expect(JSON.stringify(audit, bigintSafe)).not.toContain(BUSINESS_TOKEN);
  });

  it('refuses a code Meta refuses and a number outside the account, storing nothing', async () => {
    const badCode = await connect(adminA, 'expired-code');
    expect(badCode.statusCode).toBe(400);
    expect(badCode.json()).toMatchObject({
      error: { details: { reason: 'app_credentials_invalid' } },
    });
    expect(badCode.body).not.toContain(APP_SECRET);

    const otherNumber = await connect(adminA, GOOD_CODE, WABA, '999');
    expect(otherNumber.statusCode).toBe(400);
    expect(otherNumber.json()).toMatchObject({
      error: { details: { reason: 'whatsapp_number_not_in_account' } },
    });
    expect(
      await owner.channel.count({ where: { licenseId: fx.a.licenseId, type: 'whatsapp' } }),
    ).toBe(0);
  });

  it('refuses an unsigned or wrongly signed delivery with 401 and writes nothing', async () => {
    expect((await connect()).statusCode).toBe(200);
    const body = delivery(NUMBER_A, { messages: [textMessage('wamid.forged', 'hello')] });
    const { raw, signature } = signed(body);
    const before = {
      events: await owner.whatsappInboundEvent.count(),
      messages: await owner.channelMessage.count(),
      customers: await owner.customer.count(),
      chats: await owner.chat.count(),
    };

    expect((await post(raw, undefined)).statusCode).toBe(401);
    expect((await post(raw, signed(body, 'not-the-app-secret').signature)).statusCode).toBe(401);
    expect((await post(raw, 'sha256=' + '0'.repeat(64))).statusCode).toBe(401);
    // Signed, then changed: the signature covers the bytes, not the meaning.
    expect((await post(raw.replace('hello', 'hellp'), signature)).statusCode).toBe(401);
    // The flat mock door is closed for a live WhatsApp: it authenticates nobody.
    expect(
      (
        await server.post('/channels/whatsapp/webhook', {
          to: NUMBER_A,
          from: CUSTOMER,
          text: { body: 'forged' },
        })
      ).statusCode,
    ).toBe(404);

    expect({
      events: await owner.whatsappInboundEvent.count(),
      messages: await owner.channelMessage.count(),
      customers: await owner.customer.count(),
      chats: await owner.chat.count(),
    }).toEqual(before);
  });

  it('opens a chat in the workspace that owns the number, and the agent reply reaches Graph', async () => {
    expect((await connect()).statusCode).toBe(200);
    expect((await connect(adminB, GOOD_CODE_B, WABA_B, NUMBER_B)).statusCode).toBe(200);
    const chatsInB = await owner.chat.count({ where: { licenseId: fx.b.licenseId } });

    const received = await deliver(
      delivery(NUMBER_A, { messages: [textMessage('wamid.in-1', 'Çekimim 2 gündür bekliyor')] }),
    );
    expect(received.json()).toEqual({ status: 'received', queued: 1 });

    const chat = await inboundChat(fx.a.licenseId);
    expect(chat).not.toBeNull();
    expect(await owner.chat.count({ where: { licenseId: fx.b.licenseId } })).toBe(chatsInB);
    const customer = await owner.customer.findUniqueOrThrow({ where: { id: chat!.customerId } });
    expect(customer.name).toBe('Ada Kaya');
    const inbound = await owner.channelMessage.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, direction: 'inbound' },
    });
    expect(inbound).toMatchObject({
      providerMessageId: 'wamid.in-1',
      externalId: CUSTOMER,
      chatId: chat!.id,
      text: 'Çekimim 2 gündür bekliyor',
    });

    // The agent reads it in the inbox and answers.
    const detail = await server.get(`/chats/${chat!.id}`, auth(agentA));
    expect(detail.statusCode).toBe(200);
    const window = await server.get(`/chats/${chat!.id}/reply-window`, auth(agentA));
    expect(window.json()).toMatchObject({ channel: 'whatsapp', live: true, open: true });
    const posted = await server.post(
      `/chats/${chat!.id}/events`,
      { type: 'message', text: 'Kontrol ediyorum', recipients: 'all' },
      auth(agentA),
    );
    expect(posted.statusCode).toBe(201);
    const send = state.calls.find((c) => c.path === `/graph/v21.0/${NUMBER_A}/messages`);
    expect(send?.headers['authorization']).toBe(`Bearer ${BUSINESS_TOKEN}`);
    expect(JSON.parse(send!.body)).toMatchObject({
      messaging_product: 'whatsapp',
      to: CUSTOMER,
      type: 'text',
      text: { body: 'Kontrol ediyorum' },
    });
    const outbound = await owner.channelMessage.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, direction: 'outbound' },
    });
    expect(outbound).toMatchObject({ providerMessageId: 'wamid.out-1', status: 'sent' });

    // Tenant B's agent cannot see the chat or its window (NFR-S5).
    expect((await server.get(`/chats/${chat!.id}/reply-window`, auth(adminB))).statusCode).toBe(
      404,
    );
  });

  it('takes a message delivered twice in once (wamid)', async () => {
    expect((await connect()).statusCode).toBe(200);
    const body = delivery(NUMBER_A, { messages: [textMessage('wamid.twice', 'tek mesaj')] });
    await deliver(body);
    const again = await deliver(body);
    expect(again.json()).toEqual({ status: 'received', queued: 0 });

    // Even past the queue's own key: a row processed twice is one message.
    await owner.whatsappInboundEvent.updateMany({
      data: { state: 'pending', processedAt: null, nextAttemptAt: new Date(0) },
    });
    await owner.whatsappInboundEvent.updateMany({
      data: {
        payload: {
          wamid: 'wamid.twice',
          from: CUSTOMER,
          profileName: 'Ada Kaya',
          at: new Date().toISOString(),
          type: 'text',
          text: 'tek mesaj',
          media: null,
          sensitive_types: [],
        },
      },
    });
    // Any delivery for the workspace drains its due rows, the reset one included.
    await deliver(
      delivery(NUMBER_A, {
        statuses: [
          {
            id: 'wamid.unknown',
            status: 'sent',
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: CUSTOMER,
          },
        ],
      }),
    );

    expect(
      await owner.channelMessage.count({
        where: { licenseId: fx.a.licenseId, providerMessageId: 'wamid.twice' },
      }),
    ).toBe(1);
    const chat = await inboundChat(fx.a.licenseId);
    const events = await owner.event.count({
      where: { chatId: chat!.id, authorType: 'customer', text: 'tek mesaj' },
    });
    expect(events).toBe(1);
  });

  it('refuses a reply past the 24-hour window, sends nothing, and says why', async () => {
    expect((await connect()).statusCode).toBe(200);
    await deliver(delivery(NUMBER_A, { messages: [textMessage('wamid.old', 'merhaba')] }));
    const chat = await inboundChat(fx.a.licenseId);
    await owner.channelIdentity.updateMany({
      where: { licenseId: fx.a.licenseId, channelType: 'whatsapp' },
      data: { lastCustomerMessageAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const window = await server.get(`/chats/${chat!.id}/reply-window`, auth(agentA));
    expect(window.statusCode).toBe(200);
    expect(window.json()).toMatchObject({ channel: 'whatsapp', live: true, open: false });

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
    expect(await owner.event.count({ where: { chatId: chat!.id } })).toBe(eventsBefore);
    expect(state.calls.some((c) => c.path.endsWith('/messages'))).toBe(false);

    // An internal note still goes: it never leaves the building.
    const note = await server.post(
      `/chats/${chat!.id}/events`,
      { type: 'message', text: 'şablon gerekecek', recipients: 'agents' },
      auth(agentA),
    );
    expect(note.statusCode).toBe(201);

    // The customer writes again: the window reopens.
    await deliver(delivery(NUMBER_A, { messages: [textMessage('wamid.new', 'hala bekliyorum')] }));
    const reopened = await server.get(`/chats/${chat!.id}/reply-window`, auth(agentA));
    expect(reopened.json()).toMatchObject({ open: true });
  });

  it('keeps an incoming image under the file-sharing rules, and not when sharing is off', async () => {
    expect((await connect()).statusCode).toBe(200);
    const image = (wamid: string) => ({
      from: CUSTOMER,
      id: wamid,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'image',
      image: { id: 'media-png', mime_type: 'image/png', sha256: 'x', caption: 'dekont' },
    });
    await deliver(delivery(NUMBER_A, { messages: [image('wamid.img-1')] }));
    const chat = await inboundChat(fx.a.licenseId);
    const kept = await owner.event.findFirstOrThrow({
      where: { chatId: chat!.id, authorType: 'customer' },
      orderBy: { createdAt: 'desc' },
    });
    expect(kept.text).toBe('dekont');
    expect(kept.attachmentUrl).toMatch(
      new RegExp(`^/api/v1/uploads/${fx.a.licenseId}-[0-9a-f-]{36}\\.png$`),
    );
    const file = await server.get(kept.attachmentUrl!.slice('/api/v1'.length), auth(agentA));
    expect(file.statusCode).toBe(200);
    expect(Buffer.from(file.rawPayload).equals(PNG)).toBe(true);

    await owner.securitySettings.create({
      data: { licenseId: fx.a.licenseId, brandId: brandA, fileSharingEnabled: false },
    });
    const downloadsBefore = state.calls.filter((c) => c.path.includes('/download/')).length;
    await deliver(delivery(NUMBER_A, { messages: [image('wamid.img-2')] }));
    const refused = await owner.event.findFirstOrThrow({
      where: { chatId: chat!.id, authorType: 'customer' },
      orderBy: { createdAt: 'desc' },
    });
    expect(refused.attachmentUrl).toBeNull();
    expect(refused.text).toBe(
      'dekont\n[WhatsApp image not kept: file sharing is turned off for this workspace]',
    );
    expect(state.calls.filter((c) => c.path.includes('/download/')).length).toBe(downloadsBefore);
  });

  it('masks a card number before it is queued or stored', async () => {
    expect((await connect()).statusCode).toBe(200);
    const { raw, signature } = signed(
      delivery(NUMBER_A, { messages: [textMessage('wamid.card', 'kartım 4111 1111 1111 1111')] }),
    );
    expect((await post(raw, signature)).statusCode).toBe(200);
    const queued = await owner.whatsappInboundEvent.findFirstOrThrow({
      where: { kind: 'message' },
    });
    expect(JSON.stringify(queued.payload)).not.toContain('4111 1111 1111 1111');
    await settled();
    const logged = await owner.channelMessage.findFirstOrThrow({
      where: { providerMessageId: 'wamid.card' },
    });
    expect(logged.text).not.toContain('4111 1111 1111 1111');
  });

  it('moves an outbound message forward on statuses, and a read marks the chat seen (IN-05)', async () => {
    expect((await connect()).statusCode).toBe(200);
    await deliver(delivery(NUMBER_A, { messages: [textMessage('wamid.q', 'soru')] }));
    const chat = await inboundChat(fx.a.licenseId);
    expect(
      (
        await server.post(
          `/chats/${chat!.id}/events`,
          { type: 'message', text: 'cevap', recipients: 'all' },
          auth(agentA),
        )
      ).statusCode,
    ).toBe(201);
    const status = (value: string) => ({
      id: 'wamid.out-1',
      status: value,
      timestamp: String(Math.floor(Date.now() / 1000)),
      recipient_id: CUSTOMER,
    });
    await deliver(delivery(NUMBER_A, { statuses: [status('read')] }));
    // A late `delivered` does not undo the `read`.
    await deliver(delivery(NUMBER_A, { statuses: [status('delivered')] }));
    const row = await owner.channelMessage.findFirstOrThrow({
      where: { providerMessageId: 'wamid.out-1' },
    });
    expect(row.status).toBe('read');
    const seen = await owner.chatUser.findFirst({
      where: { chatId: chat!.id, userId: chat!.customerId },
    });
    expect(seen?.seenUpTo).not.toBeNull();
  });

  it('marks the channel "reconnect needed" when Meta refuses the token (190), and mails the admins once', async () => {
    expect((await connect()).statusCode).toBe(200);
    await deliver(delivery(NUMBER_A, { messages: [textMessage('wamid.r', 'merhaba')] }));
    const chat = await inboundChat(fx.a.licenseId);
    state.revoked = true;

    for (const text of ['ilk', 'ikinci']) {
      const posted = await server.post(
        `/chats/${chat!.id}/events`,
        { type: 'message', text, recipients: 'all' },
        auth(agentA),
      );
      // The agent's message is stored; delivery failing is not their error.
      expect(posted.statusCode).toBe(201);
    }

    const row = await owner.channel.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, type: 'whatsapp' },
    });
    expect(row.reconnectRequiredAt).not.toBeNull();
    const list = await server.get('/channels', auth(adminA));
    expect((list.json() as { items: Array<Record<string, unknown>> }).items).toContainEqual(
      expect.objectContaining({ type: 'whatsapp', needs_reconnect: true }),
    );
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'channel.reconnect_required' },
      }),
    ).toBe(1);
    // Graph was asked once; the second reply was refused before it.
    expect(state.calls.filter((c) => c.path.endsWith('/messages')).length).toBe(1);
    for (let i = 0; i < 40 && mailer.sent.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const notices = mailer.sent.filter((mail) => /reconnect|yeniden bağla/i.test(mail.subject));
    expect(notices.map((mail) => mail.to)).toEqual([`owner-a@example.test`]);
    expect(JSON.stringify(notices, bigintSafe)).not.toContain(CUSTOMER);

    // Connecting again clears it.
    state.revoked = false;
    expect((await connect()).json()).toMatchObject({ needs_reconnect: false });
  });

  it("takes in a message a crash left queued, on the scheduler's webhook_redelivery pass", async () => {
    expect((await connect()).statusCode).toBe(200);
    const channel = await owner.channel.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, type: 'whatsapp' },
    });
    // What the webhook wrote before the process died: a row nobody drained.
    await owner.whatsappInboundEvent.create({
      data: {
        licenseId: fx.a.licenseId,
        channelId: channel.id,
        dedupKey: 'm:wamid.left-behind',
        kind: 'message',
        nextAttemptAt: new Date(Date.now() - 1000),
        payload: {
          wamid: 'wamid.left-behind',
          from: CUSTOMER,
          profileName: 'Ada Kaya',
          at: new Date().toISOString(),
          type: 'text',
          text: 'kayboldu mu?',
          media: null,
          sensitive_types: [],
        },
      },
    });
    const job = buildSchedulerJobs({
      db: server.app.db,
      env: testEnv(LIVE_ENV),
      mailer,
    }).find((candidate) => candidate.name === 'webhook_redelivery');
    const outcome = await job!.run({
      signal: new AbortController().signal,
      logger: silentLogger(),
    });
    expect(outcome?.counts).toMatchObject({ whatsapp_tenants: 1, whatsapp_done: 1 });
    const row = await owner.whatsappInboundEvent.findFirstOrThrow({
      where: { dedupKey: 'm:wamid.left-behind' },
    });
    expect(row).toMatchObject({ state: 'done', payload: {} });
    expect(
      await owner.channelMessage.count({
        where: { licenseId: fx.a.licenseId, providerMessageId: 'wamid.left-behind' },
      }),
    ).toBe(1);
  });

  it('acknowledges a delivery for a number nobody connects, writing nothing', async () => {
    const response = await deliver(
      delivery('777000111', { messages: [textMessage('wamid.stray', 'kimse yok mu')] }),
    );
    expect(response.json()).toEqual({ status: 'received', queued: 0 });
    expect(await owner.whatsappInboundEvent.count()).toBe(0);
    expect(await owner.customer.count({ where: { name: 'Ada Kaya' } })).toBe(0);
  });

  it('forgets the token on disconnect and stops taking deliveries for the number', async () => {
    expect((await connect()).statusCode).toBe(200);
    expect((await server.post('/channels/whatsapp/disconnect', {}, auth(adminA))).statusCode).toBe(
      204,
    );
    const row = await owner.channel.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, type: 'whatsapp' },
    });
    expect(row.credentialCiphertext).toBeNull();
    const response = await deliver(
      delivery(NUMBER_A, { messages: [textMessage('wamid.after', 'hala orada mısınız')] }),
    );
    expect(response.json()).toEqual({ status: 'received', queued: 0 });
  });
});
