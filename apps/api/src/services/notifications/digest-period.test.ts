import { describe, expect, it } from 'vitest';
import { dueDigestPeriod, localDate, zonedInstant } from './digest-period.js';

const iso = (date: Date): string => date.toISOString();

describe('the daily summary period (RP-05)', () => {
  it('at 08:00 company time covers the previous local day', () => {
    // Istanbul is UTC+3 all year. Monday 2 Nov 08:00 local = 05:00Z.
    const period = dueDigestPeriod('daily', new Date('2026-11-02T05:00:00Z'), 'Europe/Istanbul');
    expect(period?.periodKey).toBe('D2026-11-01');
    expect(iso(period!.from)).toBe('2026-10-31T21:00:00.000Z');
    expect(iso(period!.to)).toBe('2026-11-01T20:59:59.999Z');
    expect(iso(period!.dueAt)).toBe('2026-11-02T05:00:00.000Z');
  });

  it('before 08:00 the one still due is yesterday’s', () => {
    const period = dueDigestPeriod('daily', new Date('2026-11-02T04:59:00Z'), 'Europe/Istanbul');
    expect(period?.periodKey).toBe('D2026-10-31');
    expect(iso(period!.dueAt)).toBe('2026-11-01T05:00:00.000Z');
  });

  it('names the period by the day covered, not by when the sweep ran (idempotency key)', () => {
    const keys = ['T05:00:00Z', 'T05:01:00Z', 'T08:40:00Z', 'T20:59:00Z'].map(
      (time) =>
        dueDigestPeriod('daily', new Date(`2026-11-02${time}`), 'Europe/Istanbul')?.periodKey,
    );
    expect(new Set(keys)).toEqual(new Set(['D2026-11-01']));
  });

  it('is a closed interval whose previous period ends the millisecond before it begins', () => {
    const period = dueDigestPeriod('daily', new Date('2026-11-02T05:00:00Z'), 'Europe/Istanbul')!;
    expect(period.previous.to.getTime() + 1).toBe(period.from.getTime());
    expect(iso(period.previous.from)).toBe('2026-10-30T21:00:00.000Z');
  });

  it('counts a 23-hour day (Berlin, clocks forward on 29 March) as the local day it is', () => {
    const period = dueDigestPeriod('daily', new Date('2026-03-30T06:00:00Z'), 'Europe/Berlin')!;
    expect(period.periodKey).toBe('D2026-03-29');
    expect(iso(period.from)).toBe('2026-03-28T23:00:00.000Z');
    expect(iso(period.to)).toBe('2026-03-29T21:59:59.999Z');
    expect(period.to.getTime() + 1 - period.from.getTime()).toBe(23 * 3_600_000);
  });

  it('counts a 25-hour day (Berlin, clocks back on 25 October)', () => {
    const period = dueDigestPeriod('daily', new Date('2026-10-26T07:00:00Z'), 'Europe/Berlin')!;
    expect(period.periodKey).toBe('D2026-10-25');
    expect(period.to.getTime() + 1 - period.from.getTime()).toBe(25 * 3_600_000);
  });

  it('keeps a zone that is not a whole number of hours from UTC (Kathmandu +5:45)', () => {
    const period = dueDigestPeriod('daily', new Date('2026-11-02T02:15:00Z'), 'Asia/Kathmandu')!;
    expect(period.periodKey).toBe('D2026-11-01');
    expect(iso(period.from)).toBe('2026-10-31T18:15:00.000Z');
    expect(iso(period.to)).toBe('2026-11-01T18:14:59.999Z');
  });

  it('reads an unresolvable zone as UTC rather than sending nothing', () => {
    const period = dueDigestPeriod('daily', new Date('2026-11-02T08:00:00Z'), 'Not/AZone')!;
    expect(period.periodKey).toBe('D2026-11-01');
    expect(iso(period.from)).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('the weekly summary period (RP-05)', () => {
  it('on Monday 08:00 covers the previous Monday-to-Sunday week', () => {
    const period = dueDigestPeriod('weekly', new Date('2026-11-02T05:00:00Z'), 'Europe/Istanbul')!;
    expect(period.periodKey).toBe('W2026-10-26');
    expect(iso(period.from)).toBe('2026-10-25T21:00:00.000Z');
    expect(iso(period.to)).toBe('2026-11-01T20:59:59.999Z');
    expect(period.previous.to.getTime() + 1).toBe(period.from.getTime());
  });

  it('still sends on Tuesday morning, and stops being due after the grace', () => {
    expect(
      dueDigestPeriod('weekly', new Date('2026-11-03T04:00:00Z'), 'Europe/Istanbul')?.periodKey,
    ).toBe('W2026-10-26');
    // 49 hours after it was due: not arriving mid-week, days late.
    expect(
      dueDigestPeriod('weekly', new Date('2026-11-04T06:00:00Z'), 'Europe/Istanbul'),
    ).toBeNull();
    // Monday before 08:00 is last Monday's, a week old.
    expect(
      dueDigestPeriod('weekly', new Date('2026-11-02T04:59:00Z'), 'Europe/Istanbul'),
    ).toBeNull();
  });

  it('reads Monday by the company’s calendar, not UTC’s', () => {
    // 2026-11-01 22:00Z is already Monday 2 Nov 08:00 in Sydney (UTC+11).
    const period = dueDigestPeriod('weekly', new Date('2026-11-01T21:00:00Z'), 'Australia/Sydney')!;
    expect(period.periodKey).toBe('W2026-10-26');
  });
});

describe('local time helpers', () => {
  it('maps an instant to the local calendar date and back', () => {
    expect(localDate(new Date('2026-11-01T22:30:00Z'), 'Asia/Tokyo')).toEqual({
      year: 2026,
      month: 11,
      day: 2,
    });
    expect(iso(zonedInstant({ year: 2026, month: 11, day: 2 }, 8, 'Asia/Tokyo'))).toBe(
      '2026-11-01T23:00:00.000Z',
    );
  });
});
