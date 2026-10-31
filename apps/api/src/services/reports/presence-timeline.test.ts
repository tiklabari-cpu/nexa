import { describe, expect, it } from 'vitest';
import { presenceCoverage } from '../staffing/presence-coverage.js';
import {
  activitySegments,
  addHourly,
  emptyHourly,
  hourMinutes,
  intervalSeconds,
  localHours,
  plannedIntervals,
  roundHourly,
  stateOf,
  stateSeconds,
  stateSecondsWithin,
} from './presence-timeline.js';

const HOUR = 3_600_000;
const at = (iso: string) => new Date(iso);
const ms = (iso: string) => new Date(iso).getTime();
const row = (status: string, iso: string, source = 'manual') => ({
  status,
  source,
  changedAt: at(iso),
});

// 2026-10-26 is a Monday; Istanbul is UTC+3 all year.
const DAY_FROM = ms('2026-10-25T21:00:00.000Z'); // 00:00 Istanbul
const DAY_TO = ms('2026-10-26T21:00:00.000Z'); // 24:00 Istanbul

describe('activitySegments + stateSeconds (RP-03)', () => {
  it('09 accepting / 12 not accepting / 13 accepting / 18 offline is 8 h accepting and 1 h not accepting', () => {
    const rows = [
      row('accepting_chats', '2026-10-26T06:00:00.000Z'),
      row('not_accepting_chats', '2026-10-26T09:00:00.000Z'),
      row('accepting_chats', '2026-10-26T10:00:00.000Z'),
      row('offline', '2026-10-26T15:00:00.000Z'),
    ];
    const seconds = stateSeconds(activitySegments(rows, DAY_FROM, DAY_TO));
    expect(seconds.accepting).toBe(8 * 3600);
    expect(seconds.not_accepting).toBe(1 * 3600);
    expect(seconds.offline).toBe(6 * 3600);
    // Before the first row of the day nothing is known — not "offline".
    expect(seconds.unknown).toBe(9 * 3600);
    expect(seconds.disconnected).toBe(0);
  });

  it('the opening row carries the state the window opened in', () => {
    const rows = [
      row('accepting_chats', '2026-10-24T08:00:00.000Z'), // two days earlier, never changed since
      row('offline', '2026-10-26T12:00:00.000Z'),
    ];
    const segments = activitySegments(rows, DAY_FROM, DAY_TO);
    expect(segments[0]).toEqual({
      state: 'accepting',
      source: 'manual',
      from: DAY_FROM,
      to: ms('2026-10-26T12:00:00.000Z'),
    });
    expect(stateSeconds(segments).unknown).toBe(0);
  });

  it('a state that crosses midnight is split between the two days', () => {
    const rows = [
      row('accepting_chats', '2026-10-26T19:00:00.000Z'), // 22:00 Istanbul
      row('offline', '2026-10-26T23:00:00.000Z'), // 02:00 next day
    ];
    expect(stateSeconds(activitySegments(rows, DAY_FROM, DAY_TO)).accepting).toBe(2 * 3600);
    const next = stateSeconds(activitySegments(rows, DAY_TO, DAY_TO + 24 * HOUR));
    expect(next.accepting).toBe(2 * 3600);
    expect(next.offline).toBe(22 * 3600);
  });

  it('an offline the RTM wrote after the connection dropped is "disconnected"', () => {
    const rows = [
      row('accepting_chats', '2026-10-26T06:00:00.000Z'),
      row('offline', '2026-10-26T08:00:00.000Z', 'disconnect'),
      row('accepting_chats', '2026-10-26T08:30:00.000Z'),
      row('offline', '2026-10-26T15:00:00.000Z'),
    ];
    const segments = activitySegments(rows, DAY_FROM, DAY_TO);
    expect(segments.map((s) => s.state)).toEqual([
      'unknown',
      'accepting',
      'disconnected',
      'accepting',
      'offline',
    ]);
    expect(segments[2]?.source).toBe('disconnect');
    expect(stateSeconds(segments).disconnected).toBe(30 * 60);
  });

  it('maps statuses and sources to states, an unknown status as offline', () => {
    expect(stateOf('accepting_chats', 'login')).toBe('accepting');
    expect(stateOf('not_accepting_chats', 'unresponsive')).toBe('not_accepting');
    expect(stateOf('offline', 'suspension')).toBe('offline');
    expect(stateOf('offline', 'disconnect')).toBe('disconnected');
    expect(stateOf('on_break', 'manual')).toBe('offline');
  });

  it('merges a re-sent state from the same source; keeps a different source apart', () => {
    const rows = [
      row('not_accepting_chats', '2026-10-26T06:00:00.000Z'),
      row('not_accepting_chats', '2026-10-26T07:00:00.000Z'),
      row('not_accepting_chats', '2026-10-26T08:00:00.000Z', 'unresponsive'),
    ];
    const segments = activitySegments(rows, DAY_FROM, DAY_TO);
    expect(segments.map((s) => [s.state, s.source])).toEqual([
      ['unknown', null],
      ['not_accepting', 'manual'],
      ['not_accepting', 'unresponsive'],
    ]);
  });

  it('an empty log is one unknown segment; rows at or after `to` are ignored', () => {
    expect(activitySegments([], DAY_FROM, DAY_TO)).toEqual([
      { state: 'unknown', source: null, from: DAY_FROM, to: DAY_TO },
    ]);
    expect(
      activitySegments([row('accepting_chats', '2026-10-26T21:00:00.000Z')], DAY_FROM, DAY_TO),
    ).toEqual([{ state: 'unknown', source: null, from: DAY_FROM, to: DAY_TO }]);
  });

  it('agrees with presenceCoverage on accepting minutes (the forecast reads the same log)', () => {
    const rows = [
      row('accepting_chats', '2026-10-25T18:00:00.000Z'),
      row('offline', '2026-10-26T01:15:00.000Z', 'disconnect'),
      row('accepting_chats', '2026-10-26T02:40:00.000Z'),
      row('not_accepting_chats', '2026-10-26T13:05:00.000Z'),
    ];
    const coverage = presenceCoverage(
      rows.map((r) => ({ agentId: 'a', ...r })),
      new Date(DAY_FROM),
      new Date(DAY_TO),
    );
    const coverageMinutes = (coverage?.[0]?.onlineMinutes ?? []).reduce((a, b) => a + b, 0);
    const seconds = stateSeconds(activitySegments(rows, DAY_FROM, DAY_TO));
    expect(seconds.accepting).toBe(Math.round(coverageMinutes * 60));
  });
});

describe('localHours + addHourly', () => {
  it('splits a segment at local hour boundaries', () => {
    const hours = localHours(DAY_FROM, DAY_TO, 'Europe/Istanbul');
    expect(hours.hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
    const hourly = emptyHourly();
    addHourly(
      hourly,
      [
        {
          state: 'accepting',
          source: 'manual',
          from: ms('2026-10-26T05:45:00.000Z'),
          to: ms('2026-10-26T07:10:00.000Z'),
        },
      ],
      hours,
      DAY_TO,
    );
    const rounded = roundHourly(hourly);
    expect(rounded[8]?.accepting).toBe(15);
    expect(rounded[9]?.accepting).toBe(60);
    expect(rounded[10]?.accepting).toBe(10);
  });

  it('places hours in a zone with a 45-minute offset', () => {
    // Kathmandu is UTC+5:45: 00:00 local = 18:15 UTC the day before.
    const from = ms('2026-10-25T18:15:00.000Z');
    const hours = localHours(from, from + 24 * HOUR, 'Asia/Kathmandu');
    expect(hours.starts).toHaveLength(24);
    expect(hours.hours[0]).toBe(0);
    expect(new Date(hours.starts[1] ?? 0).toISOString()).toBe('2026-10-25T19:15:00.000Z');
  });

  it('a window that does not start on the hour gets a short first hour', () => {
    const from = ms('2026-10-26T06:20:00.000Z'); // 09:20 Istanbul
    const hours = localHours(from, from + 2 * HOUR, 'Europe/Istanbul');
    expect(hours.hours).toEqual([9, 10, 11]);
    expect(hourMinutes(hours, from + 2 * HOUR).slice(9, 12)).toEqual([40, 60, 20]);
  });

  it('a spring-forward day has 23 local hours (Europe/Berlin, 2026-03-29)', () => {
    const from = ms('2026-03-28T23:00:00.000Z'); // 00:00 CET
    const to = ms('2026-03-29T22:00:00.000Z'); // 00:00 CEST
    const hours = localHours(from, to, 'Europe/Berlin');
    expect(hours.starts).toHaveLength(23);
    expect(hours.hours).not.toContain(2);
  });
});

describe('plannedIntervals', () => {
  const monday = [{ day: 'monday' as const, start: '09:00', end: '18:00', enabled: true }];

  it('places a Monday shift on the Monday in the plan zone', () => {
    const planned = plannedIntervals(
      { timezone: 'Europe/Istanbul', schedule: monday },
      DAY_FROM,
      DAY_TO,
    );
    expect(planned).toEqual([
      { from: ms('2026-10-26T06:00:00.000Z'), to: ms('2026-10-26T15:00:00.000Z') },
    ]);
    expect(intervalSeconds(planned ?? [])).toBe(9 * 3600);
  });

  it('uses the date’s own offset across a DST change', () => {
    // Europe/Berlin: CEST until 2026-10-25, CET from then. Monday 2026-10-19 is CEST.
    const planned = plannedIntervals(
      { timezone: 'Europe/Berlin', schedule: monday },
      ms('2026-10-18T00:00:00.000Z'),
      ms('2026-10-28T00:00:00.000Z'),
    );
    expect(planned).toEqual([
      { from: ms('2026-10-19T07:00:00.000Z'), to: ms('2026-10-19T16:00:00.000Z') },
      { from: ms('2026-10-26T08:00:00.000Z'), to: ms('2026-10-26T17:00:00.000Z') },
    ]);
  });

  it('clips to the window, skips disabled days and drops an unresolvable zone', () => {
    const planned = plannedIntervals(
      {
        timezone: 'Europe/Istanbul',
        schedule: [...monday, { day: 'tuesday', start: '09:00', end: '18:00', enabled: false }],
      },
      ms('2026-10-26T12:00:00.000Z'),
      ms('2026-10-28T12:00:00.000Z'),
    );
    expect(planned).toEqual([
      { from: ms('2026-10-26T12:00:00.000Z'), to: ms('2026-10-26T15:00:00.000Z') },
    ]);
    expect(
      plannedIntervals({ timezone: 'Mars/Olympus', schedule: monday }, DAY_FROM, DAY_TO),
    ).toBeNull();
  });

  it('counts accepting time inside the plan', () => {
    const rows = [
      row('accepting_chats', '2026-10-26T05:00:00.000Z'), // 08:00, an hour before the shift
      row('offline', '2026-10-26T14:00:00.000Z'), // 17:00, an hour early
    ];
    const segments = activitySegments(rows, DAY_FROM, DAY_TO);
    const planned =
      plannedIntervals({ timezone: 'Europe/Istanbul', schedule: monday }, DAY_FROM, DAY_TO) ?? [];
    expect(stateSecondsWithin(segments, planned, 'accepting')).toBe(8 * 3600);
  });
});
