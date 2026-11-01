import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIGEST_ROLES,
  DIGEST_PERIOD_KEY_PATTERN,
  digestOnByDefault,
  effectiveDigestSwitch,
  isDigestFrequency,
} from './digest.js';
import { AGENT_ROLES } from './domain.js';
import { readNotificationPreferences } from './notifications.js';

describe('digest defaults (RP-05)', () => {
  it('the Founder, Administrators and Team Leads get the daily summary, nobody the weekly one', () => {
    expect(DEFAULT_DIGEST_ROLES.daily).toEqual(['owner', 'viceowner', 'admin', 'team_lead']);
    expect(DEFAULT_DIGEST_ROLES.weekly).toEqual([]);
    expect(digestOnByDefault('agent', 'daily')).toBe(false);
    expect(digestOnByDefault('team_lead', 'daily')).toBe(true);
    expect(digestOnByDefault('owner', 'weekly')).toBe(false);
  });

  it('only names roles the database CHECK accepts', () => {
    for (const role of [...DEFAULT_DIGEST_ROLES.daily, ...DEFAULT_DIGEST_ROLES.weekly]) {
      expect(AGENT_ROLES).toContain(role);
    }
  });

  it("a member's own switch beats the workspace default, null follows it", () => {
    expect(effectiveDigestSwitch(false, 'owner', 'daily')).toBe(false);
    expect(effectiveDigestSwitch(true, 'agent', 'daily')).toBe(true);
    expect(effectiveDigestSwitch(null, 'owner', 'daily')).toBe(true);
    expect(effectiveDigestSwitch(undefined, 'agent', 'weekly')).toBe(false);
    expect(effectiveDigestSwitch(null, 'agent', 'weekly', { daily: [], weekly: ['agent'] })).toBe(
      true,
    );
  });

  it('knows its two frequencies and its period key shape', () => {
    expect(isDigestFrequency('daily')).toBe(true);
    expect(isDigestFrequency('monthly')).toBe(false);
    expect(DIGEST_PERIOD_KEY_PATTERN.test('D2026-10-31')).toBe(true);
    expect(DIGEST_PERIOD_KEY_PATTERN.test('W2026-10-26')).toBe(true);
    expect(DIGEST_PERIOD_KEY_PATTERN.test('2026-10-31')).toBe(false);
  });

  it('preferences read the two switches and default them off', () => {
    expect(readNotificationPreferences({}).digest_daily).toBe(false);
    expect(readNotificationPreferences({ digest_weekly: true }).digest_weekly).toBe(true);
    expect(readNotificationPreferences({ digest_daily: 'yes' }).digest_daily).toBe(false);
  });
});
