/**
 * Operator sign-in for the root panel (tm 389.4 · FR-ADMIN-01/02 ·
 * docs/platform-admin/design.md §A).
 *
 * An operator (`platform_admins`) is not a workspace member, and nothing here
 * touches `accounts` or the tenant's two-factor tables: the patterns are the
 * tenant's — scrypt passwords (`lib/crypto`), RFC 6238 codes (`lib/totp`),
 * opaque session tokens stored as one SHA-256 (`token-service`), single-use
 * recovery codes — the tables, rows and SQL are the platform's own.
 *
 * **A session has two stages.** The password opens a `password`-stage session
 * that reaches nothing but the second-factor routes; a TOTP code (or, once, a
 * recovery code) upgrades it to `active`, and only an active session reaches a
 * business route. An operator who has never enrolled an authenticator — the
 * bootstrap superadmin, an accepted invitation, an operator whose factor was
 * reset — enrolls from that first stage; there is no way past it without one.
 * The upgrade **rotates the token**: whatever saw the password-stage token (a
 * proxy log, a browser extension) holds nothing once the code is shown.
 *
 * **Two clocks, both enforced here.** The absolute lifetime
 * (`PLATFORM_SESSION_TTL`, 8 h from sign-in) and the idle timeout
 * (`PLATFORM_IDLE_TTL`, 15 min since the last request — every request moves
 * `last_seen_at`). A session past either is deleted on sight, not merely
 * refused, so it cannot come back. `totp_verified_at` is the third clock: the
 * destructive routes ask for a code younger than five minutes (`recentTotp`),
 * and `reverify` is how a session gets one without signing in again.
 *
 * Time comes from one injected clock, never from the database's `now()`, so
 * the tests can move it (and every timestamp this writes says what it judged).
 *
 * **Every state change is one conditional statement.** Spending a TOTP step,
 * spending a recovery code, confirming an enrolment, upgrading a session and
 * accepting an invitation are each an `updateMany` whose `where` is the
 * precondition; the row count says whether this request won. Reading first and
 * writing after would let two requests both see the precondition hold.
 *
 * The TOTP secret has to be read back to verify a code, so it is sealed rather
 * than hashed: AES-256-GCM under a sub-key of `PLATFORM_SETTINGS_KEY`
 * (`lib/platform-keys.ts`), bound to its operator's id, so a ciphertext copied
 * onto another operator's row does not open.
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  isPlatformRole,
  PLATFORM_RECENT_TOTP_SECONDS,
  type PlatformNextStep,
  type PlatformRole,
  type PlatformSessionStage,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { decryptCredential, encryptCredential } from '../../lib/credential-cipher.js';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../../lib/crypto.js';
import { derivePlatformKey } from '../../lib/platform-keys.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '../../lib/totp.js';
import {
  formatRecoveryCode,
  isRecoveryCodeShape,
  normalizeRecoveryCode,
  randomRecoveryCode,
  RECOVERY_CODE_COUNT,
} from '../auth/two-factor-service.js';

/**
 * What the authenticator app lists the entry under. Not the tenant's
 * "SiyahTuş": the same address may also be a workspace member with its own
 * entry, and two entries under one name are how somebody types the wrong code.
 */
export const PLATFORM_TOTP_ISSUER = 'SiyahTuş Platform';

/** The operator password floor — the tenant sign-up's. */
export const PLATFORM_PASSWORD_MIN = 12;
export const PLATFORM_PASSWORD_MAX = 200;

/** An invitation lives 72 hours (decision 5). */
export const PLATFORM_INVITE_TTL_HOURS = 72;

/** `generateToken()` output: 32 bytes, base64url, no padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A user agent is display text; a megabyte of it is not. */
const USER_AGENT_MAX = 512;

export interface PlatformAuthOptions {
  /** `PLATFORM_SESSION_TTL`, seconds. */
  sessionTtlS: number;
  /** `PLATFORM_IDLE_TTL`, seconds. */
  idleTtlS: number;
  /** `PLATFORM_SETTINGS_KEY` — the root the TOTP sub-key is derived from. */
  settingsKey: string;
  /** Milliseconds since the epoch; `Date.now` unless a test moves it. */
  now?: () => number;
}

export interface ClientMeta {
  ip: string | null;
  userAgent: string | null;
}

/** An operator's session, resolved from its token, with what every gate reads. */
export interface PlatformSessionContext {
  sessionId: string;
  adminId: string;
  email: string;
  role: PlatformRole;
  stage: PlatformSessionStage;
  /** An authenticator has been confirmed for this operator. */
  totpEnrolled: boolean;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  totpVerifiedAt: Date | null;
}

export type SessionResolution =
  | { ok: true; session: PlatformSessionContext }
  /**
   * `unknown` — no session has that token (a guess, or one already deleted):
   * the only outcome the caller charges to the failure budget. The rest are a
   * real session that has run out, and are deleted.
   */
  | { ok: false; reason: 'malformed' | 'unknown' | 'expired' | 'idle' | 'disabled' };

/** What the client is told about a session. Never the token's hash. */
export interface PlatformSessionView {
  id: string;
  stage: PlatformSessionStage;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
  totp_verified_at: string | null;
  idle_timeout_s: number;
  /** Until when the destructive routes accept this session's code; null if never. */
  recent_totp_until: string | null;
}

export interface SignedIn {
  /** The opaque session token — shown once, in this response. */
  token: string;
  next: PlatformNextStep;
  session: PlatformSessionView;
}

export interface Verified {
  /** The rotated token: the password-stage one stops working. */
  token: string;
  session: PlatformSessionView;
}

export interface TotpEnrollment {
  secret: string;
  otpauthUri: string;
}

const iso = (date: Date): string => date.toISOString();

/**
 * One answer for a wrong, expired or already spent code — which of them it was
 * is what somebody guessing would like to know (the tenant's `badCode`).
 */
export function badPlatformCode(): ApiError {
  return ApiError.authentication(
    'That code is not valid. Check your authenticator app and try again.',
  );
}

export function totpSecretAad(adminId: string): string {
  return `platform_admin_totp:${adminId}`;
}

/** Seal a TOTP secret for one operator's row. Exported for the test helpers. */
export function sealTotpSecret(secret: string, settingsKey: string, adminId: string): string {
  return encryptCredential(
    secret,
    derivePlatformKey(settingsKey, 'totpSecret'),
    totpSecretAad(adminId),
  );
}

function openTotpSecret(sealed: string, settingsKey: string, adminId: string): string {
  return decryptCredential(
    sealed,
    derivePlatformKey(settingsKey, 'totpSecret'),
    totpSecretAad(adminId),
  );
}

/** The password rule both doors — the CLI and the invitation — apply. */
export function platformPasswordProblem(password: string): string | null {
  if (password.length < PLATFORM_PASSWORD_MIN) {
    return `The password must be at least ${PLATFORM_PASSWORD_MIN} characters.`;
  }
  if (password.length > PLATFORM_PASSWORD_MAX) {
    return `The password must be at most ${PLATFORM_PASSWORD_MAX} characters.`;
  }
  return null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export class PlatformAdminAuth {
  readonly #db: PrismaClient;
  readonly #options: Required<PlatformAuthOptions>;

  constructor(db: PrismaClient, options: PlatformAuthOptions) {
    this.#db = db;
    this.#options = { now: Date.now, ...options };
  }

  now(): number {
    return this.#options.now();
  }

  get idleTtlS(): number {
    return this.#options.idleTtlS;
  }

  // --- Sign-in ---------------------------------------------------------------

  /**
   * The password step. `null` for an unknown address, a wrong password and a
   * disabled operator alike, with the scrypt cost paid in every case so the
   * response time does not tell them apart.
   */
  async signIn(email: string, password: string, meta: ClientMeta): Promise<SignedIn | null> {
    const admin = await this.#db.platformAdmin.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, disabledAt: true, totpEnrolledAt: true },
    });
    const passwordOk = await verifyPassword(password, admin?.passwordHash ?? null);
    if (!admin || !passwordOk || admin.disabledAt !== null) return null;
    return this.#openSession(this.#db, admin.id, admin.totpEnrolledAt !== null, meta);
  }

  async #openSession(
    db: Pick<PrismaClient, 'platformSession'>,
    adminId: string,
    totpEnrolled: boolean,
    meta: ClientMeta,
  ): Promise<SignedIn> {
    const token = generateToken();
    const now = new Date(this.now());
    const row = await db.platformSession.create({
      data: {
        adminId,
        tokenHash: hashToken(token),
        stage: 'password',
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + this.#options.sessionTtlS * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      },
    });
    return {
      token,
      next: totpEnrolled ? 'totp_verify' : 'totp_enroll',
      session: this.view(row),
    };
  }

  /**
   * The token → session lookup every authenticated request makes, and the
   * idle clock's tick: a live session's `last_seen_at` moves to now.
   */
  async resolve(token: string): Promise<SessionResolution> {
    if (!TOKEN_RE.test(token)) return { ok: false, reason: 'malformed' };

    const row = await this.#db.platformSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        admin: { select: { email: true, role: true, totpEnrolledAt: true, disabledAt: true } },
      },
    });
    if (!row) return { ok: false, reason: 'unknown' };

    const now = this.now();
    const reason =
      row.admin.disabledAt !== null
        ? 'disabled'
        : row.expiresAt.getTime() <= now
          ? 'expired'
          : row.lastSeenAt.getTime() + this.#options.idleTtlS * 1000 <= now
            ? 'idle'
            : null;
    if (reason) {
      await this.#db.platformSession.deleteMany({ where: { id: row.id } });
      return { ok: false, reason };
    }
    // A role the CHECK allows but this build does not know would be a deploy
    // ahead of its code; it gets no permission rather than a guessed one.
    if (!isPlatformRole(row.admin.role)) return { ok: false, reason: 'disabled' };

    const lastSeenAt = new Date(now);
    await this.#db.platformSession.updateMany({
      where: { id: row.id, lastSeenAt: { lt: lastSeenAt } },
      data: { lastSeenAt },
    });

    return {
      ok: true,
      session: {
        sessionId: row.id,
        adminId: row.adminId,
        email: row.admin.email,
        role: row.admin.role,
        stage: row.stage === 'active' ? 'active' : 'password',
        totpEnrolled: row.admin.totpEnrolledAt !== null,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        lastSeenAt,
        totpVerifiedAt: row.totpVerifiedAt,
      },
    };
  }

  /** Whether the session's last code is young enough for a `recentTotp` route. */
  hasRecentTotp(session: Pick<PlatformSessionContext, 'totpVerifiedAt'>): boolean {
    if (!session.totpVerifiedAt) return false;
    return this.now() - session.totpVerifiedAt.getTime() < PLATFORM_RECENT_TOTP_SECONDS * 1000;
  }

  view(row: {
    id: string;
    stage: string;
    createdAt: Date;
    expiresAt: Date;
    lastSeenAt: Date;
    totpVerifiedAt: Date | null;
  }): PlatformSessionView {
    return {
      id: row.id,
      stage: row.stage === 'active' ? 'active' : 'password',
      created_at: iso(row.createdAt),
      expires_at: iso(row.expiresAt),
      last_seen_at: iso(row.lastSeenAt),
      totp_verified_at: row.totpVerifiedAt ? iso(row.totpVerifiedAt) : null,
      idle_timeout_s: this.#options.idleTtlS,
      recent_totp_until: row.totpVerifiedAt
        ? iso(new Date(row.totpVerifiedAt.getTime() + PLATFORM_RECENT_TOTP_SECONDS * 1000))
        : null,
    };
  }

  viewOf(session: PlatformSessionContext): PlatformSessionView {
    return this.view({
      id: session.sessionId,
      stage: session.stage,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastSeenAt: session.lastSeenAt,
      totpVerifiedAt: session.totpVerifiedAt,
    });
  }

  // --- Enrolment -------------------------------------------------------------

  /**
   * Mint a secret for an operator with no confirmed authenticator. Calling it
   * again replaces the pending one (an abandoned attempt is not a lock). The
   * route gate has already refused an enrolled operator; the `where` refuses a
   * concurrent confirmation that got there first.
   */
  async beginEnrollment(session: PlatformSessionContext): Promise<TotpEnrollment> {
    const secret = generateTotpSecret();
    const sealed = sealTotpSecret(secret, this.#options.settingsKey, session.adminId);
    const { count } = await this.#db.platformAdmin.updateMany({
      where: { id: session.adminId, totpEnrolledAt: null },
      data: { totpSecretCiphertext: sealed, totpLastUsedStep: null },
    });
    if (count === 0) throw alreadyEnrolled();
    return {
      secret,
      otpauthUri: buildOtpauthUri({
        issuer: PLATFORM_TOTP_ISSUER,
        accountName: session.email,
        secret,
      }),
    };
  }

  /**
   * Confirm the pending secret with a code: the operator is enrolled, the
   * recovery sheet is issued, and the session becomes active under a new
   * token — one transaction, so a lost race issues no second sheet and a
   * failure leaves no factor without a sheet.
   */
  async activate(
    session: PlatformSessionContext,
    code: string,
  ): Promise<(Verified & { recoveryCodes: string[] }) | null> {
    const admin = await this.#db.platformAdmin.findUnique({
      where: { id: session.adminId },
      select: { totpSecretCiphertext: true, totpEnrolledAt: true, totpLastUsedStep: true },
    });
    if (!admin || admin.totpEnrolledAt !== null) throw alreadyEnrolled();
    if (!admin.totpSecretCiphertext) {
      throw ApiError.validation('Start the authenticator setup first.', { next: 'totp_enroll' });
    }

    const secret = openTotpSecret(
      admin.totpSecretCiphertext,
      this.#options.settingsKey,
      session.adminId,
    );
    const verification = verifyTotp({
      secret,
      code,
      nowMs: this.now(),
      lastUsedStep: admin.totpLastUsedStep,
    });
    if (!verification.ok) return null;

    const now = new Date(this.now());
    const token = generateToken();
    return this.#db.$transaction(async (tx) => {
      const enrolled = await tx.platformAdmin.updateMany({
        // The ciphertext that was verified: a re-enrolment racing this one has
        // replaced it, and confirming would enrol a secret nobody verified.
        where: {
          id: session.adminId,
          totpEnrolledAt: null,
          totpSecretCiphertext: admin.totpSecretCiphertext,
        },
        data: { totpEnrolledAt: now, totpLastUsedStep: BigInt(verification.step) },
      });
      if (enrolled.count === 0) throw alreadyEnrolled();

      const recoveryCodes = await this.#replaceRecoveryCodes(tx, session.adminId, now);
      const upgraded = await this.#upgrade(tx, session.sessionId, token, now);
      if (!upgraded) throw sessionGone();
      return { token, session: upgraded, recoveryCodes };
    });
  }

  // --- The second step -------------------------------------------------------

  /**
   * Show a TOTP code, or once a recovery code, and leave with an active
   * session under a new token. `null` is a wrong, expired or spent code.
   */
  async verify(
    session: PlatformSessionContext,
    proof: { code: string } | { recoveryCode: string },
  ): Promise<
    (Verified & { method: 'totp' | 'recovery_code'; recoveryCodesRemaining: number }) | null
  > {
    const now = new Date(this.now());
    const method = 'code' in proof ? 'totp' : 'recovery_code';
    const spent =
      'code' in proof
        ? await this.#spendTotp(session.adminId, proof.code)
        : await this.#spendRecoveryCode(session.adminId, proof.recoveryCode, now);
    if (!spent) return null;

    const token = generateToken();
    const upgraded = await this.#upgrade(this.#db, session.sessionId, token, now);
    if (!upgraded) throw sessionAlreadyVerified();
    return {
      token,
      session: upgraded,
      method,
      recoveryCodesRemaining: await this.countRecoveryCodes(session.adminId),
    };
  }

  /** A fresh code on an active session — what `recentTotp` routes ask for. TOTP only. */
  async reverify(
    session: PlatformSessionContext,
    code: string,
  ): Promise<PlatformSessionView | null> {
    if (!(await this.#spendTotp(session.adminId, code))) return null;
    const now = new Date(this.now());
    const { count } = await this.#db.platformSession.updateMany({
      where: { id: session.sessionId, stage: 'active' },
      data: { totpVerifiedAt: now, lastSeenAt: now },
    });
    const row =
      count === 1
        ? await this.#db.platformSession.findUnique({ where: { id: session.sessionId } })
        : null;
    if (!row) throw sessionGone();
    return this.view(row);
  }

  async #spendTotp(adminId: string, code: string): Promise<boolean> {
    const admin = await this.#db.platformAdmin.findUnique({
      where: { id: adminId },
      select: { totpSecretCiphertext: true, totpEnrolledAt: true, totpLastUsedStep: true },
    });
    if (!admin?.totpSecretCiphertext || admin.totpEnrolledAt === null) return false;

    const verification = verifyTotp({
      secret: openTotpSecret(admin.totpSecretCiphertext, this.#options.settingsKey, adminId),
      code,
      nowMs: this.now(),
      lastUsedStep: admin.totpLastUsedStep,
    });
    if (!verification.ok) return false;

    // The replay floor, advanced only forwards: of two requests presenting the
    // same code, one moves it and the other matches no row.
    const step = BigInt(verification.step);
    const { count } = await this.#db.platformAdmin.updateMany({
      where: {
        id: adminId,
        totpEnrolledAt: { not: null },
        OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
      },
      data: { totpLastUsedStep: step },
    });
    return count === 1;
  }

  async #spendRecoveryCode(adminId: string, code: string, now: Date): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);
    if (!isRecoveryCodeShape(normalized)) return false;
    const { count } = await this.#db.platformAdminRecoveryCode.updateMany({
      where: { adminId, codeHash: hashToken(normalized), usedAt: null },
      data: { usedAt: now },
    });
    return count === 1;
  }

  async #upgrade(
    db: Pick<PrismaClient, 'platformSession'>,
    sessionId: string,
    token: string,
    now: Date,
  ): Promise<PlatformSessionView | null> {
    const { count } = await db.platformSession.updateMany({
      where: { id: sessionId, stage: 'password' },
      data: { stage: 'active', tokenHash: hashToken(token), totpVerifiedAt: now, lastSeenAt: now },
    });
    if (count === 0) return null;
    const row = await db.platformSession.findUnique({ where: { id: sessionId } });
    return row ? this.view(row) : null;
  }

  // --- Recovery codes --------------------------------------------------------

  /** A new sheet; every earlier code, used or not, stops working. */
  async regenerateRecoveryCodes(adminId: string): Promise<string[]> {
    const now = new Date(this.now());
    return this.#db.$transaction((tx) => this.#replaceRecoveryCodes(tx, adminId, now));
  }

  async countRecoveryCodes(adminId: string): Promise<number> {
    return this.#db.platformAdminRecoveryCode.count({ where: { adminId, usedAt: null } });
  }

  async #replaceRecoveryCodes(
    tx: Prisma.TransactionClient,
    adminId: string,
    now: Date,
  ): Promise<string[]> {
    const plain = new Set<string>();
    while (plain.size < RECOVERY_CODE_COUNT) plain.add(randomRecoveryCode());
    const raw = [...plain];
    await tx.platformAdminRecoveryCode.deleteMany({ where: { adminId } });
    await tx.platformAdminRecoveryCode.createMany({
      data: raw.map((code) => ({ adminId, codeHash: hashToken(code), createdAt: now })),
    });
    return raw.map(formatRecoveryCode);
  }

  // --- Sessions --------------------------------------------------------------

  async listSessions(
    adminId: string,
  ): Promise<Array<PlatformSessionView & { ip: string | null; user_agent: string | null }>> {
    const rows = await this.#db.platformSession.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
    });
    const now = this.now();
    return rows
      .filter(
        (row) =>
          row.expiresAt.getTime() > now &&
          row.lastSeenAt.getTime() + this.#options.idleTtlS * 1000 > now,
      )
      .map((row) => ({ ...this.view(row), ip: row.ip, user_agent: row.userAgent }));
  }

  /** Every session of this operator but `keep`. Returns how many ended. */
  async endOtherSessions(adminId: string, keep: string): Promise<number> {
    const { count } = await this.#db.platformSession.deleteMany({
      where: { adminId, id: { not: keep } },
    });
    return count;
  }

  async endSession(sessionId: string): Promise<void> {
    await this.#db.platformSession.deleteMany({ where: { id: sessionId } });
  }

  // --- Invitations -----------------------------------------------------------

  /**
   * Accept an invitation: the invited address becomes an operator with the
   * invited role and the password given here, and gets a `password`-stage
   * session — never an active one (decision 5): an authenticator is enrolled
   * before anything else is reachable. `null` is an unknown, spent or expired
   * invitation, one answer for all three.
   */
  async acceptInvite(token: string, password: string, meta: ClientMeta): Promise<SignedIn | null> {
    if (!TOKEN_RE.test(token)) return null;
    const problem = platformPasswordProblem(password);
    if (problem) throw ApiError.validation(problem);

    const now = new Date(this.now());
    const passwordHash = await hashPassword(password);
    try {
      return await this.#db.$transaction(async (tx) => {
        const tokenHash = hashToken(token);
        const claimed = await tx.platformAdminInvite.updateMany({
          where: { tokenHash, acceptedAt: null, expiresAt: { gt: now } },
          data: { acceptedAt: now },
        });
        if (claimed.count === 0) return null;

        const invite = await tx.platformAdminInvite.findUniqueOrThrow({ where: { tokenHash } });
        const admin = await tx.platformAdmin.create({
          data: {
            email: invite.email,
            passwordHash,
            role: invite.role,
            invitedBy: invite.invitedBy,
            createdAt: now,
          },
        });
        return this.#openSession(tx, admin.id, false, meta);
      });
    } catch (error) {
      // Somebody became an operator under this address meanwhile (another
      // invitation, the bootstrap CLI). The claim rolled back with it.
      if (isUniqueViolation(error)) {
        throw new ApiError('account_exists', 'An operator with this address already exists.');
      }
      throw error;
    }
  }
}

function alreadyEnrolled(): ApiError {
  return new ApiError(
    'two_factor_already_enabled',
    'An authenticator is already set up for this operator. Ask a superadmin to reset it first.',
  );
}

function sessionAlreadyVerified(): ApiError {
  return new ApiError('not_allowed', 'This session has already been verified.');
}

function sessionGone(): ApiError {
  return ApiError.authentication('This session has ended. Sign in again.');
}
