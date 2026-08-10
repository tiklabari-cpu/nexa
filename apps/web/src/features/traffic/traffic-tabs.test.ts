import { describe, expect, it } from 'vitest';
import { countByTab, isTrafficTab, tabToActivity, TRAFFIC_TABS } from './traffic-tabs.js';
import type { TrafficActivity } from './types.js';

const ACTIVITIES: TrafficActivity[] = [
  'browsing',
  'queued',
  'waiting',
  'chatting',
  'supervised',
  'invited',
];

describe('TRAFFIC_TABS', () => {
  it('lists All plus the six funnel states in rapor-1 §644 order', () => {
    expect(TRAFFIC_TABS.map((tab) => tab.label)).toEqual([
      'All',
      'Chatting',
      'Supervised',
      'Queued',
      'Waiting for reply',
      'Invited',
      'Browsing',
    ]);
  });

  it('has exactly seven tabs', () => {
    expect(TRAFFIC_TABS).toHaveLength(7);
  });
});

describe('isTrafficTab', () => {
  it('accepts every tab id', () => {
    for (const tab of TRAFFIC_TABS) expect(isTrafficTab(tab.id)).toBe(true);
  });

  it('rejects an unknown value or null — falls back to All, never throws', () => {
    expect(isTrafficTab('bogus')).toBe(false);
    expect(isTrafficTab(null)).toBe(false);
  });
});

describe('tabToActivity', () => {
  it('sends no constraint for All', () => {
    expect(tabToActivity('all')).toBeUndefined();
  });

  it.each(ACTIVITIES)('asks only for its own state (%s)', (activity) => {
    expect(tabToActivity(activity)).toEqual([activity]);
  });
});

describe('countByTab', () => {
  it('buckets every visitor into exactly one tab, and the buckets sum to All', () => {
    const visitors = [
      { activity: 'chatting' as const },
      { activity: 'chatting' as const },
      { activity: 'queued' as const },
      { activity: 'browsing' as const },
    ];

    const counts = countByTab(visitors);

    expect(counts).toEqual({
      all: 4,
      chatting: 2,
      supervised: 0,
      queued: 1,
      waiting: 0,
      invited: 0,
      browsing: 1,
    });

    const sumOfBuckets = ACTIVITIES.reduce((sum, activity) => sum + counts[activity], 0);
    expect(sumOfBuckets).toBe(counts.all);
  });

  it('returns every count at zero for an empty list', () => {
    const counts = countByTab([]);
    expect(counts.all).toBe(0);
    for (const activity of ACTIVITIES) expect(counts[activity]).toBe(0);
  });
});
