/**
 * Two-factor recovery codes (NFR-S11 · FR-MOD-00.1 · S11-2FA-c).
 *
 * A recovery code is a standalone second factor: whoever holds one gets past
 * the code screen without the phone. So the properties worth testing are the
 * ones whose failure still looks like a working feature from the outside — a
 * code that can be spent twice, a sheet that survives being regenerated, a
 * race that lets two requests share one code, a plain code sitting in a column.
 * Every one of those passes a happy-path test.
 *
 * The service runs against the **application** role here, not the owner
 * connection the fixtures use. That is the point of the exercise: the table has
 * row level security with no permissive policy, so a query that is not going
 * through a SECURITY DEFINER function silently sees nothing, and only running
 * as `nexa_app` would ever notice.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import {
  RECOVERY_CODE_COUNT,
  TwoFactorService,
  formatRecoveryCode,
  normalizeRecoveryCode,
} from '../../src/services/auth/two-factor-service.js';
import { hashToken } from '../../src/lib/crypto.js';
import { generateTotpSecret } from '../../src/lib/totp.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** `ABCDE-FGHJK`: two groups of five, no confusable characters, no lower case. */
const DISPLAY_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

interface CodeRow {
  id: string;
  account_id: string;
  code_hash: string;
  used_at: Date | null;
}

describe('two-factor recovery codes (S11-2FA-c)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let service: TwoFactorService;
  let fx: Fixtures;

  beforeAll(() => {
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    service = new TwoFactorService(app);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  /**
   * Put an account in the state enrollment leaves it in. `activated_at` is a
   * parameter because the two states behave differently on purpose: a sheet may
   * be issued mid-enrollment, but a code may only be spent against live 2FA.
   */
  async function enroll(accountId: string, activated = true): Promise<void> {
    await owner.accountTwoFactor.create({
      data: {
        accountId,
        secret: generateTotpSecret(),
        activatedAt: activated ? new Date() : null,
      },
    });
  }

  /** Read the stored rows directly — the owner connection bypasses RLS. */
  function storedCodes(accountId: string): Promise<CodeRow[]> {
    return owner.$queryRaw<CodeRow[]>`
      SELECT id, account_id, code_hash, used_at FROM two_factor_recovery_codes
       WHERE account_id = ${accountId}::uuid ORDER BY code_hash`;
  }

  // =========================================================================
  // Single use — the property the whole design exists to hold
  // =========================================================================

  describe('a code is spendable exactly once', () => {
    it('accepts a code, then refuses the same one', async () => {
      await enroll(fx.a.ownerAccountId);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);

      const first = await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!);
      expect(first).not.toBeNull();
      expect(first?.remaining).toBe(RECOVERY_CODE_COUNT - 1);

      const second = await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!);
      expect(second).toBeNull();
      expect(await service.countRecoveryCodes(fx.a.ownerAccountId)).toBe(RECOVERY_CODE_COUNT - 1);
    });

    it('lets two racing attempts on one code through exactly once', async () => {
      await enroll(fx.a.ownerAccountId);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);

      // What someone locked out actually does: the first attempt seems to hang,
      // so they press the button again. Both requests are in flight against the
      // same unused row, and the conditional UPDATE inside
      // `auth_two_factor_consume_recovery_code` is the only thing standing
      // between that and one code paying for two sessions.
      const [left, right] = await Promise.all([
        service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!),
        service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!),
      ]);

      const winners = [left, right].filter((r) => r !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.remaining).toBe(RECOVERY_CODE_COUNT - 1);
      expect(await service.countRecoveryCodes(fx.a.ownerAccountId)).toBe(RECOVERY_CODE_COUNT - 1);
    });

    it('counts down as codes are spent', async () => {
      await enroll(fx.a.ownerAccountId);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);

      await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!);
      await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[1]!);
      await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[2]!);

      expect(await service.countRecoveryCodes(fx.a.ownerAccountId)).toBe(RECOVERY_CODE_COUNT - 3);
      const spent = (await storedCodes(fx.a.ownerAccountId)).filter((r) => r.used_at !== null);
      expect(spent).toHaveLength(3);
    });
  });

  // =========================================================================
  // Whose code is it
  // =========================================================================

  describe('a code belongs to one account', () => {
    it("refuses another account's code and leaves it unspent", async () => {
      await enroll(fx.a.ownerAccountId);
      await enroll(fx.b.ownerAccountId);
      const mine = await service.issueRecoveryCodes(fx.a.ownerAccountId);
      await service.issueRecoveryCodes(fx.b.ownerAccountId);

      expect(await service.consumeRecoveryCode(fx.b.ownerAccountId, mine[0]!)).toBeNull();

      // Not merely refused: still good for the account it belongs to. A
      // rejection that had spent the row anyway would be a denial-of-service
      // any stranger could aim at any account.
      const own = await service.consumeRecoveryCode(fx.a.ownerAccountId, mine[0]!);
      expect(own).not.toBeNull();
      expect(await service.countRecoveryCodes(fx.b.ownerAccountId)).toBe(RECOVERY_CODE_COUNT);
    });
  });

  // =========================================================================
  // Regeneration
  // =========================================================================

  describe('regeneration invalidates the previous sheet', () => {
    it('kills the old codes, unused ones included', async () => {
      await enroll(fx.a.ownerAccountId);
      const old = await service.issueRecoveryCodes(fx.a.ownerAccountId);
      await service.consumeRecoveryCode(fx.a.ownerAccountId, old[0]!);

      const fresh = await service.issueRecoveryCodes(fx.a.ownerAccountId);
      expect(fresh).toHaveLength(RECOVERY_CODE_COUNT);
      expect(fresh).not.toContain(old[1]);

      // `old[1]` was never used. Someone asking for a new sheet is saying the
      // old one is no longer trusted, and half of it staying live would
      // quietly disagree with them.
      expect(await service.consumeRecoveryCode(fx.a.ownerAccountId, old[1]!)).toBeNull();
      expect(await service.consumeRecoveryCode(fx.a.ownerAccountId, fresh[0]!)).not.toBeNull();
      expect(await service.countRecoveryCodes(fx.a.ownerAccountId)).toBe(RECOVERY_CODE_COUNT - 1);
    });

    it('leaves exactly one batch behind', async () => {
      await enroll(fx.a.ownerAccountId);
      await service.issueRecoveryCodes(fx.a.ownerAccountId);
      await service.issueRecoveryCodes(fx.a.ownerAccountId);

      expect(await storedCodes(fx.a.ownerAccountId)).toHaveLength(RECOVERY_CODE_COUNT);
    });
  });

  // =========================================================================
  // What is written down
  // =========================================================================

  describe('what reaches the database', () => {
    it('stores hashes and nothing that could be presented as a code', async () => {
      await enroll(fx.a.ownerAccountId);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);
      const rows = await storedCodes(fx.a.ownerAccountId);

      expect(rows).toHaveLength(RECOVERY_CODE_COUNT);
      expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
      expect(new Set(rows.map((r) => r.code_hash)).size).toBe(RECOVERY_CODE_COUNT);

      const stored = rows.map((r) => r.code_hash).join('\n');
      for (const code of codes) {
        expect(stored).not.toContain(code);
        expect(stored).not.toContain(normalizeRecoveryCode(code));
        // The hash of what the user types, not of what we printed: a
        // separator hashed into the stored value would make every typed code
        // wrong in a way no unit test of the formatter would catch.
        expect(rows.some((r) => r.code_hash === hashToken(normalizeRecoveryCode(code)))).toBe(true);
      }
      expect(rows.every((r) => r.used_at === null)).toBe(true);
    });

    it('prints codes a person can retype', async () => {
      await enroll(fx.a.ownerAccountId);
      for (const code of await service.issueRecoveryCodes(fx.a.ownerAccountId)) {
        expect(code).toMatch(DISPLAY_RE);
      }
    });

    it('hides the table from the application role', async () => {
      await enroll(fx.a.ownerAccountId);
      await service.issueRecoveryCodes(fx.a.ownerAccountId);

      // Same access pattern as `password_reset_tokens`: row level security is
      // on and no policy permits anything, so `nexa_app` reads an empty table
      // however it asks. Only the SECURITY DEFINER functions see the rows —
      // which is exactly why the service above works while this does not.
      const direct = await app.$queryRaw<CodeRow[]>`
        SELECT id, account_id, code_hash, used_at FROM two_factor_recovery_codes`;
      expect(direct).toHaveLength(0);
      expect(await storedCodes(fx.a.ownerAccountId)).toHaveLength(RECOVERY_CODE_COUNT);

      await expect(
        app.$executeRaw`
          INSERT INTO two_factor_recovery_codes (id, account_id, code_hash)
          VALUES (gen_random_uuid(), ${fx.a.ownerAccountId}::uuid, ${hashToken('smuggled')})`,
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // =========================================================================
  // States in which a code must not work
  // =========================================================================

  describe('a code is only a second factor while there is a first', () => {
    it('refuses a code until two-factor is activated', async () => {
      // A sheet may be issued mid-enrollment — activation is what hands it to
      // the user — but spending one before then would turn a half-finished
      // setup into a way in.
      await enroll(fx.a.ownerAccountId, false);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);
      expect(await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!)).toBeNull();

      await owner.accountTwoFactor.update({
        where: { accountId: fx.a.ownerAccountId },
        data: { activatedAt: new Date() },
      });
      expect(await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!)).not.toBeNull();
    });

    it('refuses a sheet left behind after two-factor is removed', async () => {
      await enroll(fx.a.ownerAccountId);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);

      // The recovery codes' foreign key points at `accounts`, not at
      // `account_two_factor`, so dropping the enrollment row does not cascade
      // to them. Whichever path removes two-factor (S11-2FA-d) is expected to
      // delete the sheet as well; this asserts that forgetting to would not
      // leave ten working credentials behind.
      await owner.accountTwoFactor.delete({ where: { accountId: fx.a.ownerAccountId } });
      expect(await storedCodes(fx.a.ownerAccountId)).toHaveLength(RECOVERY_CODE_COUNT);
      expect(await service.consumeRecoveryCode(fx.a.ownerAccountId, codes[0]!)).toBeNull();
    });

    it('will not issue a sheet to an account with no enrollment at all', async () => {
      // Codes for an account that never started setting up two-factor would
      // not be a second factor; they would be a second password.
      await expect(service.issueRecoveryCodes(fx.a.agentAccountId)).rejects.toMatchObject({
        type: 'two_factor_required',
      });
      expect(await storedCodes(fx.a.agentAccountId)).toHaveLength(0);
    });
  });

  // =========================================================================
  // What the user actually types
  // =========================================================================

  describe('typing tolerance', () => {
    it('accepts the separator, its absence, lower case and stray spaces', async () => {
      await enroll(fx.a.ownerAccountId);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);

      const typed = [
        codes[0]!.toLowerCase(),
        normalizeRecoveryCode(codes[1]!),
        ` ${codes[2]!} `,
        formatRecoveryCode(normalizeRecoveryCode(codes[3]!)),
      ];
      for (const attempt of typed) {
        expect(await service.consumeRecoveryCode(fx.a.ownerAccountId, attempt)).not.toBeNull();
      }
      expect(await service.countRecoveryCodes(fx.a.ownerAccountId)).toBe(RECOVERY_CODE_COUNT - 4);
    });

    it('refuses malformed input without spending anything', async () => {
      await enroll(fx.a.ownerAccountId);
      const codes = await service.issueRecoveryCodes(fx.a.ownerAccountId);

      const rubbish = [
        '',
        'AAAA',
        `${normalizeRecoveryCode(codes[0]!)}X`,
        normalizeRecoveryCode(codes[0]!).slice(0, 9),
        // `0`, `1`, `I`, `L`, `O` and `U` are never emitted, so a code
        // containing one cannot be ours. There is no repair to attempt either:
        // both halves of every confusable pair are absent from the alphabet.
        `${normalizeRecoveryCode(codes[0]!).slice(0, 9)}0`,
        'ABCDE-FGHJ*',
      ];
      for (const attempt of rubbish) {
        expect(await service.consumeRecoveryCode(fx.a.ownerAccountId, attempt)).toBeNull();
      }
      expect(await service.countRecoveryCodes(fx.a.ownerAccountId)).toBe(RECOVERY_CODE_COUNT);
    });
  });
});
