/**
 * `/platform/v1/billing/*` — payment operations (tm 389.18 · FR-ADMIN-14 ·
 * design.md §C billing). The service is `services/platform/payment-ops.ts`.
 *
 *   GET  /billing/invoices/{invoiceId}/pdf                billing.read    the stored PDF (#383)
 *   GET  /billing/payment-requests                        billing.read    ?state&license_id, keyset
 *   POST /billing/payment-requests/{id}/send-address      billing.manage  billing.payment_address_sent
 *   POST /billing/payment-requests/{id}/confirm-txid      billing.manage  billing.payment_confirmed
 *   POST /billing/payment-requests/{id}/cancel            billing.manage  billing.payment_request_cancelled
 *   GET  /billing/swift-payments                          billing.read    ?state&license_id, keyset
 *   POST /billing/swift-payments/{id}/mark-paid           billing.manage  billing.swift_marked_paid
 *   GET|PUT /billing/providers                            read | manage   billing.providers_updated
 *   GET|PUT /billing/bank-details                         read | manage   billing.bank_details_updated
 *   GET|PUT /billing/issuer-profile                       read | manage   billing.issuer_profile_updated
 *   POST /billing/refund-approvals                        billing.manage  billing.credit_granted
 *
 * `billing` works the queues and `support` reads them (decision 5). Every
 * write records its platform audit entry in the transaction of the change; a
 * queue action also writes the workspace's own trail there (the platform
 * entry's tenant half, and the shared payment functions' own entries with a
 * `platform` actor). A settings save that changes nothing records nothing.
 * The address mail goes after the commit and never undoes the action.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { CRYPTO_NETWORKS, type CryptoNetwork } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { deliver, logUnsentMail } from '../../services/mail/delivery.js';
import type { Mailer } from '../../services/mail/mailer.js';
import { isMailLocale, type MailLocale } from '../../services/mail/templates/layout.js';
import { paymentAddressSentMail } from '../../services/mail/templates/messages.js';
import {
  BILLING_LIST_MAX,
  CREDIT_MAX_MINOR,
  PlatformBilling,
} from '../../services/platform/billing.js';
import {
  approveRefund,
  BillingCursorError,
  confirmTxid,
  markTransferPaid,
  maskWalletAddress,
  normaliseBankDetails,
  normaliseIssuerProfile,
  PAYMENT_REQUEST_FILTERS,
  PlatformPaymentOps,
  rejectRequest,
  sendAddress,
  setBankDetails,
  setIssuerProfile,
  setProviders,
  SWIFT_PAYMENT_FILTERS,
  type OperatorActor,
} from '../../services/platform/payment-ops.js';
import type {
  PlatformAuditAction,
  PlatformAuditTarget,
} from '../../services/platform/platform-audit.js';
import { createObjectStore, type ObjectStore } from '../../services/storage/object-store.js';
import { parse } from './auth.js';

const LICENSE_ID = z.string().regex(/^[1-9]\d{0,18}$/);
const REASON = z.string();
const page = {
  license_id: LICENSE_ID.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(BILLING_LIST_MAX).optional(),
};

const requestsQuery = z.object({ state: z.enum(PAYMENT_REQUEST_FILTERS).optional(), ...page });
const swiftQuery = z.object({ state: z.enum(SWIFT_PAYMENT_FILTERS).optional(), ...page });

const sendAddressBody = z.object({
  network: z.enum(CRYPTO_NETWORKS),
  address: z.string().min(1).max(100),
  reason: REASON,
});
const confirmBody = z.object({ txid: z.string().min(1).max(100), reason: REASON });
const markPaidBody = z.object({ reference: z.string().min(1).max(32), reason: REASON });

const providersBody = z.object({
  swift_manual: z.boolean(),
  crypto_manual: z.boolean(),
  stripe: z.boolean(),
  reason: REASON,
});

const bankBody = z.object({
  beneficiary: z.string().min(1).max(200),
  bank_name: z.string().min(1).max(200),
  // Room for the spaces people type; the stored form is checked after.
  iban: z.string().min(1).max(64),
  swift_bic: z.string().min(1).max(16),
  bank_address: z.string().max(500).nullable().optional(),
  reason: REASON,
});

const optionalText = (max: number) => z.string().max(max).nullable().optional();
const issuerBody = z.object({
  legal_name: z.string().min(1).max(200),
  address_lines: z.array(z.string().max(200)).max(6).optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .nullable()
    .optional(),
  tax_office: optionalText(100),
  tax_id: optionalText(32),
  vat_id: optionalText(15),
  email: z.string().email().max(254).nullable().optional(),
  tax_note: optionalText(1000),
  reason: REASON,
});

const refundBody = z.object({
  license_id: LICENSE_ID,
  invoice_id: z.string().uuid(),
  amount_minor: z.number().int().min(1).max(CREDIT_MAX_MINOR),
  reason: REASON,
});

const NETWORK_LABEL: Record<CryptoNetwork, string> = {
  usdt_trc20: 'USDT (TRC-20)',
  usdt_erc20: 'USDT (ERC-20)',
};

const CURSOR_REFUSED =
  '`cursor` is not a cursor of this list with these filters. Start again without it.';

function param(request: FastifyRequest, name: string): string {
  const value = (request.params as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : '';
}

function moneyText(minor: number, currency: string, locale: MailLocale): string {
  try {
    return new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export default async function platformPaymentOpsRoutes(
  app: FastifyInstance,
  options: { env: Env; mailer: Mailer; store?: ObjectStore; now?: () => number },
): Promise<void> {
  const { env, mailer } = options;
  const clock = options.now ?? Date.now;
  const ops = new PlatformPaymentOps(app.platformDb, {
    env,
    ...(options.now ? { now: options.now } : {}),
  });
  const billing = new PlatformBilling(app.platformDb, {
    env,
    ...(options.now ? { now: options.now } : {}),
  });
  const store = options.store ?? createObjectStore(env.STORAGE_PROVIDER, env.storage);
  const read = { platform: { permission: 'billing.read' as const } };
  const manage = (action: PlatformAuditAction, target: PlatformAuditTarget) => ({
    platform: {
      permission: 'billing.manage' as const,
      audit: { action, target },
    },
  });

  function operatorOf(request: FastifyRequest): OperatorActor {
    return {
      adminId: request.platformSession!.adminId,
      chainSecret: env.AUDIT_CHAIN_SECRET,
      requestId: request.id,
      ip: request.ip,
    };
  }

  async function paged<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof BillingCursorError) throw ApiError.validation(CURSOR_REFUSED);
      throw error;
    }
  }

  /** A queue action: the change and both audit trails in one transaction. */
  function inTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return app.platformDb.$transaction(run, { timeout: 30_000 });
  }

  // --- Statements ------------------------------------------------------------

  app.get('/billing/invoices/:invoiceId/pdf', { config: read }, async (request, reply) => {
    const pdf = await ops.invoicePdf(param(request, 'invoiceId'));
    if (!pdf) throw ApiError.notFound('No PDF for this invoice.');
    const file = await store.get(pdf.key);
    if (!file) {
      request.log.warn(
        { invoice_id: param(request, 'invoiceId') },
        'invoice pdf missing from the object store',
      );
      throw ApiError.notFound('No PDF for this invoice.');
    }
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="siyahtus-invoice-${pdf.number}.pdf"`)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store')
      .send(file.bytes);
  });

  // --- Crypto requests ---------------------------------------------------------

  app.get('/billing/payment-requests', { config: read }, async (request, reply) => {
    const query = parse(requestsQuery, request.query);
    const result = await paged(() =>
      ops.requests({
        ...(query.state ? { state: query.state } : {}),
        ...(query.license_id ? { licenseId: BigInt(query.license_id) } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    );
    return reply.header('cache-control', 'no-store').send(result);
  });

  app.post(
    '/billing/payment-requests/:requestId/send-address',
    { config: manage('billing.payment_address_sent', 'payment_request') },
    async (request, reply) => {
      const body = parse(sendAddressBody, request.body);
      const requestId = param(request, 'requestId');
      const now = new Date(clock());
      const outcome = await inTransaction(async (tx) => {
        const sent = await sendAddress(tx, {
          requestId,
          network: body.network,
          address: body.address,
          operator: operatorOf(request),
          now,
        });
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: requestId,
            licenseId: sent.licenseId,
            payload: {
              request_id: requestId,
              network: sent.network,
              address_masked: maskWalletAddress(body.address),
            },
          }),
          tx,
        );
        return sent;
      });

      // After the commit: the owners hear the address is waiting (not what it is).
      const workspace = await app.platformDb.license.findUnique({
        where: { id: outcome.licenseId },
        select: {
          organization: { select: { name: true } },
          memberships: {
            where: { role: 'owner', suspended: false },
            select: { locale: true, agent: { select: { email: true } } },
          },
        },
      });
      const base = env.WEB_APP_URL?.replace(/\/+$/, '');
      for (const owner of workspace?.memberships ?? []) {
        const locale: MailLocale = isMailLocale(owner.locale) ? owner.locale : 'en';
        const delivered = await deliver(mailer, {
          to: owner.agent.email,
          licenseId: outcome.licenseId,
          kind: 'notification',
          ...paymentAddressSentMail(
            { locale, ...(env.WEB_APP_URL ? { appUrl: env.WEB_APP_URL } : {}) },
            {
              workspaceName: workspace?.organization.name ?? '',
              network: NETWORK_LABEL[outcome.network],
              amount: moneyText(outcome.amountMinor, outcome.currency, locale),
              billingUrl: base ? `${base}/app/billing` : null,
            },
          ),
        });
        logUnsentMail(request.log, 'payment_address_sent.mail', delivered);
      }
      return reply
        .header('cache-control', 'no-store')
        .send({ request: await ops.request(requestId) });
    },
  );

  app.post(
    '/billing/payment-requests/:requestId/confirm-txid',
    { config: manage('billing.payment_confirmed', 'payment_request') },
    async (request, reply) => {
      const body = parse(confirmBody, request.body);
      const requestId = param(request, 'requestId');
      const now = new Date(clock());
      await inTransaction(async (tx) => {
        const confirmed = await confirmTxid(tx, {
          requestId,
          txid: body.txid,
          operator: operatorOf(request),
          now,
        });
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: requestId,
            licenseId: confirmed.licenseId,
            payload: { request_id: requestId, term_end: confirmed.termEnd },
          }),
          tx,
        );
      });
      return reply
        .header('cache-control', 'no-store')
        .send({ request: await ops.request(requestId) });
    },
  );

  app.post(
    '/billing/payment-requests/:requestId/cancel',
    { config: manage('billing.payment_request_cancelled', 'payment_request') },
    async (request, reply) => {
      const requestId = param(request, 'requestId');
      const reason = request.platformAudit!.reason!;
      const now = new Date(clock());
      await inTransaction(async (tx) => {
        const rejected = await rejectRequest(tx, {
          requestId,
          reason,
          operator: operatorOf(request),
          now,
        });
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: requestId,
            licenseId: rejected.licenseId,
            payload: { request_id: requestId },
          }),
          tx,
        );
      });
      return reply
        .header('cache-control', 'no-store')
        .send({ request: await ops.request(requestId) });
    },
  );

  // --- Bank transfers ------------------------------------------------------------

  app.get('/billing/swift-payments', { config: read }, async (request, reply) => {
    const query = parse(swiftQuery, request.query);
    const result = await paged(() =>
      ops.swiftPayments({
        ...(query.state ? { state: query.state } : {}),
        ...(query.license_id ? { licenseId: BigInt(query.license_id) } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    );
    return reply.header('cache-control', 'no-store').send(result);
  });

  app.post(
    '/billing/swift-payments/:paymentId/mark-paid',
    { config: manage('billing.swift_marked_paid', 'payment_request') },
    async (request, reply) => {
      const body = parse(markPaidBody, request.body);
      const paymentId = param(request, 'paymentId');
      const now = new Date(clock());
      await inTransaction(async (tx) => {
        const paid = await markTransferPaid(tx, {
          paymentId,
          reference: body.reference,
          operator: operatorOf(request),
          now,
        });
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: paymentId,
            licenseId: paid.licenseId,
            payload: {
              payment_id: paymentId,
              reference: paid.reference,
              amount_minor: paid.amountMinor,
              term_end: paid.termEnd,
            },
          }),
          tx,
        );
      });
      return reply
        .header('cache-control', 'no-store')
        .send({ payment: await ops.swiftPayment(paymentId) });
    },
  );

  // --- Settings -----------------------------------------------------------------

  /**
   * One settings save: written and recorded together, or — when nothing
   * changed — neither (the response hook is told the entry is not wanted).
   */
  async function saveSetting(
    request: FastifyRequest,
    save: (tx: Prisma.TransactionClient) => Promise<{
      changed: readonly string[];
      payload?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    await inTransaction(async (tx) => {
      const { changed, payload } = await save(tx);
      if (changed.length === 0) {
        request.platformAudit!.recorded = true;
        return;
      }
      await app.platformAuditLog.record(
        request.platformAuditEntry({ payload: { changed: [...changed], ...payload } }),
        tx,
      );
    });
  }

  app.get('/billing/providers', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await ops.providers()),
  );

  app.put(
    '/billing/providers',
    { config: manage('billing.providers_updated', 'settings') },
    async (request, reply) => {
      const body = parse(providersBody, request.body);
      const next = {
        swift_manual: body.swift_manual,
        crypto_manual: body.crypto_manual,
        stripe: body.stripe,
      };
      const adminId = request.platformSession!.adminId;
      await saveSetting(request, async (tx) => {
        const { changed } = await setProviders(tx, next, adminId);
        return { changed, payload: { providers: next } };
      });
      return reply.header('cache-control', 'no-store').send(await ops.providers());
    },
  );

  app.get('/billing/bank-details', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await ops.bankDetails()),
  );

  app.put(
    '/billing/bank-details',
    { config: manage('billing.bank_details_updated', 'settings') },
    async (request, reply) => {
      const body = parse(bankBody, request.body);
      const details = normaliseBankDetails(body);
      const adminId = request.platformSession!.adminId;
      await saveSetting(request, (tx) => setBankDetails(tx, details, adminId));
      return reply.header('cache-control', 'no-store').send(await ops.bankDetails());
    },
  );

  app.get('/billing/issuer-profile', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await ops.issuerProfile()),
  );

  app.put(
    '/billing/issuer-profile',
    { config: manage('billing.issuer_profile_updated', 'settings') },
    async (request, reply) => {
      const body = parse(issuerBody, request.body);
      const profile = normaliseIssuerProfile(body);
      const adminId = request.platformSession!.adminId;
      await saveSetting(request, (tx) => setIssuerProfile(tx, profile, adminId));
      return reply.header('cache-control', 'no-store').send(await ops.issuerProfile());
    },
  );

  // --- Refund approvals -----------------------------------------------------------

  app.post(
    '/billing/refund-approvals',
    { config: manage('billing.credit_granted', 'credit') },
    async (request, reply) => {
      const body = parse(refundBody, request.body);
      const licenseId = BigInt(body.license_id);
      const reason = request.platformAudit!.reason!;
      const adminId = request.platformSession!.adminId;
      const creditId = await inTransaction(async (tx) => {
        const approved = await approveRefund(tx, {
          licenseId,
          invoiceId: body.invoice_id,
          amountMinor: body.amount_minor,
          reason,
          adminId,
        });
        await app.platformAuditLog.record(
          request.platformAuditEntry({
            targetId: approved.creditId,
            licenseId,
            payload: {
              credit_id: approved.creditId,
              amount_minor: body.amount_minor,
              currency: approved.currency,
              refund_of_invoice: body.invoice_id,
            },
          }),
          tx,
        );
        return approved.creditId;
      });
      return reply
        .code(201)
        .header('cache-control', 'no-store')
        .send({ credit: await billing.credit(app.platformDb, creditId) });
    },
  );
}
