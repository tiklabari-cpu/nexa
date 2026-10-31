import { describe, expect, it } from 'vitest';
import { parseWaitingSeconds, waitingFormError } from './waiting-thresholds.js';

describe('the waiting thresholds form (IN-03)', () => {
  it('reads an empty box as the default and a whole number as itself', () => {
    expect(parseWaitingSeconds('')).toEqual({ ok: true, seconds: null });
    expect(parseWaitingSeconds('  ')).toEqual({ ok: true, seconds: null });
    expect(parseWaitingSeconds('90')).toEqual({ ok: true, seconds: 90 });
  });

  it('refuses what the server would: zero, text, decimals, more than a day', () => {
    for (const raw of ['0', 'abc', '1.5', '-3', '86401']) {
      expect(parseWaitingSeconds(raw), raw).toEqual({ ok: false, error: 'range' });
    }
    expect(parseWaitingSeconds('86400')).toEqual({ ok: true, seconds: 86400 });
  });

  it('judges the pair with the defaults filled in', () => {
    expect(waitingFormError('', '')).toBeNull();
    expect(waitingFormError('60', '600')).toBeNull();
    expect(waitingFormError('400', '')).toBe('settings.waiting.orderError');
    expect(waitingFormError('', '100')).toBe('settings.waiting.orderError');
    expect(waitingFormError('x', '600')).toBe('settings.waiting.rangeError');
  });
});
