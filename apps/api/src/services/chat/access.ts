/**
 * Who may see which conversation.
 *
 * Two independent gates, both required:
 *
 *   scope  — what the *token* is allowed to do (`chats--all` vs `chats--access`)
 *   access — what the *person* is allowed to see (their team memberships)
 *
 * Keeping them separate matters: a broad personal access token must not let an
 * agent read conversations their teams were never given, and a well-scoped
 * token must not let someone act beyond their role.
 *
 * A chat the caller may not see is reported as absent rather than forbidden
 * (NFR-S5) — a 403 confirms the id is real and turns short ids into an
 * enumeration oracle.
 */
import { hasAnyScope } from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';

export type AccessMode = 'read' | 'write';

const SCOPES = {
  read: { all: 'chats--all:ro', scoped: 'chats--access:ro' },
  write: { all: 'chats--all:rw', scoped: 'chats--access:rw' },
} as const;

export interface ChatVisibility {
  /** True when the token may reach every chat in the license. */
  unrestricted: boolean;
  /** Teams the caller belongs to; empty for an unrestricted caller. */
  groupIds: bigint[];
  actorId: string;
  /**
   * Customers are not scoped by team at all — they see exactly the
   * conversations they are a party to, and nothing else. Keeping this as its
   * own mode rather than a degenerate agent case means an agent-shaped rule can
   * never accidentally widen what a widget can read.
   */
  isCustomer: boolean;
}

export function hasChatScope(principal: Principal, mode: AccessMode): boolean {
  if (principal.kind === 'customer') return false;
  const scopes = SCOPES[mode];
  return hasAnyScope(principal.scopes, [scopes.all, scopes.scoped]);
}

export function hasUnrestrictedChatScope(principal: Principal, mode: AccessMode): boolean {
  if (principal.kind === 'customer') return false;
  return hasAnyScope(principal.scopes, [SCOPES[mode].all]);
}

/**
 * Resolve what this caller can see, once per request.
 *
 * The team list is read from the database rather than trusted from the token:
 * removing someone from a team must take effect immediately, not when their
 * token next rotates.
 */
export async function resolveVisibility(
  tx: TenantClient,
  principal: Principal,
  mode: AccessMode,
): Promise<ChatVisibility> {
  if (principal.kind === 'customer') {
    return {
      unrestricted: false,
      groupIds: [],
      actorId: principal.customerId,
      isCustomer: true,
    };
  }

  const actorId = principal.kind === 'agent' ? principal.accountId : principal.botId;

  if (hasUnrestrictedChatScope(principal, mode)) {
    return { unrestricted: true, groupIds: [], actorId, isCustomer: false };
  }

  const memberships = await tx.groupAgent.findMany({
    where: { agentId: actorId },
    select: { groupId: true },
  });

  return {
    unrestricted: false,
    groupIds: memberships.map((m) => m.groupId),
    actorId,
    isCustomer: false,
  };
}

/**
 * Prisma `where` fragment restricting a chat query to what the caller may see.
 *
 * Expressed as a filter rather than a post-fetch check so pagination stays
 * correct — filtering after the fact would return short pages and, worse, would
 * make `next_page_id` skip over hidden rows unpredictably.
 */
export function chatVisibilityFilter(visibility: ChatVisibility): Record<string, unknown> {
  if (visibility.unrestricted) return {};

  // A customer sees their own conversations and nothing else. Matched on the
  // chat's `customer_id` rather than on chat membership, so a stale
  // `chat_users` row can never widen it.
  if (visibility.isCustomer) return { customerId: visibility.actorId };

  return {
    OR: [
      // Reachable through one of the caller's teams.
      ...(visibility.groupIds.length > 0
        ? [{ access: { some: { groupId: { in: visibility.groupIds } } } }]
        : []),
      // Or because they are personally in the conversation — an agent who was
      // transferred a chat keeps access even if the team assignment moved on.
      { users: { some: { userId: visibility.actorId, userType: 'agent' } } },
    ],
  };
}

/** Whether a single already-loaded chat is visible to the caller. */
export function canSeeChat(
  visibility: ChatVisibility,
  chat: {
    customerId: string;
    access: Array<{ groupId: bigint }>;
    users: Array<{ userId: string; userType: string }>;
  },
): boolean {
  if (visibility.isCustomer) return chat.customerId === visibility.actorId;
  if (visibility.unrestricted) return true;
  if (chat.access.some((a) => visibility.groupIds.includes(a.groupId))) return true;
  return chat.users.some((u) => u.userId === visibility.actorId && u.userType === 'agent');
}
