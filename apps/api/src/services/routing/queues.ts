/**
 * Topic queues, resolved (tm 305.3 · SiyahTuş analysis AU-01, owner decision
 * K14, ADR-08a `docs/adr/routing-team-queues.md`).
 *
 * A topic — `finance`, `responsible_gambling`, … (`QUEUE_TOPIC_ROLES`) — is
 * served by the one team of the workspace that holds it as its role
 * (`groups.topic_role`, unique per licence). Everything that sends a
 * conversation "to finance" resolves the role here rather than looking a team
 * up by its name: the AI's hand-over to a `{ topic }` target, a hand-over
 * rule's target, the pre-chat topic (WG-04) and AI-12's target resolver
 * (tm 307). A workspace renames its teams freely (K14); the role is what
 * stays put, so a renamed team still receives its topic.
 *
 * Read-only, inside the caller's transaction: RLS scopes the read to its
 * licence, and the `license_id` in the predicate is the partial unique index's
 * own key (`groups_license_id_topic_role_key`).
 */
import { QUEUE_TOPIC_ROLES, type AfterHoursMode, type QueueTopicRole } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/** The team serving a topic, as a hand-over needs it. */
export interface TopicQueue {
  readonly topicRole: QueueTopicRole;
  readonly groupId: bigint;
  readonly name: string;
  /** What the team's queue does when nobody is on shift (acted on by AI-12 / WG-08). */
  readonly afterHoursMode: AfterHoursMode;
}

/**
 * The team that serves `topicRole`, or null while no team of the workspace
 * holds it — the caller then routes as it would with no target (ADR-08a §2.4:
 * "çözücü ekip bulamazsa yönlendirme bugünkü gibi").
 */
export async function resolveQueue(
  tx: TenantClient,
  licenseId: bigint,
  topicRole: QueueTopicRole,
): Promise<TopicQueue | null> {
  const team = await tx.group.findFirst({
    where: { licenseId, topicRole },
    select: { id: true, name: true, afterHoursMode: true },
  });
  if (!team) return null;
  return {
    topicRole,
    groupId: team.id,
    name: team.name,
    afterHoursMode: team.afterHoursMode as AfterHoursMode,
  };
}

/**
 * Every topic role in `QUEUE_TOPIC_ROLES` order, each with the team serving it
 * or null — `GET /routing/queues`. One read, however many roles are held.
 */
export async function listQueues(
  tx: TenantClient,
  licenseId: bigint,
): Promise<Array<{ topicRole: QueueTopicRole; queue: TopicQueue | null }>> {
  const teams = await tx.group.findMany({
    where: { licenseId, topicRole: { in: [...QUEUE_TOPIC_ROLES] } },
    select: { id: true, name: true, topicRole: true, afterHoursMode: true },
  });
  const byRole = new Map(teams.map((team) => [team.topicRole, team]));
  return QUEUE_TOPIC_ROLES.map((topicRole) => {
    const team = byRole.get(topicRole);
    return {
      topicRole,
      queue: team
        ? {
            topicRole,
            groupId: team.id,
            name: team.name,
            afterHoursMode: team.afterHoursMode as AfterHoursMode,
          }
        : null,
    };
  });
}
