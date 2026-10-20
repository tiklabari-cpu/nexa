/**
 * The chat list priority filter's URL model (AI-12 · tm 307.3) — parsing
 * tolerates a missing or garbled param, and writing keeps a plain inbox URL
 * free of it.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_PRIORITY_PARAM, parseChatPriority, writeChatPriority } from './chat-priority.js';

describe('parseChatPriority', () => {
  it('is off with no param at all', () => {
    expect(parseChatPriority(new URLSearchParams())).toBeNull();
  });

  it.each(['urgent', 'high'] as const)('reads %s from the URL', (priority) => {
    expect(parseChatPriority(new URLSearchParams({ [CHAT_PRIORITY_PARAM]: priority }))).toBe(
      priority,
    );
  });

  it.each(['normal', 'low', 'URGENT', ''])('reads %j as "every priority"', (value) => {
    expect(parseChatPriority(new URLSearchParams({ [CHAT_PRIORITY_PARAM]: value }))).toBeNull();
  });
});

describe('writeChatPriority', () => {
  it('sets the param', () => {
    expect(writeChatPriority(new URLSearchParams(), 'urgent').get(CHAT_PRIORITY_PARAM)).toBe(
      'urgent',
    );
  });

  it('omits the param when the filter is turned off', () => {
    const next = writeChatPriority(new URLSearchParams({ [CHAT_PRIORITY_PARAM]: 'high' }), null);
    expect(next.has(CHAT_PRIORITY_PARAM)).toBe(false);
  });

  it('leaves the rest of the params untouched', () => {
    const next = writeChatPriority(
      new URLSearchParams({ chat: 'ABC123', chat_sort: 'oldest' }),
      'high',
    );
    expect(next.get('chat')).toBe('ABC123');
    expect(next.get('chat_sort')).toBe('oldest');
    expect(next.get(CHAT_PRIORITY_PARAM)).toBe('high');
  });
});
