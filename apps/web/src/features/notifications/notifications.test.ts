/**
 * The notification decision — every branch that decides whether an agent is
 * interrupted. These are the cases the product cares about and a real browser
 * cannot test deterministically: the master switch off, permission denied, the
 * agent's own reply, a system event.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  decideNotification,
  loadPrefs,
  notificationTitle,
  savePrefs,
  type NotificationPrefs,
} from './notifications.js';

const customerMessage = { type: 'message', author_type: 'customer' };

function decide(overrides: Partial<Parameters<typeof decideNotification>[0]> = {}) {
  return decideNotification({
    action: 'incoming_event',
    event: customerMessage,
    prefs: DEFAULT_PREFS,
    focused: false,
    permission: 'granted',
    ...overrides,
  });
}

describe('decideNotification', () => {
  it('fires every channel for a customer message on an unwatched tab', () => {
    expect(decide()).toEqual({ badge: true, sound: true, desktop: true });
  });

  it('does nothing when notifications are switched off — the negative case', () => {
    expect(decide({ prefs: { enabled: false, sound: true, desktop: true } })).toBeNull();
  });

  it('still badges and chimes when desktop permission is denied', () => {
    expect(decide({ permission: 'denied' })).toEqual({ badge: true, sound: true, desktop: false });
  });

  it('degrades desktop silently when the API is unsupported', () => {
    expect(decide({ permission: 'unsupported' })?.desktop).toBe(false);
  });

  it('respects the per-channel sound toggle', () => {
    expect(decide({ prefs: { enabled: true, sound: false, desktop: true } })).toEqual({
      badge: true,
      sound: false,
      desktop: true,
    });
  });

  it('stays quiet while the agent is already looking at the tab', () => {
    expect(decide({ focused: true })).toBeNull();
  });

  it('ignores the agent’s own replies and internal notes', () => {
    expect(decide({ event: { type: 'message', author_type: 'agent' } })).toBeNull();
  });

  it('ignores system events like archive and transfer', () => {
    expect(decide({ event: { type: 'system_message', author_type: 'system' } })).toBeNull();
  });

  it('ignores pushes that are not new events', () => {
    expect(decide({ action: 'chat_deactivated' })).toBeNull();
    expect(decide({ action: 'routing_status_set' })).toBeNull();
  });

  it('tolerates a push with no event payload', () => {
    expect(decide({ event: undefined })).toBeNull();
  });
});

describe('notificationTitle', () => {
  it('is the plain title when nothing is unread', () => {
    expect(notificationTitle('Nexa', 0)).toBe('Nexa');
  });

  it('prefixes an unread count that reads from the taskbar', () => {
    expect(notificationTitle('Nexa', 3)).toBe('(3) Nexa');
  });
});

describe('the preference cache', () => {
  it('loads defaults from an empty store', () => {
    const store = new Map<string, string>();
    expect(loadPrefs(memStore(store))).toEqual(DEFAULT_PREFS);
  });

  it('persists and reads back every channel', () => {
    const store = new Map<string, string>();
    const prefs: NotificationPrefs = {
      enabled: false,
      sound: false,
      desktop: true,
      push: false,
      email: true,
    };
    savePrefs(prefs, memStore(store));
    expect(loadPrefs(memStore(store))).toEqual(prefs);
  });

  it('falls back to defaults on malformed JSON rather than throwing', () => {
    const store = new Map<string, string>([['nexa.notifications', '{not json']]);
    expect(loadPrefs(memStore(store))).toEqual(DEFAULT_PREFS);
  });

  it('fills missing keys from defaults for a partial stored shape', () => {
    const store = new Map<string, string>([
      ['nexa.notifications', JSON.stringify({ sound: false })],
    ]);
    expect(loadPrefs(memStore(store))).toEqual({ ...DEFAULT_PREFS, sound: false });
  });

  it('reads the three-field shape an older build left behind', () => {
    // The key held `{enabled, sound, desktop}` before the preferences moved to
    // the account (13.7-c), and a browser that has not signed in since still
    // holds one. The two channels it never knew about resolve to the defaults —
    // reachable — rather than to `false`, which would silence a phone on the
    // strength of a stale browser's opinion.
    const store = new Map<string, string>([
      ['nexa.notifications', JSON.stringify({ enabled: true, sound: false, desktop: false })],
    ]);
    expect(loadPrefs(memStore(store))).toEqual({
      ...DEFAULT_PREFS,
      sound: false,
      desktop: false,
    });
  });

  it('ignores a non-boolean channel rather than coercing it', () => {
    const store = new Map<string, string>([
      ['nexa.notifications', JSON.stringify({ push: 'no', email: 0, sound: false })],
    ]);
    expect(loadPrefs(memStore(store))).toEqual({ ...DEFAULT_PREFS, sound: false });
  });
});

/** A minimal Storage stand-in over a Map — the two methods the code uses. */
function memStore(map: Map<string, string>): Pick<Storage, 'getItem' | 'setItem'> {
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}
