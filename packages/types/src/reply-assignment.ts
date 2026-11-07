/**
 * Who may answer the customer (tm 475 · owner decision 2026-11-06, analysis
 * 04 K45).
 *
 * A message the customer sees (`recipients: 'all'`) from a signed-in teammate
 * is written only when the conversation's open connection is assigned to them.
 * Two teammates answering one customer at once is the confusion the rule
 * exists to prevent, so everyone else takes the conversation first — "Take"
 * from a team's queue or from the AI (`POST /chats/{chatId}/claim`), "Take
 * over" from a colleague (`POST /chats/{chatId}/takeover`) — or is assigned it
 * by someone allowed to. An internal note (`recipients: 'agents'`) is free: the
 * customer never sees it. Bots and the customer themselves are not subject to
 * it; an operator signed in as a member is.
 *
 * Refused with `409 reply_requires_assignment` and {@link ReplyRequiresAssignmentDetails}.
 * `details.reason` tells a client what to offer instead:
 *
 *   - `assigned_to_other` — a colleague has it: take it over, or ask for it;
 *   - `ai` — nobody has it, and the AI is answering it or is held back
 *     (`ai_mode` `ai` or `paused`): take it from the AI;
 *   - `unassigned` — nobody has it: it waits in a queue, or was never routed.
 *
 * The server decides under the connection's row lock (`chat-service.ts`
 * `sendEvent`); {@link replyAssignmentRefusal} is the rule itself, so a screen
 * that wants to say in advance whether its composer can reply asks the same
 * question the server will.
 */
export const REPLY_ASSIGNMENT_REASONS = ['unassigned', 'assigned_to_other', 'ai'] as const;
export type ReplyAssignmentReason = (typeof REPLY_ASSIGNMENT_REASONS)[number];

/** `reply_requires_assignment`'s `details`. */
export interface ReplyRequiresAssignmentDetails {
  reason: ReplyAssignmentReason;
}

/**
 * Why `accountId` may not write to the customer on this connection, or null
 * when they may — the connection is assigned to them. The assignee is asked
 * first: a colleague holding a connection the AI also answers is still the
 * colleague's.
 */
export function replyAssignmentRefusal(
  /** `aiMode` as the connection stores it — an `AiConversationMode`, or null. */
  connection: { assigneeId: string | null; aiMode: string | null },
  accountId: string,
): ReplyAssignmentReason | null {
  if (connection.assigneeId !== null && connection.assigneeId === accountId) return null;
  if (connection.assigneeId !== null) return 'assigned_to_other';
  return connection.aiMode === 'ai' || connection.aiMode === 'paused' ? 'ai' : 'unassigned';
}
