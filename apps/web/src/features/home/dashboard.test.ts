/**
 * Home dashboard card arithmetic (FR-MOD-13.1).
 *
 * The KK's "unit (kartlar)" gate: the pure logic behind the cards, tested apart
 * from React — the live counters map to the right labels, activation progress
 * counts honestly, and a week-over-week delta reads correctly, including the two
 * cases a naïve implementation gets wrong: no change (flat, not a false arrow)
 * and an unrated week (no delta, not −100%).
 */
import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_STEP_ROUTE,
  activationSummary,
  countDelta,
  liveCards,
  scoreDelta,
} from './dashboard.js';

describe('activationSummary', () => {
  it('reports progress and flags completion', () => {
    expect(activationSummary({ steps: [], completed: 1, total: 5 })).toEqual({
      completed: 1,
      total: 5,
      allDone: false,
      ratio: 0.2,
    });
    expect(activationSummary({ steps: [], completed: 5, total: 5 })).toMatchObject({
      allDone: true,
      ratio: 1,
    });
  });

  it('treats an empty checklist as nothing-left-to-do rather than dividing by zero', () => {
    expect(activationSummary({ steps: [], completed: 0, total: 0 })).toMatchObject({
      allDone: false,
      ratio: 1,
    });
  });

  it('has a destination for every step key', () => {
    for (const key of [
      'install_widget',
      'invite_teammate',
      'customize_widget',
      'add_canned_response',
      'set_up_ai_agent',
    ] as const) {
      expect(ACTIVATION_STEP_ROUTE[key]).toMatch(/^\/app\//);
    }
  });
});

describe('liveCards', () => {
  it('maps the three counters, in order, to their keys and values', () => {
    const cards = liveCards({ visitors_online: 7, ongoing_chats: 3, agents_online: 2 });
    expect(cards.map((c) => c.key)).toEqual(['visitors_online', 'ongoing_chats', 'agents_online']);
    expect(cards.map((c) => c.value)).toEqual([7, 3, 2]);
  });
});

describe('countDelta', () => {
  it('signs the change and names the direction', () => {
    expect(countDelta(10, 6)).toEqual({ direction: 'up', change: 4 });
    expect(countDelta(6, 10)).toEqual({ direction: 'down', change: -4 });
  });

  it('is flat when unchanged, so no false arrow is drawn', () => {
    expect(countDelta(5, 5)).toEqual({ direction: 'flat', change: 0 });
  });
});

describe('scoreDelta', () => {
  it('reports the change in percentage points', () => {
    expect(scoreDelta(0.62, 0.57)).toEqual({ direction: 'up', points: 5 });
    expect(scoreDelta(0.5, 0.75)).toEqual({ direction: 'down', points: -25 });
    expect(scoreDelta(0.8, 0.8)).toEqual({ direction: 'flat', points: 0 });
  });

  it('is null when either week is unrated — a delta against unknown is no delta', () => {
    expect(scoreDelta(null, 0.5)).toBeNull();
    expect(scoreDelta(0.5, null)).toBeNull();
    expect(scoreDelta(null, null)).toBeNull();
  });
});
