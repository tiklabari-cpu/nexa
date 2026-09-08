/**
 * The sale / lead / resolution funnel — where a conversion happens
 * (FR-MOD-13.3, 13.3-d · V2-GOALPRED-a).
 *
 * `goals-achievement.test.ts` next door drives the one moment that already
 * worked: a visitor on a page. This file drives the three the PRD row names and
 * the engine could not express, and each is a *different* request on a
 * different endpoint — a sale reported by the shop's confirmation page, an
 * e-mail that makes somebody a lead, a conversation being archived.
 *
 * Two things are worth more than the individual cases, and both fail silently
 * rather than loudly if they break:
 *
 *   1. **None of the three is a page view.** `evaluate` used to return early on
 *      an empty page list, so a sale goal could be defined, saved and never
 *      once evaluated. Every test here therefore converts a visitor who has
 *      seen no tracked page at all.
 *   2. **AND across trigger points converges.** A goal that wants a sale *and*
 *      a resolved chat is reached by two requests minutes apart. Because the
 *      matcher reads the visitor's state rather than "which event fired",
 *      whichever arrives second finds the first already true — in either order.
 *
 * Driven through real requests, like the file it sits beside: a test that
 * called the service directly would prove the service and nothing about whether
 * these endpoints actually reach it.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const ORDER = { external_order_id: 'ORD-2001', amount_cents: 12_900, currency: 'USD' };

describe('reaching a sale, lead or resolution goal (FR-MOD-13.3)', () => {
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

  /**
   * A goal straight into the table — `definition` is the raw json type, because
   * the rows worth testing include ones the route would never have written.
   */
  async function seedGoal(
    t: TenantFixture,
    name: string,
    definition: Prisma.InputJsonValue,
  ): Promise<string> {
    const goal = await owner.goal.create({
      data: { licenseId: t.licenseId, name, definition, active: true },
      select: { id: true },
    });
    return goal.id;
  }

  /** Turn sales tracking on, as the settings screen would (FR-MOD-13.5). */
  async function enableSalesTracking(t: TenantFixture): Promise<void> {
    await owner.salesTrackerSettings.create({
      data: { licenseId: t.licenseId, enabled: true, currency: 'USD', attributionWindowDays: 7 },
    });
  }

  const achievementsOf = (t: TenantFixture) =>
    owner.goalAchievement.findMany({
      where: { licenseId: t.licenseId },
      select: { goalId: true, customerId: true, chatId: true },
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

  // --- Sale (FR-MOD-13.3) -----------------------------------------------------

  describe('a sale', () => {
    it('converts a visitor who reported an order and never saw a tracked page', async () => {
      // The whole point of 204.1: this visitor has no visit, no page and no
      // chat. Under the old engine there was nothing here to match on and the
      // sale funnel could not exist.
      await enableSalesTracking(fx.a);
      const goalId = await seedGoal(fx.a, 'Purchase', { sale_completed: true });

      const shopper = await visitor(fx.a);
      expect(
        (await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode,
      ).toBe(201);

      const rows = await achievementsOf(fx.a);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.goalId).toBe(goalId);
      expect(rows[0]?.customerId).toBe(shopper.customerId);
    });

    it('records nothing for a visitor who has not bought anything', async () => {
      await enableSalesTracking(fx.a);
      await seedGoal(fx.a, 'Purchase', { sale_completed: true });

      const browser = await visitor(fx.a);
      expect(
        (
          await server.post(
            '/customer/chat/events',
            { text: 'Hi', url: 'https://s/x' },
            auth(browser.token),
          )
        ).statusCode,
      ).toBe(201);

      expect(await achievementsOf(fx.a)).toEqual([]);
    });

    it('stays at one row when the same order is reported twice', async () => {
      // The sale endpoint answers a repeat as a replay (200). The funnel must
      // not gain a conversion from it, and `UNIQUE(goal_id, customer_id)` is
      // what makes that true whichever branch the second report takes.
      await enableSalesTracking(fx.a);
      await seedGoal(fx.a, 'Purchase', { sale_completed: true });

      const shopper = await visitor(fx.a);
      expect(
        (await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode,
      ).toBe(201);
      await clearRateLimits(server.app);
      expect(
        (await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode,
      ).toBe(200);

      expect(await achievementsOf(fx.a)).toHaveLength(1);
    });

    it("never lets a shopper trip the neighbouring workspace's sale goal", async () => {
      await enableSalesTracking(fx.a);
      await seedGoal(fx.b, 'Purchase', { sale_completed: true });

      const shopper = await visitor(fx.a);
      expect(
        (await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode,
      ).toBe(201);

      expect(await achievementsOf(fx.b)).toEqual([]);
      expect(await achievementsOf(fx.a)).toEqual([]);
    });
  });

  // --- Lead (FR-MOD-13.3) -----------------------------------------------------

  describe('a lead', () => {
    it('converts a visitor the moment the pre-chat form captures their e-mail', async () => {
      const goalId = await seedGoal(fx.a, 'Lead captured', { lead_captured: true });

      const lead = await visitor(fx.a);
      const opened = await server.post(
        '/customer/chat/events',
        { text: 'Send me a quote', email: 'buyer@example.com' },
        auth(lead.token),
      );
      expect(opened.statusCode).toBe(201);

      const rows = await achievementsOf(fx.a);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.goalId).toBe(goalId);
      // No conversation on the row, and that is the truthful answer rather than
      // a gap: the pre-chat form is answered *before* the chat is opened, so at
      // the instant they became a lead there was no conversation to attribute
      // it to. The funnel's middle stage is counted from `threads`, not from
      // this column (`goalFunnelCounts`), so nothing downstream is short.
      expect(rows[0]?.chatId).toBeNull();
      expect(opened.json()).toMatchObject({ chat_id: expect.any(String) });
    });

    it('converts a contact an agent gave an e-mail to', async () => {
      // The other half of the same rule: leads are captured from the CRM too,
      // and a goal that only fired for the widget would under-report every
      // workspace whose agents type the address in.
      const goalId = await seedGoal(fx.a, 'Lead captured', { lead_captured: true });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:rw'],
      });

      const browser = await visitor(fx.a);
      const patched = await server.patch(
        `/customers/${browser.customerId}`,
        { email: 'buyer@example.com' },
        auth(token),
      );
      expect(patched.statusCode).toBe(200);

      const rows = await achievementsOf(fx.a);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.goalId).toBe(goalId);
      expect(rows[0]?.customerId).toBe(browser.customerId);
    });

    it('does not convert a contact edited without an e-mail', async () => {
      await seedGoal(fx.a, 'Lead captured', { lead_captured: true });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:rw'],
      });

      const browser = await visitor(fx.a);
      expect(
        (await server.patch(`/customers/${browser.customerId}`, { name: 'Ada' }, auth(token)))
          .statusCode,
      ).toBe(200);

      expect(await achievementsOf(fx.a)).toEqual([]);
    });

    it('converts a visitor who leaves a message when nobody is available (FR-MOD-08.7.7)', async () => {
      // The fourth address the funnel can be reached from, and the one that is
      // easiest to leave behind: this request opens a ticket rather than a
      // chat, so it goes nowhere near the two paths above. A workspace whose
      // agents are offline half the day would otherwise under-count exactly the
      // leads it most wants to see.
      //
      // The `prospect` placement is *not* a second predicate for this — what
      // converts them is the e-mail landing on the contact, the same rule the
      // pre-chat form and the CRM edit trip. The field only exists here because
      // the offline surface is opt-in and refuses until the workspace has built
      // one of its two forms.
      const goalId = await seedGoal(fx.a, 'Lead captured', { lead_captured: true });
      await owner.customFieldDefinition.create({
        data: {
          licenseId: fx.a.licenseId,
          entity: 'contact',
          label: 'Company',
          type: 'text',
          formPlacement: 'prospect',
        },
      });

      const lead = await visitor(fx.a);
      const left = await server.post(
        '/customer/ticket',
        { subject: 'Nobody was around', email: 'buyer@example.com' },
        auth(lead.token),
      );
      expect(left.statusCode).toBe(201);

      const rows = await achievementsOf(fx.a);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.goalId).toBe(goalId);
      expect(rows[0]?.customerId).toBe(lead.customerId);
      // No conversation on the row, for the pre-chat form's reason turned up a
      // notch: there is no chat here at all, and never was.
      expect(rows[0]?.chatId).toBeNull();
    });

    it('does not convert them twice when they leave a second message', async () => {
      // `becameLead` is read inside the transaction that sets the flag, so the
      // conversion rides the transition rather than the state — a visitor who
      // comes back offline a second time is already a lead.
      await seedGoal(fx.a, 'Lead captured', { lead_captured: true });
      await owner.customFieldDefinition.create({
        data: {
          licenseId: fx.a.licenseId,
          entity: 'contact',
          label: 'Company',
          type: 'text',
          formPlacement: 'prospect',
        },
      });

      const lead = await visitor(fx.a);
      for (const subject of ['Nobody was around', 'Still nobody around']) {
        await clearRateLimits(server.app);
        expect(
          (
            await server.post(
              '/customer/ticket',
              { subject, email: 'buyer@example.com' },
              auth(lead.token),
            )
          ).statusCode,
        ).toBe(201);
      }

      expect(await achievementsOf(fx.a)).toHaveLength(1);
    });
  });

  // --- Resolution (FR-MOD-13.3) ----------------------------------------------

  describe('a resolution', () => {
    it('converts a visitor when their conversation is archived', async () => {
      // Nothing about closing a chat is a page view, and the close is not even
      // the visitor's own request when an agent does it — this is the trigger
      // furthest from where the engine used to be able to see.
      const goalId = await seedGoal(fx.a, 'Question answered', { chat_resolved: true });

      const asker = await visitor(fx.a);
      const opened = await server.post(
        '/customer/chat/events',
        { text: 'How do refunds work?' },
        auth(asker.token),
      );
      expect(opened.statusCode).toBe(201);
      expect(await achievementsOf(fx.a)).toEqual([]);

      await clearRateLimits(server.app);
      expect((await server.post('/customer/chat/close', {}, auth(asker.token))).statusCode).toBe(
        204,
      );

      const rows = await achievementsOf(fx.a);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.goalId).toBe(goalId);
      // The chat is closed by now, so an evaluation that insisted on an *active*
      // conversation would file every resolution under no chat at all.
      expect(rows[0]?.chatId).toBe((opened.json() as { chat_id: string }).chat_id);
    });

    it('converts when an agent archives the conversation', async () => {
      const goalId = await seedGoal(fx.a, 'Question answered', { chat_resolved: true });
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw', 'chats--all:ro'],
      });

      const asker = await visitor(fx.a);
      const opened = await server.post(
        '/customer/chat/events',
        { text: 'How do refunds work?' },
        auth(asker.token),
      );
      expect(opened.statusCode).toBe(201);
      const chatId = (opened.json() as { chat_id: string }).chat_id;

      expect((await server.post(`/chats/${chatId}/deactivate`, {}, auth(token))).statusCode).toBe(
        200,
      );

      const rows = await achievementsOf(fx.a);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.goalId).toBe(goalId);
    });

    it('leaves an open conversation unconverted', async () => {
      await seedGoal(fx.a, 'Question answered', { chat_resolved: true });

      const asker = await visitor(fx.a);
      expect(
        (await server.post('/customer/chat/events', { text: 'Still talking' }, auth(asker.token)))
          .statusCode,
      ).toBe(201);

      expect(await achievementsOf(fx.a)).toEqual([]);
    });
  });

  // --- AND across trigger points ---------------------------------------------

  describe('a goal that needs two of them', () => {
    it('converges whichever fact arrives last — sale, then resolution', async () => {
      await enableSalesTracking(fx.a);
      const goalId = await seedGoal(fx.a, 'Bought and done', {
        sale_completed: true,
        chat_resolved: true,
      });

      const shopper = await visitor(fx.a);
      expect(
        (await server.post('/customer/chat/events', { text: 'Buying now' }, auth(shopper.token)))
          .statusCode,
      ).toBe(201);
      await clearRateLimits(server.app);
      expect(
        (await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode,
      ).toBe(201);
      // The sale alone is not the goal — the chat is still open.
      expect(await achievementsOf(fx.a)).toEqual([]);

      await clearRateLimits(server.app);
      expect((await server.post('/customer/chat/close', {}, auth(shopper.token))).statusCode).toBe(
        204,
      );

      expect((await achievementsOf(fx.a)).map((row) => row.goalId)).toEqual([goalId]);
    });

    it('converges in the other order too — resolution, then sale', async () => {
      // The order the facts arrive in must not decide the answer. This is the
      // property that state-reading buys and an event-typed matcher would lose.
      await enableSalesTracking(fx.a);
      const goalId = await seedGoal(fx.a, 'Bought and done', {
        sale_completed: true,
        chat_resolved: true,
      });

      const shopper = await visitor(fx.a);
      expect(
        (
          await server.post(
            '/customer/chat/events',
            { text: 'One question first' },
            auth(shopper.token),
          )
        ).statusCode,
      ).toBe(201);
      await clearRateLimits(server.app);
      expect((await server.post('/customer/chat/close', {}, auth(shopper.token))).statusCode).toBe(
        204,
      );
      expect(await achievementsOf(fx.a)).toEqual([]);

      await clearRateLimits(server.app);
      expect(
        (await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode,
      ).toBe(201);

      expect((await achievementsOf(fx.a)).map((row) => row.goalId)).toEqual([goalId]);
    });
  });

  // --- What the new predicates must not break --------------------------------

  it('marks the campaign send converted for a sale goal too (FR-MOD-03.3.3)', async () => {
    // The campaign link rides on "something genuinely new was recorded", not on
    // the page-view path — a conversion reached by a sale is the same
    // conversion for the campaign that invited the visitor.
    await enableSalesTracking(fx.a);
    await seedGoal(fx.a, 'Purchase', { sale_completed: true });

    const shopper = await visitor(fx.a);
    const campaign = await owner.campaign.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Discount nudge',
        status: 'ongoing',
        conditions: { url_contains: '/pricing' },
        content: { message: 'Need a hand?' },
      },
      select: { id: true },
    });
    const send = await owner.campaignSend.create({
      data: { licenseId: fx.a.licenseId, campaignId: campaign.id, customerId: shopper.customerId },
      select: { id: true },
    });

    expect((await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode).toBe(
      201,
    );

    expect(
      (await owner.campaignSend.findUnique({ where: { id: send.id }, select: { converted: true } }))
        ?.converted,
    ).toBe(true);
  });

  it('keeps an unreadable funnel predicate from stopping the goals around it', async () => {
    // Same contract the url predicate has: a hand-edited row is a goal nobody
    // reaches, never an evaluation that loses the goals beside it.
    await enableSalesTracking(fx.a);
    await seedGoal(fx.a, 'Hand-edited', { sale_completed: 'true' });
    const reachable = await seedGoal(fx.a, 'Purchase', { sale_completed: true });

    const shopper = await visitor(fx.a);
    expect((await server.post('/customer/chat/sale', ORDER, auth(shopper.token))).statusCode).toBe(
      201,
    );

    expect((await achievementsOf(fx.a)).map((row) => row.goalId)).toEqual([reachable]);
  });
});
