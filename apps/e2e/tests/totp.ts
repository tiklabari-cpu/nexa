/**
 * An authenticator, for the root panel's sign-in (tm 389.6).
 *
 * RFC 6238 over RFC 4226 — HMAC-SHA1, six digits, thirty-second steps — written out again here
 * rather than imported from `apps/api/src/lib/totp.ts`: the e2e package has no dependency on the
 * api package, and an independent implementation is also the stronger check. If the server's code
 * and this one ever disagreed about the algorithm, the sign-in spec would fail on the first code.
 */
import { createHmac } from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, case- and space-insensitive, as the enrolment screen shows it. */
export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/[\s=-]/g, '').toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const symbol of clean) {
    const value = BASE32.indexOf(symbol);
    if (value < 0) throw new Error('not a base32 secret');
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** The thirty-second step `now` (ms since the epoch) falls in. */
export function stepOf(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

/** The six-digit code of `secret` for `step` (default: the current one). */
export function totpCode(secret: string, step: number = stepOf()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * The code of the first step after `usedStep`, waiting for the clock to reach it.
 *
 * The server accepts a code once: replaying one, even within its thirty seconds, is a 401. After a
 * code was used (enrolment consumes one), the next sign-in needs the next step's, which is at most
 * thirty seconds away.
 */
export async function nextTotpCode(secret: string, usedStep: number): Promise<string> {
  while (stepOf() <= usedStep) {
    const untilNextStep = (usedStep + 1) * TOTP_PERIOD_SECONDS * 1000 - Date.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(untilNextStep, 50) + 100));
  }
  return totpCode(secret);
}
