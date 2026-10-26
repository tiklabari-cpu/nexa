/**
 * What the root panel does to one workspace (tm 389.10 · FR-ADMIN-09 ·
 * design.md §C workspaces) — every by-hand `UPDATE licenses …` the SiyahTuş
 * team used to run in psql, as a function with a rule.
 *
 * Each action runs inside the caller's transaction (`routes/platform/
 * workspaces.ts`), which also writes the platform audit entry and the
 * workspace's own (`PlatformAuditLog.record`), so the change and both entries
 * commit together. Each one:
 *
 *   - **locks the licence row first** (`FOR NO KEY UPDATE`, the lock
 *     `license-activation.ts` takes, for its reason: foreign-key inserts
 *     already hold key-share locks on this row, and `FOR UPDATE` would
 *     deadlock against them), so two operators acting on one workspace are
 *     serialised and each decides from the state the other left;
 *   - **is idempotent**: asking for the state the workspace is already in is
 *     not an error — the outcome says `unchanged: true`, writes nothing, and
 *     the route records no entry (nothing happened);
 *   - **refuses a state it cannot act from** with 409
 *     `platform_workspace_state` and a `details.reason` from
 *     {@link WORKSPACE_STATE_REASONS} — never by guessing (a trial cannot be
 *     extended on a paid licence; a suspension cannot be lifted under a
 *     scheduled purge).
 *
 * The payload each returns is what the audit entry carries: identifiers,
 * states and changed field names — never the reason (the entry has its own
 * field) and never the workspace's content.
 *
 * Runs as `siyahtus_platform` (BYPASSRLS): every statement names its licence.
 */
import type { Prisma } from '@prisma/client';
import { ENTITLEMENTS, type Entitlement } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { TRIAL_PLAN } from '../../lib/entitlements.js';
import { PLANS, type PlanId } from '../billing/subscription-service.js';
import { setCancelAtPeriodEnd } from '../billing/subscription-cancel.js';
import { applyOwnershipSwap } from '../team/ownership-transfer.js';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;

/** `extend-trial`'s ceiling per call (days). */
export const TRIAL_EXTENSION_MAX_DAYS = 90;

/** How long a scheduled deletion waits before the purge job may act (FR-ADMIN-09). */
export const PURGE_COOLING_OFF_DAYS = 14;

/** The purge queue's page — the whole queue, in practice. */
export const PURGE_QUEUE_MAX = 100;

/** Why a workspace's state refused an action — `details.reason` of the 409. */
export const WORKSPACE_STATE_REASONS = [
  /** Only a trial can be extended. */
  'not_trialing',
  /** Suspended or cancelled: lift the suspension first (or it is wound down). */
  'workspace_closed',
  /** A running trial is active already — extend it or activate it. */
  'trialing',
  /** The suspension is holding a scheduled deletion — cancel that first. */
  'purge_scheduled',
  /** Nothing to cancel or resume: the workspace never subscribed. */
  'no_subscription',
  /** The workspace has no owner to mail. */
  'no_owner',
  /** The workspace has no sandbox, and is not one. */
  'no_sandbox',
  /** The account is not a member of this workspace. */
  'not_a_member',
  /** A suspended member cannot be made the owner. */
  'member_suspended',
] as const;
export type WorkspaceStateReason = (typeof WORKSPACE_STATE_REASONS)[number];

export function workspaceStateError(reason: WorkspaceStateReason, message: string): ApiError {
  return new ApiError('platform_workspace_state', message, { details: { reason } });
}

/** What an action did — `payload` lands in the audit entry when something changed. */
export interface ActionOutcome {
  unchanged: boolean;
  payload: Record<string, unknown>;
}

interface LockedLicense {
  id: bigint;
  organization_id: string;
  status: string;
  trial_ends_at: Date | null;
  suspended_at: Date | null;
  suspended_from_status: string | null;
  purge_scheduled_at: Date | null;
  sandbox_of_license_id: bigint | null;
}

/** The licence, locked for this transaction — or 404, like every unknown id here. */
async function lockLicense(tx: Tx, licenseId: bigint): Promise<LockedLicense> {
  const [row] = await tx.$queryRaw<LockedLicense[]>`
    SELECT id, organization_id, status, trial_ends_at, suspended_at, suspended_from_status,
           purge_scheduled_at, sandbox_of_license_id
      FROM licenses WHERE id = ${licenseId} FOR NO KEY UPDATE`;
  if (!row) throw ApiError.notFound('Workspace not found.');
  return row;
}

const unchanged = (payload: Record<string, unknown> = {}): ActionOutcome => ({
  unchanged: true,
  payload,
});
const changed = (payload: Record<string, unknown>): ActionOutcome => ({
  unchanged: false,
  payload,
});

const CLOSED = new Set(['suspended', 'canceled']);

function refuseClosed(license: LockedLicense): void {
  if (CLOSED.has(license.status)) {
    throw workspaceStateError(
      'workspace_closed',
      license.status === 'suspended'
        ? 'The workspace is suspended — lift the suspension first.'
        : 'The workspace is cancelled.',
    );
  }
}

// --- Trial and licence status ------------------------------------------------

/**
 * Push the trial's end `days` further out — from the current end, or from now
 * when it has already passed (a trial that ran out is read-only, and the
 * extension is what lets it write again).
 */
export async function extendTrial(
  tx: Tx,
  licenseId: bigint,
  days: number,
  now: Date,
): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  if (license.status !== 'trialing') {
    throw workspaceStateError('not_trialing', 'Only a workspace on trial can have it extended.');
  }
  const from = license.trial_ends_at;
  const base = Math.max(now.getTime(), from?.getTime() ?? now.getTime());
  const to = new Date(base + days * DAY_MS);
  await tx.license.update({ where: { id: licenseId }, data: { trialEndsAt: to } });
  return changed({ days, from: from?.toISOString() ?? null, to: to.toISOString() });
}

/**
 * Make the licence paid by hand — the activation a bank transfer or a signed
 * contract earns (`license-activation.ts` does the same when a plan and a card
 * meet). The trial ends with it.
 */
export async function activate(tx: Tx, licenseId: bigint): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  if (license.status === 'active') return unchanged();
  refuseClosed(license);
  await tx.license.update({
    where: { id: licenseId },
    data: { status: 'active', trialEndsAt: null },
  });
  return changed({ from: license.status });
}

/** Writes refused, reads allowed (ADR-10's read-only, set by hand). */
export async function setReadOnly(tx: Tx, licenseId: bigint): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  if (license.status === 'read_only') return unchanged();
  refuseClosed(license);
  await tx.license.update({ where: { id: licenseId }, data: { status: 'read_only' } });
  return changed({ from: license.status });
}

/** Back from read-only (or past due). A running trial is not this — see `activate`. */
export async function setActive(tx: Tx, licenseId: bigint): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  if (license.status === 'active') return unchanged();
  refuseClosed(license);
  if (license.status === 'trialing') {
    throw workspaceStateError(
      'trialing',
      'The workspace is on trial — extend the trial or activate the licence instead.',
    );
  }
  await tx.license.update({
    where: { id: licenseId },
    data: { status: 'active', trialEndsAt: null },
  });
  return changed({ from: license.status });
}

/**
 * The total lock (tm 389.2): every member, token and visitor of the workspace
 * is refused until it is lifted. `reason` is the operator's — stored on the
 * row for the panel, shown to nobody inside the workspace.
 */
export async function suspend(
  tx: Tx,
  licenseId: bigint,
  reason: string,
  now: Date,
): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  if (license.status === 'suspended') return unchanged();
  await tx.license.update({
    where: { id: licenseId },
    data: {
      status: 'suspended',
      suspendedAt: now,
      suspendedReason: reason,
      suspendedFromStatus: license.status,
    },
  });
  return changed({ from: license.status });
}

/**
 * Lift the suspension: the workspace goes back to the status it was suspended
 * from. Refused while a deletion is scheduled — the suspension is what keeps
 * the workspace closed for its last fourteen days.
 */
export async function unsuspend(tx: Tx, licenseId: bigint): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  if (license.status !== 'suspended') return unchanged();
  if (license.purge_scheduled_at !== null) {
    throw workspaceStateError(
      'purge_scheduled',
      'The workspace is scheduled for deletion — cancel the deletion first.',
    );
  }
  // A suspension set before the column existed says nothing: a trial end on
  // file means it was a trial.
  const to = license.suspended_from_status ?? (license.trial_ends_at ? 'trialing' : 'active');
  await tx.license.update({
    where: { id: licenseId },
    data: { status: to, suspendedAt: null, suspendedReason: null, suspendedFromStatus: null },
  });
  return changed({ to });
}

// --- Plan, subscription and overrides ----------------------------------------

/**
 * Put the workspace on `plan`: what it unlocks (`entitlementsForPlan`) and
 * what it lists at. The workspace's own checkout is untouched — it can still
 * change plan itself afterwards — and a `license_overrides` row still beats
 * whatever the plan says (`lib/entitlements.ts`).
 *
 * An operator's decision, so the self-serve downgrade guard
 * (`updateSubscription`: no move to a plan below this month's usage) does not
 * apply. A workspace without a subscription gets one, sized to its headcount;
 * the move from a quoted tier re-prices it at the list figures, a move to one
 * keeps the amounts already on the row (the rule `updateSubscription` states).
 */
export async function setPlan(tx: Tx, licenseId: bigint, plan: PlanId): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  const existing = await tx.subscription.findFirst({
    where: { licenseId },
    orderBy: { createdAt: 'desc' },
  });
  const current = existing?.plan ?? TRIAL_PLAN;
  if (current === plan) return unchanged();

  const spec = PLANS[plan];
  const fallback = PLANS.growth;
  const prices = {
    plan,
    unitPriceCents: spec.unitPriceCents ?? existing?.unitPriceCents ?? fallback.unitPriceCents,
    aiResolutionsIncluded:
      spec.aiResolutionsIncluded ??
      existing?.aiResolutionsIncluded ??
      fallback.aiResolutionsIncluded,
  };
  if (existing) {
    await tx.subscription.update({ where: { id: existing.id }, data: prices });
  } else {
    const headcount = await tx.agentMembership.count({ where: { licenseId, suspended: false } });
    await tx.subscription.create({
      data: {
        ...prices,
        licenseId,
        seats: Math.max(1, headcount),
        status: license.status === 'trialing' ? 'trialing' : 'active',
      },
    });
  }
  await tx.license.update({ where: { id: licenseId }, data: { plan } });
  return changed({ from: current, to: plan });
}

/** Set or clear the end-of-period cancellation (`subscription-cancel.ts`). */
export async function setSubscriptionCancellation(
  tx: Tx,
  licenseId: bigint,
  cancel: boolean,
  now: Date,
): Promise<ActionOutcome> {
  await lockLicense(tx, licenseId);
  const result = await setCancelAtPeriodEnd(tx, licenseId, cancel, now);
  if (!result) {
    throw workspaceStateError('no_subscription', 'The workspace has no subscription.');
  }
  const payload = {
    subscription_id: result.subscriptionId,
    current_period_end: result.currentPeriodEnd?.toISOString() ?? null,
  };
  return result.changed ? changed(payload) : unchanged(payload);
}

/** The override as the panel edits it — `PUT /workspaces/{id}/overrides`. */
export interface WorkspaceOverridesInput {
  entitlements: Partial<Record<Entitlement, boolean>>;
  seat_ceiling: number | null;
  mail_daily_cap: number | null;
  expires_at: Date | null;
}

export interface WorkspaceOverrides {
  entitlements: Partial<Record<Entitlement, boolean>>;
  seat_ceiling: number | null;
  mail_daily_cap: number | null;
  expires_at: string | null;
  /** False once `expires_at` has passed — the workspace reads it as no override. */
  in_force: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

const OVERRIDE_FIELDS = ['entitlements', 'seat_ceiling', 'mail_daily_cap', 'expires_at'] as const;

/** Keys in the vocabulary's order, so two equal maps compare equal as text. */
function canonicalEntitlements(value: unknown): Partial<Record<Entitlement, boolean>> {
  const out: Partial<Record<Entitlement, boolean>> = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  const map = value as Record<string, unknown>;
  for (const key of ENTITLEMENTS) {
    if (typeof map[key] === 'boolean') out[key] = map[key];
  }
  return out;
}

export async function readOverrides(
  tx: Tx,
  licenseId: bigint,
  now: Date,
): Promise<WorkspaceOverrides> {
  const row = await tx.licenseOverride.findUnique({ where: { licenseId } });
  return {
    entitlements: canonicalEntitlements(row?.entitlements),
    seat_ceiling: row?.seatCeiling ?? null,
    mail_daily_cap: row?.mailDailyCap ?? null,
    expires_at: row?.expiresAt?.toISOString() ?? null,
    in_force: row ? row.expiresAt === null || row.expiresAt.getTime() > now.getTime() : false,
    updated_by: row?.updatedBy ?? null,
    updated_at: row?.updatedAt.toISOString() ?? null,
  };
}

/**
 * Replace the workspace's override with `input` — the whole row, as `PUT`
 * says. An input that overrides nothing removes the row (the plan and the
 * deployment's defaults apply again). The payload names the fields that
 * changed, not their values.
 */
export async function putOverrides(
  tx: Tx,
  licenseId: bigint,
  input: WorkspaceOverridesInput,
  adminId: string,
  now: Date,
): Promise<ActionOutcome> {
  await lockLicense(tx, licenseId);
  if (input.expires_at !== null && input.expires_at.getTime() <= now.getTime()) {
    throw ApiError.validation('expires_at must be in the future.', {
      reason: 'expires_at_past',
    });
  }
  const before = await readOverrides(tx, licenseId, now);
  const next = {
    entitlements: canonicalEntitlements(input.entitlements),
    seat_ceiling: input.seat_ceiling,
    mail_daily_cap: input.mail_daily_cap,
    expires_at: input.expires_at?.toISOString() ?? null,
  };
  const changedFields = OVERRIDE_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(next[field]),
  );
  if (changedFields.length === 0) return unchanged();

  const empty =
    Object.keys(next.entitlements).length === 0 &&
    next.seat_ceiling === null &&
    next.mail_daily_cap === null;
  if (empty) {
    await tx.licenseOverride.deleteMany({ where: { licenseId } });
    return changed({ changed: changedFields, removed: true });
  }
  const data = {
    entitlements: next.entitlements as Prisma.InputJsonObject,
    seatCeiling: next.seat_ceiling,
    mailDailyCap: next.mail_daily_cap,
    expiresAt: input.expires_at,
    updatedBy: adminId,
    updatedAt: now,
  };
  await tx.licenseOverride.upsert({
    where: { licenseId },
    create: { licenseId, ...data },
    update: data,
  });
  return changed({ changed: changedFields });
}

// --- Owner, sandbox, ownership -----------------------------------------------

/** A link for the owner's mailbox, recorded — the route mails it after commit. */
export interface OwnerVerificationLink {
  accountId: string;
  email: string;
  locale: string | null;
}

/**
 * Spend the owner's earlier verification link and record a new one — the
 * owner's own resend (`auth_issue_email_verification`), on the owner's
 * behalf. An owner who has verified already is `unchanged`: nothing to send.
 */
export async function issueOwnerVerification(
  tx: Tx,
  licenseId: bigint,
  link: { hash: string; expiresAt: Date },
): Promise<ActionOutcome & { owner: OwnerVerificationLink | null }> {
  await lockLicense(tx, licenseId);
  const membership = await tx.agentMembership.findFirst({
    where: { licenseId, role: 'owner' },
    select: {
      locale: true,
      agent: { select: { id: true, email: true, emailVerifiedAt: true } },
    },
  });
  if (!membership) throw workspaceStateError('no_owner', 'The workspace has no owner.');
  const { agent } = membership;
  if (agent.emailVerifiedAt !== null) {
    return { ...unchanged({ account_id: agent.id }), owner: null };
  }
  const [row] = await tx.$queryRaw<Array<{ recorded_account: string | null }>>`
    SELECT recorded_account
      FROM auth_issue_email_verification(${agent.email}::citext, ${link.hash}, ${link.expiresAt})`;
  if (!row?.recorded_account) {
    return { ...unchanged({ account_id: agent.id }), owner: null };
  }
  return {
    ...changed({ account_id: agent.id }),
    owner: { accountId: agent.id, email: agent.email, locale: membership.locale },
  };
}

/**
 * Empty the workspace's sandbox (`sandbox_reset`, 20260815200000) — the
 * workspace's own, or the workspace itself when it is one. Every credential
 * inside the sandbox dies with it, as when its members reset it themselves.
 */
export async function resetSandbox(tx: Tx, licenseId: bigint): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  const sandboxId =
    license.sandbox_of_license_id !== null
      ? license.id
      : (
          await tx.license.findUnique({
            where: { sandboxOfLicenseId: licenseId },
            select: { id: true },
          })
        )?.id;
  if (sandboxId === undefined) {
    throw workspaceStateError('no_sandbox', 'The workspace has no sandbox.');
  }
  const [row] = await tx.$queryRaw<Array<{ reset_at: Date }>>`
    SELECT sandbox_reset(${sandboxId}) AS reset_at`;
  return changed({
    sandbox_license_id: sandboxId.toString(),
    reset_at: row?.reset_at.toISOString() ?? null,
  });
}

/** What an operator confirmed before forcing a transfer (FR-ADMIN-09). */
export interface OwnershipVerificationChecklist {
  /** The support ticket the request arrived on. */
  ticket_id: string;
  /** A signed request from the workspace's organisation is on file. */
  signed_request: true;
  /** The requester was called back on a number the workspace already had. */
  phone_verified: true;
}

export interface OwnershipTransferOutcome extends ActionOutcome {
  fromAccountId: string | null;
  toAccountId: string;
}

/**
 * Make `toAccountId` the owner and the current owner an admin, in one
 * transaction (`applyOwnershipSwap` — the single-owner invariant). The
 * checklist travels into the audit entry, so the chain says what was
 * verified, not only that somebody clicked.
 */
export async function forceOwnershipTransfer(
  tx: Tx,
  licenseId: bigint,
  toAccountId: string,
  checklist: OwnershipVerificationChecklist,
): Promise<OwnershipTransferOutcome> {
  await lockLicense(tx, licenseId);
  const members = await tx.agentMembership.findMany({
    where: { licenseId, OR: [{ role: 'owner' }, { agentId: toAccountId }] },
    select: { agentId: true, role: true, suspended: true },
  });
  const target = members.find((member) => member.agentId === toAccountId);
  if (!target) {
    throw workspaceStateError('not_a_member', 'That account is not a member of this workspace.');
  }
  const fromAccountId = members.find((member) => member.role === 'owner')?.agentId ?? null;
  if (target.role === 'owner') {
    return { ...unchanged(), fromAccountId, toAccountId };
  }
  if (target.suspended) {
    throw workspaceStateError('member_suspended', 'A suspended member cannot become the owner.');
  }
  const swap = await applyOwnershipSwap(tx, licenseId, fromAccountId, toAccountId);
  return {
    ...changed({
      from_account_id: fromAccountId,
      to_account_id: toAccountId,
      previous_role: swap.previousRole,
      verification_checklist: checklist,
    }),
    fromAccountId,
    toAccountId,
  };
}

// --- Deletion ----------------------------------------------------------------

/**
 * Schedule the workspace's deletion {@link PURGE_COOLING_OFF_DAYS} days out,
 * suspending it meanwhile (if it was not already). `confirmName` must be the
 * organization's name, typed — the panel's guard against deleting the wrong
 * tab's workspace, held here too so a script cannot skip it.
 */
export async function scheduleDeletion(
  tx: Tx,
  licenseId: bigint,
  input: { confirmName: string; reason: string },
  now: Date,
): Promise<ActionOutcome & { purgeAt: Date }> {
  const license = await lockLicense(tx, licenseId);
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: license.organization_id },
    select: { name: true },
  });
  if (input.confirmName.trim() !== organization.name.trim()) {
    throw ApiError.validation('confirm_name does not match the workspace name.', {
      reason: 'confirm_name_mismatch',
    });
  }
  if (license.purge_scheduled_at !== null) {
    return {
      ...unchanged({ purge_scheduled_at: license.purge_scheduled_at.toISOString() }),
      purgeAt: license.purge_scheduled_at,
    };
  }
  const purgeAt = new Date(now.getTime() + PURGE_COOLING_OFF_DAYS * DAY_MS);
  const suspending = license.status !== 'suspended';
  await tx.license.update({
    where: { id: licenseId },
    data: {
      purgeScheduledAt: purgeAt,
      ...(suspending
        ? {
            status: 'suspended',
            suspendedAt: now,
            suspendedReason: input.reason,
            suspendedFromStatus: license.status,
          }
        : {}),
    },
  });
  return {
    ...changed({ purge_scheduled_at: purgeAt.toISOString(), suspended: suspending }),
    purgeAt,
  };
}

/**
 * Take the scheduled deletion back. The suspension stays: it may have been
 * there before the deletion, and lifting it is its own decision
 * (`unsuspend`, with a fresh code).
 */
export async function cancelDeletion(tx: Tx, licenseId: bigint): Promise<ActionOutcome> {
  const license = await lockLicense(tx, licenseId);
  if (license.purge_scheduled_at === null) return unchanged();
  await tx.license.update({ where: { id: licenseId }, data: { purgeScheduledAt: null } });
  return changed({ purge_scheduled_at: license.purge_scheduled_at.toISOString() });
}

export interface PurgeQueueItem {
  license_id: string;
  organization_name: string;
  status: string;
  suspended_at: string | null;
  purge_scheduled_at: string;
}

/** Every scheduled deletion, the soonest first. */
export async function purgeQueue(db: Tx): Promise<PurgeQueueItem[]> {
  const rows = await db.license.findMany({
    where: { purgeScheduledAt: { not: null } },
    orderBy: [{ purgeScheduledAt: 'asc' }, { id: 'asc' }],
    take: PURGE_QUEUE_MAX,
    select: {
      id: true,
      status: true,
      suspendedAt: true,
      purgeScheduledAt: true,
      organization: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    license_id: row.id.toString(),
    organization_name: row.organization.name,
    status: row.status,
    suspended_at: row.suspendedAt?.toISOString() ?? null,
    purge_scheduled_at: row.purgeScheduledAt!.toISOString(),
  }));
}
