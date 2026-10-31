import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimComposerFocus, focusComposerOf } from './composerFocus.js';

function field(chatId: string): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  el.setAttribute('data-composer-input', '');
  el.dataset['chatId'] = chatId;
  document.body.append(el);
  return el;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('composer focus hand-over (IN-08)', () => {
  it('focuses a composer that is already on screen', () => {
    const el = field('a');
    focusComposerOf('a');
    expect(document.activeElement).toBe(el);
  });

  it('holds the request for the composer of the chat that is opening', () => {
    const stale = field('a');
    focusComposerOf('b');
    expect(document.activeElement).not.toBe(stale);
    claimComposerFocus('a', stale);
    expect(document.activeElement).not.toBe(stale);
    const fresh = field('b');
    claimComposerFocus('b', fresh);
    expect(document.activeElement).toBe(fresh);
  });

  it('lets a request expire so a later click is not hijacked', () => {
    focusComposerOf('c');
    vi.advanceTimersByTime(10_000);
    const fresh = field('c');
    claimComposerFocus('c', fresh);
    expect(document.activeElement).not.toBe(fresh);
  });
});
