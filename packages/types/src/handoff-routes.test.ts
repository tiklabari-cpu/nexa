import { describe, expect, it } from 'vitest';
import { HANDOFF_REASONS } from './handoff.js';
import { GUARDRAIL_HANDOFF_TOPICS } from './guardrails.js';
import {
  HANDOFF_ROUTE_MATCH_TYPES,
  HANDOFF_TOPIC_ROLE_ALIASES,
  THREAD_PRIORITY_REASON_PATTERN,
  handoffTopicRole,
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

  it("a hand-over topic names its queue role: the roles as they are, the guardrails' spellings as the role they mean (AI-12 · tm 307.2)", () => {
    for (const role of QUEUE_TOPIC_ROLES) expect(handoffTopicRole(role)).toBe(role);
    for (const topic of GUARDRAIL_HANDOFF_TOPICS) {
      expect(QUEUE_TOPIC_ROLES).toContain(handoffTopicRole(topic));
    }
    expect(handoffTopicRole('responsible_gaming')).toBe('responsible_gambling');
    expect(handoffTopicRole('complaints')).toBe('complaint');
    for (const role of Object.values(HANDOFF_TOPIC_ROLE_ALIASES)) {
      expect(QUEUE_TOPIC_ROLES).toContain(role);
    }
    for (const key of ['general', 'trading', 'toString', 'constructor', '', null, 7]) {
      expect(handoffTopicRole(key)).toBeNull();
    }
  });
});
