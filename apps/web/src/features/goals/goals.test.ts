import { describe, expect, it } from 'vitest';
import type { Goal } from '@nexa/types';
import { GOAL_TABS, filterGoals, goalCounts, isGoalFilter } from './goals.js';

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
