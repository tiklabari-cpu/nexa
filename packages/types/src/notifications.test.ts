import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEVICE_PLATFORMS,
  LOCKED_ON_NOTIFICATION_EVENTS,
  NOTIFICATION_EVENTS,
  applyNotificationPatch,
  eventAllowed,
  isDevicePlatform,
  isNotificationEvent,
  pushAllowed,
  readNotificationEvents,
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
    const prefs = {
      enabled: false,
      sound: false,
      desktop: false,
      push: false,
      email: false,
      events: { ...DEFAULT_NOTIFICATION_EVENTS, new_ticket: false },
      repeat_sound: true,
    };
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

// IN-10 · tm 367
describe('notification events (FR-MOD-13.8)', () => {
  it('names the six events the settings screen lists', () => {
    expect([...NOTIFICATION_EVENTS]).toEqual([
      'incoming_chat',
      'transferred_to_me',
      'transferred_to_my_team',
      'queue_waiting',
      'new_ticket',
      'ticket_reply',
    ]);
    expect(isNotificationEvent('new_ticket')).toBe(true);
    expect(isNotificationEvent('new_tiket')).toBe(false);
    expect(isNotificationEvent(3)).toBe(false);
  });

  it('defaults the queue to off and everything else to on; the repeat is off', () => {
    expect(DEFAULT_NOTIFICATION_EVENTS.queue_waiting).toBe(false);
    for (const event of NOTIFICATION_EVENTS.filter((e) => e !== 'queue_waiting')) {
      expect(DEFAULT_NOTIFICATION_EVENTS[event]).toBe(true);
    }
    expect(DEFAULT_NOTIFICATION_PREFERENCES.repeat_sound).toBe(false);
  });

  it('reads a missing key as its default — an older stored object stays reachable', () => {
    expect(readNotificationEvents({ new_ticket: false })).toEqual({
      ...DEFAULT_NOTIFICATION_EVENTS,
      new_ticket: false,
    });
    expect(readNotificationEvents(undefined)).toEqual(DEFAULT_NOTIFICATION_EVENTS);
    expect(readNotificationEvents({ ticket_reply: 'no', queue_waiting: 1 })).toEqual(
      DEFAULT_NOTIFICATION_EVENTS,
    );
  });

  it('holds the locked event on whatever is stored or sent', () => {
    expect([...LOCKED_ON_NOTIFICATION_EVENTS]).toEqual(['incoming_chat']);
    expect(readNotificationEvents({ incoming_chat: false }).incoming_chat).toBe(true);
    expect(
      readNotificationPreferences({ events: { incoming_chat: false } }).events.incoming_chat,
    ).toBe(true);
  });

  it('ignores an unknown event instead of carrying it along', () => {
    const events = readNotificationEvents({ made_up: true });
    expect(Object.keys(events).sort()).toEqual([...NOTIFICATION_EVENTS].sort());
  });

  it('gives each caller its own events object', () => {
    const first = readNotificationPreferences(undefined);
    first.events.new_ticket = false;
    expect(DEFAULT_NOTIFICATION_PREFERENCES.events.new_ticket).toBe(true);
    expect(readNotificationPreferences(undefined).events.new_ticket).toBe(true);
  });

  it('applies the master switch and the event switch together', () => {
    const prefs = readNotificationPreferences({ events: { new_ticket: false } });
    expect(eventAllowed(prefs, 'new_ticket')).toBe(false);
    expect(eventAllowed(prefs, 'ticket_reply')).toBe(true);
    expect(eventAllowed({ ...prefs, enabled: false }, 'incoming_chat')).toBe(false);
  });

  it('merges a patch key by key — an event patch never replaces the object', () => {
    const base = readNotificationPreferences({ events: { new_ticket: false } });
    const next = applyNotificationPatch(base, {
      events: { queue_waiting: true },
      repeat_sound: true,
    });
    expect(next.events).toEqual({
      ...DEFAULT_NOTIFICATION_EVENTS,
      new_ticket: false,
      queue_waiting: true,
    });
    expect(next.repeat_sound).toBe(true);
    expect(next.sound).toBe(true);
    // An `undefined` is "not mentioned", not "off".
    expect(applyNotificationPatch(base, { sound: undefined, push: false }).sound).toBe(true);
  });
});
