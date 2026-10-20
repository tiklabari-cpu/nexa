/**
 * Hand-over routes (tm 307.1 · SiyahTuş analysis AI-12, shared with AU-01;
 * ADR-14b §2.12) — the vocabulary the schema (`20261020180000_handoff_routes`),
 * the contract (`HandoffRoute`, `/handoff-routes`) and the target resolver
 * share.
 *
 * A route says which team a conversation goes to for a key: a routing topic
 * (`topic` — the six queue roles, ADR-08a's single list) or the reason the AI
 * handed it over (`reason` — a `HANDOFF_REASONS` code, e.g.
 * `guardrail_self_harm`). It may be one brand's (`brand_id`) or every
 * brand's (null), may require an expertise of whoever takes the conversation,
 * and carries the priority a conversation routed by it starts with.
 *
 * The team is held by id, never by name, so renaming a team keeps every
 * route. A route for a topic refines the team holding that queue role
 * (`groups.topic_role`): one brand's route, then the every-brand route, then
 * the role's team (tm 307.2).
 */
import { HANDOFF_REASONS } from './handoff.js';
import { QUEUE_TOPIC_ROLES, isQueueTopicRole, type QueueTopicRole } from './team-queues.js';

/** What a route matches on (AI-12 §1 steps 2 and 3). */
export const HANDOFF_ROUTE_MATCH_TYPES = ['topic', 'reason'] as const;
export type HandoffRouteMatchType = (typeof HANDOFF_ROUTE_MATCH_TYPES)[number];

/**
 * How many routes a workspace holds — the six topics and the hand-over
 * reasons, once for every brand and once per brand, fit with room to spare.
 * A typo guard, not a plan limit.
 */
export const HANDOFF_ROUTES_MAX = 200;

/** Whether `key` is a key a route of this type can match. */
export function isHandoffRouteKey(matchType: string, key: unknown): boolean {
  if (typeof key !== 'string') return false;
  if (matchType === 'topic') return (QUEUE_TOPIC_ROLES as readonly string[]).includes(key);
  if (matchType === 'reason') return (HANDOFF_REASONS as readonly string[]).includes(key);
  return false;
}

/**
 * The queue roles the guardrails' and the risk flags' topics mean
 * (`GUARDRAIL_HANDOFF_TOPICS`, `RiskFlagDefault.topic` — AI-08's and AI-27's
 * spellings, older than ADR-08a's single list): `kyc_risk` is a role as it is.
 */
export const HANDOFF_TOPIC_ROLE_ALIASES: Readonly<Record<string, QueueTopicRole>> = {
  responsible_gaming: 'responsible_gambling',
  complaints: 'complaint',
};

/**
 * The queue role a hand-over's topic names (tm 307.2): a role as it is, a
 * guardrail's or risk flag's spelling as the role it means, null for any other
 * key (a procedure's `general`) — which no team holds and no route matches.
 */
export function handoffTopicRole(topic: unknown): QueueTopicRole | null {
  if (isQueueTopicRole(topic)) return topic;
  if (typeof topic !== 'string' || !Object.hasOwn(HANDOFF_TOPIC_ROLE_ALIASES, topic)) return null;
  return HANDOFF_TOPIC_ROLE_ALIASES[topic] ?? null;
}

/**
 * The reason a route or a hand-over raised a connection's priority
 * (`threads.priority_reason`), as a `HANDOFF_REASONS` code. Lower snake_case —
 * the column's CHECK holds the shape, not the list, so a new reason needs no
 * migration.
 */
export const THREAD_PRIORITY_REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
