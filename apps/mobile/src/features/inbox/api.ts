/**
 * The three requests the inbox makes, as one narrow seam.
 *
 * The store is about ordering, cursors and optimistic state; it should not also
 * know path literals and query parameter names. Keeping them here means the
 * contract binding lives in one file — and it is what lets a test hand the
 * store a plain object instead of standing up a session and a fetch.
 */
import type { SessionApiClient } from '../../api/client';
import type { ChatEvent, ChatSummary, InboxView, NewEvent } from './types';

/** One screenful, and the step a scroll back through history advances by. */
export const PAGE_SIZE = 30;

export interface EventPage {
  items: ChatEvent[];
  /** Feed back as `before_event_id`; absent means the thread starts here. */
  next_page_id?: string;
}

export interface InboxApi {
  listChats(view: InboxView, signal?: AbortSignal): Promise<{ items: ChatSummary[] }>;
  /** Newest-first. `beforeEventId` walks backwards a page at a time. */
  listEvents(
    chatId: string,
    options: { beforeEventId?: string; signal?: AbortSignal },
  ): Promise<EventPage>;
  sendEvent(chatId: string, body: NewEvent): Promise<ChatEvent>;
}

export function createInboxApi(client: SessionApiClient): InboxApi {
  return {
    listChats(view, signal) {
      return client.request('get', '/chats', {
        query: { view, limit: PAGE_SIZE },
        ...(signal ? { signal } : {}),
      });
    },

    listEvents(chatId, options) {
      // `sort: newest` is what makes an inverted list correct: the first page is
      // the tail of the conversation, not its beginning, so opening a chat with
      // a thousand messages costs one page rather than thirty-four.
      return client.request('get', '/chats/{chatId}/events', {
        params: { chatId },
        query: {
          sort: 'newest',
          limit: PAGE_SIZE,
          ...(options.beforeEventId ? { before_event_id: options.beforeEventId } : {}),
        },
        ...(options.signal ? { signal: options.signal } : {}),
      });
    },

    sendEvent(chatId, body) {
      return client.request('post', '/chats/{chatId}/events', { params: { chatId }, body });
    },
  };
}
