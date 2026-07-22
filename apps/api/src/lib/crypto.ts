/**
 * Credential primitives.
 *
 * Two different hashing strategies, for two genuinely different threats:
 *
 *   Passwords are low-entropy and human-chosen, so a leaked hash must be
 *   expensive to attack offline → scrypt with deliberately costly parameters.
 *
 *   Tokens we generate ourselves carry 256 bits of entropy. There is nothing to
 *   guess, so a slow KDF would only add latency to every authenticated request
 *   → a single SHA-256, which also lets us look tokens up by hash in one
 *   indexed query.
 *
 * scrypt (RFC 7914) is used rather than argon2id purely because it ships in the
 * Node standard library: no native module to fail at install time, which for a
 * security primitive is worth more than the marginal difference between two
 * well-regarded memory-hard KDFs.
 */
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type BinaryLike,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * ~64 MiB and ~100 ms per hash on commodity hardware. N is the cost parameter;
 * maxmem must be raised past Node's 32 MiB default or scrypt refuses to run.
 */
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 32, maxmem: 128 * 1024 * 1024 } as const;
const SCRYPT_PREFIX = 'scrypt';

// --- Passwords --------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(
    password.normalize('NFKC'),
    salt,
    SCRYPT_PARAMS.keylen,
    SCRYPT_PARAMS,
  );
  // Parameters travel with the hash so they can be raised later without
  // invalidating existing passwords.
  return [
    SCRYPT_PREFIX,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // No password set (SSO-only account). Burn comparable time anyway so the
    // response does not reveal which accounts have passwords.
    await hashPassword(password);
    return false;
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  let salt: Buffer;
  try {
    salt = Buffer.from(rawSalt, 'base64url');
    expected = Buffer.from(rawHash, 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0 || salt.length === 0) return false;

  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return constantTimeEqual(derived, expected);
}

// --- Tokens -----------------------------------------------------------------

/** 256 bits, base64url — safe in headers, query strings and Basic auth. */
export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/** Opaque tokens are high-entropy, so a fast digest is the correct choice. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

export function constantTimeEqual(a: Buffer | string, b: Buffer | string): boolean {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(a, 'utf8');
  const right = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length. Compare digests of equal size instead so every path costs the same.
  if (left.length !== right.length) {
    const l = createHash('sha256').update(left).digest();
    const r = createHash('sha256').update(right).digest();
    timingSafeEqual(l, r);
    return false;
  }
  return timingSafeEqual(left, right);
}

// --- PKCE (RFC 7636) --------------------------------------------------------

export const PKCE_VERIFIER_MIN = 43;
export const PKCE_VERIFIER_MAX = 128;

/** Unreserved characters only, per RFC 7636 §4.1. */
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier);
}

/** S256 only — OAuth 2.1 removes the `plain` method. */
export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function verifyCodeChallenge(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  return constantTimeEqual(deriveCodeChallenge(verifier), challenge);
}

// --- Webhook signatures (HMAC-SHA256) — used from slice 9 -------------------

export function generateClientId(): string {
  return randomBytes(16).toString('hex');
}
