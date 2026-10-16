/**
 * Member tokens (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.2).
 *
 * How a returning visitor is recognised: `POST /customer/token` signs a member
 * token, the widget keeps it (a partitioned cookie, its localStorage as the
 * fallback), and the next mint believes nothing else. The bare `customer_id`
 * the widget used to keep identifies a record; it never authenticated anybody,
 * and whoever learned a member's id could open their conversation with it.
 *
 * This file is the token itself — the format, the signature and the sealing of
 * the key that makes it. What a token *means* for a request (which customer,
 * revoked or not, adopted from a bare id) is `member-recognition.ts`.
 *
 * Format: `nxm1.<kid>.<body>.<sig>`.
 *
 *   - `kid` is the version of the licence's key that signed it, in the clear,
 *     so the verifier picks the key before reading anything else. The body is
 *     never parsed before its signature checks out — the rule
 *     `customer-token.ts` keeps — and the key a token names cannot be swapped
 *     either: `kid` is inside what the signature covers.
 *   - `body` is base64url JSON ({@link MemberTokenClaims}).
 *   - `sig` is HMAC-SHA256 over `nxm1.<kid>.<body>` with that licence's key,
 *     compared in constant time.
 *
 * The key is per licence, not the deployment's `CUSTOMER_TOKEN_SECRET`: each
 * workspace can rotate its own (Settings › Security › Member recognition)
 * without forgetting every other workspace's members. It is stored sealed —
 * AES-256-GCM in `lib/credential-cipher.ts`'s format, its additional data
 * binding the ciphertext to the licence and the version — under a
 * key-encryption key derived from `CUSTOMER_TOKEN_SECRET` (HKDF, its own
 * `info`), so a dump of the database signs nothing and no new environment key
 * is needed to boot.
 */
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { decryptCredential, encryptCredential } from '../../lib/credential-cipher.js';
import { constantTimeEqual } from '../../lib/crypto.js';

/** Tells a member token from every other signed string the platform makes. */
export const MEMBER_TOKEN_PREFIX = 'nxm1';

/** The claims format this code writes and accepts. */
export const MEMBER_TOKEN_FORMAT = 1;

/** Bytes of a licence's signing key. */
const KEY_BYTES = 32;

/**
 * Domain separation for the key-encryption key. Changing it makes every stored
 * key unreadable, which the mint treats as a key to replace — every member of
 * every workspace would start again as a new visitor. Do not.
 */
const KEK_INFO = 'siyahtus/member-token/key-encryption/v1';

/** A key version as it may appear in a token: a positive int32, no leading zero. */
const KID_RE = /^[1-9][0-9]{0,9}$/;

/** Longest member token accepted for parsing — the contract's `maxLength`. */
export const MEMBER_TOKEN_MAX_LENGTH = 4096;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MemberTokenClaims {
  /** The customer — the member this browser is. */
  sub: string;
  /** The licence whose key signed it, as a string because JSON has no bigint. */
  lic: string;
  /**
   * This browser's number, drawn at random when the browser was first
   * recognised and carried unchanged through every re-signing.
   */
  did: string;
  /**
   * When this browser's run of tokens began (ms since epoch): the first mint
   * for `did`, carried unchanged through every re-signing. A revocation is
   * compared against this, not against `iat` — otherwise a mint that read the
   * token just before a revocation committed and re-signed it just after would
   * hand back a token the revocation never refuses.
   */
  oat: number;
  /** When this signature was made (ms since epoch, the database clock). */
  iat: number;
  /** When it stops being accepted (ms since epoch) unless re-signed first. */
  exp: number;
  /** The claims format ({@link MEMBER_TOKEN_FORMAT}). */
  ver: number;
}

/** A token split into its parts, not yet verified. */
export interface ParsedMemberToken {
  kid: number;
  body: string;
  signature: string;
}

/** A fresh browser number: 128 random bits. */
export function newDeviceId(): string {
  return randomBytes(16).toString('base64url');
}

/** A fresh licence signing key. */
export function newSigningKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** The additional data that binds a sealed key to its licence and version. */
export function memberKeyAad(licenseId: bigint, version: number): string {
  return `member-token:${licenseId.toString()}:${version}`;
}

export class MemberTokenCodec {
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

  /** Seal a signing key for `member_token_keys` (`key_ciphertext`). */
  sealKey(licenseId: bigint, version: number, key: Buffer): string {
    return encryptCredential(
      key.toString('base64url'),
      this.#kek,
      memberKeyAad(licenseId, version),
    );
  }

  /**
   * Open a sealed signing key. Throws `CredentialDecryptError` for anything
   * that does not open: another licence's row, the other slot's version, an
   * edited ciphertext, a changed `CUSTOMER_TOKEN_SECRET`.
   */
  openKey(licenseId: bigint, version: number, sealed: string): Buffer {
    const key = Buffer.from(
      decryptCredential(sealed, this.#kek, memberKeyAad(licenseId, version)),
      'base64url',
    );
    if (key.length !== KEY_BYTES) throw new Error('member-token signing key has the wrong length');
    return key;
  }

  sign(claims: MemberTokenClaims, key: Buffer, kid: number): string {
    const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
    const signed = `${MEMBER_TOKEN_PREFIX}.${kid}.${body}`;
    return `${signed}.${hmac(key, signed)}`;
  }

  /** Split a presented token, or null when it is not one at all. */
  parse(token: string): ParsedMemberToken | null {
    if (token.length > MEMBER_TOKEN_MAX_LENGTH) return null;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== MEMBER_TOKEN_PREFIX) return null;
    const [, kid, body, signature] = parts as [string, string, string, string];
    if (!KID_RE.test(kid) || body === '' || signature === '') return null;
    const version = Number(kid);
    if (version > 2_147_483_647) return null;
    return { kid: version, body, signature };
  }

  /** Whether `key` made this signature. Constant time in the signature. */
  verifySignature(parsed: ParsedMemberToken, key: Buffer): boolean {
    const signed = `${MEMBER_TOKEN_PREFIX}.${parsed.kid}.${parsed.body}`;
    return constantTimeEqual(hmac(key, signed), parsed.signature);
  }

  /**
   * The claims of a token whose signature has already been verified, or null
   * when they are not the shape this code writes. Only ever called after
   * {@link verifySignature}: an unauthenticated body is never parsed.
   */
  readClaims(parsed: ParsedMemberToken): MemberTokenClaims | null {
    let claims: Partial<MemberTokenClaims>;
    try {
      claims = JSON.parse(
        Buffer.from(parsed.body, 'base64url').toString('utf8'),
      ) as Partial<MemberTokenClaims>;
    } catch {
      return null;
    }
    if (claims === null || typeof claims !== 'object') return null;
    const { sub, lic, did, oat, iat, exp, ver } = claims;
    if (typeof sub !== 'string' || !UUID_RE.test(sub)) return null;
    if (typeof lic !== 'string' || !/^\d+$/.test(lic)) return null;
    if (typeof did !== 'string' || did === '') return null;
    for (const at of [oat, iat, exp]) {
      if (typeof at !== 'number' || !Number.isSafeInteger(at)) return null;
    }
    if (ver !== MEMBER_TOKEN_FORMAT) return null;
    return { sub, lic, did, oat: oat!, iat: iat!, exp: exp!, ver };
  }
}

function hmac(key: Buffer, signed: string): string {
  return createHmac('sha256', key).update(signed).digest('base64url');
}
