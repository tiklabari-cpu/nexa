/**
 * Paying for the subscription (tm 382 · BL-01 · ADR-13a), end to end against
 * Postgres: the three methods, the state machine and the dunning plan.
 *
 * Stripe is a stand-in `fetch` (no network, no key) and its webhook is signed
 * here with a secret made up for the suite. The SiyahTuş team's half — the
 * root panel's, tm 389.18 — is the service functions called directly on the
 * platform connection, the way the root panel will call them.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import type { AuditContext } from '../../src/services/audit/audit-log.js';
import {
  confirmCryptoTxid,
  markSwiftPaid,
  sendCryptoAddress,
} from '../../src/services/billing/manual-payments.js';
import type { PaymentActor } from '../../src/services/billing/payment-methods.js';
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
} from '../../src/services/billing/payment-provider.js';
import { MockPaymentProvider } from '../../src/services/billing/payment-provider.js';
import { BillingDunning } from '../../src/services/billing/stripe-payments.js';
import { stripeSignatureHeader } from '../../src/services/billing/stripe-provider.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const WEBHOOK_SECRET = 'whsec_made_up_for_this_suite';
const DAY = 86_400_000;
const TRC20_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const TXID = 'b'.repeat(64);

/** The Stripe API stand-in: records every call, answers per path, can be switched off. */
class FakeStripe {
  calls: Array<{ path: string; body: URLSearchParams }> = [];
  down = false;
  #sessions = 0;

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const body = new URLSearchParams(String(init?.body ?? ''));
    this.calls.push({ path, body });
    if (this.down) return new Response(JSON.stringify({ error: {} }), { status: 500 });
    if (path === '/v1/customers') return Response.json({ id: 'cus_suite' });
    if (path === '/v1/checkout/sessions') {
      this.#sessions += 1;
      return Response.json({
        id: `cs_suite_${this.#sessions}`,
        url: `https://checkout.stripe.test/pay/cs_suite_${this.#sessions}`,
      });
    }
    return new Response(JSON.stringify({ error: { message: 'unexpected' } }), { status: 400 });
  }) as typeof fetch;

  clear(): void {
    this.calls = [];
    this.down = false;
  }
}

/** A card processor whose renewals answer from a script — the dunning job's view of Stripe. */
class ScriptedCharges implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly hostedCheckout = true;
  charges: ChargeInput[] = [];
  answers: ChargeResult[] = [];
  readonly #unused = (): never => {
    throw new Error('not used by the dunning job');
  };
  registerPaymentMethod = async () => this.#unused();
  createCustomer = async () => this.#unused();
  createCheckoutSession = async () => this.#unused();
  refund = async () => this.#unused();
  parseWebhook = () => this.#unused();

  async chargeInvoice(input: ChargeInput): Promise<ChargeResult> {
    this.charges.push(input);
    return (
      this.answers.shift() ?? { outcome: 'failed', providerRef: null, failureCode: 'card_declined' }
    );
  }
}

describe('payment methods (tm 382 · BL-01)', () => {
  let owner: PrismaClient;
  let platform: PrismaClient;
  let mockServer: TestServer;
  let stripeServer: TestServer;
  const stripe = new FakeStripe();
  let fx: Fixtures;
  let ownerToken: string;
  let agentToken: string;
  let ownerTokenB: string;

  beforeAll(async () => {
    owner = ownerClient();
    platform = platformClient();
    mockServer = await startTestServer();
    stripeServer = await startTestServer(
      {
        STRIPE_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_made_up_for_this_suite',
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      },
      { stripeFetch: stripe.fetch },
    );
  });

  afterAll(async () => {
    await owner.platformSetting.deleteMany({ where: { key: 'billing.providers' } });
    await Promise.all([mockServer.close(), stripeServer.close()]);
    await Promise.all([owner.$disconnect(), platform.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await owner.platformSetting.deleteMany({ where: { key: 'billing.providers' } });
    stripe.clear();
    await clearRateLimits(mockServer.app);
    await clearRateLimits(stripeServer.app);
    const scopes = ['billing_manage', 'reports_read', 'tags--all:rw'];
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes,
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes,
    });
    ownerTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes,
    });
  });

  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  async function showStripe(on: boolean): Promise<void> {
    await owner.platformSetting.upsert({
      where: { key: 'billing.providers' },
      create: {
        key: 'billing.providers',
        value: { swift_manual: true, crypto_manual: true, stripe: on },
      },
      update: { value: { swift_manual: true, crypto_manual: true, stripe: on } },
    });
  }

  /** The SiyahTuş team, on the root panel's connection (tm 389.18). */
  function team(licenseId: bigint): PaymentActor {
    const adminId = randomUUID();
    const audit: AuditContext = {
      licenseId,
      chainSecret: testEnv().AUDIT_CHAIN_SECRET,
      actorId: adminId,
      actorType: 'platform',
    };
    return { audit, handledBy: adminId };
  }

  function system(licenseId: bigint): PaymentActor {
    return {
      audit: {
        licenseId,
        chainSecret: testEnv().AUDIT_CHAIN_SECRET,
        actorId: null,
        actorType: 'system',
      },
    };
  }

  async function license(licenseId: bigint) {
    return owner.license.findUniqueOrThrow({ where: { id: licenseId } });
  }

  async function subscription(licenseId: bigint) {
    return owner.subscription.findFirstOrThrow({ where: { licenseId } });
  }

  async function auditActions(licenseId: bigint): Promise<string[]> {
    const rows = await owner.auditLogEntry.findMany({
      where: { licenseId, action: { startsWith: 'billing.' } },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    return rows.map((row) => row.action);
  }

  async function currentInvoiceStatus(server: TestServer, token: string): Promise<string> {
    const response = await server.get('/billing/invoices', as(token));
    return (
      response.json() as { invoices: Array<{ origin: string; status: string }> }
    ).invoices.find((invoice) => invoice.origin === 'estimate')!.status;
  }

  describe('what a workspace is offered', () => {
    it('offers bank transfer and crypto with Stripe off and the mock processor, and the term’s amount (FR-MOD-10.3)', async () => {
      const response = await mockServer.get('/billing/payment-options', as(ownerToken));
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        methods: ['swift_manual', 'crypto_manual'],
        card_form: true,
        // Two members, $99 each, one month — the same figure by every method.
        amount_due: { amount_minor: 19_800, currency: 'usd', billing_cycle: 'monthly', seats: 2 },
        swift: { bank: null, pending: null },
        state: { license_status: 'trialing', provider: null, last_failure: null },
      });
    });

    it('offers Stripe only when the platform shows it and a real processor runs', async () => {
      const methods = async (server: TestServer) =>
        (await server.get('/billing/payment-options', as(ownerToken))).json().methods;
      expect(await methods(stripeServer)).toEqual(['swift_manual', 'crypto_manual']);
      await showStripe(true);
      expect(await methods(stripeServer)).toEqual(['swift_manual', 'crypto_manual', 'stripe']);
      expect(
        (await stripeServer.get('/billing/payment-options', as(ownerToken))).json().card_form,
      ).toBe(false);
      // On the mock there is no Stripe to send anyone to, whatever the setting.
      expect(await methods(mockServer)).toEqual(['swift_manual', 'crypto_manual']);
      const refused = await mockServer.post(
        '/billing/payments/stripe/checkout',
        undefined,
        as(ownerToken),
      );
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.details).toMatchObject({ reason: 'method_unavailable' });
    });

    it('refuses a method the platform switched off, and shows the bank details it set', async () => {
      await owner.platformSetting.create({
        data: { key: 'billing.providers', value: { swift_manual: false } },
      });
      const refused = await mockServer.post('/billing/payments/swift', undefined, as(ownerToken));
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.details).toMatchObject({
        reason: 'method_unavailable',
        method: 'swift_manual',
      });

      await owner.platformSetting.upsert({
        where: { key: 'billing.swift_bank_details' },
        create: {
          key: 'billing.swift_bank_details',
          value: {
            beneficiary: 'Test Beneficiary',
            bank_name: 'Test Bank',
            iban: 'XX00TEST',
            swift_bic: 'TESTXX00',
          },
        },
        update: {},
      });
      try {
        const options = (await mockServer.get('/billing/payment-options', as(ownerToken))).json();
        expect(options.methods).toEqual(['crypto_manual']);
        expect(options.swift.bank).toMatchObject({
          beneficiary: 'Test Beneficiary',
          iban: 'XX00TEST',
        });
      } finally {
        await owner.platformSetting.deleteMany({ where: { key: 'billing.swift_bank_details' } });
      }
    });

    it('lets only the owner start a payment, and keeps workspaces apart', async () => {
      const agent = await mockServer.post('/billing/payments/swift', undefined, as(agentToken));
      expect(agent.statusCode).toBe(403);
      const crypto = await mockServer.post(
        '/billing/crypto-requests',
        { network: 'usdt_trc20', billing_name: 'Org A' },
        as(agentToken),
      );
      expect(crypto.statusCode).toBe(403);

      const mine = await mockServer.post(
        '/billing/crypto-requests',
        { network: 'usdt_trc20', billing_name: 'Org A' },
        as(ownerToken),
      );
      const id = mine.json().id as string;
      expect(
        (await mockServer.get('/billing/crypto-requests', as(ownerTokenB))).json().requests,
      ).toEqual([]);
      expect(
        (await mockServer.post(`/billing/crypto-requests/${id}/cancel`, undefined, as(ownerTokenB)))
          .statusCode,
      ).toBe(404);
      expect((await mockServer.get('/billing/payments', as(ownerTokenB))).json().payments).toEqual(
        [],
      );
    });
  });

  describe('SWIFT — the team marks the transfer paid (FR-MOD-10.2)', () => {
    it('issues one reference per term, and marking it paid activates the subscription and pays the invoice', async () => {
      const first = await mockServer.post('/billing/payments/swift', undefined, as(ownerToken));
      expect(first.statusCode).toBe(200);
      const reference = first.json().reference as string;
      expect(reference).toMatch(/^ST-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(first.json()).toMatchObject({
        amount_minor: 19_800,
        currency: 'usd',
        billing_cycle: 'monthly',
      });
      const again = await mockServer.post('/billing/payments/swift', undefined, as(ownerToken));
      expect(again.json().reference).toBe(reference);
      expect(
        (await mockServer.get('/billing/payment-options', as(ownerToken))).json().swift.pending,
      ).toMatchObject({ reference });
      expect(await currentInvoiceStatus(mockServer, ownerToken)).toBe('trial');

      const before = Date.now();
      const outcome = await platform.$transaction((tx) =>
        markSwiftPaid(tx, { licenseId: fx.a.licenseId, reference, actor: team(fx.a.licenseId) }),
      );
      expect(outcome).toMatchObject({ settled: true, activatedFrom: 'trialing' });

      expect(await license(fx.a.licenseId)).toMatchObject({ status: 'active', trialEndsAt: null });
      const sub = await subscription(fx.a.licenseId);
      expect(sub).toMatchObject({
        status: 'active',
        paymentProvider: 'swift_manual',
        pastDueSince: null,
      });
      expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(before + 27 * DAY);
      expect(await currentInvoiceStatus(mockServer, ownerToken)).toBe('paid');

      const history = (await mockServer.get('/billing/payments', as(ownerToken))).json().payments;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        reference,
        provider: 'swift_manual',
        status: 'succeeded',
        amount_minor: 19_800,
      });
      expect(history[0].term_start).not.toBeNull();
      expect(await auditActions(fx.a.licenseId)).toEqual([
        'billing.payment_started',
        'billing.license_activated',
        'billing.payment_succeeded',
      ]);

      // Marked twice: still one payment, one term.
      const twice = await platform.$transaction((tx) =>
        markSwiftPaid(tx, { licenseId: fx.a.licenseId, reference, actor: team(fx.a.licenseId) }),
      );
      expect(twice).toMatchObject({ settled: false, reason: 'already_settled' });
      expect((await subscription(fx.a.licenseId)).currentPeriodEnd).toEqual(sub.currentPeriodEnd);
      // The next term gets its own reference.
      const next = await mockServer.post('/billing/payments/swift', undefined, as(ownerToken));
      expect(next.json().reference).not.toBe(reference);
    });

    it('brings a read-only workspace back: paying is writable while read-only (ADR-10)', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(Date.now() - DAY) },
      });
      const blocked = await mockServer.post('/settings/tags', { name: 'vip' }, as(ownerToken));
      expect(blocked.statusCode).toBe(402);
      expect(blocked.json().error.type).toBe('license_expired');

      const swift = await mockServer.post('/billing/payments/swift', undefined, as(ownerToken));
      expect(swift.statusCode).toBe(200);
      await withTenant(owner, fx.a, (tx) =>
        markSwiftPaid(tx, {
          licenseId: fx.a.licenseId,
          reference: swift.json().reference,
          actor: system(fx.a.licenseId),
        }),
      );
      expect((await license(fx.a.licenseId)).status).toBe('active');
      expect(
        (await mockServer.post('/settings/tags', { name: 'vip' }, as(ownerToken))).statusCode,
      ).toBe(201);
    });

    it('refuses an unknown reference', async () => {
      await expect(
        platform.$transaction((tx) =>
          markSwiftPaid(tx, {
            licenseId: fx.a.licenseId,
            reference: 'ST-0000-0000',
            actor: team(fx.a.licenseId),
          }),
        ),
      ).rejects.toMatchObject({ type: 'not_found' });
    });
  });

  describe('crypto — "request an address", confirmed by TXID', () => {
    async function request(token = ownerToken) {
      const response = await mockServer.post(
        '/billing/crypto-requests',
        { network: 'usdt_trc20', billing_name: 'Org A Ltd', billing_details: 'VAT XX123' },
        as(token),
      );
      expect(response.statusCode).toBe(201);
      return response.json() as { id: string; status: string; wallet_address: string | null };
    }

    it('queues the request with no address, the team answers, the TXID confirms it and the subscription is active', async () => {
      const created = await request();
      expect(created).toMatchObject({
        status: 'requested',
        wallet_address: null,
        amount_minor: 19_800,
        currency: 'usd',
        billing_name: 'Org A Ltd',
      });
      // One open request at a time.
      const second = await mockServer.post(
        '/billing/crypto-requests',
        { network: 'usdt_erc20', billing_name: 'Org A Ltd' },
        as(ownerToken),
      );
      expect(second.json().error.details).toMatchObject({ reason: 'request_open' });
      // Nothing to pay to yet.
      const early = await mockServer.post(
        `/billing/crypto-requests/${created.id}/txid`,
        { txid: TXID },
        as(ownerToken),
      );
      expect(early.json().error.details).toMatchObject({ reason: 'not_awaiting_txid' });
      // The queue the team works from sees it, across workspaces (the platform connection).
      const queue = await platform.cryptoPaymentRequest.findMany({
        where: { status: 'requested' },
      });
      expect(queue.map((row) => row.id)).toEqual([created.id]);

      await platform.$transaction((tx) =>
        sendCryptoAddress(tx, {
          licenseId: fx.a.licenseId,
          requestId: created.id,
          address: TRC20_ADDRESS,
          actor: team(fx.a.licenseId),
        }),
      );
      const listed = (await mockServer.get('/billing/crypto-requests', as(ownerToken))).json()
        .requests;
      expect(listed[0]).toMatchObject({ status: 'address_sent', wallet_address: TRC20_ADDRESS });

      const invalid = await mockServer.post(
        `/billing/crypto-requests/${created.id}/txid`,
        { txid: `0x${TXID}` },
        as(ownerToken),
      );
      expect(invalid.json().error.details).toMatchObject({ reason: 'txid_invalid' });
      const submitted = await mockServer.post(
        `/billing/crypto-requests/${created.id}/txid`,
        { txid: TXID.toUpperCase() },
        as(ownerToken),
      );
      expect(submitted.statusCode).toBe(200);
      expect(submitted.json().txid).toBe(TXID);
      expect((await license(fx.a.licenseId)).status).toBe('trialing');

      const { outcome } = await platform.$transaction((tx) =>
        confirmCryptoTxid(tx, {
          licenseId: fx.a.licenseId,
          requestId: created.id,
          actor: team(fx.a.licenseId),
        }),
      );
      expect(outcome).toMatchObject({ settled: true, activatedFrom: 'trialing' });
      expect((await license(fx.a.licenseId)).status).toBe('active');
      expect(await subscription(fx.a.licenseId)).toMatchObject({
        paymentProvider: 'crypto_manual',
      });
      const payments = (await mockServer.get('/billing/payments', as(ownerToken))).json().payments;
      expect(payments).toEqual([
        expect.objectContaining({ provider: 'crypto_manual', status: 'succeeded' }),
      ]);
      const row = await owner.paymentTransaction.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(row.providerRef).toBe(TXID);
      expect(
        (await mockServer.get('/billing/crypto-requests', as(ownerToken))).json().requests[0]
          .status,
      ).toBe('paid');
    });

    it('accepts a TXID once, across workspaces', async () => {
      const a = await request();
      const b = await request(ownerTokenB);
      for (const [licenseId, id] of [
        [fx.a.licenseId, a.id],
        [fx.b.licenseId, b.id],
      ] as const) {
        await platform.$transaction((tx) =>
          sendCryptoAddress(tx, {
            licenseId,
            requestId: id,
            address: TRC20_ADDRESS,
            actor: team(licenseId),
          }),
        );
      }
      expect(
        (
          await mockServer.post(
            `/billing/crypto-requests/${a.id}/txid`,
            { txid: TXID },
            as(ownerToken),
          )
        ).statusCode,
      ).toBe(200);
      const reused = await mockServer.post(
        `/billing/crypto-requests/${b.id}/txid`,
        { txid: TXID },
        as(ownerTokenB),
      );
      expect(reused.statusCode).toBe(400);
      expect(reused.json().error.details).toMatchObject({ reason: 'txid_used' });
    });

    it('lets the owner withdraw an open request, once', async () => {
      const created = await request();
      const canceled = await mockServer.post(
        `/billing/crypto-requests/${created.id}/cancel`,
        undefined,
        as(ownerToken),
      );
      expect(canceled.json()).toMatchObject({ status: 'canceled' });
      const again = await mockServer.post(
        `/billing/crypto-requests/${created.id}/cancel`,
        undefined,
        as(ownerToken),
      );
      expect(again.json().error.details).toMatchObject({ reason: 'not_cancellable' });
      // A new one can be opened after.
      await request();
    });
  });

  describe('Stripe — hosted checkout and the signed webhook', () => {
    function signedEvent(event: Record<string, unknown>) {
      const payload = JSON.stringify(event);
      return {
        payload,
        headers: {
          'content-type': 'application/json',
          'stripe-signature': stripeSignatureHeader(
            WEBHOOK_SECRET,
            payload,
            Math.floor(Date.now() / 1000),
          ),
        },
      };
    }

    async function webhook(server: TestServer, payload: string, headers: Record<string, string>) {
      return server.app.inject({
        method: 'POST',
        url: server.url('/billing/webhooks/stripe'),
        payload,
        headers,
      });
    }

    async function checkout(): Promise<{ url: string; reference: string; transactionId: string }> {
      await showStripe(true);
      const response = await stripeServer.post(
        '/billing/payments/stripe/checkout',
        undefined,
        as(ownerToken),
      );
      expect(response.statusCode).toBe(200);
      const row = await owner.paymentTransaction.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, provider: 'stripe', status: 'pending' },
      });
      return { ...(response.json() as { url: string; reference: string }), transactionId: row.id };
    }

    const succeeded = (transactionId: string, eventId = 'evt_suite_1') => ({
      id: eventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_suite_1',
          customer: 'cus_suite',
          payment_method: 'pm_suite_1',
          metadata: { transaction_id: transactionId },
        },
      },
    });

    it('sends the browser to the processor’s page, and the webhook makes the subscription active and the invoice paid', async () => {
      const { url, reference, transactionId } = await checkout();
      expect(url).toBe('https://checkout.stripe.test/pay/cs_suite_1');
      expect(stripe.calls.map((call) => call.path)).toEqual([
        '/v1/customers',
        '/v1/checkout/sessions',
      ]);
      expect(stripe.calls[1]!.body.get('payment_intent_data[metadata][transaction_id]')).toBe(
        transactionId,
      );
      expect(stripe.calls[1]!.body.get('success_url')).toContain(`reference=${reference}`);
      expect((await subscription(fx.a.licenseId)).providerCustomerId).toBe('cus_suite');

      const { payload, headers } = signedEvent(succeeded(transactionId));
      const delivered = await webhook(stripeServer, payload, headers);
      expect(delivered.statusCode).toBe(200);
      expect(delivered.json()).toEqual({ received: true, duplicate: false });

      expect((await license(fx.a.licenseId)).status).toBe('active');
      expect(await subscription(fx.a.licenseId)).toMatchObject({
        status: 'active',
        paymentProvider: 'stripe',
        providerCustomerId: 'cus_suite',
        providerPaymentMethodId: 'pm_suite_1',
      });
      expect(await currentInvoiceStatus(stripeServer, ownerToken)).toBe('paid');
      const row = await owner.paymentTransaction.findUniqueOrThrow({
        where: { id: transactionId },
      });
      expect(row).toMatchObject({
        status: 'succeeded',
        providerEventId: 'evt_suite_1',
        providerRef: 'pi_suite_1',
      });
    });

    it('takes the same event in once: one payment record, one term, one audit entry', async () => {
      const { transactionId } = await checkout();
      const { payload, headers } = signedEvent(succeeded(transactionId));
      expect((await webhook(stripeServer, payload, headers)).json().duplicate).toBe(false);
      const periodEnd = (await subscription(fx.a.licenseId)).currentPeriodEnd;

      const again = await webhook(stripeServer, payload, headers);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ received: true, duplicate: true });
      expect(
        await owner.paymentTransaction.count({
          where: { licenseId: fx.a.licenseId, status: 'succeeded' },
        }),
      ).toBe(1);
      expect((await subscription(fx.a.licenseId)).currentPeriodEnd).toEqual(periodEnd);
      const succeededEntries = (await auditActions(fx.a.licenseId)).filter(
        (a) => a === 'billing.payment_succeeded',
      );
      expect(succeededEntries).toHaveLength(1);
      // Two deliveries at once settle once too.
      const other = await checkout();
      const twin = signedEvent(succeeded(other.transactionId, 'evt_suite_2'));
      const [x, y] = await Promise.all([
        webhook(stripeServer, twin.payload, twin.headers),
        webhook(stripeServer, twin.payload, twin.headers),
      ]);
      expect([x.json().duplicate, y.json().duplicate].sort()).toEqual([false, true]);
    });

    it('refuses an unsigned, mis-signed or stale delivery and writes nothing', async () => {
      const { transactionId } = await checkout();
      const payload = JSON.stringify(succeeded(transactionId));
      const unsigned = await webhook(stripeServer, payload, { 'content-type': 'application/json' });
      expect(unsigned.statusCode).toBe(401);
      const wrong = await webhook(stripeServer, payload, {
        'content-type': 'application/json',
        'stripe-signature': stripeSignatureHeader(
          'whsec_someone_else',
          payload,
          Math.floor(Date.now() / 1000),
        ),
      });
      expect(wrong.statusCode).toBe(401);
      const stale = await webhook(stripeServer, payload, {
        'content-type': 'application/json',
        'stripe-signature': stripeSignatureHeader(
          WEBHOOK_SECRET,
          payload,
          Math.floor(Date.now() / 1000) - 3600,
        ),
      });
      expect(stale.statusCode).toBe(401);
      const tampered = signedEvent(succeeded(transactionId));
      const changed = await webhook(
        stripeServer,
        tampered.payload.replace('pm_suite_1', 'pm_attacker'),
        tampered.headers,
      );
      expect(changed.statusCode).toBe(401);

      expect(
        (await owner.paymentTransaction.findUniqueOrThrow({ where: { id: transactionId } })).status,
      ).toBe('pending');
      expect((await license(fx.a.licenseId)).status).toBe('trialing');
      // On the mock processor there is no door at all.
      expect((await webhook(mockServer, payload, tampered.headers)).statusCode).toBe(404);
    });

    it('records a failed checkout without moving the licence, and shows it on the band', async () => {
      const { transactionId } = await checkout();
      const failed = signedEvent({
        id: 'evt_suite_fail',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_suite_f',
            metadata: { transaction_id: transactionId },
            last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
          },
        },
      });
      expect((await webhook(stripeServer, failed.payload, failed.headers)).json().duplicate).toBe(
        false,
      );
      expect((await license(fx.a.licenseId)).status).toBe('trialing');
      const state = (await stripeServer.get('/billing/payment-options', as(ownerToken))).json()
        .state;
      expect(state.last_failure).toMatchObject({ failure_code: 'insufficient_funds' });
      // The customer retries on the same page and it goes through.
      const retried = signedEvent({
        id: 'evt_suite_ok',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_suite_f',
            customer: 'cus_suite',
            payment_method: 'pm_suite_2',
            metadata: { transaction_id: transactionId },
          },
        },
      });
      expect((await webhook(stripeServer, retried.payload, retried.headers)).json().duplicate).toBe(
        false,
      );
      expect((await license(fx.a.licenseId)).status).toBe('active');
      expect(
        (await stripeServer.get('/billing/payment-options', as(ownerToken))).json().state
          .last_failure,
      ).toBeNull();
    });

    it('answers 503 when the processor is down and leaves nothing pending', async () => {
      await showStripe(true);
      stripe.down = true;
      const response = await stripeServer.post(
        '/billing/payments/stripe/checkout',
        undefined,
        as(ownerToken),
      );
      expect(response.statusCode).toBe(503);
      expect(response.json().error.details).toEqual({ reason: 'payment_provider_unavailable' });
      expect(
        await owner.paymentTransaction.count({
          where: { licenseId: fx.a.licenseId, status: 'pending' },
        }),
      ).toBe(0);
    });

    it('refuses the masked card form when a real processor runs', async () => {
      const response = await stripeServer.put(
        '/billing/payment-method',
        { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2099, holder_name: 'A Person' },
        as(ownerToken),
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().error.details).toEqual({ reason: 'hosted_checkout_required' });
      expect((await license(fx.a.licenseId)).status).toBe('trialing');
    });
  });

  describe('dunning — renew, retry on the 1st, 3rd and 7th day, then read-only (FR-MOD-10.2)', () => {
    /** A workspace paid by card whose term ran out at `endedAt`. */
    async function cardPaid(endedAt: Date): Promise<void> {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'active', trialEndsAt: null },
      });
      await owner.subscription.create({
        data: {
          licenseId: fx.a.licenseId,
          plan: 'growth',
          status: 'active',
          seats: 2,
          currentPeriodEnd: endedAt,
          paymentProvider: 'stripe',
          providerCustomerId: 'cus_suite',
          providerPaymentMethodId: 'pm_suite_1',
        },
      });
    }

    function dunning(charges: ScriptedCharges, now: Date): BillingDunning {
      return new BillingDunning({ db: owner, env: testEnv(), payments: charges, now: () => now });
    }

    async function access(): Promise<string> {
      return (await mockServer.get('/billing/subscription', as(ownerToken))).json().access;
    }

    it('goes past due on the first failure, stays writable, and turns read-only when the last retry fails', async () => {
      const t0 = new Date(Date.now() - 60_000);
      await cardPaid(t0);
      const charges = new ScriptedCharges();

      const first = await dunning(charges, t0).run();
      expect(first).toMatchObject({ tenants: 1, charged: 1, failed: 1 });
      expect(charges.charges[0]).toMatchObject({
        customerId: 'cus_suite',
        paymentMethodId: 'pm_suite_1',
        amountMinor: 19_800,
      });
      expect((await license(fx.a.licenseId)).status).toBe('past_due');
      expect((await subscription(fx.a.licenseId)).pastDueSince).toEqual(t0);
      expect(await access()).toBe('active');
      expect(
        (await mockServer.post('/settings/tags', { name: 'grace' }, as(ownerToken))).statusCode,
      ).toBe(201);
      const state = (await mockServer.get('/billing/payment-options', as(ownerToken))).json().state;
      expect(state).toMatchObject({
        license_status: 'past_due',
        provider: 'stripe',
        next_retry_at: new Date(t0.getTime() + DAY).toISOString(),
        read_only_after: new Date(t0.getTime() + 7 * DAY).toISOString(),
        last_failure: { failure_code: 'card_declined' },
      });

      // Not before the retry is due.
      expect(await dunning(charges, new Date(t0.getTime() + 12 * 3_600_000)).run()).toMatchObject({
        charged: 0,
      });
      for (const day of [1, 3]) {
        expect(await dunning(charges, new Date(t0.getTime() + day * DAY)).run()).toMatchObject({
          charged: 1,
          failed: 1,
          readOnly: 0,
        });
        expect((await license(fx.a.licenseId)).status).toBe('past_due');
      }
      expect(await dunning(charges, new Date(t0.getTime() + 7 * DAY)).run()).toMatchObject({
        charged: 1,
        failed: 1,
        readOnly: 1,
      });
      expect((await license(fx.a.licenseId)).status).toBe('read_only');
      expect(await access()).toBe('read_only');
      expect(
        (await mockServer.post('/settings/tags', { name: 'late' }, as(ownerToken))).json().error
          .type,
      ).toBe('license_expired');

      const attempts = await owner.paymentTransaction.findMany({
        where: { licenseId: fx.a.licenseId },
        orderBy: { createdAt: 'asc' },
        select: { attempt: true, status: true, kind: true },
      });
      expect(attempts).toEqual(
        [1, 2, 3, 4].map((attempt) => ({ attempt, status: 'failed', kind: 'renewal' })),
      );
      expect(
        (await auditActions(fx.a.licenseId)).filter((a) => a === 'billing.license_status_changed'),
      ).toHaveLength(2);
      // Read-only is off the job's list; nothing more is charged.
      expect(await dunning(charges, new Date(t0.getTime() + 30 * DAY)).run()).toMatchObject({
        tenants: 0,
      });
      expect(charges.charges).toHaveLength(4);
    });

    it('a retry that goes through ends the grace and pays the next term', async () => {
      const t0 = new Date(Date.now() - 60_000);
      await cardPaid(t0);
      const charges = new ScriptedCharges();
      await dunning(charges, t0).run();
      charges.answers.push({
        outcome: 'succeeded',
        providerRef: 'pi_renewal_2',
        paymentMethodId: 'pm_suite_1',
      });
      expect(await dunning(charges, new Date(t0.getTime() + DAY)).run()).toMatchObject({
        succeeded: 1,
      });
      expect((await license(fx.a.licenseId)).status).toBe('active');
      const sub = await subscription(fx.a.licenseId);
      expect(sub.pastDueSince).toBeNull();
      expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(t0.getTime() + 28 * DAY);
      expect(
        (await mockServer.get('/billing/payment-options', as(ownerToken))).json().state
          .last_failure,
      ).toBeNull();
    });

    it('renews nothing before the term ends, nothing set to end, nothing paid by hand', async () => {
      const charges = new ScriptedCharges();
      await cardPaid(new Date(Date.now() + 5 * DAY));
      expect(await dunning(charges, new Date()).run()).toMatchObject({ tenants: 0, charged: 0 });
      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { currentPeriodEnd: new Date(Date.now() - DAY), cancelAtPeriodEnd: true },
      });
      expect(await dunning(charges, new Date()).run()).toMatchObject({
        tenants: 1,
        charged: 0,
        skipped: 1,
      });
      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { cancelAtPeriodEnd: false, paymentProvider: 'swift_manual' },
      });
      expect(await dunning(charges, new Date()).run()).toMatchObject({ tenants: 0 });
      // And on the mock processor the job is a no-op whatever is due.
      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { paymentProvider: 'stripe' },
      });
      const mock = new BillingDunning({
        db: owner,
        env: testEnv(),
        payments: new MockPaymentProvider(),
      });
      expect(await mock.run()).toMatchObject({ tenants: 0, charged: 0 });
      expect(charges.charges).toHaveLength(0);
    });
  });
});
