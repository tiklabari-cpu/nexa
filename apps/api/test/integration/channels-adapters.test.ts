/**
 * Omnichannel adapters (MOCK) — FR-MOD-08.5.4/.5/.6 (v1, Must),
 * FR-MOD-08.5.7 (Instagram DMs, v2) and FR-MOD-08.5.8 (Telegram, Enterprise).
 *
 * The properties the acceptance criteria name, proven end to end against real
 * Postgres + Redis + Fastify:
 *
 *   - "message → inbox chat": a provider webhook opens (or continues) a chat on
 *     the same core the widget uses — routed, with a customer-authored event.
 *   - outbound: an agent reply leaves through the channel (mock) and is recorded.
 *   - isolation (NFR-S5): a channel, its identities and its message log belong to
 *     one licence; the same external sender writing to two workspaces is two
 *     customers, and one tenant cannot reply into another's chat.
 *
 * Isolation and refusal come first — those are the point of the feature.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface ConnectedChannel {
  type: string;
  status: string;
  address: string | null;
  connected: boolean;
  created_at: string;
}

/** One channel's provider-specific shapes, so the KK runs against every one. */
interface ChannelCase {
  type: 'messenger' | 'twilio' | 'whatsapp' | 'instagram' | 'telegram';
  addressA: string;
  addressB: string;
  sender: string;
  connect: (address: string) => Record<string, unknown>;
  inbound: (
    address: string,
    sender: string,
    text: string,
    name?: string,
  ) => Record<string, unknown>;
}

const CASES: ChannelCase[] = [
  {
    type: 'messenger',
    addressA: '100000000000001',
    addressB: '100000000000009',
    sender: 'psid_sender_alpha',
    connect: (page_id) => ({ code: 'AQD_mock_oauth_code', page_id, page_name: 'Acme' }),
    inbound: (page_id, sender, text, name) => ({
      recipient: { id: page_id },
      sender: { id: sender, ...(name ? { name } : {}) },
      message: { text },
    }),
  },
  {
    type: 'twilio',
    addressA: '+14150000001',
    addressB: '+14150000009',
    sender: '+14155551234',
    connect: (phone_number) => ({ account_sid: 'ACmock', auth_token: 'sekret', phone_number }),
    inbound: (to, from, text) => ({ To: to, From: from, Body: text }),
  },
  {
    type: 'whatsapp',
    addressA: '+441632000001',
    addressB: '+441632000009',
    sender: '+441632991234',
    connect: (phone_number) => ({ waba_id: 'waba_mock', phone_number }),
    inbound: (to, from, text, name) => ({
      to,
      from,
      text: { body: text },
      ...(name ? { profile_name: name } : {}),
    }),
  },
  {
    // Instagram DMs (08.5.7): the connected IG account's id is the address, the
    // sender is an IGSID — Instagram-scoped, so the same person writing to two
    // workspaces is two senders at the provider as well as two customers here.
    type: 'instagram',
    addressA: '17841400000000001',
    addressB: '17841400000000009',
    sender: 'igsid_sender_alpha',
    connect: (ig_user_id) => ({
      code: 'IGQ_mock_oauth_code',
      ig_user_id,
      username: 'acme_support',
    }),
    inbound: (ig_user_id, sender, text, name) => ({
      recipient: { id: ig_user_id },
      sender: { id: sender, ...(name ? { username: name } : {}) },
      message: { text },
    }),
  },
  {
    // Telegram bots (08.5.8): the connected bot's `@username` is the address —
    // public and short, unlike the other four, which is exactly why the address
    // ownership rule below matters here. The sender is a Telegram user id.
    type: 'telegram',
    addressA: 'acme_support_bot',
    addressB: 'globex_support_bot',
    sender: '884219991',
    connect: (bot_username) => ({
      bot_token: '123456789:AAmockBotTokenString-Value',
      bot_username,
    }),
    inbound: (bot_username, sender, text, name) => ({
      recipient: { id: bot_username },
      sender: { id: sender, ...(name ? { username: name } : {}) },
      message: { text },
    }),
  },
];

/** The Instagram case, for the assertions that are about it specifically. */
const INSTAGRAM = CASES.find((c) => c.type === 'instagram')!;
/** Likewise Telegram (08.5.8-c). */
const TELEGRAM = CASES.find((c) => c.type === 'telegram')!;

describe('omnichannel adapters (FR-MOD-08.5.4-.6)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminA: string;
  let readA: string;
  let adminB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const chatsFor = (licenseId: bigint) => owner.chat.findMany({ where: { licenseId } });
  const eventsFor = (chatId: string) =>
    owner.event.findMany({ where: { chatId }, orderBy: { createdAt: 'asc' } });
  const messagesFor = (licenseId: bigint) =>
    owner.channelMessage.findMany({ where: { licenseId }, orderBy: { createdAt: 'asc' } });
  const identitiesFor = (licenseId: bigint) =>
    owner.channelIdentity.findMany({ where: { licenseId } });

  /** A team + fallback rule so a routed chat lands somewhere, per tenant. */
  async function seedTeam(licenseId: bigint, agentId: string): Promise<void> {
    const group = await owner.group.create({
      data: { licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: { licenseId, groupId: group.id, agentId, priority: 'normal' },
    });
    await owner.routingRule.create({
      data: { licenseId, kind: 'chat', isFallback: true, targetGroupId: group.id },
    });
  }

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
    // A channel belongs to a brand now (brand_id is NOT NULL); connecting with no
    // `X-Nexa-Brand` falls back to the license default, so each tenant needs one —
    // the single row signup/seed lay down for every real license.
    await owner.brand.createMany({
      data: [
        { licenseId: fx.a.licenseId, name: 'Default', slug: 'default', isDefault: true },
        { licenseId: fx.b.licenseId, name: 'Default', slug: 'default', isDefault: true },
      ],
    });
    await seedTeam(fx.a.licenseId, fx.a.agentAccountId);
    await seedTeam(fx.b.licenseId, fx.b.agentAccountId);

    adminA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:rw'],
    });
    readA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:ro'],
    });
    adminB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['channels--all:rw'],
    });
  });

  const connect = (type: string, body: Record<string, unknown>, token = adminA) =>
    server.post(`/channels/${type}/connect`, body, auth(token));
  const webhook = (type: string, body: Record<string, unknown>) =>
    server.post(`/channels/${type}/webhook`, body);
  const sendOut = (type: string, body: Record<string, unknown>, token = adminA) =>
    server.post(`/channels/${type}/messages`, body, auth(token));

  // --- Connect / list / disconnect (the `channels` consumer) -----------------

  describe('connect / list / disconnect', () => {
    it('requires the write scope to connect', async () => {
      const res = await connect('messenger', CASES[0]!.connect(CASES[0]!.addressA), readA);
      expect(res.statusCode).toBe(403);
    });

    it('404s an unknown channel type', async () => {
      // `email` is a channel the product names and the channels_type_check
      // constraint allows, but it resolves its tenant its own way and has no
      // adapter — so the route surface does not exist for it. (This stood on
      // `telegram` until 08.5.8-c gave Telegram an adapter.)
      const res = await server.post('/channels/email/connect', { x: 1 }, auth(adminA));
      expect(res.statusCode).toBe(404);
    });

    it('400s a malformed connect body', async () => {
      // Missing page_id — the adapter refuses it.
      const res = await connect('messenger', { code: 'x' });
      expect(res.statusCode).toBe(400);
    });

    it('connects, lists, and disconnects a channel', async () => {
      const res = await connect('messenger', CASES[0]!.connect('100000000000001'));
      expect(res.statusCode).toBe(200);
      const channel = res.json() as ConnectedChannel;
      expect(channel).toMatchObject({
        type: 'messenger',
        status: 'connected',
        address: '100000000000001',
        connected: true,
      });

      // Stored on the row, and the address is what the resolver keys on.
      const row = await owner.channel.findFirst({
        where: { licenseId: fx.a.licenseId, type: 'messenger' },
      });
      expect((row?.config as { address?: string }).address).toBe('100000000000001');

      const list = (await server.get('/channels', auth(readA))).json() as {
        items: ConnectedChannel[];
      };
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({ type: 'messenger', connected: true });

      const off = await server.post('/channels/messenger/disconnect', undefined, auth(adminA));
      expect(off.statusCode).toBe(204);

      const afterList = (await server.get('/channels', auth(readA))).json() as {
        items: ConnectedChannel[];
      };
      expect(afterList.items[0]).toMatchObject({
        type: 'messenger',
        status: 'off',
        connected: false,
        address: null,
      });

      // A second disconnect changes nothing — 404, indistinguishable from a
      // channel that was never connected (NFR-S5).
      const again = await server.post('/channels/messenger/disconnect', undefined, auth(adminA));
      expect(again.statusCode).toBe(404);
    });

    it('re-connecting a channel reconfigures it in place, not a duplicate', async () => {
      await connect('messenger', CASES[0]!.connect('100000000000001'));
      await connect('messenger', CASES[0]!.connect('100000000000002'));

      const rows = await owner.channel.findMany({
        where: { licenseId: fx.a.licenseId, type: 'messenger' },
      });
      expect(rows).toHaveLength(1);
      expect((rows[0]!.config as { address?: string }).address).toBe('100000000000002');
    });
  });

  // --- Inbound → chat + outbound, per channel (the KK) -----------------------

  describe.each(CASES)('$type adapter', (c) => {
    it('turns an inbound webhook into a routed inbox chat', async () => {
      await connect(c.type, c.connect(c.addressA));

      const res = await webhook(
        c.type,
        c.inbound(c.addressA, c.sender, 'hello from the channel', 'Dana'),
      );
      expect(res.statusCode).toBe(200);
      const body = res.json() as { status: string; chat_id: string; customer_id: string };
      expect(body.status).toBe('accepted');
      expect(body.chat_id).toMatch(/^[A-Za-z0-9]{10,12}$/);

      // A real chat under A, with the sender's message authored by the customer.
      const chats = await chatsFor(fx.a.licenseId);
      expect(chats).toHaveLength(1);
      expect(chats[0]!.id).toBe(body.chat_id);
      expect(chats[0]!.customerId).toBe(body.customer_id);

      const events = await eventsFor(body.chat_id);
      const message = events.find((e) => e.type === 'message');
      expect(message?.text).toBe('hello from the channel');
      expect(message?.authorType).toBe('customer');

      // The customer was created from the sender's channel identity…
      const identities = await identitiesFor(fx.a.licenseId);
      expect(identities).toHaveLength(1);
      expect(identities[0]).toMatchObject({
        channelType: c.type,
        externalId: c.sender,
        customerId: body.customer_id,
      });
      // …and the inbound was logged.
      const inboundLog = (await messagesFor(fx.a.licenseId)).filter(
        (m) => m.direction === 'inbound',
      );
      expect(inboundLog).toHaveLength(1);
      expect(inboundLog[0]).toMatchObject({ externalId: c.sender, chatId: body.chat_id });
    });

    it('reuses the same customer and chat for a returning sender', async () => {
      await connect(c.type, c.connect(c.addressA));
      const first = (await webhook(c.type, c.inbound(c.addressA, c.sender, 'first'))).json() as {
        chat_id: string;
        customer_id: string;
      };
      const second = (await webhook(c.type, c.inbound(c.addressA, c.sender, 'second'))).json() as {
        chat_id: string;
        customer_id: string;
      };

      expect(second.customer_id).toBe(first.customer_id);
      expect(second.chat_id).toBe(first.chat_id);
      expect(await identitiesFor(fx.a.licenseId)).toHaveLength(1);
      expect(await chatsFor(fx.a.licenseId)).toHaveLength(1);
      const messages = (await eventsFor(first.chat_id)).filter((e) => e.type === 'message');
      expect(messages.map((m) => m.text)).toEqual(['first', 'second']);
    });

    it('404s an inbound to an address no connected channel owns', async () => {
      // Connected at a different address; this recipient matches nothing.
      await connect(c.type, c.connect(c.addressA));
      const res = await webhook(c.type, c.inbound(c.addressB, c.sender, 'nobody home'));
      expect(res.statusCode).toBe(404);
      expect(await chatsFor(fx.a.licenseId)).toHaveLength(0);
    });

    it('stops accepting inbound once the channel is disconnected', async () => {
      await connect(c.type, c.connect(c.addressA));
      await server.post(`/channels/${c.type}/disconnect`, undefined, auth(adminA));
      const res = await webhook(c.type, c.inbound(c.addressA, c.sender, 'still there?'));
      expect(res.statusCode).toBe(404);
    });

    it('sends an outbound reply by chat and by external id, recording each', async () => {
      await connect(c.type, c.connect(c.addressA));
      const inbound = (await webhook(c.type, c.inbound(c.addressA, c.sender, 'hi'))).json() as {
        chat_id: string;
      };

      const byChat = await sendOut(c.type, {
        chat_id: inbound.chat_id,
        text: 'thanks for reaching out',
      });
      expect(byChat.statusCode).toBe(200);
      const sent = byChat.json() as {
        provider_message_id: string;
        external_id: string;
        chat_id: string;
      };
      expect(sent.external_id).toBe(c.sender);
      expect(sent.chat_id).toBe(inbound.chat_id);
      expect(sent.provider_message_id).toBeTruthy();

      const byExternal = await sendOut(c.type, { external_id: c.sender, text: 'direct reply' });
      expect(byExternal.statusCode).toBe(200);

      const outbound = (await messagesFor(fx.a.licenseId)).filter(
        (m) => m.direction === 'outbound',
      );
      expect(outbound).toHaveLength(2);
      expect(outbound[0]).toMatchObject({
        externalId: c.sender,
        chatId: inbound.chat_id,
        text: 'thanks for reaching out',
      });
      expect(outbound[0]!.providerMessageId).toBeTruthy();
      expect(outbound[1]).toMatchObject({
        externalId: c.sender,
        chatId: null,
        text: 'direct reply',
      });
    });

    it('refuses outbound without the write scope, to a disconnected channel, and with bad addressing', async () => {
      // Not connected yet → cannot send.
      expect((await sendOut(c.type, { external_id: c.sender, text: 'x' })).statusCode).toBe(400);

      await connect(c.type, c.connect(c.addressA));
      // Read scope cannot send.
      expect((await sendOut(c.type, { external_id: c.sender, text: 'x' }, readA)).statusCode).toBe(
        403,
      );
      // Exactly one of chat_id / external_id.
      expect(
        (await sendOut(c.type, { chat_id: 'X', external_id: c.sender, text: 'x' })).statusCode,
      ).toBe(400);
      expect((await sendOut(c.type, { text: 'x' })).statusCode).toBe(400);
    });
  });

  // --- Instagram wiring (08.5.7-c) -------------------------------------------

  describe('instagram (FR-MOD-08.5.7)', () => {
    const c = INSTAGRAM;

    it('reaches the Instagram adapter specifically, not merely some adapter', async () => {
      // Every case above would still pass if the registry mapped `instagram` to
      // the wrong adapter — the shapes are shared. The provider message id and
      // the stored config are the tell that the right one is on the other end.
      await connect(c.type, c.connect(c.addressA));

      const row = await owner.channel.findFirst({
        where: { licenseId: fx.a.licenseId, type: 'instagram' },
      });
      const config = (row?.config ?? {}) as Record<string, unknown>;
      expect(config['ig_user_id']).toBe(c.addressA);
      expect(config['address']).toBe(c.addressA);
      expect(config['ig_access_token']).toMatch(/^mock_ig_access_token_/);
      // The OAuth code was exchanged and discarded, never persisted.
      expect(config).not.toHaveProperty('code');

      const inbound = (await webhook(c.type, c.inbound(c.addressA, c.sender, 'hi'))).json() as {
        chat_id: string;
      };
      const sent = (await sendOut(c.type, { chat_id: inbound.chat_id, text: 'on it' })).json() as {
        provider_message_id: string;
      };
      expect(sent.provider_message_id).toMatch(/^aigid\./);
    });

    it('carries the sender username onto the customer it creates', async () => {
      await connect(c.type, c.connect(c.addressA));
      const res = (
        await webhook(c.type, c.inbound(c.addressA, c.sender, 'hey', 'dana_h'))
      ).json() as {
        customer_id: string;
      };
      const customer = await owner.customer.findUnique({ where: { id: res.customer_id } });
      expect(customer?.name).toBe('dana_h');
    });
  });

  // --- Telegram wiring (08.5.8-c) --------------------------------------------

  describe('telegram (FR-MOD-08.5.8)', () => {
    const c = TELEGRAM;

    it('reaches the Telegram adapter specifically, not merely some adapter', async () => {
      // The five cases share their shapes, so a registry entry pointing at the
      // wrong adapter would pass every one of them. The stored config and the
      // provider message id are the tell that the right one is on the far end.
      await connect(c.type, c.connect(c.addressA));

      const row = await owner.channel.findFirst({
        where: { licenseId: fx.a.licenseId, type: 'telegram' },
      });
      const config = (row?.config ?? {}) as Record<string, unknown>;
      expect(config['bot_username']).toBe(c.addressA);
      expect(config['address']).toBe(c.addressA);

      const inbound = (await webhook(c.type, c.inbound(c.addressA, c.sender, 'hi'))).json() as {
        chat_id: string;
      };
      const sent = (await sendOut(c.type, { chat_id: inbound.chat_id, text: 'on it' })).json() as {
        provider_message_id: string;
      };
      expect(sent.provider_message_id).toMatch(/^tg\./);
    });

    it('never persists the bot token the caller handed it', async () => {
      // The one way Telegram differs from the other four: `bot_token` is a real
      // credential supplied by the caller, not a mock the server minted, and
      // `ConnectResult.config` promises it holds no raw secret (§6.1.1). Proven
      // against the stored row rather than the adapter's return value — the row
      // is what a database dump, a support query or a backup would expose.
      const res = await connect(c.type, c.connect(c.addressA));
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain('AAmockBotTokenString');

      const row = await owner.channel.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, type: 'telegram' },
      });
      expect(row.config).not.toHaveProperty('bot_token');
      expect(JSON.stringify(row.config)).not.toContain('AAmockBotTokenString');
    });

    it('carries the sender username onto the customer it creates', async () => {
      await connect(c.type, c.connect(c.addressA));
      const res = (
        await webhook(c.type, c.inbound(c.addressA, c.sender, 'merhaba', 'dana_h'))
      ).json() as { customer_id: string };
      const customer = await owner.customer.findUnique({ where: { id: res.customer_id } });
      expect(customer?.name).toBe('dana_h');
    });
  });

  // --- Cross-tenant isolation (NFR-S5) ---------------------------------------

  describe('cross-tenant isolation', () => {
    const c = CASES[0]!; // messenger stands in; the path is identical per channel

    it('keeps an inbound chat, its identity and its log inside one licence', async () => {
      await connect(c.type, c.connect(c.addressA), adminA);
      const res = await webhook(c.type, c.inbound(c.addressA, c.sender, 'for A only'));
      expect(res.statusCode).toBe(200);

      expect(await chatsFor(fx.a.licenseId)).toHaveLength(1);
      expect(await chatsFor(fx.b.licenseId)).toHaveLength(0);
      expect(await identitiesFor(fx.b.licenseId)).toHaveLength(0);
      expect(await messagesFor(fx.b.licenseId)).toHaveLength(0);

      // B cannot even see A has the channel connected.
      const listB = (await server.get('/channels', auth(adminB))).json() as {
        items: ConnectedChannel[];
      };
      expect(listB.items).toHaveLength(0);
    });

    it('treats the same sender writing to two workspaces as two customers', async () => {
      // Distinct addresses (a page/number belongs to one workspace), same sender.
      await connect(c.type, c.connect(c.addressA), adminA);
      await connect(c.type, c.connect(c.addressB), adminB);

      const toA = (await webhook(c.type, c.inbound(c.addressA, c.sender, 'hi A'))).json() as {
        customer_id: string;
      };
      const toB = (await webhook(c.type, c.inbound(c.addressB, c.sender, 'hi B'))).json() as {
        customer_id: string;
      };

      expect(toA.customer_id).not.toBe(toB.customer_id);
      expect(await chatsFor(fx.a.licenseId)).toHaveLength(1);
      expect(await chatsFor(fx.b.licenseId)).toHaveLength(1);
      expect(await identitiesFor(fx.a.licenseId)).toHaveLength(1);
      expect(await identitiesFor(fx.b.licenseId)).toHaveLength(1);
    });

    it("will not let one tenant reply into another tenant's chat", async () => {
      await connect(c.type, c.connect(c.addressA), adminA);
      await connect(c.type, c.connect(c.addressB), adminB);
      const inbound = (await webhook(c.type, c.inbound(c.addressA, c.sender, 'hi'))).json() as {
        chat_id: string;
      };

      // B holds the channel too, but A's chat id is invisible under B's RLS →
      // 404, not a leak that the chat exists.
      const res = await sendOut(c.type, { chat_id: inbound.chat_id, text: 'intrusion' }, adminB);
      expect(res.statusCode).toBe(404);
      // Nothing was recorded for B.
      expect(
        (await messagesFor(fx.b.licenseId)).filter((m) => m.direction === 'outbound'),
      ).toHaveLength(0);
    });

    it('routes an Instagram DM by the receiving account while both tenants hold instagram', async () => {
      // The one Instagram-specific isolation risk: an IG account id is public
      // and guessable, and the inbound webhook is unauthenticated. What decides
      // the tenant is the recipient address, not "who has instagram connected".
      const ig = INSTAGRAM;
      await connect(ig.type, ig.connect(ig.addressA), adminA);
      await connect(ig.type, ig.connect(ig.addressB), adminB);

      const dm = (
        await webhook(ig.type, ig.inbound(ig.addressA, ig.sender, 'DM for A'))
      ).json() as {
        chat_id: string;
      };

      expect(await chatsFor(fx.a.licenseId)).toHaveLength(1);
      expect(await chatsFor(fx.b.licenseId)).toHaveLength(0);
      expect(await identitiesFor(fx.b.licenseId)).toHaveLength(0);
      expect(await messagesFor(fx.b.licenseId)).toHaveLength(0);

      // B cannot reply into it, by chat id or by naming the sender's IGSID —
      // the second is B's own channel, but that sender is a stranger there.
      expect(
        (await sendOut(ig.type, { chat_id: dm.chat_id, text: 'intrusion' }, adminB)).statusCode,
      ).toBe(404);
      expect(
        (await sendOut(ig.type, { external_id: ig.sender, text: 'intrusion' }, adminB)).statusCode,
      ).toBe(200);
      // …and that reply is B's own outbound to a sender B has never heard from,
      // logged under B — it never touches A's chat or message log.
      const outboundB = (await messagesFor(fx.b.licenseId)).filter(
        (m) => m.direction === 'outbound',
      );
      expect(outboundB).toHaveLength(1);
      expect(outboundB[0]).toMatchObject({ chatId: null });
      expect(
        (await messagesFor(fx.a.licenseId)).filter((m) => m.direction === 'outbound'),
      ).toHaveLength(0);
    });

    it('routes a Telegram message by the receiving bot while both tenants hold telegram', async () => {
      // Same risk as Instagram's, sharper: a bot `@username` is public, short
      // and typed by humans, so guessing one is easier than guessing an IG
      // account id. What decides the tenant is still the recipient address on an
      // unauthenticated webhook — not "who has telegram connected".
      const tg = TELEGRAM;
      await connect(tg.type, tg.connect(tg.addressA), adminA);
      await connect(tg.type, tg.connect(tg.addressB), adminB);

      const msg = (
        await webhook(tg.type, tg.inbound(tg.addressA, tg.sender, 'A icin mesaj'))
      ).json() as { chat_id: string };

      expect(await chatsFor(fx.a.licenseId)).toHaveLength(1);
      expect(await chatsFor(fx.b.licenseId)).toHaveLength(0);
      expect(await identitiesFor(fx.b.licenseId)).toHaveLength(0);
      expect(await messagesFor(fx.b.licenseId)).toHaveLength(0);

      // B cannot reply into it by chat id; naming the sender's Telegram user id
      // sends through B's own bot to a stranger, logged under B and nowhere else.
      expect(
        (await sendOut(tg.type, { chat_id: msg.chat_id, text: 'intrusion' }, adminB)).statusCode,
      ).toBe(404);
      expect(
        (await sendOut(tg.type, { external_id: tg.sender, text: 'intrusion' }, adminB)).statusCode,
      ).toBe(200);
      const outboundB = (await messagesFor(fx.b.licenseId)).filter(
        (m) => m.direction === 'outbound',
      );
      expect(outboundB).toHaveLength(1);
      expect(outboundB[0]).toMatchObject({ chatId: null });
      expect(
        (await messagesFor(fx.a.licenseId)).filter((m) => m.direction === 'outbound'),
      ).toHaveLength(0);
    });
  });

  // --- Channel address ownership (08.5.7-d) ----------------------------------
  //
  // The property everything above rests on. An inbound webhook is
  // unauthenticated: the address it names is the *only* thing that decides which
  // workspace the message belongs to. So an address must belong to exactly one
  // connected channel — otherwise `channel_resolve_license` answers with two
  // licences and whoever Postgres lists first receives a stranger's customer
  // (NFR-S4/S5). Refusals first; the address is only free when its owner lets go.

  describe('channel address ownership', () => {
    const ig = INSTAGRAM;

    /** Whichever brand a tenant's channel is connected under (one per license
     *  here — the single-brand default every workspace starts with). */
    const brandOf = async (licenseId: bigint): Promise<string> =>
      (await owner.brand.findFirstOrThrow({ where: { licenseId }, select: { id: true } })).id;

    const connectedRows = (address: string) =>
      owner.channel
        .findMany({ where: { status: 'connected', type: ig.type } })
        .then((rows) =>
          rows.filter((row) => (row.config as { address?: string }).address === address),
        );

    // --- Refusal ------------------------------------------------------------

    it.each(CASES)('refuses $type at an address another workspace already holds', async (c) => {
      // Not Instagram-specific: an IG account id is merely the most guessable of
      // these. Every adapter channel resolves inbound the same way, so every one
      // is checked the same way.
      expect((await connect(c.type, c.connect(c.addressA), adminA)).statusCode).toBe(200);

      const res = await connect(c.type, c.connect(c.addressA), adminB);
      expect(res.statusCode).toBe(400);

      // B ends up with no connected channel at all — the write was refused, not
      // half-applied.
      const listB = (await server.get('/channels', auth(adminB))).json() as {
        items: ConnectedChannel[];
      };
      expect(listB.items.filter((item) => item.connected)).toHaveLength(0);
    });

    it('names no workspace when it refuses — the address is taken, not by whom', async () => {
      await connect(ig.type, ig.connect(ig.addressA), adminA);
      const res = await connect(ig.type, ig.connect(ig.addressA), adminB);

      const body = res.json() as { error: { type: string; message: string } };
      expect(body.error.type).toBe('validation');
      expect(body.error.message).toBe('That channel address is already connected.');

      // Nothing in the response identifies the holder. Otherwise a public IG id
      // becomes a lookup for "which workspace uses Nexa" (NFR-S5).
      const raw = res.body;
      expect(raw).not.toContain(String(fx.a.licenseId));
      expect(raw).not.toContain(fx.a.organizationId);
      expect(raw).not.toContain(await brandOf(fx.a.licenseId));
      expect(raw).not.toMatch(/workspace|licen[cs]e|tenant|brand|owner/i);
    });

    it('keeps delivering that address to its owner after a refused takeover', async () => {
      await connect(ig.type, ig.connect(ig.addressA), adminA);
      await connect(ig.type, ig.connect(ig.addressA), adminB); // refused

      // The DM still goes where it always did. A failed takeover must not shift
      // routing even for a moment.
      const dm = await webhook(ig.type, ig.inbound(ig.addressA, ig.sender, 'still A'));
      expect(dm.statusCode).toBe(200);

      expect(await chatsFor(fx.a.licenseId)).toHaveLength(1);
      expect(await chatsFor(fx.b.licenseId)).toHaveLength(0);
      expect(await identitiesFor(fx.b.licenseId)).toHaveLength(0);
      expect(await messagesFor(fx.b.licenseId)).toHaveLength(0);
    });

    it('refuses a second brand of the same workspace at that address too', async () => {
      await connect(ig.type, ig.connect(ig.addressA), adminA);
      const second = await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second' },
        select: { id: true },
      });

      // Same licence, so nothing cross-tenant here — but the resolver answers
      // with a licence and no brand, so two rows would be ambiguous inside one
      // workspace as well.
      const res = await server.post(`/channels/${ig.type}/connect`, ig.connect(ig.addressA), {
        ...auth(adminA),
        'x-nexa-brand': second.id,
      });
      expect(res.statusCode).toBe(400);
      expect(await connectedRows(ig.addressA)).toHaveLength(1);
    });

    // --- The database is the actual guarantee -------------------------------

    it('refuses a duplicate at the database, not only in the service', async () => {
      await connect(ig.type, ig.connect(ig.addressA), adminA);

      // Written as the owner: no RLS, no service, no pre-check — the way a
      // script, a fixture or a future code path could smuggle a second row in.
      // The partial unique index is what has to stop it.
      await expect(
        owner.channel.create({
          data: {
            licenseId: fx.b.licenseId,
            brandId: await brandOf(fx.b.licenseId),
            type: ig.type,
            status: 'connected',
            config: { address: ig.addressA, ig_user_id: ig.addressA },
          },
        }),
      ).rejects.toThrow(/unique constraint|channels_connected_address_key/i);
    });

    it('settles concurrent connects on one address with exactly one winner', async () => {
      // Check-then-write: both requests can pass the pre-check, so the index
      // decides. Which tenant wins is arbitrary; that exactly one does is not.
      const [first, second] = await Promise.all([
        connect(ig.type, ig.connect(ig.addressA), adminA),
        connect(ig.type, ig.connect(ig.addressA), adminB),
      ]);

      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 400]);
      expect(await connectedRows(ig.addressA)).toHaveLength(1);

      // And the inbound side agrees with whoever won: one chat, in one tenant.
      const dm = await webhook(ig.type, ig.inbound(ig.addressA, ig.sender, 'after the race'));
      expect(dm.statusCode).toBe(200);
      const chats = [...(await chatsFor(fx.a.licenseId)), ...(await chatsFor(fx.b.licenseId))];
      expect(chats).toHaveLength(1);
    });

    // --- What stays allowed -------------------------------------------------

    it('frees the address when its owner disconnects, and hands routing to the next holder', async () => {
      await connect(ig.type, ig.connect(ig.addressA), adminA);
      await server.post(`/channels/${ig.type}/disconnect`, undefined, auth(adminA));

      // Disconnect keeps A's row (its history) but drops its claim: the index is
      // partial on `status = 'connected'` precisely so an address is never
      // locked away by a channel nobody uses.
      expect((await connect(ig.type, ig.connect(ig.addressA), adminB)).statusCode).toBe(200);

      const dm = (await webhook(ig.type, ig.inbound(ig.addressA, ig.sender, 'now B'))).json() as {
        chat_id: string;
      };
      expect(dm.chat_id).toBeTruthy();
      expect(await chatsFor(fx.b.licenseId)).toHaveLength(1);
      expect(await chatsFor(fx.a.licenseId)).toHaveLength(0);

      // …and A cannot simply take it back while B holds it.
      expect((await connect(ig.type, ig.connect(ig.addressA), adminA)).statusCode).toBe(400);
    });

    it('still lets a workspace re-connect and re-address its own channel', async () => {
      // The upsert path: the owner is not a stranger to itself.
      expect((await connect(ig.type, ig.connect(ig.addressA), adminA)).statusCode).toBe(200);
      expect((await connect(ig.type, ig.connect(ig.addressA), adminA)).statusCode).toBe(200);

      const moved = await connect(ig.type, ig.connect(ig.addressB), adminA);
      expect(moved.statusCode).toBe(200);
      expect((moved.json() as ConnectedChannel).address).toBe(ig.addressB);
      // Moved, not duplicated — and the address it left is free again.
      expect(await connectedRows(ig.addressA)).toHaveLength(0);
      expect((await connect(ig.type, ig.connect(ig.addressA), adminB)).statusCode).toBe(200);
    });

    it('scopes the rule to one channel type, not to the address alone', async () => {
      // `+441632000001` on WhatsApp and the same string on SMS are two different
      // routes — `channel_resolve_license` keys on (type, address) — so holding
      // one says nothing about the other. Over-broad uniqueness would lock a
      // workspace's number out of a channel it legitimately owns.
      const shared = '+441632000001';
      expect(
        (await connect('whatsapp', { waba_id: 'waba_mock', phone_number: shared }, adminA))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await connect(
            'twilio',
            { account_sid: 'ACmock', auth_token: 'sekret', phone_number: shared },
            adminB,
          )
        ).statusCode,
      ).toBe(200);
    });
  });
});
