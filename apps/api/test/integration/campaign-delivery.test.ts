/**
 * Campaign delivery — the half of FR-MOD-03.3.2 that was missing (audit K2).
 *
 * Before this path existed, creating a campaign wrote a `campaign_sends` row and
 * stopped. Nothing carried the message to the person it was aimed at, so the
 * module's headline promise — a targeted message reaching a visitor on the site
 * — was never kept in production, and no test noticed because every test
 * asserted on the row.
 *
 * So this suite asserts on the visitor's side of the wire: what the widget's
 * poll actually receives. The properties worth the [MAX] rating are the delivery
 * guarantee (a message arrives, and arrives exactly once) and the isolation
 * (another workspace's campaign can never be what arrives).
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

interface PollState {
  campaign: { id: string; message: string } | null;
  chat: { id: string } | null;
  events: unknown[];
}

const PRICING_PAGE = 'https://shop.example/pricing';

describe('campaign delivery', () => {
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

    // Somewhere for a conversation to be routed, so the "already talking"
    // suppression is tested against a real chat rather than a stuck one.
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

  // --- Arrangement -----------------------------------------------------------

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

  /** One turn of the widget's 4-second poll. */
  async function poll(token: string): Promise<PollState> {
    const response = await server.get('/customer/chat', auth(token));
    expect(response.statusCode).toBe(200);
    return response.json() as PollState;
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

  const sendsFor = (campaignId: string) =>
    owner.campaignSend.findMany({
      where: { campaignId },
      select: { customerId: true, deliveredAt: true },
    });

  // --- The promise: the message actually reaches the visitor -----------------

  it('carries a matched visitor the campaign message on their next poll', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);

    // Nothing owed yet: the poll before the campaign exists is empty, so the
    // assertion below cannot pass on a field that is always populated.
    expect((await poll(token)).campaign).toBeNull();

    const campaign = await createCampaign({
      name: 'Pricing nudge',
      content: { message: 'Questions about pricing?' },
    });

    expect((await poll(token)).campaign).toEqual({
      id: campaign.id,
      message: 'Questions about pricing?',
    });
  });

  it('stamps the send delivered in the poll that carried it', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    // Written by the trigger engine, owed but not yet delivered.
    expect(await sendsFor(campaign.id)).toEqual([{ customerId: shopper, deliveredAt: null }]);

    const before = new Date();
    await poll(token);

    const [send] = await sendsFor(campaign.id);
    expect(send?.deliveredAt).toBeInstanceOf(Date);
    expect(send!.deliveredAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it('delivers exactly once — the next poll carries nothing and the stamp stands', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    expect((await poll(token)).campaign).not.toBeNull();
    const stampedAt = (await sendsFor(campaign.id))[0]?.deliveredAt;

    // The widget polls every 4 seconds. A card that came back each time would be
    // the failure this design exists to avoid.
    expect((await poll(token)).campaign).toBeNull();
    expect((await poll(token)).campaign).toBeNull();
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toEqual(stampedAt);
  });

  it('does not tell the visitor what the campaign is called', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    await createCampaign({ name: 'Q4 winback — discount hunters', content: { message: 'Hello' } });

    const { campaign } = await poll(token);
    expect(Object.keys(campaign ?? {}).sort()).toEqual(['id', 'message']);
    expect(JSON.stringify(campaign)).not.toContain('winback');
  });

  // --- One at a time, oldest first -------------------------------------------

  it('carries one campaign per poll, oldest first', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const first = await createCampaign({ name: 'First', content: { message: 'first message' } });
    const second = await createCampaign({ name: 'Second', content: { message: 'second message' } });

    // Both matched, so both are owed…
    expect(await sendsFor(first.id)).toHaveLength(1);
    expect(await sendsFor(second.id)).toHaveLength(1);

    // …but the visitor is nudged across polls, not shown a stack at once.
    expect((await poll(token)).campaign?.id).toBe(first.id);
    expect((await poll(token)).campaign?.id).toBe(second.id);
    expect((await poll(token)).campaign).toBeNull();
  });

  it("does not let one visitor's poll consume another's message", async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const browser = await seedVisitor(fx.a, 'Also On Pricing');
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });
    expect(await sendsFor(campaign.id)).toHaveLength(2);

    const shopperToken = await widgetToken(fx.a, shopper);
    await poll(shopperToken);
    await poll(shopperToken);

    const browserToken = await widgetToken(fx.a, browser);
    expect((await poll(browserToken)).campaign?.id).toBe(campaign.id);

    const delivered = await sendsFor(campaign.id);
    expect(delivered.every((send) => send.deliveredAt !== null)).toBe(true);
  });

  // --- Isolation -------------------------------------------------------------

  it("never delivers another workspace's campaign", async () => {
    // Both workspaces run a campaign on the same page — the realistic collision.
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

    // And B's campaign is pointed straight at A's visitor, which the trigger
    // engine would never do — written directly so the assertion tests the
    // delivery query's own tenant scoping rather than the matcher's.
    await owner.campaignSend.create({
      data: { licenseId: fx.b.licenseId, campaignId: theirs.id, customerId: mine },
    });

    const token = await widgetToken(fx.a, mine);
    expect((await poll(token)).campaign).toBeNull();

    // Still owed: A's poll did not deliver it, and did not quietly burn it either.
    const planted = await owner.campaignSend.findFirst({
      where: { campaignId: theirs.id, customerId: mine },
      select: { deliveredAt: true },
    });
    expect(planted?.deliveredAt).toBeNull();
  });

  // --- Still running *now* ---------------------------------------------------

  it('stops delivering once the campaign is switched off, and resumes when it is back on', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    const off = await server.patch(
      `/campaigns/${campaign.id}`,
      { active: false },
      auth(writeToken),
    );
    expect(off.statusCode).toBe(200);

    expect((await poll(token)).campaign).toBeNull();
    // Not burned — an owner who pauses a campaign has not cancelled the sends it
    // already earned.
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toBeNull();

    const on = await server.patch(`/campaigns/${campaign.id}`, { active: true }, auth(writeToken));
    expect(on.statusCode).toBe(200);
    expect((await poll(token)).campaign?.id).toBe(campaign.id);
  });

  it('does not deliver a campaign whose end date has passed', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    // The stored status still reads `ongoing` — it is only recomputed on write
    // (tm 176.6). Delivery re-reads the window instead of trusting it.
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { endsAt: minutesAgo(1) },
    });
    expect((await owner.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe(
      'ongoing',
    );

    expect((await poll(token)).campaign).toBeNull();
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toBeNull();
  });

  it('skips past an undeliverable send to one that is still running', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const stopped = await createCampaign({ name: 'Stopped', content: { message: 'stale' } });
    const running = await createCampaign({ name: 'Running', content: { message: 'live' } });

    // The older one is switched off, so it must not hold up the newer one.
    await server.patch(`/campaigns/${stopped.id}`, { active: false }, auth(writeToken));

    expect((await poll(token)).campaign?.id).toBe(running.id);
  });

  // --- Not while the visitor is already talking to somebody -------------------

  it('holds a campaign back while a conversation is open, and delivers it after', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    const sent = await server.post(
      '/customer/chat/events',
      { text: 'I have a question' },
      auth(token),
    );
    expect(sent.statusCode).toBe(201);

    const state = await poll(token);
    expect(state.chat).not.toBeNull();
    // A proactive card over a live transcript has nowhere to go; stamping it
    // would claim a delivery the widget was never going to make.
    expect(state.campaign).toBeNull();
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toBeNull();

    await owner.chat.update({ where: { id: state.chat!.id }, data: { active: false } });
    expect((await poll(token)).campaign?.id).toBe(campaign.id);
  });

  // --- Not when the workspace cannot honour the invitation --------------------

  it('does not invite a visitor into a conversation a read-only workspace would refuse', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    // ADR-10: an expired trial keeps everything readable and refuses new writes.
    await owner.license.update({ where: { id: fx.a.licenseId }, data: { status: 'read_only' } });

    // The card's button would 402, so the card is not shown.
    expect((await poll(token)).campaign).toBeNull();
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toBeNull();
    // And the reason it would: the write path really is closed.
    const refused = await server.post('/customer/chat/events', { text: 'hi' }, auth(token));
    expect(refused.statusCode).toBe(402);
  });

  it('does not nudge a visitor banned after their token was minted', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing');
    // Minted first: `POST /customer/token` already refuses a banned visitor, so
    // the only way to reach the poll while banned is with a token from before.
    const token = await widgetToken(fx.a, shopper);
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi there' } });

    await owner.customer.update({ where: { id: shopper }, data: { bannedAt: new Date() } });

    expect((await poll(token)).campaign).toBeNull();
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toBeNull();
  });
});
