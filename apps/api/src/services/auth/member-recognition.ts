/**
 * Member recognition (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.2) —
 * which customer a widget's `POST /customer/token` speaks for, and the
 * licence's controls over that: the signing key and its rotation, the
 * revocation list, the token lifetime. The token format is `member-token.ts`;
 * the decision record is `docs/adr/member-recognition.md`.
 *
 * Every method runs inside the caller's tenant transaction (`withTenant`): the
 * four tables are RLS-scoped to the licence (`member_token_*`,
 * `member_recognition_settings`) or the organization (`customers`).
 *
 * **One clock.** Every time compared here comes from the database —
 * `clock_timestamp()` read at the start of the mint, `revoked_at` written as
 * `clock_timestamp()`, a rotation's deadline computed in SQL. The API's own
 * clock and the database's drift apart (a Docker Desktop VM after a sleep, two
 * replicas with their own NTP), and a revocation compared across two clocks
 * can let a token minted *before* it through.
 *
 * **Revocation is by when a browser's run of tokens began** (`oat`), not by when
 * the token in hand was signed: a revocation refuses a member's tokens and
 * every re-signing of them. The ordering guarantee that makes this exact rather
 * than approximate: a revocation takes its time *after* locking the customer
 * row(s) it closes, and an adoption reads its time *before* the update that
 * claims the row — so an adoption either commits first and is refused by the
 * revocation, or finds the window already closed.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { MemberTokenKey } from '@prisma/client';
import { MEMBER_TOKEN_TTL, type IdentityTrust } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import {
  MEMBER_TOKEN_FORMAT,
  newDeviceId,
  newSigningKey,
  type MemberTokenClaims,
  type MemberTokenCodec,
} from './member-token.js';

/**
 * Why a presented member token was not believed. Logged with the licence,
 * never shown: every one of them is answered exactly like a first visit, so
 * the response cannot be used to tell a forged token from an expired one.
 */
export type MemberTokenRefusal =
  /** Not a member token at all, or claims this code does not write. */
  | 'malformed'
  /** Names a key version this licence does not have. */
  | 'unknown_key'
  /** Signed by the key a rotation replaced, after its grace period. */
  | 'key_retired'
  | 'bad_signature'
  | 'expired'
  /** Signed for another licence than the one the embedding origin resolved to. */
  | 'license_mismatch'
  | 'revoked'
  /** The customer it names no longer exists here (erased, or another organization). */
  | 'customer_gone';

/** Where a credential arrived from. */
export type MemberTokenSource = 'cookie' | 'body';

export interface MemberRefusal {
  source: MemberTokenSource | 'customer_id';
  /** `not_adoptable`: a bare `customer_id` outside the transition window (§5). */
  reason: MemberTokenRefusal | 'not_adoptable';
}

export interface MemberResolution {
  customerId: string;
  /**
   * How the request reached `customerId`: a valid member token, the one-time
   * adoption of a customer from before member tokens, or a new anonymous one.
   */
  via: 'token' | 'adopted' | 'created';
  /** Whether that customer is banned — the caller refuses, inside the transaction. */
  banned: boolean;
  /** The member token re-signed (or first signed) for this browser. */
  memberToken: string;
  expiresAt: Date;
  /** The licence's token lifetime it was signed for — the cookie's `Max-Age`. */
  ttlSeconds: number;
  /** Credentials presented and not believed, for the caller's log. */
  refusals: MemberRefusal[];
}

/**
 * What each way of reaching the customer proves about the visitor (tm 294 ·
 * AI-02, K4) — signed into their customer token and carried to the AI job that
 * answers them. A member token this workspace signed is the member; a new
 * customer is nobody else's; a bare `customer_id` adopted once was a claim the
 * browser made, never a signature, so the AI recalls nothing in detail for it.
 */
export const MEMBER_IDENTITY_TRUST: Readonly<Record<MemberResolution['via'], IdentityTrust>> = {
  token: 'verified',
  created: 'session',
  adopted: 'claimed',
};

/** Settings › Security › Member recognition, as the contract shapes it. */
export interface MemberRecognitionView {
  token_ttl_seconds: number;
  possible_matches_enabled: boolean;
  key: {
    version: number;
    created_at: string;
    previous_version: number | null;
    previous_valid_until: string | null;
  } | null;
  tokens_revoked_before: string | null;
  updated_at: string | null;
}

export interface MemberTokenRevocationView {
  customer_id: string | null;
  revoked_at: string;
}

interface SigningKeys {
  version: number;
  key: Buffer;
  /** The key a rotation replaced, while its grace period lasts (null when it does not open). */
  previous: { version: number; key: Buffer | null } | null;
  /** A replaced key whose grace period is over — named only to log `key_retired`. */
  retiredVersion: number | null;
}

type Verification =
  { ok: true; claims: MemberTokenClaims } | { ok: false; reason: MemberTokenRefusal };

export class MemberRecognitionService {
  constructor(private readonly codec: MemberTokenCodec) {}

  /**
   * The customer a `POST /customer/token` request speaks for, and the member
   * token to hand its browser — K4's "imza → süre → lisans → iptal listesi".
   *
   *   1. A presented member token (the caller has already preferred the cookie
   *      over the body) is checked in order: signature, expiry, licence,
   *      revocation list, and the customer still being there. Valid: that
   *      customer, and the token is re-signed for the licence's lifetime with
   *      its browser number and run start kept (sliding renewal).
   *   2. Otherwise a bare `customer_id` adopts its customer only inside the
   *      transition window — once, for a customer that existed before member
   *      tokens (`customers.member_adoptable_until`).
   *   3. Otherwise a new anonymous customer.
   *
   * Paths 2 and 3 begin a new run (new browser number, `oat` now). A refusal
   * on the way is recorded in `refusals`, never thrown: the caller answers it
   * exactly as it answers a first visit.
   */
  async resolve(
    tx: TenantClient,
    input: {
      licenseId: bigint;
      organizationId: string;
      presented: { token: string; source: MemberTokenSource } | null;
      /** The id a widget from before member tokens kept, if it sent one. */
      customerId?: string;
      log: FastifyBaseLogger;
    },
  ): Promise<MemberResolution> {
    const { licenseId } = input;
    const { now, ttlSeconds } = await readClockAndTtl(tx, licenseId);
    const keys = await this.#signingKeys(tx, licenseId, now, input.log);
    const refusals: MemberRefusal[] = [];

    let resolved: { customerId: string; banned: boolean; via: MemberResolution['via'] } | null =
      null;
    let run: { did: string; oat: number } | null = null;

    if (input.presented) {
      const verified = this.#verify(input.presented.token, keys, now, licenseId);
      let refusal: MemberTokenRefusal | null = verified.ok ? null : verified.reason;
      if (verified.ok) {
        const { claims } = verified;
        if (await isRevoked(tx, licenseId, claims.sub, claims.oat)) {
          refusal = 'revoked';
        } else {
          const customer = await tx.customer.findFirst({
            where: { id: claims.sub },
            select: { id: true, bannedAt: true },
          });
          if (!customer) {
            refusal = 'customer_gone';
          } else {
            resolved = {
              customerId: customer.id,
              banned: customer.bannedAt !== null,
              via: 'token',
            };
            run = { did: claims.did, oat: claims.oat };
          }
        }
      }
      if (refusal) refusals.push({ source: input.presented.source, reason: refusal });
    }

    if (!resolved && input.customerId) {
      // The transition (docs/adr/member-recognition.md §5): one trade of a bare
      // id for a member token, claimed by the UPDATE itself so two requests
      // racing for the same id cannot both win. The time was read above,
      // before this claim — the ordering a revocation relies on.
      const adopted = await tx.$queryRaw<Array<{ id: string; banned_at: Date | null }>>`
        UPDATE customers
        SET member_adoptable_until = NULL
        WHERE id = ${input.customerId}::uuid
          AND member_adoptable_until > clock_timestamp()
        RETURNING id, banned_at`;
      const customer = adopted[0];
      if (customer) {
        resolved = { customerId: customer.id, banned: customer.banned_at !== null, via: 'adopted' };
      } else {
        refusals.push({ source: 'customer_id', reason: 'not_adoptable' });
      }
    }

    if (!resolved) {
      const created = await tx.customer.create({
        data: { organizationId: input.organizationId, lastActivityAt: new Date() },
        select: { id: true },
      });
      resolved = { customerId: created.id, banned: false, via: 'created' };
    }

    const issuedAt = now.getTime();
    const expiresAt = issuedAt + ttlSeconds * 1000;
    const memberToken = this.codec.sign(
      {
        sub: resolved.customerId,
        lic: licenseId.toString(),
        did: run?.did ?? newDeviceId(),
        oat: run?.oat ?? issuedAt,
        iat: issuedAt,
        exp: expiresAt,
        ver: MEMBER_TOKEN_FORMAT,
      },
      keys.key,
      keys.version,
    );

    return { ...resolved, memberToken, expiresAt: new Date(expiresAt), ttlSeconds, refusals };
  }

  /** The settings screen's view. Reading creates nothing — not even a key. */
  async view(tx: TenantClient, licenseId: bigint): Promise<MemberRecognitionView> {
    // One after another: a transaction is one connection, so nothing is gained
    // by issuing these together.
    const settings = await tx.memberRecognitionSettings.findUnique({ where: { licenseId } });
    const key = await tx.memberTokenKey.findUnique({ where: { licenseId } });
    const bulk = await tx.memberTokenRevocation.findFirst({
      where: { licenseId, customerId: null },
      orderBy: { revokedAt: 'desc' },
      select: { revokedAt: true },
    });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const now = clock!.now;
    return {
      token_ttl_seconds: settings?.tokenTtlSeconds ?? MEMBER_TOKEN_TTL.defaultSeconds,
      possible_matches_enabled: settings?.possibleMatchesEnabled ?? true,
      key: key ? describeKey(key, now) : null,
      tokens_revoked_before: bulk?.revokedAt.toISOString() ?? null,
      updated_at: settings?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * Replace the licence's signing key. The replaced key stays accepted for
   * `graceSeconds` — its members are re-signed under the new one when they
   * visit — and `0` retires it at once. One previous slot: a rotation inside
   * the window drops the oldest key now. With no key yet, this creates the
   * first. Returns the old and new versions for the audit entry.
   */
  async rotate(
    tx: TenantClient,
    licenseId: bigint,
    graceSeconds: number,
  ): Promise<{ version: number; previousVersion: number | null }> {
    // Locked, so two rotations in flight cannot both read version n and both
    // write n + 1 — the second waits and rotates what the first wrote.
    const [current] = await tx.$queryRaw<
      Array<{ key_version: number; key_ciphertext: string }>
    >`SELECT key_version, key_ciphertext FROM member_token_keys
      WHERE license_id = ${licenseId} FOR UPDATE`;

    if (!current) {
      const sealed = this.codec.sealKey(licenseId, 1, newSigningKey());
      await tx.$executeRaw`
        INSERT INTO member_token_keys (license_id, key_version, key_ciphertext, key_created_at)
        VALUES (${licenseId}, 1, ${sealed}, clock_timestamp())
        ON CONFLICT (license_id) DO NOTHING`;
      // A first mint racing this one created the row meanwhile: rotate that.
      const created = await tx.memberTokenKey.findUniqueOrThrow({ where: { licenseId } });
      if (created.keyCiphertext !== sealed) return this.rotate(tx, licenseId, graceSeconds);
      return { version: 1, previousVersion: null };
    }

    const version = current.key_version + 1;
    const sealed = this.codec.sealKey(licenseId, version, newSigningKey());
    // The replaced key moves with its own version, so its additional data
    // still matches and it opens from the other slot.
    if (graceSeconds > 0) {
      await tx.$executeRaw`
        UPDATE member_token_keys
        SET previous_key_version = key_version,
            previous_key_ciphertext = key_ciphertext,
            previous_key_valid_until =
              clock_timestamp() + make_interval(secs => ${graceSeconds}::double precision),
            key_version = ${version},
            key_ciphertext = ${sealed},
            key_created_at = clock_timestamp()
        WHERE license_id = ${licenseId}`;
    } else {
      await tx.$executeRaw`
        UPDATE member_token_keys
        SET previous_key_version = NULL,
            previous_key_ciphertext = NULL,
            previous_key_valid_until = NULL,
            key_version = ${version},
            key_ciphertext = ${sealed},
            key_created_at = clock_timestamp()
        WHERE license_id = ${licenseId}`;
    }
    return { version, previousVersion: graceSeconds > 0 ? current.key_version : null };
  }

  /**
   * Refuse every member token this licence has issued so far, and close the
   * transition window for the whole organization: "forget every returning
   * visitor" includes the ones who have not traded their old id in yet.
   */
  async revokeAll(
    tx: TenantClient,
    input: { licenseId: bigint; revokedBy: string | null },
  ): Promise<MemberTokenRevocationView> {
    // Locks every row still in the window first, so an adoption in flight
    // either commits before this takes its time (and is refused by it) or finds
    // the window closed.
    await tx.$executeRaw`
      UPDATE customers SET member_adoptable_until = NULL
      WHERE member_adoptable_until IS NOT NULL`;
    return insertRevocation(tx, { ...input, customerId: null });
  }

  /**
   * Refuse every member token this licence has issued to one customer so far.
   * Null when the customer is not this organization's (the route's 404).
   */
  async revokeCustomer(
    tx: TenantClient,
    input: { licenseId: bigint; customerId: string; revokedBy: string | null },
  ): Promise<MemberTokenRevocationView | null> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers WHERE id = ${input.customerId}::uuid FOR UPDATE`;
    if (locked.length === 0) return null;
    await tx.$executeRaw`
      UPDATE customers SET member_adoptable_until = NULL
      WHERE id = ${input.customerId}::uuid AND member_adoptable_until IS NOT NULL`;
    return insertRevocation(tx, input);
  }

  #verify(token: string, keys: SigningKeys, now: Date, licenseId: bigint): Verification {
    const parsed = this.codec.parse(token);
    if (!parsed) return { ok: false, reason: 'malformed' };

    let key: Buffer | null;
    if (parsed.kid === keys.version) {
      key = keys.key;
    } else if (keys.previous && parsed.kid === keys.previous.version) {
      key = keys.previous.key;
    } else if (parsed.kid === keys.retiredVersion) {
      return { ok: false, reason: 'key_retired' };
    } else {
      return { ok: false, reason: 'unknown_key' };
    }
    if (!key || !this.codec.verifySignature(parsed, key)) {
      return { ok: false, reason: 'bad_signature' };
    }

    const claims = this.codec.readClaims(parsed);
    if (!claims) return { ok: false, reason: 'malformed' };
    if (claims.exp <= now.getTime()) return { ok: false, reason: 'expired' };
    if (claims.lic !== licenseId.toString()) return { ok: false, reason: 'license_mismatch' };
    return { ok: true, claims };
  }

  /**
   * The licence's keys, creating the first lazily. A current key that does
   * not open — `CUSTOMER_TOKEN_SECRET` changed, or the row was edited — is
   * replaced by a new version (logged): its members start again as new
   * visitors, which is the only honest outcome once nobody can read the key.
   */
  async #signingKeys(
    tx: TenantClient,
    licenseId: bigint,
    now: Date,
    log: FastifyBaseLogger,
  ): Promise<SigningKeys> {
    let row = await tx.memberTokenKey.findUnique({ where: { licenseId } });
    if (!row) {
      await tx.$executeRaw`
        INSERT INTO member_token_keys (license_id, key_version, key_ciphertext, key_created_at)
        VALUES (${licenseId}, 1, ${this.codec.sealKey(licenseId, 1, newSigningKey())}, clock_timestamp())
        ON CONFLICT (license_id) DO NOTHING`;
      // Whichever insert won — ours or a concurrent first mint's — is the key.
      row = await tx.memberTokenKey.findUniqueOrThrow({ where: { licenseId } });
    }

    let key = this.#tryOpen(licenseId, row.keyVersion, row.keyCiphertext);
    if (!key) {
      const version = row.keyVersion + 1;
      await tx.$executeRaw`
        UPDATE member_token_keys
        SET key_version = ${version},
            key_ciphertext = ${this.codec.sealKey(licenseId, version, newSigningKey())},
            key_created_at = clock_timestamp(),
            previous_key_version = NULL,
            previous_key_ciphertext = NULL,
            previous_key_valid_until = NULL
        WHERE license_id = ${licenseId} AND key_version = ${row.keyVersion}`;
      log.warn(
        { license_id: licenseId.toString(), key_version: row.keyVersion },
        'member-token signing key could not be opened; replaced it',
      );
      row = await tx.memberTokenKey.findUniqueOrThrow({ where: { licenseId } });
      key = this.#tryOpen(licenseId, row.keyVersion, row.keyCiphertext);
      if (!key) throw new Error('member-token signing key could not be opened after replacing it');
    }

    let previous: SigningKeys['previous'] = null;
    let retiredVersion: number | null = null;
    if (row.previousKeyVersion !== null && row.previousKeyValidUntil !== null) {
      if (row.previousKeyValidUntil > now) {
        previous = {
          version: row.previousKeyVersion,
          key: row.previousKeyCiphertext
            ? this.#tryOpen(licenseId, row.previousKeyVersion, row.previousKeyCiphertext)
            : null,
        };
      } else {
        retiredVersion = row.previousKeyVersion;
      }
    }
    return { version: row.keyVersion, key, previous, retiredVersion };
  }

  #tryOpen(licenseId: bigint, version: number, sealed: string): Buffer | null {
    try {
      return this.codec.openKey(licenseId, version, sealed);
    } catch {
      return null;
    }
  }
}

/** The database's clock, and the licence's token lifetime (the default with no row). */
async function readClockAndTtl(
  tx: TenantClient,
  licenseId: bigint,
): Promise<{ now: Date; ttlSeconds: number }> {
  const [row] = await tx.$queryRaw<Array<{ now: Date; ttl: number | null }>>`
    SELECT clock_timestamp() AS now,
           (SELECT token_ttl_seconds FROM member_recognition_settings
             WHERE license_id = ${licenseId}) AS ttl`;
  return { now: row!.now, ttlSeconds: row!.ttl ?? MEMBER_TOKEN_TTL.defaultSeconds };
}

/**
 * Whether a revocation for this member, or for every member, came at or after
 * the moment this browser's run of tokens began. `>=`: a run that began in the
 * same instant as a revocation is refused — the safe side of a tie.
 */
async function isRevoked(
  tx: TenantClient,
  licenseId: bigint,
  customerId: string,
  runStartedAt: number,
): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ revoked: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM member_token_revocations
      WHERE license_id = ${licenseId}
        AND (customer_id = ${customerId}::uuid OR customer_id IS NULL)
        AND revoked_at >= ${new Date(runStartedAt).toISOString()}::timestamptz
    ) AS revoked`;
  return row!.revoked;
}

async function insertRevocation(
  tx: TenantClient,
  input: { licenseId: bigint; customerId: string | null; revokedBy: string | null },
): Promise<MemberTokenRevocationView> {
  // `clock_timestamp()`, not the column default: `CURRENT_TIMESTAMP` is when
  // this transaction began — before the row locks above were granted.
  const [row] = await tx.$queryRaw<Array<{ customer_id: string | null; revoked_at: Date }>>`
    INSERT INTO member_token_revocations (id, license_id, customer_id, revoked_at, revoked_by)
    VALUES (${randomUUID()}::uuid, ${input.licenseId}, ${input.customerId}::uuid,
            clock_timestamp(), ${input.revokedBy}::uuid)
    RETURNING customer_id, revoked_at`;
  return { customer_id: row!.customer_id, revoked_at: row!.revoked_at.toISOString() };
}

/** The key, described — the previous one only while it is still accepted. */
function describeKey(key: MemberTokenKey, now: Date): NonNullable<MemberRecognitionView['key']> {
  const previousLive =
    key.previousKeyVersion !== null &&
    key.previousKeyValidUntil !== null &&
    key.previousKeyValidUntil > now;
  return {
    version: key.keyVersion,
    created_at: key.keyCreatedAt.toISOString(),
    previous_version: previousLive ? key.previousKeyVersion : null,
    previous_valid_until: previousLive ? key.previousKeyValidUntil!.toISOString() : null,
  };
}
