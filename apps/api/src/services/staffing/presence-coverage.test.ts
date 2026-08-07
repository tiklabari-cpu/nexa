/**
 * Presence coverage arithmetic (WORKSCHED-d).
 *
 * The negatives come first, because every one of them is a way for this module
 * to produce a *plausible* wrong number rather than an error: an empty log
 * reading as "nobody worked", an unknown status counted as available, a window
 * whose opening state is silently dropped. A staffing forecast built on any of
 * those looks exactly as convincing as a correct one.
 */
import { describe, expect, it } from 'vitest';
import { presenceCoverage, type PresenceEvent } from './presence-coverage.js';

/** 2026-03-10 is a Tuesday; the day is irrelevant, the hours are not. */
const at = (hhmm: string): Date => new Date(`2026-03-10T${hhmm}:00.000Z`);

const WINDOW_FROM = at('00:00');
const WINDOW_TO = new Date('2026-03-11T00:00:00.000Z');

const event = (agentId: string, status: string, when: Date): PresenceEvent => ({
  agentId,
  status,
  changedAt: when,
});

/** The bucket indexes that carry any online time, with their minutes. */
const nonZero = (minutes: number[]): Array<[number, number]> =>
  minutes.map((m, hour): [number, number] => [hour, m]).filter(([, m]) => m !== 0);

describe('presenceCoverage (PRD §5.3-Vardiya)', () => {
  // ==========================================================================
  // Unknown is not zero
  // ==========================================================================

  it('returns null — not zeroes — when the log is empty', () => {
    // The whole point: a workspace that has never recorded presence has
    // *unknown* coverage. Answering 0 would let the forecast report a staffing
    // gap for every hour of a week nobody has any data about.
    expect(presenceCoverage([], WINDOW_FROM, WINDOW_TO)).toBeNull();
  });

  it('returns null when every event is at or after the window end', () => {
    // An event that fires after the window closes describes a state the window
    // never saw; it cannot turn an unknown window into a known one.
    const after = [
      event('a', 'accepting_chats', WINDOW_TO),
      event('a', 'offline', new Date('2026-03-12T09:00:00.000Z')),
    ];
    expect(presenceCoverage(after, WINDOW_FROM, WINDOW_TO)).toBeNull();
  });

  it('reports a recorded-but-never-online agent as 0, not as unknown', () => {
    // The mirror image of the rule above: once there *is* a log, a zero is a
    // fact ("we recorded them as away"), and dropping it would understate the
    // number of agents the roster is being compared against.
    const coverage = presenceCoverage([event('a', 'offline', at('00:00'))], WINDOW_FROM, WINDOW_TO);

    expect(coverage).not.toBeNull();
    expect(coverage?.[0]?.agentId).toBe('a');
    expect(coverage?.[0]?.onlineMinutes).toHaveLength(24);
    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([]);
  });

  // ==========================================================================
  // Statuses other than `accepting_chats` are never capacity
  // ==========================================================================

  it('counts only `accepting_chats` as online', () => {
    // `not_accepting_chats` is "at my desk but not taking chats" — routing skips
    // that agent, so counting the hour as covered would hide a real gap.
    const coverage = presenceCoverage(
      [
        event('a', 'not_accepting_chats', at('01:00')),
        event('a', 'accepting_chats', at('02:00')),
        event('a', 'offline', at('03:00')),
      ],
      WINDOW_FROM,
      WINDOW_TO,
    );

    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([[2, 60]]);
  });

  it('never counts an unrecognised status as online', () => {
    // The database CHECK makes this unreachable through the API, but the rule
    // is stated in code as well: a status this module does not recognise is
    // treated as *not* available. Guessing the other way would over-report
    // coverage — the one direction that hides understaffing.
    const coverage = presenceCoverage(
      [event('a', 'on_break', at('04:00')), event('a', 'offline', at('06:00'))],
      WINDOW_FROM,
      WINDOW_TO,
    );

    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([]);
  });

  // ==========================================================================
  // Malformed input raises rather than returning a number
  // ==========================================================================

  it('refuses a window that does not move forward', () => {
    const single = [event('a', 'accepting_chats', at('09:00'))];
    expect(() => presenceCoverage(single, WINDOW_TO, WINDOW_FROM)).toThrow(RangeError);
    expect(() => presenceCoverage(single, WINDOW_FROM, WINDOW_FROM)).toThrow(RangeError);
  });

  it('refuses an unparseable date rather than producing NaN minutes', () => {
    expect(() => presenceCoverage([], new Date('not-a-date'), WINDOW_TO)).toThrow(TypeError);
    expect(() =>
      presenceCoverage([event('a', 'accepting_chats', new Date('nope'))], WINDOW_FROM, WINDOW_TO),
    ).toThrow(TypeError);
  });

  // ==========================================================================
  // Interval arithmetic
  // ==========================================================================

  it('splits an interval across the hours it actually spans', () => {
    // 08:45 → 10:10 is 15 + 60 + 10 minutes, not 85 minutes in hour 8.
    const coverage = presenceCoverage(
      [event('a', 'accepting_chats', at('08:45')), event('a', 'offline', at('10:10'))],
      WINDOW_FROM,
      WINDOW_TO,
    );

    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([
      [8, 15],
      [9, 60],
      [10, 10],
    ]);
  });

  it('carries the state the window opened in, from the last event before it', () => {
    // The agent came online the previous evening and never logged off. Reading
    // only events inside the window would start their day at the first change
    // *after* midnight and lose the whole morning.
    const coverage = presenceCoverage(
      [
        event('a', 'accepting_chats', new Date('2026-03-09T22:00:00.000Z')),
        event('a', 'offline', at('02:30')),
      ],
      WINDOW_FROM,
      WINDOW_TO,
    );

    // Clipped to the window: hours 0 and 1 whole, half of hour 2 — nothing from
    // the previous day leaks in.
    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([
      [0, 60],
      [1, 60],
      [2, 30],
    ]);
  });

  it('runs the last event open-ended to the end of the window', () => {
    const coverage = presenceCoverage(
      [event('a', 'accepting_chats', at('21:00'))],
      WINDOW_FROM,
      WINDOW_TO,
    );

    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([
      [21, 60],
      [22, 60],
      [23, 60],
    ]);
  });

  it('sums the same hour of day across several days', () => {
    // Two days in one window: the 09:00 bucket holds both mornings, which is
    // what "how well is this hour usually covered" needs.
    const twoDays = new Date('2026-03-12T00:00:00.000Z');
    const coverage = presenceCoverage(
      [
        event('a', 'accepting_chats', at('09:00')),
        event('a', 'offline', at('09:30')),
        event('a', 'accepting_chats', new Date('2026-03-11T09:00:00.000Z')),
        event('a', 'offline', new Date('2026-03-11T09:20:00.000Z')),
      ],
      WINDOW_FROM,
      twoDays,
    );

    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([[9, 50]]);
  });

  it('keeps agents separate and orders them deterministically', () => {
    const coverage = presenceCoverage(
      [
        event('zoe', 'accepting_chats', at('11:00')),
        event('adam', 'accepting_chats', at('11:00')),
        event('zoe', 'offline', at('11:30')),
        event('adam', 'offline', at('12:00')),
      ],
      WINDOW_FROM,
      WINDOW_TO,
    );

    expect(coverage?.map((c) => c.agentId)).toEqual(['adam', 'zoe']);
    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([[11, 60]]);
    expect(nonZero(coverage?.[1]?.onlineMinutes ?? [])).toEqual([[11, 30]]);
  });

  it('is order-insensitive and deterministic for the same log', () => {
    const rows = [
      event('a', 'accepting_chats', at('14:00')),
      event('a', 'offline', at('15:00')),
      event('a', 'accepting_chats', at('16:00')),
    ];
    const forwards = presenceCoverage(rows, WINDOW_FROM, WINDOW_TO);
    const shuffled = presenceCoverage([...rows].reverse(), WINDOW_FROM, WINDOW_TO);

    expect(shuffled).toEqual(forwards);
    // 14:00-15:00 online, 15:00-16:00 away, then online to midnight.
    expect(nonZero(forwards?.[0]?.onlineMinutes ?? [])).toEqual([
      [14, 60],
      [16, 60],
      [17, 60],
      [18, 60],
      [19, 60],
      [20, 60],
      [21, 60],
      [22, 60],
      [23, 60],
    ]);
  });

  it('ignores an event that fires after the window while keeping earlier ones', () => {
    const coverage = presenceCoverage(
      [
        event('a', 'accepting_chats', at('23:00')),
        event('a', 'offline', new Date('2026-03-11T06:00:00.000Z')),
      ],
      WINDOW_FROM,
      WINDOW_TO,
    );

    // The agent was still online when the window closed: the whole last hour
    // counts, and the next morning's log-off does not bleed backwards.
    expect(nonZero(coverage?.[0]?.onlineMinutes ?? [])).toEqual([[23, 60]]);
  });
});
