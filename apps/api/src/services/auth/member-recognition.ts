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
 *
 * **The operator's way in (K28 · tm 388).** A workspace that turned signed
 * identity on and issued a secret also believes the operator's server: a valid
 * signed identity (`member-identity.ts`) makes the visitor the customer that
 * carries that member id in the organization — on whatever device, ahead of
 * the browser's own token. The first time, the browser's own customer takes
 * the id if it carries none; otherwise a new customer does. Off, an identity
 * is ignored and everything above is exactly K4.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { MemberIdentitySecret, MemberTokenKey } from '@prisma/client';
import { MEMBER_TOKEN_TTL, type IdentityTrust, type SignedIdentityRefusal } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import {
  identityAge,
  identitySignatureMatches,
  newIdentitySecret,
  parseIdentityClaim,
  type IdentityClaim,
  type IdentityLedger,
  type IdentitySecretCodec,
  type MemberIdentityStatsView,
} from './member-identity.js';
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

export type MemberRefusal =
  | {
      source: MemberTokenSource | 'customer_id';
      /** `not_adoptable`: a bare `customer_id` outside the transition window (§5). */
      reason: MemberTokenRefusal | 'not_adoptable';
    }
  | {
      /** An operator-signed identity (tm 388), refused for `reason`. */
      source: 'identity';
      reason: SignedIdentityRefusal;
    };

/**
 * An operator-signed identity, checked (`verifyIdentity`): the claim it makes
 * and whether it is believed. A refused one is ignored by `resolve` — logged
 * and counted, never answered.
 */
export type IdentityCheck = (
  | { ok: true; claim: IdentityClaim }
  | { ok: false; reason: SignedIdentityRefusal; claim: IdentityClaim | null }
) & {
  /** The database's clock when it was checked — the day its outcome is counted on. */
  checkedAt: Date;
};

export interface MemberResolution {
  customerId: string;
  /**
   * How the request reached `customerId`: a valid operator-signed identity
   * (tm 388), a valid member token, the one-time adoption of a customer from
   * before member tokens, or a new anonymous one.
   */
  via: 'identity' | 'token' | 'adopted' | 'created';
  /** Whether that customer is banned — the caller refuses, inside the transaction. */
  banned: boolean;
  /**
   * Whether that customer is a member the operator's site vouched for — in
   * this request or an earlier one (`customers.platform_user_id`). A property
   * of the customer, so a refused identity and none at all answer alike.
   */
  identityVerified: boolean;
  /** Whether its username is the one the operator signed: the pre-chat form stops asking. */
  usernameVerified: boolean;
  /**
   * Whether the presented member token was believed — the browser keeps it,
   * so a cookie that carried it is working (the caller leaves the body copy out).
   */
  tokenBelieved: boolean;
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
  // The operator's site vouched for the member (K28): at least what a token
  // this workspace signed proves.
  identity: 'verified',
  token: 'verified',
  created: 'session',
  adopted: 'claimed',
};

/** A key or secret described — never the key itself. */
interface SecretDescription {
  version: number;
  created_at: string;
  previous_version: number | null;
  previous_valid_until: string | null;
}

/** Settings › Security › Member recognition, as the contract shapes it. */
export interface MemberRecognitionView {
  token_ttl_seconds: number;
  possible_matches_enabled: boolean;
  key: SecretDescription | null;
  tokens_revoked_before: string | null;
  signed_identity: {
    enabled: boolean;
    /** On and a secret exists: identify calls are verified. */
    active: boolean;
    secret: SecretDescription | null;
    recent: MemberIdentityStatsView | null;
  };
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
  constructor(
    private readonly codec: MemberTokenCodec,
    /** The operator-signed identity's secret and its Redis ledger (tm 388). */
    private readonly identity: { codec: IdentitySecretCodec; ledger: IdentityLedger },
  ) {}

  /** The replay record and the per-day counters of signed identities. */
  get identityLedger(): IdentityLedger {
    return this.identity.ledger;
  }

  /**
   * Check an operator-signed identity (tm 388), in its own short tenant
   * transaction before the mint's: the licence's switch and secrets, the shape,
   * the signature, the age against the database's clock, and — last, so only a
   * signature valid in every other respect spends it — the replay record.
   * Never throws for anything the request carried: a refusal is a value the
   * mint ignores.
   */
  async verifyIdentity(
    tx: TenantClient,
    input: { licenseId: bigint; raw: unknown; log: FastifyBaseLogger },
  ): Promise<IdentityCheck> {
    const claim = parseIdentityClaim(input.raw);
    const [row] = await tx.$queryRaw<Array<{ now: Date; enabled: boolean | null }>>`
      SELECT clock_timestamp() AS now,
             (SELECT signed_identity_enabled FROM member_recognition_settings
               WHERE license_id = ${input.licenseId}) AS enabled`;
    const checkedAt = row!.now;
    const refuse = (reason: SignedIdentityRefusal): IdentityCheck => ({
      ok: false,
      reason,
      claim,
      checkedAt,
    });
    if (row!.enabled !== true) return refuse('disabled');
    // Before the secrets are read and opened: what cannot be checked costs a
    // query, not a decryption.
    if (!claim) return refuse('malformed');

    const secrets = await this.#identitySecrets(tx, input.licenseId, checkedAt, input.log);
    if (secrets.length === 0) return refuse('disabled');
    if (!identitySignatureMatches(claim, secrets)) return refuse('bad_signature');
    const age = identityAge(claim.ts, checkedAt.getTime());
    if (age !== 'ok') return refuse(age);

    let fresh: boolean;
    try {
      fresh = await this.identity.ledger.claim(input.licenseId, claim, checkedAt.getTime());
    } catch (error) {
      input.log.warn(
        { err: error, license_id: input.licenseId.toString() },
        'signed identity replay record unreachable; refused it',
      );
      return refuse('replay_unchecked');
    }
    return fresh ? { ok: true, claim, checkedAt } : refuse('replayed');
  }

  /**
   * The customer a `POST /customer/token` request speaks for, and the member
   * token to hand its browser — K4's "imza → süre → lisans → iptal listesi".
   *
   *   0. A verified operator-signed identity (`identity`, tm 388) wins: the
   *      customer carrying that member id in this organization, else the
   *      browser's own token customer if it carries no other member's, else a
   *      new one ({@link #resolveVerified}). The browser's run continues when
   *      that is the token's own customer, and starts again otherwise.
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
   * exactly as it answers a first visit. A refused identity changes nothing
   * else about the request — the K4 path below runs as if it had not come.
   */
  async resolve(
    tx: TenantClient,
    input: {
      licenseId: bigint;
      organizationId: string;
      presented: { token: string; source: MemberTokenSource } | null;
      /** The id a widget from before member tokens kept, if it sent one. */
      customerId?: string;
      /** The operator-signed identity, already checked (`verifyIdentity`), if one came. */
      identity?: IdentityCheck | null;
      log: FastifyBaseLogger;
    },
  ): Promise<MemberResolution> {
    const { licenseId } = input;
    const { now, ttlSeconds } = await readClockAndTtl(tx, licenseId);
    const keys = await this.#signingKeys(tx, licenseId, now, input.log);
    const refusals: MemberRefusal[] = [];

    let resolved: {
      customerId: string;
      banned: boolean;
      via: MemberResolution['via'];
      identityVerified: boolean;
      usernameVerified: boolean;
    } | null = null;
    let run: { did: string; oat: number } | null = null;
    /** The customer a valid member token names: the browser's own record. */
    let browser: {
      id: string;
      bannedAt: Date | null;
      platformUserId: string | null;
      usernameVerified: boolean;
    } | null = null;

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
            select: { id: true, bannedAt: true, platformUserId: true, usernameVerified: true },
          });
          if (!customer) {
            refusal = 'customer_gone';
          } else {
            browser = customer;
            run = { did: claims.did, oat: claims.oat };
          }
        }
      }
      if (refusal) refusals.push({ source: input.presented.source, reason: refusal });
    }

    const identity = input.identity ?? null;
    if (identity?.ok) {
      const member = await this.#resolveVerified(tx, {
        organizationId: input.organizationId,
        claim: identity.claim,
        browser,
        now,
      });
      resolved = {
        customerId: member.id,
        banned: member.bannedAt !== null,
        via: 'identity',
        identityVerified: true,
        usernameVerified: member.usernameVerified,
      };
      // Another record than the browser's own: a new run, so a revocation of
      // that member is measured from now rather than from this browser's past.
      if (!browser || browser.id !== member.id) run = null;
    } else {
      if (identity && !identity.ok) {
        // The same browser sending the same signature again (a re-mint in the
        // page that consumed it) is not a replay anyone needs to hear about:
        // its token already speaks for the member that signature names.
        const resent =
          identity.reason === 'replayed' &&
          identity.claim !== null &&
          browser?.platformUserId === identity.claim.userId;
        if (!resent) refusals.push({ source: 'identity', reason: identity.reason });
      }
      if (browser) {
        resolved = {
          customerId: browser.id,
          banned: browser.bannedAt !== null,
          via: 'token',
          identityVerified: browser.platformUserId !== null,
          usernameVerified: browser.usernameVerified,
        };
      }
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
        // A customer from before member tokens never carried a member id:
        // signed identity arrived after the window opened.
        resolved = {
          customerId: customer.id,
          banned: customer.banned_at !== null,
          via: 'adopted',
          identityVerified: false,
          usernameVerified: false,
        };
      } else {
        refusals.push({ source: 'customer_id', reason: 'not_adoptable' });
      }
    }

    if (!resolved) {
      const created = await tx.customer.create({
        data: { organizationId: input.organizationId, lastActivityAt: new Date() },
        select: { id: true },
      });
      resolved = {
        customerId: created.id,
        banned: false,
        via: 'created',
        identityVerified: false,
        usernameVerified: false,
      };
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

    return {
      ...resolved,
      tokenBelieved: browser !== null,
      memberToken,
      expiresAt: new Date(expiresAt),
      ttlSeconds,
      refusals,
    };
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
    const secret = await tx.memberIdentitySecret.findUnique({ where: { licenseId } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const now = clock!.now;
    const signedIdentityEnabled = settings?.signedIdentityEnabled ?? false;
    return {
      token_ttl_seconds: settings?.tokenTtlSeconds ?? MEMBER_TOKEN_TTL.defaultSeconds,
      possible_matches_enabled: settings?.possibleMatchesEnabled ?? true,
      key: key ? describeKey(key, now) : null,
      tokens_revoked_before: bulk?.revokedAt.toISOString() ?? null,
      signed_identity: {
        enabled: signedIdentityEnabled,
        active: signedIdentityEnabled && secret !== null,
        secret: secret ? describeSecret(secret, now) : null,
        recent: await this.identity.ledger.read(licenseId),
      },
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
   * Issue the licence's identity secret, or replace it (tm 388) — the one
   * moment the secret leaves the server, returned for the response alone. The
   * replaced secret stays accepted for `graceSeconds` while the operator
   * deploys the new one; `0` retires it at once. One previous slot, like the
   * member-token key: a rotation inside the window drops the oldest now.
   */
  async rotateIdentitySecret(
    tx: TenantClient,
    licenseId: bigint,
    graceSeconds: number,
  ): Promise<{ secret: string; version: number; previousVersion: number | null }> {
    // Locked, so two rotations in flight cannot both write version n + 1.
    const [current] = await tx.$queryRaw<Array<{ secret_version: number }>>`
      SELECT secret_version FROM member_identity_secrets
      WHERE license_id = ${licenseId} FOR UPDATE`;
    const secret = newIdentitySecret();

    if (!current) {
      const sealed = this.identity.codec.seal(licenseId, 1, secret);
      const inserted = await tx.$executeRaw`
        INSERT INTO member_identity_secrets
          (license_id, secret_version, secret_ciphertext, secret_created_at)
        VALUES (${licenseId}, 1, ${sealed}, clock_timestamp())
        ON CONFLICT (license_id) DO NOTHING`;
      // Another first issue won the race meanwhile: rotate what it wrote.
      if (inserted === 0) return this.rotateIdentitySecret(tx, licenseId, graceSeconds);
      return { secret, version: 1, previousVersion: null };
    }

    const version = current.secret_version + 1;
    const sealed = this.identity.codec.seal(licenseId, version, secret);
    // The replaced secret moves with its own version, so its additional data
    // still matches and it opens from the other slot.
    if (graceSeconds > 0) {
      await tx.$executeRaw`
        UPDATE member_identity_secrets
        SET previous_secret_version = secret_version,
            previous_secret_ciphertext = secret_ciphertext,
            previous_secret_valid_until =
              clock_timestamp() + make_interval(secs => ${graceSeconds}::double precision),
            secret_version = ${version},
            secret_ciphertext = ${sealed},
            secret_created_at = clock_timestamp()
        WHERE license_id = ${licenseId}`;
    } else {
      await tx.$executeRaw`
        UPDATE member_identity_secrets
        SET previous_secret_version = NULL,
            previous_secret_ciphertext = NULL,
            previous_secret_valid_until = NULL,
            secret_version = ${version},
            secret_ciphertext = ${sealed},
            secret_created_at = clock_timestamp()
        WHERE license_id = ${licenseId}`;
    }
    return {
      secret,
      version,
      previousVersion: graceSeconds > 0 ? current.secret_version : null,
    };
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

  /**
   * The secrets a signature may be made with now: the current one, and the
   * one a rotation replaced while its window lasts. A secret that does not
   * open (`CUSTOMER_TOKEN_SECRET` changed, the row edited) is left out and
   * logged — unlike the member-token key it cannot be replaced silently, since
   * the operator's server holds the other copy; an admin issues a new one.
   */
  async #identitySecrets(
    tx: TenantClient,
    licenseId: bigint,
    now: Date,
    log: FastifyBaseLogger,
  ): Promise<string[]> {
    const row = await tx.memberIdentitySecret.findUnique({ where: { licenseId } });
    if (!row) return [];
    const slots: Array<{ version: number; sealed: string }> = [
      { version: row.secretVersion, sealed: row.secretCiphertext },
    ];
    if (
      row.previousSecretVersion !== null &&
      row.previousSecretCiphertext !== null &&
      row.previousSecretValidUntil !== null &&
      row.previousSecretValidUntil > now
    ) {
      slots.push({ version: row.previousSecretVersion, sealed: row.previousSecretCiphertext });
    }
    const secrets: string[] = [];
    for (const slot of slots) {
      try {
        secrets.push(this.identity.codec.open(licenseId, slot.version, slot.sealed));
      } catch {
        log.warn(
          { license_id: licenseId.toString(), secret_version: slot.version },
          'signed identity secret could not be opened; issue a new one',
        );
      }
    }
    return secrets;
  }

  /**
   * The customer a verified identity names (ID-03 · K28): the one carrying
   * that member id in this organization, else the browser's own record if it
   * carries no other member's id, else a new one — and stamped as verified,
   * with the username and e-mail the operator signed, if any.
   *
   * Serialised per member id with a transaction-scoped advisory lock: two
   * devices signing in at once would otherwise both find no record and both
   * create one, and the unique index would abort the second mint instead of
   * handing it the first one's customer. The claim of the browser's record is
   * one conditional UPDATE, so a second tab claiming the same record for
   * another member re-reads it, sees the first member's id and opens its own.
   * RLS keeps every read and write inside the caller's organization — the same
   * id in another workspace is somebody else.
   */
  async #resolveVerified(
    tx: TenantClient,
    input: {
      organizationId: string;
      claim: IdentityClaim;
      browser: { id: string; platformUserId: string | null } | null;
      now: Date;
    },
  ): Promise<{ id: string; bannedAt: Date | null; usernameVerified: boolean }> {
    const { claim, now } = input;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtext('siyahtus.member-identity'),
        hashtext(${`${input.organizationId}:${claim.userId}`}))`;

    const [existing] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM customers WHERE platform_user_id = ${claim.userId}`;
    const candidate =
      existing?.id ??
      (input.browser && input.browser.platformUserId === null ? input.browser.id : null);

    if (candidate) {
      const [stamped] = await tx.$queryRaw<
        Array<{ id: string; banned_at: Date | null; username_verified: boolean }>
      >`
        UPDATE customers
        SET platform_user_id = ${claim.userId},
            identity_verified_at = ${now},
            username = COALESCE(${claim.username}::text, username),
            username_verified = username_verified OR ${claim.username}::text IS NOT NULL,
            email = COALESCE(${claim.email}::citext, email)
        WHERE id = ${candidate}::uuid
          AND (platform_user_id IS NULL OR platform_user_id = ${claim.userId})
        RETURNING id, banned_at, username_verified`;
      if (stamped) {
        return {
          id: stamped.id,
          bannedAt: stamped.banned_at,
          usernameVerified: stamped.username_verified,
        };
      }
      // The browser's record took another member's id between the read and
      // this claim (another tab): this member gets a record of their own.
    }

    const created = await tx.customer.create({
      data: {
        organizationId: input.organizationId,
        lastActivityAt: new Date(),
        platformUserId: claim.userId,
        identityVerifiedAt: now,
        ...(claim.username !== null ? { username: claim.username, usernameVerified: true } : {}),
        ...(claim.email !== null ? { email: claim.email } : {}),
      },
      select: { id: true, bannedAt: true, usernameVerified: true },
    });
    return created;
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

/** The identity secret, described — the previous one only while it is still accepted. */
function describeSecret(secret: MemberIdentitySecret, now: Date): SecretDescription {
  const previousLive =
    secret.previousSecretVersion !== null &&
    secret.previousSecretValidUntil !== null &&
    secret.previousSecretValidUntil > now;
  return {
    version: secret.secretVersion,
    created_at: secret.secretCreatedAt.toISOString(),
    previous_version: previousLive ? secret.previousSecretVersion : null,
    previous_valid_until: previousLive ? secret.previousSecretValidUntil!.toISOString() : null,
  };
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
