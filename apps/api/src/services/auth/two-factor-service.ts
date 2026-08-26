/**
 * Two-factor recovery codes (NFR-S11 · FR-MOD-00.1 · S11-2FA-c).
 *
 * A recovery code answers the question TOTP cannot: the phone with the
 * authenticator on it is gone, and the account still has to be reachable. That
 * makes each code a full second factor on its own, so the handling below is
 * deliberately closer to `password_reset_tokens` than to anything user-chosen:
 *
 *   **Presented once, stored hashed.** A code is shown at activation and never
 *   again. Nothing reads it back — only compares — so `lib/crypto.ts`'s token
 *   rule applies rather than its password rule: one SHA-256, no KDF. There is
 *   no low-entropy secret here for an offline attacker to grind, and a leaked
 *   copy of the table is a list of digests rather than a set of working codes.
 *
 *   **Single use, enforced by the database.** Spending a code is one
 *   conditional UPDATE inside `auth_two_factor_consume_recovery_code`. Reading
 *   `used_at` here and updating afterwards would leave a window in which two
 *   requests both see the same code unused — see that function's comment.
 *
 *   **Regeneration invalidates the whole sheet**, unused codes included.
 *
 * Nothing in this file touches TOTP. `lib/totp.ts` verifies codes an app
 * generates; this verifies codes we generated. Keeping them apart is what lets
 * the login path (S11-2FA-e) record "signed in with a recovery code" as its own
 * audit event: there is no shared entry point through which the distinction
 * could be lost, and `consumeRecoveryCode` is named for what it spends rather
 * than for the check it performs, so a caller cannot reach for it believing it
 * to be a generic second-factor verifier.
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { hashToken } from '../../lib/crypto.js';

/** Ten, the number every authenticator vendor settled on. */
export const RECOVERY_CODE_COUNT = 10;

/** Symbols per code, separator excluded. */
export const RECOVERY_CODE_LENGTH = 10;

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

export interface RecoveryCodeConsumption {
  /** The row that was spent, so the caller's audit entry can name it. */
  codeId: string;
  /** Unused codes left afterwards — what "2 recovery codes left" reads from. */
  remaining: number;
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

export class TwoFactorService {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  /**
   * Mint a fresh sheet, discarding whatever preceded it.
   *
   * The plain codes are returned to be shown once and then forgotten by us:
   * they are not stored, logged or recoverable. A caller must put them nowhere
   * but the response body.
   */
  async issueRecoveryCodes(accountId: string): Promise<string[]> {
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
      await this.#db.$queryRaw`
        SELECT auth_two_factor_replace_recovery_codes(${accountId}::uuid, ${hashes}::text[])`;
    } catch (error) {
      if (isNotEnrolled(error)) {
        // Not `validation`: what the account is missing is a second factor,
        // which is the state `two_factor_required` names (ERROR_STATUS 401).
        throw new ApiError(
          'two_factor_required',
          'Two-factor authentication is not set up on this account.',
          { cause: error },
        );
      }
      throw error;
    }

    return raw.map(formatRecoveryCode);
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
}

function isNotEnrolled(error: unknown): boolean {
  return error instanceof Error && /two_factor_not_enrolled/.test(error.message);
}
