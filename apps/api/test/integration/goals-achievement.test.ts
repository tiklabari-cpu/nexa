/**
 * Reaching a goal — the funnel's conversion stage (FR-MOD-13.3, 13.3-d).
 *
 * `goals` held only the *definition* of a conversion; nothing recorded that one
 * had happened. This is the write path that closes the funnel, and it is driven
 * here through the visitor's own request — `POST /customer/chat/events` with a
 * page url — because that is the only place it can ever fire. A test that
 * called the service directly would prove the service and nothing about whether
 * a visitor browsing the site can actually convert.
 *
 * Four properties carry the weight, and they fail independently:
 *
 *   1. **It fires at all**, exactly once per visitor per goal — a second page
 *      view must not add a second row. Over-counting here is silent: nothing
 *      breaks, the funnel simply reports conversions that did not happen.
 *   2. **A retired goal stays retired.** `active: false` is how a goal is
 *      switched off (there is no delete), so an inactive goal that still fires
 *      would make retiring one meaningless.
 *   3. **Tenant isolation.** A visitor on one workspace's site must not trip
 *      another workspace's goal, and no row may land under a licence the
 *      visitor was never in.
 *   4. **The campaign link.** A visitor a campaign invited, who then converts,
 *      is that campaign's Conversion — and only that campaign's: another
 *      licence's send must be untouched by the same write.
 *
 * The visitor's message must survive all of it. Conversion tracking is
 * best-effort; a broken matcher may not stop someone talking to support.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalService } from '../../src/services/goals/goal-service.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const THANK_YOU = 'https://shop.example/checkout/thank-you';
const PRICING = 'https://shop.example/pricing';

describe('reaching a goal (13.3-d)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A real visitor token — the widget's own credential. */
  async function visitor(t: TenantFixture): Promise<{ token: string; customerId: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { token: string; customer_id: string };
    return { token: body.token, customerId: body.customer_id };
  }

  /** A visitor writing in from a page — the only path that evaluates goals. */
  const writeFrom = (token: string, url: string, text = 'Any help here?') =>
    server.post('/customer/chat/events', { text, url }, auth(token));

  /**
   * A goal straight into the table. `definition` is deliberately the raw json
   * type rather than `GoalDefinition`: the rows worth testing here include the
   * ones the route would never have written.
   */
  async function seedGoal(
    t: TenantFixture,
    name: string,
    definition: Prisma.InputJsonValue,
    options: { active?: boolean } = {},
  ): Promise<string> {
    const goal = await owner.goal.create({
      data: { licenseId: t.licenseId, name, definition, active: options.active ?? true },
      select: { id: true },
    });
    return goal.id;
  }

  /** A campaign that invited this visitor — the send whose Conversion is at stake. */
  async function seedSend(t: TenantFixture, customerId: string): Promise<string> {
    const campaign = await owner.campaign.create({
      data: {
        licenseId: t.licenseId,
        name: 'Pricing nudge',
        status: 'ongoing',
        conditions: { url_contains: '/pricing' },
        content: { message: 'Need a hand?' },
      },
      select: { id: true },
    });
    const send = await owner.campaignSend.create({
      data: { licenseId: t.licenseId, campaignId: campaign.id, customerId },
      select: { id: true },
    });
    return send.id;
  }

  const achievementsOf = (t: TenantFixture) =>
    owner.goalAchievement.findMany({
      where: { licenseId: t.licenseId },
      select: { goalId: true, customerId: true, chatId: true, achievedAt: true },
    });

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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Nothing fires without a reason (negative first) ------------------------

  it('records nothing when the visitor never reaches the goal page', async () => {
    await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, PRICING)).statusCode).toBe(201);

    expect(await achievementsOf(fx.a)).toEqual([]);
  });

  it('never fires a goal with nothing to match on', async () => {
    // An empty definition is not "everyone converts" — it is a target nobody
    // can reach. The route refuses to save one, so this row could only arrive
    // by hand; it must still match nobody.
    await seedGoal(fx.a, 'Empty', {});
    await seedGoal(fx.a, 'Hand-edited', { url_contains: 42 });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    expect(await achievementsOf(fx.a)).toEqual([]);
  });

  it('does not fire a retired goal', async () => {
    // `active: false` is the only way to switch a goal off — there is no delete,
    // so a retired goal that still fired would make retiring one meaningless.
    await seedGoal(fx.a, 'Old campaign target', { url_contains: '/thank-you' }, { active: false });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    expect(await achievementsOf(fx.a)).toEqual([]);
  });

  it('keeps one unreadable definition from stopping the goals around it', async () => {
    // Every active goal in the workspace is evaluated over the same visitor. A
    // row nobody can read is one goal nobody reaches, not an evaluation that
    // loses the others.
    await seedGoal(fx.a, 'Unreadable', 'not-an-object');
    const reachable = await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    expect((await achievementsOf(fx.a)).map((row) => row.goalId)).toEqual([reachable]);
  });

  // --- The conversion itself --------------------------------------------------

  it('records exactly one conversion when the visitor reaches the goal', async () => {
    const goalId = await seedGoal(fx.a, 'Checkout complete', { url_contains: '/THANK-YOU' });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    const rows = await achievementsOf(fx.a);
    expect(rows).toHaveLength(1);
    // Case-insensitive, like the campaign trigger: `/THANK-YOU` in the
    // definition matches `/thank-you` in the address bar.
    expect(rows[0]?.goalId).toBe(goalId);
    expect(rows[0]?.customerId).toBe(shopper.customerId);
  });

  it('stays at one row however many times the visitor comes back', async () => {
    // The idempotency the funnel depends on. `evaluate` runs on every page view;
    // a person converts on a goal once, and the second, third and fourth visit
    // must be a no-op rather than three more rows inflating the report.
    await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);
    const first = await achievementsOf(fx.a);
    expect(first).toHaveLength(1);

    await clearRateLimits(server.app);
    expect((await writeFrom(shopper.token, THANK_YOU, 'Still here')).statusCode).toBe(201);
    await clearRateLimits(server.app);
    expect((await writeFrom(shopper.token, PRICING, 'Back to pricing')).statusCode).toBe(201);
    // Leaving and returning to the goal page is still the same conversion.
    await clearRateLimits(server.app);
    expect((await writeFrom(shopper.token, THANK_YOU, 'One more thing')).statusCode).toBe(201);

    const rows = await achievementsOf(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.achievedAt).toEqual(first[0]?.achievedAt);
  });

  it('counts a goal reached earlier in the same visit', async () => {
    // The visit is evaluated, not just the page in this request — the same way
    // the campaign engine reads a visitor. Someone who passed /thank-you and
    // then wrote in from /pricing has converted, and so has someone whose goal
    // was only defined after they got there. Matching on the current page alone
    // would lose both.
    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);
    expect(await achievementsOf(fx.a)).toEqual([]);

    const goalId = await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });
    await clearRateLimits(server.app);
    expect((await writeFrom(shopper.token, PRICING, 'A question')).statusCode).toBe(201);

    const rows = await achievementsOf(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.goalId).toBe(goalId);
  });

  it('attributes the conversion to the conversation the visitor was in', async () => {
    // The funnel's middle stage, kept on the row: the chat someone converted
    // during is not the chat they may be in a week later.
    await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    const opened = await writeFrom(shopper.token, PRICING, 'Is there a discount?');
    expect(opened.statusCode).toBe(201);
    const chatId = (opened.json() as { chat_id: string }).chat_id;

    await clearRateLimits(server.app);
    expect((await writeFrom(shopper.token, THANK_YOU, 'Just bought it')).statusCode).toBe(201);

    const rows = await achievementsOf(fx.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.chatId).toBe(chatId);
  });

  // --- Tenant isolation (NFR-S4 / NFR-S5) ------------------------------------

  it("never lets a visitor trip the neighbouring workspace's goal", async () => {
    // The same url is a conversion for tenant B and means nothing to tenant A.
    // Tenant A's visitor reaching it must leave B's funnel untouched — and must
    // not plant a row under B's licence, which is what would quietly hand a
    // competitor conversions nobody there earned.
    await seedGoal(fx.b, 'Demo booked', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    expect(await achievementsOf(fx.b)).toEqual([]);
    expect(await achievementsOf(fx.a)).toEqual([]);
  });

  it('keeps two workspaces with the same goal url apart', async () => {
    const mine = await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });
    await seedGoal(fx.b, 'Checkout complete', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    const mineRows = await achievementsOf(fx.a);
    expect(mineRows).toHaveLength(1);
    expect(mineRows[0]?.goalId).toBe(mine);
    expect(await achievementsOf(fx.b)).toEqual([]);
  });

  // --- The campaign link (FR-MOD-03.3.3) -------------------------------------

  it("marks the visitor's campaign send converted, and only theirs", async () => {
    await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    const mySend = await seedSend(fx.a, shopper.customerId);
    // A neighbour's send for their own visitor: same write, different licence.
    const theirSend = await seedSend(fx.b, fx.b.customerId);
    // And an uninvolved visitor of ours, to prove the customer filter holds too.
    const bystander = await visitor(fx.a);
    const bystanderSend = await seedSend(fx.a, bystander.customerId);

    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    const converted = async (id: string) =>
      (await owner.campaignSend.findUnique({ where: { id }, select: { converted: true } }))
        ?.converted;
    expect(await converted(mySend)).toBe(true);
    expect(await converted(theirSend)).toBe(false);
    expect(await converted(bystanderSend)).toBe(false);
  });

  it('does not re-flag a send on a repeat visit that converts nothing new', async () => {
    // The update rides on "something new was recorded". A send an agent cleared
    // by hand must not be flipped back by the visitor reloading the page.
    await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });

    const shopper = await visitor(fx.a);
    const sendId = await seedSend(fx.a, shopper.customerId);
    expect((await writeFrom(shopper.token, THANK_YOU)).statusCode).toBe(201);

    await owner.campaignSend.update({ where: { id: sendId }, data: { converted: false } });
    await clearRateLimits(server.app);
    expect((await writeFrom(shopper.token, THANK_YOU, 'Back again')).statusCode).toBe(201);

    const send = await owner.campaignSend.findUnique({
      where: { id: sendId },
      select: { converted: true },
    });
    expect(send?.converted).toBe(false);
    expect(await achievementsOf(fx.a)).toHaveLength(1);
  });

  // --- Best-effort (NFR-P2) ---------------------------------------------------

  it("still delivers the visitor's message when goal evaluation fails", async () => {
    // Conversion tracking is bookkeeping. A visitor who cannot reach support
    // because a matcher threw is a far worse failure than a lost conversion.
    await seedGoal(fx.a, 'Checkout complete', { url_contains: '/thank-you' });
    vi.spyOn(GoalService.prototype, 'evaluate').mockRejectedValueOnce(
      new Error('goal evaluation blew up'),
    );

    const shopper = await visitor(fx.a);
    const response = await writeFrom(shopper.token, THANK_YOU, 'My order failed');

    expect(response.statusCode).toBe(201);
    expect((response.json() as { chat_id: string }).chat_id).toBeTruthy();
    expect(await achievementsOf(fx.a)).toEqual([]);
  });
});
