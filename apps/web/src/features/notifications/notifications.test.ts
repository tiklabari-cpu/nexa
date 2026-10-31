/**
 * The notification decision — every branch that decides whether an agent is
 * interrupted. These are the cases the product cares about and a real browser
 * cannot test deterministically: the master switch off, permission denied, the
 * agent's own reply, a system event — and, since IN-10 (tm 367), which of the
 * listed events a push is and whether it was meant for *this* person.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
} from '@siyahtus/types';
import {
  DEFAULT_PREFS,
  classifyPush,
  decideNotification,
  loadPrefs,
  notificationTitle,
  savePrefs,
  type NotificationPrefs,
  type NotifyMe,
} from './notifications.js';

const customerMessage = {
  chat_id: 'chat-1',
  event: { type: 'message', author_type: 'customer' },
};

const ME: NotifyMe = { accountId: 'me', groupIds: [7] };

function decide(overrides: Partial<Parameters<typeof decideNotification>[0]> = {}) {
  return decideNotification({
    action: 'incoming_event',
    payload: customerMessage,
    prefs: DEFAULT_PREFS,
    focused: false,
    permission: 'granted',
    me: ME,
    ...overrides,
  });
}

/** The prefs with some events changed. */
function withEvents(events: Partial<Record<NotificationEvent, boolean>>) {
  return { ...DEFAULT_PREFS, events: { ...DEFAULT_PREFS.events, ...events } };
}

describe('decideNotification', () => {
  it('fires every channel for a customer message on an unwatched tab (FR-MOD-13.8)', () => {
    expect(decide()).toEqual({
      event: 'incoming_chat',
      key: 'chat-1',
      badge: true,
      sound: true,
      desktop: true,
      repeat: false,
    });
  });

  it('does nothing when notifications are switched off — the negative case (FR-MOD-13.8)', () => {
    expect(decide({ prefs: { ...DEFAULT_PREFS, enabled: false } })).toBeNull();
  });

  it('still badges and chimes when desktop permission is denied', () => {
    expect(decide({ permission: 'denied' })).toMatchObject({
      badge: true,
      sound: true,
      desktop: false,
    });
  });

  it('degrades desktop silently when the API is unsupported', () => {
    expect(decide({ permission: 'unsupported' })?.desktop).toBe(false);
  });

  it('respects the per-channel sound toggle', () => {
    expect(decide({ prefs: { ...DEFAULT_PREFS, sound: false } })).toMatchObject({
      badge: true,
      sound: false,
      desktop: true,
    });
  });

  it('stays quiet while the agent is already looking at the tab', () => {
    expect(decide({ focused: true })).toBeNull();
  });

  it('ignores the agent’s own replies and internal notes', () => {
    expect(
      decide({ payload: { chat_id: 'c', event: { type: 'message', author_type: 'agent' } } }),
    ).toBeNull();
  });

  it('ignores system events like archive and transfer', () => {
    expect(
      decide({
        payload: { chat_id: 'c', event: { type: 'system_message', author_type: 'system' } },
      }),
    ).toBeNull();
  });

  it('ignores pushes that are not new events', () => {
    expect(decide({ action: 'chat_deactivated', payload: {} })).toBeNull();
    expect(decide({ action: 'routing_status_set', payload: {} })).toBeNull();
  });

  it('tolerates a push with no event payload', () => {
    expect(decide({ payload: {} })).toBeNull();
  });
});

describe('the repeating sound (IN-10 · FR-MOD-13.8)', () => {
  const repeating = { ...DEFAULT_PREFS, repeat_sound: true };

  it('is off by default', () => {
    expect(decide()?.repeat).toBe(false);
  });

  it('repeats a visitor’s message when asked, and only with the sound on', () => {
    expect(decide({ prefs: repeating })?.repeat).toBe(true);
    expect(decide({ prefs: { ...repeating, sound: false } })?.repeat).toBe(false);
  });

  it('never repeats anything but a visitor’s message', () => {
    const decision = decide({
      prefs: repeating,
      action: 'incoming_ticket',
      payload: { ticket_id: 't-1', assignee_id: 'me', group_id: null, actor_id: null },
    });
    expect(decision).toMatchObject({ event: 'new_ticket', sound: true, repeat: false });
  });

  it('plays nothing at all under the master switch, repeat or not', () => {
    expect(decide({ prefs: { ...repeating, enabled: false } })).toBeNull();
  });
});

describe('which event a push is (IN-10 · FR-MOD-13.8)', () => {
  it('knows a visitor’s message and nobody else’s', () => {
    expect(classifyPush('incoming_event', customerMessage, ME)).toEqual({
      event: 'incoming_chat',
      key: 'chat-1',
    });
  });

  describe('chat_transferred', () => {
    const transfer = (over: Record<string, unknown>) => ({
      chat_id: 'chat-9',
      requester_id: 'someone-else',
      transferred_to: { group_ids: [], agent_ids: [] },
      assignee_id: null,
      ...over,
    });

    it('is "to me" when handed to this agent, by id or as the assignee', () => {
      expect(
        classifyPush(
          'chat_transferred',
          transfer({ transferred_to: { group_ids: [], agent_ids: ['me'] } }),
          ME,
        ),
      ).toEqual({ event: 'transferred_to_me', key: 'chat-9' });
      expect(classifyPush('chat_transferred', transfer({ assignee_id: 'me' }), ME)).toEqual({
        event: 'transferred_to_me',
        key: 'chat-9',
      });
    });

    it('is "to my team" for a team the agent is in, and says nothing for another team', () => {
      expect(
        classifyPush(
          'chat_transferred',
          transfer({ transferred_to: { group_ids: [7], agent_ids: [] } }),
          ME,
        ),
      ).toEqual({ event: 'transferred_to_my_team', key: 'chat-9' });
      expect(
        classifyPush(
          'chat_transferred',
          transfer({ transferred_to: { group_ids: [8], agent_ids: [] } }),
          ME,
        ),
      ).toBeNull();
    });

    it('prefers "to me" when a team hand-off landed on this agent', () => {
      expect(
        classifyPush(
          'chat_transferred',
          transfer({ transferred_to: { group_ids: [7], agent_ids: [] }, assignee_id: 'me' }),
          ME,
        )?.event,
      ).toBe('transferred_to_me');
    });

    it('stays quiet for the agent who made the hand-off, and for a colleague’s chat', () => {
      expect(
        classifyPush('chat_transferred', transfer({ requester_id: 'me', assignee_id: 'me' }), ME),
      ).toBeNull();
      expect(
        classifyPush('chat_transferred', transfer({ assignee_id: 'colleague' }), ME),
      ).toBeNull();
    });
  });

  describe('queue_waiting', () => {
    const queued = (over: Record<string, unknown> = {}) => ({
      chat: {
        id: 'chat-5',
        access: { group_ids: [7] },
        thread: { id: 't', active: true, queue_position: 2 },
      },
      ...over,
    });

    it('is a visitor queued in one of the agent’s teams', () => {
      expect(classifyPush('incoming_chat', queued(), ME)).toEqual({
        event: 'queue_waiting',
        key: 'chat-5',
      });
    });

    it('is not a chat in another team’s queue, an unqueued chat, or a hand-off', () => {
      expect(
        classifyPush('incoming_chat', queued(), { accountId: 'me', groupIds: [8] }),
      ).toBeNull();
      const unqueued = queued({
        chat: {
          id: 'c',
          access: { group_ids: [7] },
          thread: { id: 't', active: true, queue_position: null },
        },
      });
      expect(classifyPush('incoming_chat', unqueued, ME)).toBeNull();
      expect(
        classifyPush(
          'incoming_chat',
          queued({ transferred_from: { group_ids: [], agent_ids: [] } }),
          ME,
        ),
      ).toBeNull();
    });

    it('is the lead’s "nobody took it" notice', () => {
      expect(classifyPush('chat_unanswered_alert', { chat_id: 'chat-6' }, ME)).toEqual({
        event: 'queue_waiting',
        key: 'chat-6',
      });
    });

    it('is off by default — the event is opt-in', () => {
      expect(decide({ action: 'incoming_chat', payload: queued() })).toBeNull();
      expect(
        decide({
          action: 'incoming_chat',
          payload: queued(),
          prefs: withEvents({ queue_waiting: true }),
        }),
      ).toMatchObject({ event: 'queue_waiting' });
    });
  });

  describe('tickets', () => {
    const arrived = (over: Record<string, unknown> = {}) => ({
      ticket_id: 'tk-1',
      reason: 'created',
      assignee_id: 'me',
      group_id: null,
      actor_id: null,
      ...over,
    });

    it('alerts the assignee and the team, not a bystander and not the actor', () => {
      expect(classifyPush('incoming_ticket', arrived(), ME)).toEqual({
        event: 'new_ticket',
        key: 'tk-1',
      });
      expect(
        classifyPush('incoming_ticket', arrived({ assignee_id: null, group_id: 7 }), ME)?.event,
      ).toBe('new_ticket');
      expect(
        classifyPush('incoming_ticket', arrived({ assignee_id: 'other', group_id: 8 }), ME),
      ).toBeNull();
      expect(classifyPush('incoming_ticket', arrived({ actor_id: 'me' }), ME)).toBeNull();
    });

    it('treats only the player’s message on a ticket as a reply', () => {
      const message = (kind: string) => ({ ticket_id: 'tk-2', kind, author_type: 'customer' });
      expect(classifyPush('ticket_message_created', message('customer_message'), ME)).toEqual({
        event: 'ticket_reply',
        key: 'tk-2',
      });
      for (const kind of ['agent_reply', 'internal_note', 'system']) {
        expect(classifyPush('ticket_message_created', message(kind), ME)).toBeNull();
      }
    });

    it('plays and notifies for a new ticket when the event is on, and not when it is off', () => {
      const payload = arrived();
      expect(decide({ action: 'incoming_ticket', payload })).toMatchObject({
        event: 'new_ticket',
        sound: true,
        desktop: true,
      });
      expect(
        decide({ action: 'incoming_ticket', payload, prefs: withEvents({ new_ticket: false }) }),
      ).toBeNull();
    });
  });

  it('keeps a visitor’s message alerting when every other event is off', () => {
    const everythingOff = withEvents({
      incoming_chat: true,
      transferred_to_me: false,
      transferred_to_my_team: false,
      queue_waiting: false,
      new_ticket: false,
      ticket_reply: false,
    });
    expect(decide({ prefs: everythingOff })).not.toBeNull();
    expect(NOTIFICATION_EVENTS).toHaveLength(6);
  });
});

describe('notificationTitle', () => {
  it('is the plain title when nothing is unread', () => {
    expect(notificationTitle('SiyahTuş', 0)).toBe('SiyahTuş');
  });

  it('prefixes an unread count that reads from the taskbar', () => {
    expect(notificationTitle('SiyahTuş', 3)).toBe('(3) SiyahTuş');
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
      events: { ...DEFAULT_NOTIFICATION_PREFERENCES.events, new_ticket: false },
      repeat_sound: true,
    };
    savePrefs(prefs, memStore(store));
    expect(loadPrefs(memStore(store))).toEqual(prefs);
  });

  it('falls back to defaults on malformed JSON rather than throwing', () => {
    const store = new Map<string, string>([['siyahtus.notifications', '{not json']]);
    expect(loadPrefs(memStore(store))).toEqual(DEFAULT_PREFS);
  });

  it('fills missing keys from defaults for a partial stored shape', () => {
    const store = new Map<string, string>([
      ['siyahtus.notifications', JSON.stringify({ sound: false })],
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
      ['siyahtus.notifications', JSON.stringify({ enabled: true, sound: false, desktop: false })],
    ]);
    expect(loadPrefs(memStore(store))).toEqual({
      ...DEFAULT_PREFS,
      sound: false,
      desktop: false,
    });
  });

  it('ignores a non-boolean channel rather than coercing it', () => {
    const store = new Map<string, string>([
      ['siyahtus.notifications', JSON.stringify({ push: 'no', email: 0, sound: false })],
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
