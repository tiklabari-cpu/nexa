import { describe, expect, it } from 'vitest';
import { IANA_TIMEZONES, timeZoneOptionLabel, utcOffsetLabel } from './timezones.js';

const JANUARY = new Date('2026-01-15T12:00:00Z');
const JULY = new Date('2026-07-15T12:00:00Z');

describe('utcOffsetLabel', () => {
  it('writes whole-hour offsets with their sign and no zero padding', () => {
    expect(utcOffsetLabel('Europe/Istanbul', JANUARY)).toBe('UTC+3');
    expect(utcOffsetLabel('America/New_York', JANUARY)).toBe('UTC-5');
  });

  it('names zero as UTC+0', () => {
    expect(utcOffsetLabel('UTC', JANUARY)).toBe('UTC+0');
    expect(utcOffsetLabel('Africa/Accra', JANUARY)).toBe('UTC+0');
  });

  it('keeps the minutes of a half- or quarter-hour zone', () => {
    expect(utcOffsetLabel('Asia/Kolkata', JANUARY)).toBe('UTC+5:30');
    expect(utcOffsetLabel('Asia/Kathmandu', JANUARY)).toBe('UTC+5:45');
  });

  it('follows daylight saving: the offset is the one in force on the given day', () => {
    expect(utcOffsetLabel('America/New_York', JULY)).toBe('UTC-4');
    expect(utcOffsetLabel('Europe/London', JANUARY)).toBe('UTC+0');
    expect(utcOffsetLabel('Europe/London', JULY)).toBe('UTC+1');
  });

  it('answers null for a name the engine does not know', () => {
    expect(utcOffsetLabel('Mars/Olympus_Mons', JANUARY)).toBeNull();
  });
});

describe('timeZoneOptionLabel', () => {
  it('puts the offset after the name', () => {
    expect(timeZoneOptionLabel('Europe/Istanbul', JANUARY)).toBe('Europe/Istanbul (UTC+3)');
  });

  it('leaves UTC bare rather than "UTC (UTC+0)"', () => {
    expect(timeZoneOptionLabel('UTC', JANUARY)).toBe('UTC');
  });

  it('leaves an unknown stored value as itself', () => {
    expect(timeZoneOptionLabel('Mars/Olympus_Mons', JANUARY)).toBe('Mars/Olympus_Mons');
  });

  it('gives every zone the picker offers an offset', () => {
    const missing = IANA_TIMEZONES.filter(
      (zone) => zone !== 'UTC' && !/\(UTC[+-]\d/.test(timeZoneOptionLabel(zone)),
    );
    expect(missing).toEqual([]);
  });
});
