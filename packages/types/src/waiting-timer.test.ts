import { describe, expect, it } from 'vitest';
import {
  WAITING_DEFAULT_THRESHOLDS,
  waitingDuration,
  waitingEffect,
  waitingLevel,
  waitingThresholdProblem,
  waitingThresholds,
} from './waiting-timer.js';

const event = (author_type: string, recipients = 'all', type = 'message') => ({
  type,
  author_type,
  recipients,
});

describe('waitingEffect', () => {
  it('starts at a player message the player wrote for everyone (IN-03)', () => {
    expect(waitingEffect(event('customer'))).toBe('start');
    expect(waitingEffect(event('customer', 'all', 'rich_message'))).toBe('start');
    expect(waitingEffect(event('customer', 'all', 'file'))).toBe('start');
  });

  it('clears at an agent or a bot message the player sees (IN-03)', () => {
    expect(waitingEffect(event('agent'))).toBe('clear');
    expect(waitingEffect(event('bot'))).toBe('clear');
    expect(waitingEffect(event('agent', 'all', 'rich_message'))).toBe('clear');
  });

  it('leaves an internal note and any system line alone (IN-03)', () => {
    expect(waitingEffect(event('agent', 'agents'))).toBe('none');
    expect(waitingEffect(event('system', 'all', 'system_message'))).toBe('none');
    expect(waitingEffect(event('agent', 'all', 'system_message'))).toBe('none');
    expect(waitingEffect(event('customer', 'all', 'filled_form'))).toBe('none');
    expect(waitingEffect(event('system'))).toBe('none');
  });
});

describe('waitingThresholds', () => {
  it('falls back to 120 and 300 (IN-03)', () => {
    expect(waitingThresholds({})).toEqual({ warn_seconds: 120, alert_seconds: 300 });
    expect(waitingThresholds({ warn_seconds: null, alert_seconds: null })).toEqual(
      WAITING_DEFAULT_THRESHOLDS,
    );
  });

  it('takes a stored pair, one side at a time, and refuses a pair out of order whole', () => {
    expect(waitingThresholds({ warn_seconds: 60, alert_seconds: 600 })).toEqual({
      warn_seconds: 60,
      alert_seconds: 600,
    });
    expect(waitingThresholds({ warn_seconds: 60 })).toEqual({
      warn_seconds: 60,
      alert_seconds: 300,
    });
    // A warning at or after the alert is not a pair: both fall back.
    expect(waitingThresholds({ warn_seconds: 400, alert_seconds: 300 })).toEqual(
      WAITING_DEFAULT_THRESHOLDS,
    );
    expect(waitingThresholds({ warn_seconds: 300, alert_seconds: 300 })).toEqual(
      WAITING_DEFAULT_THRESHOLDS,
    );
  });

  it('judges the pair a save leaves, defaults filled in', () => {
    expect(waitingThresholdProblem(null, null)).toBeNull();
    expect(waitingThresholdProblem(60, 600)).toBeNull();
    expect(waitingThresholdProblem(300, null)).toBe('warn_not_before_alert');
    expect(waitingThresholdProblem(null, 100)).toBe('warn_not_before_alert');
    expect(waitingThresholdProblem(200, 200)).toBe('warn_not_before_alert');
  });
});

describe('waitingLevel', () => {
  it('changes at the thresholds (IN-03)', () => {
    const t = WAITING_DEFAULT_THRESHOLDS;
    expect(waitingLevel(0, t)).toBe('normal');
    expect(waitingLevel(119, t)).toBe('normal');
    expect(waitingLevel(120, t)).toBe('warn');
    expect(waitingLevel(299, t)).toBe('warn');
    expect(waitingLevel(300, t)).toBe('alert');
    expect(waitingLevel(9_999, t)).toBe('alert');
  });
});

describe('waitingDuration', () => {
  it('reads "just now" under a minute, whole minutes, then hours and minutes (IN-03)', () => {
    expect(waitingDuration(-5)).toEqual({ kind: 'now' });
    expect(waitingDuration(59.9)).toEqual({ kind: 'now' });
    expect(waitingDuration(60)).toEqual({ kind: 'minutes', minutes: 1 });
    expect(waitingDuration(4 * 60 + 59)).toEqual({ kind: 'minutes', minutes: 4 });
    expect(waitingDuration(59 * 60 + 59)).toEqual({ kind: 'minutes', minutes: 59 });
    expect(waitingDuration(3600)).toEqual({ kind: 'hours', hours: 1, minutes: 0 });
    expect(waitingDuration(3600 + 5 * 60)).toEqual({ kind: 'hours', hours: 1, minutes: 5 });
  });
});
