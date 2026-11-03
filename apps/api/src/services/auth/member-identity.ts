/**
 * Operator-signed member identity (SiyahTuş analysis ID-03, the operator's way
 * in · owner decision K28 · tm 388 · docs/adr/member-recognition.md §11).
 *
 * The operator's server signs the logged-in member's id with the workspace's
 * identity secret; the page hands the signature to `siyahtus('identify', …)`;
 * the widget sends it with `POST /customer/token`. This file is the secret and
 * the check of one signature — its shape, its HMAC, its age and that it was
 * not used before. What a verified identity *means* for a request (which
 * customer it makes the visitor) is `member-recognition.ts`.
 *
 * **The secret** is generated here and shown to the admin once. It is stored
 * sealed — AES-256-GCM in `lib/credential-cipher.ts`'s format, its additional
 * data binding it to the licence and the version — under a key-encryption key
 * derived from `CUSTOMER_TOKEN_SECRET` with its own HKDF label, the
 * member-token key's pattern (`member-token.ts`) without sharing its key. A
 * database dump verifies nothing. Unlike the member-token key it cannot be
 * replaced silently when it does not open: the operator's server holds the
 * other copy, so an admin has to issue a new one.
 *
 * **The check**, in order: the shape (so the message can be built at all),
 * the signature (current secret, then the one a rotation is phasing out —
 * both in constant time), the age (against the database's clock, the one
 * every other time in member recognition is read from), and last the replay
 * record, which is spent only on a signature valid in every other respect:
 * a stream of forged identities cannot burn the record of one still in
 * flight. The replay record is Redis `SET NX PX` and fails **closed** — the
 * SAML guard's reasoning (`lib/saml.ts`): accepting replays for the length of
 * an outage would be an authentication bypass with a known start time.
 *
 * Nothing here logs the secret, the signature or the member's id; the caller
 * logs a refusal's reason and the licence, and counts it per day for the
 * settings screen ({@link IdentityLedger}).
 */
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import {
  MEMBER_IDENTITY_SECRET_PREFIX,
  MEMBER_IDENTITY_STATS_DAYS,
  SIGNED_IDENTITY_LIMITS,
  isSignedIdentityRefusal,
  signedIdentityMessage,
  type SignedIdentityRefusal,
} from '@siyahtus/types';
import { decryptCredential, encryptCredential } from '../../lib/credential-cipher.js';
import { constantTimeEqual } from '../../lib/crypto.js';

/**
 * Domain separation for the key-encryption key. Changing it makes every stored
 * secret unreadable — every workspace would have to issue a new one and
 * redeploy it on its servers. Do not.
 */
const KEK_INFO = 'siyahtus/member-identity/secret-encryption/v1';

/** A fresh identity secret: the prefix and 256 random bits, the string the operator stores. */
export function newIdentitySecret(): string {
  return `${MEMBER_IDENTITY_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** The additional data that binds a sealed secret to its licence and version. */
export function identitySecretAad(licenseId: bigint, version: number): string {
  return `member-identity:${licenseId.toString()}:${version}`;
}

export class IdentitySecretCodec {
  /** Hex, the form `credential-cipher.ts` takes. */
  readonly #kek: string;

  constructor(customerTokenSecret: string) {
    if (customerTokenSecret.length < 32) {
      throw new Error('CUSTOMER_TOKEN_SECRET must be at least 32 characters.');
    }
    this.#kek = Buffer.from(
      hkdfSync('sha256', customerTokenSecret, Buffer.alloc(0), KEK_INFO, 32),
    ).toString('hex');
  }

  /** Seal a secret for `member_identity_secrets`. */
  seal(licenseId: bigint, version: number, secret: string): string {
    return encryptCredential(secret, this.#kek, identitySecretAad(licenseId, version));
  }

  /**
   * Open a sealed secret. Throws `CredentialDecryptError` for anything that
   * does not open: another licence's row, the other slot's version, an edited
   * ciphertext, a changed `CUSTOMER_TOKEN_SECRET`.
   */
  open(licenseId: bigint, version: number, sealed: string): string {
    return decryptCredential(sealed, this.#kek, identitySecretAad(licenseId, version));
  }
}

/** A signed identity whose shape checked out — not yet believed. */
export interface IdentityClaim {
  userId: string;
  username: string | null;
  email: string | null;
  /** Unix seconds, as signed. */
  ts: number;
  /** The signature, lowercase hex. */
  hash: string;
}

/** Any C0 control character or DEL: one would let a value carry a line break into the next field's place. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const HASH_RE = /^[0-9a-f]{64}$/i;
/** Loose on purpose: the operator vouched for the address; this only refuses what cannot be one. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
/** Seconds since 1970 up to the year 33658 — what a 12-digit decimal can hold. */
const TS_TEXT_RE = /^[0-9]{1,12}$/;

/**
 * The claim in what the widget relayed from the page, or null when it is not
 * the shape a signature can be checked against. Lenient in what it reads (a
 * `ts` sent as a string of digits is the same number), strict in what it
 * accepts: no control character anywhere, every bound of
 * {@link SIGNED_IDENTITY_LIMITS}, a 64-digit hex signature. An empty username
 * or e-mail is an absent one — both sign as an empty line.
 */
export function parseIdentityClaim(raw: unknown): IdentityClaim | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;

  const userId = value['user_id'];
  if (typeof userId !== 'string' || userId === '') return null;
  if (userId.length > SIGNED_IDENTITY_LIMITS.userIdMaxLength || CONTROL_RE.test(userId)) {
    return null;
  }

  const username = optionalText(value['username'], SIGNED_IDENTITY_LIMITS.usernameMaxLength);
  const email = optionalText(value['email'], SIGNED_IDENTITY_LIMITS.emailMaxLength);
  if (username === undefined || email === undefined) return null;
  if (email !== null && !EMAIL_RE.test(email)) return null;

  const rawTs = value['ts'];
  const ts =
    typeof rawTs === 'number'
      ? rawTs
      : typeof rawTs === 'string' && TS_TEXT_RE.test(rawTs)
        ? Number(rawTs)
        : Number.NaN;
  if (!Number.isSafeInteger(ts) || ts < 0) return null;

  const hash = value['user_hash'];
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return null;

  return { userId, username, email, ts, hash: hash.toLowerCase() };
}

/** `null` for absent or empty, `undefined` for a value that disqualifies the claim. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max || CONTROL_RE.test(value)) return undefined;
  return value;
}

/**
 * The signature the operator's server makes for a claim — HMAC-SHA256 keyed
 * with the secret string, over `signedIdentityMessage`, lowercase hex. The
 * reference for the documentation and the tests; the check below compares
 * against it.
 */
export function signIdentity(
  secret: string,
  fields: { userId: string; username?: string | null; email?: string | null; ts: number },
): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(
      signedIdentityMessage({
        user_id: fields.userId,
        username: fields.username ?? null,
        email: fields.email ?? null,
        ts: fields.ts,
      }),
      'utf8',
    )
    .digest('hex');
}

/**
 * Whether one of `secrets` made the claim's signature. Every secret is tried,
 * in constant time each, whichever matches — the time taken says nothing
 * about which one did, or whether the first one did.
 */
export function identitySignatureMatches(
  claim: IdentityClaim,
  secrets: readonly string[],
): boolean {
  let matched = false;
  for (const secret of secrets) {
    if (constantTimeEqual(signIdentity(secret, claim), claim.hash)) matched = true;
  }
  return matched;
}

/**
 * Whether a signature made at `ts` (seconds) is still within its life at
 * `nowMs`: at most `maxAgeSeconds` old, at most `maxFutureSkewSeconds` ahead
 * of this clock (the operator's may run a little fast).
 */
export function identityAge(ts: number, nowMs: number): 'ok' | 'expired' | 'future' {
  const tsMs = ts * 1000;
  if (tsMs > nowMs + SIGNED_IDENTITY_LIMITS.maxFutureSkewSeconds * 1000) return 'future';
  if (tsMs < nowMs - SIGNED_IDENTITY_LIMITS.maxAgeSeconds * 1000) return 'expired';
  return 'ok';
}

/** The slice of a Redis client the ledger uses — structural, so a test can hand it a fake. */
export interface IdentityLedgerStore {
  set(
    key: string,
    value: string,
    px: 'PX',
    ttlMs: number,
    nx: 'NX',
  ): Promise<string | null | undefined>;
  hincrby(key: string, field: string, increment: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
}

/** What the settings screen shows: the last {@link MEMBER_IDENTITY_STATS_DAYS} days' signed identities. */
export interface MemberIdentityStatsView {
  days: number;
  verified: number;
  refused: Partial<Record<SignedIdentityRefusal, number>>;
}

/** One day's counters live a day longer than the window that reads them. */
const STATS_KEY_TTL_SECONDS = (MEMBER_IDENTITY_STATS_DAYS + 1) * 86_400;

/**
 * Redis-backed: the replay record of accepted signatures and the per-day
 * counters of every outcome.
 */
export class IdentityLedger {
  constructor(private readonly store: IdentityLedgerStore) {}

  /**
   * Spend the replay record of a signature already valid in every other
   * respect: true the first time, false for a signature accepted before.
   * Throws when Redis cannot answer, and the caller refuses the identity
   * (`replay_unchecked`) — never accepts it unchecked.
   *
   * The record outlives the signature: kept until the signature's own last
   * acceptable moment plus the future skew again, so a Redis clock running a
   * little faster than the database's cannot drop it while the signature
   * would still pass the age check.
   */
  async claim(licenseId: bigint, claim: IdentityClaim, nowMs: number): Promise<boolean> {
    const lastAcceptedMs = (claim.ts + SIGNED_IDENTITY_LIMITS.maxAgeSeconds) * 1000;
    const ttlMs = Math.max(
      1_000,
      lastAcceptedMs - nowMs + SIGNED_IDENTITY_LIMITS.maxFutureSkewSeconds * 1000,
    );
    const written = await this.store.set(
      `member-identity:seen:${licenseId.toString()}:${claim.hash}`,
      String(nowMs),
      'PX',
      ttlMs,
      'NX',
    );
    return written != null;
  }

  /** Count one outcome for the licence's day. Best-effort: a counter is never worth a failed mint. */
  async record(
    licenseId: bigint,
    outcome: 'verified' | SignedIdentityRefusal,
    at: Date = new Date(),
  ): Promise<void> {
    const key = statsKey(licenseId, at);
    try {
      await this.store.hincrby(key, outcome, 1);
      await this.store.expire(key, STATS_KEY_TTL_SECONDS);
    } catch {
      // The screen reads "could not be read" rather than a wrong number.
    }
  }

  /** The window's counters, or null when they cannot be read. */
  async read(licenseId: bigint, at: Date = new Date()): Promise<MemberIdentityStatsView | null> {
    const view: MemberIdentityStatsView = {
      days: MEMBER_IDENTITY_STATS_DAYS,
      verified: 0,
      refused: {},
    };
    try {
      for (let day = 0; day < MEMBER_IDENTITY_STATS_DAYS; day += 1) {
        const date = new Date(at.getTime() - day * 86_400_000);
        const counts = await this.store.hgetall(statsKey(licenseId, date));
        for (const [field, text] of Object.entries(counts)) {
          const count = Number(text);
          if (!Number.isSafeInteger(count) || count <= 0) continue;
          if (field === 'verified') view.verified += count;
          else if (isSignedIdentityRefusal(field)) {
            view.refused[field] = (view.refused[field] ?? 0) + count;
          }
        }
      }
    } catch {
      return null;
    }
    return view;
  }
}

/** One licence's counters for one UTC day. */
function statsKey(licenseId: bigint, at: Date): string {
  return `member-identity:stats:${licenseId.toString()}:${at.toISOString().slice(0, 10)}`;
}
