/**
 * Payment methods — the closed vocabulary (tm 382 · BL-01 · ADR-13a).
 *
 * Three ways to pay one term of the subscription, the same amount each way
 * (ADR-13a §5): a bank transfer the SiyahTuş team matches to its reference and
 * marks paid, a crypto transfer the owner asks an address for and the team
 * confirms by its TXID, or a Stripe card charge. Which of them a workspace sees
 * is the platform's setting (`billing.providers`), never the workspace's.
 *
 * Plain constants and two pure checks — no top-level call — so importing this
 * from the web bundle costs nothing beyond the strings.
 */

/** The ways to pay, in the order the billing screen offers them. */
export const PAYMENT_METHOD_IDS = ['swift_manual', 'crypto_manual', 'stripe'] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export function isPaymentMethodId(value: unknown): value is PaymentMethodId {
  return typeof value === 'string' && (PAYMENT_METHOD_IDS as readonly string[]).includes(value);
}

/** USDT on TRON (TRC-20) or on Ethereum (ERC-20) — the two networks K16 names. */
export const CRYPTO_NETWORKS = ['usdt_trc20', 'usdt_erc20'] as const;
export type CryptoNetwork = (typeof CRYPTO_NETWORKS)[number];

export function isCryptoNetwork(value: unknown): value is CryptoNetwork {
  return typeof value === 'string' && (CRYPTO_NETWORKS as readonly string[]).includes(value);
}

/**
 * A crypto request's life: the owner asks (`requested`), the team answers with
 * an address (`address_sent`), the owner writes the TXID on it and the team
 * confirms it (`paid`). The team may refuse (`rejected`); the owner may
 * withdraw an open one (`canceled`).
 */
export const CRYPTO_REQUEST_STATUSES = [
  'requested',
  'address_sent',
  'paid',
  'rejected',
  'canceled',
] as const;
export type CryptoRequestStatus = (typeof CRYPTO_REQUEST_STATUSES)[number];

/** The two a request is still open in — at most one per workspace. */
export const CRYPTO_REQUEST_OPEN_STATUSES = ['requested', 'address_sent'] as const;

export const PAYMENT_TRANSACTION_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'canceled',
  'disputed',
] as const;
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];

/**
 * The dunning plan (BL-01): a renewal charge that fails is tried again on the
 * 1st, 3rd and 7th day after the first failure. Until then the workspace is
 * `past_due` and still writable; when the last retry fails it turns read-only.
 */
export const DUNNING_RETRY_DAYS = [1, 3, 7] as const;

/**
 * Whether a TXID has the shape of a transaction hash on that network — 64 hex
 * characters on TRON, `0x` and 64 on Ethereum. Shape only: whether the
 * transfer happened is checked on the chain by a person (ADR-13a §3).
 * Compared lower-case; callers store the lower-case form.
 */
export function isValidTxid(network: CryptoNetwork, txid: string): boolean {
  const value = txid.trim().toLowerCase();
  return network === 'usdt_erc20' ? /^0x[0-9a-f]{64}$/.test(value) : /^[0-9a-f]{64}$/.test(value);
}

/**
 * Whether a wallet address has the shape of one on that network: a TRON
 * base58 address (`T` and 33 more), or an Ethereum `0x` and 40 hex.
 */
export function isValidWalletAddress(network: CryptoNetwork, address: string): boolean {
  const value = address.trim();
  return network === 'usdt_erc20'
    ? /^0x[0-9a-fA-F]{40}$/.test(value)
    : /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
}
