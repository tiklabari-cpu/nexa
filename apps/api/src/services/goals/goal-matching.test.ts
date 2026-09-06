import { describe, expect, it } from 'vitest';
import { visitorPageUrls } from '../campaigns/campaign-matching.js';
import { goalRequires, hasGoalTrigger, matchesGoal } from './goal-matching.js';

/** A visitor of whom nothing beyond their pages is known. */
const NOTHING_HAPPENED = { saleCompleted: false, leadCaptured: false, chatResolved: false };

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
    expect(
      matchesGoal({ url_contains: '/thank-you' }, ['https://shop.example/THANK-YOU?id=7']),
    ).toBe(true);
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
    expect(() =>
      matchesGoal({ url_contains: 42 }, ['https://shop.example/thank-you']),
    ).not.toThrow();
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
    expect(matchesGoal({ url_contains: '/thank-you' }, visitorPageUrls('not-an-array'))).toBe(
      false,
    );
  });
});

// --- The sale / lead / resolution funnel (FR-MOD-13.3) ------------------------
//
// The PRD row names three conversions besides the page one, and until these
// predicates existed none of them could be written down: a sale goal had to
// read `tracked_sales`, a lead goal `customers.is_lead` and a resolution goal
// an archived chat, and all three were expressed as a URL or not at all.

describe('goalRequires (FR-MOD-13.3)', () => {
  it('counts only a literal true as a requirement', () => {
    expect(goalRequires({ sale_completed: true }, 'sale_completed')).toBe(true);
    expect(goalRequires({ sale_completed: false }, 'sale_completed')).toBe(false);
    expect(goalRequires({}, 'sale_completed')).toBe(false);
    // A hand-edited row must not turn into a goal that fires on a fact the
    // workspace never asked for: truthy is not the same as asked-for.
    expect(goalRequires({ sale_completed: 'yes' }, 'sale_completed')).toBe(false);
    expect(goalRequires({ sale_completed: 1 }, 'sale_completed')).toBe(false);
    expect(goalRequires(null, 'sale_completed')).toBe(false);
    expect(goalRequires('sale_completed', 'sale_completed')).toBe(false);
  });
});

describe('hasGoalTrigger with the funnel predicates (FR-MOD-13.3)', () => {
  it('accepts a goal defined only by a sale, a lead or a resolution', () => {
    // Each of these is a goal with no URL at all. Before 204.1 every one of
    // them was "nothing to match on" and the route refused to save it.
    expect(hasGoalTrigger({ sale_completed: true })).toBe(true);
    expect(hasGoalTrigger({ lead_captured: true })).toBe(true);
    expect(hasGoalTrigger({ chat_resolved: true })).toBe(true);
  });

  it('still rejects a definition that requires nothing', () => {
    expect(hasGoalTrigger({ sale_completed: false })).toBe(false);
    expect(hasGoalTrigger({ sale_completed: false, lead_captured: false })).toBe(false);
    // An unticked form is not a goal: all three keys present, none required.
    expect(
      hasGoalTrigger({
        url_contains: '',
        sale_completed: false,
        lead_captured: false,
        chat_resolved: false,
      }),
    ).toBe(false);
  });
});

describe('matchesGoal on the funnel predicates (FR-MOD-13.3)', () => {
  it('matches a sale goal only for a visitor who has a tracked sale', () => {
    const goal = { sale_completed: true };
    expect(matchesGoal(goal, [], { ...NOTHING_HAPPENED, saleCompleted: true })).toBe(true);
    expect(matchesGoal(goal, [], NOTHING_HAPPENED)).toBe(false);
    // A fact nobody supplied is not a match — absent is never "yes".
    expect(matchesGoal(goal, [])).toBe(false);
  });

  it('matches a lead goal only for a visitor held as a lead', () => {
    const goal = { lead_captured: true };
    expect(matchesGoal(goal, [], { ...NOTHING_HAPPENED, leadCaptured: true })).toBe(true);
    expect(matchesGoal(goal, [], NOTHING_HAPPENED)).toBe(false);
  });

  it('matches a resolution goal only once a conversation has been archived', () => {
    const goal = { chat_resolved: true };
    expect(matchesGoal(goal, [], { ...NOTHING_HAPPENED, chatResolved: true })).toBe(true);
    expect(matchesGoal(goal, [], NOTHING_HAPPENED)).toBe(false);
  });

  it('matches with no pages at all — the trap that would sink the whole funnel', () => {
    // A sale is reported by the shop's confirmation page and a chat is archived
    // by an agent; neither carries a visitor page view. A matcher that needed
    // one would mean these three goals were defined and never once reached.
    expect(matchesGoal({ sale_completed: true }, [], { saleCompleted: true })).toBe(true);
    expect(matchesGoal({ chat_resolved: true }, [], { chatResolved: true })).toBe(true);
  });

  it('requires every predicate that is set (AND), across kinds', () => {
    const goal = { url_contains: '/checkout', sale_completed: true };
    expect(
      matchesGoal(goal, ['https://shop.example/checkout'], {
        ...NOTHING_HAPPENED,
        saleCompleted: true,
      }),
    ).toBe(true);
    // The page without the sale, and the sale without the page: neither is the
    // goal the workspace defined.
    expect(matchesGoal(goal, ['https://shop.example/checkout'], NOTHING_HAPPENED)).toBe(false);
    expect(matchesGoal(goal, [], { ...NOTHING_HAPPENED, saleCompleted: true })).toBe(false);
  });

  it('requires all three funnel predicates when all three are set', () => {
    const goal = { sale_completed: true, lead_captured: true, chat_resolved: true };
    expect(
      matchesGoal(goal, [], { saleCompleted: true, leadCaptured: true, chatResolved: true }),
    ).toBe(true);
    expect(
      matchesGoal(goal, [], { saleCompleted: true, leadCaptured: true, chatResolved: false }),
    ).toBe(false);
  });

  it('ignores a predicate explicitly switched off', () => {
    // `false` is how a form sends an unticked box. It must mean "do not require
    // it", not "require that it did not happen" — a goal cannot be defined by
    // an absence.
    expect(
      matchesGoal({ url_contains: '/thank-you', sale_completed: false }, [
        'https://shop.example/thank-you',
      ]),
    ).toBe(true);
    // And a definition made only of switched-off predicates still matches
    // nobody, however much is known about the visitor.
    expect(
      matchesGoal({ sale_completed: false, lead_captured: false }, [], {
        saleCompleted: true,
        leadCaptured: true,
      }),
    ).toBe(false);
  });

  it('treats a hand-edited funnel predicate as unreachable rather than throwing', () => {
    // Same contract the url predicate already had: one unreadable row must not
    // throw, because `evaluate` runs every active goal over the same visitor.
    const facts = { saleCompleted: true, leadCaptured: true, chatResolved: true };
    expect(() => matchesGoal({ sale_completed: 'true' }, [], facts)).not.toThrow();
    expect(matchesGoal({ sale_completed: 'true' }, [], facts)).toBe(false);
    expect(matchesGoal({ chat_resolved: null }, [], facts)).toBe(false);
  });
});
