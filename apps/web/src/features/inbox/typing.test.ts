/**
 * The typing store folds two separate pushes — the on/off indicator and the
 * sneak-peek text — into one live view, and lets a lapsed indicator clear
 * itself. Both are silent failure modes: a preview blanked between keystrokes
 * flickers, and an indicator that never clears leaves a visitor frozen as
 * "typing" long after they stopped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPING_IDLE_MS, useTypingStore } from './typing.js';

const CHAT = 'TJ1H8CFKRV';

describe('useTypingStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useTypingStore.getState().clear(CHAT);
    useTypingStore.setState({ byChat: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a visitor typing with the sneak-peek preview', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, 'my order is la');
    expect(useTypingStore.getState().byChat[CHAT]).toEqual({
      isTyping: true,
      text: 'my order is la',
    });
  });

  it('keeps the preview when a bare typing push carries no text', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, 'my order is la');
    // A plain `incoming_typing_indicator` arrives with no text — it must not
    // blank the preview the sneak-peek already set.
    useTypingStore.getState().noteCustomer(CHAT, true, null);
    expect(useTypingStore.getState().byChat[CHAT]?.text).toBe('my order is la');
  });

  it('drops the indicator when the visitor stops', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, 'draft');
    useTypingStore.getState().noteCustomer(CHAT, false, null);
    expect(useTypingStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('lapses on its own if no keystroke refreshes it', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, 'draft');
    expect(useTypingStore.getState().byChat[CHAT]).toBeDefined();

    vi.advanceTimersByTime(TYPING_IDLE_MS + 1);
    // A dropped "stop" must not leave the agent staring at a frozen indicator.
    expect(useTypingStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('a fresh keystroke pushes the lapse back', () => {
    useTypingStore.getState().noteCustomer(CHAT, true, 'd');
    vi.advanceTimersByTime(TYPING_IDLE_MS - 100);
    useTypingStore.getState().noteCustomer(CHAT, true, 'dr');
    vi.advanceTimersByTime(200); // past the first deadline, before the new one
    expect(useTypingStore.getState().byChat[CHAT]?.text).toBe('dr');
  });
});
