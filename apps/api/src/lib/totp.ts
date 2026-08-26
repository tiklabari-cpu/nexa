/**
 * TOTP — the arithmetic core of the second authentication factor (NFR-S11).
 *
 * RFC 4226 (HOTP) supplies the one-way function: an HMAC over a counter,
 * dynamically truncated down to a short decimal code. RFC 6238 (TOTP) supplies
 * the counter: how many 30-second steps have elapsed since the Unix epoch.
 * Everything in this file is pure — no database, no clock of its own — so the
 * enrollment and login paths layered on top (S11-2FA-c … -e) stay in charge of
 * when a code is produced and what gets persisted afterwards.
 *
 * Nothing was installed for this. `crypto.ts` already argues the case: a
 * security primitive the Node standard library can express is not worth a
 * third-party package whose supply chain would then get a vote on whether a
 * login succeeds. An HMAC and a modulo are the entire algorithm.
 *
 * Three decisions are worth stating outright, because each is a place where an
 * implementation that looks conventional is quietly broken:
 *
 *   **±1 step of drift, and no more.** A verifier has to tolerate the skew
 *   between a phone's clock and ours, so the previous and next steps are
 *   accepted alongside the current one — up to 90 seconds in the worst case.
 *   Going wider is the usual "be forgiving" mistake: every extra step adds
 *   another live code for an online guesser to hit, and by three steps the
 *   window is long enough that a code read over someone's shoulder is still
 *   good. The bound is a module constant rather than a parameter exactly so
 *   that no caller can widen it without editing this file.
 *
 *   **The replay guard is not optional.** A code stays valid for its whole step
 *   and, thanks to the drift above, for one more — so a code that was phished,
 *   shoulder-surfed or replayed off a proxied login page can be spent a second
 *   time within about a minute. That is *the* known weakness of the scheme, and
 *   RFC 6238 §5.2 names the remedy: refuse any step at or before the last one
 *   accepted. `verifyTotp` returns the step it matched precisely so the caller
 *   can write it to `account_two_factor.last_used_step` before letting the
 *   login continue.
 *
 *   **Comparison is constant-time.** The code is six characters and the
 *   attacker picks them, so a byte-by-byte early exit would hand out the
 *   correct prefix one request at a time.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { constantTimeEqual } from './crypto.js';

/** 30-second steps and 6 digits: what every authenticator app assumes. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/** Accepted skew on either side of the current step. See the header. */
export const TOTP_DRIFT_STEPS = 1;

/**
 * SHA-1 is pinned. Not because it is the strongest digest on offer, but because
 * HMAC-SHA1 is untouched by the collision attacks that retired SHA-1 for
 * signatures, and because authenticator apps (Google Authenticator among them)
 * ignore the `algorithm` parameter of an otpauth URI — enrolling a SHA-256
 * secret would produce an app that generates plausible codes which never match,
 * with no error anywhere to explain why.
 */
export const TOTP_ALGORITHM = 'sha1';

/** 160 bits, the size RFC 4226 §4 R6 recommends. */
export const TOTP_SECRET_BYTES = 20;

/** 128 bits is the RFC 4226 floor; anything shorter is not a TOTP secret. */
const MIN_SECRET_BYTES = 16;

/**
 * Only the RFC test vectors ever use anything but the pinned SHA-1: RFC 6238
 * publishes values for all three digests, and running all of them is what
 * proves the dynamic truncation below reads the right bytes out of a digest of
 * *any* length.
 */
export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

/** A secret that will not decode is corrupt storage, not bad user input. */
export class TotpSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TotpSecretError';
  }
}

// --- Base32 (RFC 4648) ------------------------------------------------------
//
// Not the Crockford alphabet `@nexa/types` uses for chat IDs. That one drops
// I, L, O and U so an ID survives being read aloud, which makes it a different
// encoding with a different symbol table. Authenticator apps decode RFC 4648
// base32, upper case and unpadded, so the secret has to be exactly that.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * People retype secrets off a screen, so whitespace and the grouping dashes
 * some UIs insert are stripped, case is lifted, and `=` padding is tolerated
 * even though we never emit it.
 */
function normalizeBase32(input: string): string {
  return input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
}

export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET.charAt((buffer >>> bits) & 0b11111);
    }
  }
  // A trailing partial symbol is zero-padded. RFC 4648 would then add `=` up to
  // a multiple of eight characters, which the otpauth consumers reject.
  if (bits > 0) out += BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 0b11111);
  return out;
}

export function base32Decode(secret: string): Buffer {
  const normalized = normalizeBase32(secret);
  if (normalized.length === 0) throw new TotpSecretError('base32 secret is empty');

  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const symbol of normalized) {
    const value = BASE32_ALPHABET.indexOf(symbol);
    // The message deliberately does not quote the offending character: this
    // string is the secret itself, and error messages end up in logs.
    if (value < 0) {
      throw new TotpSecretError('base32 secret contains a character outside RFC 4648');
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 0xff);
    }
  }
  // Whatever is left over has to be the zero padding `base32Encode` wrote. A
  // non-zero remainder means the string was mangled rather than merely
  // re-cased, and decoding it anyway would silently yield a different key — an
  // enrollment that appears to work and then never verifies.
  if ((buffer & ((1 << bits) - 1)) !== 0) {
    throw new TotpSecretError('base32 secret has non-zero padding bits');
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

export function isValidTotpSecret(secret: string): boolean {
  try {
    return base32Decode(secret).length >= MIN_SECRET_BYTES;
  } catch {
    return false;
  }
}

// --- HOTP / TOTP ------------------------------------------------------------

export interface CodeOptions {
  /** Defaults to `TOTP_DIGITS`; the RFC vectors are published at 8. */
  digits?: number;
  /** Defaults to the pinned `TOTP_ALGORITHM`; see its comment. */
  algorithm?: TotpAlgorithm;
}

export interface TotpOptions extends CodeOptions {
  period?: number;
}

export function hotp(key: Buffer, counter: number | bigint, options: CodeOptions = {}): string {
  const digits = options.digits ?? TOTP_DIGITS;
  const value = typeof counter === 'bigint' ? counter : BigInt(Math.trunc(counter));
  if (value < 0n) throw new RangeError('HOTP counter cannot be negative');

  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(value);
  const digest = createHmac(options.algorithm ?? TOTP_ALGORITHM, key)
    .update(message)
    .digest();

  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the final byte chooses
  // where in the digest the code is read from, so *which* bits reach the user
  // depends on the key. Masking the top bit keeps the 32-bit read unsigned
  // without depending on the platform integer width.
  const offset = digest.readUInt8(digest.length - 1) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * The step counter for a moment in time.
 *
 * `nowMs` is a parameter and never a `Date.now()` read from inside: the RFC
 * 6238 test vectors are timestamps, so a hidden clock would make them
 * unrunnable, and a login path is far easier to reason about when the instant
 * it judged is visible at the call site.
 */
export function totpStep(nowMs: number, period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / period);
}

export function generateTotpForStep(
  secret: string,
  step: number,
  options: TotpOptions = {},
): string {
  return hotp(base32Decode(secret), step, options);
}

export function generateTotp(secret: string, nowMs: number, options: TotpOptions = {}): string {
  const step = totpStep(nowMs, options.period ?? TOTP_PERIOD_SECONDS);
  return generateTotpForStep(secret, step, options);
}

export type TotpVerification =
  { ok: true; step: number } | { ok: false; reason: 'malformed' | 'mismatch' | 'replayed' };

export interface TotpVerifyInput {
  secret: string;
  /** Whatever the user typed; spaces and dashes are forgiven, letters are not. */
  code: string;
  nowMs: number;
  /** `account_two_factor.last_used_step` — null before the first accepted code. */
  lastUsedStep?: number | bigint | null;
}

const CODE_RE = new RegExp(`^\\d{${TOTP_DIGITS}}$`);

/**
 * Verify a code and, on success, report the step it belonged to.
 *
 * The caller **must** persist that step — and refuse a concurrent login that
 * would spend the same one — before the session is issued. This function is
 * pure, so it can only tell you a code has already been used if you tell it
 * what was used last.
 *
 * Throws `TotpSecretError` when the stored secret will not decode. That is not
 * a failed login but a corrupt row, and reporting it as "wrong code" would lock
 * an account out leaving nothing behind to say why.
 */
export function verifyTotp({
  secret,
  code,
  nowMs,
  lastUsedStep = null,
}: TotpVerifyInput): TotpVerification {
  const normalized = code.replace(/[\s-]/g, '');
  if (!CODE_RE.test(normalized)) return { ok: false, reason: 'malformed' };

  const key = base32Decode(secret);
  const current = totpStep(nowMs);
  const floor = lastUsedStep == null ? null : Number(lastUsedStep);

  // Every candidate is computed and compared with no early exit. Which step
  // matched — or whether the code was right but already spent — is not
  // something the response time should give away.
  //
  // Should two steps somehow produce the same code (one chance in a million per
  // pair), the later one wins: it pushes the replay floor as far forward as the
  // evidence allows.
  let matched: number | null = null;
  for (let step = current - TOTP_DRIFT_STEPS; step <= current + TOTP_DRIFT_STEPS; step += 1) {
    if (step < 0) continue;
    if (constantTimeEqual(hotp(key, step), normalized)) matched = step;
  }

  if (matched === null) return { ok: false, reason: 'mismatch' };
  if (floor !== null && matched <= floor) return { ok: false, reason: 'replayed' };
  return { ok: true, step: matched };
}

// --- otpauth URI ------------------------------------------------------------

export interface OtpauthUriInput {
  /** The site, as the authenticator app will list it — "Nexa". */
  issuer: string;
  /** Which account on that site; the e-mail address. */
  accountName: string;
  secret: string;
}

/**
 * Build the `otpauth://totp/…` URI an authenticator app imports.
 *
 * The parameters are pinned rather than exposed: a URI whose `digits` or
 * `algorithm` disagreed with what `verifyTotp` computes would enroll an app
 * that produces plausible codes which never match.
 */
export function buildOtpauthUri({ issuer, accountName, secret }: OtpauthUriInput): string {
  const site = issuer.trim();
  const account = accountName.trim();
  if (site.length === 0) throw new TypeError('otpauth URI needs an issuer');
  if (account.length === 0) throw new TypeError('otpauth URI needs an account name');
  if (!isValidTotpSecret(secret)) {
    throw new TotpSecretError('otpauth URI needs a valid base32 secret');
  }

  // The issuer appears twice on purpose: the label prefix is what older apps
  // read, the query parameter is what the current key-uri spec defines, and an
  // app that reads both shows a duplicated name when they disagree. Each
  // component is percent-encoded on its own — the `:` between them is the
  // separator, so an issuer or address containing one must not manufacture a
  // second.
  //
  // Built by hand rather than with URLSearchParams, which encodes a space as
  // `+`; otpauth consumers read that literally and the account name grows plus
  // signs.
  const label = `${encodeURIComponent(site)}:${encodeURIComponent(account)}`;
  const params = [
    `secret=${encodeURIComponent(normalizeBase32(secret))}`,
    `issuer=${encodeURIComponent(site)}`,
    `algorithm=${TOTP_ALGORITHM.toUpperCase()}`,
    `digits=${TOTP_DIGITS}`,
    `period=${TOTP_PERIOD_SECONDS}`,
  ];
  return `otpauth://totp/${label}?${params.join('&')}`;
}
