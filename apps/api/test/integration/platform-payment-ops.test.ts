/**
 * The root panel's payment operations (tm 389.18 · FR-ADMIN-14 ·
 * docs/platform-admin/design.md §C billing · PLAN §D218).
 *
 * Driven through the platform API and judged from the tenant's side of the
 * same database — the tenant API the owner pays from:
 *
 *   1. The crypto queue: the team sends the address (the owner sees it on the
 *      request and is mailed that it is waiting, without it), confirms the
 *      TXID → the request `paid`, the subscription `active`, the term paid; a
 *      TXID is accepted once across workspaces (409); a refusal closes it.
 *   2. Bank transfers: marking a reference paid gives the same result — #382's
 *      "SWIFT elle ödendi işareti aynı sonucu üretir", from the panel's end.
 *   3. The settings the tenant API reads: a method switched off is gone from
 *      the workspace's screen and refused; the bank account is what the SWIFT
 *      screen shows; the issuer is on the next statement, and a statement
 *      already issued keeps its PDF byte for byte.
 *   4. A refund approved as a credit, at most the statement it answers for.
 *
 * `support` reads and cannot act (decision 5); every action is in both audit
 * trails and the address is masked in the platform's. FR-ADMIN codes are not
 * Ek A catalogue IDs, so no title carries one as a requirement tag.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformRole } from '@siyahtus/types';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { InvoiceCloseSweeper } from '../../src/services/billing/invoice-close-sweep.js';
import { previousPeriod } from '../../src/services/billing/invoice-service.js';
import { currentPeriod } from '../../src/services/billing/metering.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; details?: Record<string, unknown> } };

const REASON = 'Matched on the bank statement';
const TRC20_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
const ERC20_ADDRESS = `0x${'ab'.repeat(20)}`;
const TXID = 'c'.repeat(64);
const BILLING_KEYS = ['billing.providers', 'billing.swift_bank_details', 'billing.issuer_profile'];
/** Made-up account details: the shape of an IBAN and a BIC, nobody's account. */
const BANK = {
  beneficiary: 'Example Beneficiary Ltd',
  bank_name: 'Example Test Bank',
  iban: 'xx00 test 0000 0000 0001',
  swift_bic: 'exmpxx00',
  bank_address: '1 Example Street',
};
const APP_URL = process.env['DATABASE_APP_URL'];

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform payment operations (tm 389.18)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let stripeTenant: TestServer;
  let db: PrismaClient;
  let appRole: PrismaClient;
  let clock: TestClock;
  let mailer: MemoryMailer;
  let storageDir: string;
  let fx: Fixtures;
  const tokens = new Map<PlatformRole, string>();
  let ownerA: string;
  let ownerB: string;

  const call = (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    role: PlatformRole = 'billing',
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method,
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
      ...(body === undefined ? {} : { payload: body as object }),
    });
  const ok = async <T = Record<string, any>>(
    response: Promise<LightMyRequestResponse>,
    status = 200,
  ): Promise<T> => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(status);
    return settled.json() as T;
  };
  const refused = async (
    response: Promise<LightMyRequestResponse>,
    status: number,
    type: string,
    detailsReason?: string,
  ) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(status);
    const body = settled.json() as ErrorBody;
    expect(body.error.type).toBe(type);
    if (detailsReason !== undefined) expect(body.error.details?.['reason']).toBe(detailsReason);
  };
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  /** Both halves of the double entry for one action on one workspace. */
  async function expectDoubleEntry(licenseId: bigint, action: string) {
    const [platformRows, tenantRows] = await Promise.all([
      owner.platformAuditLog.findMany({ where: { licenseId, action } }),
      owner.auditLogEntry.findMany({
        where: { licenseId, actorType: 'platform', action: `platform.${action.replace('.', '_')}` },
      }),
    ]);
    expect(platformRows, action).toHaveLength(1);
    expect(platformRows[0]!.reason).toBe(REASON);
    expect(tenantRows, action).toHaveLength(1);
    expect(JSON.stringify(tenantRows[0]!.metadata)).not.toContain(REASON);
    return platformRows[0]!;
  }

  async function cryptoRequest(token: string, network = 'usdt_trc20') {
    const response = await tenant.post(
      '/billing/crypto-requests',
      { network, billing_name: 'Org Ltd' },
      as(token),
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string };
  }

  const sendAddress = (id: string, address = TRC20_ADDRESS, network = 'usdt_trc20') =>
    call('POST', `/billing/payment-requests/${id}/send-address`, {
      network,
      address,
      reason: REASON,
    });

  /** A metered month, so the period close has a statement to issue. */
  async function meter(licenseId: bigint, period: string): Promise<void> {
    await owner.usageRecord.create({
      data: {
        licenseId,
        metric: 'ai_resolutions',
        period,
        quantity: 10n,
        included: 200n,
        overageUnit: 1,
        overageUnitPriceCents: 50,
      },
    });
  }

  async function estimateStatus(token: string): Promise<string> {
    const response = await tenant.get('/billing/invoices', as(token));
    return (
      response.json() as { invoices: Array<{ origin: string; status: string }> }
    ).invoices.find((invoice) => invoice.origin === 'estimate')!.status;
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    storageDir = mkdtempSync(join(tmpdir(), 'siyahtus-payment-ops-'));
    db = platformClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    clock = new TestClock(Date.now());
    mailer = new MemoryMailer();
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000', STORAGE_LOCAL_DIR: storageDir },
      { now: clock.read, mailer },
    );
    tenant = await startTestServer({ STORAGE_LOCAL_DIR: storageDir });
    // A tenant API with a real card processor configured — never called: the
    // checkout is refused before Stripe would be.
    stripeTenant = await startTestServer(
      {
        STRIPE_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_made_up_for_this_suite',
        STRIPE_WEBHOOK_SECRET: 'whsec_made_up_for_this_suite',
      },
      {
        stripeFetch: (async () => {
          throw new Error('no Stripe call expected');
        }) as typeof fetch,
      },
    );
  });

  afterAll(async () => {
    await owner.platformSetting.deleteMany({ where: { key: { in: BILLING_KEYS } } });
    await Promise.all([platform?.close(), tenant?.close(), stripeTenant?.close()]);
    await Promise.all([db?.$disconnect(), appRole?.$disconnect()]);
    rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    clock.now = Date.now();
    fx = await seedFixtures(owner);
    await owner.platformSetting.deleteMany({ where: { key: { in: BILLING_KEYS } } });
    await Promise.all([
      clearRateLimits(tenant.app),
      clearRateLimits(stripeTenant.app),
      clearRateLimits(platform.app),
    ]);
    mailer.clear();
    tokens.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
    const scopes = ['billing_manage', 'reports_read'];
    ownerA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes,
    });
    ownerB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes,
    });
  });

  describe('the crypto queue', () => {
    it('sends the address to the request, the owner sees it, and the TXID confirms the payment', async () => {
      const created = await cryptoRequest(ownerA);

      // The queue, across workspaces; support reads it and cannot answer it.
      const queue = await ok<{ data: Array<Record<string, unknown>> }>(
        call('GET', '/billing/payment-requests', undefined, 'support'),
      );
      expect(queue.data).toEqual([
        expect.objectContaining({
          id: created.id,
          license_id: fx.a.licenseId.toString(),
          status: 'requested',
          network: 'usdt_trc20',
          amount_minor: 19_800,
          currency: 'USD',
          wallet_address: null,
        }),
      ]);
      await refused(
        call(
          'POST',
          `/billing/payment-requests/${created.id}/send-address`,
          { network: 'usdt_trc20', address: TRC20_ADDRESS, reason: REASON },
          'support',
        ),
        403,
        'authorization',
      );
      // The address must be one on the request's own network.
      await refused(
        sendAddress(created.id, ERC20_ADDRESS, 'usdt_erc20'),
        400,
        'validation',
        'network_mismatch',
      );
      await refused(sendAddress(created.id, ERC20_ADDRESS), 400, 'validation', 'address_invalid');

      const sent = await ok<{ request: Record<string, unknown> }>(sendAddress(created.id));
      expect(sent.request).toMatchObject({
        status: 'address_sent',
        wallet_address: TRC20_ADDRESS,
        handled_by_email: expect.any(String),
      });
      const listed = (await tenant.get('/billing/crypto-requests', as(ownerA))).json().requests;
      expect(listed[0]).toMatchObject({ status: 'address_sent', wallet_address: TRC20_ADDRESS });
      // Workspace B sees nothing of it.
      expect((await tenant.get('/billing/crypto-requests', as(ownerB))).json().requests).toEqual(
        [],
      );

      // The owner is told the address is waiting — not what it is.
      const mails = mailer.sent.filter((mail) => mail.to === fx.a.ownerEmail);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.subject).toContain('payment address');
      expect(`${mails[0]!.body}${mails[0]!.html ?? ''}`).not.toContain(TRC20_ADDRESS);

      // Masked in the platform chain; both trails carry the action.
      const entry = await expectDoubleEntry(fx.a.licenseId, 'billing.payment_address_sent');
      expect(entry.payload).toMatchObject({ address_masked: 'T9yD14…uWwb', network: 'usdt_trc20' });
      expect(JSON.stringify(entry.payload)).not.toContain(TRC20_ADDRESS);

      expect(
        (
          await tenant.post(
            `/billing/crypto-requests/${created.id}/txid`,
            { txid: TXID },
            as(ownerA),
          )
        ).statusCode,
      ).toBe(200);
      expect(await estimateStatus(ownerA)).toBe('trial');
      await refused(
        call('POST', `/billing/payment-requests/${created.id}/confirm-txid`, {
          txid: 'd'.repeat(64),
          reason: REASON,
        }),
        400,
        'validation',
        'txid_mismatch',
      );

      const confirmed = await ok<{ request: Record<string, unknown> }>(
        call('POST', `/billing/payment-requests/${created.id}/confirm-txid`, {
          txid: TXID.toUpperCase(),
          reason: REASON,
        }),
      );
      expect(confirmed.request).toMatchObject({ status: 'paid', txid: TXID });
      const license = await owner.license.findUniqueOrThrow({ where: { id: fx.a.licenseId } });
      expect(license.status).toBe('active');
      const subscription = await owner.subscription.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(subscription).toMatchObject({ status: 'active', paymentProvider: 'crypto_manual' });
      expect(await estimateStatus(ownerA)).toBe('paid');
      expect(
        (await tenant.get('/billing/crypto-requests', as(ownerA))).json().requests[0].status,
      ).toBe('paid');
      await expectDoubleEntry(fx.a.licenseId, 'billing.payment_confirmed');
      // The shared payment code wrote its own entries under the operator.
      expect(
        await owner.auditLogEntry.count({
          where: {
            licenseId: fx.a.licenseId,
            actorType: 'platform',
            action: { in: ['billing.license_activated', 'billing.payment_succeeded'] },
          },
        }),
      ).toBe(2);

      // Paid is paid.
      await refused(
        call('POST', `/billing/payment-requests/${created.id}/confirm-txid`, {
          txid: TXID,
          reason: REASON,
        }),
        409,
        'platform_payment_state',
        'not_awaiting_confirmation',
      );
      expect(
        (await ok<{ data: unknown[] }>(call('GET', '/billing/payment-requests'))).data,
      ).toEqual([]);
      expect(
        (await ok<{ data: unknown[] }>(call('GET', '/billing/payment-requests?state=paid'))).data,
      ).toHaveLength(1);
    });

    it('accepts a TXID once: the same TXID on a second workspace’s request is 409', async () => {
      const a = await cryptoRequest(ownerA);
      const b = await cryptoRequest(ownerB);
      await ok(sendAddress(a.id));
      await ok(sendAddress(b.id));
      await tenant.post(`/billing/crypto-requests/${a.id}/txid`, { txid: TXID }, as(ownerA));
      await ok(
        call('POST', `/billing/payment-requests/${a.id}/confirm-txid`, {
          txid: TXID,
          reason: REASON,
        }),
      );

      // B's owner never wrote one; the operator types A's by mistake.
      await refused(
        call('POST', `/billing/payment-requests/${b.id}/confirm-txid`, {
          txid: TXID,
          reason: REASON,
        }),
        409,
        'platform_payment_state',
        'txid_used',
      );
      const rowB = await owner.cryptoPaymentRequest.findUniqueOrThrow({ where: { id: b.id } });
      expect(rowB).toMatchObject({ status: 'address_sent', txid: null });
      expect(
        (await owner.license.findUniqueOrThrow({ where: { id: fx.b.licenseId } })).status,
      ).toBe('trialing');

      // A TXID the operator found for B, with no owner TXID on it, confirms it.
      const other = 'e'.repeat(64);
      const confirmed = await ok<{ request: Record<string, unknown> }>(
        call('POST', `/billing/payment-requests/${b.id}/confirm-txid`, {
          txid: other,
          reason: REASON,
        }),
      );
      expect(confirmed.request).toMatchObject({ status: 'paid', txid: other });
    });

    it('refuses an open request with its reason, and not a closed one', async () => {
      const created = await cryptoRequest(ownerA);
      const rejected = await ok<{ request: Record<string, unknown> }>(
        call('POST', `/billing/payment-requests/${created.id}/cancel`, { reason: REASON }),
      );
      expect(rejected.request).toMatchObject({ status: 'rejected', closed_reason: REASON });
      expect(
        (await tenant.get('/billing/crypto-requests', as(ownerA))).json().requests[0],
      ).toMatchObject({ status: 'rejected', closed_reason: REASON });
      await expectDoubleEntry(fx.a.licenseId, 'billing.payment_request_cancelled');
      await refused(
        call('POST', `/billing/payment-requests/${created.id}/cancel`, { reason: REASON }),
        409,
        'platform_payment_state',
        'not_cancellable',
      );
      await refused(sendAddress(created.id), 409, 'platform_payment_state', 'not_awaiting_address');
      await refused(
        call('POST', '/billing/payment-requests/00000000-0000-4000-8000-000000000000/cancel', {
          reason: REASON,
        }),
        404,
        'not_found',
      );
      // No reason, no action.
      await refused(
        call('POST', `/billing/payment-requests/${created.id}/cancel`, {}),
        400,
        'platform_reason_required',
      );
    });
  });

  describe('bank transfers', () => {
    it('marking the reference paid gives the same result as a card: active, the term paid', async () => {
      const issued = await tenant.post('/billing/payments/swift', undefined, as(ownerA));
      expect(issued.statusCode).toBe(200);
      const reference = issued.json().reference as string;

      const pending = await ok<{ data: Array<Record<string, unknown>> }>(
        call('GET', '/billing/swift-payments', undefined, 'support'),
      );
      expect(pending.data).toEqual([
        expect.objectContaining({
          reference,
          status: 'pending',
          amount_minor: 19_800,
          license_id: fx.a.licenseId.toString(),
        }),
      ]);
      const id = pending.data[0]!['id'] as string;
      await refused(
        call(
          'POST',
          `/billing/swift-payments/${id}/mark-paid`,
          { reference, reason: REASON },
          'support',
        ),
        403,
        'authorization',
      );
      await refused(
        call('POST', `/billing/swift-payments/${id}/mark-paid`, {
          reference: 'ST-0000-0000',
          reason: REASON,
        }),
        400,
        'validation',
        'reference_mismatch',
      );

      // A method switched off after the reference was issued does not take it back.
      await ok(
        call('PUT', '/billing/providers', {
          swift_manual: false,
          crypto_manual: true,
          stripe: false,
          reason: REASON,
        }),
      );
      const paid = await ok<{ payment: Record<string, unknown> }>(
        call('POST', `/billing/swift-payments/${id}/mark-paid`, {
          reference: reference.toLowerCase(),
          reason: REASON,
        }),
      );
      expect(paid.payment).toMatchObject({
        status: 'succeeded',
        handled_by_email: expect.any(String),
      });
      expect(
        (await owner.license.findUniqueOrThrow({ where: { id: fx.a.licenseId } })).status,
      ).toBe('active');
      expect(
        await owner.subscription.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } }),
      ).toMatchObject({ status: 'active', paymentProvider: 'swift_manual' });
      expect(await estimateStatus(ownerA)).toBe('paid');
      const history = (await tenant.get('/billing/payments', as(ownerA))).json().payments;
      expect(history).toEqual([
        expect.objectContaining({ reference, provider: 'swift_manual', status: 'succeeded' }),
      ]);
      const entry = await expectDoubleEntry(fx.a.licenseId, 'billing.swift_marked_paid');
      expect(entry.payload).toMatchObject({ reference, amount_minor: 19_800 });

      await refused(
        call('POST', `/billing/swift-payments/${id}/mark-paid`, { reference, reason: REASON }),
        409,
        'platform_payment_state',
        'already_settled',
      );
      expect((await ok<{ data: unknown[] }>(call('GET', '/billing/swift-payments'))).data).toEqual(
        [],
      );
    });
  });

  describe('the settings the tenant API reads', () => {
    it('hides a method switched off from every workspace and refuses its payments', async () => {
      expect(await ok(call('GET', '/billing/providers', undefined, 'support'))).toEqual({
        providers: { swift_manual: true, crypto_manual: true, stripe: false },
        stored: false,
        stripe_card_ready: false,
        updated_at: null,
      });
      const methods = async (server: TestServer) =>
        (await server.get('/billing/payment-options', as(ownerA))).json().methods;

      await ok(
        call('PUT', '/billing/providers', {
          swift_manual: true,
          crypto_manual: true,
          stripe: true,
          reason: REASON,
        }),
      );
      expect(await methods(stripeTenant)).toEqual(['swift_manual', 'crypto_manual', 'stripe']);

      const off = await ok<Record<string, unknown>>(
        call('PUT', '/billing/providers', {
          swift_manual: false,
          crypto_manual: true,
          stripe: false,
          reason: REASON,
        }),
      );
      expect(off).toMatchObject({
        providers: { swift_manual: false, crypto_manual: true, stripe: false },
        stored: true,
      });
      expect(await methods(stripeTenant)).toEqual(['crypto_manual']);
      expect(await methods(tenant)).toEqual(['crypto_manual']);
      const card = await stripeTenant.post(
        '/billing/payments/stripe/checkout',
        undefined,
        as(ownerA),
      );
      expect(card.statusCode).toBe(400);
      expect(card.json().error.details).toMatchObject({
        reason: 'method_unavailable',
        method: 'stripe',
      });
      const swift = await tenant.post('/billing/payments/swift', undefined, as(ownerA));
      expect(swift.json().error.details).toMatchObject({ reason: 'method_unavailable' });

      // Each save is one platform entry naming what changed; the same save again records nothing.
      const entries = await owner.platformAuditLog.findMany({
        where: { action: 'billing.providers_updated' },
        orderBy: { chainSeq: 'asc' },
      });
      expect(entries.map((row) => (row.payload as { changed: string[] }).changed)).toEqual([
        ['stripe'],
        ['swift_manual', 'stripe'],
      ]);
      await ok(
        call('PUT', '/billing/providers', {
          swift_manual: false,
          crypto_manual: true,
          stripe: false,
          reason: REASON,
        }),
      );
      expect(
        await owner.platformAuditLog.count({ where: { action: 'billing.providers_updated' } }),
      ).toBe(2);
      await refused(
        call(
          'PUT',
          '/billing/providers',
          { swift_manual: true, crypto_manual: true, stripe: false, reason: REASON },
          'support',
        ),
        403,
        'authorization',
      );
    });

    it('puts the bank account on the workspaces’ SWIFT screen, its values kept out of the audit', async () => {
      expect(await ok(call('GET', '/billing/bank-details'))).toEqual({
        details: null,
        updated_at: null,
      });
      await refused(
        call('PUT', '/billing/bank-details', { ...BANK, iban: 'not an iban', reason: REASON }),
        400,
        'validation',
        'iban_invalid',
      );
      await refused(
        call('PUT', '/billing/bank-details', { ...BANK, swift_bic: 'BIC', reason: REASON }),
        400,
        'validation',
        'swift_bic_invalid',
      );
      const saved = await ok<{ details: Record<string, unknown> }>(
        call('PUT', '/billing/bank-details', { ...BANK, reason: REASON }),
      );
      const stored = {
        beneficiary: BANK.beneficiary,
        bank_name: BANK.bank_name,
        iban: 'XX00TEST000000000001',
        swift_bic: 'EXMPXX00',
        bank_address: BANK.bank_address,
      };
      expect(saved.details).toEqual(stored);

      const options = (await tenant.get('/billing/payment-options', as(ownerA))).json();
      expect(options.swift.bank).toEqual(stored);

      const [entry] = await owner.platformAuditLog.findMany({
        where: { action: 'billing.bank_details_updated' },
      });
      expect(entry!.licenseId).toBeNull();
      expect((entry!.payload as { changed: string[] }).changed.sort()).toEqual(
        ['bank_address', 'bank_name', 'beneficiary', 'iban', 'swift_bic'].sort(),
      );
      expect(JSON.stringify(entry!.payload)).not.toContain(stored.iban);
    });

    it('issues the next statement under the new issuer, and an issued statement keeps its PDF', async () => {
      const justClosed = previousPeriod(currentPeriod());
      const sweeper = () =>
        new InvoiceCloseSweeper(appRole, testEnv({ STORAGE_LOCAL_DIR: storageDir }));
      async function issueFor(t: 'a' | 'b') {
        await owner.license.update({
          where: { id: fx[t].licenseId },
          data: { status: 'active', trialEndsAt: null },
        });
        await owner.subscription.create({
          data: { licenseId: fx[t].licenseId, status: 'active', seats: 3, unitPriceCents: 9_900 },
        });
        await meter(fx[t].licenseId, justClosed);
        await sweeper().run();
        return owner.invoice.findFirstOrThrow({
          where: { licenseId: fx[t].licenseId, period: justClosed },
        });
      }
      const issuer = (name: string) => ({
        legal_name: name,
        address_lines: ['1 Example Street', '34000 İstanbul'],
        country: 'tr',
        tax_office: 'Example',
        tax_id: '1234567890',
        email: 'billing@example.com',
        reason: REASON,
      });

      const first = await ok<{ profile: Record<string, unknown> }>(
        call('PUT', '/billing/issuer-profile', issuer('Örnek Yazılım A.Ş.')),
      );
      expect(first.profile).toMatchObject({
        legal_name: 'Örnek Yazılım A.Ş.',
        country: 'TR',
        address_lines: ['1 Example Street', '34000 İstanbul'],
        vat_id: null,
      });
      const invoiceA = await issueFor('a');
      expect(invoiceA.sellerSnapshot).toMatchObject({ legal_name: 'Örnek Yazılım A.Ş.' });

      const listed = await ok<{ data: Array<{ id: string; pdf_available: boolean }> }>(
        call('GET', `/billing/invoices?license_id=${fx.a.licenseId}`, undefined, 'support'),
      );
      expect(listed.data.find((row) => row.id === invoiceA.id)?.pdf_available).toBe(true);
      const before = await call(
        'GET',
        `/billing/invoices/${invoiceA.id}/pdf`,
        undefined,
        'support',
      );
      expect(before.statusCode).toBe(200);
      expect(before.headers['content-type']).toBe('application/pdf');
      expect(before.headers['content-disposition']).toContain(invoiceA.number);
      const tenantCopy = await tenant.get(`/billing/invoices/${justClosed}/pdf`, as(ownerA));
      expect(before.rawPayload.equals(tenantCopy.rawPayload)).toBe(true);

      await ok(call('PUT', '/billing/issuer-profile', issuer('Yeni Ünvan Ltd.')));
      const invoiceB = await issueFor('b');
      expect(invoiceB.sellerSnapshot).toMatchObject({ legal_name: 'Yeni Ünvan Ltd.' });
      // The statement already issued is not reissued: same issuer, same bytes.
      const again = await owner.invoice.findUniqueOrThrow({ where: { id: invoiceA.id } });
      expect(again.sellerSnapshot).toMatchObject({ legal_name: 'Örnek Yazılım A.Ş.' });
      const after = await call('GET', `/billing/invoices/${invoiceA.id}/pdf`);
      expect(after.rawPayload.equals(before.rawPayload)).toBe(true);

      expect(
        (await call('GET', '/billing/invoices/00000000-0000-4000-8000-000000000000/pdf'))
          .statusCode,
      ).toBe(404);
      const entries = await owner.platformAuditLog.findMany({
        where: { action: 'billing.issuer_profile_updated' },
        orderBy: { chainSeq: 'asc' },
      });
      expect(entries.map((row) => (row.payload as { changed: string[] }).changed)).toEqual([
        ['legal_name', 'address_lines', 'country', 'tax_office', 'tax_id', 'email'],
        ['legal_name'],
      ]);
    });
  });

  describe('refund approvals', () => {
    it('credits an approved refund to the next statement, at most the statement it answers for', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'active', trialEndsAt: null },
      });
      await owner.subscription.create({
        data: { licenseId: fx.a.licenseId, status: 'active', seats: 3, unitPriceCents: 9_900 },
      });
      await meter(fx.a.licenseId, previousPeriod(currentPeriod()));
      await new InvoiceCloseSweeper(appRole, testEnv({ STORAGE_LOCAL_DIR: storageDir })).run();
      const invoice = await owner.invoice.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(invoice.totalCents).toBeGreaterThan(0);
      const body = (amount: number, licenseId = fx.a.licenseId) => ({
        license_id: licenseId.toString(),
        invoice_id: invoice.id,
        amount_minor: amount,
        reason: REASON,
      });

      await refused(
        call('POST', '/billing/refund-approvals', body(invoice.totalCents + 1)),
        400,
        'validation',
        'amount_exceeds_invoice',
      );
      // Another workspace's statement is not found under this one.
      await refused(
        call('POST', '/billing/refund-approvals', body(100, fx.b.licenseId)),
        404,
        'not_found',
      );
      await refused(
        call('POST', '/billing/refund-approvals', body(100), 'support'),
        403,
        'authorization',
      );

      const { credit } = await ok<{ credit: Record<string, unknown> }>(
        call('POST', '/billing/refund-approvals', body(invoice.totalCents)),
        201,
      );
      expect(credit).toMatchObject({
        license_id: fx.a.licenseId.toString(),
        amount_minor: invoice.totalCents,
        currency: 'USD',
        invoice_id: null,
        reason: `Refund of ${invoice.number}: ${REASON}`,
      });
      const open = await ok<{ data: Array<{ id: string }> }>(
        call('GET', '/billing/credits?open=true'),
      );
      expect(open.data.map((row) => row.id)).toEqual([credit['id']]);
      const entry = await expectDoubleEntry(fx.a.licenseId, 'billing.credit_granted');
      expect(entry.payload).toMatchObject({ refund_of_invoice: invoice.id });
    });
  });
});
