/**
 * Team queues (tm 305 · SiyahTuş analysis AU-01, owner decisions K14 and K18,
 * ADR-08a `docs/adr/routing-team-queues.md`) — the vocabulary the schema
 * (`20261020120000_team_queues`), the contract (`Group`, `GroupWrite`,
 * `ThreadPriority`) and routing share.
 *
 * A queue is a team (ADR-08a §2.1): a connection waits in exactly one team's
 * queue (`threads.queue_group_id`), ordered within it by `threads.priority`
 * (most pressing first), then by when it started waiting.
 */

/**
 * The topic a team's queue is for (K14's six ready-made queues). A workspace
 * may rename the teams and add more; the role is what the AI's hand-over, the
 * pre-chat topic (WG-04) and a hand-over rule's `{ topic }` target resolve, so
 * a renamed team still receives its topic. At most one team per workspace holds
 * a role (`groups_license_id_topic_role_key`); a team with no role is an
 * ordinary team.
 *
 * `responsible_gambling` is the one with rules of its own (ADR-08a §2.6): no
 * fallback team, only trained agents, and the team cannot be deleted. This is
 * the single list — the AI-12 analysis and the guardrail catalogue spell two of
 * them `responsible_gaming` / `complaints`, and tm 307 maps those onto it.
 */
export const QUEUE_TOPIC_ROLES = [
  'finance',
  'kyc_risk',
  'bonus',
  'responsible_gambling',
  'technical',
  'complaint',
] as const;
export type QueueTopicRole = (typeof QUEUE_TOPIC_ROLES)[number];

/**
 * Whether a routing topic is one of the six queue roles. A hand-over's `topic`
 * is any well-formed key (a procedure may name `general`); only these resolve
 * to a team (`resolveQueue`).
 */
export function isQueueTopicRole(value: unknown): value is QueueTopicRole {
  return typeof value === 'string' && (QUEUE_TOPIC_ROLES as readonly string[]).includes(value);
}

/** The role whose queue never overflows to another team (ADR-08a §2.6). */
export const RESPONSIBLE_GAMBLING_ROLE: QueueTopicRole = 'responsible_gambling';

/**
 * The teams a person hands a conversation to only with a note (IN-04-S2):
 * whoever picks up a Responsible Gambling or a complaint conversation must
 * not have to ask the player again why they are there.
 */
export const TRANSFER_NOTE_REQUIRED_ROLES: readonly QueueTopicRole[] = [
  'responsible_gambling',
  'complaint',
];

/** Whether handing a conversation to a team of this topic needs a note (IN-04-S2). */
export function transferNoteRequired(topicRole: string | null | undefined): boolean {
  return (TRANSFER_NOTE_REQUIRED_ROLES as readonly string[]).includes(topicRole ?? '');
}

/**
 * What a team's queue does when nobody is on shift (AU-01 "mesai dışı
 * davranışı"; AI-12-S2 and AI-29-S2 defaults):
 *
 *   - `queue`  — the conversation waits in the team's queue for the next agent
 *                (the default, and what every team did before tm 305);
 *   - `ticket` — the conversation becomes a ticket the player can be answered
 *                on by email (HD-01 / WG-08).
 *
 * Stored on the team (`groups.after_hours_mode`); acted on by the hand-over and
 * the widget, not by routing.
 */
export const AFTER_HOURS_MODES = ['queue', 'ticket'] as const;
export type AfterHoursMode = (typeof AFTER_HOURS_MODES)[number];

export const DEFAULT_AFTER_HOURS_MODE: AfterHoursMode = 'queue';

/**
 * How pressing a connection is (ADR-08a §2.3, AI-12): `urgent` for self-harm,
 * a suspected minor and a self-exclusion request; `high` for a repeat contact
 * the same day or an angry player; `normal` otherwise. Most pressing first —
 * the guardrail catalogue's `GUARDRAIL_PRIORITIES` is this list.
 *
 * Stored as its rank (`THREAD_PRIORITY_RANK`) in `threads.priority SMALLINT`,
 * so `ORDER BY priority DESC` means "most pressing first". Stored as text it
 * would sort by spelling, and `'urgent' > 'normal' > 'high'` is the wrong order
 * (ADR-08a §2.3).
 */
export const THREAD_PRIORITIES = ['urgent', 'high', 'normal'] as const;
export type ThreadPriority = (typeof THREAD_PRIORITIES)[number];

/** `threads.priority` — the stored rank; higher is more pressing. */
export const THREAD_PRIORITY_RANK: Readonly<Record<ThreadPriority, number>> = {
  normal: 0,
  high: 1,
  urgent: 2,
};

/** The column default: a connection nobody has raised. */
export const DEFAULT_THREAD_PRIORITY: ThreadPriority = 'normal';

/**
 * The priority a stored rank stands for. The CHECK `threads_priority_check`
 * admits only the three ranks; anything else reads as `normal` rather than
 * throwing on a row.
 */
export function threadPriorityFromRank(rank: number): ThreadPriority {
  if (rank === THREAD_PRIORITY_RANK.urgent) return 'urgent';
  if (rank === THREAD_PRIORITY_RANK.high) return 'high';
  return 'normal';
}

/**
 * How many areas of expertise a team may require of its members. The
 * requirement is "every one of these", so a long list staffs nobody; the
 * ceiling is a typo guard, as on a routing rule.
 */
export const MAX_GROUP_REQUIRED_EXPERTISE = 20;
