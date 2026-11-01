/**
 * Payment operations — the root panel's side of #382/#383/#384 (tm 389.18 ·
 * FR-ADMIN-14 · design.md §C billing, §B2 `billing.*`).
 *
 * Two queues and three settings:
 *
 *   - **Crypto payment requests** (`crypto_payment_requests`): the team sends
 *     the wallet address, confirms the TXID it found on the chain, or refuses
 *     the request. The work itself is `services/billing/manual-payments.ts` —
 *     the same functions the tenant side was built around (decision 1 of the
 *     task) — called here on the `siyahtus_platform` connection with a
 *     `platform` actor, so the workspace's own trail records who did it.
 *   - **Bank transfers** (`payment_transactions`, `provider = swift_manual`):
 *     the team matches a transfer to its reference and marks it paid.
 *   - **Settings** the tenant API reads through `platform_billing_settings()`:
 *     `billing.providers` (which methods workspaces are offered),
 *     `billing.swift_bank_details` (the account the SWIFT screen shows) and
 *     `billing.issuer_profile` (the seller every new statement carries).
 *
 * Both confirmations end in `settlePayment`, exactly as a card payment does —
 * the subscription `active`, the term paid. Every query names what it reads
 * (BYPASSRLS, as in `billing.ts`), and nothing here returns a workspace's
 * content: amounts, states, the invoicing name the owner typed, identities.
 *
 * **A state the action does not fit is 409 `platform_payment_state`** with
 * `details.reason` — the request was well formed, the payment's state refused
 * it. A malformed address or TXID stays a 400, as on the tenant side.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  CRYPTO_REQUEST_OPEN_STATUSES,
  CRYPTO_REQUEST_STATUSES,
  isValidTxid,
  PAYMENT_METHOD_IDS,
  PAYMENT_TRANSACTION_STATUSES,
  type CryptoNetwork,
  type InvoiceParty,
  type PaymentMethodId,
} from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import { readIssuerProfile } from '../billing/billing-profile.js';
import {
  cancelCryptoRequest,
  confirmCryptoTxid,
  markSwiftPaid,
  sendCryptoAddress,
} from '../billing/manual-payments.js';
import {
  readBankDetails,
  readProviderVisibility,
  type PaymentActor,
  type SwiftBankDetails,
} from '../billing/payment-methods.js';
import { resolvePaymentProvider } from '../billing/payment-provider.js';
import {
  BILLING_LIST_DEFAULT,
  BILLING_LIST_MAX,
  BillingCursorError,
  clamp,
  decodeCursor,
  encodeCursor,
  epochMs,
  fingerprint,
  grantCredit,
} from './billing.js';

type Tx = Prisma.TransactionClient;

export const PROVIDERS_SETTING_KEY = 'billing.providers';
export const BANK_DETAILS_SETTING_KEY = 'billing.swift_bank_details';
export const ISSUER_PROFILE_SETTING_KEY = 'billing.issuer_profile';

/** `?state=` of the crypto queue: one state, the two still open (default), or all. */
export const PAYMENT_REQUEST_FILTERS = ['open', ...CRYPTO_REQUEST_STATUSES, 'all'] as const;
export type PaymentRequestFilter = (typeof PAYMENT_REQUEST_FILTERS)[number];

/** `?state=` of the bank-transfer list: one state (default `pending`) or all. */
export const SWIFT_PAYMENT_FILTERS = [...PAYMENT_TRANSACTION_STATUSES, 'all'] as const;
export type SwiftPaymentFilter = (typeof SWIFT_PAYMENT_FILTERS)[number];

// --- Errors ------------------------------------------------------------------

/** The payment's state refused the action (`details.reason` says how). */
export function paymentStateError(message: string, reason: string, extra: object = {}): ApiError {
  return new ApiError('platform_payment_state', message, { details: { reason, ...extra } });
}

/**
 * The tenant-side refusals that are a state, not a malformed request: the
 * shared functions answer them as `validation` (that is right for the owner's
 * screen); for an operator they are a conflict with the payment's state.
 */
const STATE_REASONS = new Set([
  'not_awaiting_address',
  'not_awaiting_confirmation',
  'not_cancellable',
  'txid_used',
]);

async function asStateConflict<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const reason = error instanceof ApiError ? error.details?.['reason'] : undefined;
    if (error instanceof ApiError && typeof reason === 'string' && STATE_REASONS.has(reason)) {
      throw paymentStateError(error.message, reason, error.details ?? {});
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** `TXyZ12…9aBc` — what the audit trail keeps of a wallet address (first 6, last 4). */
export function maskWalletAddress(address: string): string {
  const value = address.trim();
  if (value.length <= 10) return '…';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Views -------------------------------------------------------------------

export interface PaymentRequestView {
  id: string;
  license_id: string;
  organization_name: string;
  network: CryptoNetwork;
  status: string;
  amount_minor: number;
  currency: string;
  billing_cycle: string;
  billing_name: string;
  wallet_address: string | null;
  address_sent_at: string | null;
  txid: string | null;
  txid_submitted_at: string | null;
  closed_reason: string | null;
  handled_by_email: string | null;
  created_at: string;
  closed_at: string | null;
}

interface RequestRow {
  id: string;
  license_id: bigint;
  organization_name: string;
  network: string;
  status: string;
  amount_minor: number;
  currency: string;
  billing_cycle: string;
  billing_name: string;
  wallet_address: string | null;
  address_sent_at: Date | null;
  txid: string | null;
  txid_submitted_at: Date | null;
  closed_reason: string | null;
  handled_by_email: string | null;
  created_at: Date;
  closed_at: Date | null;
  sort_key: bigint;
}

function requestOf(row: RequestRow): PaymentRequestView {
  return {
    id: row.id,
    license_id: row.license_id.toString(),
    organization_name: row.organization_name,
    network: row.network as CryptoNetwork,
    status: row.status,
    amount_minor: row.amount_minor,
    // Stored lower-case (`payment_transactions` style); shown as the ISO code.
    currency: row.currency.toUpperCase(),
    billing_cycle: row.billing_cycle,
    billing_name: row.billing_name,
    wallet_address: row.wallet_address,
    address_sent_at: row.address_sent_at?.toISOString() ?? null,
    txid: row.txid,
    txid_submitted_at: row.txid_submitted_at?.toISOString() ?? null,
    closed_reason: row.closed_reason,
    handled_by_email: row.handled_by_email,
    created_at: row.created_at.toISOString(),
    closed_at: row.closed_at?.toISOString() ?? null,
  };
}

const REQUEST_SELECT = Prisma.sql`
  SELECT r.id::text AS id, r.license_id, o.name AS organization_name, r.network, r.status,
         r.amount_minor, r.currency::text AS currency, r.billing_cycle, r.billing_name,
         r.wallet_address, r.address_sent_at, r.txid, r.txid_submitted_at, r.closed_reason,
         a.email::text AS handled_by_email, r.created_at, r.closed_at,
         ${epochMs('r.created_at')} AS sort_key
    FROM crypto_payment_requests r
    JOIN licenses l ON l.id = r.license_id
    JOIN organizations o ON o.id = l.organization_id
    LEFT JOIN platform_admins a ON a.id::text = r.handled_by`;

export interface SwiftPaymentView {
  id: string;
  license_id: string;
  organization_name: string;
  reference: string;
  status: string;
  amount_minor: number;
  currency: string;
  billing_cycle: string;
  created_at: string;
  settled_at: string | null;
  handled_by_email: string | null;
}

interface SwiftRow {
  id: string;
  license_id: bigint;
  organization_name: string;
  reference: string;
  status: string;
  amount_minor: number;
  currency: string;
  billing_cycle: string;
  created_at: Date;
  settled_at: Date | null;
  handled_by_email: string | null;
  sort_key: bigint;
}

function swiftOf(row: SwiftRow): SwiftPaymentView {
  return {
    id: row.id,
    license_id: row.license_id.toString(),
    organization_name: row.organization_name,
    reference: row.reference,
    status: row.status,
    amount_minor: row.amount_minor,
    currency: row.currency.toUpperCase(),
    billing_cycle: row.billing_cycle,
    created_at: row.created_at.toISOString(),
    settled_at: row.settled_at?.toISOString() ?? null,
    handled_by_email: row.handled_by_email,
  };
}

const SWIFT_SELECT = Prisma.sql`
  SELECT p.id::text AS id, p.license_id, o.name AS organization_name, p.reference, p.status,
         p.amount_minor, p.currency::text AS currency, p.billing_cycle, p.created_at,
         p.settled_at, a.email::text AS handled_by_email, ${epochMs('p.created_at')} AS sort_key
    FROM payment_transactions p
    JOIN licenses l ON l.id = p.license_id
    JOIN organizations o ON o.id = l.organization_id
    LEFT JOIN platform_admins a ON a.id::text = p.handled_by`;

export interface ProvidersView {
  providers: Record<PaymentMethodId, boolean>;
  stored: boolean;
  stripe_card_ready: boolean;
  updated_at: string | null;
}

export interface BankDetailsView {
  details: SwiftBankDetails | null;
  updated_at: string | null;
}

export interface IssuerProfileView {
  profile: (InvoiceParty & { tax_note: string | null }) | null;
  updated_at: string | null;
}

interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

// --- Reads -------------------------------------------------------------------

export interface PaymentOpsOptions {
  env: Env;
  now?: () => number;
}

export class PlatformPaymentOps {
  readonly #db: PrismaClient;
  readonly #env: Env;

  constructor(db: PrismaClient, options: PaymentOpsOptions) {
    this.#db = db;
    this.#env = options.env;
  }

  /** The crypto queue, oldest first — the order the team works it in. */
  async requests(filter: {
    state?: PaymentRequestFilter;
    licenseId?: bigint;
    cursor?: string;
    limit?: number;
  }): Promise<Page<PaymentRequestView>> {
    const state = filter.state ?? 'open';
    const limit = clamp(filter.limit, BILLING_LIST_DEFAULT, BILLING_LIST_MAX);
    const f = fingerprint('payment-requests', [state, filter.licenseId?.toString() ?? null]);
    const cursor = filter.cursor ? decodeCursor(filter.cursor, f, /^\d{1,16}$/) : null;

    const conditions: Prisma.Sql[] = [Prisma.sql`true`];
    if (state === 'open') {
      conditions.push(Prisma.sql`r.status IN (${Prisma.join([...CRYPTO_REQUEST_OPEN_STATUSES])})`);
    } else if (state !== 'all') {
      conditions.push(Prisma.sql`r.status = ${state}`);
    }
    if (filter.licenseId !== undefined) {
      conditions.push(Prisma.sql`r.license_id = ${filter.licenseId}`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(${epochMs('r.created_at')}, r.id) > (${BigInt(cursor.k)}, ${cursor.id}::uuid)`,
      );
    }
    const rows = await this.#db.$queryRaw<RequestRow[]>`
      ${REQUEST_SELECT}
       WHERE ${Prisma.join(conditions, ' AND ')}
       ORDER BY ${epochMs('r.created_at')} ASC, r.id ASC
       LIMIT ${limit + 1}`;
    return pageOf(rows, limit, f, requestOf);
  }

  async request(id: string, client: PrismaClient | Tx = this.#db): Promise<PaymentRequestView> {
    if (!UUID_RE.test(id)) throw ApiError.notFound('No such crypto payment request.');
    const [row] = await client.$queryRaw<RequestRow[]>`
      ${REQUEST_SELECT} WHERE r.id = ${id}::uuid`;
    if (!row) throw ApiError.notFound('No such crypto payment request.');
    return requestOf(row);
  }

  /** Bank-transfer references, oldest first; `pending` is the list to match. */
  async swiftPayments(filter: {
    state?: SwiftPaymentFilter;
    licenseId?: bigint;
    cursor?: string;
    limit?: number;
  }): Promise<Page<SwiftPaymentView>> {
    const state = filter.state ?? 'pending';
    const limit = clamp(filter.limit, BILLING_LIST_DEFAULT, BILLING_LIST_MAX);
    const f = fingerprint('swift-payments', [state, filter.licenseId?.toString() ?? null]);
    const cursor = filter.cursor ? decodeCursor(filter.cursor, f, /^\d{1,16}$/) : null;

    const conditions: Prisma.Sql[] = [Prisma.sql`p.provider = 'swift_manual'`];
    if (state !== 'all') conditions.push(Prisma.sql`p.status = ${state}`);
    if (filter.licenseId !== undefined) {
      conditions.push(Prisma.sql`p.license_id = ${filter.licenseId}`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(${epochMs('p.created_at')}, p.id) > (${BigInt(cursor.k)}, ${cursor.id}::uuid)`,
      );
    }
    const rows = await this.#db.$queryRaw<SwiftRow[]>`
      ${SWIFT_SELECT}
       WHERE ${Prisma.join(conditions, ' AND ')}
       ORDER BY ${epochMs('p.created_at')} ASC, p.id ASC
       LIMIT ${limit + 1}`;
    return pageOf(rows, limit, f, swiftOf);
  }

  async swiftPayment(id: string, client: PrismaClient | Tx = this.#db): Promise<SwiftPaymentView> {
    if (!UUID_RE.test(id)) throw ApiError.notFound('No such bank transfer.');
    const [row] = await client.$queryRaw<SwiftRow[]>`
      ${SWIFT_SELECT} WHERE p.id = ${id}::uuid AND p.provider = 'swift_manual'`;
    if (!row) throw ApiError.notFound('No such bank transfer.');
    return swiftOf(row);
  }

  async providers(client: PrismaClient | Tx = this.#db): Promise<ProvidersView> {
    const row = await client.platformSetting.findUnique({ where: { key: PROVIDERS_SETTING_KEY } });
    return {
      providers: readProviderVisibility(row?.value ?? null),
      stored: row !== null,
      stripe_card_ready: Boolean(resolvePaymentProvider(this.#env).provider.hostedCheckout),
      updated_at: row?.updatedAt.toISOString() ?? null,
    };
  }

  async bankDetails(client: PrismaClient | Tx = this.#db): Promise<BankDetailsView> {
    const row = await client.platformSetting.findUnique({
      where: { key: BANK_DETAILS_SETTING_KEY },
    });
    return {
      details: readBankDetails(row?.value ?? null),
      updated_at: row?.updatedAt.toISOString() ?? null,
    };
  }

  async issuerProfile(client: PrismaClient | Tx = this.#db): Promise<IssuerProfileView> {
    const row = await client.platformSetting.findUnique({
      where: { key: ISSUER_PROFILE_SETTING_KEY },
    });
    const profile = readIssuerProfile(row?.value ?? null);
    return {
      profile: profile ? { ...profile, tax_note: profile.tax_note ?? null } : null,
      updated_at: row?.updatedAt.toISOString() ?? null,
    };
  }

  /** The stored PDF's key and number, or null — no such statement, or one issued before PDFs. */
  async invoicePdf(invoiceId: string): Promise<{ key: string; number: string } | null> {
    if (!UUID_RE.test(invoiceId)) return null;
    const row = await this.#db.invoice.findUnique({
      where: { id: invoiceId },
      select: { number: true, pdfStorageKey: true },
    });
    return row?.pdfStorageKey ? { key: row.pdfStorageKey, number: row.number } : null;
  }
}

function pageOf<R extends { id: string; sort_key: bigint }, V>(
  rows: R[],
  limit: number,
  f: string,
  view: (row: R) => V,
): Page<V> {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map(view),
    next_cursor:
      rows.length > limit && last
        ? encodeCursor({ f, k: last.sort_key.toString(), id: last.id })
        : null,
  };
}

export { BillingCursorError };

// --- The queues' actions ------------------------------------------------------

/** Who acts, as the shared payment functions and the workspace's trail need it. */
export interface OperatorActor {
  adminId: string;
  chainSecret: string;
  requestId?: string | null;
  ip?: string | null;
}

function paymentActor(licenseId: bigint, operator: OperatorActor): PaymentActor {
  return {
    audit: {
      licenseId,
      chainSecret: operator.chainSecret,
      actorId: operator.adminId,
      actorType: 'platform',
      requestId: operator.requestId ?? null,
      ip: operator.ip ?? null,
    },
    handledBy: operator.adminId,
  };
}

/**
 * The licence the shared functions write the workspace's trail under. The
 * platform role bypasses row level security, but triggers that ask
 * `siyahtus_current_license()` still read this.
 */
async function enterWorkspace(tx: Tx, licenseId: bigint): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.current_license', ${licenseId.toString()}, true)`;
}

async function requestRow(tx: Tx, requestId: string) {
  if (!UUID_RE.test(requestId)) throw ApiError.notFound('No such crypto payment request.');
  const row = await tx.cryptoPaymentRequest.findUnique({ where: { id: requestId } });
  if (!row) throw ApiError.notFound('No such crypto payment request.');
  return row;
}

/** Send the wallet address (decision 2: the owner sees it only on this request, only from now). */
export async function sendAddress(
  tx: Tx,
  input: {
    requestId: string;
    network: CryptoNetwork;
    address: string;
    operator: OperatorActor;
    now: Date;
  },
): Promise<{ licenseId: bigint; network: CryptoNetwork; amountMinor: number; currency: string }> {
  const row = await requestRow(tx, input.requestId);
  if (row.network !== input.network) {
    throw ApiError.validation('This request is for another network.', {
      reason: 'network_mismatch',
      network: row.network,
    });
  }
  await enterWorkspace(tx, row.licenseId);
  await asStateConflict(() =>
    sendCryptoAddress(tx as unknown as TenantClient, {
      licenseId: row.licenseId,
      requestId: row.id,
      address: input.address,
      actor: paymentActor(row.licenseId, input.operator),
      now: input.now,
    }),
  );
  return {
    licenseId: row.licenseId,
    network: row.network as CryptoNetwork,
    amountMinor: row.amountMinor,
    currency: row.currency,
  };
}

/**
 * A TXID is accepted once, across every workspace and both tables: another
 * request carrying it, or a crypto payment already recorded with it. The
 * unique index on `crypto_payment_requests (network, txid)` backs this for
 * two operators racing; this check is what turns it into an answer.
 */
async function assertTxidUnused(
  tx: Tx,
  network: string,
  txid: string,
  requestId: string,
): Promise<void> {
  const [elsewhere, recorded] = await Promise.all([
    tx.cryptoPaymentRequest.findFirst({
      where: { network, txid, id: { not: requestId } },
      select: { id: true },
    }),
    tx.paymentTransaction.findFirst({
      where: { provider: 'crypto_manual', providerRef: txid },
      select: { id: true },
    }),
  ]);
  if (elsewhere || recorded) {
    throw paymentStateError('This transaction id is already on another payment.', 'txid_used');
  }
}

/**
 * The transfer was found on the chain: the request is `paid` and the
 * subscription `active` (through `settlePayment`). The operator's TXID must be
 * the owner's when the owner wrote one; when not (the owner sent it some other
 * way) the operator's is written on the request first.
 */
export async function confirmTxid(
  tx: Tx,
  input: { requestId: string; txid: string; operator: OperatorActor; now: Date },
): Promise<{ licenseId: bigint; termEnd: string | null }> {
  const row = await requestRow(tx, input.requestId);
  if (row.status !== 'address_sent') {
    throw paymentStateError(
      'This request is not waiting for a confirmation.',
      'not_awaiting_confirmation',
      { status: row.status },
    );
  }
  const network = row.network as CryptoNetwork;
  const txid = input.txid.trim().toLowerCase();
  if (!isValidTxid(network, txid)) {
    throw ApiError.validation('That is not a transaction id on this network.', {
      reason: 'txid_invalid',
      network,
    });
  }
  if (row.txid !== null && row.txid !== txid) {
    throw ApiError.validation('The owner wrote a different transaction id on this request.', {
      reason: 'txid_mismatch',
    });
  }
  await assertTxidUnused(tx, network, txid, row.id);

  await enterWorkspace(tx, row.licenseId);
  if (row.txid === null) {
    try {
      await tx.cryptoPaymentRequest.update({
        where: { id: row.id },
        data: { txid, txidSubmittedAt: input.now },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw paymentStateError('This transaction id is already on another payment.', 'txid_used');
      }
      throw error;
    }
  }
  const { outcome } = await asStateConflict(() =>
    confirmCryptoTxid(tx as unknown as TenantClient, {
      licenseId: row.licenseId,
      requestId: row.id,
      actor: paymentActor(row.licenseId, input.operator),
      now: input.now,
    }),
  );
  return {
    licenseId: row.licenseId,
    termEnd: outcome.settled ? outcome.termEnd.toISOString() : null,
  };
}

/** Refuse an open request — `rejected`, the reason kept on it for the owner. */
export async function rejectRequest(
  tx: Tx,
  input: { requestId: string; reason: string; operator: OperatorActor; now: Date },
): Promise<{ licenseId: bigint }> {
  const row = await requestRow(tx, input.requestId);
  await enterWorkspace(tx, row.licenseId);
  await asStateConflict(() =>
    cancelCryptoRequest(tx as unknown as TenantClient, {
      licenseId: row.licenseId,
      requestId: row.id,
      reason: input.reason,
      actor: paymentActor(row.licenseId, input.operator),
      now: input.now,
    }),
  );
  return { licenseId: row.licenseId };
}

const normaliseReference = (value: string): string => value.trim().toUpperCase();

/** The transfer arrived with this reference: settle it (the same result as a card payment). */
export async function markTransferPaid(
  tx: Tx,
  input: { paymentId: string; reference: string; operator: OperatorActor; now: Date },
): Promise<{ licenseId: bigint; reference: string; amountMinor: number; termEnd: string }> {
  if (!UUID_RE.test(input.paymentId)) throw ApiError.notFound('No such bank transfer.');
  const payment = await tx.paymentTransaction.findFirst({
    where: { id: input.paymentId, provider: 'swift_manual' },
    select: { id: true, licenseId: true, reference: true, amountMinor: true },
  });
  if (!payment) throw ApiError.notFound('No such bank transfer.');
  if (normaliseReference(input.reference) !== payment.reference) {
    throw ApiError.validation('That is not this transfer’s reference.', {
      reason: 'reference_mismatch',
    });
  }
  await enterWorkspace(tx, payment.licenseId);
  const outcome = await markSwiftPaid(tx as unknown as TenantClient, {
    licenseId: payment.licenseId,
    reference: payment.reference,
    actor: paymentActor(payment.licenseId, input.operator),
    now: input.now,
  });
  if (!outcome.settled) {
    throw paymentStateError('This transfer is already marked paid.', 'already_settled');
  }
  return {
    licenseId: payment.licenseId,
    reference: payment.reference,
    amountMinor: payment.amountMinor,
    termEnd: outcome.termEnd.toISOString(),
  };
}

// --- Refund approvals ----------------------------------------------------------

/**
 * An approved refund is a credit (BL-03: nothing is paid back; an annual
 * exception is credited) — on the workspace's next statement, at most the
 * statement it answers for, which its reason names.
 */
export async function approveRefund(
  tx: Tx,
  input: {
    licenseId: bigint;
    invoiceId: string;
    amountMinor: number;
    reason: string;
    adminId: string;
  },
): Promise<{ creditId: string; invoiceNumber: string; currency: string }> {
  if (!UUID_RE.test(input.invoiceId)) throw ApiError.notFound('Invoice not found.');
  const invoice = await tx.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { licenseId: true, number: true, totalCents: true, currency: true },
  });
  // Another workspace's statement is "not found" here, like an unknown one.
  if (!invoice || invoice.licenseId !== input.licenseId) {
    throw ApiError.notFound('Invoice not found.');
  }
  if (input.amountMinor > invoice.totalCents) {
    throw ApiError.validation('A refund cannot be more than the statement it answers for.', {
      reason: 'amount_exceeds_invoice',
      total_minor: invoice.totalCents,
    });
  }
  const currency = invoice.currency.toUpperCase();
  const { id } = await grantCredit(tx, {
    licenseId: input.licenseId,
    amountMinor: input.amountMinor,
    currency,
    reason: `Refund of ${invoice.number}: ${input.reason}`,
    adminId: input.adminId,
  });
  return { creditId: id, invoiceNumber: invoice.number, currency };
}

// --- Settings --------------------------------------------------------------------

export type ProviderSwitches = Record<PaymentMethodId, boolean>;

async function writeSetting(tx: Tx, key: string, value: unknown, adminId: string): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await tx.platformSetting.upsert({
    where: { key },
    create: { key, value: json, updatedBy: adminId },
    update: { value: json, updatedBy: adminId, version: { increment: 1 } },
  });
}

/** The fields whose value differs — what the audit entry names, never the values. */
function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after).filter(
    (key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after[key] ?? null),
  );
}

/** Lock the three billing rows' writers against each other, so two saves cannot interleave. */
async function lockBillingSettings(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_settings.billing'))`;
}

/**
 * Which methods workspaces are offered (decision 3: a method switched off
 * stops *new* payments by it; paid terms and open references are untouched).
 */
export async function setProviders(
  tx: Tx,
  next: ProviderSwitches,
  adminId: string,
): Promise<{ changed: PaymentMethodId[] }> {
  await lockBillingSettings(tx);
  const row = await tx.platformSetting.findUnique({ where: { key: PROVIDERS_SETTING_KEY } });
  const before = readProviderVisibility(row?.value ?? null);
  const value = Object.fromEntries(PAYMENT_METHOD_IDS.map((id) => [id, next[id]]));
  const changed = PAYMENT_METHOD_IDS.filter((id) => before[id] !== next[id]);
  // A save that changes nothing writes nothing — not even a first row equal to
  // the defaults — so every stored change has its audit entry.
  if (changed.length > 0) await writeSetting(tx, PROVIDERS_SETTING_KEY, value, adminId);
  return { changed };
}

/** Two letters, two check digits, 11–30 letters or digits (ISO 13616 shape; no checksum). */
const IBAN_RE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;
/** ISO 9362: bank (4 letters), country (2), location (2), optional branch (3). */
const BIC_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export interface BankDetailsInput {
  beneficiary: string;
  bank_name: string;
  iban: string;
  swift_bic: string;
  bank_address?: string | null;
}

export function normaliseBankDetails(input: BankDetailsInput): SwiftBankDetails {
  const iban = input.iban.replace(/\s+/g, '').toUpperCase();
  const swiftBic = input.swift_bic.replace(/\s+/g, '').toUpperCase();
  if (!IBAN_RE.test(iban)) {
    throw ApiError.validation('That is not an IBAN.', { reason: 'iban_invalid' });
  }
  if (!BIC_RE.test(swiftBic)) {
    throw ApiError.validation('That is not a SWIFT/BIC code.', { reason: 'swift_bic_invalid' });
  }
  const beneficiary = input.beneficiary.trim();
  const bankName = input.bank_name.trim();
  if (!beneficiary || !bankName) {
    throw ApiError.validation('The beneficiary and the bank are both needed.', {
      reason: 'bank_details_incomplete',
    });
  }
  const address = input.bank_address?.trim() || null;
  return {
    beneficiary,
    bank_name: bankName,
    iban,
    swift_bic: swiftBic,
    bank_address: address,
  };
}

export async function setBankDetails(
  tx: Tx,
  details: SwiftBankDetails,
  adminId: string,
): Promise<{ changed: string[] }> {
  await lockBillingSettings(tx);
  const row = await tx.platformSetting.findUnique({ where: { key: BANK_DETAILS_SETTING_KEY } });
  const before = readBankDetails(row?.value ?? null);
  const changed = changedFields(before as Record<string, unknown> | null, { ...details });
  if (changed.length > 0) await writeSetting(tx, BANK_DETAILS_SETTING_KEY, details, adminId);
  return { changed };
}

export interface IssuerProfileInput {
  legal_name: string;
  address_lines?: string[];
  country?: string | null;
  tax_office?: string | null;
  tax_id?: string | null;
  vat_id?: string | null;
  email?: string | null;
  tax_note?: string | null;
}

/** The stored form, in the shape `readIssuerProfile` (#383) reads back. */
export function normaliseIssuerProfile(input: IssuerProfileInput): Record<string, unknown> {
  const optional = (value: string | null | undefined): string | null => value?.trim() || null;
  const legalName = input.legal_name.trim();
  if (!legalName) {
    throw ApiError.validation('The issuer needs a legal name.', { reason: 'legal_name_missing' });
  }
  return {
    legal_name: legalName,
    address_lines: (input.address_lines ?? []).map((line) => line.trim()).filter(Boolean),
    country: optional(input.country)?.toUpperCase() ?? null,
    tax_office: optional(input.tax_office),
    tax_id: optional(input.tax_id),
    vat_id: optional(input.vat_id)?.toUpperCase() ?? null,
    email: optional(input.email),
    tax_note: optional(input.tax_note),
  };
}

export async function setIssuerProfile(
  tx: Tx,
  profile: Record<string, unknown>,
  adminId: string,
): Promise<{ changed: string[] }> {
  await lockBillingSettings(tx);
  const row = await tx.platformSetting.findUnique({ where: { key: ISSUER_PROFILE_SETTING_KEY } });
  const parsed = readIssuerProfile(row?.value ?? null);
  const before = parsed ? { ...parsed, tax_note: parsed.tax_note ?? null } : null;
  const changed = changedFields(before as Record<string, unknown> | null, profile);
  if (changed.length > 0) await writeSetting(tx, ISSUER_PROFILE_SETTING_KEY, profile, adminId);
  return { changed };
}
