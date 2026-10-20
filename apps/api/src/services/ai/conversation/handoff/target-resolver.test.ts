import { describe, expect, it } from 'vitest';
import type { HandoffReason, QueueTopicRole } from '@siyahtus/types';
import {
  ROUTED_TARGET,
  handoffTargetDetails,
  readHandoffRoute,
  resolveHandoffTarget,
  type HandoffRouteConfig,
  type HandoffTargetInput,
  type HandoffTargetLookup,
} from './target-resolver.js';

const BRAND = '00000000-0000-4000-8000-0000000000b1';

function route(
  matchType: 'topic' | 'reason',
  matchKey: string,
  groupId: number,
  extra: Partial<HandoffRouteConfig> = {},
): HandoffRouteConfig {
  return {
    id: `${matchType}:${matchKey}:${extra.brandId ?? 'all'}`,
    brandId: null,
    matchType,
    matchKey,
    groupId,
    requiredExpertiseId: null,
    defaultPriority: 'normal',
    ...extra,
  };
}

/** A workspace of teams by id and name, role holders, live routes, a fallback. */
function workspace(
  input: {
    teams?: Record<number, string>;
    roles?: Partial<Record<QueueTopicRole, number>>;
    live?: HandoffRouteConfig[];
    sameDay?: { groupId: number; agentId: string | null };
    fallback?: number;
  } = {},
): HandoffTargetLookup {
  const teams = input.teams ?? {};
  return {
    groupExists: async (id) => teams[Number(id)] !== undefined,
    teamNamed: async (name) => {
      const ids = Object.entries(teams)
        .filter(([, n]) => n === name)
        .map(([id]) => Number(id))
        .sort((a, b) => a - b);
      return ids.length > 0 ? BigInt(ids[0]!) : null;
    },
    liveRoute: async (type, key, brandId) =>
      (input.live ?? []).find(
        (r) => r.matchType === type && r.matchKey === key && r.brandId === brandId,
      ) ?? null,
    roleTeam: async (role) => {
      const id = input.roles?.[role];
      return id !== undefined && teams[id] !== undefined ? BigInt(id) : null;
    },
    sameDay: async () =>
      input.sameDay
        ? { groupId: BigInt(input.sameDay.groupId), agentId: input.sameDay.agentId }
        : null,
    fallbackGroup: async () => (input.fallback !== undefined ? BigInt(input.fallback) : null),
  };
}

function handOver(input: Partial<HandoffTargetInput> = {}): HandoffTargetInput {
  return { team: null, reasons: ['procedure_rule'], routes: [], brandId: null, ...input };
}

const TEAMS = { 1: 'Finans', 2: 'Sorumlu Oyun', 3: 'Şikâyet', 4: 'Genel', 5: 'KYC' };

describe('the hand-over target order (AI-12 §1 · tm 307.2)', () => {
  it("the step's team by id, so a renamed team still receives it", async () => {
    const target = await resolveHandoffTarget(
      handOver({ groupId: 1, team: 'Old name' }),
      workspace({ teams: { 1: 'Finance (renamed)' } }),
    );
    expect(target).toEqual({ ...ROUTED_TARGET, groupId: 1n, source: 'step' });
  });

  it('a step saved before ids: by name, the lowest id of it', async () => {
    const target = await resolveHandoffTarget(
      handOver({ team: 'Finans' }),
      workspace({ teams: { 7: 'Finans', 3: 'Finans' } }),
    );
    expect(target).toMatchObject({ groupId: 3n, source: 'step', fallbacks: [] });
  });

  it('a gone step team: its name, then the fallback team — each gone team on the record', async () => {
    const byName = await resolveHandoffTarget(
      handOver({ groupId: 99, team: 'Finans' }),
      workspace({ teams: TEAMS }),
    );
    expect(byName).toMatchObject({
      groupId: 1n,
      source: 'step',
      fallbacks: [{ source: 'step', group_id: 99 }],
    });

    const fallback = await resolveHandoffTarget(
      handOver({ groupId: 99, team: 'Silinmiş ekip' }),
      workspace({ teams: TEAMS, fallback: 4 }),
    );
    expect(fallback).toMatchObject({
      groupId: 4n,
      source: 'fallback',
      fallbacks: [{ source: 'step', group_id: 99 }],
    });

    const nameOnly = await resolveHandoffTarget(
      handOver({ team: 'Silinmiş ekip' }),
      workspace({ teams: TEAMS, fallback: 4 }),
    );
    expect(nameOnly).toMatchObject({
      groupId: 4n,
      source: 'fallback',
      fallbacks: [{ source: 'step', group_id: null }],
    });
  });

  it('with no fallback team, a gone target is routed — still on the record', async () => {
    const target = await resolveHandoffTarget(handOver({ groupId: 99 }), workspace());
    expect(target).toEqual({ ...ROUTED_TARGET, fallbacks: [{ source: 'step', group_id: 99 }] });
    expect(handoffTargetDetails(target)).toEqual({
      handoff_target: { group_id: null, source: 'routing' },
      handoff_target_fallback: [{ source: 'step', group_id: 99 }],
    });
  });

  it('nothing named and nothing gone: routing decides — not the fallback team', async () => {
    const target = await resolveHandoffTarget(handOver(), workspace({ teams: TEAMS, fallback: 4 }));
    expect(target).toEqual(ROUTED_TARGET);
    expect(handoffTargetDetails(target)).toEqual({
      handoff_target: { group_id: null, source: 'routing' },
    });
  });

  it('a reason route, most severe reason first, before the topic', async () => {
    const routes = [
      route('reason', 'player_request', 4),
      route('reason', 'guardrail_self_harm', 2, { defaultPriority: 'urgent' }),
      route('topic', 'responsible_gambling', 3),
    ];
    const target = await resolveHandoffTarget(
      handOver({
        reasons: ['guardrail_self_harm', 'player_request'],
        topic: 'responsible_gaming',
        routes,
      }),
      workspace({ teams: TEAMS }),
    );
    expect(target).toMatchObject({
      groupId: 2n,
      source: 'reason_route',
      routeId: 'reason:guardrail_self_harm:all',
      priority: 'urgent',
    });
  });

  it("the brand's route before every brand's; another brand's never", async () => {
    const routes = [
      route('reason', 'guardrail_complaint', 4),
      route('reason', 'guardrail_complaint', 3, { brandId: BRAND }),
      route('reason', 'guardrail_rg', 1, { brandId: '00000000-0000-4000-8000-0000000000b2' }),
    ];
    const lookup = workspace({ teams: TEAMS });
    const own = await resolveHandoffTarget(
      handOver({ reasons: ['guardrail_complaint'], routes, brandId: BRAND }),
      lookup,
    );
    expect(own).toMatchObject({ groupId: 3n, source: 'reason_route' });
    const unbranded = await resolveHandoffTarget(
      handOver({ reasons: ['guardrail_complaint'], routes }),
      lookup,
    );
    expect(unbranded).toMatchObject({ groupId: 4n, source: 'reason_route' });
    const sibling = await resolveHandoffTarget(
      handOver({ reasons: ['guardrail_rg'], routes, brandId: BRAND }),
      lookup,
    );
    expect(sibling).toEqual(ROUTED_TARGET);
  });

  it("a guardrail's topic is its queue role: the topic route, then the role's team", async () => {
    const lookup = workspace({ teams: TEAMS, roles: { responsible_gambling: 2, complaint: 3 } });
    const byRole = await resolveHandoffTarget(
      handOver({ reasons: ['guardrail_self_harm'], topic: 'responsible_gaming' }),
      lookup,
    );
    expect(byRole).toMatchObject({ groupId: 2n, source: 'topic_team', routeId: null });

    const byRoute = await resolveHandoffTarget(
      handOver({
        reasons: ['guardrail_complaint'],
        topic: 'complaints',
        routes: [
          route('topic', 'complaint', 4, { requiredExpertiseId: 12, defaultPriority: 'high' }),
        ],
      }),
      lookup,
    );
    expect(byRoute).toMatchObject({
      groupId: 4n,
      source: 'topic_route',
      requiredExpertiseId: 12n,
      priority: 'high',
    });

    const unknownTopic = await resolveHandoffTarget(handOver({ topic: 'general' }), lookup);
    expect(unknownTopic).toEqual(ROUTED_TARGET);
  });

  it("a rule's topic is the rule's choice, before the reason routes (K9)", async () => {
    const target = await resolveHandoffTarget(
      handOver({
        reasons: ['player_request'],
        topic: 'finance',
        ruleId: 'rule-1',
        routes: [route('reason', 'player_request', 4)],
      }),
      workspace({ teams: TEAMS, roles: { finance: 1 } }),
    );
    expect(target).toMatchObject({ groupId: 1n, source: 'topic_team' });

    const ruleTeam = await resolveHandoffTarget(
      handOver({ groupId: 5, ruleId: 'rule-1' }),
      workspace({ teams: TEAMS }),
    );
    expect(ruleTeam).toMatchObject({ groupId: 5n, source: 'rule' });
  });

  it("the AI's copy names a gone team: the live route for the key, then on — both on the record", async () => {
    const copy = route('reason', 'guardrail_minor', 99);
    const live = route('reason', 'guardrail_minor', 5);
    const moved = await resolveHandoffTarget(
      handOver({ reasons: ['guardrail_minor'], routes: [copy] }),
      workspace({ teams: TEAMS, live: [{ ...live, id: 'live-1' }] }),
    );
    expect(moved).toMatchObject({
      groupId: 5n,
      source: 'reason_route',
      routeId: 'live-1',
      fallbacks: [{ source: 'reason_route', group_id: 99, route_id: copy.id }],
    });

    const gone = await resolveHandoffTarget(
      handOver({ reasons: ['guardrail_minor'], routes: [copy], topic: 'responsible_gaming' }),
      workspace({ teams: TEAMS, roles: { responsible_gambling: 2 }, fallback: 4 }),
    );
    // The next step still names a team: the fallback team is for none.
    expect(gone).toMatchObject({
      groupId: 2n,
      source: 'topic_team',
      fallbacks: [{ source: 'reason_route', group_id: 99, route_id: copy.id }],
    });
  });

  it('the same problem again today: the team that had it, its agent first', async () => {
    const reasons: HandoffReason[] = ['repeat_same_day'];
    const target = await resolveHandoffTarget(
      handOver({ reasons }),
      workspace({ teams: TEAMS, sameDay: { groupId: 1, agentId: 'agent-1' }, fallback: 4 }),
    );
    expect(target).toMatchObject({ groupId: 1n, source: 'same_day', preferAgentId: 'agent-1' });

    // Not without the reason, and not to a team since gone.
    expect(
      await resolveHandoffTarget(
        handOver(),
        workspace({ teams: TEAMS, sameDay: { groupId: 1, agentId: null } }),
      ),
    ).toEqual(ROUTED_TARGET);
    expect(
      await resolveHandoffTarget(
        handOver({ reasons }),
        workspace({ teams: TEAMS, sameDay: { groupId: 99, agentId: null } }),
      ),
    ).toEqual(ROUTED_TARGET);
  });
});

describe('a stored route as the configuration reads it', () => {
  const row = {
    id: 'r1',
    brandId: null,
    matchType: 'topic',
    matchKey: 'finance',
    groupId: 3n,
    requiredExpertiseId: 9n,
    defaultPriority: 'high',
  };

  it('numbers for ids, the types it was written with', () => {
    expect(readHandoffRoute(row)).toEqual({
      id: 'r1',
      brandId: null,
      matchType: 'topic',
      matchKey: 'finance',
      groupId: 3,
      requiredExpertiseId: 9,
      defaultPriority: 'high',
    });
    expect(readHandoffRoute({ ...row, requiredExpertiseId: null })?.requiredExpertiseId).toBeNull();
  });

  it('a type or priority the API never writes is not carried', () => {
    expect(readHandoffRoute({ ...row, matchType: 'brand' })).toBeNull();
    expect(readHandoffRoute({ ...row, defaultPriority: 'critical' })).toBeNull();
  });
});
