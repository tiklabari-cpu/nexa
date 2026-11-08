/**
 * Cancelling a subscription at the end of its period, taking that back, and
 * what happens when the period ends (tm 389.10 · tm 384 · BL-03).
 *
 * The timeline is `@siyahtus/types`' `subscription-cancel.ts`. Here:
 *
 *   - {@link setCancelAtPeriodEnd} — the flag alone, shared by the owner's
 *     `POST /billing/subscription/cancel|resume` and the root panel's
 *     workspace action (389.10). The actor and the audit entry are the
 *     caller's, so the function knows neither.
 *   - {@link cancelSubscription} / {@link resumeSubscription} — the owner's
 *     side: the typed workspace name, the reason, the audit entry.
 *   - {@link SubscriptionPeriodEnd} — the step the period-close job
 *     (`invoice_close`) runs: a flagged subscription whose period has ended
 *     becomes `canceled` and its workspace read-only (the expired trial's gate,
 *     `license-gate.ts`); thirty days later the workspace closes. Deleting it
 *     is the retention sweep's (`retention.ts`, `subscription_cancel_purge`).
 *   - {@link reopenCanceledSubscription} — a new purchase after the end: the
 *     dates go, so nothing deletes a workspace that pays again.
 *
 * Nothing is refunded (BL-03 decision 2) and no processor is called: the
 * subscription renews only through our own dunning job, which skips a flagged
 * one (`stripe-payments.ts`) — the flag is the provider-side cancellation.
 *
 * Addressed by licence, not left to row level security alone, so the platform
 * role (which has none) and the tenant role read the same row.
 */
import type { Prisma, PrismaClient, Subscription } from '@prisma/client';
import {
  cancellationDeletionAt,
  cancellationExportUntil,
  cancellationTakesEffectAt,
  type CancelReason,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import { deliver } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { isMailLocale } from '../mail/templates/layout.js';
import { subscriptionCancelMail } from '../mail/templates/messages.js';

export interface CancelAtPeriodEndChange {
  subscriptionId: string;
  changed: boolean;
  currentPeriodEnd: Date | null;
  /** The period already ended: the subscription is `canceled`, nothing moved. */
  ended: boolean;
}

/**
 * Set or clear the flag on the workspace's latest subscription. Null when the
 * workspace has none — a trial has nothing to cancel. `changed: false` when
 * the flag already said so, or when the subscription has already ended (then
 * `ended: true`: resuming is a new purchase), so the caller can skip its audit
 * entry.
 */
export async function setCancelAtPeriodEnd(
  tx: Prisma.TransactionClient,
  licenseId: bigint,
  cancel: boolean,
  now: Date,
  options: { reason?: CancelReason | null } = {},
): Promise<CancelAtPeriodEndChange | null> {
  const subscription = await tx.subscription.findFirst({
    where: { licenseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, cancelAtPeriodEnd: true, currentPeriodEnd: true, status: true },
  });
  if (!subscription) return null;
  const result = {
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
  if (subscription.status === 'canceled') return { ...result, changed: false, ended: true };
  if (subscription.cancelAtPeriodEnd === cancel) return { ...result, changed: false, ended: false };

  await tx.subscription.update({
    where: { id: subscription.id },
    data: cancel
      ? { cancelAtPeriodEnd: true, canceledAt: now, cancelReason: options.reason ?? null }
      : { cancelAtPeriodEnd: false, canceledAt: null, cancelReason: null },
  });
  return { ...result, changed: true, ended: false };
}

/** The licence row, locked like every billing write that can move it (`payment-methods.ts`). */
async function lockLicense(tx: TenantClient, licenseId: bigint): Promise<string | null> {
  const [row] = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM licenses WHERE id = ${licenseId} FOR NO KEY UPDATE`;
  return row?.status ?? null;
}

/** Case and surrounding space do not matter; everything else does. */
function sameName(typed: string, name: string): boolean {
  return typed.trim().toLocaleLowerCase('tr') === name.trim().toLocaleLowerCase('tr');
}

export interface OwnerCancelInput {
  reason: CancelReason;
  /** The workspace's name, typed by the owner as the confirmation. */
  confirmation: string;
  audit: AuditContext;
  now: Date;
}

export interface CancelOutcome {
  changed: boolean;
  takesEffectAt: Date;
}

/**
 * The owner cancels. Refused (400 `validation`) when the typed name is not the
 * workspace's (`confirmation_mismatch`), when there is nothing to cancel
 * (`no_subscription` — a trial) or when the subscription already ended
 * (`subscription_ended`). Cancelling twice is one cancellation: the second
 * call changes nothing and writes no audit entry.
 */
export async function cancelSubscription(
  tx: TenantClient,
  tenant: TenantContext,
  input: OwnerCancelInput,
): Promise<CancelOutcome> {
  const organization = await tx.organization.findUnique({
    where: { id: tenant.organizationId },
    select: { name: true },
  });
  if (!organization || !sameName(input.confirmation, organization.name)) {
    throw ApiError.validation('The workspace name does not match.', {
      reason: 'confirmation_mismatch',
    });
  }
  await lockLicense(tx, tenant.licenseId);
  const result = await setCancelAtPeriodEnd(tx, tenant.licenseId, true, input.now, {
    reason: input.reason,
  });
  if (!result) {
    throw ApiError.validation('The workspace has no subscription to cancel.', {
      reason: 'no_subscription',
    });
  }
  if (result.ended) {
    throw ApiError.validation('The subscription has already ended.', {
      reason: 'subscription_ended',
    });
  }
  const row = await tx.subscription.findUniqueOrThrow({ where: { id: result.subscriptionId } });
  const takesEffectAt = cancellationTakesEffectAt(
    row.currentPeriodEnd,
    row.canceledAt ?? input.now,
  );
  if (result.changed) {
    await writeAuditEntry(tx, input.audit, {
      action: 'billing.subscription_cancel_scheduled',
      target: `subscription:${result.subscriptionId}`,
      metadata: { reason: input.reason, takes_effect_at: takesEffectAt.toISOString() },
    });
  }
  return { changed: result.changed, takesEffectAt };
}

/**
 * The owner takes the cancellation back. The same refusals as
 * {@link cancelSubscription} for no subscription and an ended one; resuming
 * one that was never cancelled changes nothing.
 */
export async function resumeSubscription(
  tx: TenantClient,
  tenant: TenantContext,
  input: { audit: AuditContext; now: Date },
): Promise<{ changed: boolean }> {
  await lockLicense(tx, tenant.licenseId);
  const result = await setCancelAtPeriodEnd(tx, tenant.licenseId, false, input.now);
  if (!result) {
    throw ApiError.validation('The workspace has no subscription.', { reason: 'no_subscription' });
  }
  if (result.ended) {
    throw ApiError.validation(
      'The subscription has already ended; subscribing again is a new purchase.',
      { reason: 'subscription_ended' },
    );
  }
  if (result.changed) {
    await writeAuditEntry(tx, input.audit, {
      action: 'billing.subscription_resumed',
      target: `subscription:${result.subscriptionId}`,
      metadata: {},
    });
  }
  return { changed: result.changed };
}

/** The fields that make a subscription "canceled"; a new purchase clears them. */
const REOPENED = {
  status: 'active',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  cancelReason: null,
  endedAt: null,
  exportUntil: null,
  dataDeletionAt: null,
} as const;

/**
 * A workspace whose subscription ended buys again (a payment, or a plan and a
 * card on the mocked checkout): the subscription is active and its export
 * window and deletion date are gone. Called where the licence leaves
 * read-only — `activateIfPaid`, `settlePayment` — under their licence lock.
 */
export async function reopenCanceledSubscription(
  tx: Prisma.TransactionClient,
  licenseId: bigint,
): Promise<boolean> {
  const { count } = await tx.subscription.updateMany({
    where: { licenseId, status: 'canceled' },
    data: REOPENED,
  });
  return count > 0;
}

/** The fields {@link reopenCanceledSubscription} writes, for an update that also sets others. */
export function reopenedFields(
  subscription: Pick<Subscription, 'status'>,
): Partial<typeof REOPENED> {
  return subscription.status === 'canceled' ? REOPENED : {};
}

/** `GET /billing/subscription`'s `cancellation`. */
export interface CancellationView {
  scheduled: boolean;
  reason: string | null;
  requested_at: string | null;
  takes_effect_at: string | null;
  ended_at: string | null;
  export_until: string | null;
  data_deletion_at: string | null;
  can_cancel: boolean;
  can_resume: boolean;
  workspace_name: string;
}

export function cancellationView(
  subscription: Subscription | null,
  workspaceName: string,
  now: Date,
): CancellationView {
  const ended = subscription?.status === 'canceled';
  const scheduled = Boolean(subscription?.cancelAtPeriodEnd) && !ended;
  const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
  return {
    scheduled,
    reason: subscription?.cancelReason ?? null,
    requested_at: iso(subscription?.canceledAt),
    takes_effect_at:
      scheduled && subscription
        ? cancellationTakesEffectAt(
            subscription.currentPeriodEnd,
            subscription.canceledAt ?? now,
          ).toISOString()
        : null,
    ended_at: iso(subscription?.endedAt),
    export_until: iso(subscription?.exportUntil),
    data_deletion_at: iso(subscription?.dataDeletionAt),
    can_cancel: subscription !== null && !ended && !scheduled,
    can_resume: scheduled,
    workspace_name: workspaceName,
  };
}

// ---------------------------------------------------------------------------
// The mail to the owners
// ---------------------------------------------------------------------------

interface OwnerRecipient {
  email: string;
  locale: 'en' | 'tr';
}

async function ownerRecipients(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<{ owners: OwnerRecipient[]; workspaceName: string }> {
  const [members, organization] = await Promise.all([
    tx.agentMembership.findMany({
      where: { licenseId: tenant.licenseId, suspended: false, role: 'owner' },
      orderBy: { createdAt: 'asc' },
      select: { locale: true, agent: { select: { email: true } } },
    }),
    tx.organization.findUnique({ where: { id: tenant.organizationId }, select: { name: true } }),
  ]);
  const owners: OwnerRecipient[] = [];
  for (const member of members) {
    if (!member.agent.email) continue;
    owners.push({
      email: member.agent.email,
      locale: isMailLocale(member.locale) ? member.locale : 'en',
    });
  }
  return { owners, workspaceName: organization?.name ?? 'SiyahTuş' };
}

export type CancellationMailFacts =
  | { kind: 'scheduled'; takesEffectAt: Date }
  | { kind: 'resumed' }
  | { kind: 'ended'; exportUntil: Date; dataDeletionAt: Date | null };

export interface CancellationMailOptions {
  mailer?: Mailer;
  appUrl?: string;
  log?: { warn: (obj: object, msg: string) => void };
}

/** What a sender needs after its transaction: who, in which language, about which workspace. */
export type CancellationMailPlan = Awaited<ReturnType<typeof ownerRecipients>>;

export function readCancellationRecipients(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<CancellationMailPlan> {
  return ownerRecipients(tx, tenant);
}

/**
 * Tell the owners — after the commit, never fatal: the subscription's state is
 * what matters, and a mail that does not go out is logged.
 */
export async function sendCancellationMail(
  tenant: TenantContext,
  plan: CancellationMailPlan,
  facts: CancellationMailFacts,
  options: CancellationMailOptions,
): Promise<void> {
  if (!options.mailer) return;
  const base = options.appUrl?.replace(/\/+$/, '');
  for (const owner of plan.owners) {
    try {
      const outcome = await deliver(options.mailer, {
        to: owner.email,
        licenseId: tenant.licenseId,
        ...subscriptionCancelMail(
          { locale: owner.locale, ...(options.appUrl ? { appUrl: options.appUrl } : {}) },
          {
            ...facts,
            workspaceName: plan.workspaceName,
            billingUrl: base ? `${base}/app/billing` : null,
          },
        ),
        kind: 'notification',
      });
      if (outcome.status !== 'sent') {
        options.log?.warn(
          { license_id: String(tenant.licenseId), mail_kind: facts.kind },
          'subscription cancellation mail not sent',
        );
      }
    } catch (error) {
      options.log?.warn(
        { err: error, license_id: String(tenant.licenseId), mail_kind: facts.kind },
        'subscription cancellation mail failed',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The period end
// ---------------------------------------------------------------------------

export interface PeriodEndReport {
  tenants: number;
  /** Subscriptions whose period ended: now `canceled`, the workspace read-only. */
  ended: number;
  /** Workspaces whose export window passed: now closed. */
  closed: number;
  skipped: number;
}

export interface SubscriptionPeriodEndOptions extends CancellationMailOptions {
  db: PrismaClient;
  auditChainSecret: string;
  /**
   * Where a workspace this closes is announced, so the members' open sockets
   * close with it (tm 426.2). Absent from a caller with no Redis: the sockets
   * then stay open until they close for another reason.
   */
  publisher?: RealtimePublisher | null;
}

type PeriodEndStep =
  | { kind: 'none' }
  | { kind: 'ended'; exportUntil: Date; dataDeletionAt: Date | null; mail: CancellationMailPlan }
  | { kind: 'closed' };

/**
 * The period-end step of the period-close job. Idempotent: a subscription it
 * has ended is no longer listed as due, and every move is conditional on the
 * state it read under the licence lock.
 */
export class SubscriptionPeriodEnd {
  readonly #options: SubscriptionPeriodEndOptions;

  constructor(options: SubscriptionPeriodEndOptions) {
    this.#options = options;
  }

  async run(options: { now?: Date } = {}): Promise<PeriodEndReport> {
    const now = options.now ?? new Date();
    const report: PeriodEndReport = { tenants: 0, ended: 0, closed: 0, skipped: 0 };
    const due = await this.#options.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string }>
    >`SELECT license_id, organization_id::text AS organization_id
        FROM subscription_cancel_due_tenants(${now})`;
    for (const row of due) {
      report.tenants += 1;
      const tenant = { licenseId: row.license_id, organizationId: row.organization_id };
      try {
        const step = await withTenant(this.#options.db, tenant, (tx) =>
          this.#step(tx, tenant, now),
        );
        if (step.kind === 'ended') {
          report.ended += 1;
          await sendCancellationMail(
            tenant,
            step.mail,
            { kind: 'ended', exportUntil: step.exportUntil, dataDeletionAt: step.dataDeletionAt },
            this.#options,
          );
        } else if (step.kind === 'closed') {
          report.closed += 1;
          // Committed: a closed workspace's sockets close too (tm 426.2) — the
          // reconnect is refused like every other request of it.
          await this.#options.publisher?.revoke(tenant, [{ kind: 'license' }]);
        } else {
          report.skipped += 1;
        }
      } catch (error) {
        report.skipped += 1;
        this.#options.log?.warn(
          { err: error, license_id: row.license_id.toString() },
          'subscription period end skipped a workspace',
        );
      }
    }
    return report;
  }

  async #step(tx: TenantClient, tenant: TenantContext, now: Date): Promise<PeriodEndStep> {
    const audit: AuditContext = {
      licenseId: tenant.licenseId,
      chainSecret: this.#options.auditChainSecret,
      actorId: null,
      actorType: 'system',
    };
    const status = await lockLicense(tx, tenant.licenseId);
    if (status === null || status === 'suspended') return { kind: 'none' };
    const [subscription, license] = await Promise.all([
      tx.subscription.findFirst({
        where: { licenseId: tenant.licenseId },
        orderBy: { createdAt: 'desc' },
      }),
      tx.license.findUniqueOrThrow({
        where: { id: tenant.licenseId },
        select: { retentionThreadWindow: true },
      }),
    ]);
    if (!subscription) return { kind: 'none' };

    if (subscription.status !== 'canceled') {
      if (!subscription.cancelAtPeriodEnd || status === 'canceled') return { kind: 'none' };
      const effective = cancellationTakesEffectAt(
        subscription.currentPeriodEnd,
        subscription.canceledAt ?? now,
      );
      if (effective > now) return { kind: 'none' };

      // The export window counts from the moment the workspace actually went
      // read-only, so a pass that ran late does not shorten it.
      const exportUntil = cancellationExportUntil(now);
      const dataDeletionAt = cancellationDeletionAt(now, license.retentionThreadWindow);
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'canceled', endedAt: now, exportUntil, dataDeletionAt },
      });
      await writeAuditEntry(tx, audit, {
        action: 'billing.subscription_ended',
        target: `subscription:${subscription.id}`,
        metadata: {
          reason: subscription.cancelReason,
          export_until: exportUntil.toISOString(),
          data_deletion_at: dataDeletionAt?.toISOString() ?? null,
        },
      });
      if (status !== 'read_only') {
        await tx.license.update({ where: { id: tenant.licenseId }, data: { status: 'read_only' } });
        await writeAuditEntry(tx, audit, {
          action: 'billing.license_status_changed',
          target: `license:${tenant.licenseId.toString()}`,
          metadata: { from: status, to: 'read_only', reason: 'subscription_canceled' },
        });
      }
      return {
        kind: 'ended',
        exportUntil,
        dataDeletionAt,
        mail: await ownerRecipients(tx, tenant),
      };
    }

    if (status === 'read_only' && subscription.exportUntil && subscription.exportUntil <= now) {
      await tx.license.update({ where: { id: tenant.licenseId }, data: { status: 'canceled' } });
      await writeAuditEntry(tx, audit, {
        action: 'billing.license_status_changed',
        target: `license:${tenant.licenseId.toString()}`,
        metadata: { from: 'read_only', to: 'canceled', reason: 'export_window_ended' },
      });
      return { kind: 'closed' };
    }
    return { kind: 'none' };
  }
}
