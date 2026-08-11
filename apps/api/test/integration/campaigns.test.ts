/**
 * Campaigns — the trigger engine (FR-MOD-03.3).
 *
 * The property that carries the [MAX] rating is the send decision: an active
 * campaign must deliver to the live visitors whose page matches its trigger, to
 * nobody whose page does not, and — the failure most easily shipped unseen —
 * never to another tenant's visitors. Everything else here (validation, the
 * status filter, the card's numbers, the scope split) guards the edges around
 * that.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Campaign {
  id: string;
  name: string;
  status: 'ongoing' | 'scheduled' | 'inactive';
  conditions: { url_contains?: string };
  content: { message?: string };
  starts_at: string | null;
  ends_at: string | null;
  recurring: boolean;
  created_at: string;
  performance: { displayed: number; chats: number; conversion: number };
}

describe('campaigns', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const minutesAgo = (n: number): Date => new Date(Date.now() - n * 60_000);

  /** A customer with a recent visit on a given page — a live visitor to target. */
  async function seedVisitor(
    t: TenantFixture,
    name: string,
    url: string,
    startedAt = minutesAgo(2),
  ): Promise<string> {
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

  const create = async (token: string, body: unknown) =>
    server.post('/campaigns', body, auth(token));
  const list = async (token: string, query = ''): Promise<Campaign[]> => {
    const response = await server.get(`/campaigns${query}`, auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: Campaign[] }).items;
  };
  const sendsFor = (campaignId: string) =>
    owner.campaignSend.findMany({ where: { campaignId }, select: { customerId: true } });

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
    writeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:rw'],
    });
  });

  // --- Validation: trigger + message required (FR-MOD-03.3.2 KK) -------------

  it('rejects a campaign with no trigger', async () => {
    const response = await create(writeToken, {
      name: 'No trigger',
      conditions: {},
      content: { message: 'Hi there' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects a campaign with no message', async () => {
    const response = await create(writeToken, {
      name: 'No message',
      conditions: { url_contains: '/pricing' },
      content: {},
    });
    expect(response.statusCode).toBe(400);
  });

  // --- The send decision -----------------------------------------------------

  it('fires at a live visitor whose page matches the trigger', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing', 'https://shop.example/pricing');

    const response = await create(writeToken, {
      name: 'Pricing nudge',
      conditions: { url_contains: '/pricing' },
      content: { message: 'Questions about pricing?' },
    });
    expect(response.statusCode).toBe(201);
    const campaign = response.json() as Campaign;
    expect(campaign.status).toBe('ongoing');
    expect(campaign.performance.displayed).toBe(1);

    const sends = await sendsFor(campaign.id);
    expect(sends.map((s) => s.customerId)).toEqual([shopper]);
  });

  it('does not fire at a visitor whose page does not match', async () => {
    await seedVisitor(fx.a, 'On Blog', 'https://shop.example/blog');

    const response = await create(writeToken, {
      name: 'Pricing nudge',
      conditions: { url_contains: '/pricing' },
      content: { message: 'Questions about pricing?' },
    });
    const campaign = response.json() as Campaign;
    expect(campaign.performance.displayed).toBe(0);
    expect(await sendsFor(campaign.id)).toHaveLength(0);
  });

  it("never fires at another tenant's matching visitor", async () => {
    // Tenant B has a visitor on exactly the page tenant A will target.
    const theirs = await seedVisitor(fx.b, 'Theirs On Pricing', 'https://shop.example/pricing');
    // Tenant A has one too, so the campaign is not simply firing at nobody.
    const mine = await seedVisitor(fx.a, 'Mine On Pricing', 'https://shop.example/pricing');

    const response = await create(writeToken, {
      name: 'Pricing nudge',
      conditions: { url_contains: '/pricing' },
      content: { message: 'Questions about pricing?' },
    });
    const campaign = response.json() as Campaign;

    expect(campaign.performance.displayed).toBe(1);
    const reached = (await sendsFor(campaign.id)).map((s) => s.customerId);
    expect(reached).toEqual([mine]);
    expect(reached).not.toContain(theirs);
  });

  it('does not fire while the campaign is only scheduled', async () => {
    await seedVisitor(fx.a, 'On Pricing', 'https://shop.example/pricing');
    const response = await create(writeToken, {
      name: 'Future launch',
      conditions: { url_contains: '/pricing' },
      content: { message: 'Coming soon' },
      starts_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const campaign = response.json() as Campaign;
    expect(campaign.status).toBe('scheduled');
    expect(campaign.performance.displayed).toBe(0);
  });

  // --- Status filter (FR-MOD-03.3.1) -----------------------------------------

  it('filters the list by lifecycle state', async () => {
    await create(writeToken, {
      name: 'Running',
      conditions: { url_contains: '/x' },
      content: { message: 'hi' },
    });
    await create(writeToken, {
      name: 'Off',
      active: false,
      conditions: { url_contains: '/x' },
      content: { message: 'hi' },
    });
    await create(writeToken, {
      name: 'Later',
      conditions: { url_contains: '/x' },
      content: { message: 'hi' },
      starts_at: new Date(Date.now() + 3_600_000).toISOString(),
    });

    expect((await list(writeToken, '?status=all')).length).toBe(3);
    expect((await list(writeToken, '?status=ongoing')).map((c) => c.name)).toEqual(['Running']);
    expect((await list(writeToken, '?status=inactive')).map((c) => c.name)).toEqual(['Off']);
    expect((await list(writeToken, '?status=scheduled')).map((c) => c.name)).toEqual(['Later']);
  });

  // --- Edit + active toggle (FR-MOD-03.3.3) ----------------------------------

  it('activating an inactive campaign fires it, idempotently', async () => {
    const shopper = await seedVisitor(fx.a, 'On Pricing', 'https://shop.example/pricing');
    const created = (
      await create(writeToken, {
        name: 'Draft',
        active: false,
        conditions: { url_contains: '/pricing' },
        content: { message: 'hello' },
      })
    ).json() as Campaign;
    expect(created.performance.displayed).toBe(0);

    // Toggle active → fires at the matching visitor.
    const activated = await server.patch(
      `/campaigns/${created.id}`,
      { active: true },
      auth(writeToken),
    );
    expect(activated.statusCode).toBe(200);
    expect((activated.json() as Campaign).performance.displayed).toBe(1);
    expect((await sendsFor(created.id)).map((s) => s.customerId)).toEqual([shopper]);

    // Saving an edit again must not send twice to someone already reached.
    const edited = await server.patch(
      `/campaigns/${created.id}`,
      { name: 'Renamed' },
      auth(writeToken),
    );
    expect((edited.json() as Campaign).name).toBe('Renamed');
    expect(await sendsFor(created.id)).toHaveLength(1);
  });

  it('will not let an edit strip the trigger out of an active campaign', async () => {
    const created = (
      await create(writeToken, {
        name: 'Active',
        conditions: { url_contains: '/x' },
        content: { message: 'hello' },
      })
    ).json() as Campaign;
    // Clearing the trigger on a still-active campaign would leave it able to
    // fire at nobody — rejected rather than silently saved inert.
    const response = await server.patch(
      `/campaigns/${created.id}`,
      { conditions: {} },
      auth(writeToken),
    );
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 for a campaign in another tenant', async () => {
    const theirs = await owner.campaign.create({
      data: {
        licenseId: fx.b.licenseId,
        name: 'Theirs',
        status: 'ongoing',
        conditions: {},
        content: {},
      },
      select: { id: true },
    });
    const response = await server.patch(`/campaigns/${theirs.id}`, { name: 'x' }, auth(writeToken));
    expect(response.statusCode).toBe(404);
  });

  // --- Performance (FR-MOD-03.3.3) -------------------------------------------

  it('counts displayed / chats / conversion from the sends', async () => {
    const c1 = await seedVisitor(fx.a, 'Displayed only', 'https://shop.example/pricing');
    const c2 = await seedVisitor(fx.a, 'Engaged', 'https://shop.example/pricing');
    const c3 = await seedVisitor(fx.a, 'Converted', 'https://shop.example/pricing');
    const campaign = (
      await create(writeToken, {
        name: 'Pricing',
        conditions: { url_contains: '/pricing' },
        content: { message: 'hi' },
      })
    ).json() as Campaign;
    expect(campaign.performance).toEqual({ displayed: 3, chats: 0, conversion: 0 });

    // Simulate downstream engagement/conversion on two of the three sends.
    await owner.campaignSend.updateMany({
      where: { campaignId: campaign.id, customerId: { in: [c2, c3] } },
      data: { engaged: true },
    });
    await owner.campaignSend.updateMany({
      where: { campaignId: campaign.id, customerId: c3 },
      data: { converted: true },
    });
    void c1;

    const refreshed = (await list(writeToken, '?status=all')).find((c) => c.id === campaign.id);
    expect(refreshed?.performance).toEqual({ displayed: 3, chats: 2, conversion: 1 });
  });

  // --- Scope split -----------------------------------------------------------

  it('lets a read-only agent list but not create campaigns', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:ro'],
    });
    expect((await server.get('/campaigns', auth(readToken))).statusCode).toBe(200);
    const denied = await create(readToken, {
      name: 'Nope',
      conditions: { url_contains: '/x' },
      content: { message: 'hi' },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('rejects a caller with no customer scope', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    expect((await server.get('/campaigns', auth(token))).statusCode).toBe(403);
  });
});
