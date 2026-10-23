/**
 * The Archive search's request and snippet helpers (ID-07 · tm 333.4).
 */
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { zonedDayBoundary } from '../../lib/format.js';
import {
  archiveSearchReason,
  archiveSearchUrl,
  checkArchiveSearch,
  splitSnippet,
} from './archive-search.js';

const asked = { query: 'papara 5000', dateFrom: '', dateTo: '' };

describe('archiveSearchUrl', () => {
  it('asks for the search alone — no view, sort or filter the server would refuse', () => {
    const params = new URLSearchParams(archiveSearchUrl(asked, undefined).split('?')[1]);
    expect([...params.keys()].sort()).toEqual(['limit', 'query']);
    expect(params.get('query')).toBe('papara 5000');
  });

  it('carries the cursor and encodes the words', () => {
    const url = archiveSearchUrl({ ...asked, query: 'çağrı & %' }, 'abc 1');
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('query')).toBe('çağrı & %');
    expect(params.get('page_id')).toBe('abc 1');
  });

  it("cuts the days on the viewer's calendar and ends after the last picked day", () => {
    const params = new URLSearchParams(
      archiveSearchUrl({ ...asked, dateFrom: '2026-09-01', dateTo: '2026-09-30' }, undefined).split(
        '?',
      )[1],
    );
    expect(params.get('date_from')).toBe(zonedDayBoundary('2026-09-01', 'start'));
    expect(params.get('date_to')).toBe(
      new Date(Date.parse(zonedDayBoundary('2026-09-30', 'end')) + 1).toISOString(),
    );
    // Exactly one day later than the start of the last picked day.
    expect(
      Date.parse(params.get('date_to')!) - Date.parse(zonedDayBoundary('2026-09-30', 'start')),
    ).toBe(24 * 3600 * 1000);
  });
});

describe('checkArchiveSearch', () => {
  it('passes a query the server would accept', () => {
    expect(checkArchiveSearch(asked)).toBeNull();
  });

  it.each([
    ['ab', 'too_short'],
    ['12 34', 'no_trigram'],
    ['a1 b2 c3 d4 e5 f6 g7 h8 papara', 'too_many_words'],
    ['x'.repeat(1001), 'too_long'],
  ])('refuses %j as %s', (query, reason) => {
    expect(checkArchiveSearch({ ...asked, query })).toBe(reason);
  });

  it('refuses a start day after the end day, and accepts the same day', () => {
    expect(checkArchiveSearch({ ...asked, dateFrom: '2026-09-30', dateTo: '2026-09-01' })).toBe(
      'range_order',
    );
    expect(
      checkArchiveSearch({ ...asked, dateFrom: '2026-09-01', dateTo: '2026-09-01' }),
    ).toBeNull();
    expect(checkArchiveSearch({ ...asked, dateFrom: '2026-09-30' })).toBeNull();
  });
});

describe('archiveSearchReason', () => {
  const failure = (reason: unknown): ApiClientError =>
    new ApiClientError({
      type: 'validation',
      status: 400,
      message: 'x',
      requestId: 'r',
      details: { reason },
    });

  it('reads the reasons this build has wording for, and only those', () => {
    expect(archiveSearchReason(failure('too_broad'))).toBe('too_broad');
    expect(archiveSearchReason(failure('range_too_long'))).toBe('range_too_long');
    expect(archiveSearchReason(failure('invalid_page'))).toBeNull();
    expect(archiveSearchReason(failure(7))).toBeNull();
    expect(archiveSearchReason(new Error('offline'))).toBeNull();
  });
});

describe('splitSnippet', () => {
  it('cuts a snippet into plain and marked stretches', () => {
    expect(
      splitSnippet('Papara ile 5000 TL', [
        { start: 0, end: 6 },
        { start: 11, end: 15 },
      ]),
    ).toEqual([
      { text: 'Papara', marked: true },
      { text: ' ile ', marked: false },
      { text: '5000', marked: true },
      { text: ' TL', marked: false },
    ]);
  });

  it('shows a snippet with no ranges whole, and an empty one as nothing', () => {
    expect(splitSnippet('merhaba', [])).toEqual([{ text: 'merhaba', marked: false }]);
    expect(splitSnippet('', [])).toEqual([]);
  });

  it('reads UTF-16 offsets, so a letter beyond the BMP before the match does not shift it', () => {
    // "😀" is two UTF-16 units: the server's offsets count them as two.
    expect(splitSnippet('😀 papara', [{ start: 3, end: 9 }])).toEqual([
      { text: '😀 ', marked: false },
      { text: 'papara', marked: true },
    ]);
  });

  it('drops a range that is out of order, empty or outside the text rather than trusting it', () => {
    expect(
      splitSnippet('abcdef', [
        { start: 2, end: 4 },
        { start: 1, end: 3 },
        { start: 4, end: 4 },
        { start: 5, end: 99 },
      ]),
    ).toEqual([
      { text: 'ab', marked: false },
      { text: 'cd', marked: true },
      { text: 'ef', marked: false },
    ]);
  });
});
