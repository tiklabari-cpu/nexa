import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORK_SCHEDULE,
  WORK_SCHEDULE_DAYS,
  WORK_SCHEDULE_TIME_PATTERN,
  isWorkScheduleProblem,
  normalizeWorkSchedule,
} from './work-schedule.js';

const fullWeek = WORK_SCHEDULE_DAYS.map((day) => ({
  day,
  start: '09:00',
  end: '18:00',
  enabled: day !== 'saturday' && day !== 'sunday',
}));

describe('work schedule catalogue', () => {
  it('lists the seven weekdays in week order', () => {
    expect(WORK_SCHEDULE_DAYS).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });

  it('matches zero-padded 24h HH:MM only', () => {
    expect(WORK_SCHEDULE_TIME_PATTERN.test('00:00')).toBe(true);
    expect(WORK_SCHEDULE_TIME_PATTERN.test('23:59')).toBe(true);
    expect(WORK_SCHEDULE_TIME_PATTERN.test('24:00')).toBe(false);
    expect(WORK_SCHEDULE_TIME_PATTERN.test('9:00')).toBe(false);
    expect(WORK_SCHEDULE_TIME_PATTERN.test('09:60')).toBe(false);
    expect(WORK_SCHEDULE_TIME_PATTERN.test('abc')).toBe(false);
  });
});

describe('normalizeWorkSchedule — rejections (KK "geçersiz saat/gün reddedilir")', () => {
  it('rejects an invalid HH:MM start/end', () => {
    for (const bad of ['24:00', '9:00', 'abc']) {
      const result = normalizeWorkSchedule({
        timezone: 'UTC',
        schedule: [{ day: 'monday', start: bad, end: '17:00', enabled: true }],
      });
      expect(isWorkScheduleProblem(result)).toBe(true);
      if (isWorkScheduleProblem(result)) expect(result.problem.reason).toBe('invalid_time');
    }
  });

  it('rejects start >= end', () => {
    const equal = normalizeWorkSchedule({
      timezone: 'UTC',
      schedule: [{ day: 'monday', start: '09:00', end: '09:00', enabled: true }],
    });
    expect(isWorkScheduleProblem(equal)).toBe(true);
    if (isWorkScheduleProblem(equal)) expect(equal.problem.reason).toBe('range');

    const reversed = normalizeWorkSchedule({
      timezone: 'UTC',
      schedule: [{ day: 'monday', start: '17:00', end: '09:00', enabled: true }],
    });
    expect(isWorkScheduleProblem(reversed)).toBe(true);
    if (isWorkScheduleProblem(reversed)) expect(reversed.problem.reason).toBe('range');
  });

  it('rejects an unknown weekday', () => {
    const result = normalizeWorkSchedule({
      timezone: 'UTC',
      schedule: [{ day: 'funday', start: '09:00', end: '17:00', enabled: true }],
    });
    expect(isWorkScheduleProblem(result)).toBe(true);
    if (isWorkScheduleProblem(result)) expect(result.problem.reason).toBe('unknown_day');
  });

  it('rejects the same day listed twice', () => {
    const result = normalizeWorkSchedule({
      timezone: 'UTC',
      schedule: [
        { day: 'monday', start: '09:00', end: '17:00', enabled: true },
        { day: 'monday', start: '10:00', end: '18:00', enabled: true },
      ],
    });
    expect(isWorkScheduleProblem(result)).toBe(true);
    if (isWorkScheduleProblem(result)) expect(result.problem.reason).toBe('duplicate_day');
  });
});

describe('normalizeWorkSchedule — empty input (KK-türetilmiş "boş girdi → default")', () => {
  it('returns the default schedule for null and undefined', () => {
    expect(normalizeWorkSchedule(null)).toEqual(DEFAULT_WORK_SCHEDULE);
    expect(normalizeWorkSchedule(undefined)).toEqual(DEFAULT_WORK_SCHEDULE);
  });

  it('falls back to the default weekly pattern when schedule is empty, keeping a valid timezone', () => {
    const result = normalizeWorkSchedule({ timezone: 'Europe/Istanbul', schedule: [] });
    expect(isWorkScheduleProblem(result)).toBe(false);
    if (!isWorkScheduleProblem(result)) {
      expect(result.timezone).toBe('Europe/Istanbul');
      expect(result.schedule).toEqual(DEFAULT_WORK_SCHEDULE.schedule);
    }
  });

  it('falls back to the default timezone when none is given', () => {
    const result = normalizeWorkSchedule({ schedule: fullWeek });
    expect(isWorkScheduleProblem(result)).toBe(false);
    if (!isWorkScheduleProblem(result)) expect(result.timezone).toBe(DEFAULT_WORK_SCHEDULE.timezone);
  });
});

describe('normalizeWorkSchedule — positive (a full plan is normalized)', () => {
  it('normalizes a full seven-day plan unchanged', () => {
    const result = normalizeWorkSchedule({ timezone: 'UTC', schedule: fullWeek });
    expect(isWorkScheduleProblem(result)).toBe(false);
    if (!isWorkScheduleProblem(result)) {
      expect(result.schedule).toHaveLength(7);
      expect(result.schedule).toEqual(fullWeek);
    }
  });

  it('coerces a non-boolean enabled to false rather than rejecting', () => {
    const result = normalizeWorkSchedule({
      timezone: 'UTC',
      schedule: [{ day: 'monday', start: '09:00', end: '17:00', enabled: undefined }],
    });
    expect(isWorkScheduleProblem(result)).toBe(false);
    if (!isWorkScheduleProblem(result)) expect(result.schedule[0]?.enabled).toBe(false);
  });
});
