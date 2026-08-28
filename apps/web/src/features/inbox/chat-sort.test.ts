/**
 * The chat list sort URL model (FR-MOD-02.2.1) — parsing tolerates a missing or
 * garbled param, and writing keeps a plain (default-sorted) inbox URL free of it.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_SORT_PARAM, DEFAULT_CHAT_SORT, parseChatSort, writeChatSort } from './chat-sort.js';

describe('parseChatSort', () => {
  it('defaults to newest with no param at all', () => {
    expect(parseChatSort(new URLSearchParams())).toBe('newest');
    expect(DEFAULT_CHAT_SORT).toBe('newest');
  });

  it('reads oldest from the URL', () => {
    expect(parseChatSort(new URLSearchParams({ [CHAT_SORT_PARAM]: 'oldest' }))).toBe('oldest');
  });

  it('falls back to the default on a garbled value rather than throwing', () => {
    expect(parseChatSort(new URLSearchParams({ [CHAT_SORT_PARAM]: 'sideways' }))).toBe('newest');
  });
});

describe('writeChatSort', () => {
  it('sets the param for oldest', () => {
    const next = writeChatSort(new URLSearchParams(), 'oldest');
    expect(next.get(CHAT_SORT_PARAM)).toBe('oldest');
  });

  it('omits the param entirely at the default, even if one was already there', () => {
    const next = writeChatSort(new URLSearchParams({ [CHAT_SORT_PARAM]: 'oldest' }), 'newest');
    expect(next.has(CHAT_SORT_PARAM)).toBe(false);
  });

  it('leaves the rest of the params untouched', () => {
    const next = writeChatSort(new URLSearchParams({ chat: 'ABC123' }), 'oldest');
    expect(next.get('chat')).toBe('ABC123');
    expect(next.get(CHAT_SORT_PARAM)).toBe('oldest');
  });
});
