import { describe, expect, it } from 'vitest';
import { DEFAULT_DAY_BOUNDARY, localDayKey } from '@siyahtus/types';
import { dayBoundaryFromRow, localDayWindow } from './day-boundary.js';

describe('dayBoundaryFromRow (ID-04)', () => {
  it('reads Europe/Istanbul 00:00 for a workspace with no settings row', () => {
    expect(dayBoundaryFromRow(null)).toEqual({ timezone: 'Europe/Istanbul', hour: 0 });
    expect(dayBoundaryFromRow(undefined)).toEqual(DEFAULT_DAY_BOUNDARY);
  });

  it('hands back a copy, so a caller cannot edit the shipped default', () => {
    const boundary = dayBoundaryFromRow(null);
    boundary.hour = 9;
    expect(DEFAULT_DAY_BOUNDARY.hour).toBe(0);
    expect(dayBoundaryFromRow(null).hour).toBe(0);
  });

  it('reads a stored zone and hour as they are', () => {
    expect(dayBoundaryFromRow({ dayBoundaryTz: 'America/New_York', dayBoundaryHour: 6 })).toEqual({
      timezone: 'America/New_York',
      hour: 6,
    });
  });

  it('falls back per field for a stored value the setting would no longer accept', () => {
    // A settings typo must not stop a player from starting a chat.
    expect(dayBoundaryFromRow({ dayBoundaryTz: 'Mars/Olympus', dayBoundaryHour: 6 })).toEqual({
      timezone: 'Europe/Istanbul',
      hour: 6,
    });
    expect(dayBoundaryFromRow({ dayBoundaryTz: 'Asia/Tokyo', dayBoundaryHour: 24 })).toEqual({
      timezone: 'Asia/Tokyo',
      hour: 0,
    });
  });
});

describe('localDayWindow (tm 459 · F45)', () => {
  it('spans one Istanbul day as a closed window ending a millisecond before the next', () => {
    const window = localDayWindow('2026-11-05', '2026-11-05', DEFAULT_DAY_BOUNDARY);
    expect(window.from.toISOString()).toBe('2026-11-04T21:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-11-05T20:59:59.999Z');
  });

  it('spans several days, with the day start hour on both ends', () => {
    const window = localDayWindow('2026-11-01', '2026-11-03', {
      timezone: 'Europe/Istanbul',
      hour: 6,
    });
    expect(window.from.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-11-04T02:59:59.999Z');
  });

  it('keeps a 23-hour daylight-saving day whole, and holds only what localDayKey files there', () => {
    const boundary = { timezone: 'America/New_York', hour: 0 };
    const window = localDayWindow('2026-03-08', '2026-03-08', boundary);
    expect(window.from.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-03-09T03:59:59.999Z');
    expect(window.to.getTime() + 1 - window.from.getTime()).toBe(23 * 3_600_000);
    const keyAt = (ms: number) => localDayKey(new Date(ms), boundary.timezone, boundary.hour);
    expect(keyAt(window.from.getTime() - 1)).toBe('2026-03-07');
    expect(keyAt(window.from.getTime())).toBe('2026-03-08');
    expect(keyAt(window.to.getTime())).toBe('2026-03-08');
    expect(keyAt(window.to.getTime() + 1)).toBe('2026-03-09');
  });

  it('refuses a value that is not a calendar day', () => {
    expect(() => localDayWindow('2026-02-30', '2026-02-30', DEFAULT_DAY_BOUNDARY)).toThrow(
      RangeError,
    );
  });
});
