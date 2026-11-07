/**
 * The queue position the visitor is shown (tm 411).
 *
 * Once a person has answered the visitor, "you are number 3 in the queue" is
 * no longer true in the sense they read it — somebody is already talking to
 * them. So from the first agent message to the visitor (`recipients: 'all'`,
 * the rule `first_response_at` counts by) written since the connection
 * entered the queue, the widget gets no position and no wait estimate.
 *
 * "Since it entered the queue", not "ever": a connection an agent answered and
 * then transferred to a team with nobody free is waiting again, and the
 * visitor should hear so. A connection queued before `queued_at` was recorded
 * falls back to any agent reply in it.
 *
 * tm 411 was written for a teammate answering a connection that still waited
 * in a queue — then allowed, and not taking it ("replying is not taking", that
 * window's assumption). Since tm 475 that reply is refused: only the agent
 * the connection is assigned to writes to the visitor
 * (`reply_requires_assignment`), and a teammate first takes it ("Take",
 * `POST /chats/{id}/claim`, from a manual team's queue or an automatic one's),
 * which takes it out of the queue — the widget then reads no position because
 * the connection is assigned. A connection still waiting has, as a rule, had
 * no reply during its stay; the check stays all the same, as the visitor's
 * side of the promise, and still decides a stay recorded before `queued_at`
 * was.
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
