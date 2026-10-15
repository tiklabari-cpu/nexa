import { describe, expect, it } from 'vitest';
import { DEFAULT_DAY_BOUNDARY } from '@siyahtus/types';
import { dayBoundaryFromRow } from './day-boundary.js';

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
