/**
 * Operators for the platform integration tests (tm 389.4): rows written
 * straight into `platform_admins`, a clock the tests move, and the codes an
 * authenticator app would show at that clock.
 *
 * The TOTP secret is sealed with the server's own key derivation
 * (`sealTotpSecret` under the run's `PLATFORM_SETTINGS_KEY`, or the dev
 * fallback `assertPlatformEnv` uses), so the server under test opens it like
 * any enrolled operator's.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { PlatformRole } from '@siyahtus/types';
import { assertPlatformEnv } from '../../src/config/platform-env.js';
import { generateToken, hashPassword, hashToken } from '../../src/lib/crypto.js';
import { generateTotp, generateTotpSecret, TOTP_PERIOD_SECONDS } from '../../src/lib/totp.js';
import { sealTotpSecret } from '../../src/services/platform/admin-auth.js';
import { testEnv } from './fixtures.js';

/** A moveable "now", in milliseconds — what `buildPlatformServer({ now })` reads. */
export class TestClock {
  now: number;

  constructor(start = Date.parse('2026-11-02T09:00:00Z')) {
    this.now = start;
  }

  advance(ms: number): void {
    this.now += ms;
  }

  readonly read = (): number => this.now;
}

export const MINUTE = 60_000;

export interface TestOperator {
  id: string;
  email: string;
  password: string;
  role: PlatformRole;
  /** The base32 secret, when the operator is enrolled. */
  secret: string | null;
}

/** The settings key the platform server of this run seals TOTP secrets under. */
export function platformSettingsKey(overrides: Partial<NodeJS.ProcessEnv> = {}): string {
  return assertPlatformEnv(testEnv(overrides)).settingsKey;
}

// scrypt costs ~100 ms a hash; every operator a suite creates shares one.
let sharedHash: Promise<string> | null = null;
export const OPERATOR_PASSWORD = 'operator-password-for-tests';

export async function createOperator(
  db: PrismaClient,
  options: {
    role?: PlatformRole;
    email?: string;
    enrolled?: boolean;
    disabled?: boolean;
    clock?: TestClock;
  } = {},
): Promise<TestOperator> {
  const id = randomUUID();
  const role = options.role ?? 'superadmin';
  const email = options.email ?? `${role}-${id.slice(0, 8)}@ops.siyahtus.test`;
  const enrolled = options.enrolled ?? true;
  const secret = enrolled ? generateTotpSecret() : null;
  sharedHash ??= hashPassword(OPERATOR_PASSWORD);
  const at = new Date(options.clock?.now ?? Date.now());

  await db.platformAdmin.create({
    data: {
      id,
      email,
      passwordHash: await sharedHash,
      role,
      totpSecretCiphertext: secret ? sealTotpSecret(secret, platformSettingsKey(), id) : null,
      totpEnrolledAt: secret ? at : null,
      disabledAt: options.disabled ? at : null,
      createdAt: at,
    },
  });
  return { id, email, password: OPERATOR_PASSWORD, role, secret };
}

/**
 * The code the operator's app shows one step later than the last one asked
 * for — the clock moves 30 s first, so the server's replay floor never refuses
 * a code a test means to be good.
 */
export function nextCode(operator: TestOperator, clock: TestClock): string {
  if (!operator.secret) throw new Error(`${operator.email} has no authenticator`);
  clock.advance(TOTP_PERIOD_SECONDS * 1000);
  return generateTotp(operator.secret, clock.now);
}

/**
 * An active session written directly — for the tests about what a session may
 * reach rather than how it was obtained. `totpVerifiedAt` is now, so a
 * `recentTotp` route admits it until the clock moves five minutes.
 */
export async function openActiveSession(
  db: PrismaClient,
  operator: Pick<TestOperator, 'id'>,
  clock: TestClock,
  options: { ttlS?: number } = {},
): Promise<string> {
  const token = generateToken();
  const now = new Date(clock.now);
  await db.platformSession.create({
    data: {
      adminId: operator.id,
      tokenHash: hashToken(token),
      stage: 'active',
      createdAt: now,
      lastSeenAt: now,
      totpVerifiedAt: now,
      expiresAt: new Date(clock.now + (options.ttlS ?? 28_800) * 1000),
    },
  });
  return token;
}

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});
