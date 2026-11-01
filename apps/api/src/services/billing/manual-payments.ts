/**
 * The two payment methods a person confirms (tm 382 · ADR-13a §2–3): a bank
 * transfer (`swift_manual`) and a crypto transfer (`crypto_manual`). Neither
 * needs Stripe, its code, its keys or its webhook — they work with the card
 * processor off (ADR-13a §4) — and both end in `settlePayment`, so a
 * transfer marked paid lifts the workspace exactly as a card does.
 *
 * Two kinds of caller, one set of functions. The workspace owner starts a
 * payment from `/billing` (the tenant API, under row level security): a SWIFT
 * reference, a crypto request, its TXID, its withdrawal. The SiyahTuş team
 * finishes it from the root panel (tm 389.18, on the platform connection):
 * marks the transfer paid, sends the wallet address, confirms the TXID,
 * rejects a request. Every function takes the transaction and the actor and
 * names the licence in every query, so the same code serves both — which side
 * may call which is the route's decision, not this file's. A workspace cannot
 * confirm its own payment because no tenant route calls the confirmations.
 *
 * Closing a method in the platform's settings stops *new* payments by it; a
 * reference already issued or a request already open is finished regardless
 * (ADR-13a §1 — switching off does not take back a promise).
 */
import { Prisma, type CryptoPaymentRequest } from '@prisma/client';
import {
  CRYPTO_REQUEST_OPEN_STATUSES,
  isValidTxid,
  isValidWalletAddress,
  type CryptoNetwork,
  type CryptoRequestStatus,
} from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { writeAuditEntry } from '../audit/audit-log.js';
import {
  assertMethodOffered,
  ensureSubscription,
  newPaymentReference,
  paymentPeriod,
  readBillingSettings,
  requireAmountDue,
  serialiseSwift,
  settlePayment,
  visibleMethods,
  type PaymentActor,
  type SettleOutcome,
  type SwiftPaymentView,
} from './payment-methods.js';
import type { PaymentProvider } from './payment-provider.js';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// ---------------------------------------------------------------------------
// SWIFT / bank transfer
// ---------------------------------------------------------------------------

/**
 * The reference for this term's transfer — issued once, then returned again
 * (with the amount brought up to date if the plan changed since), so the
 * description the owner already wrote on a transfer stays valid.
 */
export async function startSwiftPayment(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
  processor: PaymentProvider,
  actor: PaymentActor,
  now: Date = new Date(),
): Promise<SwiftPaymentView> {
  assertMethodOffered(visibleMethods(await readBillingSettings(tx), processor), 'swift_manual');
  await ensureSubscription(tx, tenant, env);
  const due = await requireAmountDue(tx, tenant, env);

  const pending = await tx.paymentTransaction.findFirst({
    where: { licenseId: tenant.licenseId, provider: 'swift_manual', status: 'pending' },
  });
  if (pending) {
    if (pending.amountMinor === due.amountMinor && pending.billingCycle === due.billingCycle) {
      return serialiseSwift(pending);
    }
    const updated = await tx.paymentTransaction.update({
      where: { id: pending.id },
      data: { amountMinor: due.amountMinor, billingCycle: due.billingCycle },
    });
    return serialiseSwift(updated);
  }

  let created;
  try {
    created = await tx.paymentTransaction.create({
      data: {
        licenseId: tenant.licenseId,
        provider: 'swift_manual',
        kind: 'checkout',
        reference: newPaymentReference(),
        amountMinor: due.amountMinor,
        currency: due.currency,
        period: paymentPeriod(now),
        billingCycle: due.billingCycle,
      },
    });
  } catch (error) {
    // Two clicks at once: the partial unique index let one through.
    if (isUniqueViolation(error)) {
      throw ApiError.validation('A transfer reference was just issued; reload to see it.', {
        reason: 'reference_issued',
      });
    }
    throw error;
  }
  await writeAuditEntry(tx, actor.audit, {
    action: 'billing.payment_started',
    target: `payment:${created.id}`,
    metadata: {
      provider: 'swift_manual',
      reference: created.reference,
      amount_minor: created.amountMinor,
    },
  });
  return serialiseSwift(created);
}

/**
 * The team matched a transfer to its reference: settle it (ADR-13a §2). The
 * same result as a card payment — subscription active, the term paid.
 * Idempotent: a reference already paid answers `already_settled`.
 */
export async function markSwiftPaid(
  tx: TenantClient,
  input: { licenseId: bigint; reference: string; actor: PaymentActor; now?: Date },
): Promise<SettleOutcome> {
  const payment = await tx.paymentTransaction.findFirst({
    where: {
      licenseId: input.licenseId,
      provider: 'swift_manual',
      reference: input.reference.trim().toUpperCase(),
    },
    select: { id: true },
  });
  if (!payment) throw ApiError.notFound('No bank transfer with that reference.');
  return settlePayment(tx, {
    licenseId: input.licenseId,
    transactionId: payment.id,
    now: input.now ?? new Date(),
    actor: input.actor,
  });
}

// ---------------------------------------------------------------------------
// Crypto — "Adres isteyin"
// ---------------------------------------------------------------------------

export interface CryptoRequestView {
  id: string;
  network: CryptoNetwork;
  status: CryptoRequestStatus;
  amount_minor: number;
  currency: string;
  billing_cycle: string;
  billing_name: string;
  billing_details: string | null;
  wallet_address: string | null;
  address_sent_at: string | null;
  txid: string | null;
  txid_submitted_at: string | null;
  closed_reason: string | null;
  created_at: string;
  closed_at: string | null;
}

type CryptoRow = CryptoPaymentRequest;

export function serialiseCryptoRequest(row: CryptoRow): CryptoRequestView {
  return {
    id: row.id,
    network: row.network as CryptoNetwork,
    status: row.status as CryptoRequestStatus,
    amount_minor: row.amountMinor,
    currency: row.currency,
    billing_cycle: row.billingCycle,
    billing_name: row.billingName,
    billing_details: row.billingDetails,
    wallet_address: row.walletAddress,
    address_sent_at: row.addressSentAt?.toISOString() ?? null,
    txid: row.txid,
    txid_submitted_at: row.txidSubmittedAt?.toISOString() ?? null,
    closed_reason: row.closedReason,
    created_at: row.createdAt.toISOString(),
    closed_at: row.closedAt?.toISOString() ?? null,
  };
}

export const CRYPTO_REQUEST_LIST_LIMIT = 20;

export async function listCryptoRequests(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<CryptoRequestView[]> {
  const rows = await tx.cryptoPaymentRequest.findMany({
    where: { licenseId: tenant.licenseId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: CRYPTO_REQUEST_LIST_LIMIT,
  });
  return rows.map(serialiseCryptoRequest);
}

async function findRequest(
  tx: TenantClient,
  licenseId: bigint,
  requestId: string,
): Promise<CryptoRow> {
  const row = await tx.cryptoPaymentRequest.findFirst({ where: { id: requestId, licenseId } });
  if (!row) throw ApiError.notFound('No such crypto payment request.');
  return row;
}

function isOpen(status: string): boolean {
  return (CRYPTO_REQUEST_OPEN_STATUSES as readonly string[]).includes(status);
}

/**
 * Ask for an address (ADR-13a §3). The amount is the term's — the owner
 * cannot write a discount or an exchange rate into the form — and no address
 * comes back: the team sends one on the request.
 */
export async function createCryptoRequest(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
  processor: PaymentProvider,
  input: { network: CryptoNetwork; billingName: string; billingDetails: string | null },
  actor: PaymentActor,
): Promise<CryptoRequestView> {
  assertMethodOffered(visibleMethods(await readBillingSettings(tx), processor), 'crypto_manual');
  const open = await tx.cryptoPaymentRequest.findFirst({
    where: { licenseId: tenant.licenseId, status: { in: [...CRYPTO_REQUEST_OPEN_STATUSES] } },
    select: { id: true },
  });
  if (open) {
    throw ApiError.validation('A crypto payment request is already open.', {
      reason: 'request_open',
      request_id: open.id,
    });
  }
  await ensureSubscription(tx, tenant, env);
  const due = await requireAmountDue(tx, tenant, env);

  let row: CryptoRow;
  try {
    row = await tx.cryptoPaymentRequest.create({
      data: {
        licenseId: tenant.licenseId,
        network: input.network,
        amountMinor: due.amountMinor,
        currency: due.currency,
        billingCycle: due.billingCycle,
        billingName: input.billingName.trim(),
        billingDetails: input.billingDetails?.trim() || null,
        requestedBy: actor.audit.actorType === 'agent' ? (actor.audit.actorId ?? null) : null,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.validation('A crypto payment request is already open.', {
        reason: 'request_open',
      });
    }
    throw error;
  }
  await writeAuditEntry(tx, actor.audit, {
    action: 'billing.payment_started',
    target: `crypto_request:${row.id}`,
    metadata: { provider: 'crypto_manual', network: row.network, amount_minor: row.amountMinor },
  });
  return serialiseCryptoRequest(row);
}

/**
 * The owner's TXID for the transfer to the address the team sent. Shape is
 * checked here; the chain is checked by a person. Replaceable until confirmed
 * (a typo should not need a new request); a TXID is accepted once, across
 * every workspace — the unique index answers for requests RLS hides.
 */
export async function submitCryptoTxid(
  tx: TenantClient,
  tenant: TenantContext,
  input: { requestId: string; txid: string },
  actor: PaymentActor,
  now: Date = new Date(),
): Promise<CryptoRequestView> {
  const row = await findRequest(tx, tenant.licenseId, input.requestId);
  if (row.status !== 'address_sent') {
    throw ApiError.validation('This request is not waiting for a transaction id.', {
      reason: 'not_awaiting_txid',
      status: row.status,
    });
  }
  const network = row.network as CryptoNetwork;
  const txid = input.txid.trim().toLowerCase();
  if (!isValidTxid(network, txid)) {
    throw ApiError.validation('That is not a transaction id on this network.', {
      reason: 'txid_invalid',
      network,
    });
  }
  let updated: CryptoRow;
  try {
    updated = await tx.cryptoPaymentRequest.update({
      where: { id: row.id },
      data: { txid, txidSubmittedAt: now },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw ApiError.validation('This transaction id has already been submitted.', {
        reason: 'txid_used',
      });
    }
    throw error;
  }
  await writeAuditEntry(tx, actor.audit, {
    action: 'billing.crypto_request_updated',
    target: `crypto_request:${row.id}`,
    metadata: { step: 'txid_submitted', network },
  });
  return serialiseCryptoRequest(updated);
}

/**
 * The team's answer: the wallet address for this request (root panel). May
 * be replaced until a TXID is on the request. The address is never generated
 * or stored anywhere else (ADR-13a §3).
 */
export async function sendCryptoAddress(
  tx: TenantClient,
  input: { licenseId: bigint; requestId: string; address: string; actor: PaymentActor; now?: Date },
): Promise<CryptoRequestView> {
  const row = await findRequest(tx, input.licenseId, input.requestId);
  if (!(row.status === 'requested' || (row.status === 'address_sent' && row.txid === null))) {
    throw ApiError.validation('This request is not waiting for an address.', {
      reason: 'not_awaiting_address',
      status: row.status,
    });
  }
  const network = row.network as CryptoNetwork;
  const address = input.address.trim();
  if (!isValidWalletAddress(network, address)) {
    throw ApiError.validation('That is not a wallet address on this network.', {
      reason: 'address_invalid',
      network,
    });
  }
  const updated = await tx.cryptoPaymentRequest.update({
    where: { id: row.id },
    data: {
      status: 'address_sent',
      walletAddress: address,
      addressSentAt: input.now ?? new Date(),
      handledBy: input.actor.handledBy ?? null,
    },
  });
  await writeAuditEntry(tx, input.actor.audit, {
    action: 'billing.crypto_request_updated',
    target: `crypto_request:${row.id}`,
    metadata: { step: 'address_sent', network },
  });
  return serialiseCryptoRequest(updated);
}

/**
 * The team found the transfer on the chain: the request is paid and the
 * subscription active — through `settlePayment`, like every other method.
 * The payment row carries the TXID as the processor reference.
 */
export async function confirmCryptoTxid(
  tx: TenantClient,
  input: { licenseId: bigint; requestId: string; actor: PaymentActor; now?: Date },
): Promise<{ request: CryptoRequestView; outcome: SettleOutcome }> {
  const now = input.now ?? new Date();
  const row = await findRequest(tx, input.licenseId, input.requestId);
  if (row.status !== 'address_sent' || row.txid === null) {
    throw ApiError.validation('This request has no transaction id to confirm.', {
      reason: 'not_awaiting_confirmation',
      status: row.status,
    });
  }
  const payment = await tx.paymentTransaction.create({
    data: {
      licenseId: input.licenseId,
      provider: 'crypto_manual',
      kind: 'checkout',
      reference: newPaymentReference(),
      providerRef: row.txid,
      amountMinor: row.amountMinor,
      currency: row.currency,
      period: paymentPeriod(now),
      billingCycle: row.billingCycle,
    },
    select: { id: true },
  });
  const outcome = await settlePayment(tx, {
    licenseId: input.licenseId,
    transactionId: payment.id,
    now,
    actor: input.actor,
  });
  const updated = await tx.cryptoPaymentRequest.update({
    where: { id: row.id },
    data: {
      status: 'paid',
      transactionId: payment.id,
      closedAt: now,
      handledBy: input.actor.handledBy ?? null,
    },
  });
  await writeAuditEntry(tx, input.actor.audit, {
    action: 'billing.crypto_request_updated',
    target: `crypto_request:${row.id}`,
    metadata: { step: 'paid', network: row.network },
  });
  return { request: serialiseCryptoRequest(updated), outcome };
}

/**
 * Close an open request: withdrawn by the owner (`canceled`), refused by the
 * team (`rejected`, with its reason). A paid or closed request stays as it is.
 */
export async function cancelCryptoRequest(
  tx: TenantClient,
  input: {
    licenseId: bigint;
    requestId: string;
    actor: PaymentActor;
    reason?: string | null;
    now?: Date;
  },
): Promise<CryptoRequestView> {
  const row = await findRequest(tx, input.licenseId, input.requestId);
  if (!isOpen(row.status)) {
    throw ApiError.validation('This request is already closed.', {
      reason: 'not_cancellable',
      status: row.status,
    });
  }
  const status = input.actor.audit.actorType === 'platform' ? 'rejected' : 'canceled';
  const updated = await tx.cryptoPaymentRequest.update({
    where: { id: row.id },
    data: {
      status,
      closedAt: input.now ?? new Date(),
      closedReason: input.reason?.trim().slice(0, 500) || null,
      ...(input.actor.handledBy ? { handledBy: input.actor.handledBy } : {}),
    },
  });
  await writeAuditEntry(tx, input.actor.audit, {
    action: 'billing.crypto_request_updated',
    target: `crypto_request:${row.id}`,
    metadata: { step: status, network: row.network },
  });
  return serialiseCryptoRequest(updated);
}
