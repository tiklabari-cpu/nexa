/**
 * Webhook payload signing — HMAC-SHA256 + timestamp + nonce (v2-04 §6.2, NFR-S7).
 *
 * The platform this clones compared a plaintext `secret_key` the receiver had to
 * store and echo back — a model where the secret travels on every request and a
 * single leaked log line forges any future call. Nexa signs instead: the secret
 * never leaves the server, only a signature derived from it does.
 *
 *   signature = HMAC-SHA256(secret, "{timestamp}.{nonce}.{body}")
 *
 * Binding the timestamp and a per-delivery nonce *into* the signed string is what
 * makes a captured request un-replayable: a receiver rejects a timestamp outside
 * a ±5-minute window and a nonce it has already seen, and neither can be changed
 * without invalidating the signature. Comparison is constant-time so a receiver's
 * verifier cannot be turned into a timing oracle.
 *
 * The secret is an argument here and never logged — the caller reads it from the
 * row and hands it in; it is not part of any header, error or return value.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { constantTimeEqual } from '../../lib/crypto.js';

/** Replay window: a delivery is only valid within 5 minutes either side. */
export const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

export interface WebhookSignatureHeaders {
  'X-Webhook-Timestamp': string;
  'X-Webhook-Nonce': string;
  'X-Webhook-Signature': string;
}

export interface SignedWebhook {
  headers: WebhookSignatureHeaders;
  body: string;
}

/** The exact bytes that are HMAC'd. One definition, used to sign and to verify. */
function signedPayload(timestamp: string, nonce: string, body: string): string {
  return `${timestamp}.${nonce}.${body}`;
}

/** Raw hex HMAC-SHA256 of `{timestamp}.{nonce}.{body}` under `secret`. */
export function computeSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  return createHmac('sha256', secret)
    .update(signedPayload(timestamp, nonce, body))
    .digest('hex');
}

/**
 * Sign a serialized body for delivery. `timestamp`/`nonce` are injectable so a
 * test can assert determinism; in production both come from the clock and a
 * fresh UUID, so no two deliveries share a nonce.
 */
export function signWebhook(
  secret: string,
  body: string,
  options: { timestamp?: number; nonce?: string } = {},
): SignedWebhook {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? randomUUID();
  const signature = computeSignature(secret, timestamp, nonce, body);
  return {
    headers: {
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Nonce': nonce,
      'X-Webhook-Signature': `sha256=${signature}`,
    },
    body,
  };
}

export interface WebhookVerifyInput {
  body: string;
  /** The `X-Webhook-Timestamp` header, as received. */
  timestamp: string | number | undefined;
  /** The `X-Webhook-Nonce` header. */
  nonce: string | undefined;
  /** The `X-Webhook-Signature` header, with or without the `sha256=` prefix. */
  signature: string | undefined;
}

export type WebhookVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'stale_timestamp' | 'replayed_nonce' | 'invalid_signature' };

/**
 * Verify a signed delivery — the receiver-side check.
 *
 * Shipped alongside the signer both as the reference an integrator implements
 * and so the signing scheme is proven end to end in tests rather than only in
 * one direction. `seenNonces`, when supplied, records accepted nonces and
 * rejects a replay of one already there (in production a Redis set with a TTL
 * just past the window; here an in-memory set is enough to prove the rule).
 */
export function verifyWebhook(
  secret: string,
  input: WebhookVerifyInput,
  options: { now?: number; seenNonces?: Set<string>; windowSeconds?: number } = {},
): WebhookVerifyResult {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const windowSeconds = options.windowSeconds ?? WEBHOOK_REPLAY_WINDOW_SECONDS;

  const timestampNumber = Number(input.timestamp);
  if (
    input.timestamp === undefined ||
    input.timestamp === '' ||
    !Number.isFinite(timestampNumber) ||
    !input.nonce ||
    !input.signature
  ) {
    return { ok: false, reason: 'malformed' };
  }

  if (Math.abs(now - timestampNumber) > windowSeconds) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  if (options.seenNonces?.has(input.nonce)) {
    return { ok: false, reason: 'replayed_nonce' };
  }

  const provided = input.signature.replace(/^sha256=/, '');
  const expected = computeSignature(secret, String(input.timestamp), input.nonce, input.body);
  // constantTimeEqual returns false (in constant time) on any length mismatch,
  // so a truncated or padded signature never short-circuits the comparison.
  if (!constantTimeEqual(expected, provided)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  options.seenNonces?.add(input.nonce);
  return { ok: true };
}
