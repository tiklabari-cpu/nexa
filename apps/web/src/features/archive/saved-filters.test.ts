/**
 * Saved Archive filters (AR-02-S3 · tm 336.2): personal, kept in this browser per
 * account, without the dates, and nothing but ids and enum words.
 */
import { describe, expect, it } from 'vitest';
import { NO_FILTERS, readFilters, type ArchiveFilters } from './archive-filters.js';
import {
  SAVED_ARCHIVE_FILTER_MAX,
  applySaved,
  loadSavedArchiveFilters,
  persistSavedArchiveFilters,
  saveBlocked,
  withoutDates,
  type SavedArchiveFilter,
} from './saved-filters.js';

const T1 = '33333333-3333-4333-8333-333333333333';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

function entry(name: string, query: string): SavedArchiveFilter {
  return { id: `sf_${name}`, name, query };
}

const BAD_FINANCE: ArchiveFilters = {
  ...NO_FILTERS,
  dateFrom: '2026-10-01',
  dateTo: '2026-10-20',
  rating: 'bad',
  groupIds: [3],
};

describe('a saved filter', () => {
  it('keeps everything but the dates', () => {
    expect(withoutDates(BAD_FINANCE)).toEqual({
      ...NO_FILTERS,
      rating: 'bad',
      groupIds: [3],
    });
  });

  it('applies over the filters on screen: its choices, the screen’s dates', () => {
    const current: ArchiveFilters = {
      ...NO_FILTERS,
      dateFrom: '2026-10-22',
      dateTo: '2026-10-22',
      channel: 'telegram',
    };
    const applied = applySaved(entry('Bad, Finance', 'rating=bad&group_id=3'), current);
    expect(applied).toEqual({
      ...NO_FILTERS,
      dateFrom: '2026-10-22',
      dateTo: '2026-10-22',
      rating: 'bad',
      groupIds: [3],
    });
  });
});

describe('the store', () => {
  it('is per account', () => {
    const storage = memory();
    persistSavedArchiveFilters('acct-1', [entry('One', 'rating=bad')], storage);
    expect(loadSavedArchiveFilters('acct-1', storage)).toHaveLength(1);
    expect(loadSavedArchiveFilters('acct-2', storage)).toEqual([]);
    expect(loadSavedArchiveFilters(null, storage)).toEqual([]);
  });

  it('drops malformed rows and anything that is not a filter from the stored query', () => {
    const storage = memory({
      'siyahtus.archive.saved-filters.acct-1': JSON.stringify([
        entry(
          'Good',
          `rating=bad&tag=${T1}&date_from=2026-10-01&c=SECRET&agent_id=ada@example.com`,
        ),
        { id: 5, name: 'broken', query: 'x' },
        'nope',
      ]),
    });
    const loaded = loadSavedArchiveFilters('acct-1', storage);
    expect(loaded).toHaveLength(1);
    // Dates, the screen's own keys and values that are not ids are all gone.
    expect(loaded[0]!.query).toBe(`rating=bad&tag=${T1}`);
    expect(readFilters(new URLSearchParams(loaded[0]!.query)).agentIds).toEqual([]);
  });

  it('survives unreadable storage', () => {
    expect(
      loadSavedArchiveFilters('a', memory({ 'siyahtus.archive.saved-filters.a': '{' })),
    ).toEqual([]);
    expect(
      loadSavedArchiveFilters('a', {
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual([]);
  });
});

describe('what may be saved', () => {
  const some = { ...NO_FILTERS, rating: 'bad' } as ArchiveFilters;

  it('needs a name and a filter other than the dates', () => {
    expect(saveBlocked([], 'Bad ratings', some)).toBeNull();
    expect(saveBlocked([], '   ', some)).toBe('name');
    expect(saveBlocked([], 'x'.repeat(41), some)).toBe('name');
    expect(saveBlocked([], 'Only dates', { ...NO_FILTERS, dateFrom: '2026-10-01' })).toBe('empty');
    expect(saveBlocked([], 'Nothing', NO_FILTERS)).toBe('empty');
  });

  it('refuses a repeated name (any case) and a full list', () => {
    expect(saveBlocked([entry('Bad ratings', 'rating=bad')], 'bad RATINGS', some)).toBe(
      'duplicate',
    );
    const full = Array.from({ length: SAVED_ARCHIVE_FILTER_MAX }, (_, i) =>
      entry(`n${i}`, 'rating=bad'),
    );
    expect(saveBlocked(full, 'One more', some)).toBe('full');
  });
});
