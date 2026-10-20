/**
 * The AI's hand-over target (tm 307.2 · SiyahTuş analysis AI-12 §1–§3;
 * ADR-08a, ADR-14b §2.12): the team a conversation the AI hands over goes to,
 * whoever there must be trained for it, and how pressing its route says it is.
 *
 * The order — the first step that names a team that still exists:
 *
 *   1. **the hand-over's own team** — the step's (`group_id`; by name only for
 *      a step saved before ids, the lowest id of that name) or the workspace
 *      rule's (K9 — `settleHandoffTurn` put it on the hand-over), and a rule's
 *      topic with it;
 *   2. **a reason route** — the hand-over's reasons, most severe first
 *      (`guardrail_self_harm` before `player_request`): the conversation
 *      brand's route, then every brand's;
 *   3. **a topic route** — the hand-over's topic as its queue role (a
 *      procedure's, a guardrail's or a risk flag's — `handoffTopicRole`):
 *      the brand's route, every brand's, then the team holding the role
 *      (`groups.topic_role`, AU-01);
 *   4. **a same-day return** (`repeat_same_day`): the team that had the day's
 *      previous hand-over — its agent first, when they can take it now;
 *   5. **the fallback team** — only once a team named on the way turned out
 *      to be gone: an invalid target is not a reason to drop the conversation;
 *   6. none of these: routing decides, as on open (`handOverFromAi`).
 *
 * Routes come from the configuration the turn ran on (the AI's copy, ADR-14b
 * §2.12); human routing reads the table live. A route whose team is gone gives
 * way to the live route for the same key and brand, then to the next step.
 * Every team found gone is a {@link HandoffTargetFallback}, for the decision
 * record (`details.handoff_target_fallback`).
 *
 * Reads go through a {@link HandoffTargetLookup}, so the order is tested
 * without a database; `handoff-service.ts` reads the real one.
 */
import {
  HANDOFF_ROUTE_MATCH_TYPES,
  THREAD_PRIORITIES,
  handoffTopicRole,
  type HandoffReason,
  type HandoffRouteMatchType,
  type QueueTopicRole,
  type ThreadPriority,
} from '@siyahtus/types';

/** An active hand-over route, as the configuration carries it (`handoff_routes`). */
export interface HandoffRouteConfig {
  readonly id: string;
  /** The brand it is for; null: every brand. */
  readonly brandId: string | null;
  readonly matchType: HandoffRouteMatchType;
  readonly matchKey: string;
  readonly groupId: number;
  readonly requiredExpertiseId: number | null;
  readonly defaultPriority: ThreadPriority;
}

/** The columns a route is read from. */
export interface HandoffRouteRow {
  id: string;
  brandId: string | null;
  matchType: string;
  matchKey: string;
  groupId: bigint;
  requiredExpertiseId: bigint | null;
  defaultPriority: string;
}

/** A stored route as the configuration carries it; null for a type or priority the API never writes. */
export function readHandoffRoute(row: HandoffRouteRow): HandoffRouteConfig | null {
  const { matchType, defaultPriority } = row;
  if (!(HANDOFF_ROUTE_MATCH_TYPES as readonly string[]).includes(matchType)) return null;
  if (!(THREAD_PRIORITIES as readonly string[]).includes(defaultPriority)) return null;
  return {
    id: row.id,
    brandId: row.brandId,
    matchType: matchType as HandoffRouteMatchType,
    matchKey: row.matchKey,
    groupId: Number(row.groupId),
    requiredExpertiseId: row.requiredExpertiseId === null ? null : Number(row.requiredExpertiseId),
    defaultPriority: defaultPriority as ThreadPriority,
  };
}

/** The select a {@link HandoffRouteRow} needs. */
export const HANDOFF_ROUTE_SELECT = {
  id: true,
  brandId: true,
  matchType: true,
  matchKey: true,
  groupId: true,
  requiredExpertiseId: true,
  defaultPriority: true,
} as const;

/** Which step of the order named the team. */
export type HandoffTargetSource =
  'step' | 'rule' | 'reason_route' | 'topic_route' | 'topic_team' | 'same_day' | 'fallback';

/** A team the order named that is gone, as the decision record keeps it. */
export interface HandoffTargetFallback {
  readonly source: HandoffTargetSource;
  /** The team's id; null for a step that names a team by a name no team has. */
  readonly group_id: number | null;
  readonly route_id?: string;
}

export interface HandoffTarget {
  /** The team; null: routing decides. */
  readonly groupId: bigint | null;
  readonly source: HandoffTargetSource | null;
  /** The route that named it, when one did. */
  readonly routeId: string | null;
  /** What whoever takes it must hold besides the team's own (the route's). */
  readonly requiredExpertiseId: bigint | null;
  /** The route's priority — a floor beside the hand-over's own. */
  readonly priority: ThreadPriority | null;
  /** The agent tried first (a same-day return's). */
  readonly preferAgentId: string | null;
  readonly fallbacks: readonly HandoffTargetFallback[];
}

/** No team: routing decides. */
export const ROUTED_TARGET: HandoffTarget = {
  groupId: null,
  source: null,
  routeId: null,
  requiredExpertiseId: null,
  priority: null,
  preferAgentId: null,
  fallbacks: [],
};

/** What the order reads, live. */
export interface HandoffTargetLookup {
  /** Whether a team of this id exists in the workspace. */
  groupExists(groupId: bigint): Promise<boolean>;
  /** The lowest-id team of this name, or null. */
  teamNamed(name: string): Promise<bigint | null>;
  /** The active live route for exactly this key and brand (null: every brand's). */
  liveRoute(
    matchType: HandoffRouteMatchType,
    matchKey: string,
    brandId: string | null,
  ): Promise<HandoffRouteConfig | null>;
  /** The team holding a queue role (`resolveQueue`), or null. */
  roleTeam(role: QueueTopicRole): Promise<bigint | null>;
  /** The team — and its agent — that had the day's previous hand-over, or null. */
  sameDay(): Promise<{ groupId: bigint; agentId: string | null } | null>;
  /** The workspace's fallback team, or null. */
  fallbackGroup(): Promise<bigint | null>;
}

/** The hand-over's share of the order. */
export interface HandoffTargetInput {
  /** The step's or the rule's team id. */
  readonly groupId?: number;
  /** A one-message skill step's team name (before ids). */
  readonly team: string | null;
  readonly topic?: string;
  /** The workspace rule that set it off or routed it (K9). */
  readonly ruleId?: string;
  /** Catalogue codes, most severe first. */
  readonly reasons: readonly HandoffReason[];
  /** The configuration's active routes. */
  readonly routes: readonly HandoffRouteConfig[];
  /** The conversation's brand, when the turn knows it; null: every brand's routes only. */
  readonly brandId: string | null;
}

export async function resolveHandoffTarget(
  input: HandoffTargetInput,
  lookup: HandoffTargetLookup,
): Promise<HandoffTarget> {
  const fallbacks: HandoffTargetFallback[] = [];
  const found = (target: Omit<HandoffTarget, 'fallbacks'>): HandoffTarget => ({
    ...target,
    fallbacks,
  });
  const team = (
    groupId: bigint,
    source: HandoffTargetSource,
    extra: Partial<Omit<HandoffTarget, 'fallbacks' | 'groupId' | 'source'>> = {},
  ): HandoffTarget => found({ ...ROUTED_TARGET, groupId, source, ...extra });

  const fromRoute = (route: HandoffRouteConfig, source: HandoffTargetSource): HandoffTarget =>
    team(BigInt(route.groupId), source, {
      routeId: route.id,
      requiredExpertiseId:
        route.requiredExpertiseId !== null ? BigInt(route.requiredExpertiseId) : null,
      priority: route.defaultPriority,
    });

  /** The route for a key — the brand's, then every brand's — whose team exists. */
  const byRoute = async (
    matchType: HandoffRouteMatchType,
    matchKey: string,
    source: HandoffTargetSource,
  ): Promise<HandoffTarget | null> => {
    const brands = input.brandId !== null ? [input.brandId, null] : [null];
    for (const brandId of brands) {
      const route = input.routes.find(
        (r) => r.matchType === matchType && r.matchKey === matchKey && r.brandId === brandId,
      );
      if (!route) continue;
      if (await lookup.groupExists(BigInt(route.groupId))) return fromRoute(route, source);
      fallbacks.push({ source, group_id: route.groupId, route_id: route.id });
      // The AI's copy names a team that is gone: the live route for the key, if
      // it names another (ADR-14b §2.12).
      const live = await lookup.liveRoute(matchType, matchKey, brandId);
      if (live && live.groupId !== route.groupId) {
        if (await lookup.groupExists(BigInt(live.groupId))) return fromRoute(live, source);
        fallbacks.push({ source, group_id: live.groupId, route_id: live.id });
      }
    }
    return null;
  };

  /** A topic: its routes, then the team holding its role. */
  const byTopic = async (topic: string | undefined): Promise<HandoffTarget | null> => {
    const role = handoffTopicRole(topic);
    if (role === null) return null;
    const routed = await byRoute('topic', role, 'topic_route');
    if (routed) return routed;
    const holder = await lookup.roleTeam(role);
    return holder !== null ? team(holder, 'topic_team') : null;
  };

  // 1. The hand-over's own team: the step's, or the workspace rule's.
  const own: HandoffTargetSource = input.ruleId !== undefined ? 'rule' : 'step';
  if (input.groupId !== undefined) {
    const groupId = BigInt(input.groupId);
    if (await lookup.groupExists(groupId)) return team(groupId, own);
    fallbacks.push({ source: own, group_id: input.groupId });
  }
  if (input.team !== null) {
    const named = await lookup.teamNamed(input.team);
    if (named !== null) return team(named, 'step');
    if (input.groupId === undefined) fallbacks.push({ source: 'step', group_id: null });
  }
  // A rule's topic is the rule's choice: before the reason routes.
  if (input.ruleId !== undefined) {
    const ruled = await byTopic(input.topic);
    if (ruled) return ruled;
  }

  // 2. A reason route, most severe reason first.
  for (const reason of input.reasons) {
    const routed = await byRoute('reason', reason, 'reason_route');
    if (routed) return routed;
  }

  // 3. The topic: its route, then its role's team.
  if (input.ruleId === undefined) {
    const topical = await byTopic(input.topic);
    if (topical) return topical;
  }

  // 4. The same problem again today: the team that had it, its agent first.
  if (input.reasons.includes('repeat_same_day')) {
    const earlier = await lookup.sameDay();
    if (earlier && (await lookup.groupExists(earlier.groupId))) {
      return team(earlier.groupId, 'same_day', { preferAgentId: earlier.agentId });
    }
  }

  // 5. A team named on the way is gone: the fallback team, not nowhere.
  if (fallbacks.length > 0) {
    const fallback = await lookup.fallbackGroup();
    if (fallback !== null && (await lookup.groupExists(fallback))) {
      return team(fallback, 'fallback');
    }
  }

  // 6. Routing decides.
  return found(ROUTED_TARGET);
}

/** The decision record's share: where it went and what was gone on the way. */
export function handoffTargetDetails(target: HandoffTarget): Record<string, unknown> {
  return {
    handoff_target: {
      group_id: target.groupId === null ? null : Number(target.groupId),
      source: target.source ?? 'routing',
      ...(target.routeId !== null ? { route_id: target.routeId } : {}),
    },
    ...(target.fallbacks.length > 0 ? { handoff_target_fallback: [...target.fallbacks] } : {}),
  };
}
