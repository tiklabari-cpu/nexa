/**
 * The card method (`stripe`, tm 382 · ADR-13a §4): the hosted checkout, the
 * webhook that settles it, and the dunning job that renews it.
 *
 * Processor calls never run inside a database transaction — a slow processor
 * must not hold a pooled connection and the licence lock for ten seconds — so
 * every flow here is: write what we are about to do, call out, write what came
 * back. A crash between the second and third step leaves a pending payment,
 * which the webhook (for a checkout) or the next dunning run (for a renewal,
 * same idempotency key) finishes.
 *
 * The dunning job charges only subscriptions last paid by card
 * (`payment_provider = 'stripe'`) and only on a processor that can charge — on
 * the mock nothing renews by itself. A subscription set to end at its period
 * (`cancel_at_period_end`) is never renewed.
 */
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { UUID_RE, withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import {
  assertMethodOffered,
  enterReadOnly,
  ensureSubscription,
  LAST_DUNNING_ATTEMPT,
  newPaymentReference,
  nextRetryAt,
  paymentPeriod,
  readBillingSettings,
  recordDispute,
  recordPaymentFailure,
  requireAmountDue,
  settlePayment,
  visibleMethods,
  type PaymentActor,
} from './payment-methods.js';
import {
  PaymentProviderError,
  type PaymentProvider,
  type ProviderEvent,
} from './payment-provider.js';
import { INVOICE_CURRENCY } from './invoice-service.js';
import { priceSeats, type BillingCycle } from './subscription-service.js';

const HOUR_MS = 3_600_000;
/**
 * How long a renewal may stay pending before it is given up rather than
 * charged again. Stripe keeps an idempotency key for 24 hours; past that the
 * same key would make a *new* charge, so a pending renewal that old is
 * recorded as failed (`charge_unconfirmed`) and the plan moves on — a charge
 * that did go through would have reached us by its webhook long before.
 */
export const RENEWAL_PENDING_LIMIT_MS = 23 * HOUR_MS;

function serviceUnavailable(): ApiError {
  return new ApiError(
    'service_unavailable',
    'The card processor could not be reached. Try again.',
    {
      details: { reason: 'payment_provider_unavailable' },
    },
  );
}

// ---------------------------------------------------------------------------
// Hosted checkout
// ---------------------------------------------------------------------------

export interface StripeCheckoutDeps {
  db: PrismaClient;
  env: Env;
  payments: PaymentProvider;
}

/**
 * Open a hosted checkout for one term and return where to send the browser.
 * The pending payment is written first; if the processor cannot be reached it
 * is closed again (`canceled`), so nothing is left pending (contract: 503).
 * An older checkout still pending is superseded — though if the customer did
 * pay it after all, its webhook still settles it.
 */
export async function startStripeCheckout(
  deps: StripeCheckoutDeps,
  tenant: TenantContext,
  actor: PaymentActor,
  owner: { name: string; email: string | null },
  now: Date = new Date(),
): Promise<{ url: string; reference: string }> {
  const { db, env, payments } = deps;
  const prepared = await withTenant(db, tenant, async (tx) => {
    assertMethodOffered(visibleMethods(await readBillingSettings(tx), payments), 'stripe');
    await ensureSubscription(tx, tenant, env);
    const due = await requireAmountDue(tx, tenant, env);
    await tx.paymentTransaction.updateMany({
      where: {
        licenseId: tenant.licenseId,
        provider: 'stripe',
        kind: 'checkout',
        status: 'pending',
      },
      data: { status: 'canceled', settledAt: now },
    });
    const payment = await tx.paymentTransaction.create({
      data: {
        licenseId: tenant.licenseId,
        provider: 'stripe',
        kind: 'checkout',
        reference: newPaymentReference(),
        amountMinor: due.amountMinor,
        currency: due.currency,
        period: paymentPeriod(now),
        billingCycle: due.billingCycle,
      },
    });
    const subscription = await tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, providerCustomerId: true },
    });
    await writeAuditEntry(tx, actor.audit, {
      action: 'billing.payment_started',
      target: `payment:${payment.id}`,
      metadata: {
        provider: 'stripe',
        reference: payment.reference,
        amount_minor: payment.amountMinor,
      },
    });
    return { payment, subscription };
  });

  const { payment, subscription } = prepared;
  try {
    let customerId = subscription?.providerCustomerId ?? null;
    if (!customerId) {
      ({ customerId } = await payments.createCustomer({
        licenseId: tenant.licenseId,
        name: owner.name,
        email: owner.email,
      }));
      if (subscription) {
        await withTenant(db, tenant, (tx) =>
          tx.subscription.updateMany({
            where: { id: subscription.id, providerCustomerId: null },
            data: { providerCustomerId: customerId },
          }),
        );
      }
    }
    const billingUrl = `${env.WEB_APP_URL.replace(/\/+$/, '')}/app/billing`;
    const session = await payments.createCheckoutSession({
      customerId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      transactionId: payment.id,
      reference: payment.reference,
      description: `SiyahTuş subscription (${payment.billingCycle}) — ${payment.reference}`,
      successUrl: `${billingUrl}?payment=success&reference=${payment.reference}`,
      cancelUrl: `${billingUrl}?payment=canceled&reference=${payment.reference}`,
    });
    await withTenant(db, tenant, (tx) =>
      tx.paymentTransaction.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { providerRef: session.sessionId },
      }),
    );
    return { url: session.url, reference: payment.reference };
  } catch (error) {
    if (!(error instanceof PaymentProviderError)) throw error;
    await withTenant(db, tenant, (tx) =>
      tx.paymentTransaction.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'canceled', settledAt: new Date() },
      }),
    );
    throw serviceUnavailable();
  }
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export interface StripeEventOutcome {
  /** The event had been taken in before; nothing changed. */
  duplicate: boolean;
  /** It named a payment of ours. */
  matched: boolean;
}

/**
 * Act on one verified event. The event id is the idempotency key: an event a
 * payment row already carries is a redelivery and changes nothing, and the
 * settle/fail steps are themselves conditional on the payment's status — so
 * the same event twice, or a webhook after the dunning job already settled the
 * charge, is one payment record.
 */
export async function handleStripeEvent(
  db: PrismaClient,
  chainSecret: string,
  event: ProviderEvent,
  now: Date = new Date(),
): Promise<StripeEventOutcome> {
  if (event.type === 'ignored') return { duplicate: false, matched: false };
  const transactionId =
    event.transactionId && UUID_RE.test(event.transactionId) ? event.transactionId : null;
  if (!transactionId && !event.providerRef) return { duplicate: false, matched: false };

  const [located] = await db.$queryRaw<
    Array<{ transaction_id: string; license_id: bigint; organization_id: string }>
  >`
    SELECT transaction_id::text AS transaction_id, license_id, organization_id::text AS organization_id
    FROM payment_transaction_locate('stripe', ${transactionId}::uuid, ${event.providerRef})`;
  if (!located) return { duplicate: false, matched: false };

  const tenant: TenantContext = {
    licenseId: located.license_id,
    organizationId: located.organization_id,
  };
  const actor: PaymentActor = {
    audit: { licenseId: tenant.licenseId, chainSecret, actorId: null, actorType: 'system' },
  };

  return withTenant(db, tenant, async (tx) => {
    const seen = await tx.paymentTransaction.findFirst({
      where: { licenseId: tenant.licenseId, provider: 'stripe', providerEventId: event.id },
      select: { id: true },
    });
    if (seen) return { duplicate: true, matched: true };

    switch (event.type) {
      case 'payment_succeeded': {
        const outcome = await settlePayment(tx, {
          licenseId: tenant.licenseId,
          transactionId: located.transaction_id,
          now,
          actor,
          providerEventId: event.id,
          providerRef: event.providerRef,
          customerId: event.customerId,
          paymentMethodId: event.paymentMethodId,
        });
        return { duplicate: !outcome.settled, matched: true };
      }
      case 'payment_failed': {
        const { recorded } = await recordPaymentFailure(tx, {
          licenseId: tenant.licenseId,
          transactionId: located.transaction_id,
          now,
          failureCode: event.failureCode ?? 'payment_failed',
          actor,
          providerEventId: event.id,
          providerRef: event.providerRef,
        });
        return { duplicate: !recorded, matched: true };
      }
      case 'dispute_opened': {
        const { recorded } = await recordDispute(tx, {
          licenseId: tenant.licenseId,
          transactionId: located.transaction_id,
          actor,
          providerEventId: event.id,
        });
        return { duplicate: !recorded, matched: true };
      }
      default:
        return { duplicate: false, matched: false };
    }
  });
}

// ---------------------------------------------------------------------------
// Dunning — `billing_dunning`
// ---------------------------------------------------------------------------

export interface DunningReport {
  tenants: number;
  charged: number;
  succeeded: number;
  failed: number;
  readOnly: number;
  skipped: number;
}

type RenewalPlan =
  | { kind: 'skip' }
  | { kind: 'read_only' }
  | {
      kind: 'charge';
      transactionId: string;
      reference: string;
      attempt: number;
      amountMinor: number;
      currency: string;
      customerId: string;
      paymentMethodId: string;
    };

export interface BillingDunningOptions {
  db: PrismaClient;
  env: Pick<Env, 'AUDIT_CHAIN_SECRET'>;
  payments: PaymentProvider;
  now?: () => Date;
  logger?: { warn: (obj: object, msg: string) => void };
}

/**
 * Renews card-paid subscriptions and runs the dunning plan (BL-01): the first
 * charge when the term runs out, then a retry on the 1st, 3rd and 7th day
 * after it failed, then read-only. One workspace at a time; one workspace's
 * failure is logged and the run goes on.
 */
export class BillingDunning {
  readonly #options: BillingDunningOptions;

  constructor(options: BillingDunningOptions) {
    this.#options = options;
  }

  async run(): Promise<DunningReport> {
    const report: DunningReport = {
      tenants: 0,
      charged: 0,
      succeeded: 0,
      failed: 0,
      readOnly: 0,
      skipped: 0,
    };
    if (!this.#options.payments.hostedCheckout) return report;
    const now = this.#options.now?.() ?? new Date();
    const due = await this.#options.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string }>
    >`SELECT license_id, organization_id::text AS organization_id FROM billing_dunning_due_tenants(${now})`;
    for (const row of due) {
      report.tenants += 1;
      try {
        await this.#tenant(
          { licenseId: row.license_id, organizationId: row.organization_id },
          now,
          report,
        );
      } catch (error) {
        report.skipped += 1;
        this.#options.logger?.warn(
          { err: error, license_id: row.license_id.toString() },
          'billing dunning skipped a workspace',
        );
      }
    }
    return report;
  }

  #actor(tenant: TenantContext): PaymentActor {
    const audit: AuditContext = {
      licenseId: tenant.licenseId,
      chainSecret: this.#options.env.AUDIT_CHAIN_SECRET,
      actorId: null,
      actorType: 'system',
    };
    return { audit };
  }

  async #tenant(tenant: TenantContext, now: Date, report: DunningReport): Promise<void> {
    const { db, payments } = this.#options;
    const actor = this.#actor(tenant);
    const plan = await withTenant(db, tenant, (tx) => this.#plan(tx, tenant, now, actor));
    if (plan.kind === 'skip') {
      report.skipped += 1;
      return;
    }
    if (plan.kind === 'read_only') {
      report.readOnly += 1;
      return;
    }

    report.charged += 1;
    let result;
    try {
      result = await payments.chargeInvoice({
        customerId: plan.customerId,
        paymentMethodId: plan.paymentMethodId,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        transactionId: plan.transactionId,
        reference: plan.reference,
      });
    } catch (error) {
      // An outage, not a decline: the payment stays pending and the next run
      // charges it again under the same idempotency key.
      if (error instanceof PaymentProviderError) {
        report.skipped += 1;
        return;
      }
      throw error;
    }

    await withTenant(db, tenant, async (tx) => {
      if (result.outcome === 'succeeded') {
        const outcome = await settlePayment(tx, {
          licenseId: tenant.licenseId,
          transactionId: plan.transactionId,
          now,
          actor,
          providerRef: result.providerRef,
          paymentMethodId: result.paymentMethodId,
        });
        if (outcome.settled) report.succeeded += 1;
      } else if (result.outcome === 'failed') {
        await recordPaymentFailure(tx, {
          licenseId: tenant.licenseId,
          transactionId: plan.transactionId,
          now,
          failureCode: result.failureCode,
          actor,
          providerRef: result.providerRef,
        });
        report.failed += 1;
        if (plan.attempt >= LAST_DUNNING_ATTEMPT) report.readOnly += 1;
      } else {
        await tx.paymentTransaction.updateMany({
          where: { id: plan.transactionId, status: 'pending' },
          data: { providerRef: result.providerRef },
        });
      }
    });
  }

  /** What today asks for this workspace — decided under its lock, written before any charge. */
  async #plan(
    tx: TenantClient,
    tenant: TenantContext,
    now: Date,
    actor: PaymentActor,
  ): Promise<RenewalPlan> {
    const subscription = await tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription || subscription.paymentProvider !== 'stripe') return { kind: 'skip' };
    if (subscription.cancelAtPeriodEnd) return { kind: 'skip' };

    const customerId = subscription.providerCustomerId;
    const paymentMethodId = subscription.providerPaymentMethodId;
    const base = (row: {
      id: string;
      reference: string;
      attempt: number;
      amountMinor: number;
      currency: string;
    }) =>
      customerId && paymentMethodId
        ? ({
            kind: 'charge',
            transactionId: row.id,
            reference: row.reference,
            attempt: row.attempt,
            amountMinor: row.amountMinor,
            currency: row.currency,
            customerId,
            paymentMethodId,
          } as const)
        : null;

    // A renewal left pending by a crash or an outage: charge it again under
    // the same key, unless it is too old for the key to still protect us.
    const pending = await tx.paymentTransaction.findFirst({
      where: {
        licenseId: tenant.licenseId,
        provider: 'stripe',
        kind: 'renewal',
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      const plan = base(pending);
      if (plan && now.getTime() - pending.createdAt.getTime() < RENEWAL_PENDING_LIMIT_MS)
        return plan;
      await recordPaymentFailure(tx, {
        licenseId: tenant.licenseId,
        transactionId: pending.id,
        now,
        failureCode: plan ? 'charge_unconfirmed' : 'no_payment_method',
        actor,
      });
      return { kind: 'skip' };
    }

    let attempt = 1;
    if (subscription.pastDueSince === null) {
      if (!subscription.currentPeriodEnd || subscription.currentPeriodEnd > now) {
        return { kind: 'skip' };
      }
    } else {
      const failed = await tx.paymentTransaction.count({
        where: {
          licenseId: tenant.licenseId,
          kind: 'renewal',
          status: 'failed',
          createdAt: { gte: subscription.pastDueSince },
        },
      });
      const retryAt = nextRetryAt(subscription.pastDueSince, failed);
      if (retryAt === null) {
        return (await enterReadOnly(tx, tenant.licenseId, actor))
          ? { kind: 'read_only' }
          : { kind: 'skip' };
      }
      if (retryAt > now) return { kind: 'skip' };
      attempt = Math.min(failed + 1, LAST_DUNNING_ATTEMPT);
    }

    const { seatChargeCents } = priceSeats(
      subscription.unitPriceCents,
      subscription.seats,
      subscription.billingCycle as BillingCycle,
    );
    const payment = await tx.paymentTransaction.create({
      data: {
        licenseId: tenant.licenseId,
        provider: 'stripe',
        kind: 'renewal',
        reference: newPaymentReference(),
        amountMinor: Math.max(1, seatChargeCents),
        currency: INVOICE_CURRENCY,
        period: paymentPeriod(now),
        billingCycle: subscription.billingCycle,
        attempt,
      },
    });
    const plan = base(payment);
    if (plan) return plan;
    // No saved card to charge (it was cleared, or never saved): the attempt
    // fails here without calling anyone, and the plan goes on as for a decline.
    await recordPaymentFailure(tx, {
      licenseId: tenant.licenseId,
      transactionId: payment.id,
      now,
      failureCode: 'no_payment_method',
      actor,
    });
    return { kind: 'skip' };
  }
}
