/**
 * The Queued view's team tabs (AU-01 · ADR-08a §2.1).
 *
 * A conversation waits in one team's queue (`ChatSummary.queue_group_id`), so
 * the Queued view splits by team: one tab per team the agent can see, each
 * listing — and counting — only that team's queue, filtered by the server
 * (`GET /chats?queue_group_id=`) rather than sliced out of the loaded page.
 *
 * Pure, so the order is tested without the rendered list.
 */
import { QUEUE_TOPIC_ROLES, type QueueTopicRole } from '@siyahtus/types';

/** A team as the tabs read it — a narrowing of `GET /groups`' row. */
export interface QueueTeam {
  id: number;
  name: string;
  topic_role: QueueTopicRole | null;
}

/**
 * The tabs' order: the topic queues first, in `QUEUE_TOPIC_ROLES` order —
 * the same order wherever the six appear, whatever the teams are called —
 * then every other team in the order the server listed them.
 */
export function orderQueueTeams<T extends QueueTeam>(teams: readonly T[]): T[] {
  const rank = (team: QueueTeam): number =>
    team.topic_role === null
      ? QUEUE_TOPIC_ROLES.length
      : QUEUE_TOPIC_ROLES.indexOf(team.topic_role);
  return teams
    .map((team, index) => ({ team, index }))
    .sort((a, b) => rank(a.team) - rank(b.team) || a.index - b.index)
    .map(({ team }) => team);
}
