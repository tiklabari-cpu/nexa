import { describe, expect, it } from 'vitest';
import type { Goal, GoalFunnel } from '@nexa/types';
import { GOAL_TABS, filterGoals, funnelStages, goalCounts, isGoalFilter } from './goals.js';

function goal(active: boolean, over: Partial<Goal> = {}): Goal {
  return {
    id: `g-${active}-${over.name ?? ''}`,
    name: 'A goal',
    definition: { url_contains: '/thank-you' },
    active,
    created_at: '2026-07-26T12:00:00.000Z',
    ...over,
  };
}

describe('GOAL_TABS', () => {
  it('offers All / Active / Inactive in order', () => {
    expect(GOAL_TABS.map((tab) => tab.id)).toEqual(['all', 'active', 'inactive']);
  });
});

describe('isGoalFilter', () => {
  it('accepts the tab ids and rejects anything else', () => {
    expect(isGoalFilter('all')).toBe(true);
    expect(isGoalFilter('active')).toBe(true);
    expect(isGoalFilter('inactive')).toBe(true);
    expect(isGoalFilter('ongoing')).toBe(false);
    expect(isGoalFilter('')).toBe(false);
  });
});

describe('filterGoals', () => {
  const list = [goal(true), goal(false), goal(true)];

  it('keeps everything for the "all" tab', () => {
    expect(filterGoals(list, 'all')).toHaveLength(3);
  });

  it('narrows to active goals', () => {
    const active = filterGoals(list, 'active');
    expect(active).toHaveLength(2);
    expect(active.every((g) => g.active)).toBe(true);
  });

  it('narrows to inactive goals', () => {
    const inactive = filterGoals(list, 'inactive');
    expect(inactive).toHaveLength(1);
    expect(inactive.every((g) => !g.active)).toBe(true);
  });

  it('does not mutate the input for the "all" tab', () => {
    const returned = filterGoals(list, 'all');
    expect(returned).not.toBe(list);
  });
});

describe('goalCounts', () => {
  it('counts each tab, with "all" being the total', () => {
    const counts = goalCounts([goal(true), goal(true), goal(false)]);
    expect(counts).toEqual({ all: 3, active: 2, inactive: 1 });
  });

  it('is all-zero for an empty list', () => {
    expect(goalCounts([])).toEqual({ all: 0, active: 0, inactive: 0 });
  });
});

function goalFunnel(over: Partial<GoalFunnel> = {}): GoalFunnel {
  return { visitors: 0, chats: 0, conversions: 0, conversion_rate: null, ...over };
}

describe('funnelStages', () => {
  it('returns the three stages in order, with their counts', () => {
    const stages = funnelStages(
      goalFunnel({ visitors: 100, chats: 40, conversions: 10, conversion_rate: 0.25 }),
    );
    expect(stages).toEqual([
      { label: 'Visitors', value: 100, rate: null },
      { label: 'Chats', value: 40, rate: null },
      { label: 'Conversions', value: 10, rate: 0.25 },
    ]);
  });

  it('only the Conversions stage carries a rate', () => {
    const [visitors, chats, conversions] = funnelStages(goalFunnel({ conversion_rate: 0.5 }));
    expect(visitors?.rate).toBeNull();
    expect(chats?.rate).toBeNull();
    expect(conversions?.rate).toBe(0.5);
  });

  it('keeps the rate null (never NaN/Infinity) when there is nothing to divide by', () => {
    const stages = funnelStages(goalFunnel({ visitors: 0, chats: 0, conversions: 0 }));
    expect(stages[2]?.rate).toBeNull();
  });
});
