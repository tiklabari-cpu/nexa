/**
 * Cancelling a subscription at the end of its period, and taking that back
 * (tm 389.10 — the platform's "cancel subscription" / "resume").
 *
 * Only the flag: `subscriptions.cancel_at_period_end` with the moment it was
 * set (`canceled_at`). The workspace keeps everything it paid for until the
 * period ends; the step that then closes the subscription, the owner's own
 * cancellation and its reason belong to #384 (SUBSCRIPTION-CANCEL), which is
 * meant to call this same function with its own actor — the actor and the
 * audit entry are the caller's, so this file knows neither.
 *
 * Addressed by licence, not left to row level security, so the platform role
 * (which has none) and the tenant role read the same row.
 */
import type { Prisma } from '@prisma/client';

export interface CancelAtPeriodEndChange {
  subscriptionId: string;
  changed: boolean;
  currentPeriodEnd: Date | null;
}

/**
 * Set or clear the flag on the workspace's latest subscription. Null when the
 * workspace has none — a trial has nothing to cancel. `changed: false` when
 * the flag already said so, so the caller can skip its audit entry.
 */
export async function setCancelAtPeriodEnd(
  tx: Prisma.TransactionClient,
  licenseId: bigint,
  cancel: boolean,
  now: Date,
): Promise<CancelAtPeriodEndChange | null> {
  const subscription = await tx.subscription.findFirst({
    where: { licenseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, cancelAtPeriodEnd: true, currentPeriodEnd: true },
  });
  if (!subscription) return null;
  const result = {
    subscriptionId: subscription.id,
    currentPeriodEnd: subscription.currentPeriodEnd,
  };
  if (subscription.cancelAtPeriodEnd === cancel) return { ...result, changed: false };

  await tx.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: cancel, canceledAt: cancel ? now : null },
  });
  return { ...result, changed: true };
}
