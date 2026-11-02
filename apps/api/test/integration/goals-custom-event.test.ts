/**
 * A page event as a goal's trigger (EN-06) — `siyahtus('trackEvent', …)` →
 * `POST /customer/events` → `visitor_events` → `goals.record`.
 *
 * The acceptance criteria, each driven through real requests like the files
 * beside it (`goals-triggers.test.ts`, `goals-achievement.test.ts`):
 *
 *   1. an event the goal names converts the visitor — with no page, no sale and
 *      no chat behind them;
 *   2. a malformed name is refused and writes nothing;
 *   3. an amount sent along is never stored;
 *   4. the same event repeated cannot inflate the conversion count.
 *
 * Plus what keeps unverified browser data harmless: it is scoped to the
 * workspace, bounded per visitor, rate limited, and it goes away with the visitor.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

describe('a page event as a goal trigger (EN-06)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
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

  const report = (token: string, body: unknown) =>
    server.post('/customer/events', body, auth(token));

  const achievementsOf = (t: TenantFixture) =>
    owner.goalAchievement.findMany({
      where: { licenseId: t.licenseId },
      select: { goalId: true, customerId: true },
    });

  const eventsOf = (t: TenantFixture) =>
    owner.visitorEvent.findMany({
      where: { licenseId: t.licenseId },
      select: { customerId: true, name: true, value: true },
      orderBy: [{ name: 'asc' }, { value: 'asc' }],
    });

  beforeAll(async () => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  // --- Reaching the goal ------------------------------------------------------

  it('converts a visitor whose page reported the event — no page, sale or chat needed', async () => {
    const goalId = await seedGoal(fx.a, 'Registered', {
      custom_event: { name: 'registration_completed' },
    });
    const shopper = await visitor(fx.a);
    expect(await achievementsOf(fx.a)).toEqual([]);

    const response = await report(shopper.token, { name: 'registration_completed' });
    expect(response.statusCode).toBe(204);

    expect(await achievementsOf(fx.a)).toEqual([{ goalId, customerId: shopper.customerId }]);
    expect(await eventsOf(fx.a)).toEqual([
      { customerId: shopper.customerId, name: 'registration_completed', value: '' },
    ]);
  });

  it('does not convert for a different event', async () => {
    await seedGoal(fx.a, 'Registered', { custom_event: { name: 'registration_completed' } });
    const shopper = await visitor(fx.a);

    expect((await report(shopper.token, { name: 'deposit_page_viewed' })).statusCode).toBe(204);

    expect(await achievementsOf(fx.a)).toEqual([]);
  });

  it('with value_equals, converts only for that exact value', async () => {
    const goalId = await seedGoal(fx.a, 'Pro plan', {
      custom_event: { name: 'plan_chosen', value_equals: 'pro' },
    });
    const shopper = await visitor(fx.a);

    await report(shopper.token, { name: 'plan_chosen', value: 'free' });
    await report(shopper.token, { name: 'plan_chosen' });
    expect(await achievementsOf(fx.a)).toEqual([]);

    await report(shopper.token, { name: 'plan_chosen', value: ' pro ' });
    expect(await achievementsOf(fx.a)).toEqual([{ goalId, customerId: shopper.customerId }]);
  });

  it('converts one visitor once, however often the page repeats the event', async () => {
    await seedGoal(fx.a, 'Registered', { custom_event: { name: 'registration_completed' } });
    const shopper = await visitor(fx.a);

    for (let i = 0; i < 5; i += 1) {
      expect((await report(shopper.token, { name: 'registration_completed' })).statusCode).toBe(
        204,
      );
    }

    expect(await achievementsOf(fx.a)).toHaveLength(1);
    // The table is bounded by what a visitor says distinctly, not how often.
    expect(await eventsOf(fx.a)).toHaveLength(1);
  });

  it('counts two visitors separately', async () => {
    await seedGoal(fx.a, 'Registered', { custom_event: { name: 'registration_completed' } });
    const one = await visitor(fx.a);
    const two = await visitor(fx.a);

    await report(one.token, { name: 'registration_completed' });
    await report(two.token, { name: 'registration_completed' });

    const converted = (await achievementsOf(fx.a)).map((row) => row.customerId).sort();
    expect(converted).toEqual([one.customerId, two.customerId].sort());
  });

  it('converts on a repeat when the goal was defined after the first report', async () => {
    const shopper = await visitor(fx.a);
    await report(shopper.token, { name: 'registration_completed' });
    expect(await achievementsOf(fx.a)).toEqual([]);

    const goalId = await seedGoal(fx.a, 'Registered', {
      custom_event: { name: 'registration_completed' },
    });
    await report(shopper.token, { name: 'registration_completed' });

    expect(await achievementsOf(fx.a)).toEqual([{ goalId, customerId: shopper.customerId }]);
  });

  it("never trips another workspace's goal, and the other workspace never sees the event", async () => {
    await seedGoal(fx.b, 'Registered elsewhere', {
      custom_event: { name: 'registration_completed' },
    });
    const shopper = await visitor(fx.a);

    await report(shopper.token, { name: 'registration_completed' });

    expect(await achievementsOf(fx.b)).toEqual([]);
    expect(await eventsOf(fx.b)).toEqual([]);
    expect(await eventsOf(fx.a)).toHaveLength(1);
  });

  // --- What the endpoint refuses ----------------------------------------------

  it.each([
    ['an upper-case name', { name: 'Registration' }],
    ['a name with a space', { name: 'sign up' }],
    ['a name with a dash', { name: 'sign-up' }],
    ['an empty name', { name: '' }],
    ['a name over 40 characters', { name: 'a'.repeat(41) }],
    ['no name', { value: 'x' }],
    ['a name that is not a string', { name: 7 }],
    ['a value over 100 characters', { name: 'plan_chosen', value: 'v'.repeat(101) }],
    ['a value that is not a string', { name: 'plan_chosen', value: 49.9 }],
  ])('refuses %s and writes nothing', async (_label, body) => {
    await seedGoal(fx.a, 'Registered', { custom_event: { name: 'registration_completed' } });
    const shopper = await visitor(fx.a);

    const response = await report(shopper.token, body);

    expect(response.statusCode).toBe(400);
    expect(await eventsOf(fx.a)).toEqual([]);
    expect(await achievementsOf(fx.a)).toEqual([]);
  });

  it('refuses a request with no customer token', async () => {
    const response = await server.post('/customer/events', { name: 'registration_completed' });
    expect(response.statusCode).toBe(401);
  });

  it('stores no amount — one sent along is ignored, and so is a forged workspace', async () => {
    await seedGoal(fx.a, 'Registered', { custom_event: { name: 'registration_completed' } });
    const shopper = await visitor(fx.a);

    const response = await report(shopper.token, {
      name: 'registration_completed',
      amount_cents: 4_990,
      amount: 49.9,
      currency: 'USD',
      license_id: fx.b.licenseId.toString(),
      customer_id: fx.b.customerId,
    });

    expect(response.statusCode).toBe(204);
    // The row has no place to put a figure: name + label only, under the token's licence.
    expect(await eventsOf(fx.a)).toEqual([
      { customerId: shopper.customerId, name: 'registration_completed', value: '' },
    ]);
    expect(await eventsOf(fx.b)).toEqual([]);
    const columns = await owner.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'visitor_events'
    `;
    expect(columns.map((c) => c.column_name).sort()).toEqual([
      'customer_id',
      'id',
      'license_id',
      'name',
      'occurred_at',
      'value',
    ]);
    // …and it never touched the revenue table.
    expect(await owner.trackedSale.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('remembers a visitor for a bounded number of distinct events, and still answers 204', async () => {
    await seedGoal(fx.a, 'Registered', { custom_event: { name: 'registration_completed' } });
    const shopper = await visitor(fx.a);
    await owner.visitorEvent.createMany({
      data: Array.from({ length: 200 }, (_, i) => ({
        licenseId: fx.a.licenseId,
        customerId: shopper.customerId,
        name: 'filler',
        value: `v${i}`,
      })),
    });

    const response = await report(shopper.token, { name: 'one_more' });

    expect(response.statusCode).toBe(204);
    expect(await owner.visitorEvent.count({ where: { name: 'one_more' } })).toBe(0);
  });

  it('rate limits a page that fires events in a loop — on its own budget', async () => {
    const shopper = await visitor(fx.a);
    const responses = [];
    for (let i = 0; i < 21; i += 1) {
      responses.push(await report(shopper.token, { name: 'loop_event', value: `${i}` }));
    }
    expect(responses.slice(0, 20).map((r) => r.statusCode)).toEqual(Array(20).fill(204));
    expect(responses[20]?.statusCode).toBe(429);
    expect(responses[20]?.json()).toMatchObject({
      error: { type: 'too_many_requests', message: expect.stringMatching(/too often/i) },
    });
    // The 21st never reached the table.
    expect(await owner.visitorEvent.count({ where: { name: 'loop_event' } })).toBe(20);
  });

  // --- Defining the goal ------------------------------------------------------

  describe('defining the goal', () => {
    let writeToken: string;
    const create = (body: unknown) => server.post('/goals', body, auth(writeToken));

    beforeEach(async () => {
      writeToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:rw'],
      });
    });

    it('accepts a goal defined only by a page event, with or without a value', async () => {
      const plain = await create({
        name: 'Registered',
        definition: { custom_event: { name: 'registration_completed' } },
      });
      expect(plain.statusCode).toBe(201);
      expect((plain.json() as { definition: unknown }).definition).toEqual({
        custom_event: { name: 'registration_completed' },
      });

      const valued = await create({
        name: 'Pro',
        definition: { custom_event: { name: 'plan_chosen', value_equals: 'pro' } },
      });
      expect(valued.statusCode).toBe(201);
    });

    it.each([
      ['a badly shaped name', { custom_event: { name: 'Sign Up' } }],
      ['an empty name', { custom_event: { name: '' } }],
      ['a missing name', { custom_event: {} }],
      ['an amount', { custom_event: { name: 'paid', amount_cents: 100 } }],
      [
        'a value over 100 characters',
        { custom_event: { name: 'a', value_equals: 'v'.repeat(101) } },
      ],
    ])('refuses a goal with %s — a target nothing could reach', async (_label, definition) => {
      const response = await create({ name: 'Bad', definition });
      expect(response.statusCode).toBe(400);
      expect(await owner.goal.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('converts end to end for a goal made through the API', async () => {
      const made = await create({
        name: 'Registered',
        definition: { custom_event: { name: 'registration_completed' } },
      });
      const goalId = (made.json() as { id: string }).id;
      const shopper = await visitor(fx.a);

      await report(shopper.token, { name: 'registration_completed' });

      expect(await achievementsOf(fx.a)).toEqual([{ goalId, customerId: shopper.customerId }]);
    });
  });

  // --- The table --------------------------------------------------------------

  describe('the visitor_events table', () => {
    it('has row-level security and a tenant policy', async () => {
      const security = await owner.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'visitor_events'
      `;
      expect(security).toEqual([{ enabled: true }]);
      const policies = await owner.$queryRaw<Array<{ policyname: string }>>`
        SELECT policyname FROM pg_policies WHERE tablename = 'visitor_events'
      `;
      expect(policies).toEqual([{ policyname: 'visitor_events_tenant' }]);
    });

    it("hides another workspace's events and refuses to write into one", async () => {
      const mine = await owner.visitorEvent.create({
        data: { licenseId: fx.a.licenseId, customerId: fx.a.customerId, name: 'mine' },
        select: { id: true },
      });
      await owner.visitorEvent.create({
        data: { licenseId: fx.b.licenseId, customerId: fx.b.customerId, name: 'theirs' },
      });

      const tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
      const visible = await withTenant(app, tenant, (tx) =>
        tx.visitorEvent.findMany({ select: { id: true } }),
      );
      expect(visible.map((row) => row.id)).toEqual([mine.id]);

      await expect(
        withTenant(app, tenant, (tx) =>
          tx.visitorEvent.create({
            data: { licenseId: fx.b.licenseId, customerId: fx.b.customerId, name: 'planted' },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('refuses a name the API would refuse', async () => {
      await expect(
        owner.visitorEvent.create({
          data: { licenseId: fx.a.licenseId, customerId: fx.a.customerId, name: 'Not Valid' },
        }),
      ).rejects.toThrow(/visitor_events_name_check/i);
    });

    it('goes away with the visitor', async () => {
      await owner.visitorEvent.create({
        data: { licenseId: fx.a.licenseId, customerId: fx.a.customerId, name: 'mine' },
      });

      await owner.customer.delete({ where: { id: fx.a.customerId } });

      expect(await owner.visitorEvent.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });
  });
});
