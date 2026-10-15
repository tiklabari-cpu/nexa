import { describe, expect, it } from 'vitest';
import {
  CONNECTION_OPENED_VIA,
  DEFAULT_DAY_BOUNDARY,
  isConnectionOpenedVia,
  isDayBoundaryHour,
  isDayBoundaryTimeZone,
  localDayKey,
} from './conversation-day.js';

const at = (iso: string): Date => new Date(iso);

describe('DEFAULT_DAY_BOUNDARY (ID-04 · K3)', () => {
  it('is Europe/Istanbul midnight — what the inbox_settings column defaults carry', () => {
    expect(DEFAULT_DAY_BOUNDARY).toEqual({ timezone: 'Europe/Istanbul', hour: 0 });
  });

  it('is what localDayKey uses when the workspace has no setting', () => {
    // 21:30 UTC is 00:30 the next day in Istanbul (UTC+3, no daylight saving).
    expect(localDayKey(at('2026-10-14T21:30:00Z'))).toBe('2026-10-15');
    expect(localDayKey(at('2026-10-14T20:59:59Z'))).toBe('2026-10-14');
  });
});

describe('localDayKey (ID-04)', () => {
  it('files a player writing at 00:30 Istanbul time under the new local day, not the UTC day', () => {
    const night = at('2026-10-14T21:30:00Z');
    expect(night.toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(localDayKey(night, 'Europe/Istanbul', 0)).toBe('2026-10-15');
  });

  it('reads exact midnight as 00:00 of the new day, never as hour 24 of the old one', () => {
    expect(localDayKey(at('2026-10-14T21:00:00Z'), 'Europe/Istanbul', 0)).toBe('2026-10-15');
    expect(localDayKey(at('2026-10-14T20:59:59.999Z'), 'Europe/Istanbul', 0)).toBe('2026-10-14');
  });

  it('with a 06:00 boundary, 05:59 is the previous day and 06:00 is today', () => {
    // 05:59 Istanbul = 02:59 UTC, 06:00 Istanbul = 03:00 UTC.
    expect(localDayKey(at('2026-10-15T02:59:59Z'), 'Europe/Istanbul', 6)).toBe('2026-10-14');
    expect(localDayKey(at('2026-10-15T03:00:00Z'), 'Europe/Istanbul', 6)).toBe('2026-10-15');
  });

  it('a 23:00 boundary pulls the last local hour into the next day', () => {
    expect(localDayKey(at('2026-10-15T19:59:59Z'), 'Europe/Istanbul', 23)).toBe('2026-10-14');
    expect(localDayKey(at('2026-10-15T20:00:00Z'), 'Europe/Istanbul', 23)).toBe('2026-10-15');
  });

  it('rolls the year back across 1 January', () => {
    // 01:00 Istanbul on 1 January, before a 06:00 boundary: still 31 December.
    expect(localDayKey(at('2025-12-31T22:00:00Z'), 'Europe/Istanbul', 6)).toBe('2025-12-31');
    expect(localDayKey(at('2026-01-01T03:00:00Z'), 'Europe/Istanbul', 6)).toBe('2026-01-01');
  });

  it('handles the leap day: 1 March before the boundary is 29 February in a leap year, 28 in a common one', () => {
    // 01:00 Istanbul on 1 March = 22:00 UTC the day before.
    expect(localDayKey(at('2028-02-29T22:00:00Z'), 'Europe/Istanbul', 6)).toBe('2028-02-29');
    expect(localDayKey(at('2027-02-28T22:00:00Z'), 'Europe/Istanbul', 6)).toBe('2027-02-28');
    expect(localDayKey(at('2028-02-29T10:00:00Z'), 'Europe/Istanbul', 0)).toBe('2028-02-29');
  });

  describe('America/New_York across daylight saving', () => {
    it('keeps a midnight boundary correct on the spring-forward day (8 March 2026)', () => {
      // EST (UTC-5) until 07:00 UTC, EDT (UTC-4) after.
      expect(localDayKey(at('2026-03-08T04:59:59Z'), 'America/New_York', 0)).toBe('2026-03-07');
      expect(localDayKey(at('2026-03-08T05:00:00Z'), 'America/New_York', 0)).toBe('2026-03-08');
      // After the jump, 00:00 next day is 04:00 UTC.
      expect(localDayKey(at('2026-03-09T03:59:59Z'), 'America/New_York', 0)).toBe('2026-03-08');
      expect(localDayKey(at('2026-03-09T04:00:00Z'), 'America/New_York', 0)).toBe('2026-03-09');
    });

    it('applies a 06:00 boundary to the wall clock on both sides of spring-forward', () => {
      // 05:59 EST on 8 March = 10:59 UTC; the clock jumps at 07:00 UTC, so
      // 06:00 that day is EDT = 10:00 UTC. 09:59:59 UTC is 05:59:59 EDT.
      expect(localDayKey(at('2026-03-08T09:59:59Z'), 'America/New_York', 6)).toBe('2026-03-07');
      expect(localDayKey(at('2026-03-08T10:00:00Z'), 'America/New_York', 6)).toBe('2026-03-08');
    });

    it('keeps the repeated hour on one day on the fall-back day (1 November 2026)', () => {
      // 01:30 happens twice: 05:30 UTC (EDT) and 06:30 UTC (EST).
      expect(localDayKey(at('2026-11-01T03:59:59Z'), 'America/New_York', 1)).toBe('2026-10-31');
      expect(localDayKey(at('2026-11-01T04:30:00Z'), 'America/New_York', 1)).toBe('2026-10-31');
      expect(localDayKey(at('2026-11-01T05:30:00Z'), 'America/New_York', 1)).toBe('2026-11-01');
      expect(localDayKey(at('2026-11-01T06:30:00Z'), 'America/New_York', 1)).toBe('2026-11-01');
    });

    it('does not split the 25-hour fall-back day under a midnight boundary', () => {
      expect(localDayKey(at('2026-11-01T04:00:00Z'), 'America/New_York', 0)).toBe('2026-11-01');
      expect(localDayKey(at('2026-11-02T04:59:59Z'), 'America/New_York', 0)).toBe('2026-11-01');
      expect(localDayKey(at('2026-11-02T05:00:00Z'), 'America/New_York', 0)).toBe('2026-11-02');
    });
  });

  it('UTC with midnight is the plain UTC date', () => {
    expect(localDayKey(at('2026-10-14T23:59:59Z'), 'UTC', 0)).toBe('2026-10-14');
    expect(localDayKey(at('2026-10-15T00:00:00Z'), 'UTC', 0)).toBe('2026-10-15');
  });

  it('refuses an hour outside 0-23 and a zone the engine does not know', () => {
    expect(() => localDayKey(at('2026-10-14T12:00:00Z'), 'Europe/Istanbul', 24)).toThrow(
      RangeError,
    );
    expect(() => localDayKey(at('2026-10-14T12:00:00Z'), 'Europe/Istanbul', -1)).toThrow(
      RangeError,
    );
    expect(() => localDayKey(at('2026-10-14T12:00:00Z'), 'Europe/Istanbul', 1.5)).toThrow(
      RangeError,
    );
    expect(() => localDayKey(at('2026-10-14T12:00:00Z'), 'Mars/Olympus', 0)).toThrow(RangeError);
    expect(() => localDayKey(new Date('nope'), 'UTC', 0)).toThrow(RangeError);
  });
});

describe('day boundary validators (ID-04)', () => {
  it('accepts whole hours 0-23 only', () => {
    for (const hour of [0, 6, 23]) expect(isDayBoundaryHour(hour)).toBe(true);
    for (const hour of [-1, 24, 1.5, Number.NaN, '6', null, undefined]) {
      expect(isDayBoundaryHour(hour)).toBe(false);
    }
  });

  it('accepts IANA zones from the closed list and refuses anything else', () => {
    for (const zone of ['Europe/Istanbul', 'America/New_York', 'UTC']) {
      expect(isDayBoundaryTimeZone(zone)).toBe(true);
    }
    for (const zone of ['Mars/Olympus', '', '   ', 'PST', 42, null]) {
      expect(isDayBoundaryTimeZone(zone)).toBe(false);
    }
  });
});

describe('connection opened-via vocabulary (ID-02)', () => {
  it('names the five ways a connection opens, each once', () => {
    expect([...CONNECTION_OPENED_VIA]).toEqual([
      'first_of_day',
      'same_day_return',
      'agent_start',
      'agent_reopen',
      'day_rollover',
    ]);
    expect(new Set(CONNECTION_OPENED_VIA).size).toBe(CONNECTION_OPENED_VIA.length);
  });

  it('accepts exactly those values — no case folding, no close reasons', () => {
    for (const value of CONNECTION_OPENED_VIA) expect(isConnectionOpenedVia(value)).toBe(true);
    for (const value of ['First_Of_Day', 'resume', 'timeout', '', ' first_of_day', null, 1]) {
      expect(isConnectionOpenedVia(value)).toBe(false);
    }
  });
});
