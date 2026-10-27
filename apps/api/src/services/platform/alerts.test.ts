import { describe, expect, it } from 'vitest';
import { PLATFORM_ALERT_KINDS } from '@siyahtus/types';
import { alertLocale, defaultAlertKinds, effectiveAlertKinds } from './alerts.js';

describe('operator alert preferences (tm 389.20)', () => {
  it('mails a superadmin every kind and the other roles none until they choose', () => {
    expect(effectiveAlertKinds('superadmin', null)).toEqual([...PLATFORM_ALERT_KINDS]);
    for (const role of ['support', 'billing', 'readonly']) {
      expect(effectiveAlertKinds(role, null), role).toEqual([]);
      expect(defaultAlertKinds(role), role).toEqual([]);
    }
  });

  it('follows a saved choice exactly, in the closed list order, and drops names it does not know', () => {
    expect(
      effectiveAlertKinds('support', { kinds: ['health_red', 'bogus', 'trial_ending'] }),
    ).toEqual(['trial_ending', 'health_red']);
    // An empty choice is a choice: not the role's default.
    expect(effectiveAlertKinds('superadmin', { kinds: [] })).toEqual([]);
  });

  it('writes English unless the operator chose Turkish', () => {
    expect(alertLocale('tr')).toBe('tr');
    expect(alertLocale('en')).toBe('en');
    expect(alertLocale(null)).toBe('en');
    expect(alertLocale('de')).toBe('en');
  });
});
