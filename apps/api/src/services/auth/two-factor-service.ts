/**
 * Two-factor authentication for an agent's own account
 * (NFR-S11 · FR-MOD-00.1 · S11-2FA-c/d).
 *
 * Two credentials live here, and they are deliberately different animals.
 *
 *   **The TOTP secret** is shared with an authenticator app once, at enrollment,
 *   and read back on every verification — so it cannot be hashed. `lib/totp.ts`
 *   does the RFC 6238 arithmetic; this file owns the *state* around it, which is
 *   where the interesting failures are: a half-finished enrollment that turns
 *   into a lock, a live factor swapped out by a stolen session, a 30-second code
 *   spent twice.
 *
 *   **Recovery codes** answer the question TOTP cannot: the phone with the
 *   authenticator on it is gone, and the account still has to be reachable. That
 *   makes each code a full second factor on its own, so the handling below is
 *   deliberately closer to `password_reset_tokens` than to anything user-chosen:
 *
 *     **Presented once, stored hashed.** A code is shown at activation and never
 *     again. Nothing reads it back — only compares — so `lib/crypto.ts`'s token
 *     rule applies rather than its password rule: one SHA-256, no KDF. There is
 *     no low-entropy secret here for an offline attacker to grind, and a leaked
 *     copy of the table is a list of digests rather than a set of working codes.
 *
 *     **Single use, enforced by the database.** Spending a code is one
 *     conditional UPDATE inside `auth_two_factor_consume_recovery_code`. Reading
 *     `used_at` here and updating afterwards would leave a window in which two
 *     requests both see the same code unused — see that function's comment.
 *
 *     **Regeneration invalidates the whole sheet**, unused codes included.
 *
 * Neither table can be reached by an ordinary query: both have row level
 * security with no permissive policy, so every statement below goes through a
 * SECURITY DEFINER function (migrations 20260826170000 and 20260826190000).
 * Each of those functions decides in a *single* conditional statement whether it
 * is allowed to act, which is what makes concurrent requests come out one way
 * rather than both believing they won.
 *
 * `consumeRecoveryCode` is named for what it spends rather than for the check it
 * performs, and stays separate from `verifyTotpCode`, so the login path
 * (S11-2FA-e) can record "signed in with a recovery code" as its own audit
 * event: there is no shared entry point through which the distinction could be
 * lost, and no caller can reach for one believing it to be a generic
 * second-factor verifier.
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { hashToken } from '../../lib/crypto.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '../../lib/totp.js';

/** Ten, the number every authenticator vendor settled on. */
export const RECOVERY_CODE_COUNT = 10;

/** Symbols per code, separator excluded. */
export const RECOVERY_CODE_LENGTH = 10;

/**
 * What an authenticator app lists the entry under. The product name rather than
 * the workspace: an account is global (PRD §8.4) and one person's single secret
 * covers every workspace they belong to, so naming one of them on the phone
 * would be wrong the moment they join a second.
 */
export const TOTP_ISSUER = 'Nexa';

/**
 * Confusable characters are gone: no `0`/`O`, no `1`/`I`/`L`, and no `U`, which
 * also keeps the generator from spelling anything unfortunate. Thirty symbols
 * are left, so a ten-symbol code carries just under 49 bits — far out of reach
 * of guessing over the network, and short enough to be read off a printout
 * without losing one's place.
 *
 * Because both halves of every confusable pair are excluded, there is no
 * sensible repair for a mistyped `O` — we never emit `0` either. A character
 * outside this alphabet is therefore refused rather than mapped to a guess.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Rejection-sampling bound. 256 is not a multiple of 30, so `% 30` across the
 * whole byte range would make the first sixteen symbols measurably likelier.
 */
const REJECT_ABOVE = 256 - (256 % CODE_ALPHABET.length);

/** Printed in two groups so the eye keeps its place. */
const GROUP_SIZE = 5;

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`);

/**
 * Everything the service needs from a Prisma client, so the same helpers run on
 * the client and inside an interactive transaction.
 */
type SqlRunner = Pick<PrismaClient, '$queryRaw'>;

export interface RecoveryCodeConsumption {
  /** The row that was spent, so the caller's audit entry can name it. */
  codeId: string;
  /** Unused codes left afterwards — what "2 recovery codes left" reads from. */
  remaining: number;
}

/** What a screen may know about somebody's second factor. */
export interface TwoFactorStatus {
  /** An enrollment exists and has been confirmed with a code. */
  enabled: boolean;
  /** A secret has been issued but no code has confirmed it yet. */
  pending: boolean;
  recoveryCodesRemaining: number;
}

export interface TwoFactorEnrollment {
  /** The secret and its otpauth URI, shown once and never retrievable again. */
  secret: string;
  otpauthUri: string;
}

/** A workspace whose policy forbids its members from switching 2FA off. */
export interface EnforcingWorkspace {
  licenseId: bigint;
  name: string;
}

interface StateRow {
  totp_secret: string;
  activated: Date | null;
  used_step: bigint | null;
  codes_remaining: number;
}

/**
 * Fold whatever was typed into the form that was hashed.
 *
 * Codes get pasted with the separator, without it, in lower case, or with a
 * stray space picked up from a PDF. Case and layout are forgiven; the alphabet
 * is not.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/** `ABCDE-FGHJK` — the display form, and the only one a person ever sees. */
export function formatRecoveryCode(raw: string): string {
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += GROUP_SIZE) groups.push(raw.slice(i, i + GROUP_SIZE));
  return groups.join('-');
}

function randomCode(): string {
  let out = '';
  while (out.length < RECOVERY_CODE_LENGTH) {
    // A block at a time: rejection discards roughly one byte in sixteen, and
    // refilling one byte at a time would mean a syscall per symbol.
    for (const byte of randomBytes(RECOVERY_CODE_LENGTH)) {
      if (byte >= REJECT_ABOVE) continue;
      out += CODE_ALPHABET.charAt(byte % CODE_ALPHABET.length);
      if (out.length === RECOVERY_CODE_LENGTH) break;
    }
  }
  return out;
}

function notEnrolled(cause?: unknown): ApiError {
  // Not `validation`: what the account is missing is a second factor, which is
  // the state `two_factor_required` names (ERROR_STATUS 401).
  return new ApiError(
    'two_factor_required',
    'Two-factor authentication is not set up on this account.',
    cause === undefined ? {} : { cause },
  );
}

function alreadyEnabled(): ApiError {
  return new ApiError(
    'two_factor_already_enabled',
    'Two-factor authentication is already active on this account. Turn it off before setting it up again.',
  );
}

export class TwoFactorService {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  // --- Enrollment -----------------------------------------------------------

  /** What the settings screen renders, and nothing an attacker could use. */
  async status(accountId: string): Promise<TwoFactorStatus> {
    const row = await this.#state(this.#db, accountId);
    return {
      enabled: row?.activated != null,
      pending: row != null && row.activated == null,
      recoveryCodesRemaining: row?.codes_remaining ?? 0,
    };
  }

  /**
   * Mint a secret and hand back the URI an authenticator app imports.
   *
   * Nothing is enabled yet: `activated_at` stays null until a code proves the
   * app and the server agree. Calling this again before that happens replaces
   * the pending secret, which is what keeps an abandoned attempt — a closed tab,
   * a phone reset halfway through — from becoming a state somebody is stuck in.
   *
   * Calling it on an account that already *has* a live second factor is refused,
   * not silently obeyed. Swapping the authenticator without proving anything is
   * precisely what a stolen session would do, and the victim would only find out
   * when their own app started being rejected.
   */
  async beginEnrollment(accountId: string, accountName: string): Promise<TwoFactorEnrollment> {
    const secret = generateTotpSecret();

    const rows = await this.#db.$queryRaw<Array<{ started: boolean }>>`
      SELECT auth_two_factor_begin_enrollment(${accountId}::uuid, ${secret}) AS started`;
    if (!rows[0]?.started) throw alreadyEnabled();

    return {
      secret,
      otpauthUri: buildOtpauthUri({ issuer: TOTP_ISSUER, accountName, secret }),
    };
  }

  /**
   * Confirm the enrollment with a code, and hand over the recovery sheet.
   *
   * The flip and the sheet are one transaction. Two things follow from that,
   * both of which are the reason it is written this way: a second activation
   * racing the first blocks on the row and then matches nothing, so it cannot
   * mint a *second* sheet that silently invalidates the one already handed to
   * the winner; and if issuing the sheet fails, the account does not come out of
   * this with a second factor and no way past a lost phone.
   *
   * The accepted code's step is stored as the replay floor, so the code the
   * person just typed cannot be turned round into a session in the seconds it
   * remains valid.
   */
  async activate(accountId: string, code: string, nowMs: number): Promise<string[]> {
    const current = await this.#state(this.#db, accountId);
    if (!current) throw notEnrolled();
    if (current.activated != null) throw alreadyEnabled();

    const verification = verifyTotp({
      secret: current.totp_secret,
      code,
      nowMs,
      lastUsedStep: current.used_step,
    });
    if (!verification.ok) throw badCode();

    return this.#db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ activated: boolean }>>`
        SELECT auth_two_factor_activate(${accountId}::uuid, ${BigInt(verification.step)})
          AS activated`;
      if (!rows[0]?.activated) throw alreadyEnabled();
      return this.#replaceRecoveryCodes(tx, accountId);
    });
  }

  /**
   * Turn the second factor off and take the recovery sheet with it.
   *
   * Whether the caller was allowed to reach this — a password, or the policy
   * check below — is the route's business; by the time this runs the decision is
   * made. Returns false when there was nothing to remove, so the caller can tell
   * "done" from "there was never anything here" without a second round trip.
   */
  async disable(accountId: string): Promise<boolean> {
    const rows = await this.#db.$queryRaw<Array<{ removed: boolean }>>`
      SELECT auth_two_factor_disable(${accountId}::uuid) AS removed`;
    return rows[0]?.removed ?? false;
  }

  /**
   * The workspaces that will not let this account switch its second factor off
   * (`security_settings.require_two_factor`).
   *
   * Every workspace the account belongs to, not just the one the session is in:
   * an account is global, so a member of a strict workspace could otherwise sign
   * in to a lax one and disable the factor the strict one depends on.
   */
  async enforcingWorkspaces(accountId: string): Promise<EnforcingWorkspace[]> {
    const rows = await this.#db.$queryRaw<
      Array<{ enforcing_license_id: bigint; workspace_name: string }>
    >`SELECT * FROM auth_two_factor_enforcing_licenses(${accountId}::uuid)`;
    return rows.map((r) => ({ licenseId: r.enforcing_license_id, name: r.workspace_name }));
  }

  /**
   * Does this account hold a *live* second factor?
   *
   * The sign-in gate's first question (S11-2FA-e), and separate from `status`
   * on purpose: `status` reads the whole row — TOTP secret included — to build a
   * screen, while this is asked on every sign-in attempt including every failed
   * one. `auth_two_factor_is_active` returns the boolean without the secret
   * leaving the database, which is the difference between a plaintext shared
   * secret that lives in one function and one that passes through the hot path.
   */
  async isActive(accountId: string): Promise<boolean> {
    const rows = await this.#db.$queryRaw<Array<{ active: boolean }>>`
      SELECT auth_two_factor_is_active(${accountId}::uuid) AS active`;
    return rows[0]?.active ?? false;
  }

  // --- Verification ---------------------------------------------------------

  /**
   * Check a TOTP code against a *live* enrollment and spend its step.
   *
   * Two steps, and the second is not optional: `verifyTotp` is pure and can only
   * say the code is arithmetically right, while `auth_two_factor_record_step` is
   * the conditional UPDATE that decides which of two requests presenting the
   * same 30-second code gets to use it. A caller that skipped it would accept
   * one code as many times as it was replayed inside its window.
   *
   * `false` covers wrong, expired, already spent and "2FA is not active" alike.
   */
  async verifyTotpCode(accountId: string, code: string, nowMs: number): Promise<boolean> {
    const current = await this.#state(this.#db, accountId);
    if (!current || current.activated == null) return false;

    const verification = verifyTotp({
      secret: current.totp_secret,
      code,
      nowMs,
      lastUsedStep: current.used_step,
    });
    if (!verification.ok) return false;

    const rows = await this.#db.$queryRaw<Array<{ spent: boolean }>>`
      SELECT auth_two_factor_record_step(${accountId}::uuid, ${BigInt(verification.step)}) AS spent`;
    return rows[0]?.spent ?? false;
  }

  // --- Recovery codes -------------------------------------------------------

  /**
   * Mint a fresh sheet, discarding whatever preceded it.
   *
   * The plain codes are returned to be shown once and then forgotten by us:
   * they are not stored, logged or recoverable. A caller must put them nowhere
   * but the response body.
   */
  async issueRecoveryCodes(accountId: string): Promise<string[]> {
    return this.#replaceRecoveryCodes(this.#db, accountId);
  }

  /**
   * Spend a code, or refuse.
   *
   * `null` covers unknown, already spent, belonging to another account and
   * "two-factor is not active" alike. Telling them apart would let someone
   * holding a stale sheet learn which of its codes are still live.
   *
   * A successful call is a sign-in with a recovery code rather than with TOTP,
   * and the caller is what records that distinction in the audit log — the
   * service has no request to attribute it to.
   */
  async consumeRecoveryCode(
    accountId: string,
    code: string,
  ): Promise<RecoveryCodeConsumption | null> {
    const normalized = normalizeRecoveryCode(code);
    // Refused before the query. A string outside the alphabet cannot be a code
    // we ever generated, so the round trip could only be a way to spend one.
    if (!CODE_RE.test(normalized)) return null;

    const rows = await this.#db.$queryRaw<
      Array<{ consumed_code: string; codes_remaining: number }>
    >`
      SELECT * FROM auth_two_factor_consume_recovery_code(
        ${accountId}::uuid, ${hashToken(normalized)})`;

    const row = rows[0];
    if (!row) return null;
    return { codeId: row.consumed_code, remaining: row.codes_remaining };
  }

  /** Unused codes left, for the settings screen's warning. */
  async countRecoveryCodes(accountId: string): Promise<number> {
    const rows = await this.#db.$queryRaw<Array<{ remaining: number }>>`
      SELECT auth_two_factor_count_recovery_codes(${accountId}::uuid) AS remaining`;
    return rows[0]?.remaining ?? 0;
  }

  // --- Internals ------------------------------------------------------------

  async #state(db: SqlRunner, accountId: string): Promise<StateRow | undefined> {
    const rows = await db.$queryRaw<StateRow[]>`
      SELECT * FROM auth_two_factor_state(${accountId}::uuid)`;
    return rows[0];
  }

  async #replaceRecoveryCodes(db: SqlRunner, accountId: string): Promise<string[]> {
    // A Set rather than an array. Two identical codes in one batch would be one
    // code spendable twice; the odds are around one in a hundred billion, but
    // the remedy is a Set, and the database refuses a duplicated batch anyway —
    // this is what keeps that refusal unreachable from here rather than a
    // once-a-decade 500.
    const plain = new Set<string>();
    while (plain.size < RECOVERY_CODE_COUNT) plain.add(randomCode());

    const raw = [...plain];
    const hashes = raw.map(hashToken);

    try {
      await db.$queryRaw`
        SELECT auth_two_factor_replace_recovery_codes(${accountId}::uuid, ${hashes}::text[])`;
    } catch (error) {
      if (isNotEnrolled(error)) throw notEnrolled(error);
      throw error;
    }

    return raw.map(formatRecoveryCode);
  }
}

/**
 * One answer for every way a code can fail — wrong, expired, or right but
 * already spent. Which one it was is exactly what somebody guessing would like
 * to know.
 */
export function badCode(): ApiError {
  return ApiError.authentication(
    'That code is not valid. Check your authenticator app and try again.',
  );
}

function isNotEnrolled(error: unknown): boolean {
  return error instanceof Error && /two_factor_not_enrolled/.test(error.message);
}
