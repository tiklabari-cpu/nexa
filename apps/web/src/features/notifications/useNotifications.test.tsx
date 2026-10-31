/**
 * The desktop notification speaks the console's language (O14, tm 259.18).
 *
 * `showDesktop` is not a component, so it cannot call `useTranslate()`; it used
 * to hard-code "New message" / "A visitor sent a new message." and a Turkish
 * agent got an English pop-up over an otherwise Turkish console.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@siyahtus/types';
import { useAuth } from '../../lib/auth-store.js';
import { resetLocale, setLocale } from '../../test/i18n.js';
import { TabLeader, type ChannelLike } from './leaderTab.js';
import { savePrefs } from './notifications.js';
import {
  noteChatSeen,
  resetNotificationRuntime,
  setViewedChat,
  useNotifications,
} from './useNotifications.js';

// The chime is a browser effect; what is asserted is *when* it is asked for.
const chime = vi.hoisted(() => ({ playChime: vi.fn(() => true) }));
vi.mock('./chime.js', () => chime);

const shown: Array<{ title: string; options: NotificationOptions | undefined }> = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, options });
  }
}

function push(text: string | undefined): void {
  const { result } = renderHook(() => useNotifications());
  act(() =>
    result.current.handlePush('incoming_event', {
      chat_id: 'chat-1',
      event: { type: 'message', author_type: 'customer', ...(text ? { text } : {}) },
    }),
  );
}

beforeEach(() => {
  shown.length = 0;
  vi.stubGlobal('Notification', FakeNotification);
  // A hidden tab: the agent is not looking, so the decision lets the pop-up through.
  vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  // The favicon badge draws on a canvas jsdom does not implement; it is not under test.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  savePrefs({ enabled: true, sound: false, desktop: true } as Parameters<typeof savePrefs>[0]);
});

afterEach(() => {
  resetNotificationRuntime();
  chime.playChime.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLocale();
  localStorage.clear();
});

describe('desktop notification wording', () => {
  it('is English in an English console', () => {
    push(undefined);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('New message');
    expect(shown[0]!.options?.body).toBe('A visitor sent a new message.');
  });

  it('is Turkish in a Turkish console, title and fallback body both', () => {
    setLocale('tr');
    push(undefined);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('Yeni mesaj');
    expect(shown[0]!.options?.body).toBe('Bir ziyaretçi yeni bir mesaj gönderdi.');
  });

  it('shows the visitor’s own words untranslated — conversation content is out of scope', () => {
    setLocale('tr');
    push('Where is my order?');
    expect(shown[0]!.options?.body).toBe('Where is my order?');
  });
});

// --- IN-10 · tm 367 ------------------------------------------------------------

function pushOnce(action: string, payload: Record<string, unknown>) {
  const { result } = renderHook(() => useNotifications());
  act(() => result.current.handlePush(action, payload));
  return result;
}

const visitorMessage = (chatId = 'chat-1') => ({
  chat_id: chatId,
  event: { type: 'message', author_type: 'customer', text: 'hello' },
});

function prefs(over: Record<string, unknown> = {}): void {
  savePrefs({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...over } as Parameters<typeof savePrefs>[0]);
}

function signInAs(accountId: string, groupIds: number[] = []): void {
  useAuth.setState({
    agent: {
      account_id: accountId,
      group_ids: groupIds,
      role: 'agent',
    } as unknown as NonNullable<ReturnType<typeof useAuth.getState>['agent']>,
  });
}

describe('new-ticket alerts (FR-MOD-13.8)', () => {
  beforeEach(() => signInAs('me', [7]));
  afterEach(() => useAuth.setState({ agent: null }));

  const assigned = {
    ticket_id: 'tk-1',
    reason: 'created',
    assignee_id: 'me',
    group_id: null,
    actor_id: null,
  };

  it('chimes and raises a desktop notification for a ticket assigned to me', () => {
    prefs();
    pushOnce('incoming_ticket', assigned);

    expect(chime.playChime).toHaveBeenCalledTimes(1);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('New ticket');
    expect(shown[0]!.options?.tag).toBe('new_ticket:tk-1');
  });

  it('says nothing once the event is switched off', () => {
    prefs({ events: { ...DEFAULT_NOTIFICATION_PREFERENCES.events, new_ticket: false } });
    pushOnce('incoming_ticket', assigned);

    expect(chime.playChime).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
  });

  it('says nothing under the master switch', () => {
    prefs({ enabled: false });
    pushOnce('incoming_ticket', assigned);
    pushOnce('incoming_event', visitorMessage());

    expect(chime.playChime).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
  });

  it('speaks in Turkish in a Turkish console', () => {
    setLocale('tr');
    prefs();
    pushOnce('incoming_ticket', assigned);

    expect(shown[0]!.title).toBe('Yeni ticket');
  });
});

describe('the repeating sound (FR-MOD-13.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T10:00:00Z'));
    prefs({ repeat_sound: true });
  });

  it('chimes at once, then every 10 seconds, until the chat is read', () => {
    pushOnce('incoming_event', visitorMessage());
    expect(chime.playChime).toHaveBeenCalledTimes(1);

    act(() => void vi.advanceTimersByTime(10_000));
    expect(chime.playChime).toHaveBeenCalledTimes(2);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(chime.playChime).toHaveBeenCalledTimes(3);

    // The agent comes back and the read marker lands.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    act(() => noteChatSeen('chat-1'));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(chime.playChime).toHaveBeenCalledTimes(3);
  });

  it('stops when the chat is opened — at once when looked at', () => {
    pushOnce('incoming_event', visitorMessage());
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    act(() => setViewedChat('chat-1'));

    act(() => void vi.advanceTimersByTime(30_000));
    expect(chime.playChime).toHaveBeenCalledTimes(1);
  });

  it('keeps going while the chat is open in a tab nobody is looking at, and ends when they return', () => {
    setViewedChat('chat-1');
    pushOnce('incoming_event', visitorMessage());

    act(() => void vi.advanceTimersByTime(20_000));
    expect(chime.playChime).toHaveBeenCalledTimes(3);

    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event('focus')));
    act(() => void vi.advanceTimersByTime(30_000));
    expect(chime.playChime).toHaveBeenCalledTimes(3);
  });

  it('gives up after two minutes', () => {
    pushOnce('incoming_event', visitorMessage());
    act(() => void vi.advanceTimersByTime(300_000));
    // The first chime, then one per 10 s up to — not including — the 120 s mark.
    expect(chime.playChime).toHaveBeenCalledTimes(12);
  });

  it('is off unless asked for: one chime and nothing more', () => {
    prefs({ repeat_sound: false });
    pushOnce('incoming_event', visitorMessage());
    act(() => void vi.advanceTimersByTime(60_000));
    expect(chime.playChime).toHaveBeenCalledTimes(1);
  });

  it('does not repeat with the sound itself off', () => {
    prefs({ repeat_sound: true, sound: false });
    pushOnce('incoming_event', visitorMessage());
    act(() => void vi.advanceTimersByTime(60_000));
    expect(chime.playChime).not.toHaveBeenCalled();
  });
});

describe('two tabs, one chime (FR-MOD-13.8)', () => {
  /** A BroadcastChannel stand-in that reaches every other instance of the same name. */
  class FakeBroadcastChannel implements ChannelLike {
    static all: FakeBroadcastChannel[] = [];
    readonly #listeners = new Set<(event: { data: unknown }) => void>();
    constructor(readonly name: string) {
      FakeBroadcastChannel.all.push(this);
    }
    postMessage(message: unknown): void {
      for (const other of FakeBroadcastChannel.all) {
        if (other === this || other.name !== this.name) continue;
        for (const listener of other.#listeners) listener({ data: structuredClone(message) });
      }
    }
    addEventListener(_t: 'message', l: (event: { data: unknown }) => void): void {
      this.#listeners.add(l);
    }
    removeEventListener(_t: 'message', l: (event: { data: unknown }) => void): void {
      this.#listeners.delete(l);
    }
    close(): void {
      FakeBroadcastChannel.all = FakeBroadcastChannel.all.filter((c) => c !== this);
    }
  }

  const CHANNEL = 'siyahtus.notification-leader';

  beforeEach(() => {
    FakeBroadcastChannel.all = [];
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    prefs({ repeat_sound: true });
  });

  /** A second console tab, born at `bornAt`, looked at or not. */
  function otherTab(options: { bornAt: number; focused?: boolean }): TabLeader {
    const peer = new TabLeader({
      channel: new FakeBroadcastChannel(CHANNEL),
      id: 'other-tab',
      now: () => options.bornAt,
      isFocused: () => options.focused ?? false,
      setInterval: () => 0,
      clearInterval: () => undefined,
    });
    peer.start();
    return peer;
  }

  it('stays silent in a tab that is not the leader — sound and pop-up both', () => {
    otherTab({ bornAt: 1 });
    pushOnce('incoming_event', visitorMessage());

    expect(chime.playChime).not.toHaveBeenCalled();
    expect(shown).toHaveLength(0);
  });

  it('plays in the tab that leads', () => {
    pushOnce('incoming_event', visitorMessage());
    expect(chime.playChime).toHaveBeenCalledTimes(1);
    expect(shown).toHaveLength(1);
  });

  it('stays quiet when the other tab is the one being looked at', () => {
    otherTab({ bornAt: Date.now() + 60_000, focused: true });
    pushOnce('incoming_event', visitorMessage());

    expect(chime.playChime).not.toHaveBeenCalled();
  });

  it('stops this tab’s repeating sound when another tab reads the chat', () => {
    vi.useFakeTimers();
    // This tab leads (the other is younger) and is repeating.
    const reader = otherTab({ bornAt: Date.now() + 60_000 });
    pushOnce('incoming_event', visitorMessage());
    expect(chime.playChime).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(chime.playChime).toHaveBeenCalledTimes(2);

    reader.announceCleared('chat-1');
    act(() => void vi.advanceTimersByTime(60_000));
    expect(chime.playChime).toHaveBeenCalledTimes(2);
  });
});
