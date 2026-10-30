import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_RULE_FIELDS,
  campaignRuleOps,
  campaignRuleProblem,
  legacyUrlContains,
  normalizeCampaignConditions,
  type CampaignRule,
} from './campaign-conditions.js';

describe('normalizeCampaignConditions (EN-03)', () => {
  it('reads the first shape as one current_url contains rule, trimmed (FR-MOD-03.3.2)', () => {
    expect(normalizeCampaignConditions({ url_contains: ' /deposit ' })).toEqual({
      match: 'all',
      rules: [{ field: 'current_url', op: 'contains', value: '/deposit' }],
    });
  });

  it('prefers rules over url_contains, and keeps match', () => {
    const rule: CampaignRule = { field: 'country', op: 'equals', value: 'TR' };
    expect(
      normalizeCampaignConditions({ match: 'any', rules: [rule], url_contains: '/x' }),
    ).toEqual({ match: 'any', rules: [rule] });
  });

  it('is empty for nothing usable, and drops malformed entries rather than throwing', () => {
    expect(normalizeCampaignConditions(null).rules).toEqual([]);
    expect(normalizeCampaignConditions({ url_contains: '   ' }).rules).toEqual([]);
    expect(normalizeCampaignConditions({ rules: [null, 5, { field: 'country' }] }).rules).toEqual(
      [],
    );
    expect(normalizeCampaignConditions({ match: 'some', rules: [] }).match).toBe('all');
  });
});

describe('campaignRuleProblem (EN-03)', () => {
  it('accepts one well-formed rule of every field', () => {
    const rules: CampaignRule[] = [
      { field: 'current_url', op: 'contains', value: '/deposit' },
      { field: 'session_url', op: 'not_equals', value: 'https://x.test/a' },
      { field: 'referrer', op: 'contains', value: 'google' },
      { field: 'country', op: 'equals', value: 'tr' },
      { field: 'visitor_type', op: 'not_equals', value: 'returning' },
      { field: 'time_on_page', op: 'gte', value: 30 },
      { field: 'exit_intent', op: 'equals', value: true },
      { field: 'custom_var', op: 'gt', value: '100', key: 'balance' },
    ];
    expect(rules.map((rule) => [rule.field, campaignRuleProblem(rule)])).toEqual(
      rules.map((rule) => [rule.field, null]),
    );
    expect(rules.map((rule) => rule.field).sort()).toEqual([...CAMPAIGN_RULE_FIELDS].sort());
  });

  it('refuses an operator the field does not take', () => {
    expect(campaignRuleProblem({ field: 'country', op: 'contains', value: 'TR' })).toMatch(
      /not an operator/,
    );
    expect(campaignRuleProblem({ field: 'time_on_page', op: 'lt', value: 5 })).toMatch(
      /not an operator/,
    );
    expect(campaignRuleOps('custom_var')).toHaveLength(8);
  });

  it('refuses a value of the wrong kind for its field', () => {
    expect(campaignRuleProblem({ field: 'current_url', op: 'contains', value: '  ' })).not.toBe(
      null,
    );
    expect(campaignRuleProblem({ field: 'country', op: 'equals', value: 'TUR' })).not.toBe(null);
    expect(campaignRuleProblem({ field: 'visitor_type', op: 'equals', value: 'vip' })).not.toBe(
      null,
    );
    expect(campaignRuleProblem({ field: 'time_on_page', op: 'gte', value: 0 })).not.toBe(null);
    expect(campaignRuleProblem({ field: 'time_on_page', op: 'gte', value: 3601 })).not.toBe(null);
    expect(campaignRuleProblem({ field: 'time_on_page', op: 'gte', value: 1.5 })).not.toBe(null);
    expect(campaignRuleProblem({ field: 'exit_intent', op: 'equals', value: false })).not.toBe(
      null,
    );
  });

  it('wants a key on custom_var only, and a number for its number comparisons', () => {
    expect(campaignRuleProblem({ field: 'custom_var', op: 'equals', value: 'gold' })).toMatch(
      /key/,
    );
    expect(
      campaignRuleProblem({ field: 'current_url', op: 'contains', value: '/x', key: 'k' }),
    ).toMatch(/no key/);
    expect(
      campaignRuleProblem({ field: 'custom_var', op: 'gte', value: 'gold', key: 'tier' }),
    ).toMatch(/number/);
    expect(
      campaignRuleProblem({ field: 'custom_var', op: 'equals', value: 'x'.repeat(101), key: 'k' }),
    ).toMatch(/too long/);
  });
});

describe('legacyUrlContains', () => {
  it('mirrors the first shape only while the rules say exactly that', () => {
    expect(legacyUrlContains(normalizeCampaignConditions({ url_contains: '/x' }))).toBe('/x');
    expect(
      legacyUrlContains({
        match: 'all',
        rules: [
          { field: 'current_url', op: 'contains', value: '/x' },
          { field: 'country', op: 'equals', value: 'TR' },
        ],
      }),
    ).toBeUndefined();
    expect(
      legacyUrlContains({
        match: 'all',
        rules: [{ field: 'current_url', op: 'equals', value: '/x' }],
      }),
    ).toBeUndefined();
  });
});
