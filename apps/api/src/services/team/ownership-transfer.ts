/**
 * Moving a workspace's ownership (the Kurucu) from one member to another.
 *
 * Two doors lead here. The owner's own transfer (RL-05 · tm 328): the owner
 * offers the workspace to a member, who accepts within
 * {@link OWNERSHIP_TRANSFER_TTL_HOURS} hours with the token mailed to them —
 * `startTransfer`, `cancelTransfer`, `acceptTransfer` below, routed by
 * `routes/ownership-transfers.ts`. And the root panel's forced transfer (tm
 * 389.10 · FR-ADMIN-09), for when the owner cannot be reached — SiyahTuş
 * support's verified manual process (RL-05-S3), with no panel path inside the
 * workspace. Both end in {@link applyOwnershipSwap}, so the single-owner
 * invariant is enforced in one place.
 *
 * The invariant is `uq_license_single_owner`, a partial unique index on
 * `agent_memberships (license_id) WHERE role = 'owner'` — not deferrable, so
 * it is checked row by row, and one `UPDATE … SET role = CASE …` over both
 * memberships may visit the new owner first and fail. Two statements in this
 * order never break it: the previous owner steps down to `admin` first, so for
 * the instant between them the workspace has no owner (which the index allows
 * and nothing outside this transaction can see), then the new owner steps up
 * (RL-05-S2).
 *
 * Every query names the licence. The caller may hold a connection without row
 * level security (the platform role), where a membership filter by account
 * alone would reach the same person's seats in other workspaces.
 *
 * A transfer that ran out of time is not swept by a job: whichever request
 * touches the workspace's transfers next records it as expired (with its
 * audit entry, dated by the expiry rather than the visit) before doing its
 * own work. Nothing can act on a transfer without passing through that, so
 * an expired one is never accepted, and the pending-per-workspace index
 * never blocks a new offer behind a dead one.
 */
import { Prisma, type OwnershipTransfer } from '@prisma/client';
import { ApiError } from '../../lib/api-error.js';
import { constantTimeEqual, hashToken } from '../../lib/crypto.js';
import type { TenantClient } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';

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
  tx: Prisma.TransactionClient | TenantClient,
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

// ---------------------------------------------------------------------------
// The owner's own transfer (RL-05 · tm 328)
// ---------------------------------------------------------------------------

/** How long the member has to accept (RL-05-S1). */
export const OWNERSHIP_TRANSFER_TTL_HOURS = 72;

export const OWNERSHIP_TRANSFER_STATES = ['pending', 'accepted', 'cancelled', 'expired'] as const;
export type OwnershipTransferState = (typeof OWNERSHIP_TRANSFER_STATES)[number];

/** `details.reason` of a `409 ownership_transfer_state`. */
export type OwnershipTransferRefusal =
  | 'pending_exists'
  | 'not_pending'
  | 'owner_changed'
  | 'target_suspended'
  | 'target_unverified'
  | 'target_two_factor_required';

export function transferRefused(
  reason: OwnershipTransferRefusal,
  message: string,
  extra: Record<string, unknown> = {},
): ApiError {
  return new ApiError('ownership_transfer_state', message, { details: { reason, ...extra } });
}

export interface OwnershipTransferParty {
  id: string;
  name: string;
  email: string;
}

/** The contract's `OwnershipTransfer`. */
export interface OwnershipTransferView {
  id: string;
  state: OwnershipTransferState;
  from_agent: OwnershipTransferParty;
  to_agent: OwnershipTransferParty;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  sso_enforced: boolean;
}

type TransferRow = OwnershipTransfer;

/**
 * What the second-factor service knows about the member, asked outside the
 * transaction (it reads through its own SECURITY DEFINER functions): whether
 * they hold a live factor, and whether this workspace requires one.
 */
export interface TargetFactorFacts {
  twoFactorActive: boolean;
  workspaceRequiresTwoFactor: boolean;
}

/** The member a transfer names, as the mail to them needs it. */
export interface TransferMember {
  accountId: string;
  email: string;
  name: string;
  locale: string | null;
}

/**
 * Whether the workspace signs its members in through an identity provider —
 * the owner is exempt (break-glass, `passwordLoginAvailable` in
 * `routes/auth.ts`), so a transfer moves the exemption with the role.
 */
async function ssoEnforced(tx: TenantClient): Promise<boolean> {
  const connection = await tx.ssoConnection.findFirst({
    where: { enabled: true, enforced: true },
    select: { id: true },
  });
  return connection !== null;
}

export async function viewTransfer(
  tx: TenantClient,
  row: TransferRow,
): Promise<OwnershipTransferView> {
  // Separate from the row on purpose: a party who has since left the
  // workspace is no longer readable through `accounts`' policy, and a
  // required relation would make that row unreadable too.
  const [people, enforced] = await Promise.all([
    tx.account.findMany({
      where: { id: { in: [row.fromAccountId, row.toAccountId] } },
      select: { id: true, name: true, email: true },
    }),
    ssoEnforced(tx),
  ]);
  const party = (id: string): OwnershipTransferParty => {
    const person = people.find((p) => p.id === id);
    return { id, name: person?.name ?? '', email: person?.email ?? '' };
  };
  return {
    id: row.id,
    state: row.state as OwnershipTransferState,
    from_agent: party(row.fromAccountId),
    to_agent: party(row.toAccountId),
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
    decided_at: row.decidedAt?.toISOString() ?? null,
    sso_enforced: enforced,
  };
}

/**
 * Record every pending transfer of the workspace whose time ran out as
 * expired, each with its audit entry. The entry is the system's, not the
 * visitor's: nobody decided it, the clock did.
 */
export async function expireStaleTransfers(
  tx: TenantClient,
  audit: AuditContext,
  now: Date,
): Promise<number> {
  const stale = await tx.ownershipTransfer.findMany({
    where: { licenseId: audit.licenseId, state: 'pending', expiresAt: { lte: now } },
    select: { id: true, fromAccountId: true, toAccountId: true, expiresAt: true },
  });
  let expired = 0;
  for (const row of stale) {
    // Conditional, so two requests that both saw it stale write one entry.
    const flipped = await tx.ownershipTransfer.updateMany({
      where: { id: row.id, state: 'pending' },
      data: { state: 'expired', decidedAt: row.expiresAt },
    });
    if (flipped.count === 0) continue;
    expired += 1;
    await writeAuditEntry(
      tx,
      { ...audit, actorType: 'system', actorId: null, onBehalfOf: null },
      {
        action: 'ownership.transfer_expired',
        target: `ownership_transfer:${row.id}`,
        metadata: {
          from_account_id: row.fromAccountId,
          to_account_id: row.toAccountId,
          expired_at: row.expiresAt.toISOString(),
        },
      },
    );
  }
  return expired;
}

/** The workspace's pending transfer, after expiring the stale ones. */
export async function currentTransfer(
  tx: TenantClient,
  audit: AuditContext,
  now: Date,
): Promise<TransferRow | null> {
  await expireStaleTransfers(tx, audit, now);
  return tx.ownershipTransfer.findFirst({
    where: { licenseId: audit.licenseId, state: 'pending' },
  });
}

/**
 * Refuse a member who cannot hold the workspace: not a member (404), already
 * its owner (400), suspended / awaiting approval / blocked by SiyahTuş, an
 * unconfirmed address, or no second factor where the workspace requires one
 * (409). Asked when the offer is made and again when it is accepted — a
 * member suspended in between does not take the workspace over.
 */
export async function assertTargetCanOwn(
  tx: TenantClient,
  licenseId: bigint,
  accountId: string,
  facts: TargetFactorFacts,
): Promise<TransferMember & { role: string }> {
  const membership = await tx.agentMembership.findUnique({
    where: { licenseId_agentId: { licenseId, agentId: accountId } },
    select: {
      role: true,
      suspended: true,
      awaitingApproval: true,
      locale: true,
      agent: {
        select: {
          email: true,
          name: true,
          emailVerifiedAt: true,
          platformSuspendedAt: true,
        },
      },
    },
  });
  if (!membership) throw ApiError.notFound('Agent not found.');
  if (membership.role === 'owner') {
    throw ApiError.validation('target_agent_id: that member already owns the workspace.', {
      reason: 'target_is_owner',
    });
  }
  if (
    membership.suspended ||
    membership.awaitingApproval ||
    membership.agent.platformSuspendedAt !== null
  ) {
    throw transferRefused('target_suspended', 'A suspended member cannot become the owner.');
  }
  if (membership.agent.emailVerifiedAt === null) {
    throw transferRefused(
      'target_unverified',
      'The member has not confirmed their email address yet.',
    );
  }
  if (facts.workspaceRequiresTwoFactor && !facts.twoFactorActive) {
    throw transferRefused(
      'target_two_factor_required',
      'This workspace requires two-factor authentication, and the member has not set it up.',
    );
  }
  return {
    accountId,
    email: membership.agent.email,
    name: membership.agent.name,
    locale: membership.locale,
    role: membership.role,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export interface StartTransferInput {
  fromAccountId: string;
  toAccountId: string;
  tokenHash: string;
  facts: TargetFactorFacts;
  now: Date;
}

/**
 * Record the offer. One pending per workspace: a second is refused naming the
 * first, and two racing offers meet the partial unique index — the loser
 * hears the same refusal.
 */
export async function startTransfer(
  tx: TenantClient,
  audit: AuditContext,
  input: StartTransferInput,
): Promise<{ row: TransferRow; target: TransferMember }> {
  const licenseId = audit.licenseId;
  await expireStaleTransfers(tx, audit, input.now);
  const pending = await tx.ownershipTransfer.findFirst({
    where: { licenseId, state: 'pending' },
    select: { id: true },
  });
  if (pending) {
    throw transferRefused(
      'pending_exists',
      'An ownership transfer is already pending. Cancel it before offering a new one.',
      { transfer_id: pending.id },
    );
  }
  const target = await assertTargetCanOwn(tx, licenseId, input.toAccountId, input.facts);

  let row: TransferRow;
  try {
    row = await tx.ownershipTransfer.create({
      data: {
        licenseId,
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        tokenHash: input.tokenHash,
        createdAt: input.now,
        expiresAt: new Date(input.now.getTime() + OWNERSHIP_TRANSFER_TTL_HOURS * 3_600_000),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw transferRefused(
        'pending_exists',
        'An ownership transfer is already pending. Cancel it before offering a new one.',
      );
    }
    throw error;
  }

  await writeAuditEntry(tx, audit, {
    action: 'ownership.transfer_requested',
    target: `account:${input.toAccountId}`,
    metadata: {
      transfer_id: row.id,
      to_account_id: input.toAccountId,
      to_role: target.role,
      expires_at: row.expiresAt.toISOString(),
    },
  });
  return { row, target };
}

/** Transfer `id` of this workspace, its row locked until the transaction ends; 404 if none. */
async function lockTransfer(tx: TenantClient, licenseId: bigint, id: string): Promise<TransferRow> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM ownership_transfers
     WHERE id = ${id}::uuid AND license_id = ${licenseId}
       FOR UPDATE`;
  if (locked.length === 0) throw ApiError.notFound('Ownership transfer not found.');
  return tx.ownershipTransfer.findUniqueOrThrow({ where: { id } });
}

function notPending(row: TransferRow): ApiError {
  return transferRefused('not_pending', `This ownership transfer is ${row.state}.`, {
    state: row.state,
  });
}

/** The owner takes the offer back. The member's link stops working. */
export async function cancelTransfer(
  tx: TenantClient,
  audit: AuditContext,
  input: { id: string; now: Date },
): Promise<{ row: TransferRow; target: TransferMember | null }> {
  await expireStaleTransfers(tx, audit, input.now);
  const row = await lockTransfer(tx, audit.licenseId, input.id);
  if (row.state !== 'pending') throw notPending(row);

  const cancelled = await tx.ownershipTransfer.update({
    where: { id: row.id },
    data: { state: 'cancelled', decidedAt: input.now },
  });
  await writeAuditEntry(tx, audit, {
    action: 'ownership.transfer_cancelled',
    target: `account:${row.toAccountId}`,
    metadata: { transfer_id: row.id, to_account_id: row.toAccountId, cause: 'owner' },
  });
  return { row: cancelled, target: await memberOf(tx, audit.licenseId, row.toAccountId) };
}

async function memberOf(
  tx: TenantClient,
  licenseId: bigint,
  accountId: string,
): Promise<TransferMember | null> {
  const membership = await tx.agentMembership.findUnique({
    where: { licenseId_agentId: { licenseId, agentId: accountId } },
    select: { locale: true, agent: { select: { email: true, name: true } } },
  });
  if (!membership) return null;
  return {
    accountId,
    email: membership.agent.email,
    name: membership.agent.name,
    locale: membership.locale,
  };
}

/** What happened to the billing profile's invoice address. */
export type BillingContactOutcome = 'moved' | 'kept' | 'none';

export interface AcceptTransferInput {
  id: string;
  /** The caller — must be the member the transfer names. */
  accountId: string;
  token: string;
  facts: TargetFactorFacts;
  now: Date;
}

export type AcceptTransferOutcome =
  | {
      kind: 'accepted';
      row: TransferRow;
      fromAccountId: string;
      previousRole: string;
      billingContact: BillingContactOutcome;
      ssoEnforced: boolean;
    }
  /**
   * The workspace's owner is no longer the one who made the offer (the root
   * panel moved it meanwhile). The transfer is cancelled in this transaction,
   * so the caller commits and then refuses — a throw would undo the cancel.
   */
  | { kind: 'owner_changed'; row: TransferRow };

/**
 * The member takes the workspace: the previous owner becomes an admin, the
 * member the owner (RL-05-S2), the transfer `accepted` — one transaction.
 *
 * The transfer row and both memberships are locked first, so a second accept,
 * a cancel, a role change or a suspension of either party waits for this and
 * then sees the result. A forced transfer from the root panel racing this one
 * meets the single-owner index; the route answers that as `owner_changed`.
 */
export async function acceptTransfer(
  tx: TenantClient,
  audit: AuditContext,
  input: AcceptTransferInput,
): Promise<AcceptTransferOutcome> {
  const licenseId = audit.licenseId;
  await expireStaleTransfers(tx, audit, input.now);
  const row = await lockTransfer(tx, licenseId, input.id);
  if (row.toAccountId !== input.accountId) {
    throw ApiError.authorization('This ownership transfer is offered to another member.');
  }
  if (!constantTimeEqual(hashToken(input.token), row.tokenHash)) {
    throw new ApiError('not_allowed', 'That link is not valid for this ownership transfer.', {
      details: { reason: 'invalid_token' },
    });
  }
  if (row.state !== 'pending') throw notPending(row);

  await tx.$queryRaw<Array<{ agent_id: string }>>`
    SELECT agent_id FROM agent_memberships
     WHERE license_id = ${licenseId}
       AND (role = 'owner' OR agent_id IN (${row.fromAccountId}::uuid, ${row.toAccountId}::uuid))
       FOR UPDATE`;
  const owner = await tx.agentMembership.findFirst({
    where: { licenseId, role: 'owner' },
    select: { agentId: true },
  });
  if (owner?.agentId !== row.fromAccountId) {
    const cancelled = await tx.ownershipTransfer.update({
      where: { id: row.id },
      data: { state: 'cancelled', decidedAt: input.now },
    });
    await writeAuditEntry(
      tx,
      { ...audit, actorType: 'system', actorId: null, onBehalfOf: null },
      {
        action: 'ownership.transfer_cancelled',
        target: `account:${row.toAccountId}`,
        metadata: { transfer_id: row.id, to_account_id: row.toAccountId, cause: 'owner_changed' },
      },
    );
    return { kind: 'owner_changed', row: cancelled };
  }

  await assertTargetCanOwn(tx, licenseId, input.accountId, input.facts);
  const swap = await applyOwnershipSwap(tx, licenseId, row.fromAccountId, row.toAccountId);
  const billingContact = await moveBillingContact(tx, licenseId, row);
  const enforced = await ssoEnforced(tx);

  const accepted = await tx.ownershipTransfer.update({
    where: { id: row.id },
    data: { state: 'accepted', decidedAt: input.now },
  });
  await writeAuditEntry(tx, audit, {
    action: 'ownership.transfer_accepted',
    target: `account:${row.toAccountId}`,
    metadata: {
      transfer_id: row.id,
      from_account_id: row.fromAccountId,
      to_account_id: row.toAccountId,
      from_role: 'owner',
      from_role_now: 'admin',
      to_previous_role: swap.previousRole,
      billing_contact: billingContact,
      sso_enforced: enforced,
    },
  });
  return {
    kind: 'accepted',
    row: accepted,
    fromAccountId: row.fromAccountId,
    previousRole: swap.previousRole,
    billingContact,
    ssoEnforced: enforced,
  };
}

/**
 * The invoice address on the billing profile follows the owner when it was
 * the previous owner's own address; any other address (an accounts mailbox)
 * stays, and the new owner is told so they can decide. Billing mail itself is
 * addressed to whoever holds the owner role, so it needs no move.
 */
async function moveBillingContact(
  tx: TenantClient,
  licenseId: bigint,
  row: TransferRow,
): Promise<BillingContactOutcome> {
  const profile = await tx.billingProfile.findUnique({
    where: { licenseId },
    select: { invoiceEmail: true },
  });
  if (!profile?.invoiceEmail) return 'none';
  const people = await tx.account.findMany({
    where: { id: { in: [row.fromAccountId, row.toAccountId] } },
    select: { id: true, email: true },
  });
  const from = people.find((p) => p.id === row.fromAccountId)?.email;
  const to = people.find((p) => p.id === row.toAccountId)?.email;
  if (!from || !to || profile.invoiceEmail.toLowerCase() !== from.toLowerCase()) return 'kept';
  await tx.billingProfile.update({
    where: { licenseId },
    data: { invoiceEmail: to, updatedBy: row.toAccountId },
  });
  return 'moved';
}

/**
 * Who hears that the workspace changed hands: both parties and every admin
 * (RL-05 — so a transfer nobody expected cannot pass unnoticed). Suspended
 * members are left out, as in the root panel's notice.
 */
export async function acceptanceRecipients(
  tx: TenantClient,
  licenseId: bigint,
  fromAccountId: string,
  toAccountId: string,
): Promise<Array<TransferMember & { part: 'new_owner' | 'previous_owner' | 'admin' }>> {
  const members = await tx.agentMembership.findMany({
    where: {
      licenseId,
      suspended: false,
      OR: [
        { agentId: { in: [fromAccountId, toAccountId] } },
        { role: { in: ['admin', 'viceowner'] } },
      ],
    },
    select: { agentId: true, locale: true, agent: { select: { email: true, name: true } } },
  });
  return members.map((m) => ({
    accountId: m.agentId,
    email: m.agent.email,
    name: m.agent.name,
    locale: m.locale,
    part:
      m.agentId === toAccountId
        ? 'new_owner'
        : m.agentId === fromAccountId
          ? 'previous_owner'
          : 'admin',
  }));
}
