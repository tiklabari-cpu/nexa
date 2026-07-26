/**
 * Omnichannel adapters (MOCK) — FR-MOD-08.5.4/.5/.6 (v1, Must).
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

/** One channel's provider-specific shapes, so the KK runs against all three. */
interface ChannelCase {
  type: 'messenger' | 'twilio' | 'whatsapp';
  addressA: string;
  addressB: string;
  sender: string;
  connect: (address: string) => Record<string, unknown>;
  inbound: (address: string, sender: string, text: string, name?: string) => Record<string, unknown>;
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
];

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
      const res = await server.post('/channels/telegram/connect', { x: 1 }, auth(adminA));
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

      const res = await webhook(c.type, c.inbound(c.addressA, c.sender, 'hello from the channel', 'Dana'));
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
      const inboundLog = (await messagesFor(fx.a.licenseId)).filter((m) => m.direction === 'inbound');
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

      const byChat = await sendOut(c.type, { chat_id: inbound.chat_id, text: 'thanks for reaching out' });
      expect(byChat.statusCode).toBe(200);
      const sent = byChat.json() as { provider_message_id: string; external_id: string; chat_id: string };
      expect(sent.external_id).toBe(c.sender);
      expect(sent.chat_id).toBe(inbound.chat_id);
      expect(sent.provider_message_id).toBeTruthy();

      const byExternal = await sendOut(c.type, { external_id: c.sender, text: 'direct reply' });
      expect(byExternal.statusCode).toBe(200);

      const outbound = (await messagesFor(fx.a.licenseId)).filter((m) => m.direction === 'outbound');
      expect(outbound).toHaveLength(2);
      expect(outbound[0]).toMatchObject({
        externalId: c.sender,
        chatId: inbound.chat_id,
        text: 'thanks for reaching out',
      });
      expect(outbound[0]!.providerMessageId).toBeTruthy();
      expect(outbound[1]).toMatchObject({ externalId: c.sender, chatId: null, text: 'direct reply' });
    });

    it('refuses outbound without the write scope, to a disconnected channel, and with bad addressing', async () => {
      // Not connected yet → cannot send.
      expect((await sendOut(c.type, { external_id: c.sender, text: 'x' })).statusCode).toBe(400);

      await connect(c.type, c.connect(c.addressA));
      // Read scope cannot send.
      expect((await sendOut(c.type, { external_id: c.sender, text: 'x' }, readA)).statusCode).toBe(403);
      // Exactly one of chat_id / external_id.
      expect(
        (await sendOut(c.type, { chat_id: 'X', external_id: c.sender, text: 'x' })).statusCode,
      ).toBe(400);
      expect((await sendOut(c.type, { text: 'x' })).statusCode).toBe(400);
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

    it('will not let one tenant reply into another tenant\'s chat', async () => {
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
      expect((await messagesFor(fx.b.licenseId)).filter((m) => m.direction === 'outbound')).toHaveLength(0);
    });
  });
});
