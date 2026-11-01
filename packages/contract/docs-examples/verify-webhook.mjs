// Verify a SiyahTuş webhook delivery (Node 18+, no dependencies).
//
// Every delivery is signed:  HMAC-SHA256(secret, "{timestamp}.{nonce}.{body}")
// and carries three headers: X-Webhook-Timestamp, X-Webhook-Nonce, X-Webhook-Signature
// (the last one is "sha256=<hex>"). Verify against the RAW request body — the exact
// bytes received — not a re-serialised copy of the parsed JSON.
import { createHmac, timingSafeEqual } from 'node:crypto';

const WINDOW_SECONDS = 300;

/**
 * @param {string} secret   The signing secret returned once when the webhook was registered.
 * @param {{ body: string, timestamp?: string, nonce?: string, signature?: string }} delivery
 * @param {{ now?: number, seenNonces?: Set<string> }} [options]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyWebhook(secret, delivery, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const { body, timestamp, nonce, signature } = delivery;

  if (!timestamp || !nonce || !signature || !Number.isFinite(Number(timestamp))) {
    return { ok: false, reason: 'malformed' };
  }
  // 1. Reject anything outside the replay window (5 minutes either side).
  if (Math.abs(now - Number(timestamp)) > WINDOW_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  // 2. Reject a nonce you have already accepted. Keep seen nonces for a little over
  //    the window (a Redis set with a TTL works); a Set is enough for a demo.
  if (options.seenNonces?.has(nonce)) {
    return { ok: false, reason: 'replayed_nonce' };
  }
  // 3. Recompute the signature and compare in constant time.
  const expected = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  const provided = signature.replace(/^sha256=/, '');
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  options.seenNonces?.add(nonce);
  return { ok: true };
}

// Express example — note `express.raw`, which keeps the body as received:
//
//   app.post('/siyahtus-webhook', express.raw({ type: 'application/json' }), (req, res) => {
//     const result = verifyWebhook(process.env.SIYAHTUS_WEBHOOK_SECRET, {
//       body: req.body.toString('utf8'),
//       timestamp: req.get('X-Webhook-Timestamp'),
//       nonce: req.get('X-Webhook-Nonce'),
//       signature: req.get('X-Webhook-Signature'),
//     }, { seenNonces });
//     if (!result.ok) return res.status(401).json({ error: result.reason });
//     const event = JSON.parse(req.body.toString('utf8')); // { action, data }
//     res.sendStatus(200);
//   });
