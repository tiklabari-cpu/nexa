/**
 * Who may answer the customer from this console (tm 475 · tm 475.4) — the pure
 * half of the strip above the composer (`ReplyClaimBar.tsx`).
 *
 * The rule is the server's (`replyAssignmentRefusal` in `@siyahtus/types`,
 * enforced by `ChatService.sendEvent` under the connection's row lock): a
 * message the customer sees is written only by the agent the open connection
 * is assigned to. Everyone else either takes the chat (`POST /chats/{id}/claim`),
 * takes it over from a colleague (`POST /chats/{id}/takeover`), or writes an
 * internal note, which is always allowed.
 *
 * What the strip offers is the server's claim rule (`ChatService.claim`), asked
 * of what the chat read carries:
 *
 *   - waiting in a team's queue → "Take" for a member of that team (the chat
 *     read names its teams, `access.group_ids`, not the queue's alone; the
 *     server checks the membership, skills and the concurrent limit itself);
 *   - nobody's and the AI answers it or is held back (`ai_mode` `ai`/`paused`)
 *     → "Take" for anyone who can see it;
 *   - nobody's otherwise (never routed) → no button: routing or someone allowed
 *     to assign it will;
 *   - a colleague's → "Take over" only when `canTakeOver` says the caller may.
 */
import { replyAssignmentRefusal } from '@siyahtus/types';
import type { ChatDetail } from './types.js';

export type ReplyClaim =
  /** The connection is the caller's: the composer answers as usual. */
  | { kind: 'mine' }
  /** Nobody's, and the caller may take it. */
  | { kind: 'claim' }
  /** Nobody's, and the caller may not take it — it is assigned for them. */
  | { kind: 'waiting' }
  /** A colleague's. */
  | { kind: 'other'; assigneeId: string; canTakeOver: boolean };

export function replyClaim(
  chat: Pick<ChatDetail, 'thread' | 'access'>,
  accountId: string | null,
  options: {
    /** `claimableTeamIds`: the teams the caller is a member of. */
    memberOf: ReadonlySet<number>;
    /** `canTakeOver` for this chat's teams. */
    canTakeOver: boolean;
  },
): ReplyClaim {
  const thread = chat.thread;
  // No connection, or no signed-in agent: nothing to gate, nothing to offer.
  if (thread === null || accountId === null) return { kind: 'mine' };
  const refusal = replyAssignmentRefusal(
    { assigneeId: thread.assignee_id, aiMode: thread.ai_mode ?? null },
    accountId,
  );
  if (refusal === null) return { kind: 'mine' };
  if (refusal === 'assigned_to_other') {
    return { kind: 'other', assigneeId: thread.assignee_id!, canTakeOver: options.canTakeOver };
  }
  // A queued connection is taken under the queue's rules even when the AI is
  // answering beside it (`ChatService.claim`), so the queue is asked first.
  if (thread.queue_position !== null) {
    return chat.access.group_ids.some((id) => options.memberOf.has(id))
      ? { kind: 'claim' }
      : { kind: 'waiting' };
  }
  return refusal === 'ai' ? { kind: 'claim' } : { kind: 'waiting' };
}
