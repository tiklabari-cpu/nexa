/**
 * The hosted API documentation says things the API must keep true (KN-04 · tm 376).
 *
 * The page (`/developers/docs`) shows a webhook verifier, a signature test vector
 * and the default rate limits. Each is written in the contract package and would
 * go quietly wrong if the signer or the limits moved. These tests hold them to the
 * real code — the signer in `signature.ts` and the defaults in `config/env.ts` —
 * so a change on either side turns this file red instead of misleading a
 * developer.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  buildPublicGuides,
  PUBLISHED_RATE_LIMITS,
  WEBHOOK_EXAMPLE_PATH,
  WEBHOOK_TEST_VECTOR,
} from '@siyahtus/contract';
import { describe, expect, it } from 'vitest';
import { envSchema } from '../../config/env.js';
import { computeSignature, signWebhook, verifyWebhook } from './signature.js';

interface ExampleVerifier {
  verifyWebhook(
    secret: string,
    delivery: { body: string; timestamp?: string; nonce?: string; signature?: string },
    options?: { now?: number; seenNonces?: Set<string> },
  ): { ok: true } | { ok: false; reason: string };
}

const example = (await import(pathToFileURL(WEBHOOK_EXAMPLE_PATH).href)) as ExampleVerifier;

const SECRET = 'whsec_docs_example';
const BODY = JSON.stringify({ action: 'chat_started', data: { chat_id: 'TJ1H8CFKRV' } });
const NOW = 1_700_000_000;

/** What the documented verifier and the real one say about the same delivery. */
function both(
  delivery: { body: string; timestamp?: string; nonce?: string; signature?: string },
  seen?: Set<string>,
): { documented: unknown; real: unknown } {
  const documented = example.verifyWebhook(SECRET, delivery, {
    now: NOW,
    ...(seen ? { seenNonces: new Set(seen) } : {}),
  });
  const real = verifyWebhook(
    SECRET,
    {
      body: delivery.body,
      timestamp: delivery.timestamp,
      nonce: delivery.nonce,
      signature: delivery.signature,
    },
    { now: NOW, ...(seen ? { seenNonces: new Set(seen) } : {}) },
  );
  return { documented, real };
}

describe('webhook signature example on the documentation page', () => {
  const signed = signWebhook(SECRET, BODY, { timestamp: NOW, nonce: 'nonce-1' });
  const delivery = {
    body: BODY,
    timestamp: signed.headers['X-Webhook-Timestamp'],
    nonce: signed.headers['X-Webhook-Nonce'],
    signature: signed.headers['X-Webhook-Signature'],
  };

  it('accepts what the real signer produced', () => {
    expect(both(delivery)).toEqual({ documented: { ok: true }, real: { ok: true } });
  });

  it('answers a tampered body, signature, timestamp and nonce like the real verifier', () => {
    const flipped = delivery.signature.replace(/.$/, (char) => (char === '0' ? '1' : '0'));
    for (const changed of [
      { ...delivery, body: `${BODY} ` },
      { ...delivery, signature: flipped },
      { ...delivery, nonce: 'nonce-2' },
      { ...delivery, timestamp: String(NOW + 1) },
    ]) {
      const { documented, real } = both(changed);
      expect(documented).toEqual({ ok: false, reason: 'invalid_signature' });
      expect(documented).toEqual(real);
    }
  });

  it('answers a stale timestamp, a replayed nonce and a missing header like the real verifier', () => {
    const old = signWebhook(SECRET, BODY, { timestamp: NOW - 301, nonce: 'nonce-old' });
    const stale = {
      body: BODY,
      timestamp: old.headers['X-Webhook-Timestamp'],
      nonce: old.headers['X-Webhook-Nonce'],
      signature: old.headers['X-Webhook-Signature'],
    };
    expect(both(stale)).toEqual({
      documented: { ok: false, reason: 'stale_timestamp' },
      real: { ok: false, reason: 'stale_timestamp' },
    });

    expect(both(delivery, new Set(['nonce-1']))).toEqual({
      documented: { ok: false, reason: 'replayed_nonce' },
      real: { ok: false, reason: 'replayed_nonce' },
    });

    const { documented, real } = both({ ...delivery, signature: undefined });
    expect(documented).toEqual({ ok: false, reason: 'malformed' });
    expect(documented).toEqual(real);
  });

  it('accepts the edge of the replay window and rejects one second past it', () => {
    for (const [offset, ok] of [
      [300, true],
      [301, false],
    ] as const) {
      const edge = signWebhook(SECRET, BODY, { timestamp: NOW - offset, nonce: `edge-${offset}` });
      const { documented, real } = both({
        body: BODY,
        timestamp: edge.headers['X-Webhook-Timestamp'],
        nonce: edge.headers['X-Webhook-Nonce'],
        signature: edge.headers['X-Webhook-Signature'],
      });
      expect((documented as { ok: boolean }).ok).toBe(ok);
      expect(documented).toEqual(real);
    }
  });

  it('publishes a test vector that the real signer reproduces', () => {
    const vector = WEBHOOK_TEST_VECTOR;
    expect(computeSignature(vector.secret, vector.timestamp, vector.nonce, vector.body)).toBe(
      vector.signature,
    );
    const guide = buildPublicGuides().find((entry) => entry.id === 'webhooks')!;
    expect(guide.markdown).toContain(`sha256=${vector.signature}`);
    expect(
      example.verifyWebhook(
        vector.secret,
        {
          body: vector.body,
          timestamp: vector.timestamp,
          nonce: vector.nonce,
          signature: `sha256=${vector.signature}`,
        },
        { now: Number(vector.timestamp) },
      ),
    ).toEqual({ ok: true });
  });

  it('shows the very file it tests, not a copy that can drift', () => {
    const guide = buildPublicGuides().find((entry) => entry.id === 'webhooks')!;
    expect(guide.markdown).toContain(readFileSync(WEBHOOK_EXAMPLE_PATH, 'utf8').trimEnd());
  });
});

describe('rate limits on the documentation page', () => {
  it('state the defaults the API actually ships with', () => {
    expect(PUBLISHED_RATE_LIMITS.agentPerMinute).toBe(
      envSchema.shape.RATE_LIMIT_AGENT_PER_MIN.parse(undefined),
    );
    expect(PUBLISHED_RATE_LIMITS.anonymousPerMinute).toBe(
      envSchema.shape.RATE_LIMIT_ANON_PER_MIN.parse(undefined),
    );
  });
});
