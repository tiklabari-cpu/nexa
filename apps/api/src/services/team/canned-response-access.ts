/**
 * Which saved replies a caller may see (FR-MOD-08.7.2).
 *
 * `canned_responses.group_id` / `.visibility` shipped with the domain model and
 * nothing read them, so "team scope" was a pair of columns rather than a rule.
 * This is the rule.
 *
 * Two gates, the same two `services/chat/access.ts` keeps apart:
 *
 *   scope  — what the *token* may do (`canned_responses--all` vs `--groups`)
 *   access — what the *person* may see (their team memberships)
 *
 * The `--all` holder curates the library, so they see all of it: an admin who
 * could not see a reply could not fix or delete it either, and a settings screen
 * that hides rows it is responsible for is worse than one that shows them. The
 * `--groups` holder — an ordinary agent's session — sees the workspace-wide
 * replies plus the ones scoped to a team they are actually in.
 *
 * Membership is read from the database on every request rather than trusted
 * from the token, for the reason `resolveVisibility` gives: taking someone off
 * a team has to stop their access now, not when their token next rotates.
 */
import { hasAnyScope } from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';

/** The two legal values of `canned_responses.visibility`, as the CHECK spells them. */
export const CANNED_VISIBILITIES = ['all', 'group'] as const;
export type CannedVisibility = (typeof CANNED_VISIBILITIES)[number];

export interface CannedResponseVisibility {
  /** True when the token may reach every saved reply in the licence. */
  unrestricted: boolean;
  /** Teams the caller belongs to; empty for an unrestricted caller. */
  groupIds: bigint[];
}

/** Whether the caller curates the whole library rather than consuming a slice of it. */
export function hasUnrestrictedCannedScope(principal: Principal): boolean {
  if (principal.kind === 'customer') return false;
  return hasAnyScope(principal.scopes, ['canned_responses--all:ro']);
}

/**
 * Resolve what this caller can see, once per request.
 *
 * A principal with no account behind it (SCIM, a customer token) has no team
 * membership to read, so it falls through to the workspace-wide replies alone.
 * Neither can reach the endpoint — the scope gate refuses them first — but the
 * function answers safely rather than assuming it will never be called.
 */
export async function resolveCannedVisibility(
  tx: TenantClient,
  principal: Principal,
): Promise<CannedResponseVisibility> {
  if (hasUnrestrictedCannedScope(principal)) {
    return { unrestricted: true, groupIds: [] };
  }

  const actorId =
    principal.kind === 'agent'
      ? principal.accountId
      : principal.kind === 'bot'
        ? principal.botId
        : null;
  if (actorId === null) return { unrestricted: false, groupIds: [] };

  const memberships = await tx.groupAgent.findMany({
    where: { agentId: actorId },
    select: { groupId: true },
  });

  return { unrestricted: false, groupIds: memberships.map((m) => m.groupId) };
}

/**
 * Prisma `where` fragment restricting a saved-reply query to what the caller
 * may use.
 *
 * A filter rather than a post-fetch `filter()` for two reasons, and only the
 * first is about correctness of the list: dropping rows after the query returns
 * short pages, and `?scope=chat` would then mean different counts to different
 * people for reasons no client could explain. The second is the point of the
 * feature — a reply hidden in the browser has still been sent to the browser,
 * so the scope would protect the picker and not the text.
 */
export function cannedVisibilityFilter(
  visibility: CannedResponseVisibility,
): Record<string, unknown> {
  if (visibility.unrestricted) return {};

  return {
    OR: [
      // Everyone's replies. Matched on `visibility` rather than on
      // `group_id IS NULL` so the column that states the intent is the one the
      // query trusts; the CHECK keeps the two from disagreeing.
      { visibility: 'all' },
      ...(visibility.groupIds.length > 0
        ? [{ visibility: 'group', groupId: { in: visibility.groupIds } }]
        : []),
    ],
  };
}
