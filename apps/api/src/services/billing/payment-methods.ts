/**
 * Paying for the subscription, whichever way (tm 382 · BL-01 · ADR-13a).
 *
 * Three methods share one model, so a bank transfer the team marks paid, a
 * crypto transfer confirmed by its TXID and a Stripe charge all end the same
 * way — that sameness is the acceptance criterion "SWIFT elle ödendi işareti
 * aynı sonucu üretir", and it is why this file knows no processor:
 *
 *   - **What is paid** is one *term* of the subscription — a month or a year
 *     of seats (`priceSeats`), in US cents (`INVOICE_CURRENCY`, ADR-13a §5),
 *     the same amount by every method. Overage stays on the month-end
 *     statement exactly as before; a payment does not restate a frozen invoice.
 *   - **A payment row** (`payment_transactions`) is opened when the owner
 *     starts paying (a SWIFT reference, a hosted checkout, a confirmed crypto
 *     request) or when the dunning job charges the saved card. It succeeds,
 *     fails, or is superseded.
 *   - **Success** ({@link settlePayment}) pays the next term: from the end of
 *     the one already paid, or from now if that has lapsed. It moves
 *     `subscriptions.current_period_end`, records how it was paid, clears the
 *     dunning clock, and lifts the licence to `active` from `trialing`,
 *     `read_only` or `past_due` — one audit entry per transition.
 *   - **Failure** of a renewal ({@link recordPaymentFailure}) starts the
 *     dunning plan: the licence is `past_due` (still writable), the card is
 *     tried again on the 1st, 3rd and 7th day (`DUNNING_RETRY_DAYS`), and when
 *     the last try fails the licence is `read_only` ({@link enterReadOnly}).
 *     A failed *checkout* changes no state: the owner simply tries again.
 *
 * The state machine is `trialing → active → past_due → read_only`, and back to
 * `active` from any of them by paying. `canceled` and `suspended` are left
 * alone — a payment is recorded, but reopening a closed workspace is the
 * platform's decision.
 *
 * Every function takes the transaction and names the licence in every query,
 * so it runs the same inside the tenant API (row level security) and on the
 * root panel's `siyahtus_platform` connection (which bypasses it) — the root
 * panel (tm 389.18) calls the manual confirmations with a platform actor.
 */
import { randomInt } from 'node:crypto';
import {
  DUNNING_RETRY_DAYS,
  PAYMENT_METHOD_IDS,
  type PaymentMethodId,
  type PaymentTransactionStatus,
} from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import { usageConfig } from './billing-views.js';
import { INVOICE_CURRENCY } from './invoice-service.js';
import { currentPeriod, usageSummary } from './metering.js';
import type { PaymentProvider } from './payment-provider.js';
import { reopenedFields } from './subscription-cancel.js';
import {
  priceSeats,
  pricingForPlan,
  updateSubscription,
  type BillingCycle,
} from './subscription-service.js';

const DAY_MS = 86_400_000;

/**
 * Who confirmed a payment and the audit context their entries go under. A
 * member in the tenant API, a platform admin in the root panel (actor type
 * `platform`), the system for a webhook or the dunning job.
 */
export interface PaymentActor {
  audit: AuditContext;
  /** Kept on the row for a manual confirmation — the admin or account id. */
  handledBy?: string | null;
}

// ---------------------------------------------------------------------------
// Which methods a workspace sees
// ---------------------------------------------------------------------------

export interface SwiftBankDetails {
  beneficiary: string;
  bank_name: string;
  iban: string;
  swift_bic: string;
  bank_address: string | null;
}

export interface BillingSettings {
  providers: Record<PaymentMethodId, boolean>;
  bank: SwiftBankDetails | null;
}

/**
 * Before the platform says otherwise (ADR-13a §1): both manual methods on,
 * Stripe off — this build runs it only in a sandbox, and starting it off keeps
 * a live card path from switching itself on.
 */
export const DEFAULT_PROVIDER_VISIBILITY: Readonly<Record<PaymentMethodId, boolean>> = {
  swift_manual: true,
  crypto_manual: true,
  stripe: false,
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

/** `billing.swift_bank_details`, or null unless the four fields a transfer needs are set. */
export function readBankDetails(value: unknown): SwiftBankDetails | null {
  if (typeof value !== 'object' || value === null) return null;
  const source = value as Record<string, unknown>;
  const beneficiary = text(source['beneficiary'], 200);
  const bankName = text(source['bank_name'], 200);
  const iban = text(source['iban'], 64);
  const swiftBic = text(source['swift_bic'], 16);
  if (!beneficiary || !bankName || !iban || !swiftBic) return null;
  return {
    beneficiary,
    bank_name: bankName,
    iban,
    swift_bic: swiftBic,
    bank_address: text(source['bank_address'], 500),
  };
}

/** `billing.providers`: a boolean per method; anything missing or malformed keeps its default. */
export function readProviderVisibility(value: unknown): Record<PaymentMethodId, boolean> {
  const source =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_PROVIDER_VISIBILITY };
  for (const id of PAYMENT_METHOD_IDS) {
    if (typeof source[id] === 'boolean') out[id] = source[id];
  }
  return out;
}

/** The platform's billing settings, read through its SECURITY DEFINER window. */
export async function readBillingSettings(tx: TenantClient): Promise<BillingSettings> {
  const rows = await tx.$queryRaw<Array<{ providers: unknown; swift_bank_details: unknown }>>`
    SELECT providers, swift_bank_details FROM platform_billing_settings()`;
  return {
    providers: readProviderVisibility(rows[0]?.providers),
    bank: readBankDetails(rows[0]?.swift_bank_details),
  };
}

/**
 * The methods this workspace is offered: the platform's switch, and for
 * `stripe` also a processor that can take a card on its own page — on the
 * mock there is no Stripe to send anyone to (ADR-13a §4).
 */
export function visibleMethods(
  settings: BillingSettings,
  processor: Pick<PaymentProvider, 'hostedCheckout'>,
): PaymentMethodId[] {
  return PAYMENT_METHOD_IDS.filter(
    (id) => settings.providers[id] && (id !== 'stripe' || processor.hostedCheckout),
  );
}

/** Refuse a new payment by a method this workspace is not offered. */
export function assertMethodOffered(
  methods: readonly PaymentMethodId[],
  id: PaymentMethodId,
): void {
  if (!methods.includes(id)) {
    throw ApiError.validation('This payment method is not available.', {
      reason: 'method_unavailable',
      method: id,
    });
  }
}

// ---------------------------------------------------------------------------
// What one term costs
// ---------------------------------------------------------------------------

export interface AmountDue {
  amountMinor: number;
  currency: typeof INVOICE_CURRENCY;
  billingCycle: BillingCycle;
  seats: number;
}

/**
 * One term of the subscription, or null on a quoted plan — Enterprise's price
 * is in a contract nobody here can read, so there is nothing to collect.
 * Before a plan is chosen, the figures the checkout would choose by default.
 */
export async function amountDue(
  tx: TenantClient,
  tenant: TenantContext,
  env: Pick<Env, 'UNIT_PRICE_CENTS'>,
): Promise<AmountDue | null> {
  const [subscription, activeUsers] = await Promise.all([
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    }),
    tx.agentMembership.count({ where: { licenseId: tenant.licenseId, suspended: false } }),
  ]);
  if (pricingForPlan(subscription?.plan ?? 'growth') === 'quoted') return null;
  const billingCycle = (subscription?.billingCycle ?? 'monthly') as BillingCycle;
  const seats = subscription?.seats ?? Math.max(1, activeUsers);
  const unit = subscription?.unitPriceCents ?? env.UNIT_PRICE_CENTS;
  const amountMinor = priceSeats(unit, seats, billingCycle).seatChargeCents;
  if (amountMinor <= 0) return null;
  return { amountMinor, currency: INVOICE_CURRENCY, billingCycle, seats };
}

/** {@link amountDue}, or the refusal a payment start gives on a quoted plan. */
export async function requireAmountDue(
  tx: TenantClient,
  tenant: TenantContext,
  env: Pick<Env, 'UNIT_PRICE_CENTS'>,
): Promise<AmountDue> {
  const due = await amountDue(tx, tenant, env);
  if (!due) {
    throw ApiError.validation('This plan is invoiced under its contract, not paid here.', {
      reason: 'quoted_plan',
    });
  }
  return due;
}

/**
 * The subscription row a payment is recorded against. Starting to pay before
 * any plan was saved checks out the default plan — the same row
 * `PATCH /billing/subscription` with an empty body would write.
 */
export async function ensureSubscription(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
): Promise<void> {
  const existing = await tx.subscription.findFirst({
    where: { licenseId: tenant.licenseId },
    select: { id: true },
  });
  if (existing) return;
  const [activeUsers, usage] = await Promise.all([
    tx.agentMembership.count({ where: { licenseId: tenant.licenseId, suspended: false } }),
    usageSummary(tx, tenant, usageConfig(env)),
  ]);
  await updateSubscription(tx, tenant, {}, activeUsers, usage.ai_resolutions.used);
}

// ---------------------------------------------------------------------------
// References and terms
// ---------------------------------------------------------------------------

/** Crockford base32 without I, L, O, U — nothing a person misreads off a bank statement. */
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `ST-7K2M-Q9TB` — the code a transfer description carries (40 bits, random). */
export function newPaymentReference(): string {
  const pick = (): string =>
    Array.from({ length: 4 }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join(
      '',
    );
  return `ST-${pick()}-${pick()}`;
}

/**
 * The end of a term starting at `start`: one calendar month or year later in
 * UTC, the day clamped to the month's last (31 January → 28/29 February).
 */
export function addTerm(start: Date, cycle: BillingCycle): Date {
  const months = cycle === 'annual' ? 12 : 1;
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const end = new Date(start.getTime());
  end.setUTCFullYear(year, month, Math.min(start.getUTCDate(), lastDay));
  return end;
}

/**
 * When the next dunning retry is due, or null once every retry has been made.
 * `failedAttempts` counts the renewal charges that failed since the licence
 * went past due — the first failure included, so 1 means no retry yet.
 */
export function nextRetryAt(pastDueSince: Date, failedAttempts: number): Date | null {
  const retriesMade = Math.max(0, failedAttempts - 1);
  const day = DUNNING_RETRY_DAYS[retriesMade];
  return day === undefined ? null : new Date(pastDueSince.getTime() + day * DAY_MS);
}

/** The day the last retry runs — read-only from then if it fails too. */
export function readOnlyAfter(pastDueSince: Date): Date {
  const last = DUNNING_RETRY_DAYS[DUNNING_RETRY_DAYS.length - 1] ?? 0;
  return new Date(pastDueSince.getTime() + last * DAY_MS);
}

/** The highest attempt a renewal makes: the first charge, then one per retry. */
export const LAST_DUNNING_ATTEMPT = 1 + DUNNING_RETRY_DAYS.length;

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/** Licence states a payment lifts to `active` — the same set `activateIfPaid` lifts. */
const PAYABLE_STATES = ['trialing', 'read_only', 'past_due'];

/** Statuses a payment row may still succeed from (a superseded checkout the customer paid anyway). */
const SETTLEABLE: readonly PaymentTransactionStatus[] = ['pending', 'failed', 'canceled'];

/**
 * The licence row, locked for the rest of the transaction. Every billing write
 * that can move the licence takes this lock first (`activateIfPaid` does too),
 * so two webhooks for one payment — or a webhook racing the dunning job — run
 * one after the other and the second sees the first one's committed answer.
 */
async function lockLicense(tx: TenantClient, licenseId: bigint): Promise<string | null> {
  const [row] = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM licenses WHERE id = ${licenseId} FOR NO KEY UPDATE`;
  return row?.status ?? null;
}

async function moveLicense(
  tx: TenantClient,
  licenseId: bigint,
  from: string,
  to: 'past_due' | 'read_only',
  reason: string,
  actor: PaymentActor,
): Promise<void> {
  await tx.license.update({ where: { id: licenseId }, data: { status: to } });
  await writeAuditEntry(tx, actor.audit, {
    action: 'billing.license_status_changed',
    target: `license:${licenseId.toString()}`,
    metadata: { from, to, reason },
  });
}

export type SettleOutcome =
  | { settled: true; transactionId: string; termEnd: Date; activatedFrom: string | null }
  | { settled: false; transactionId: string | null; reason: 'already_settled' | 'not_found' };

/**
 * A payment succeeded: pay the next term and lift the licence.
 *
 * Idempotent: a payment already settled reports `already_settled` and writes
 * nothing — which is what makes a webhook delivered twice one payment, and the
 * dunning job's own answer and Stripe's later webhook for the same charge one
 * payment too.
 */
export async function settlePayment(
  tx: TenantClient,
  input: {
    licenseId: bigint;
    transactionId: string;
    now: Date;
    actor: PaymentActor;
    providerEventId?: string | null;
    providerRef?: string | null;
    customerId?: string | null;
    paymentMethodId?: string | null;
  },
): Promise<SettleOutcome> {
  const licenseStatus = await lockLicense(tx, input.licenseId);
  const payment = await tx.paymentTransaction.findFirst({
    where: { id: input.transactionId, licenseId: input.licenseId },
  });
  if (!payment || licenseStatus === null) {
    return { settled: false, transactionId: null, reason: 'not_found' };
  }
  if (!(SETTLEABLE as readonly string[]).includes(payment.status)) {
    return { settled: false, transactionId: payment.id, reason: 'already_settled' };
  }

  const subscription = await tx.subscription.findFirst({
    where: { licenseId: input.licenseId },
    orderBy: { createdAt: 'desc' },
  });
  const paidThrough = subscription?.currentPeriodEnd ?? null;
  const termStart = paidThrough && paidThrough > input.now ? paidThrough : input.now;
  const termEnd = addTerm(termStart, payment.billingCycle as BillingCycle);

  // Conditional on the status read above: a concurrent settle that got here
  // first (it cannot under the licence lock, but the row says so either way)
  // leaves nothing to update.
  const { count } = await tx.paymentTransaction.updateMany({
    where: { id: payment.id, status: payment.status },
    data: {
      status: 'succeeded',
      settledAt: input.now,
      termStart,
      termEnd,
      failureCode: null,
      ...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
      ...(input.providerRef ? { providerRef: input.providerRef } : {}),
      ...(input.actor.handledBy ? { handledBy: input.actor.handledBy } : {}),
    },
  });
  if (count === 0) return { settled: false, transactionId: payment.id, reason: 'already_settled' };

  if (subscription) {
    const stripe = payment.provider === 'stripe';
    await tx.subscription.update({
      where: { id: subscription.id },
      data: {
        // A subscription that had ended (tm 384) is bought again: the
        // cancellation and its dates go.
        ...reopenedFields(subscription),
        status: 'active',
        currentPeriodEnd: termEnd,
        trialEndsAt: null,
        pastDueSince: null,
        paymentProvider: payment.provider,
        ...(stripe && input.customerId ? { providerCustomerId: input.customerId } : {}),
        ...(stripe && input.paymentMethodId
          ? { providerPaymentMethodId: input.paymentMethodId }
          : {}),
        // Paid by hand this time: the saved card must not be charged for the
        // next term behind the owner's back. The customer stays for a later
        // card payment.
        ...(!stripe ? { providerPaymentMethodId: null } : {}),
      },
    });
  }

  let activatedFrom: string | null = null;
  if (PAYABLE_STATES.includes(licenseStatus)) {
    await tx.license.update({
      where: { id: input.licenseId },
      data: { status: 'active', trialEndsAt: null },
    });
    activatedFrom = licenseStatus;
    await writeAuditEntry(tx, input.actor.audit, {
      action: 'billing.license_activated',
      metadata: { from: licenseStatus, provider: payment.provider },
    });
  }
  await writeAuditEntry(tx, input.actor.audit, {
    action: 'billing.payment_succeeded',
    target: `payment:${payment.id}`,
    metadata: {
      provider: payment.provider,
      reference: payment.reference,
      amount_minor: payment.amountMinor,
      currency: payment.currency,
      kind: payment.kind,
      attempt: payment.attempt,
    },
  });
  return { settled: true, transactionId: payment.id, termEnd, activatedFrom };
}

/**
 * A payment failed. A failed renewal starts (or continues) the dunning plan:
 * the licence goes `past_due` on the first failure, and `read_only` when the
 * last retry fails. Idempotent like {@link settlePayment}: only a pending
 * payment can fail.
 */
export async function recordPaymentFailure(
  tx: TenantClient,
  input: {
    licenseId: bigint;
    transactionId: string;
    now: Date;
    failureCode: string;
    actor: PaymentActor;
    providerEventId?: string | null;
    providerRef?: string | null;
  },
): Promise<{ recorded: boolean }> {
  const licenseStatus = await lockLicense(tx, input.licenseId);
  const payment = await tx.paymentTransaction.findFirst({
    where: { id: input.transactionId, licenseId: input.licenseId, status: 'pending' },
  });
  if (!payment || licenseStatus === null) return { recorded: false };

  await tx.paymentTransaction.update({
    where: { id: payment.id },
    data: {
      status: 'failed',
      failureCode: input.failureCode,
      settledAt: input.now,
      ...(input.providerEventId ? { providerEventId: input.providerEventId } : {}),
      ...(input.providerRef ? { providerRef: input.providerRef } : {}),
    },
  });
  await writeAuditEntry(tx, input.actor.audit, {
    action: 'billing.payment_failed',
    target: `payment:${payment.id}`,
    metadata: {
      provider: payment.provider,
      reference: payment.reference,
      failure_code: input.failureCode,
      kind: payment.kind,
      attempt: payment.attempt,
    },
  });

  if (payment.kind !== 'renewal') return { recorded: true };

  const subscription = await tx.subscription.findFirst({
    where: { licenseId: input.licenseId },
    orderBy: { createdAt: 'desc' },
  });
  if (subscription && subscription.pastDueSince === null) {
    await tx.subscription.update({
      where: { id: subscription.id },
      data: { pastDueSince: input.now, status: 'past_due' },
    });
  }
  if (licenseStatus === 'active') {
    await moveLicense(tx, input.licenseId, 'active', 'past_due', 'renewal_failed', input.actor);
  }
  if (payment.attempt >= LAST_DUNNING_ATTEMPT) {
    await enterReadOnly(tx, input.licenseId, input.actor);
  }
  return { recorded: true };
}

/**
 * The dunning plan ran out: the workspace turns read-only (ADR-10 — data
 * intact and readable, writes refused until it pays).
 */
export async function enterReadOnly(
  tx: TenantClient,
  licenseId: bigint,
  actor: PaymentActor,
): Promise<boolean> {
  const status = await lockLicense(tx, licenseId);
  if (status !== 'past_due' && status !== 'active') return false;
  const subscription = await tx.subscription.findFirst({
    where: { licenseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (subscription) {
    await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'read_only' } });
  }
  await moveLicense(tx, licenseId, status, 'read_only', 'dunning_exhausted', actor);
  return true;
}

/** A chargeback on a settled payment. Recorded; what to do about it is a person's call. */
export async function recordDispute(
  tx: TenantClient,
  input: {
    licenseId: bigint;
    transactionId: string;
    actor: PaymentActor;
    providerEventId?: string | null;
  },
): Promise<{ recorded: boolean }> {
  await lockLicense(tx, input.licenseId);
  const { count } = await tx.paymentTransaction.updateMany({
    where: { id: input.transactionId, licenseId: input.licenseId, status: 'succeeded' },
    data: { status: 'disputed' },
  });
  if (count === 0) return { recorded: false };
  await writeAuditEntry(tx, input.actor.audit, {
    action: 'billing.payment_disputed',
    target: `payment:${input.transactionId}`,
    metadata: input.providerEventId ? { provider_event_id: input.providerEventId } : {},
  });
  return { recorded: true };
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface PaymentTransactionView {
  id: string;
  reference: string;
  provider: PaymentMethodId;
  kind: 'checkout' | 'renewal';
  status: PaymentTransactionStatus;
  amount_minor: number;
  currency: string;
  billing_cycle: BillingCycle;
  attempt: number;
  failure_code: string | null;
  term_start: string | null;
  term_end: string | null;
  created_at: string;
  settled_at: string | null;
}

type PaymentRow = {
  id: string;
  reference: string;
  provider: string;
  kind: string;
  status: string;
  amountMinor: number;
  currency: string;
  billingCycle: string;
  attempt: number;
  failureCode: string | null;
  termStart: Date | null;
  termEnd: Date | null;
  createdAt: Date;
  settledAt: Date | null;
};

export function serialisePayment(row: PaymentRow): PaymentTransactionView {
  return {
    id: row.id,
    reference: row.reference,
    provider: row.provider as PaymentMethodId,
    kind: row.kind as 'checkout' | 'renewal',
    status: row.status as PaymentTransactionStatus,
    amount_minor: row.amountMinor,
    currency: row.currency,
    billing_cycle: row.billingCycle as BillingCycle,
    attempt: row.attempt,
    failure_code: row.failureCode,
    term_start: row.termStart?.toISOString() ?? null,
    term_end: row.termEnd?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    settled_at: row.settledAt?.toISOString() ?? null,
  };
}

export const PAYMENT_HISTORY_LIMIT = 50;

export async function listPayments(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<PaymentTransactionView[]> {
  const rows = await tx.paymentTransaction.findMany({
    where: { licenseId: tenant.licenseId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAYMENT_HISTORY_LIMIT,
  });
  return rows.map(serialisePayment);
}

export interface PaymentStateView {
  license_status: string;
  provider: PaymentMethodId | null;
  paid_through: string | null;
  past_due_since: string | null;
  read_only_after: string | null;
  next_retry_at: string | null;
  last_failure: { reference: string; failure_code: string | null; at: string } | null;
}

/** Where the workspace's payments stand — what the "payment failed" band reads. */
export async function paymentState(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<PaymentStateView> {
  const [license, subscription, latest] = await Promise.all([
    tx.license.findUniqueOrThrow({ where: { id: tenant.licenseId }, select: { status: true } }),
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    }),
    tx.paymentTransaction.findFirst({
      where: { licenseId: tenant.licenseId, status: { in: ['succeeded', 'failed', 'disputed'] } },
      orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
    }),
  ]);
  const pastDueSince = subscription?.pastDueSince ?? null;
  let nextRetry: Date | null = null;
  if (pastDueSince) {
    const failed = await tx.paymentTransaction.count({
      where: {
        licenseId: tenant.licenseId,
        kind: 'renewal',
        status: 'failed',
        createdAt: { gte: pastDueSince },
      },
    });
    nextRetry = license.status === 'past_due' ? nextRetryAt(pastDueSince, failed) : null;
  }
  return {
    license_status: license.status,
    provider: (subscription?.paymentProvider as PaymentMethodId | null | undefined) ?? null,
    paid_through: subscription?.currentPeriodEnd?.toISOString() ?? null,
    past_due_since: pastDueSince?.toISOString() ?? null,
    read_only_after: pastDueSince ? readOnlyAfter(pastDueSince).toISOString() : null,
    next_retry_at: nextRetry?.toISOString() ?? null,
    last_failure:
      latest && latest.status === 'failed'
        ? {
            reference: latest.reference,
            failure_code: latest.failureCode,
            at: (latest.settledAt ?? latest.createdAt).toISOString(),
          }
        : null,
  };
}

export interface SwiftPaymentView {
  reference: string;
  amount_minor: number;
  currency: string;
  billing_cycle: BillingCycle;
  created_at: string;
}

export function serialiseSwift(row: {
  reference: string;
  amountMinor: number;
  currency: string;
  billingCycle: string;
  createdAt: Date;
}): SwiftPaymentView {
  return {
    reference: row.reference,
    amount_minor: row.amountMinor,
    currency: row.currency,
    billing_cycle: row.billingCycle as BillingCycle,
    created_at: row.createdAt.toISOString(),
  };
}

/** `GET /billing/payment-options`. */
export async function paymentOptions(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
  processor: PaymentProvider,
): Promise<Record<string, unknown>> {
  const [settings, due, pending, state] = await Promise.all([
    readBillingSettings(tx),
    amountDue(tx, tenant, env),
    tx.paymentTransaction.findFirst({
      where: { licenseId: tenant.licenseId, provider: 'swift_manual', status: 'pending' },
    }),
    paymentState(tx, tenant),
  ]);
  return {
    methods: visibleMethods(settings, processor),
    card_form: !processor.hostedCheckout,
    amount_due: due
      ? {
          amount_minor: due.amountMinor,
          currency: due.currency,
          billing_cycle: due.billingCycle,
          seats: due.seats,
        }
      : null,
    swift: { bank: settings.bank, pending: pending ? serialiseSwift(pending) : null },
    state,
  };
}

/** The `yyyymm` a payment started now belongs to. */
export function paymentPeriod(now: Date): string {
  return currentPeriod(now);
}
