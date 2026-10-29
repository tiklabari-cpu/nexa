/**
 * Who sees a player's rating of a connection, and its comment (AR-03 · WG-11 ·
 * tm 337): the permission matrix's `ratings.view`, inside the chat's own
 * visibility. AR-03-S1's default: an Ekip Üyesi reads the ratings of their own
 * connections, an Ekip Lideri and up every one they can see.
 *
 *   - `own` — a connection the person was assigned (`threads.assignee_id`) or
 *     wrote to the player on (`threads.agent_ids`, written at the close);
 *   - `team` — that, or one routed to a team of theirs: the connection's own
 *     team, or for one opened before that was recorded, its day's;
 *   - `all` — every connection the caller may see at all.
 *
 * Outside the reach a rating reads as none, everywhere it is shown — the
 * archive's row and detail, its rating filter, the chat's `thread.rating`, the
 * Reviews report's comments — so what a screen shows and what a filter finds
 * cannot disagree. A bot has no role: its scopes are its whole answer.
 */
import { Prisma } from '@prisma/client';
import type { CapabilityValue } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';

export interface RatingReach {
  level: 'none' | 'own' | 'team' | 'all';
  /** The caller's account (for `own` and `team`). */
  actorId: string | null;
  /** The caller's teams, read now (for `team`). */
  groupIds: bigint[];
}

const LEVELS = new Set<CapabilityValue>(['none', 'own', 'team', 'all']);

export async function resolveRatingReach(
  tx: TenantClient,
  principal: Principal,
): Promise<RatingReach> {
  if (principal.kind === 'bot') return { level: 'all', actorId: principal.botId, groupIds: [] };
  if (principal.kind !== 'agent') return { level: 'none', actorId: null, groupIds: [] };
  const value = principal.capabilities['ratings.view'];
  const level = value !== undefined && LEVELS.has(value) ? (value as RatingReach['level']) : 'none';
  if (level !== 'team') return { level, actorId: principal.accountId, groupIds: [] };
  // Read now, as the chat visibility reads them: leaving a team narrows at once.
  const memberships = await tx.groupAgent.findMany({
    where: { agentId: principal.accountId },
    select: { groupId: true },
  });
  return {
    level,
    actorId: principal.accountId,
    groupIds: memberships.map((m) => m.groupId),
  };
}

/**
 * The reach as a condition over a `threads` row aliased `alias` (its
 * `assignee_id`, `agent_ids`, `group_id` and `chat_id`).
 */
export function ratingReachSql(reach: RatingReach, alias: string): Prisma.Sql {
  if (reach.level === 'all') return Prisma.sql`TRUE`;
  if (reach.level === 'none' || reach.actorId === null) return Prisma.sql`FALSE`;
  const t = Prisma.raw(alias);
  const me = reach.actorId;
  // COALESCE: an unassigned connection makes the comparison NULL, and the
  // rating filter's `NOT (reach AND …)` would then drop the row altogether.
  const own = Prisma.sql`(COALESCE(${t}.assignee_id = ${me}::uuid, FALSE)
    OR COALESCE(${t}.agent_ids @> ARRAY[${me}::uuid], FALSE))`;
  if (reach.level === 'own') return own;
  const groups = reach.groupIds.map(String);
  return Prisma.sql`(${own}
    OR COALESCE(${t}.group_id = ANY(${groups}::bigint[]), FALSE)
    OR (${t}.group_id IS NULL AND EXISTS (
      SELECT 1 FROM chat_access ca
       WHERE ca.chat_id = ${t}.chat_id AND ca.group_id = ANY(${groups}::bigint[])
      OFFSET 0
    )))`;
}

/** The same reach over a connection already loaded. */
export function reachesRating(
  reach: RatingReach,
  thread: {
    assigneeId: string | null;
    agentIds?: readonly string[] | undefined;
    groupId: bigint | null;
  },
  chatGroupIds: readonly bigint[],
): boolean {
  if (reach.level === 'all') return true;
  if (reach.level === 'none' || reach.actorId === null) return false;
  const me = reach.actorId.toLowerCase();
  const own =
    thread.assigneeId?.toLowerCase() === me ||
    (thread.agentIds ?? []).some((id) => id.toLowerCase() === me);
  if (own || reach.level === 'own') return own;
  const teams = new Set(reach.groupIds.map(String));
  if (thread.groupId !== null) return teams.has(String(thread.groupId));
  return chatGroupIds.some((id) => teams.has(String(id)));
}
