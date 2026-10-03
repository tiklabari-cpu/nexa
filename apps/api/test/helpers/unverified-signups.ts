/**
 * Sign-ups nobody has verified, shaped the way `auth_signup` leaves them —
 * for the suites around `purge_unverified_signups` (tm 257.19).
 */
import type { PrismaClient } from '@prisma/client';

export interface SignupFixture {
  email: string;
  accountId: string;
  licenseId: bigint;
  organizationId: string;
}

/** The workspace an owner signed up with, read off the owner membership. */
export async function signupOf(db: PrismaClient, email: string): Promise<SignupFixture> {
  const account = await db.account.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const membership = await db.agentMembership.findFirstOrThrow({
    where: { agentId: account.id, role: 'owner' },
    select: { licenseId: true, license: { select: { organizationId: true } } },
  });
  return {
    email,
    accountId: account.id,
    licenseId: membership.licenseId,
    organizationId: membership.license.organizationId,
  };
}

/**
 * Moves a sign-up `hours` into the past. The account, its licence and its
 * membership move by the same amount, so they stay the one instant
 * `purge_unverified_signups` recognises a sign-up by; its links move with
 * them, so a link mailed at sign-up lapses when it would have.
 */
export async function ageSignup(
  db: PrismaClient,
  signup: SignupFixture,
  hours: number,
): Promise<void> {
  const by = `${String(hours)} hours`;
  await db.$executeRaw`
    UPDATE accounts SET created_at = created_at - ${by}::interval
     WHERE id = ${signup.accountId}::uuid`;
  await db.$executeRaw`
    UPDATE licenses SET created_at = created_at - ${by}::interval
     WHERE id = ${signup.licenseId}`;
  await db.$executeRaw`
    UPDATE agent_memberships SET created_at = created_at - ${by}::interval
     WHERE agent_id = ${signup.accountId}::uuid`;
  await db.$executeRaw`
    UPDATE email_verification_tokens
       SET created_at = created_at - ${by}::interval, expires_at = expires_at - ${by}::interval
     WHERE account_id = ${signup.accountId}::uuid`;
}

/**
 * An unverified sign-up written by `auth_signup` itself, for a suite that has
 * to lay its fixtures down before any server exists. No link and no audit
 * entry — those come from the route, which such a suite has not started yet.
 */
export async function seedUnverifiedSignup(
  db: PrismaClient,
  email: string,
): Promise<SignupFixture> {
  await db.$queryRaw`
    SELECT * FROM auth_signup(
      p_email             => ${email}::citext,
      p_name              => 'Founder',
      p_password_hash     => 'not-a-password-hash',
      p_organization_name => 'Unverified Ltd',
      p_trial_days        => 14,
      p_email_verified    => false)`;
  return signupOf(db, email);
}
