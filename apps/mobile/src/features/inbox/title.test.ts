import { chatTitle, headerTitleFor, UNKNOWN_CHAT_TITLE } from './title';
import type { ChatSummary } from './types';

function chat(overrides: Partial<ChatSummary> & { id: string }): ChatSummary {
  return {
    customer_id: 'customer-1',
    customer_name: 'Ada',
    active: true,
    created_at: '2026-08-17T09:00:00.000Z',
    thread_id: 'THREAD1',
    assignee_id: null,
    queue_position: null,
    unread_count: 0,
    last_event: null,
    tags: [],
    ...overrides,
  } as unknown as ChatSummary;
}

describe('chatTitle', () => {
  it('uses the customer name when there is one', () => {
    expect(chatTitle(chat({ id: 'chat-1', customer_name: 'Dana' }))).toBe('Dana');
  });

  it('calls an anonymous visitor a visitor rather than an error', () => {
    expect(chatTitle(chat({ id: 'chat-1', customer_name: null }))).toBe('Visitor');
  });
});

/**
 * The rule a deep link created (13.7-q): before it, every conversation was
 * opened from the list and arrived with its name already worked out.
 */
describe('headerTitleFor', () => {
  const chats = [chat({ id: 'chat-1', customer_name: 'Dana' })];

  it('keeps the title the list pushed with, without recomputing it', () => {
    // Two sources agreeing by luck is not the same as one source. If the list
    // said something, that is the answer — even when the store has since moved.
    expect(headerTitleFor([], 'chat-1', 'Dana (VIP)')).toBe('Dana (VIP)');
    expect(headerTitleFor(chats, 'chat-1', 'Dana (VIP)')).toBe('Dana (VIP)');
  });

  it('finds the name in the inbox when the route arrived without one', () => {
    expect(headerTitleFor(chats, 'chat-1', undefined)).toBe('Dana');
  });

  it('stays generic while the inbox is still loading', () => {
    expect(headerTitleFor([], 'chat-1', undefined)).toBe(UNKNOWN_CHAT_TITLE);
  });

  it('stays generic for a conversation this agent’s list does not carry', () => {
    // Archived, assigned elsewhere, or on another page — the transcript still
    // opens, and inventing a name for it would be worse than admitting there
    // is none.
    expect(headerTitleFor(chats, 'chat-other', undefined)).toBe(UNKNOWN_CHAT_TITLE);
  });
});
