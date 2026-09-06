/**
 * The idempotency key a purchase attempt carries (FR-MOD-10.1.4).
 *
 * `POST /billing/ai-packages` buys once per key: send the same key again and
 * the server replays the first sale instead of charging twice. That makes the
 * key the client's half of the double-submit guarantee, and it has two rules
 * that pull in opposite directions —
 *
 *   * it must stay **the same** while one purchase is being attempted, so a
 *     retry after a timeout cannot buy a second time; and
 *   * it must be **new** once that purchase has landed, or the next deliberate
 *     purchase would be silently swallowed as a replay of the last one.
 *
 * Hence a generated value held in state and rotated on success only — never on
 * error, which is exactly when a retry needs the old one.
 *
 * The server validates the key as a UUID (a format is cheaper to enforce than
 * "please make it unique"), so the fallbacks below produce UUID *shapes*, not
 * merely random strings. Anything else would be rejected on a browser without
 * `crypto.randomUUID` — which is the only reason a fallback exists at all;
 * `randomUUID` needs a secure context, and the console is served over plain
 * HTTP in local development.
 */

/** Random bytes, from the platform CSPRNG where there is one. */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
      return bytes;
    }
  } catch {
    // fall through to Math.random
  }
  // Last resort. Collisions here cost a *refused* duplicate purchase, never a
  // duplicated one — a key that repeats reads as a replay — so a weaker source
  // fails in the safe direction.
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** A v4 UUID assembled by hand, for runtimes without `crypto.randomUUID`. */
function uuidFromBytes(): string {
  const bytes = randomBytes(16);
  // Version 4 and the RFC 4122 variant, so the value passes a strict validator
  // rather than merely looking like a UUID.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A fresh key identifying one purchase attempt. */
export function newAttemptKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the hand-rolled UUID
  }
  return uuidFromBytes();
}
