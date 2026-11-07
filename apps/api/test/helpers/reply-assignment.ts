/**
 * Only the agent a conversation's open connection is assigned to writes to the
 * customer (tm 475 · `reply_requires_assignment`). Suites whose subject is
 * something else — masking, SLAs, channel delivery, reports, the AI falling
 * silent — used to reply to conversations nobody had given the replier; before
 * such a reply they now give it to them here.
 *
 * Written straight to the rows, the way "Take" (a claim) leaves them: the open
 * connection assigned to `agentId`, out of its queue (the stay closed as
 * `assigned`), the agent present on the chat. Nothing else moves — no push, no
 * transcript line, no audit entry, no AI mode change — so a suite's own counts
 * of those are not disturbed. The paths that really assign a connection have
 * their own suites (`manual-assignment`, `reply-requires-assignment`, takeover
 * and transfer in `chats`).
 *
 * Takes the owner client (no RLS): it is setup, not a request.
 */
import type { PrismaClient } from '@prisma/client';

export async function assignForReply(
  db: PrismaClient,
  chatId: string,
  agentId: string,
): Promise<{ threadId: string }> {
  const thread = await db.thread.findFirst({
    where: { chatId, active: true },
    select: { id: true, assignedAt: true },
  });
  if (!thread) throw new Error(`assignForReply: chat ${chatId} has no open connection`);
  await db.thread.update({
    where: { id: thread.id },
    data: {
      assigneeId: agentId,
      assignedAt: thread.assignedAt ?? new Date(),
      queuePosition: null,
      queuedAt: null,
      queueGroupId: null,
    },
  });
  await db.queueEntry.updateMany({
    where: { threadId: thread.id, leftAt: null },
    data: { leftAt: new Date(), outcome: 'assigned' },
  });
  await db.chatUser.upsert({
    where: { chatId_userId: { chatId, userId: agentId } },
    create: { chatId, userId: agentId, userType: 'agent', present: true },
    update: { present: true },
  });
  return { threadId: thread.id };
}
