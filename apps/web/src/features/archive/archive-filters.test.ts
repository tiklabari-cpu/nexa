/**
 * The Archive's filters and their address (AR-02 · tm 336.2).
 *
 * What is pinned: the address holds ids and enum words and nothing a person could
 * be identified by (GV-05); reading is forgiving and writing canonical, so a link
 * round-trips; filters that cannot all hold are named, not repaired; and a date
 * range steps through the workspace's own calendar and stops at today.
 */
import { describe, expect, it } from 'vitest';
import {
  DATE_PRESETS,
  NO_FILTERS,
  agentFilterIsSelfOnly,
  filterParams,
  findConflicts,
  isFiltered,
  matchPreset,
  presetRange,
  readFilters,
  shiftRange,
  todayKey,
  writeFilters,
  type ArchiveFilters,
} from './archive-filters.js';

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const T1 = '33333333-3333-4333-8333-333333333333';

function filters(patch: Partial<ArchiveFilters>): ArchiveFilters {
  return { ...NO_FILTERS, ...patch };
}

function read(query: string): ArchiveFilters {
  return readFilters(new URLSearchParams(query));
}

describe('reading the address', () => {
  it('reads every filter the API takes', () => {
    const query = [
      'date_from=2026-10-01',
      'date_to=2026-10-20',
      `agent_id=${A1}`,
      `agent_id=${A2}`,
      'group_id=3',
      'group_id=12',
      'rating=bad_commented',
      `tag=${T1}`,
      'tag_mode=exclude',
      'untagged=true',
      'handled_by=human',
      'handled_by=ai',
      'risk_flag=self_harm',
      'risk_flag=rg_signal',
      'channel=whatsapp',
    ].join('&');
    expect(read(query)).toEqual({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-20',
      agentIds: [A1, A2],
      groupIds: [3, 12],
      rating: 'bad_commented',
      tagIds: [T1],
      tagMode: 'exclude',
      untagged: true,
      // In the vocabulary's order, whatever order the address used.
      handledBy: ['ai', 'human'],
      riskFlags: ['rg_signal', 'self_harm'],
      channel: 'whatsapp',
    });
  });

  it('is no filter at all for an address without filters', () => {
    expect(read('')).toEqual(NO_FILTERS);
    expect(read('c=T1&status=all&group=day')).toEqual(NO_FILTERS);
    expect(isFiltered(read(''))).toBe(false);
  });

  it('drops what it cannot understand rather than failing the screen', () => {
    const parsed = read(
      [
        'date_from=yesterday',
        'date_to=2026-02-30',
        'agent_id=ada@example.com',
        'agent_id=Ada Yilmaz',
        'group_id=-3',
        'group_id=abc',
        'rating=great',
        'tag=spam',
        'tag_mode=sometimes',
        'untagged=yes',
        'handled_by=robot',
        'risk_flag=nonsense',
        'channel=fax',
      ].join('&'),
    );
    expect(parsed).toEqual(NO_FILTERS);
  });

  it('keeps each id once and stops at the limits the API enforces', () => {
    const tags = Array.from(
      { length: 25 },
      (_, i) => `tag=00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ).join('&');
    expect(read(tags).tagIds).toHaveLength(20);
    expect(read(`agent_id=${A1}&agent_id=${A1}`).agentIds).toEqual([A1]);
    const teams = Array.from({ length: 60 }, (_, i) => `group_id=${i + 1}`).join('&');
    expect(read(teams).groupIds).toHaveLength(50);
  });
});

describe('writing the address', () => {
  it('leaves no trace of a default and spells arrays as repeated keys', () => {
    expect(filterParams(NO_FILTERS).toString()).toBe('');
    expect(filterParams(filters({ tagMode: 'any' })).toString()).toBe('');
    expect(filterParams(filters({ agentIds: [A1, A2], groupIds: [3] })).toString()).toBe(
      `agent_id=${A1}&agent_id=${A2}&group_id=3`,
    );
  });

  it('round-trips: the address a filter writes reads back as the same filter', () => {
    const full = filters({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-20',
      agentIds: [A1],
      groupIds: [3, 4],
      rating: 'good_commented',
      tagIds: [T1],
      tagMode: 'all',
      untagged: false,
      handledBy: ['ai', 'mixed'],
      riskFlags: ['fraud_suspected'],
      channel: 'telegram',
    });
    expect(read(filterParams(full).toString())).toEqual(full);
  });

  it('replaces the filters and keeps the screen’s other keys', () => {
    const before = new URLSearchParams(`c=T1&status=all&group=day&rating=bad&agent_id=${A1}`);
    const after = writeFilters(before, filters({ groupIds: [7] }));
    expect(after.get('c')).toBe('T1');
    expect(after.get('status')).toBe('all');
    expect(after.get('group')).toBe('day');
    expect(after.has('rating')).toBe(false);
    expect(after.has('agent_id')).toBe(false);
    expect(after.getAll('group_id')).toEqual(['7']);
    // Clearing every filter leaves only the screen’s own state.
    expect(writeFilters(after, NO_FILTERS).toString()).toBe('c=T1&status=all&group=day');
  });

  it('puts ids and enum words in the address and nothing a person could be identified by', () => {
    const everything = filters({
      dateFrom: '2026-10-01',
      dateTo: '2026-10-20',
      agentIds: [A1, A2],
      groupIds: [3],
      rating: 'bad',
      tagIds: [T1],
      tagMode: 'exclude',
      untagged: true,
      handledBy: ['ai', 'human', 'mixed'],
      riskFlags: ['rg_signal'],
      channel: 'whatsapp',
    });
    const address = writeFilters(new URLSearchParams(), everything);
    const allowed =
      /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|\d{4}-\d{2}-\d{2}|[a-z_]+|true)$/;
    for (const [key, value] of address) {
      expect(value, key).toMatch(allowed);
      expect(value, key).not.toContain('@');
    }
    expect(address.toString()).not.toMatch(/@|%40|name|mail/i);
  });
});

describe('filters that cannot all hold', () => {
  it('names "untagged" with tags that must match, but not with an exclusion', () => {
    expect(findConflicts(filters({ untagged: true, tagIds: [T1] }))).toEqual([
      'untagged_with_tags',
    ]);
    expect(findConflicts(filters({ untagged: true, tagIds: [T1], tagMode: 'all' }))).toEqual([
      'untagged_with_tags',
    ]);
    expect(findConflicts(filters({ untagged: true, tagIds: [T1], tagMode: 'exclude' }))).toEqual(
      [],
    );
    expect(findConflicts(filters({ untagged: true }))).toEqual([]);
    expect(findConflicts(filters({ tagIds: [T1] }))).toEqual([]);
  });

  it('names an agent together with "AI solved", which no agent wrote in', () => {
    expect(findConflicts(filters({ agentIds: [A1], handledBy: ['ai'] }))).toEqual([
      'ai_with_agent',
    ]);
    expect(findConflicts(filters({ agentIds: [A1], handledBy: ['ai', 'human'] }))).toEqual([]);
    expect(findConflicts(filters({ agentIds: [A1], handledBy: ['mixed'] }))).toEqual([]);
    expect(findConflicts(filters({ handledBy: ['ai'] }))).toEqual([]);
  });

  it('names dates that run backwards, and no other order', () => {
    expect(findConflicts(filters({ dateFrom: '2026-10-20', dateTo: '2026-10-10' }))).toEqual([
      'date_order',
    ]);
    expect(findConflicts(filters({ dateFrom: '2026-10-10', dateTo: '2026-10-10' }))).toEqual([]);
    expect(findConflicts(filters({ dateFrom: '2026-10-20' }))).toEqual([]);
  });

  it('reports every clash at once and repairs none', () => {
    const clashing = filters({
      untagged: true,
      tagIds: [T1],
      agentIds: [A1],
      handledBy: ['ai'],
      dateFrom: '2026-10-20',
      dateTo: '2026-10-10',
    });
    expect(findConflicts(clashing)).toEqual(['untagged_with_tags', 'ai_with_agent', 'date_order']);
    // The address still carries all of them.
    expect(read(filterParams(clashing).toString())).toEqual(clashing);
  });
});

describe('who may pick other agents', () => {
  it('offers only "me" below Team Lead', () => {
    expect(agentFilterIsSelfOnly('agent')).toBe(true);
    expect(agentFilterIsSelfOnly(undefined)).toBe(true);
    expect(agentFilterIsSelfOnly('team_lead')).toBe(false);
    expect(agentFilterIsSelfOnly('admin')).toBe(false);
    expect(agentFilterIsSelfOnly('viceowner')).toBe(false);
    expect(agentFilterIsSelfOnly('owner')).toBe(false);
  });
});

describe('the day it is', () => {
  const istanbul = { timezone: 'Europe/Istanbul', hour: 0 };

  it('is the workspace’s day, not UTC’s: 00:30 in Istanbul is already tomorrow', () => {
    expect(todayKey(istanbul, new Date('2026-10-22T20:30:00Z'))).toBe('2026-10-22'); // 23:30
    expect(todayKey(istanbul, new Date('2026-10-22T21:30:00Z'))).toBe('2026-10-23'); // 00:30
  });

  it('honours the hour the workspace’s day starts at', () => {
    const night = { timezone: 'Europe/Istanbul', hour: 6 };
    expect(todayKey(night, new Date('2026-10-23T02:30:00Z'))).toBe('2026-10-22'); // 05:30
    expect(todayKey(night, new Date('2026-10-23T03:30:00Z'))).toBe('2026-10-23'); // 06:30
  });

  it('falls back to the shipped default for a zone the server would have refused', () => {
    expect(todayKey({ timezone: 'Mars/Olympus', hour: 0 }, new Date('2026-10-22T21:30:00Z'))).toBe(
      '2026-10-23',
    );
  });
});

describe('date presets', () => {
  const today = '2026-10-23';

  it('are counted back from the workspace’s today', () => {
    expect(presetRange('today', today)).toEqual({ dateFrom: today, dateTo: today });
    expect(presetRange('yesterday', today)).toEqual({
      dateFrom: '2026-10-22',
      dateTo: '2026-10-22',
    });
    expect(presetRange('last7', today)).toEqual({ dateFrom: '2026-10-17', dateTo: today });
    expect(presetRange('last30', today)).toEqual({ dateFrom: '2026-09-24', dateTo: today });
    expect(presetRange('thisMonth', today)).toEqual({ dateFrom: '2026-10-01', dateTo: today });
  });

  it('are recognised again from the dates alone', () => {
    for (const preset of DATE_PRESETS) {
      expect(matchPreset(filters(presetRange(preset, today)), today)).toBe(preset);
    }
    expect(
      matchPreset(filters({ dateFrom: '2026-10-02', dateTo: '2026-10-05' }), today),
    ).toBeNull();
    expect(matchPreset(NO_FILTERS, today)).toBeNull();
  });
});

describe('stepping the date range', () => {
  const today = '2026-10-23';

  it('moves a single day by one day, both ways', () => {
    const day = filters({ dateFrom: '2026-10-20', dateTo: '2026-10-20' });
    expect(shiftRange(day, 'earlier', today)).toEqual({
      dateFrom: '2026-10-19',
      dateTo: '2026-10-19',
    });
    expect(shiftRange(day, 'later', today)).toEqual({
      dateFrom: '2026-10-21',
      dateTo: '2026-10-21',
    });
  });

  it('moves a range by its own length, across month and year ends', () => {
    const week = filters({ dateFrom: '2026-10-10', dateTo: '2026-10-16' });
    expect(shiftRange(week, 'earlier', today)).toEqual({
      dateFrom: '2026-10-03',
      dateTo: '2026-10-09',
    });
    const turn = filters({ dateFrom: '2026-01-01', dateTo: '2026-01-03' });
    expect(shiftRange(turn, 'earlier', today)).toEqual({
      dateFrom: '2025-12-29',
      dateTo: '2025-12-31',
    });
  });

  it('never passes today: a step later stops at today, and at today there is none', () => {
    const week = filters({ dateFrom: '2026-10-14', dateTo: '2026-10-20' });
    // A whole week later would end on the 27th; it ends on the 23rd.
    expect(shiftRange(week, 'later', today)).toEqual({
      dateFrom: '2026-10-17',
      dateTo: '2026-10-23',
    });
    const upToToday = filters({ dateFrom: '2026-10-17', dateTo: today });
    expect(shiftRange(upToToday, 'later', today)).toBeNull();
    expect(shiftRange(filters(presetRange('today', today)), 'later', today)).toBeNull();
  });

  it('counts an open end as today', () => {
    const since = filters({ dateFrom: '2026-10-21' });
    expect(shiftRange(since, 'later', today)).toBeNull();
    expect(shiftRange(since, 'earlier', today)).toEqual({
      dateFrom: '2026-10-18',
      dateTo: '2026-10-20',
    });
  });

  it('does not move what has no start, or runs backwards', () => {
    expect(shiftRange(filters({ dateTo: '2026-10-20' }), 'earlier', today)).toBeNull();
    expect(shiftRange(NO_FILTERS, 'later', today)).toBeNull();
    const backwards = filters({ dateFrom: '2026-10-20', dateTo: '2026-10-10' });
    expect(shiftRange(backwards, 'earlier', today)).toBeNull();
    expect(shiftRange(backwards, 'later', today)).toBeNull();
  });
});
