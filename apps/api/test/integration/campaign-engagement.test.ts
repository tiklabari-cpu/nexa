/**
 * Campaign engagement — the `engaged` flag actually turning true
 * (FR-MOD-03.3.2/.3, audit finding K2's last unclosed half).
 *
 * Delivery (tm 176.2) and the widget card (tm 176.3) closed how a campaign
 * message reaches a visitor. This closes the other half of the card's
 * numbers: before this, `campaign_sends.engaged` never turned true in
 * production, so every campaign's "Chats" count read zero forever, however
 * many visitors actually talked to the business afterwards.
 *
 * `campaign-delivery.test.ts` already proves delivery is suppressed while a
 * chat is open — which is exactly why a chat-open is the only place
 * engagement can complete (`campaign-engagement.ts`'s doc comment walks
 * through why). This suite proves the write itself: which send gets credited,
 * that a click-through is not required, and that another workspace's send
 * can never be reached from here.
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
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PRICING_PAGE = 'https://shop.example/pricing';

describe('campaign engagement', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** `customers:rw` in tenant A — the owner writing campaigns. */
  let writeToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);

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

    // Somewhere for the chat this suite opens to be routed.
    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    await owner.groupAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        groupId: support.id,
        agentId: fx.a.agentAccountId,
        priority: 'normal',
      },
    });
    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
      },
    });

    writeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:rw'],
    });
  });

  // --- Arrangement -------------------------------------------------------

  /** A visitor with a recent visit on a page — someone a campaign can target. */
  async function seedVisitor(t: TenantFixture, name: string, url = PRICING_PAGE): Promise<string> {
    const startedAt = minutesAgo(2);
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name },
      select: { id: true },
    });
    await owner.visit.create({
      data: {
        customerId: customer.id,
        licenseId: t.licenseId,
        pages: [{ url, at: startedAt.toISOString() }],
        startedAt,
      },
    });
    return customer.id;
  }

  /** The widget's token for a specific visitor, minted the way the loader does. */
  async function widgetToken(t: TenantFixture, customerId: string): Promise<string> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId, customer_id: customerId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return (response.json() as { token: string }).token;
  }

  async function poll(token: string): Promise<{ campaign: { id: string } | null }> {
    const response = await server.get('/customer/chat', auth(token));
    expect(response.statusCode).toBe(200);
    return response.json() as { campaign: { id: string } | null };
  }

  async function createCampaign(
    body: Record<string, unknown>,
    token = writeToken,
  ): Promise<{ id: string }> {
    const response = await server.post(
      '/campaigns',
      { conditions: { url_contains: '/pricing' }, ...body },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string };
  }

  /** Opens (or continues) the visitor's chat — what the widget's composer calls. */
  async function sendMessage(token: string, text = 'Hi, I have a question'): Promise<string> {
    const response = await server.post('/customer/chat/events', { text }, auth(token));
    expect([200, 201]).toContain(response.statusCode);
    return (response.json() as { chat_id: string }).chat_id;
  }

  const sendRow = (campaignId: string, customerId: string) =>
    owner.campaignSend.findFirst({
      where: { campaignId, customerId },
      select: { engaged: true, chatId: true, deliveredAt: true },
    });

  // --- The write itself ----------------------------------------------------

  it('credits the outstanding send when the visitor opens a chat', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    // Delivered but nobody has talked to us yet.
    await poll(token);
    expect(await sendRow(campaign.id, shopper)).toMatchObject({ engaged: false, chatId: null });

    const chatId = await sendMessage(token);

    expect(await sendRow(campaign.id, shopper)).toMatchObject({ engaged: true, chatId });
  });

  it('does not require the campaign card to still be showing', async () => {
    // The widget clears its local card the instant the panel opens, and a
    // dismissal never reaches the server — engagement is decided purely from
    // "was something still outstanding", not from a click the server never
    // sees (`campaign-engagement.ts` explains why).
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    await poll(token);
    // A few more polls pass with nothing changing — standing in for the
    // visitor dismissing the card and browsing on, unseen by the server.
    await poll(token);
    await poll(token);

    const chatId = await sendMessage(token);
    expect(await sendRow(campaign.id, shopper)).toMatchObject({ engaged: true, chatId });
  });

  it('reflects in the campaign card own Chats count', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });
    await poll(token);
    await sendMessage(token);

    const list = await server.get('/campaigns', auth(writeToken));
    expect(list.statusCode).toBe(200);
    const { items } = list.json() as {
      items: { id: string; performance: { displayed: number; chats: number } }[];
    };
    const row = items.find((c) => c.id === campaign.id);
    expect(row?.performance).toEqual({ displayed: 1, chats: 1, conversion: 0 });
  });

  // --- Which send, when more than one is outstanding -----------------------

  it('credits only the most recently delivered send — last touch, not every one owed', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const first = await createCampaign({ name: 'First', content: { message: 'first' } });
    const second = await createCampaign({ name: 'Second', content: { message: 'second' } });

    // Oldest first, one per poll — both end up delivered, neither engaged.
    expect((await poll(token)).campaign?.id).toBe(first.id);
    expect((await poll(token)).campaign?.id).toBe(second.id);

    const chatId = await sendMessage(token);

    expect(await sendRow(second.id, shopper)).toMatchObject({ engaged: true, chatId });
    // The earlier one stays exactly as delivery left it — not touched, not
    // double-credited for the same one conversation.
    expect(await sendRow(first.id, shopper)).toMatchObject({ engaged: false, chatId: null });
  });

  it('leaves a still-undelivered send untouched', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    // Never polled, so never delivered — the send exists but is not "shown".
    const campaign = await createCampaign({ name: 'Never seen', content: { message: 'hi' } });

    await sendMessage(token);

    expect(await sendRow(campaign.id, shopper)).toMatchObject({ engaged: false, chatId: null });
  });

  // --- Isolation -------------------------------------------------------------

  it("never credits another workspace's send", async () => {
    const mine = await seedVisitor(fx.a, 'Mine');
    await seedVisitor(fx.b, 'Theirs');
    const theirToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['customers:rw'],
    });
    const theirs = await createCampaign(
      { name: 'Theirs', content: { message: 'B speaking' } },
      theirToken,
    );

    // Planted directly against A's visitor, already delivered — the trigger
    // engine would never do this; it stands in for the id-collision the
    // isolation test in `campaign-delivery.test.ts` guards the read side of.
    await owner.campaignSend.create({
      data: {
        licenseId: fx.b.licenseId,
        campaignId: theirs.id,
        customerId: mine,
        deliveredAt: new Date(),
      },
    });

    const token = await widgetToken(fx.a, mine);
    await sendMessage(token);

    const planted = await owner.campaignSend.findFirst({
      where: { campaignId: theirs.id, customerId: mine },
      select: { engaged: true, chatId: true },
    });
    expect(planted).toMatchObject({ engaged: false, chatId: null });
  });
});
