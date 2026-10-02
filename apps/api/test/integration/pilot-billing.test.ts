/**
 * The public pilot sells nothing (tm 257.2 · ADR docs/adr/pilot-public-readiness.md
 * K-c, K-d §3.1).
 *
 * With `PILOT_MODE=true` the four billing writes — plan/seats/cycle, card, API
 * package, AI pack — and the HIPAA BAA acceptance are refused at the pilot
 * gate, and no statement charges anything: a period closes as a $0 `trial`
 * statement even on a licence the operator activated by hand (the checklist's
 * `UPDATE licenses SET status = 'active'`, owner decision K6), because nobody
 * paid for it. Nothing about money is left to the panel hiding the Billing
 * page — that is a courtesy; this file is what makes it true.
 *
 * Every refusal is checked against its twin on an ordinary deployment, where
 * the very same request reaches the handler and does what it always did — the
 * flag-off behaviour the existing billing suites pin (`reports-billing`,
 * `invoice-close`, `compliance-baa`, `sandbox`) is left to them, unchanged.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { API_PACKAGE_CATALOG } from '@siyahtus/types';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InvoiceCloseSweeper } from '../../src/services/billing/invoice-close-sweep.js';
import { previousPeriod } from '../../src/services/billing/invoice-service.js';
import { currentPeriod } from '../../src/services/billing/metering.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  seedSubscription,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** The pilot's own settings — the contact address is what production requires with it. */
const PILOT = { PILOT_MODE: 'true', PILOT_CONTACT_EMAIL: 'pilot-contact@example.test' };
const ORDINARY = { PILOT_MODE: 'false' };

type Method = NonNullable<InjectOptions['method']>;

const CARD = {
  brand: 'visa',
  last4: '4242',
  exp_month: 12,
  exp_year: 2030,
  holder_name: 'Jane Doe',
};

interface BillingWrite {
  method: Method;
  path: string;
  /** A body the handler accepts — what a purchase that would succeed looks like. */
  valid: () => Record<string, unknown>;
}

/** Every billing write the API has, as `routes/reports.ts` declares them. */
const WRITES: readonly BillingWrite[] = [
  {
    method: 'PATCH',
    path: '/billing/subscription',
    valid: () => ({ plan: 'enterprise', seats: 3 }),
  },
  { method: 'PUT', path: '/billing/payment-method', valid: () => CARD },
  {
    method: 'POST',
    path: '/billing/api-packages',
    valid: () => ({ package_id: API_PACKAGE_CATALOG[0]!.id }),
  },
  {
    method: 'POST',
    path: '/billing/ai-packages',
    valid: () => ({ packs: 1, idempotency_key: randomUUID() }),
  },
];

/** Every billing read — all of them stay open in the pilot. */
const READS = [
  '/billing/subscription',
  '/billing/usage',
  '/billing/invoices',
  `/billing/invoices/${currentPeriod()}/download`,
  '/billing/payment-method',
  '/billing/api-packages',
  '/billing/api-packages/purchases',
  '/billing/ai-packages',
  '/billing/entitlements',
] as const;

function expectPilotRefusal(response: LightMyRequestResponse): void {
  expect(response.statusCode).toBe(403);
  const { error } = response.json();
  expect(error.type).toBe('not_allowed');
  expect(error.details).toStrictEqual({ reason: 'pilot_mode' });
}

describe('pilot mode: billing purchases and the HIPAA BAA (tm 257.2)', () => {
  let owner: PrismaClient;
  /** The `siyahtus_app` role the sweep runs as in production — RLS applies. */
  let appRole: PrismaClient;
  let pilot: TestServer;
  let ordinary: TestServer;
  let fx: Fixtures;
  let token: string;

  const auth = (): Record<string, string> => ({ authorization: `Bearer ${token}` });

  const send = (
    server: TestServer,
    method: Method,
    path: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> =>
    server.app.inject({
      method,
      url: server.url(path),
      headers: auth(),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  beforeAll(async () => {
    const appUrl = process.env['DATABASE_APP_URL'];
    if (!appUrl) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: appUrl });
    [pilot, ordinary] = await Promise.all([startTestServer(PILOT), startTestServer(ORDINARY)]);
  });

  afterAll(async () => {
    await Promise.all([pilot.close(), ordinary.close()]);
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await Promise.all([clearRateLimits(pilot.app), clearRateLimits(ordinary.app)]);
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'reports_read', 'billing_manage'],
    });
  });

  /** Everything a billing write could have changed, for a before/after comparison. */
  async function billingState(licenseId: bigint) {
    const [subscriptions, paymentMethods, apiPurchases, aiPurchases, license, audit] =
      await Promise.all([
        owner.subscription.findMany({ where: { licenseId } }),
        owner.paymentMethod.findMany({ where: { licenseId } }),
        owner.apiPackagePurchase.findMany({ where: { licenseId } }),
        owner.aiPackagePurchase.findMany({ where: { licenseId } }),
        owner.license.findUniqueOrThrow({
          where: { id: licenseId },
          select: { status: true, trialEndsAt: true, hipaaBaaSignedAt: true },
        }),
        owner.auditLogEntry.findMany({ where: { licenseId }, select: { action: true } }),
      ]);
    return { subscriptions, paymentMethods, apiPurchases, aiPurchases, license, audit };
  }

  /** The checklist's hand activation (K6): the licence leaves the trial, nothing else changes. */
  async function activateByHand(licenseId: bigint): Promise<void> {
    await owner.$executeRaw`
      UPDATE licenses SET status = 'active', trial_ends_at = NULL
       WHERE id = ${licenseId} AND status IN ('trialing', 'read_only')`;
  }

  /** AI resolutions past the allowance in `period` — evidence and an overage, together. */
  async function meterOverage(licenseId: bigint, period: string): Promise<void> {
    await owner.usageRecord.create({
      data: {
        licenseId,
        metric: 'ai_resolutions',
        period,
        quantity: 260n,
        included: 200n,
        overageUnit: 50,
        overageUnitPriceCents: 50,
      },
    });
  }

  describe('the four billing writes', () => {
    it('refuses each one with an empty body — 403 pilot_mode, and nothing is written', async () => {
      const before = await billingState(fx.a.licenseId);
      for (const write of WRITES) {
        expectPilotRefusal(await send(pilot, write.method, write.path, {}));
      }
      expect(await billingState(fx.a.licenseId)).toStrictEqual(before);
    });

    it('refuses a well-formed purchase too, which the ordinary deployment would have made', async () => {
      const before = await billingState(fx.a.licenseId);
      for (const write of WRITES) {
        expectPilotRefusal(await send(pilot, write.method, write.path, write.valid()));
      }
      expect(await billingState(fx.a.licenseId)).toStrictEqual(before);
      expect(before.subscriptions).toEqual([]);
    });

    it('refuses before the body is read: malformed JSON gets the 403, not a 400', async () => {
      for (const write of WRITES) {
        const response = await pilot.app.inject({
          method: write.method,
          url: pilot.url(write.path),
          headers: { ...auth(), 'content-type': 'application/json' },
          payload: '{"broken',
        });
        expectPilotRefusal(response);
      }
    });

    it('refuses a percent-encoded path — the route is matched, not the URL the caller typed', async () => {
      const before = await billingState(fx.a.licenseId);
      const response = await pilot.app.inject({
        method: 'PATCH',
        url: '/api/v1/%62illing/subscription',
        headers: auth(),
        payload: { seats: 3 },
      });
      expectPilotRefusal(response);
      expect(await billingState(fx.a.licenseId)).toStrictEqual(before);
    });

    it('keeps every billing read open, HEAD included', async () => {
      for (const path of READS) {
        const response = await send(pilot, 'GET', path);
        expect(response.statusCode, path).toBe(200);
      }
      const head = await send(pilot, 'HEAD', '/billing/subscription');
      expect(head.statusCode).toBe(200);
    });

    it('leaves an expired trial read-only: a plan and a card cannot buy it back', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - 86_400_000) },
      });
      const write = () => pilot.post('/chats', { customer_id: fx.a.customerId }, auth());
      expect((await write()).statusCode).toBe(402);
      const before = await billingState(fx.a.licenseId);

      expectPilotRefusal(await send(pilot, 'PATCH', '/billing/subscription', { seats: 2 }));
      expectPilotRefusal(await send(pilot, 'PUT', '/billing/payment-method', CARD));
      // And in the other order, which is the other half of tm 256.1's checkout.
      expectPilotRefusal(await send(pilot, 'PUT', '/billing/payment-method', CARD));
      expectPilotRefusal(await send(pilot, 'PATCH', '/billing/subscription', { seats: 2 }));

      expect((await write()).statusCode).toBe(402);
      expect((await pilot.get('/billing/subscription', auth())).json().access).toBe('read_only');
      const after = await billingState(fx.a.licenseId);
      expect(after).toStrictEqual(before);
      expect(after.audit.map((entry) => entry.action)).not.toContain('billing.license_activated');
    });

    describe('on an ordinary deployment (PILOT_MODE=false)', () => {
      it('reaches every handler: an empty body is that handler’s own 400', async () => {
        for (const write of WRITES) {
          const response = await send(ordinary, write.method, write.path, {});
          expect(response.statusCode, write.path).toBe(400);
          expect(response.json().error.type).toBe('validation');
        }
      });

      it('makes each well-formed purchase', async () => {
        for (const write of WRITES) {
          const response = await send(ordinary, write.method, write.path, write.valid());
          expect(response.statusCode, write.path).toBe(200);
        }
        const after = await billingState(fx.a.licenseId);
        expect(after.subscriptions).toHaveLength(1);
        expect(after.paymentMethods).toHaveLength(1);
        expect(after.apiPurchases).toHaveLength(1);
        expect(after.aiPurchases).toHaveLength(1);
        // Plan and card together are a purchase: the licence left the trial.
        expect(after.license.status).toBe('active');
      });

      it('routes the percent-encoded path to the billing handler — which is why the gate reads the route', async () => {
        const response = await ordinary.app.inject({
          method: 'PATCH',
          url: '/api/v1/%62illing/subscription',
          headers: auth(),
          payload: { seats: 3 },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().seats).toBe(3);
      });
    });
  });

  describe('what a pilot workspace owes', () => {
    const open = currentPeriod();
    const justClosed = previousPeriod(open);

    it('quotes nothing owed on a licence activated by hand, overage and all', async () => {
      await activateByHand(fx.a.licenseId);
      await meterOverage(fx.a.licenseId, open);

      const view = (await pilot.get('/billing/subscription', auth())).json();
      expect(view.access).toBe('active');
      expect(view.usage.ai_resolutions.overage).toBe(60);
      expect(view.estimated_total_cents).toBe(0);
      expect(view.annual_savings_cents).toBe(0);

      const twin = (await ordinary.get('/billing/subscription', auth())).json();
      expect(twin.estimated_total_cents).toBeGreaterThan(0);
    });

    it('quotes no annual saving on an annual plan either', async () => {
      await activateByHand(fx.a.licenseId);
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { billingCycle: 'annual', unitPriceCents: 9_900 },
      });

      const view = (await pilot.get('/billing/subscription', auth())).json();
      expect(view.billing_cycle).toBe('annual');
      expect(view.estimated_total_cents).toBe(0);
      expect(view.annual_savings_cents).toBe(0);

      const twin = (await ordinary.get('/billing/subscription', auth())).json();
      expect(twin.estimated_total_cents).toBeGreaterThan(0);
      expect(twin.annual_savings_cents).toBeGreaterThan(0);
    });

    it('shows the open period as a $0 trial estimate with one line', async () => {
      await activateByHand(fx.a.licenseId);
      await meterOverage(fx.a.licenseId, open);

      const [estimate] = (await pilot.get('/billing/invoices', auth())).json().invoices;
      expect(estimate.origin).toBe('estimate');
      expect(estimate.status).toBe('trial');
      expect(estimate.total_cents).toBe(0);
      expect(estimate.line_items).toStrictEqual([
        { description: 'growth plan — free during the pilot', amount_cents: 0 },
      ]);

      const [twin] = (await ordinary.get('/billing/invoices', auth())).json().invoices;
      expect(twin.status).toBe('open');
      expect(twin.total_cents).toBeGreaterThan(0);
    });

    it('closes a hand-activated period as a $0 trial statement with no overage line', async () => {
      await activateByHand(fx.a.licenseId);
      await meterOverage(fx.a.licenseId, justClosed);

      await new InvoiceCloseSweeper(appRole, testEnv(PILOT)).run();

      const invoice = await owner.invoice.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, period: justClosed },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
      expect(invoice.status).toBe('trial');
      expect(invoice.totalCents).toBe(0);
      expect(invoice.subtotalCents).toBe(0);
      expect(
        invoice.lineItems.map(({ description, amountCents }) => ({ description, amountCents })),
      ).toStrictEqual([{ description: 'growth plan — free during the pilot', amountCents: 0 }]);

      // And the list serves it as it was frozen.
      const listed = (await pilot.get('/billing/invoices', auth()))
        .json()
        .invoices.find((i: { period: string }) => i.period === justClosed);
      expect(listed.status).toBe('trial');
      expect(listed.total_cents).toBe(0);
    });

    it('closes the same period as a paid statement on an ordinary deployment', async () => {
      await activateByHand(fx.a.licenseId);
      await meterOverage(fx.a.licenseId, justClosed);

      await new InvoiceCloseSweeper(appRole, testEnv(ORDINARY)).run();

      const invoice = await owner.invoice.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, period: justClosed },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
      expect(invoice.status).toBe('paid');
      expect(invoice.totalCents).toBeGreaterThan(0);
      expect(invoice.lineItems.map((item) => item.description)).toContainEqual(
        expect.stringMatching(/^AI resolutions overage/),
      );
    });
  });

  describe('the HIPAA BAA', () => {
    let pilotUs: TestServer;
    let ordinaryUs: TestServer;
    let us: { licenseId: bigint; token: string };

    beforeAll(async () => {
      [pilotUs, ordinaryUs] = await Promise.all([
        startTestServer({ ...PILOT, SIYAHTUS_REGION: 'us' }),
        startTestServer({ ...ORDINARY, SIYAHTUS_REGION: 'us' }),
      ]);
    });

    afterAll(async () => {
      await Promise.all([pilotUs.close(), ordinaryUs.close()]);
    });

    beforeEach(async () => {
      await Promise.all([clearRateLimits(pilotUs.app), clearRateLimits(ordinaryUs.app)]);
      // A US workspace on Enterprise — everything the route asks for besides
      // the pilot: the plan, the region and the owner (compliance-baa.test.ts).
      const organization = await owner.organization.create({
        data: { name: 'Org US pilot', region: 'us' },
        select: { id: true },
      });
      const license = await owner.license.create({
        data: { organizationId: organization.id, plan: 'enterprise', status: 'active' },
        select: { id: true },
      });
      await seedSubscription(owner, license.id, 'enterprise');
      const account = await owner.account.create({
        data: { email: 'owner-us-pilot@example.test', name: 'Owner US' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: license.id, agentId: account.id, role: 'owner' },
      });
      us = {
        licenseId: license.id,
        token: await grantToken(owner, {
          licenseId: license.id,
          organizationId: organization.id,
          ownerId: account.id,
          scopes: ['access_rules:ro', 'access_rules:rw'],
        }),
      };
    });

    const accept = (server: TestServer) =>
      server.post(
        '/settings/compliance/baa',
        { accepted: true },
        { authorization: `Bearer ${us.token}` },
      );

    it('refuses the acceptance: 403 pilot_mode, no signature and no audit entry', async () => {
      expectPilotRefusal(await accept(pilotUs));

      const license = await owner.license.findUniqueOrThrow({ where: { id: us.licenseId } });
      expect(license.hipaaBaaSignedAt).toBeNull();
      expect(
        await owner.auditLogEntry.count({
          where: { licenseId: us.licenseId, action: 'compliance.baa_signed' },
        }),
      ).toBe(0);
      // The read stays open: the screen can still say there is no agreement.
      const read = await pilotUs.get('/settings/compliance', {
        authorization: `Bearer ${us.token}`,
      });
      expect(read.statusCode).toBe(200);
    });

    it('records it on an ordinary deployment', async () => {
      expect((await accept(ordinaryUs)).statusCode).toBe(200);
      const license = await owner.license.findUniqueOrThrow({ where: { id: us.licenseId } });
      expect(license.hipaaBaaSignedAt).not.toBeNull();
    });
  });
});
