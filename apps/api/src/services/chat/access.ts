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
 *
 * The person's half has a third input since the permission matrix (RL-02 ·
 * tm 325.3): their role's `chats.view` level. `team` and `all` are carried by
 * the scopes above; `own` holds the `team` level's scopes and is narrowed
 * here, to the chats the person is assigned to or has joined — whatever the
 * credential says, so a token minted for a wider level does not undo it. `none`
 * refuses the person outright.
 */
import { hasAnyScope, narrowsChatReach } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient } from '../../lib/tenant.js';
import { hasCapability } from '../auth/capability.js';
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

/**
 * Whether the person behind an agent credential is kept to their own chats by
 * the matrix (`own`, `none`). A bot has no role and no person — its scopes are
 * its whole answer.
 */
function personNarrowed(principal: Principal): boolean {
  return principal.kind === 'agent' && narrowsChatReach(principal.capabilities['chats.view']);
}

export function hasChatScope(principal: Principal, mode: AccessMode): boolean {
  if (principal.kind === 'customer') return false;
  // `none`: the person sees no chats, whatever a token minted earlier carries.
  if (principal.kind === 'agent' && !hasCapability(principal, 'chats.view')) return false;
  const scopes = SCOPES[mode];
  return hasAnyScope(principal.scopes, [scopes.all, scopes.scoped]);
}

export function hasUnrestrictedChatScope(principal: Principal, mode: AccessMode): boolean {
  if (principal.kind === 'customer') return false;
  if (personNarrowed(principal)) return false;
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

  // A SCIM provisioning token (NFR-S11) reaches `/scim/v2` and nothing else, so
  // it should never arrive here — refused rather than defaulted into one of the
  // branches below, because an absent case that quietly picks a branch is how a
  // directory credential ends up reading conversations.
  if (principal.kind === 'scim') {
    throw ApiError.authorization('Provisioning credentials cannot access conversations.');
  }
  // A two-factor enrollment ticket (S11-2FA-k) reaches two endpoints and this is
  // not one of them; it is refused here for the same reason, one step earlier.
  // Its holder has proved a password and nothing more — a conversation is the
  // last thing that should be visible from that position.
  if (principal.kind === 'enrollment') {
    throw ApiError.authorization('Enrollment credentials cannot access conversations.');
  }

  const actorId = principal.kind === 'agent' ? principal.accountId : principal.botId;

  // `none`: the person sees no conversation at all. A session at that level
  // holds no chat scope and never gets here; a token minted for a higher level
  // does, and is refused as that session would be at the route gate.
  if (principal.kind === 'agent' && !hasCapability(principal, 'chats.view')) {
    throw ApiError.authorization('Your role has no access to conversations in this workspace.');
  }

  if (hasUnrestrictedChatScope(principal, mode)) {
    return { unrestricted: true, groupIds: [], actorId, isCustomer: false };
  }

  // `own`: no team reaches a chat for this person — only being in it does.
  if (personNarrowed(principal)) {
    return { unrestricted: false, groupIds: [], actorId, isCustomer: false };
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
