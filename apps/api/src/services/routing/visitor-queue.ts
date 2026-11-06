/**
 * The queue position the visitor is shown (tm 411).
 *
 * A teammate can write to a connection that still waits in a team's queue,
 * and writing does not take it — only where the AI took part does an agent's
 * message make the connection theirs (AI-11-S2, `#routeHandover`). The
 * connection stays queued and unassigned, so the panel goes on showing it in
 * the Queued view; that is the routing record and stays as it is.
 *
 * The visitor is told something else. Once a person has answered them, "you
 * are number 3 in the queue" is no longer true in the sense they read it —
 * somebody is already talking to them. So from the first agent message to
 * the visitor (`recipients: 'all'`, the rule `first_response_at` counts by)
 * written since the connection entered the queue, the widget gets no position
 * and no wait estimate.
 *
 * "Since it entered the queue", not "ever": a connection an agent answered and
 * then transferred to a team with nobody free is waiting again, and the
 * visitor should hear so. A connection queued before `queued_at` was recorded
 * falls back to any agent reply in it.
 *
 * Assumption (PRD §6/§8 say nothing about replying to a queued chat): replying
 * is not taking. Recorded in HANDOFF (tm 411).
 */
import type { TenantClient } from '../../lib/tenant.js';

/** The thread fields the rule reads — the poll has the whole row already. */
export interface QueuedThread {
  id: string;
  queuePosition: number | null;
  queuedAt: Date | null;
  assigneeId: string | null;
}

/**
 * `thread.queuePosition`, or null when a person has answered the visitor
 * since the connection was queued. One indexed read (`events (thread_id,
 * created_at)`), and only while the connection is queued.
 */
export async function visitorQueuePosition(
  tx: TenantClient,
  thread: QueuedThread | null | undefined,
): Promise<number | null> {
  if (!thread || thread.queuePosition === null || thread.assigneeId !== null) return null;
  const answered = await tx.event.findFirst({
    where: {
      threadId: thread.id,
      authorType: 'agent',
      recipients: 'all',
      ...(thread.queuedAt ? { createdAt: { gte: thread.queuedAt } } : {}),
    },
    select: { id: true },
  });
  return answered ? null : thread.queuePosition;
}
