/**
 * Campaign triggering on the visit write path (FR-MOD-03.3.2, tm 176.5).
 *
 * Until this path existed a campaign was evaluated exactly once — when the
 * owner saved it — against whoever happened to be on the site in the preceding
 * thirty minutes. Everybody who arrived afterwards matched nothing, forever,
 * which for a campaign left running is the *ordinary* case rather than an edge
 * one. `campaigns.test.ts` pins the create-time half (one campaign, many
 * visitors); this suite pins the dual (one visitor, many campaigns) through the
 * real widget route, because the whole point is that it fires without anybody
 * touching the campaign.
 *
 * The properties worth the [MAX] rating are the ones that decide who gets an
 * unsolicited message: a new arrival matching a running campaign, nobody
 * matching a stopped one, another workspace's visitors never, and — the hot
 * path's own requirement — a visitor who keeps browsing being nudged once
 * rather than once per page.
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
const BLOG_PAGE = 'https://shop.example/blog';

describe('campaign triggering on arrival', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** `customers:rw` in tenant A — the owner writing campaigns. */
  let writeToken: string;
  /** The same scope in tenant B, for the isolation half. */
  let writeTokenB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const hoursFromNow = (n: number): Date => new Date(Date.now() + n * 3_600_000);

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
  });

  // --- Arrangement ---------------------------------------------------------

  /**
   * Somebody who has never been seen before — no visit, so the campaign that
   * already exists cannot have matched them at save time. This is the person
   * the whole suite is about.
   */
  async function freshVisitor(t: TenantFixture, name: string): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name },
      select: { id: true },
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

  /**
   * The visitor writes in from a page — the only moment the widget tells the
   * server where they are (`apps/widget/src/widget.ts` sends `url` with the
   * message), and therefore the only moment a visit is written.
   */
  async function writeInFrom(
    token: string,
    url: string | undefined,
    text = 'Hi, I have a question',
  ): Promise<string> {
    const response = await server.post(
      '/customer/chat/events',
      { text, ...(url ? { url } : {}) },
      auth(token),
    );
    expect([200, 201]).toContain(response.statusCode);
    return (response.json() as { chat_id: string }).chat_id;
  }

  async function poll(
    token: string,
  ): Promise<{ campaign: { id: string; message: string } | null }> {
    const response = await server.get('/customer/chat', auth(token));
    expect(response.statusCode).toBe(200);
    return response.json() as { campaign: { id: string; message: string } | null };
  }

  const sendsFor = (campaignId: string) =>
    owner.campaignSend.findMany({
      where: { campaignId },
      select: { customerId: true, deliveredAt: true, engaged: true },
    });

  const sendCount = (customerId: string) => owner.campaignSend.count({ where: { customerId } });

  // --- The gap this closes -------------------------------------------------

  it('fires a running campaign at a visitor who arrives after it was saved', async () => {
    // Saved with nobody on the site: the create-time engine matches zero, which
    // is exactly the state that used to be permanent.
    const campaign = await createCampaign({
      name: 'Pricing nudge',
      content: { message: 'Questions about pricing?' },
    });
    expect(await sendsFor(campaign.id)).toEqual([]);

    const shopper = await freshVisitor(fx.a, 'Late arrival');
    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    expect(await sendsFor(campaign.id)).toEqual([
      { customerId: shopper, deliveredAt: null, engaged: false },
    ]);
  });

  it('leaves a visitor whose page the trigger does not match alone', async () => {
    const campaign = await createCampaign({ name: 'Pricing nudge', content: { message: 'Hi' } });

    const reader = await freshVisitor(fx.a, 'On the blog');
    await writeInFrom(await widgetToken(fx.a, reader), BLOG_PAGE);

    expect(await sendsFor(campaign.id)).toEqual([]);
  });

  it('fires every running campaign the visitor matches, not just the first', async () => {
    const first = await createCampaign({ name: 'One', content: { message: 'First' } });
    const second = await createCampaign({ name: 'Two', content: { message: 'Second' } });
    const elsewhere = await createCampaign({
      name: 'Blog only',
      conditions: { url_contains: '/blog' },
      content: { message: 'Not this one' },
    });

    const shopper = await freshVisitor(fx.a, 'Late arrival');
    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    expect(await sendsFor(first.id)).toHaveLength(1);
    expect(await sendsFor(second.id)).toHaveLength(1);
    expect(await sendsFor(elsewhere.id)).toEqual([]);
  });

  it('matches on any page of the visit, not only the one just reported', async () => {
    // Same reading as the create-time engine: the visit is the unit, so someone
    // who passed /pricing and then wrote in from /blog is still who the
    // campaign was aimed at.
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi' } });
    const shopper = await freshVisitor(fx.a, 'Wandering');
    const token = await widgetToken(fx.a, shopper);

    await writeInFrom(token, PRICING_PAGE);
    await owner.campaignSend.deleteMany({ where: { customerId: shopper } });
    await writeInFrom(token, BLOG_PAGE, 'One more thing');

    expect(await sendsFor(campaign.id)).toHaveLength(1);
  });

  // --- Idempotency: the hot path's own requirement --------------------------

  it('nudges a visitor once however many pages they report', async () => {
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi' } });
    const shopper = await freshVisitor(fx.a, 'Chatty');
    const token = await widgetToken(fx.a, shopper);

    // Five evaluations: a first arrival, a reload of the same page (no visit
    // write at all), two more messages, and a different matching page.
    await writeInFrom(token, PRICING_PAGE);
    await writeInFrom(token, PRICING_PAGE, 'Still there?');
    await writeInFrom(token, BLOG_PAGE, 'Reading your blog');
    await writeInFrom(token, `${PRICING_PAGE}/enterprise`, 'And the enterprise plan?');
    await writeInFrom(token, `${PRICING_PAGE}/enterprise`, 'Anyone?');

    expect(await sendsFor(campaign.id)).toHaveLength(1);
    expect(await sendCount(shopper)).toBe(1);

    // The repeat has to be a *no-op*, not a swallowed failure. The route treats
    // this whole block as best-effort, so a re-fire that raised instead of
    // conflicting would be logged and forgotten — and would look identical
    // above, while quietly rolling the page view back with it. The browsing
    // record is what proves the difference: every distinct page the visitor
    // reported is still on the visit.
    const visit = await owner.visit.findFirst({
      where: { customerId: shopper },
      select: { pages: true },
    });
    expect((visit?.pages as { url: string }[] | undefined)?.map((page) => page.url)).toEqual([
      PRICING_PAGE,
      BLOG_PAGE,
      `${PRICING_PAGE}/enterprise`,
    ]);
  });

  it('re-evaluates a page it has already seen, because the campaigns move too', async () => {
    // A second message from the same page writes no visit at all — a reload is
    // not a new page. Evaluating only on a *changed* page set would therefore
    // strand a visitor standing still while the campaigns around them change,
    // which is why `recordPageView` hands back the unchanged list rather than
    // an empty one. Proven with a schedule rather than a fresh campaign,
    // because creating one would fire at them through the create-time engine
    // and prove nothing about this path.
    const campaign = await createCampaign({
      name: 'Launch day',
      content: { message: 'We are live' },
      starts_at: hoursFromNow(1).toISOString(),
    });
    const shopper = await freshVisitor(fx.a, 'Waiting on the page');
    const token = await widgetToken(fx.a, shopper);

    await writeInFrom(token, PRICING_PAGE);
    expect(await sendsFor(campaign.id)).toEqual([]);

    // The start time arrives. Nothing writes to the campaign, so its stored
    // status still says `scheduled` and no other path in the product notices.
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { startsAt: hoursFromNow(-1) },
    });

    await writeInFrom(token, PRICING_PAGE, 'Still here');

    expect(await sendsFor(campaign.id)).toHaveLength(1);
    // …and the visit really was untouched: one page, written once.
    const visit = await owner.visit.findFirst({
      where: { customerId: shopper },
      select: { pages: true },
    });
    expect(visit?.pages).toHaveLength(1);
  });

  it('does not fire at a visitor who reports no page', async () => {
    // A hand-rolled client, or the hosted Chat page before it knows where it
    // is: no url means no visit, and no visit means nothing to match against.
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi' } });
    const quiet = await freshVisitor(fx.a, 'No url');

    await writeInFrom(await widgetToken(fx.a, quiet), undefined);

    expect(await sendsFor(campaign.id)).toEqual([]);
    expect(await owner.visit.count({ where: { customerId: quiet } })).toBe(0);
  });

  // --- Running *now*, not according to a status somebody last wrote ---------

  it('does not fire a campaign the owner switched off', async () => {
    const campaign = await createCampaign({
      name: 'Paused',
      content: { message: 'Hi' },
      active: false,
    });

    const shopper = await freshVisitor(fx.a, 'Late arrival');
    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    expect(await sendsFor(campaign.id)).toEqual([]);
  });

  it('does not fire a campaign whose window closed while nobody was looking', async () => {
    const campaign = await createCampaign({
      name: 'Black Friday',
      content: { message: 'Hi' },
      starts_at: hoursFromNow(-48).toISOString(),
      ends_at: hoursFromNow(24).toISOString(),
    });
    // The window is moved into the past directly, leaving the stored status
    // saying `ongoing` — precisely the staleness tm 176.6 is about. The trigger
    // must judge the window itself rather than believe the row.
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { endsAt: hoursFromNow(-1) },
    });
    expect(
      (await owner.campaign.findUnique({ where: { id: campaign.id }, select: { status: true } }))
        ?.status,
    ).toBe('ongoing');

    const shopper = await freshVisitor(fx.a, 'Too late');
    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    expect(await sendsFor(campaign.id)).toEqual([]);
  });

  it('fires a scheduled campaign once its start time has come', async () => {
    // The half only this path can notice: the row was stored `scheduled` and
    // nothing has written to it since, so nothing else in the product will ever
    // observe that it began.
    const campaign = await createCampaign({
      name: 'Launch day',
      content: { message: 'We are live' },
      starts_at: hoursFromNow(1).toISOString(),
    });
    await owner.campaign.update({
      where: { id: campaign.id },
      data: { startsAt: hoursFromNow(-1) },
    });
    expect(
      (await owner.campaign.findUnique({ where: { id: campaign.id }, select: { status: true } }))
        ?.status,
    ).toBe('scheduled');

    const shopper = await freshVisitor(fx.a, 'Right on time');
    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    expect(await sendsFor(campaign.id)).toHaveLength(1);
  });

  // --- Tenant isolation ----------------------------------------------------

  it("never fires another workspace's campaign at this visitor", async () => {
    // Same trigger, same page, different workspace. B's campaign is running and
    // would match on content alone — only the tenant boundary stops it.
    const mine = await createCampaign({ name: 'Mine', content: { message: 'A' } });
    const theirs = await createCampaign({ name: 'Theirs', content: { message: 'B' } }, writeTokenB);

    const shopper = await freshVisitor(fx.a, 'A visitor');
    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    expect(await sendsFor(mine.id)).toHaveLength(1);
    expect(await sendsFor(theirs.id)).toEqual([]);

    // And the row that was written belongs to A, not merely to A's campaign.
    const [send] = await owner.campaignSend.findMany({
      where: { customerId: shopper },
      select: { licenseId: true },
    });
    expect(send?.licenseId).toBe(fx.a.licenseId);
  });

  // --- What the visitor actually experiences -------------------------------

  it('holds the nudge until the conversation the visitor opened is over', async () => {
    // Writing in is what tells the server where they are, so a send fired this
    // way is always earned while a chat is opening. Delivery's own rule (tm
    // 176.2) keeps it owed rather than burning it on a card that would have had
    // nowhere to go — and then hands it over once the visitor is free again.
    const campaign = await createCampaign({
      name: 'Pricing nudge',
      content: { message: 'Questions about pricing?' },
    });
    const shopper = await freshVisitor(fx.a, 'Late arrival');
    const token = await widgetToken(fx.a, shopper);

    const chatId = await writeInFrom(token, PRICING_PAGE);
    expect((await poll(token)).campaign).toBeNull();
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toBeNull();

    const closed = await server.post('/customer/chat/close', {}, auth(token));
    expect([200, 204]).toContain(closed.statusCode);

    expect((await poll(token)).campaign).toEqual({
      id: campaign.id,
      message: 'Questions about pricing?',
    });
    expect((await sendsFor(campaign.id))[0]?.deliveredAt).toBeInstanceOf(Date);
    expect(chatId).toBeTruthy();
  });

  it('does not count the chat the visitor was already opening as a Chat', async () => {
    // The failure this guards: a send written on the way into a conversation,
    // credited by that same conversation, would make every campaign's Chats
    // figure equal its Displayed figure for free. `markCampaignEngaged` only
    // credits a send that was actually *delivered* first, so the fresh one is
    // out of reach — proven here rather than assumed from reading it.
    const campaign = await createCampaign({ name: 'Nudge', content: { message: 'Hi' } });
    const shopper = await freshVisitor(fx.a, 'Late arrival');

    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    expect(await sendsFor(campaign.id)).toEqual([
      { customerId: shopper, deliveredAt: null, engaged: false },
    ]);

    const list = await server.get('/campaigns', auth(writeToken));
    const { items } = list.json() as {
      items: { id: string; performance: { displayed: number; chats: number } }[];
    };
    expect(items.find((c) => c.id === campaign.id)?.performance).toMatchObject({
      displayed: 1,
      chats: 0,
    });
  });

  it('still records the page view when there is nothing to fire', async () => {
    // The trigger shares the page view's transaction, so a bug here would take
    // the browsing context (FR-MOD-13.2) down with it — the panel an agent
    // reads for context is not worth risking on a campaign that does not exist.
    const shopper = await freshVisitor(fx.a, 'No campaigns at all');
    await writeInFrom(await widgetToken(fx.a, shopper), PRICING_PAGE);

    const visit = await owner.visit.findFirst({
      where: { customerId: shopper },
      select: { pages: true },
    });
    expect(visit?.pages).toEqual([{ url: PRICING_PAGE, at: expect.any(String) }]);
  });
});
