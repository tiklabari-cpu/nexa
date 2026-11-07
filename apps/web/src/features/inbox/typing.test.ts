/**
 * The typing store behind the visitor-draft strip (tm 417.6). Every rule here
 * is a silent failure mode on the agent's screen: a draft that vanishes the
 * moment the visitor pauses, a ghost draft a late frame brought back after a
 * clear, or a draft that never goes because the clear was lost.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_STALE_MS,
  SEQ_TOMBSTONE_MS,
  TYPING_IDLE_MS,
  hasVisibleDraft,
  useTypingStore,
} from './typing.js';

const CHAT = 'TJ1H8CFKRV';
const store = () => useTypingStore.getState();
const record = () => store().byChat[CHAT];

describe('useTypingStore — the visitor draft (FR-MOD-02.9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    store().clearAll();
  });

  afterEach(() => {
    store().clearAll();
    vi.useRealTimers();
  });

  it('records a visitor typing with the sneak-peek draft and its seq', () => {
    store().noteCustomer(CHAT, true, 'my order is la', 3);
    expect(record()).toMatchObject({ isTyping: true, text: 'my order is la', maxSeq: 3 });
  });

  it('FR-MOD-02.9 puts the dots out after 6 s with no keystroke, and keeps the draft', () => {
    store().noteCustomer(CHAT, true, 'draft', 2);
    vi.advanceTimersByTime(TYPING_IDLE_MS + 1);
    expect(record()).toMatchObject({ isTyping: false, text: 'draft' });
    expect(hasVisibleDraft(record())).toBe(true);
  });

  it('FR-MOD-02.9 keeps the draft 29 s after the last accepted frame and drops it at 30 s, keeping the seq', () => {
    store().noteCustomer(CHAT, true, 'draft', 7);
    vi.advanceTimersByTime(29_000);
    expect(record()?.text).toBe('draft');

    vi.advanceTimersByTime(DRAFT_STALE_MS - 29_000);
    expect(record()).toMatchObject({ isTyping: false, text: null, maxSeq: 7 });
    expect(hasVisibleDraft(record())).toBe(false);
  });

  it('FR-MOD-02.9 a new frame at 25 s renews the 30 s lease', () => {
    store().noteCustomer(CHAT, true, 'dra', 1);
    vi.advanceTimersByTime(25_000);
    store().noteCustomer(CHAT, true, 'draft', 2);
    vi.advanceTimersByTime(DRAFT_STALE_MS - 1);
    expect(record()?.text).toBe('draft');
    vi.advanceTimersByTime(1);
    expect(record()?.text).toBeNull();
  });

  it('FR-MOD-02.9 a bare typing push keeps the draft but does not renew its lease', () => {
    store().noteCustomer(CHAT, true, 'draft', 1);
    vi.advanceTimersByTime(20_000);
    // A plain `incoming_typing_indicator` carries no text — it must not blank
    // the draft, nor say the draft is any more current than it was.
    store().noteCustomer(CHAT, true, null);
    expect(record()).toMatchObject({ isTyping: true, text: 'draft' });

    vi.advanceTimersByTime(DRAFT_STALE_MS - 20_000);
    expect(record()?.text).toBeNull();
  });

  it('FR-MOD-02.9 a clear drops the draft at once and keeps the seq as a tombstone', () => {
    store().noteCustomer(CHAT, true, 'draft', 4);
    store().noteCustomer(CHAT, false, null, 5);
    expect(record()).toMatchObject({ isTyping: false, text: null, maxSeq: 5 });
    expect(hasVisibleDraft(record())).toBe(false);
  });

  it('FR-MOD-02.9 a late draft behind a clear never shows (clear seq 5, then draft seq 4)', () => {
    store().noteCustomer(CHAT, false, null, 5);
    store().noteCustomer(CHAT, true, 'ghost', 4);
    expect(hasVisibleDraft(record())).toBe(false);
    expect(record()?.text ?? null).toBeNull();
  });

  it('FR-MOD-02.9 after the visitor sends, a draft frame that left before the message is dropped', () => {
    store().noteCustomer(CHAT, true, 'hello', 3);
    store().endDraft(CHAT);
    expect(hasVisibleDraft(record())).toBe(false);

    store().noteCustomer(CHAT, true, 'hell', 2);
    expect(hasVisibleDraft(record())).toBe(false);
    // The next real frame still lands.
    store().noteCustomer(CHAT, true, 'next one', 4);
    expect(record()?.text).toBe('next one');
  });

  it('FR-MOD-02.9 a frame at or below the seq is still dropped after the draft went stale', () => {
    store().noteCustomer(CHAT, true, 'draft', 9);
    vi.advanceTimersByTime(DRAFT_STALE_MS);
    store().noteCustomer(CHAT, true, 'late', 9);
    store().noteCustomer(CHAT, true, 'later', 8);
    expect(hasVisibleDraft(record())).toBe(false);
  });

  it('starts the guard over on the first frame of a new widget load (seq 1)', () => {
    store().noteCustomer(CHAT, true, 'before the reload', 40);
    store().noteCustomer(CHAT, false, null, 41);
    store().noteCustomer(CHAT, true, 'a', 1);
    store().noteCustomer(CHAT, true, 'ab', 2);
    expect(record()).toMatchObject({ text: 'ab', maxSeq: 2 });
  });

  it('forgets the tombstone after SEQ_TOMBSTONE_MS', () => {
    store().noteCustomer(CHAT, false, null, 5);
    vi.advanceTimersByTime(SEQ_TOMBSTONE_MS);
    expect(record()).toBeUndefined();
  });

  it('a seq-less push is taken as it comes, and a seq-less stop removes the record', () => {
    store().noteCustomer(CHAT, true, 'draft');
    store().noteCustomer(CHAT, true, 'drafts');
    expect(record()?.text).toBe('drafts');
    store().noteCustomer(CHAT, false, null);
    expect(record()).toBeUndefined();
  });

  it('a bare indicator with no draft lapses on its own', () => {
    store().noteCustomer(CHAT, true, null);
    vi.advanceTimersByTime(TYPING_IDLE_MS + 1);
    expect(record()).toBeUndefined();
  });

  it('clear and clearAll forget the guard too', () => {
    store().noteCustomer(CHAT, true, 'draft', 6);
    store().noteCustomer('OTHER', true, 'other', 2);
    store().clear(CHAT);
    expect(record()).toBeUndefined();
    store().noteCustomer(CHAT, true, 'after', 3);
    expect(record()?.text).toBe('after');
    store().clearAll();
    expect(store().byChat).toEqual({});
  });
});
