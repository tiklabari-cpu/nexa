import { describe, expect, it } from 'vitest';
import { visitorPageUrls } from '../campaigns/campaign-matching.js';
import { hasGoalTrigger, matchesGoal } from './goal-matching.js';

describe('hasGoalTrigger', () => {
  it('is true only when the definition carries something to match on', () => {
    expect(hasGoalTrigger({ url_contains: '/thank-you' })).toBe(true);
    expect(hasGoalTrigger({})).toBe(false);
    expect(hasGoalTrigger({ url_contains: '   ' })).toBe(false);
  });

  it('reads a hand-edited definition as unreachable rather than throwing', () => {
    // `goals.definition` is jsonb: the route validates what it writes, but a row
    // edited straight in the database can hold anything. Every one of these is a
    // goal nobody reaches — none of them is an error.
    expect(hasGoalTrigger(null)).toBe(false);
    expect(hasGoalTrigger(undefined)).toBe(false);
    expect(hasGoalTrigger('/thank-you')).toBe(false);
    expect(hasGoalTrigger(42)).toBe(false);
    expect(hasGoalTrigger({ url_contains: 42 })).toBe(false);
    expect(hasGoalTrigger({ url_contains: null })).toBe(false);
    expect(hasGoalTrigger([])).toBe(false);
  });
});

describe('matchesGoal', () => {
  it('matches when a page the visitor saw contains the needle (case-insensitive)', () => {
    expect(matchesGoal({ url_contains: '/Thank-You' }, ['https://shop.example/thank-you'])).toBe(
      true,
    );
    expect(matchesGoal({ url_contains: '/thank-you' }, ['https://shop.example/THANK-YOU?id=7'])).toBe(
      true,
    );
  });

  it('does not match when no page contains the needle', () => {
    expect(matchesGoal({ url_contains: '/thank-you' }, ['https://shop.example/pricing'])).toBe(
      false,
    );
    expect(matchesGoal({ url_contains: '/thank-you' }, [])).toBe(false);
  });

  it('matches nobody when the definition has no predicate', () => {
    // The rule the route enforces on write, held here too: an empty goal is not
    // "everyone converts", it is a target nobody can reach.
    expect(matchesGoal({}, ['https://shop.example/thank-you'])).toBe(false);
    expect(matchesGoal({ url_contains: '' }, ['https://shop.example/thank-you'])).toBe(false);
    expect(matchesGoal({ url_contains: '   ' }, ['https://shop.example/thank-you'])).toBe(false);
  });

  it('treats an unreadable definition as unreachable rather than throwing', () => {
    // One bad row must not throw: `evaluate` runs every active goal in the
    // workspace over the same visitor, and a throw here would lose the others.
    expect(() => matchesGoal({ url_contains: 42 }, ['https://shop.example/thank-you'])).not.toThrow();
    expect(matchesGoal({ url_contains: 42 }, ['https://shop.example/thank-you'])).toBe(false);
    expect(matchesGoal(null, ['https://shop.example/thank-you'])).toBe(false);
    expect(matchesGoal('/thank-you', ['https://shop.example/thank-you'])).toBe(false);
  });

  it('survives a malformed pages array — the entries it can read still decide', () => {
    // The production path: `visit.pages` is free-form json, so the urls arrive
    // through `visitorPageUrls`. A visitor with one unreadable page entry still
    // converts on the page that is readable.
    const pages = visitorPageUrls([{ url: 42 }, null, 'not-an-object', { url: '/thank-you' }, {}]);
    expect(matchesGoal({ url_contains: '/thank-you' }, pages)).toBe(true);

    expect(matchesGoal({ url_contains: '/thank-you' }, visitorPageUrls(null))).toBe(false);
    expect(matchesGoal({ url_contains: '/thank-you' }, visitorPageUrls('not-an-array'))).toBe(false);
  });
});
