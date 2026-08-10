/**
 * Goals view logic (FR-MOD-13.3), kept free of React so which tab a goal
 * belongs to and how many fall under each are decided by pure functions a
 * unit test can pin down — the same split campaigns.ts draws for its list.
 */
import { GOAL_FILTERS, type Goal, type GoalFilter, type GoalFunnel } from '@nexa/types';

/** The status sub-tabs in display order. */
export const GOAL_TABS: ReadonlyArray<{ id: GoalFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

/** True for a value the status tabs understand — guards a URL/query param. */
export function isGoalFilter(value: string): value is GoalFilter {
  return (GOAL_FILTERS as readonly string[]).includes(value);
}

/** Narrow a goal list to a status tab; `all` keeps everything. */
export function filterGoals(goals: readonly Goal[], filter: GoalFilter): Goal[] {
  if (filter === 'all') return [...goals];
  const active = filter === 'active';
  return goals.filter((goal) => goal.active === active);
}

/** How many goals fall under each tab — the counts shown beside the labels. */
export function goalCounts(goals: readonly Goal[]): Record<GoalFilter, number> {
  const counts: Record<GoalFilter, number> = { all: goals.length, active: 0, inactive: 0 };
  for (const goal of goals) counts[goal.active ? 'active' : 'inactive'] += 1;
  return counts;
}

/** One stat card in the funnel display: what to label it, its count, and — only for the final stage — its conversion rate. */
export interface GoalFunnelStage {
  label: string;
  value: number;
  /** Only set on the last stage; `null` when there were no chats to divide by (no NaN/Infinity). */
  rate: number | null;
}

/**
 * The 3-stage funnel (Visitors → Chats → Conversions) as label/value/rate
 * triples a component can render without knowing the field names underneath.
 * Only the last stage carries a rate — `GoalFunnel.conversion_rate` is
 * already null-safe (see its own doc comment), so this just relays it rather
 * than re-deriving it and risking a second, driftable definition.
 */
export function funnelStages(funnel: GoalFunnel): GoalFunnelStage[] {
  return [
    { label: 'Visitors', value: funnel.visitors, rate: null },
    { label: 'Chats', value: funnel.chats, rate: null },
    { label: 'Conversions', value: funnel.conversions, rate: funnel.conversion_rate },
  ];
}
