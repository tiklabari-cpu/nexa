/**
 * The rich campaign card (EN-02 · tm 353), through the real routes: a card
 * campaign saved with a title, an image and three buttons and handed to the
 * widget beside its plain text; a `send_message` button pressed as the
 * player's own message with `properties.postback`; the other buttons counted
 * through `/clicked`; and a card in a conversation (`rich_message`) held to
 * the stricter rule — quick replies and trusted links, never a coupon.
 *
 * Old text campaigns are the regression the acceptance names: saved and
 * delivered exactly as before.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { mintForExistingCustomer } from '../helpers/member-token.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DEPOSIT = 'https://casino.example/deposit';
const ON_DEPOSIT = {
  match: 'all',
  rules: [{ field: 'current_url', op: 'contains', value: '/deposit' }],
};

const CARD = {
  title: 'Deposit trouble?',
  body: 'We can sort it out in a minute.',
  image: { url: 'https://cdn.example.com/coins.png', alt: 'A pile of coins' },
  buttons: [
    { label: 'Get help', style: 'primary', action: { type: 'send_message' } },
    { label: 'Read the rules', action: { type: 'open_url', url: 'https://casino.example/rules' } },
    { label: 'Copy the code', action: { type: 'copy_coupon', code: 'WELCOME50' } },
  ],
};
const FALLBACK = [
  'Deposit trouble?',
  'We can sort it out in a minute.',
  '1. Get help',
  '2. Read the rules: https://casino.example/rules',
  '3. Copy the code: WELCOME50',
].join('\n');

describe('rich campaign card (EN-02)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeToken: string;
  let writeTokenB: string;
  let chatToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);
    writeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:rw'],
    });
    writeTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['customers:rw'],
    });
    chatToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
  });

  async function visitor(t: TenantFixture = fx.a): Promise<{ id: string; token: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: 'Player' },
      select: { id: true },
    });
    const response = await mintForExistingCustomer(server, t, customer.id);
    expect(response.statusCode).toBe(200);
    return { id: customer.id, token: (response.json() as { token: string }).token };
  }

  async function createCampaign(content: Record<string, unknown>, token = writeToken) {
    return server.post(
      '/campaigns',
      { name: 'Deposit help', conditions: ON_DEPOSIT, content },
      auth(token),
    );
  }

  async function cardCampaign(token = writeToken): Promise<string> {
    const response = await createCampaign({ type: 'card', card: CARD }, token);
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
  }

  /** A visitor on /deposit, offered the campaign on their poll. */
  async function offeredVisitor(t: TenantFixture = fx.a) {
    const player = await visitor(t);
    expect(
      (await server.post('/customer/visit', { url: DEPOSIT }, auth(player.token))).statusCode,
    ).toBe(204);
    const polled = await server.get('/customer/chat', auth(player.token));
    return { ...player, campaign: polled.json().campaign as Record<string, unknown> | null };
  }

  const sendOf = (campaignId: string, customerId: string) =>
    owner.campaignSend.findFirstOrThrow({
      where: { campaignId, customerId },
      select: { deliveredAt: true, clickedAt: true, engaged: true },
    });

  // --- Saving ---------------------------------------------------------------

  it("saves a title, an image and three buttons, with the card's plain text written for it (FR-MOD-03.3.2)", async () => {
    const response = await createCampaign({ type: 'card', card: CARD });
    expect(response.statusCode).toBe(201);
    const saved = response.json() as { content: Record<string, unknown> };
    expect(saved.content).toEqual({
      type: 'card',
      card: {
        ...CARD,
        buttons: CARD.buttons.map((button) => ({ style: 'default', ...button })),
      },
      fallback_text: FALLBACK,
    });

    // An author's own plain text wins over the written one.
    const own = await createCampaign({ type: 'card', card: CARD, fallback_text: 'Need help?' });
    expect((own.json() as { content: { fallback_text: string } }).content.fallback_text).toBe(
      'Need help?',
    );
  });

  it('refuses a javascript: link, an http: link, a long label and a missing alt — naming each, never cutting (FR-MOD-03.3.2)', async () => {
    const withButton = (index: number, button: unknown) => ({
      ...CARD,
      buttons: CARD.buttons.map((b, i) => (i === index ? button : b)),
    });
    const script = await createCampaign({
      type: 'card',
      card: withButton(1, {
        label: 'Rules',
        action: { type: 'open_url', url: 'javascript:alert(1)' },
      }),
    });
    expect(script.statusCode).toBe(400);
    expect(script.json().error.message).toBe(
      'content.card.buttons[1].action.url: must be an https: address.',
    );

    const plain = await createCampaign({
      type: 'card',
      card: withButton(1, {
        label: 'Rules',
        action: { type: 'open_url', url: 'http://casino.example' },
      }),
    });
    expect(plain.statusCode).toBe(400);

    const long = await createCampaign({
      type: 'card',
      card: withButton(0, { label: 'x'.repeat(21), action: { type: 'send_message' } }),
    });
    expect(long.statusCode).toBe(400);
    expect(long.json().error.message).toMatch(/buttons\[0\]\.label: is longer than 20/);

    const noAlt = await createCampaign({
      type: 'card',
      card: { ...CARD, image: { url: 'https://cdn.example.com/a.png', alt: '' } },
    });
    expect(noAlt.statusCode).toBe(400);
    expect(noAlt.json().error.details.fields).toEqual([
      expect.objectContaining({ field: 'content.card.image.alt' }),
    ]);

    // An image that claims to be an upload must be one of this workspace's.
    const foreign = await createCampaign({
      type: 'card',
      card: { ...CARD, image: { url: `/api/v1/uploads/${fx.a.licenseId}-missing.png`, alt: 'x' } },
    });
    expect(foreign.statusCode).toBe(400);
    expect(await owner.campaign.count()).toBe(0);
  });

  it('switching to a card drops the message, and back drops the card', async () => {
    const created = await createCampaign({ message: 'Need a hand?' });
    const id = (created.json() as { id: string }).id;
    const toCard = await server.patch(
      `/campaigns/${id}`,
      { content: { type: 'card', card: CARD } },
      auth(writeToken),
    );
    expect(toCard.statusCode).toBe(200);
    expect(toCard.json().content).not.toHaveProperty('message');
    const back = await server.patch(
      `/campaigns/${id}`,
      { content: { message: 'Hi' } },
      auth(writeToken),
    );
    expect(back.json().content).toEqual({ message: 'Hi' });
    const mixed = await server.patch(
      `/campaigns/${id}`,
      { content: { type: 'card', card: CARD, message: 'stale' } },
      auth(writeToken),
    );
    expect(mixed.statusCode).toBe(400);
  });

  // --- Delivering -------------------------------------------------------------

  it('hands the widget the card beside its plain text; a text campaign is delivered as before (FR-MOD-03.3.2)', async () => {
    const id = await cardCampaign();
    const player = await offeredVisitor();
    expect(player.campaign).toEqual({
      id,
      message: FALLBACK,
      card: expect.objectContaining({ title: 'Deposit trouble?', buttons: expect.any(Array) }),
    });

    // The regression: an old-shape text campaign saves and arrives unchanged.
    await owner.campaign.deleteMany({});
    const text = await createCampaign({ message: 'Need a hand?' });
    expect(text.json().content).toEqual({ message: 'Need a hand?' });
    const other = await offeredVisitor();
    expect(other.campaign).toEqual({ id: text.json().id, message: 'Need a hand?' });
  });

  // --- Pressing ---------------------------------------------------------------

  it('"Get help" starts the conversation with the label as the player message and counts the click (FR-MOD-03.3.2)', async () => {
    const id = await cardCampaign();
    const player = await offeredVisitor();

    const pressed = await server.post(
      '/customer/chat/events',
      { postback: { campaign_id: id, button: 0 }, url: DEPOSIT },
      auth(player.token),
    );
    expect(pressed.statusCode).toBe(201);
    const event = await owner.event.findFirstOrThrow({
      where: { chatId: pressed.json().chat_id, authorType: 'customer' },
      select: { text: true, type: true, properties: true },
    });
    expect(event.text).toBe('Get help');
    expect(event.type).toBe('message');
    expect(event.properties).toMatchObject({
      postback: {
        source: 'campaign',
        campaign_id: id,
        button: 0,
        label: 'Get help',
        card: { title: 'Deposit trouble?' },
      },
    });
    const send = await sendOf(id, player.id);
    expect(send.clickedAt).toBeInstanceOf(Date);
    expect(send.engaged).toBe(true);
  });

  it('refuses a press that is not a message button, not a card this visitor was sent, or says other words', async () => {
    const id = await cardCampaign();
    const player = await offeredVisitor();
    const press = (body: Record<string, unknown>, token = player.token) =>
      server.post('/customer/chat/events', body, auth(token));

    expect((await press({ postback: { campaign_id: id, button: 1 } })).statusCode).toBe(400);
    expect((await press({ postback: { campaign_id: id, button: 4 } })).statusCode).toBe(400);
    expect(
      (await press({ text: 'Something else', postback: { campaign_id: id, button: 0 } }))
        .statusCode,
    ).toBe(400);
    expect(
      (await press({ postback: { campaign_id: id, event_id: 'x_1', button: 0 } })).statusCode,
    ).toBe(400);

    // A visitor the campaign never reached cannot press it.
    const stranger = await visitor();
    expect(
      (await press({ postback: { campaign_id: id, button: 0 } }, stranger.token)).statusCode,
    ).toBe(400);
    // Nor can another workspace's.
    const idB = await cardCampaign(writeTokenB);
    expect((await press({ postback: { campaign_id: idB, button: 0 } })).statusCode).toBe(400);
    expect(await owner.event.count({ where: { authorType: 'customer' } })).toBe(0);
  });

  it('counts a link or coupon press once through /clicked; 404 for no such card or button', async () => {
    const id = await cardCampaign();
    const player = await offeredVisitor();
    const click = (button: number, campaignId = id) =>
      server.post(`/customer/campaigns/${campaignId}/clicked`, { button }, auth(player.token));

    expect((await click(2)).statusCode).toBe(204);
    const first = (await sendOf(id, player.id)).clickedAt;
    expect(first).toBeInstanceOf(Date);
    expect((await click(1)).statusCode).toBe(204);
    expect((await sendOf(id, player.id)).clickedAt).toEqual(first);

    expect((await click(3)).statusCode).toBe(404);
    const text = await createCampaign({ message: 'Plain' });
    expect((await click(0, text.json().id)).statusCode).toBe(404);
    expect((await click(0, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });

  // --- A card in a conversation -----------------------------------------------

  describe('rich_message (EN-02 karar 1)', () => {
    async function openChat() {
      const player = await visitor();
      const started = await server.post(
        '/customer/chat/events',
        { text: 'Hi' },
        auth(player.token),
      );
      expect(started.statusCode).toBe(201);
      return { ...player, chatId: started.json().chat_id as string };
    }
    const send = (chatId: string, card: unknown, extra: Record<string, unknown> = {}) =>
      server.post(
        `/chats/${chatId}/events`,
        { type: 'rich_message', properties: { card, ...extra } },
        auth(chatToken),
      );

    it('takes quick replies and a link to a trusted domain, with the plain text as the event text', async () => {
      const { chatId, token } = await openChat();
      const card = {
        body: 'Which method did you use?',
        buttons: [
          { label: 'Papara', action: { type: 'send_message' } },
          {
            label: 'Status page',
            action: { type: 'open_url', url: `https://${fx.a.trustedDomain}/status` },
          },
        ],
      };
      const sent = await send(chatId, card, { postback: { source: 'campaign' } });
      expect(sent.statusCode).toBe(201);
      const event = sent.json().event ?? sent.json();
      expect(event.text).toBe(
        `Which method did you use?\n1. Papara\n2. Status page: https://${fx.a.trustedDomain}/status`,
      );
      // A sender cannot claim a press.
      expect(event.properties).not.toHaveProperty('postback');
      expect(event.properties.card.buttons).toHaveLength(2);

      // The player's press of "Papara" is their message, pointing at the card.
      const pressed = await server.post(
        '/customer/chat/events',
        { postback: { event_id: event.id, button: 0 } },
        auth(token),
      );
      expect(pressed.statusCode).toBe(201);
      expect(pressed.json().event).toMatchObject({
        text: 'Papara',
        properties: {
          postback: { source: 'event', event_id: event.id, button: 0, label: 'Papara' },
        },
      });
      // Not the link button, and not another chat's card.
      expect(
        (
          await server.post(
            '/customer/chat/events',
            { postback: { event_id: event.id, button: 1 } },
            auth(token),
          )
        ).statusCode,
      ).toBe(400);
      const other = await openChat();
      expect(
        (
          await server.post(
            '/customer/chat/events',
            { postback: { event_id: event.id, button: 0 } },
            auth(other.token),
          )
        ).statusCode,
      ).toBe(400);
    });

    it('refuses a coupon and a link outside the trusted domains, whoever sends it', async () => {
      const { chatId } = await openChat();
      const coupon = await send(chatId, {
        body: 'A present',
        buttons: [{ label: 'Copy', action: { type: 'copy_coupon', code: 'FREE' } }],
      });
      expect(coupon.statusCode).toBe(400);
      expect(coupon.json().error.message).toBe(
        'properties.card.buttons[0].action: may only be send_message or open_url in a conversation.',
      );
      const elsewhere = await send(chatId, {
        body: 'Go',
        buttons: [{ label: 'Go', action: { type: 'open_url', url: 'https://bonus.example/' } }],
      });
      expect(elsewhere.statusCode).toBe(400);
      const noCard = await send(chatId, undefined);
      expect(noCard.statusCode).toBe(400);
      expect(await owner.event.count({ where: { type: 'rich_message' } })).toBe(0);
    });
  });
});
