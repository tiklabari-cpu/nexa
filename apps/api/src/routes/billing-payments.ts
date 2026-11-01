/**
 * Paying for the subscription (tm 382 · BL-01 · ADR-13a) — the workspace's
 * side: see the methods and what is due, take a SWIFT reference, open a card
 * checkout, ask for a crypto address and submit its TXID, read the history.
 * The SiyahTuş team's side (mark a transfer paid, send an address, confirm a
 * TXID) is the root panel's (tm 389.18), over the same service functions —
 * no route here lets a workspace confirm its own payment.
 *
 * Every write is the owner's (K7: `exactRole: 'owner'` on a billing scope)
 * and stays open while the workspace is read-only: paying is how a read-only
 * workspace comes back (ADR-10). The pilot refuses every `/billing/` write
 * (`pilot-gate.ts`), a sandbox too (`sandbox-gate.ts`).
 *
 *   GET  /billing/payment-options
 *   GET  /billing/payments
 *   POST /billing/payments/swift
 *   POST /billing/payments/stripe/checkout
 *   GET  /billing/crypto-requests
 *   POST /billing/crypto-requests
 *   POST /billing/crypto-requests/:requestId/txid
 *   POST /billing/crypto-requests/:requestId/cancel
 *   POST /billing/webhooks/stripe        Stripe's signed callback, public
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CRYPTO_NETWORKS } from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { UUID_RE } from '../lib/tenant.js';
import { selfAccountId } from '../services/auth/principal.js';
import {
  cancelCryptoRequest,
  createCryptoRequest,
  listCryptoRequests,
  startSwiftPayment,
  submitCryptoTxid,
} from '../services/billing/manual-payments.js';
import {
  listPayments,
  paymentOptions,
  type PaymentActor,
} from '../services/billing/payment-methods.js';
import {
  WebhookSignatureError,
  type PaymentProvider,
} from '../services/billing/payment-provider.js';
import { handleStripeEvent, startStripeCheckout } from '../services/billing/stripe-payments.js';

/** Who may read billing: either billing scope, or the plain reports reader (as `routes/reports.ts`). */
const BILLING_READ_SCOPES = ['billing_manage', 'billing_admin', 'reports_read'];
const BILLING_WRITE_SCOPES = ['billing_manage', 'billing_admin'];
const OWNER_WRITE = {
  scopes: BILLING_WRITE_SCOPES,
  exactRole: 'owner' as const,
  allowWhenReadOnly: true,
};

/** Stripe's events are a few kilobytes; a megabyte is room to spare and no more. */
const STRIPE_WEBHOOK_BODY_LIMIT = 1024 * 1024;

const cryptoRequestBody = z
  .object({
    network: z.enum(CRYPTO_NETWORKS),
    billing_name: z.string().trim().min(1).max(200),
    billing_details: z.string().max(1000).nullish(),
  })
  .strict();

const txidBody = z.object({ txid: z.string().trim().min(64).max(66) }).strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

function requestId(request: FastifyRequest<{ Params: { requestId: string } }>): string {
  const id = request.params.requestId;
  // Not a uuid is not a request of anyone's: 404, as for a stranger's.
  if (!UUID_RE.test(id)) throw ApiError.notFound('No such crypto payment request.');
  return id;
}

function actorOf(request: FastifyRequest): PaymentActor {
  const principal = request.requirePrincipal();
  return { audit: request.auditContext(), handledBy: selfAccountId(principal) };
}

export interface BillingPaymentRoutesOptions {
  env: Env;
  payments: PaymentProvider;
}

export default async function billingPaymentRoutes(
  app: FastifyInstance,
  options: BillingPaymentRoutesOptions,
): Promise<void> {
  const { env, payments } = options;

  app.get(
    '/billing/payment-options',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const tenant = request.tenant();
      const view = await request.withTenant((tx) => paymentOptions(tx, tenant, env, payments));
      return reply.send(view);
    },
  );

  app.get(
    '/billing/payments',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const tenant = request.tenant();
      const rows = await request.withTenant((tx) => listPayments(tx, tenant));
      return reply.send({ payments: rows });
    },
  );

  app.post('/billing/payments/swift', { config: OWNER_WRITE }, async (request, reply) => {
    const tenant = request.tenant();
    const actor = actorOf(request);
    const view = await request.withTenant((tx) =>
      startSwiftPayment(tx, tenant, env, payments, actor),
    );
    return reply.send(view);
  });

  app.post('/billing/payments/stripe/checkout', { config: OWNER_WRITE }, async (request, reply) => {
    const tenant = request.tenant();
    const actor = actorOf(request);
    const accountId = selfAccountId(request.requirePrincipal());
    // The processor's customer is named after the workspace and mailed at its
    // owner — the person who just asked to pay.
    const owner = await request.withTenant(async (tx) => {
      const [organization, account] = await Promise.all([
        tx.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { name: true },
        }),
        accountId
          ? tx.account.findUnique({ where: { id: accountId }, select: { email: true } })
          : Promise.resolve(null),
      ]);
      return { name: organization?.name ?? 'SiyahTuş workspace', email: account?.email ?? null };
    });
    const result = await startStripeCheckout({ db: app.db, env, payments }, tenant, actor, owner);
    return reply.send(result);
  });

  app.get(
    '/billing/crypto-requests',
    { config: { scopes: BILLING_READ_SCOPES } },
    async (request, reply) => {
      const tenant = request.tenant();
      const requests = await request.withTenant((tx) => listCryptoRequests(tx, tenant));
      return reply.send({ requests });
    },
  );

  app.post('/billing/crypto-requests', { config: OWNER_WRITE }, async (request, reply) => {
    const body = parse(cryptoRequestBody, request.body);
    const tenant = request.tenant();
    const actor = actorOf(request);
    const view = await request.withTenant((tx) =>
      createCryptoRequest(
        tx,
        tenant,
        env,
        payments,
        {
          network: body.network,
          billingName: body.billing_name,
          billingDetails: body.billing_details ?? null,
        },
        actor,
      ),
    );
    return reply.status(201).send(view);
  });

  app.post<{ Params: { requestId: string } }>(
    '/billing/crypto-requests/:requestId/txid',
    { config: OWNER_WRITE },
    async (request, reply) => {
      const id = requestId(request);
      const body = parse(txidBody, request.body);
      const tenant = request.tenant();
      const actor = actorOf(request);
      const view = await request.withTenant((tx) =>
        submitCryptoTxid(tx, tenant, { requestId: id, txid: body.txid }, actor),
      );
      return reply.send(view);
    },
  );

  app.post<{ Params: { requestId: string } }>(
    '/billing/crypto-requests/:requestId/cancel',
    { config: OWNER_WRITE },
    async (request, reply) => {
      const id = requestId(request);
      const tenant = request.tenant();
      const actor = actorOf(request);
      const view = await request.withTenant((tx) =>
        cancelCryptoRequest(tx, { licenseId: tenant.licenseId, requestId: id, actor }),
      );
      return reply.send(view);
    },
  );

  /**
   * Stripe's webhook. The body is read as bytes so `Stripe-Signature` is
   * checked against exactly what Stripe signed; a missing, wrong or stale
   * signature is 401 before anything is parsed or written. 404 unless the
   * deployment runs the real processor — on the mock there is no secret to
   * check a signature with, so there is no door.
   */
  await app.register(async (signed) => {
    signed.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: STRIPE_WEBHOOK_BODY_LIMIT },
      (_request, body, done) => done(null, body),
    );
    signed.post(
      '/billing/webhooks/stripe',
      { config: { public: true }, bodyLimit: STRIPE_WEBHOOK_BODY_LIMIT },
      async (request, reply) => {
        if (!payments.hostedCheckout) throw ApiError.notFound('Not found.');
        const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const header = request.headers['stripe-signature'];
        let event;
        try {
          event = payments.parseWebhook(raw, Array.isArray(header) ? header[0] : header);
        } catch (error) {
          if (error instanceof WebhookSignatureError) {
            throw ApiError.authentication('Invalid webhook signature.');
          }
          throw error;
        }
        const outcome = await handleStripeEvent(app.db, env.AUDIT_CHAIN_SECRET, event);
        request.log.info(
          {
            event: 'billing.stripe_webhook',
            stripe_event: event.type,
            matched: outcome.matched,
            duplicate: outcome.duplicate,
          },
          'stripe webhook received',
        );
        return reply.send({ received: true, duplicate: outcome.duplicate });
      },
    );
  });
}
