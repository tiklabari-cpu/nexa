import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEVICE_PLATFORMS,
  isDevicePlatform,
  pushAllowed,
  readNotificationPreferences,
} from './notifications.js';

describe('device platforms', () => {
  it('accepts exactly what the database CHECK constraint accepts', () => {
    // `device_tokens_platform_check` lists these two. A value that passed here
    // and failed there would be a 500 on a registration that looked valid.
    expect([...DEVICE_PLATFORMS]).toEqual(['ios', 'android']);
    expect(isDevicePlatform('ios')).toBe(true);
    expect(isDevicePlatform('android')).toBe(true);
  });

  it('refuses a near miss rather than normalising it', () => {
    for (const bad of ['IOS', 'Android', 'web', 'windows', '', null, undefined, 1]) {
      expect(isDevicePlatform(bad), String(bad)).toBe(false);
    }
  });
});

describe('pushAllowed', () => {
  it('needs both the master switch and the channel', () => {
    expect(pushAllowed(DEFAULT_NOTIFICATION_PREFERENCES)).toBe(true);
    expect(pushAllowed({ ...DEFAULT_NOTIFICATION_PREFERENCES, push: false })).toBe(false);
    expect(pushAllowed({ ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: false })).toBe(false);
  });

  it('is unaffected by the channels it does not govern', () => {
    // The master switch covers what interrupts *now*. E-mail is the fallback
    // for somebody who is not there at all, and sound/desktop are the console's
    // business — none of the three may change the answer for a phone.
    expect(
      pushAllowed({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        email: false,
        sound: false,
        desktop: false,
      }),
    ).toBe(true);
  });
});

describe('readNotificationPreferences', () => {
  it('reads a complete object through unchanged', () => {
    const prefs = { enabled: false, sound: false, desktop: false, push: false, email: false };
    expect(readNotificationPreferences(prefs)).toEqual(prefs);
  });

  it('fills anything absent from the defaults — reachable, not silent', () => {
    // The direction matters. Reading a missing channel as `false` would stop
    // interrupting somebody who never asked for quiet, and the only evidence
    // would be a visitor who waited.
    expect(readNotificationPreferences({ sound: false })).toEqual({
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      sound: false,
    });
    expect(readNotificationPreferences({})).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('tolerates a value that is not an object at all', () => {
    for (const junk of [null, undefined, 'off', 0, [], true]) {
      expect(readNotificationPreferences(junk)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    }
  });

  it('ignores a non-boolean channel instead of coercing it', () => {
    // `'false'` and `0` are both truthy/falsy in ways that would silently invert
    // a preference; neither is a boolean, so neither is honoured.
    expect(readNotificationPreferences({ push: 'false', email: 0, enabled: 'yes' })).toEqual(
      DEFAULT_NOTIFICATION_PREFERENCES,
    );
  });

  it('does not alias the defaults', () => {
    const first = readNotificationPreferences(undefined);
    first.enabled = false;
    expect(DEFAULT_NOTIFICATION_PREFERENCES.enabled).toBe(true);
    expect(readNotificationPreferences(undefined).enabled).toBe(true);
  });
});
