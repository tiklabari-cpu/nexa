import { describe, expect, it } from 'vitest';
import {
  hasRuleBotAction,
  hasRuleBotCondition,
  matchesRuleBot,
  type RuleBotContext,
} from './rule-bot-matching.js';

function ctx(over: Partial<RuleBotContext> = {}): RuleBotContext {
  return {
    message: 'Can I cancel my order?',
    pageUrl: 'https://shop.example.com/checkout',
    withinBusinessHours: true,
    ...over,
  };
}

describe('hasRuleBotCondition (FR-MOD-06.6)', () => {
  // Negatives first: the whole safety of this engine rests on an empty
  // predicate matching NOBODY rather than everybody.
  it('is false for a predicate with nothing to match on', () => {
    expect(hasRuleBotCondition({})).toBe(false);
    expect(hasRuleBotCondition({ message_contains: '   ' })).toBe(false);
    expect(hasRuleBotCondition({ message_equals: '' })).toBe(false);
    expect(hasRuleBotCondition({ message_word: '\t' })).toBe(false);
    expect(hasRuleBotCondition({ page_url_contains: ' ' })).toBe(false);
  });

  it('is true once any condition carries something', () => {
    expect(hasRuleBotCondition({ message_contains: 'cancel' })).toBe(true);
    expect(hasRuleBotCondition({ message_equals: 'hi' })).toBe(true);
    expect(hasRuleBotCondition({ message_word: 'cancel' })).toBe(true);
    expect(hasRuleBotCondition({ page_url_contains: '/pricing' })).toBe(true);
    expect(hasRuleBotCondition({ office_hours: 'closed' })).toBe(true);
  });
});

describe('hasRuleBotAction (FR-MOD-06.6)', () => {
  it('is false for a rule that would do nothing', () => {
    expect(hasRuleBotAction({})).toBe(false);
    expect(hasRuleBotAction({ send_message: '   ' })).toBe(false);
    expect(hasRuleBotAction({ add_tag: '' })).toBe(false);
  });

  it('counts team 0 as a real transfer target', () => {
    // Group ids are per-licence integers and may legitimately be 0; a falsy
    // check would drop the action and wrongly reject the rule.
    expect(hasRuleBotAction({ transfer_to_group_id: 0 })).toBe(true);
  });

  it('is true for each action on its own', () => {
    expect(hasRuleBotAction({ send_message: 'We are closed.' })).toBe(true);
    expect(hasRuleBotAction({ add_tag: 'billing' })).toBe(true);
    expect(hasRuleBotAction({ transfer_to_group_id: 3 })).toBe(true);
  });
});

describe('matchesRuleBot — an empty predicate (FR-MOD-06.6)', () => {
  it('matches nobody rather than everybody', () => {
    expect(matchesRuleBot({}, ctx())).toBe(false);
    // Whitespace-only is the same thing arriving through a different door: a
    // row written around the service must not become a catch-all.
    expect(matchesRuleBot({ message_contains: '  ' }, ctx())).toBe(false);
  });
});

describe('matchesRuleBot — text (FR-MOD-06.6)', () => {
  it('matches a case-insensitive substring', () => {
    expect(matchesRuleBot({ message_contains: 'cancel' }, ctx())).toBe(true);
    expect(matchesRuleBot({ message_contains: 'CANCEL' }, ctx())).toBe(true);
    expect(matchesRuleBot({ message_contains: 'refund' }, ctx())).toBe(false);
  });

  it('compares the whole trimmed message for `message_equals`', () => {
    expect(matchesRuleBot({ message_equals: 'hi' }, ctx({ message: '  Hi  ' }))).toBe(true);
    // The difference from `contains`, and the reason both exist: "hi" must not
    // fire on every message that happens to contain those two letters.
    expect(matchesRuleBot({ message_equals: 'hi' }, ctx({ message: 'this is a test' }))).toBe(
      false,
    );
  });

  it('matches whole words only for `message_word`', () => {
    expect(matchesRuleBot({ message_word: 'cancel' }, ctx())).toBe(true);
    // The case `contains` gets wrong, which is the whole reason for this
    // predicate.
    expect(
      matchesRuleBot({ message_word: 'cancel' }, ctx({ message: 'read the cancellation policy' })),
    ).toBe(false);
    expect(
      matchesRuleBot({ message_contains: 'cancel' }, ctx({ message: 'cancellation policy' })),
    ).toBe(true);
  });

  it('treats punctuation and line breaks as word boundaries', () => {
    expect(matchesRuleBot({ message_word: 'cancel' }, ctx({ message: '"cancel", please' }))).toBe(
      true,
    );
    expect(matchesRuleBot({ message_word: 'cancel' }, ctx({ message: 'please\ncancel' }))).toBe(
      true,
    );
    // A digit is a word character, so a version-like token is not a word match.
    expect(matchesRuleBot({ message_word: 'v1' }, ctx({ message: 'upgrade to v12' }))).toBe(false);
  });

  it('finds a later whole-word occurrence after an earlier partial one', () => {
    // The scan must not stop at the first substring hit: "cancellation" comes
    // first and is not a word match, "cancel" after it is.
    expect(
      matchesRuleBot(
        { message_word: 'cancel' },
        ctx({ message: 'cancellation? i want to cancel' }),
      ),
    ).toBe(true);
  });

  it('treats a needle with pattern metacharacters as literal text', () => {
    // No caller-supplied value is ever compiled as a regular expression, so
    // `.*` is a two-character word and matches only itself.
    expect(matchesRuleBot({ message_word: '.*' }, ctx({ message: 'anything at all' }))).toBe(false);
    expect(matchesRuleBot({ message_contains: 'c.ncel' }, ctx())).toBe(false);
  });
});

describe('matchesRuleBot — page (FR-MOD-06.6)', () => {
  it('matches a case-insensitive fragment of the page URL', () => {
    expect(matchesRuleBot({ page_url_contains: '/checkout' }, ctx())).toBe(true);
    expect(matchesRuleBot({ page_url_contains: '/pricing' }, ctx())).toBe(false);
  });

  it('never matches a message that arrived without a page', () => {
    // Treating "no URL" as a match would make a page-scoped rule the widest
    // rule in the bot — the opposite of what its author asked for.
    expect(matchesRuleBot({ page_url_contains: '/checkout' }, ctx({ pageUrl: null }))).toBe(false);
  });
});

describe('matchesRuleBot — business hours (FR-MOD-06.6)', () => {
  it('fires on the side of the calendar it names', () => {
    expect(matchesRuleBot({ office_hours: 'open' }, ctx({ withinBusinessHours: true }))).toBe(true);
    expect(matchesRuleBot({ office_hours: 'closed' }, ctx({ withinBusinessHours: true }))).toBe(
      false,
    );
    expect(matchesRuleBot({ office_hours: 'closed' }, ctx({ withinBusinessHours: false }))).toBe(
      true,
    );
    expect(matchesRuleBot({ office_hours: 'open' }, ctx({ withinBusinessHours: false }))).toBe(
      false,
    );
  });

  it('fires on neither side when the calendar was not consulted', () => {
    // Fail closed: a rule that asks a question nobody answered does not act.
    expect(matchesRuleBot({ office_hours: 'open' }, ctx({ withinBusinessHours: null }))).toBe(
      false,
    );
    expect(matchesRuleBot({ office_hours: 'closed' }, ctx({ withinBusinessHours: null }))).toBe(
      false,
    );
  });
});

describe('matchesRuleBot — several conditions (FR-MOD-06.6)', () => {
  it('requires every condition that is set (AND, not OR)', () => {
    const conditions = { message_word: 'cancel', page_url_contains: '/checkout' };
    expect(matchesRuleBot(conditions, ctx())).toBe(true);
    // One half right is not a match.
    expect(matchesRuleBot(conditions, ctx({ pageUrl: 'https://shop.example.com/blog' }))).toBe(
      false,
    );
    expect(matchesRuleBot(conditions, ctx({ message: 'where is my order?' }))).toBe(false);
  });

  it('applies the office-hours condition alongside a text one', () => {
    const conditions = { message_contains: 'cancel', office_hours: 'closed' as const };
    expect(matchesRuleBot(conditions, ctx({ withinBusinessHours: false }))).toBe(true);
    expect(matchesRuleBot(conditions, ctx({ withinBusinessHours: true }))).toBe(false);
  });
});
