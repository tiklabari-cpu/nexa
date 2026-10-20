import { describe, expect, it } from 'vitest';
import { HANDOFF_REASONS } from './handoff.js';
import {
  HANDOFF_ROUTE_MATCH_TYPES,
  THREAD_PRIORITY_REASON_PATTERN,
  isHandoffRouteKey,
} from './handoff-routes.js';
import { QUEUE_TOPIC_ROLES } from './team-queues.js';

describe('hand-over route keys (AI-12 · tm 307.1)', () => {
  it('a topic route matches the queue roles, a reason route the hand-over reasons', () => {
    expect(HANDOFF_ROUTE_MATCH_TYPES).toEqual(['topic', 'reason']);
    for (const role of QUEUE_TOPIC_ROLES) {
      expect(isHandoffRouteKey('topic', role)).toBe(true);
      expect(isHandoffRouteKey('reason', role)).toBe(false);
    }
    for (const reason of HANDOFF_REASONS) {
      expect(isHandoffRouteKey('reason', reason)).toBe(true);
      expect(isHandoffRouteKey('topic', reason)).toBe(false);
    }
  });

  it.each([
    ['topic', 'responsible_gaming'],
    ['topic', 'complaints'],
    ['topic', 'trading'],
    ['reason', 'G3'],
    ['brand', 'finance'],
    ['topic', 7],
  ])('refuses %s %s', (matchType, key) => {
    expect(isHandoffRouteKey(matchType, key)).toBe(false);
  });

  it('a priority reason is a lower snake_case code — every hand-over reason is one', () => {
    for (const reason of HANDOFF_REASONS) {
      expect(THREAD_PRIORITY_REASON_PATTERN.test(reason)).toBe(true);
    }
    expect(THREAD_PRIORITY_REASON_PATTERN.test('Kendine zarar')).toBe(false);
  });
});
