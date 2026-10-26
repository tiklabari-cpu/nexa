/**
 * Moving a workspace's ownership (the Kurucu) from one member to another.
 *
 * Written for the root panel's forced transfer (tm 389.10 · FR-ADMIN-09 —
 * when the owner cannot be reached) and shaped so the owner's own transfer
 * (#328 · OWNERSHIP-TRANSFER, an e-mailed acceptance) calls the same function:
 * the single-owner invariant is enforced in one place.
 *
 * The invariant is `uq_license_single_owner`, a partial unique index on
 * `agent_memberships (license_id) WHERE role = 'owner'` — not deferrable, so
 * it is checked row by row, and one `UPDATE … SET role = CASE …` over both
 * memberships may visit the new owner first and fail. Two statements in this
 * order never break it: the previous owner steps down to `admin` first, so for
 * the instant between them the workspace has no owner (which the index allows
 * and nothing outside this transaction can see), then the new owner steps up.
 *
 * Every query names the licence. The caller may hold a connection without row
 * level security (the platform role), where a membership filter by account
 * alone would reach the same person's seats in other workspaces.
 */
import type { Prisma } from '@prisma/client';

export interface OwnershipSwap {
  /** The new owner's role before the swap — `team_lead` loses its lead marks. */
  previousRole: string;
}

/**
 * Make `toAccountId` the owner of `licenseId` and `fromAccountId` (the current
 * owner, or null when the workspace has none) an admin, inside `tx`.
 *
 * The caller has checked that `toAccountId` is a member and not already the
 * owner, and holds whatever lock its own flow needs on the licence.
 */
export async function applyOwnershipSwap(
  tx: Prisma.TransactionClient,
  licenseId: bigint,
  fromAccountId: string | null,
  toAccountId: string,
): Promise<OwnershipSwap> {
  const target = await tx.agentMembership.findUniqueOrThrow({
    where: { licenseId_agentId: { licenseId, agentId: toAccountId } },
    select: { role: true },
  });

  if (fromAccountId !== null) {
    await tx.agentMembership.update({
      where: { licenseId_agentId: { licenseId, agentId: fromAccountId } },
      data: { role: 'admin' },
    });
  }
  await tx.agentMembership.update({
    where: { licenseId_agentId: { licenseId, agentId: toAccountId } },
    data: { role: 'owner' },
  });

  // Leading a team is the Team Lead's (RL-01 · tm 324.2): a mark left on the
  // owner would be a lead the role no longer backs — the same clean-up the
  // role change in `routes/agents.ts` does, scoped to this licence.
  if (target.role === 'team_lead') {
    await tx.groupAgent.updateMany({
      where: { licenseId, agentId: toAccountId, isLead: true },
      data: { isLead: false },
    });
  }
  return { previousRole: target.role };
}
