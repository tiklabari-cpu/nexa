import { describe, expect, it } from 'vitest';
import { DEFAULT_DAY_BOUNDARY } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { filterSql, needsDayBoundary, startedRange } from './archive-filters.js';

const reasonOf = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).details?.['reason'];
  }
  throw new Error('expected a refusal');
};

describe('startedRange (AR-02)', () => {
  it('turns workspace days into [first instant, first instant of the day after)', () => {
    const range = startedRange(
      { dateFrom: '2026-10-20', dateTo: '2026-10-21' },
      DEFAULT_DAY_BOUNDARY,
    );
    // Istanbul is UTC+3: the 20th starts at 21:00 UTC on the 19th.
    expect(range.from?.toISOString()).toBe('2026-10-19T21:00:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-10-21T21:00:00.000Z');
  });

  it('moves with the workspace’s start hour and zone', () => {
    const range = startedRange(
      { dateFrom: '2026-10-20', dateTo: '2026-10-20' },
      { timezone: 'UTC', hour: 6 },
    );
    expect(range.from?.toISOString()).toBe('2026-10-20T06:00:00.000Z');
    expect(range.to?.toISOString()).toBe('2026-10-21T06:00:00.000Z');
  });

  it('takes exact instants as given, and leaves an end open when it is not asked for', () => {
    const from = new Date('2026-10-20T10:00:00Z');
    expect(startedRange({ from }, DEFAULT_DAY_BOUNDARY)).toEqual({ from });
    expect(startedRange({}, DEFAULT_DAY_BOUNDARY)).toEqual({});
    expect(startedRange({ dateTo: '2026-10-20' }, DEFAULT_DAY_BOUNDARY)).toEqual({
      to: new Date('2026-10-20T21:00:00.000Z'),
    });
  });

  it('refuses the two forms mixed, and a range that ends before it begins', () => {
    expect(
      reasonOf(() =>
        startedRange({ dateFrom: '2026-10-20', to: new Date() }, DEFAULT_DAY_BOUNDARY),
      ),
    ).toBe('date_mixed');
    expect(
      reasonOf(() =>
        startedRange({ dateFrom: '2026-10-21', dateTo: '2026-10-20' }, DEFAULT_DAY_BOUNDARY),
      ),
    ).toBe('range_order');
    const at = new Date('2026-10-20T10:00:00Z');
    expect(reasonOf(() => startedRange({ from: at, to: at }, DEFAULT_DAY_BOUNDARY))).toBe(
      'range_order',
    );
    // One day, both ends the same, is a whole day — not an empty range.
    expect(() =>
      startedRange({ dateFrom: '2026-10-20', dateTo: '2026-10-20' }, DEFAULT_DAY_BOUNDARY),
    ).not.toThrow();
  });

  it('reads the day boundary only for day filters', () => {
    expect(needsDayBoundary({ dateFrom: '2026-10-20' })).toBe(true);
    expect(needsDayBoundary({ from: new Date() })).toBe(false);
    expect(needsDayBoundary({ tags: ['x'] })).toBe(false);
  });
});

describe('filterSql (AR-02)', () => {
  it('adds nothing when nothing is asked, and one condition per filter otherwise', () => {
    expect(filterSql(1n, {}, {})).toEqual([]);
    const conditions = filterSql(
      1n,
      {
        agentIds: ['6B51E951-EB38-4081-B448-C03C57DF3DA7'],
        groupIds: [3n],
        rating: 'good',
        tags: ['a', 'a'],
        tagMode: 'all',
        untagged: false,
        handledBy: ['ai'],
        riskFlags: ['abusive'],
        channel: 'whatsapp',
      },
      { from: new Date(0), to: new Date(1) },
    );
    expect(conditions).toHaveLength(10);
    // Ids compare lower-case; a tag named twice is one tag to have.
    expect(conditions[3]!.values).toContainEqual(['6b51e951-eb38-4081-b448-c03c57df3da7']);
    expect(conditions[6]!.values).toEqual(['a']);
    // `all`: one probe per distinct tag.
    expect(filterSql(1n, { tags: ['a', 'b', 'A'], tagMode: 'all' }, {})).toHaveLength(2);
    // A closed list states the implied close bound; an open-inclusive one cannot.
    expect(filterSql(1n, {}, { from: new Date(0) }, 'closed')).toHaveLength(2);
    expect(filterSql(1n, {}, { from: new Date(0) }, 'all')).toHaveLength(1);
  });
});
