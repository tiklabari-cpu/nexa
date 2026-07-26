import { describe, expect, it } from 'vitest';
import {
  computeSignature,
  signWebhook,
  verifyWebhook,
  WEBHOOK_REPLAY_WINDOW_SECONDS,
} from './signature.js';

const SECRET = 'whsec_test_key_do_not_log';
const BODY = JSON.stringify({ action: 'chat_started', chat_id: 'TJ1H8CFKRV' });
// A fixed clock so timestamp maths is exact rather than relative to "now".
const NOW = 1_700_000_000;

describe('webhook signatures', () => {
  // --- Negative cases first: rejecting a forged or replayed delivery is the ---
  // --- entire point of signing (v2-04 §6.2).                                 ---

  it('rejects a tampered signature', () => {
    const signed = signWebhook(SECRET, BODY, { timestamp: NOW, nonce: 'n1' });
    const forged = signed.headers['X-Webhook-Signature'].replace(/.$/, (c) =>
      c === '0' ? '1' : '0',
    );

    const result = verifyWebhook(
      SECRET,
      { body: BODY, timestamp: NOW, nonce: 'n1', signature: forged },
      { now: NOW },
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a body that changed after signing', () => {
    const signed = signWebhook(SECRET, BODY, { timestamp: NOW, nonce: 'n1' });
    const result = verifyWebhook(
      SECRET,
      {
        body: BODY.replace('chat_started', 'chat_deactivated'),
        timestamp: NOW,
        nonce: 'n1',
        signature: signed.headers['X-Webhook-Signature'],
      },
      { now: NOW },
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects the wrong secret', () => {
    const signed = signWebhook(SECRET, BODY, { timestamp: NOW, nonce: 'n1' });
    const result = verifyWebhook(
      'whsec_a_different_key',
      { body: BODY, timestamp: NOW, nonce: 'n1', signature: signed.headers['X-Webhook-Signature'] },
      { now: NOW },
    );
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('rejects a timestamp outside the ±5-minute window', () => {
    const signed = signWebhook(SECRET, BODY, { timestamp: NOW, nonce: 'n1' });
    const stale = verifyWebhook(
      SECRET,
      { body: BODY, timestamp: NOW, nonce: 'n1', signature: signed.headers['X-Webhook-Signature'] },
      { now: NOW + WEBHOOK_REPLAY_WINDOW_SECONDS + 1 },
    );
    expect(stale).toEqual({ ok: false, reason: 'stale_timestamp' });

    // Symmetric: a timestamp too far in the future is refused too.
    const future = verifyWebhook(
      SECRET,
      { body: BODY, timestamp: NOW, nonce: 'n1', signature: signed.headers['X-Webhook-Signature'] },
      { now: NOW - WEBHOOK_REPLAY_WINDOW_SECONDS - 1 },
    );
    expect(future).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects a replayed nonce', () => {
    const seenNonces = new Set<string>();
    const signed = signWebhook(SECRET, BODY, { timestamp: NOW, nonce: 'n1' });
    const input = {
      body: BODY,
      timestamp: NOW,
      nonce: 'n1',
      signature: signed.headers['X-Webhook-Signature'],
    };

    const first = verifyWebhook(SECRET, input, { now: NOW, seenNonces });
    expect(first).toEqual({ ok: true });

    // The same delivery, captured and sent again, must not verify twice.
    const replay = verifyWebhook(SECRET, input, { now: NOW, seenNonces });
    expect(replay).toEqual({ ok: false, reason: 'replayed_nonce' });
  });

  it('rejects a delivery missing its signature headers', () => {
    expect(
      verifyWebhook(SECRET, { body: BODY, timestamp: undefined, nonce: 'n1', signature: 'x' }),
    ).toEqual({ ok: false, reason: 'malformed' });
    expect(
      verifyWebhook(SECRET, { body: BODY, timestamp: NOW, nonce: undefined, signature: 'x' }),
    ).toEqual({ ok: false, reason: 'malformed' });
    expect(
      verifyWebhook(SECRET, { body: BODY, timestamp: NOW, nonce: 'n1', signature: undefined }),
    ).toEqual({ ok: false, reason: 'malformed' });
  });

  // --- Then the positive path and its determinism. ---

  it('produces a deterministic signature for the same inputs', () => {
    const a = computeSignature(SECRET, String(NOW), 'n1', BODY);
    const b = computeSignature(SECRET, String(NOW), 'n1', BODY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('emits the three signature headers with the sha256= prefix', () => {
    const signed = signWebhook(SECRET, BODY, { timestamp: NOW, nonce: 'n1' });
    expect(signed.headers['X-Webhook-Timestamp']).toBe(String(NOW));
    expect(signed.headers['X-Webhook-Nonce']).toBe('n1');
    expect(signed.headers['X-Webhook-Signature']).toBe(
      `sha256=${computeSignature(SECRET, String(NOW), 'n1', BODY)}`,
    );
  });

  it('round-trips: a freshly signed delivery verifies', () => {
    const signed = signWebhook(SECRET, BODY, { timestamp: NOW });
    const result = verifyWebhook(
      SECRET,
      {
        body: signed.body,
        timestamp: signed.headers['X-Webhook-Timestamp'],
        nonce: signed.headers['X-Webhook-Nonce'],
        signature: signed.headers['X-Webhook-Signature'],
      },
      { now: NOW },
    );
    expect(result).toEqual({ ok: true });
  });

  it('mints a unique nonce per delivery when none is supplied', () => {
    const first = signWebhook(SECRET, BODY);
    const second = signWebhook(SECRET, BODY);
    expect(first.headers['X-Webhook-Nonce']).not.toBe(second.headers['X-Webhook-Nonce']);
  });
});
