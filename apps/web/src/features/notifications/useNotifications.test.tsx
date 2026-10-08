/**
 * The desktop notification speaks the console's language (O14, tm 259.18).
 *
 * `showDesktop` is not a component, so it cannot call `useTranslate()`; it used
 * to hard-code "New message" / "A visitor sent a new message." and a Turkish
 * agent got an English pop-up over an otherwise Turkish console.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLocale, setLocale } from '../../test/i18n.js';
import { savePrefs } from './notifications.js';
import { useNotifications } from './useNotifications.js';

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
