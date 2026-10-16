/**
 * The queue record writer (tm 291 · RP-04, K21).
 *
 * `threads.queued_at` is cleared when a connection leaves the queue — the
 * position numbering depends on it — so a finished wait is kept here instead:
 * one `queue_entries` row per stay, opened where a connection enters the queue
 * and closed where it leaves, each time inside the caller's transaction. That
 * is what keeps the two from disagreeing: a queued connection that rolled back
 * leaves no row, and an assignment or a close that committed always closed the
 * stay it ended.
 *
 * Where each happens:
 *
 *   - enter — a connection created waiting (`ChatService` — the first of the
 *     day and every further one); a transfer to another team that leaves it
 *     waiting there.
 *   - leave — the drain (`assigned`), a takeover (`assigned`), a transfer
 *     (`transferred`), the close (`abandoned` / `closed_by_agent` / `timeout`,
 *     by who closed it).
 *
 * The chat-timeout sweep runs {@link closeOrphanedQueueEntries} as a safety net
 * under all of these: a stay still open on a closed connection is a path that
 * forgot to close it, and is closed as `timeout` at the moment the connection
 * did.
 */
import type { QueueEntryOutcome } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/**
 * Open a stay for a connection that has just started waiting.
 *
 * `enteredAt` is the same instant written to `threads.queued_at`, so the
 * record and the live queue agree about when the wait began.
 */
export async function enterQueue(
  tx: TenantClient,
  input: { licenseId: bigint; threadId: string; groupId: bigint | null; enteredAt: Date },
): Promise<void> {
  await tx.queueEntry.create({
    data: {
      licenseId: input.licenseId,
      threadId: input.threadId,
      groupId: input.groupId,
      enteredAt: input.enteredAt,
    },
    select: { id: true },
  });
}

/**
 * Close the connection's open stay, if it has one. Returns whether it had.
 *
 * Conditional on `left_at IS NULL`, so a stay is closed once: a second leave
 * in the same transaction (or a connection that never waited) is a no-op.
 */
export async function leaveQueue(
  tx: TenantClient,
  threadId: string,
  outcome: QueueEntryOutcome,
  leftAt: Date = new Date(),
): Promise<boolean> {
  const closed = await tx.queueEntry.updateMany({
    where: { threadId, leftAt: null },
    data: { leftAt, outcome },
  });
  return closed.count > 0;
}

/**
 * The sweep's safety net: close every stay of this tenant still open on a
 * connection that has closed, as `timeout`, at the moment the connection
 * closed (never before the stay began). Returns how many it closed — zero
 * unless some path took a connection out of service without closing its stay.
 */
export async function closeOrphanedQueueEntries(tx: TenantClient): Promise<number> {
  return tx.$executeRaw`
    UPDATE queue_entries q
       SET left_at = GREATEST(q.entered_at, COALESCE(t.closed_at, now())),
           outcome = 'timeout'
      FROM threads t
     WHERE q.thread_id = t.id
       AND q.left_at IS NULL
       AND NOT t.active`;
}
