/**
 * The hand-over routes screen's pure half (tm 307.3 · AI-12, shared with
 * AU-01): `GET|POST /handoff-routes`, `PATCH|DELETE /handoff-routes/{id}`.
 *
 * A route says which team a conversation goes to for a key — a routing topic
 * (the six queue roles) or the reason the AI handed it over — optionally for
 * one brand, optionally only to agents with an expertise, and with the
 * priority a conversation routed by it starts with. What a route matches
 * (type, key, brand) is fixed once made: the form of an existing route edits
 * the other three fields, as the contract's `HandoffRouteUpdate` does.
 */
import {
  HANDOFF_REASONS,
  HANDOFF_ROUTE_MATCH_TYPES,
  QUEUE_TOPIC_ROLES,
  type HandoffRouteMatchType,
  type ThreadPriority,
} from '@siyahtus/types';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';

/** `HandoffRoute` of the contract. */
export interface HandoffRoute {
  id: string;
  brand_id: string | null;
  match_type: HandoffRouteMatchType;
  match_key: string;
  group_id: number;
  required_expertise_id: number | null;
  default_priority: ThreadPriority;
  active: boolean;
}

export const handoffRoutesKey = ['playbook', 'handoff-routes'] as const;

/** The keys a route of `matchType` can match, in the order the picker offers them. */
export function routeKeys(matchType: HandoffRouteMatchType): readonly string[] {
  return matchType === 'topic' ? QUEUE_TOPIC_ROLES : HANDOFF_REASONS;
}

export const ROUTE_MATCH_TYPES = HANDOFF_ROUTE_MATCH_TYPES;

/** The catalogue key naming a route's key: a queue role's or a hand-over reason's. */
export function routeKeyLabelKey(matchType: HandoffRouteMatchType, key: string): string {
  return matchType === 'topic' ? `team.queue.role.${key}` : `playbook.handoff.reason.${key}`;
}

/** The form's spelling: `''` is "no brand" / "no team yet" / "no expertise". */
export interface RouteDraft {
  matchType: HandoffRouteMatchType;
  matchKey: string;
  brandId: string;
  groupId: string;
  expertiseId: string;
  priority: ThreadPriority;
  active: boolean;
}

export const BLANK_ROUTE_DRAFT: RouteDraft = {
  matchType: 'topic',
  matchKey: QUEUE_TOPIC_ROLES[0],
  brandId: '',
  groupId: '',
  expertiseId: '',
  priority: 'normal',
  active: true,
};

export function draftOfRoute(route: HandoffRoute): RouteDraft {
  return {
    matchType: route.match_type,
    matchKey: route.match_key,
    brandId: route.brand_id ?? '',
    groupId: String(route.group_id),
    expertiseId: route.required_expertise_id === null ? '' : String(route.required_expertise_id),
    priority: route.default_priority,
    active: route.active,
  };
}

/** Catalogue keys of what stops a save; empty when the draft can be sent. */
export function routeDraftProblems(draft: RouteDraft): string[] {
  const problems: string[] = [];
  if (!routeKeys(draft.matchType).includes(draft.matchKey)) {
    problems.push('playbook.handoff.routes.problem.key');
  }
  if (draft.groupId === '') problems.push('playbook.handoff.routes.problem.team');
  return problems;
}

/** `POST /handoff-routes`. */
export function createBody(draft: RouteDraft): Record<string, unknown> {
  return {
    match_type: draft.matchType,
    match_key: draft.matchKey,
    brand_id: draft.brandId === '' ? null : draft.brandId,
    group_id: Number(draft.groupId),
    required_expertise_id: draft.expertiseId === '' ? null : Number(draft.expertiseId),
    default_priority: draft.priority,
    active: draft.active,
  };
}

/** `PATCH /handoff-routes/{id}`: only the fields the admin changed. */
export function updateBody(draft: RouteDraft, route: HandoffRoute): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (Number(draft.groupId) !== route.group_id) body['group_id'] = Number(draft.groupId);
  const expertise = draft.expertiseId === '' ? null : Number(draft.expertiseId);
  if (expertise !== route.required_expertise_id) body['required_expertise_id'] = expertise;
  if (draft.priority !== route.default_priority) body['default_priority'] = draft.priority;
  return body;
}

const ROUTE_REFUSALS: ReadonlySet<string> = new Set([
  'handoff_route_bad_key',
  'handoff_route_taken',
  'handoff_route_unknown_team',
  'handoff_route_unknown_expertise',
  'handoff_route_unknown_brand',
  'handoff_routes_limit',
]);

/** The catalogue key that answers a failed route call: a named refusal has its own sentence. */
export function routeErrorKey(error: unknown): string {
  if (error instanceof ApiClientError && error.type === 'validation') {
    const reason = error.details?.['reason'];
    if (typeof reason === 'string' && ROUTE_REFUSALS.has(reason)) {
      return `playbook.handoff.routes.error.${reason}`;
    }
  }
  return errorMessageKey(error);
}
