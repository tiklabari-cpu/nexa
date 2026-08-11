import { describe, expect, it } from 'vitest';
import {
  TRAFFIC_FIELD_DEFS,
  availableFields,
  buildTrafficParams,
  conditionError,
  conditionsAreValid,
  conditionsFromSearchParams,
  newCondition,
  resolveActivity,
  type TrafficCondition,
} from './traffic-filters.js';

describe('TRAFFIC_FIELD_DEFS', () => {
  it("covers 13.2-f's six parameters, one definition each", () => {
    expect(TRAFFIC_FIELD_DEFS.map((def) => def.field)).toEqual([
      'activity',
      'page_url_contains',
      'came_from_contains',
      'country_code',
      'is_lead',
      'group_id',
    ]);
  });

  it('seeds a fresh row with a value that already passes its own validator', () => {
    for (const def of TRAFFIC_FIELD_DEFS) {
      const condition = newCondition(def.field);
      expect(condition.value).toBe(def.initialValue);
    }
  });
});

describe('availableFields', () => {
  it('offers every field when the list is empty', () => {
    expect(availableFields([]).map((def) => def.field)).toEqual(
      TRAFFIC_FIELD_DEFS.map((def) => def.field),
    );
  });

  it('drops a field once a condition already uses it', () => {
    const conditions: TrafficCondition[] = [{ field: 'country_code', value: 'US' }];
    const remaining = availableFields(conditions).map((def) => def.field);
    expect(remaining).not.toContain('country_code');
    expect(remaining).toHaveLength(TRAFFIC_FIELD_DEFS.length - 1);
  });

  it('offers nothing once every field is used', () => {
    const conditions = TRAFFIC_FIELD_DEFS.map((def) => newCondition(def.field));
    expect(availableFields(conditions)).toEqual([]);
  });
});

describe('conditionError', () => {
  it('accepts a well-formed value for every field', () => {
    expect(conditionError({ field: 'activity', value: 'chatting' })).toBeNull();
    expect(conditionError({ field: 'page_url_contains', value: '/pricing' })).toBeNull();
    expect(conditionError({ field: 'came_from_contains', value: 'google.com' })).toBeNull();
    expect(conditionError({ field: 'country_code', value: 'us' })).toBeNull();
    expect(conditionError({ field: 'is_lead', value: 'false' })).toBeNull();
    expect(conditionError({ field: 'group_id', value: '42' })).toBeNull();
  });

  it('rejects an empty value with a field-under message', () => {
    for (const def of TRAFFIC_FIELD_DEFS) {
      if (def.kind === 'select') continue; // a select is never truly empty
      expect(conditionError({ field: def.field, value: '' })).toBeTruthy();
      expect(conditionError({ field: def.field, value: '   ' })).toBeTruthy();
    }
  });

  it('rejects a country code that is not exactly two letters', () => {
    expect(conditionError({ field: 'country_code', value: 'USA' })).toBeTruthy();
    expect(conditionError({ field: 'country_code', value: '1' })).toBeTruthy();
  });

  it('rejects a non-numeric group id', () => {
    expect(conditionError({ field: 'group_id', value: 'abc' })).toBeTruthy();
    expect(conditionError({ field: 'group_id', value: '4.2' })).toBeTruthy();
  });

  it('rejects a page-url-contains value over the 2048-character budget', () => {
    expect(conditionError({ field: 'page_url_contains', value: 'a'.repeat(2049) })).toBeTruthy();
    expect(conditionError({ field: 'page_url_contains', value: 'a'.repeat(2048) })).toBeNull();
  });

  it('rejects an activity or lead value outside their enum', () => {
    expect(conditionError({ field: 'activity', value: 'bogus' })).toBeTruthy();
    expect(conditionError({ field: 'is_lead', value: 'maybe' })).toBeTruthy();
  });
});

describe('conditionsAreValid', () => {
  it('is true for an empty list', () => {
    expect(conditionsAreValid([])).toBe(true);
  });

  it('is false the moment one condition is invalid, regardless of the rest', () => {
    const conditions: TrafficCondition[] = [
      { field: 'country_code', value: 'US' },
      { field: 'group_id', value: '' },
    ];
    expect(conditionsAreValid(conditions)).toBe(false);
  });
});

describe('buildTrafficParams', () => {
  it('adds a condition → produces the matching query parameter', () => {
    const params = buildTrafficParams([{ field: 'country_code', value: 'us' }]);
    expect(params.toString()).toBe('country_code=US');
  });

  it('removing a condition drops its parameter', () => {
    const withCondition = buildTrafficParams([{ field: 'group_id', value: '7' }]);
    expect(withCondition.get('group_id')).toBe('7');

    const withoutCondition = buildTrafficParams([]);
    expect(withoutCondition.get('group_id')).toBeNull();
    expect(withoutCondition.toString()).toBe('');
  });

  it('two valid conditions are both sent together (Match all)', () => {
    const params = buildTrafficParams([
      { field: 'page_url_contains', value: '/pricing' },
      { field: 'is_lead', value: 'true' },
    ]);
    expect(params.get('page_url_contains')).toBe('/pricing');
    expect(params.get('is_lead')).toBe('true');
  });

  it('an empty or invalid value produces no parameter at all', () => {
    const params = buildTrafficParams([
      { field: 'country_code', value: '' },
      { field: 'group_id', value: 'not-a-number' },
    ]);
    expect(params.toString()).toBe('');
  });

  it('mixes valid and invalid conditions — only the valid one is sent', () => {
    const params = buildTrafficParams([
      { field: 'country_code', value: 'DE' },
      { field: 'page_url_contains', value: '' },
    ]);
    expect(params.toString()).toBe('country_code=DE');
  });
});

describe('resolveActivity', () => {
  it('falls back to the tab when the panel has no activity condition', () => {
    expect(resolveActivity(['chatting'], [])).toEqual(['chatting']);
    expect(resolveActivity(undefined, [{ field: 'country_code', value: 'US' }])).toBeUndefined();
  });

  it("the panel's own activity condition takes over from the tab", () => {
    const conditions: TrafficCondition[] = [{ field: 'activity', value: 'browsing' }];
    expect(resolveActivity(['chatting'], conditions)).toEqual(['browsing']);
    expect(resolveActivity(undefined, conditions)).toEqual(['browsing']);
  });

  it('an invalid activity condition is ignored — the tab still applies', () => {
    const conditions: TrafficCondition[] = [{ field: 'activity', value: 'bogus' }];
    expect(resolveActivity(['queued'], conditions)).toEqual(['queued']);
  });
});

describe('conditionsFromSearchParams', () => {
  it('reads back only the fields present, in catalogue order', () => {
    const searchParams = new URLSearchParams({ group_id: '3', country_code: 'US' });
    expect(conditionsFromSearchParams(searchParams)).toEqual([
      { field: 'country_code', value: 'US' },
      { field: 'group_id', value: '3' },
    ]);
  });

  it('returns an empty list when no known filter parameter is present', () => {
    const searchParams = new URLSearchParams({ tab: 'chatting', limit: '50' });
    expect(conditionsFromSearchParams(searchParams)).toEqual([]);
  });
});
