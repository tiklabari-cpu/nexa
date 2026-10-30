/**
 * The rule builder's logic (EN-03 · tm 352.2): drafts ⇄ the rules the API reads.
 */
import { describe, expect, it } from 'vitest';
import {
  blankRule,
  conditionsFromDrafts,
  draftProblem,
  draftsFromConditions,
  ruleFromDraft,
  withField,
} from './campaign-rules.js';

describe('draftsFromConditions', () => {
  it('reads the first shape as one current-URL rule', () => {
    const { match, drafts } = draftsFromConditions({ url_contains: '/pricing' });
    expect(match).toBe('all');
    expect(conditionsFromDrafts(match, drafts).rules).toEqual([
      { field: 'current_url', op: 'contains', value: '/pricing' },
    ]);
  });

  it('gives a brand-new campaign one blank row', () => {
    expect(draftsFromConditions(undefined).drafts).toHaveLength(1);
  });

  it('keeps match and every rule, with the variable name', () => {
    const rules = [
      { field: 'custom_var' as const, op: 'gt' as const, value: 3, key: 'cart' },
      { field: 'exit_intent' as const, op: 'equals' as const, value: true },
    ];
    const { match, drafts } = draftsFromConditions({ match: 'any', rules });
    expect(match).toBe('any');
    expect(drafts[0]).toMatchObject({ key: 'cart', value: '3' });
    expect(conditionsFromDrafts(match, drafts).rules[1]).toEqual(rules[1]);
  });
});

describe('ruleFromDraft', () => {
  it('turns typed text into the value each field wants', () => {
    expect(ruleFromDraft({ ...withField(blankRule(1), 'time_on_page'), value: ' 30 ' })).toEqual({
      field: 'time_on_page',
      op: 'gte',
      value: 30,
    });
    expect(ruleFromDraft({ ...withField(blankRule(1), 'country'), value: 'tr' }).value).toBe('TR');
    expect(ruleFromDraft(withField(blankRule(1), 'exit_intent'))).toEqual({
      field: 'exit_intent',
      op: 'equals',
      value: true,
    });
    expect(ruleFromDraft(withField(blankRule(1), 'visitor_type')).value).toBe('new');
  });

  it('sends a key only for a session variable', () => {
    expect('key' in ruleFromDraft({ ...blankRule(1), key: 'leftover', value: '/a' })).toBe(false);
  });
});

describe('draftProblem', () => {
  it('names what stops a row from saving', () => {
    expect(draftProblem(blankRule(1))).toBe('value');
    expect(draftProblem({ ...blankRule(1), value: '/a' })).toBeNull();
    const seconds = withField(blankRule(1), 'time_on_page');
    expect(draftProblem({ ...seconds, value: '0' })).toBe('seconds');
    expect(draftProblem({ ...seconds, value: '1.5' })).toBe('seconds');
    expect(draftProblem({ ...seconds, value: '3600' })).toBeNull();
    const country = withField(blankRule(1), 'country');
    expect(draftProblem({ ...country, value: 'TUR' })).toBe('country');
    expect(draftProblem({ ...country, value: 'tr' })).toBeNull();
    const variable = withField(blankRule(1), 'custom_var');
    expect(draftProblem({ ...variable, value: 'x' })).toBe('key');
    expect(draftProblem({ ...variable, key: 'plan', op: 'gt', value: 'many' })).toBe('number');
    expect(draftProblem({ ...variable, key: 'plan', op: 'gt', value: '5' })).toBeNull();
    expect(draftProblem(withField(blankRule(1), 'exit_intent'))).toBeNull();
  });

  it('switching the field resets the operator and value to ones the field accepts', () => {
    const switched = withField({ ...blankRule(1), value: '/a' }, 'country');
    expect(switched).toMatchObject({ field: 'country', op: 'equals', value: '' });
  });
});
