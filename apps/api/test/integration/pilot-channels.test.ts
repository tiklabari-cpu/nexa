/**
 * The public pilot runs no channel but Website and the Chat page (tm 257.3 ·
 * ADR docs/adr/pilot-public-readiness.md K-d).
 *
 * With `PILOT_MODE=true` the five adapter channels (Messenger, Twilio SMS,
 * WhatsApp, Instagram, Telegram) and e-mail are refused at the pilot gate: the
 * connect step, the outbound send, the forwarding-address writes — and the two
 * *public* inbound doors, the unsigned provider webhook and the e-mail
 * inbound, which the pilot's Caddyfile publishes to the whole internet along
 * with the rest of `/api/*`. Hiding the cards is a courtesy; this file is what
 * makes "no such channel here" true for a caller holding `curl`.
 *
 * What stays open is what lets a row connected *before* the flag was set be
 * seen and closed: the reads and the disconnect.
 *
 * Every refusal is paired with its twin on an ordinary deployment, where the
 * same request reaches the handler and does what it always did. The flag-off
 * behaviour itself is pinned by `channels-adapters`, `channel-email-inbound`,
 * `inbound-email-addresses` and `channel-messages`, which are untouched.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const SECRET = 'a-shared-inbound-secret';
const PILOT = {
  PILOT_MODE: 'true',
  PILOT_CONTACT_EMAIL: 'pilot-contact@example.test',
  INBOUND_EMAIL_SECRET: SECRET,
};
const ORDINARY = { PILOT_MODE: 'false', INBOUND_EMAIL_SECRET: SECRET };

/** The five adapter channels, by route type, with a body the adapter accepts. */
const ADAPTERS = [
  {
    type: 'messenger',
    address: '100000000000001',
    connect: { code: 'AQD_mock_oauth_code', page_id: '100000000000001', page_name: 'Acme' },
    inbound: {
      recipient: { id: '100000000000001' },
      sender: { id: 'psid_sender_alpha' },
      message: { text: 'hello' },
    },
  },
  {
    type: 'twilio',
    address: '+14150000001',
    connect: { account_sid: 'ACmock', auth_token: 'sekret', phone_number: '+14150000001' },
    inbound: { To: '+14150000001', From: '+14155551234', Body: 'hello' },
  },
  {
    type: 'whatsapp',
    address: '+441632000001',
    connect: { waba_id: 'waba_mock', phone_number: '+441632000001' },
    inbound: { to: '+441632000001', from: '+441632991234', text: { body: 'hello' } },
  },
  {
    type: 'instagram',
    address: '17841400000000001',
    connect: { code: 'IGQ_mock_oauth_code', ig_user_id: '17841400000000001', username: 'acme' },
    inbound: {
      recipient: { id: '17841400000000001' },
      sender: { id: 'igsid_sender_alpha' },
      message: { text: 'hello' },
    },
  },
  {
    type: 'telegram',
    address: 'acme_support_bot',
    connect: {
      bot_token: '123456789:AAmockBotTokenString-Value',
      bot_username: 'acme_support_bot',
    },
    inbound: {
      recipient: { id: 'acme_support_bot' },
      sender: { id: '884219991' },
      message: { text: 'hello' },
    },
  },
] as const;

function expectPilotRefusal(response: LightMyRequestResponse): void {
  expect(response.statusCode).toBe(403);
  const { error } = response.json();
  expect(error.type).toBe('not_allowed');
  expect(error.details).toStrictEqual({ reason: 'pilot_mode' });
}

describe('pilot mode: adapter channels and e-mail (tm 257.3)', () => {
  let owner: PrismaClient;
  let pilot: TestServer;
  let ordinary: TestServer;
  let fx: Fixtures;
  let admin: string;
  let brandId: string;
  /** A forwarding address the workspace already had, to delete and test. */
  let addressId: string;
  let addressLocalPart: string;

  const auth = (): Record<string, string> => ({ authorization: `Bearer ${admin}` });

  /** Everything an inbound or outbound channel call could have written. */
  async function channelState(licenseId: bigint) {
    const [channels, messages, identities, chats, tickets, customers, addresses, audit] =
      await Promise.all([
        owner.channel.findMany({ where: { licenseId }, orderBy: { type: 'asc' } }),
        owner.channelMessage.count({ where: { licenseId } }),
        owner.channelIdentity.count({ where: { licenseId } }),
        owner.chat.count({ where: { licenseId } }),
        owner.ticket.count({ where: { licenseId } }),
        owner.customer.count({ where: { organizationId: fx.a.organizationId } }),
        owner.inboundEmailAddress.findMany({ where: { licenseId }, orderBy: { localPart: 'asc' } }),
        owner.auditLogEntry.count({ where: { licenseId } }),
      ]);
    return { channels, messages, identities, chats, tickets, customers, addresses, audit };
  }

  beforeAll(async () => {
    owner = ownerClient();
    [pilot, ordinary] = await Promise.all([startTestServer(PILOT), startTestServer(ORDINARY)]);
  });

  afterAll(async () => {
    await Promise.all([pilot.close(), ordinary.close()]);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await Promise.all([clearRateLimits(pilot.app), clearRateLimits(ordinary.app)]);
    brandId = await seedDefaultBrand(owner, fx.a.licenseId);
    admin = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:rw'],
    });

    // A channel connected before the flag was set — the row the pilot must still
    // let an admin see and close — and its webhook address, both live.
    await owner.channel.create({
      data: {
        licenseId: fx.a.licenseId,
        brandId,
        type: 'messenger',
        status: 'connected',
        config: { address: ADAPTERS[0].address },
      },
    });
    addressLocalPart = `${fx.a.organizationId}+support`;
    const address = await owner.inboundEmailAddress.create({
      data: { licenseId: fx.a.licenseId, label: 'support', localPart: addressLocalPart },
    });
    addressId = address.id;
  });

  describe('the writes behind the fake channels', () => {
    it.each(ADAPTERS)(
      'refuses to connect $type — with an empty body or a valid one — and writes nothing',
      async ({ type, connect }) => {
        const before = await channelState(fx.a.licenseId);
        expectPilotRefusal(await pilot.post(`/channels/${type}/connect`, {}, auth()));
        expectPilotRefusal(await pilot.post(`/channels/${type}/connect`, connect, auth()));
        expect(await channelState(fx.a.licenseId)).toStrictEqual(before);
      },
    );

    it('refuses an outbound message on a connected channel, and logs none', async () => {
      const before = await channelState(fx.a.licenseId);
      expectPilotRefusal(
        await pilot.post(
          '/channels/messenger/messages',
          { text: 'hi', external_id: 'psid_sender_alpha' },
          auth(),
        ),
      );
      expect(await channelState(fx.a.licenseId)).toStrictEqual(before);
    });

    it('refuses forwarding-address create, delete and test, and no ticket is opened', async () => {
      const before = await channelState(fx.a.licenseId);
      expectPilotRefusal(await pilot.post('/channels/email/addresses', {}, auth()));
      expectPilotRefusal(await pilot.post('/channels/email/addresses', { label: 'sales' }, auth()));
      expectPilotRefusal(await pilot.del(`/channels/email/addresses/${addressId}`, auth()));
      expectPilotRefusal(
        await pilot.post(`/channels/email/addresses/${addressId}/test`, undefined, auth()),
      );
      expect(await channelState(fx.a.licenseId)).toStrictEqual(before);
    });

    it('answers before the body is read: a malformed body gets the 403, not a 400', async () => {
      const response = await pilot.app.inject({
        method: 'POST',
        url: pilot.url('/channels/messenger/connect'),
        headers: { ...auth(), 'content-type': 'application/json' },
        payload: '{not json',
      });
      expectPilotRefusal(response);
    });
  });

  describe('the public inbound doors', () => {
    it.each(ADAPTERS)(
      'refuses an anonymous $type webhook that would have reached a live channel',
      async ({ type, inbound }) => {
        const before = await channelState(fx.a.licenseId);
        expectPilotRefusal(await pilot.post(`/channels/${type}/webhook`, inbound));
        expectPilotRefusal(await pilot.post(`/channels/${type}/webhook`, {}));
        expect(await channelState(fx.a.licenseId)).toStrictEqual(before);
      },
    );

    it('refuses an inbound e-mail with the right secret, and opens no ticket', async () => {
      const before = await channelState(fx.a.licenseId);
      const mail = {
        to: `${fx.a.organizationId}@inbound.siyahtus.localhost`,
        from: 'Jane Buyer <jane@shopper.example>',
        subject: 'Where is my order?',
      };
      expectPilotRefusal(
        await pilot.post('/channels/email/inbound', mail, { 'x-inbound-secret': SECRET }),
      );
      // A labelled address that exists, and a body that is not even valid.
      expectPilotRefusal(
        await pilot.post(
          '/channels/email/inbound',
          { ...mail, to: `${addressLocalPart}@inbound.siyahtus.localhost` },
          { 'x-inbound-secret': SECRET },
        ),
      );
      expectPilotRefusal(
        await pilot.post('/channels/email/inbound', {}, { 'x-inbound-secret': SECRET }),
      );
      expect(await channelState(fx.a.licenseId)).toStrictEqual(before);
    });

    it('refuses an inbound e-mail with the wrong or no secret as the pilot, not as a 401', async () => {
      expectPilotRefusal(await pilot.post('/channels/email/inbound', {}));
      expectPilotRefusal(
        await pilot.post('/channels/email/inbound', {}, { 'x-inbound-secret': 'wrong' }),
      );
    });
  });

  describe('what stays open', () => {
    it('lists the channels and the forwarding addresses', async () => {
      const channels = await pilot.get('/channels', auth());
      expect(channels.statusCode).toBe(200);
      expect(channels.json().items).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'messenger', connected: true })]),
      );
      const addresses = await pilot.get('/channels/email/addresses', auth());
      expect(addresses.statusCode).toBe(200);
      const log = await pilot.get('/channels/messenger/messages', auth());
      expect(log.statusCode).toBe(200);
    });

    it('still closes a channel that was connected before the flag was set', async () => {
      const off = await pilot.post('/channels/messenger/disconnect', undefined, auth());
      expect(off.statusCode).toBe(204);
      const row = await owner.channel.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, type: 'messenger' },
      });
      expect(row.status).toBe('off');
    });
  });

  describe('the same requests on an ordinary deployment', () => {
    it.each(ADAPTERS)(
      'connects $type and accepts its webhook',
      async ({ type, connect, inbound }) => {
        // `messenger` is already connected by the fixture; re-connecting is idempotent.
        const connected = await ordinary.post(`/channels/${type}/connect`, connect, auth());
        expect(connected.statusCode).toBe(200);
        const delivered = await ordinary.post(`/channels/${type}/webhook`, inbound);
        expect(delivered.statusCode).toBe(200);
        expect(delivered.json().status).toBe('accepted');
      },
    );

    it('sends an outbound message and defines, tests and deletes a forwarding address', async () => {
      const sent = await ordinary.post(
        '/channels/messenger/messages',
        { text: 'hi', external_id: 'psid_sender_alpha' },
        auth(),
      );
      expect(sent.statusCode).toBe(200);

      const created = await ordinary.post('/channels/email/addresses', { label: 'sales' }, auth());
      expect(created.statusCode).toBe(201);
      const tested = await ordinary.post(
        `/channels/email/addresses/${addressId}/test`,
        undefined,
        auth(),
      );
      expect(tested.statusCode).toBe(200);
      const removed = await ordinary.del(`/channels/email/addresses/${addressId}`, auth());
      expect(removed.statusCode).toBe(204);
    });

    it('turns an inbound e-mail with the secret into a ticket', async () => {
      const response = await ordinary.post(
        '/channels/email/inbound',
        {
          to: `${fx.a.organizationId}@inbound.siyahtus.localhost`,
          from: 'Jane Buyer <jane@shopper.example>',
          subject: 'Where is my order?',
        },
        { 'x-inbound-secret': SECRET },
      );
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('created');
    });
  });
});
