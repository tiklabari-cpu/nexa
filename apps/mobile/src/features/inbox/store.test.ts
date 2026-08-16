/**
 * The store is where a fetched message and a pushed one become the same thing.
 * These tests are mostly about the seams where that could go wrong: an echo of
 * our own message, a replay of one already on screen, a page of history landing
 * after the reader scrolled past it.
 */
import { InboxStore } from './store';
import type { EventPage, InboxApi } from './api';
import type { ChatEvent, ChatSummary } from './types';

function event(overrides: Partial<ChatEvent> & { id: string }): ChatEvent {
  return {
    chat_id: 'chat-1',
    thread_id: 'THREAD1',
    type: 'message',
    text: 'hello',
    author_id: 'customer-1',
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-08-16T10:00:00.000Z',
    ...overrides,
  };
}

function chat(overrides: Partial<ChatSummary> & { id: string }): ChatSummary {
  return {
    customer_id: 'customer-1',
    customer_name: 'Ada',
    active: true,
    created_at: '2026-08-16T09:00:00.000Z',
    thread_id: 'THREAD1',
    assignee_id: null,
    queue_position: null,
    unread_count: 0,
    last_event: null,
    tags: [],
    ...overrides,
  };
}

interface Fake extends InboxApi {
  chats: ChatSummary[];
  pages: EventPage[];
  listCalls: number;
  eventCalls: Array<{ chatId: string; beforeEventId?: string }>;
  sent: Array<{ chatId: string; text: string; recipients: string }>;
  failListWith: Error | null;
  failSendWith: Error | null;
}

function fakeApi(initial: Partial<Fake> = {}): Fake {
  const api: Fake = {
    chats: [],
    pages: [],
    listCalls: 0,
    eventCalls: [],
    sent: [],
    failListWith: null,
    failSendWith: null,

    async listChats() {
      api.listCalls += 1;
      if (api.failListWith !== null) throw api.failListWith;
      return { items: api.chats };
    },

    async listEvents(chatId, options) {
      api.eventCalls.push({
        chatId,
        ...(options.beforeEventId ? { beforeEventId: options.beforeEventId } : {}),
      });
      return api.pages.shift() ?? { items: [] };
    },

    async sendEvent(chatId, body) {
      if (api.failSendWith !== null) throw api.failSendWith;
      api.sent.push({
        chatId,
        text: body.text ?? '',
        recipients: body.recipients ?? 'all',
      });
      return event({
        id: `THREAD1_${api.sent.length}`,
        text: body.text ?? '',
        author_type: 'agent',
      });
    },

    ...initial,
  };
  return api;
}

describe('chat list', () => {
  it('loads, and reports an empty inbox as empty rather than as a failure', async () => {
    const api = fakeApi();
    const store = new InboxStore({ api });

    await store.loadChats();

    expect(store.getState().status).toBe('ready');
    expect(store.getState().chats).toEqual([]);
    expect(store.getState().error).toBeNull();
  });

  it('surfaces a failed first load instead of showing an empty inbox', async () => {
    const api = fakeApi({ failListWith: new Error('Could not reach the server.') });
    const store = new InboxStore({ api });

    await store.loadChats();

    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toBe('Could not reach the server.');
  });

  it('keeps the chats it has when a refresh fails', async () => {
    const api = fakeApi({ chats: [chat({ id: 'chat-1' })] });
    const store = new InboxStore({ api });
    await store.loadChats();

    api.failListWith = new Error('Could not reach the server.');
    await store.loadChats({ refresh: true });

    // Rows already on screen are still true; blanking them would be a lie the
    // network told.
    expect(store.getState().chats).toHaveLength(1);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().error).toBe('Could not reach the server.');
  });

  it('seeds a cursor for every listed conversation, not only the open one', async () => {
    const cursors: Array<[string, string]> = [];
    const api = fakeApi({
      chats: [
        chat({ id: 'chat-1', last_event: event({ id: 'THREAD1_7' }) }),
        chat({ id: 'chat-2', thread_id: 'THREAD2', last_event: event({ id: 'THREAD2_2' }) }),
        chat({ id: 'chat-3' }),
      ],
    });
    const store = new InboxStore({ api, onCursor: (id, eventId) => cursors.push([id, eventId]) });

    await store.loadChats();

    // A phone that was asleep saw none of these arrive; without this the next
    // reconnect would replay only whichever chat happened to be open.
    expect(cursors).toEqual([
      ['chat-1', 'THREAD1_7'],
      ['chat-2', 'THREAD2_2'],
    ]);
  });
});

describe('transcript', () => {
  it('opens on the newest page and knows there is history behind it', async () => {
    const api = fakeApi({
      pages: [
        {
          items: [event({ id: 'THREAD1_9' }), event({ id: 'THREAD1_8' })],
          next_page_id: 'THREAD1_8',
        },
      ],
    });
    const store = new InboxStore({ api });

    await store.loadTranscript('chat-1');

    const transcript = store.transcriptOf('chat-1');
    expect(transcript.status).toBe('ready');
    expect(transcript.events.map((e) => e.id)).toEqual(['THREAD1_9', 'THREAD1_8']);
    expect(transcript.hasMore).toBe(true);
    expect(api.eventCalls[0]).toEqual({ chatId: 'chat-1' });
  });

  it('walks backwards a page at a time, from the oldest event it holds', async () => {
    const api = fakeApi({
      pages: [
        {
          items: [event({ id: 'THREAD1_9' }), event({ id: 'THREAD1_8' })],
          next_page_id: 'THREAD1_8',
        },
        { items: [event({ id: 'THREAD1_7' }), event({ id: 'THREAD1_6' })] },
      ],
    });
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    await store.loadOlder('chat-1');

    expect(api.eventCalls[1]).toEqual({ chatId: 'chat-1', beforeEventId: 'THREAD1_8' });
    expect(store.transcriptOf('chat-1').events.map((e) => e.id)).toEqual([
      'THREAD1_9',
      'THREAD1_8',
      'THREAD1_7',
      'THREAD1_6',
    ]);
    // No cursor came back, so the thread starts here.
    expect(store.transcriptOf('chat-1').hasMore).toBe(false);
  });

  it('asks for one page however many times the list says it reached the end', async () => {
    const api = fakeApi({
      pages: [
        { items: [event({ id: 'THREAD1_9' })], next_page_id: 'THREAD1_9' },
        { items: [event({ id: 'THREAD1_8' })] },
      ],
    });
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    // `onEndReached` fires repeatedly while a list settles.
    await Promise.all([
      store.loadOlder('chat-1'),
      store.loadOlder('chat-1'),
      store.loadOlder('chat-1'),
    ]);

    expect(api.eventCalls).toHaveLength(2);
    expect(store.transcriptOf('chat-1').events).toHaveLength(2);
  });

  it('refuses to ask for history that does not exist', async () => {
    const api = fakeApi({ pages: [{ items: [event({ id: 'THREAD1_1' })] }] });
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    await store.loadOlder('chat-1');

    expect(api.eventCalls).toHaveLength(1);
  });
});

describe('sending', () => {
  it('shows the message immediately and replaces it with the server’s own', async () => {
    const api = fakeApi();
    const store = new InboxStore({ api, accountId: 'agent-1' });
    await store.loadTranscript('chat-1');

    const pending = store.send('chat-1', { text: 'on my way', recipients: 'all' });

    // An agent who sees nothing happen presses send again.
    const optimistic = store.transcriptOf('chat-1').events[0];
    expect(optimistic?.text).toBe('on my way');
    expect(optimistic?.properties).toEqual({ pending: true });
    expect(store.transcriptOf('chat-1').sending).toBe(true);

    await pending;

    const settled = store.transcriptOf('chat-1').events;
    expect(settled).toHaveLength(1);
    expect(settled[0]?.id).toBe('THREAD1_1');
    expect(settled[0]?.properties).toEqual({});
    expect(store.transcriptOf('chat-1').sending).toBe(false);
  });

  it('carries an idempotency key, so a retry after a timeout is not a second message', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const api = fakeApi();
    const wrapped: InboxApi = {
      ...api,
      sendEvent: (chatId, body) => {
        bodies.push(body as Record<string, unknown>);
        return api.sendEvent(chatId, body);
      },
    };
    const store = new InboxStore({ api: wrapped });
    await store.loadTranscript('chat-1');

    await store.send('chat-1', { text: 'hello', recipients: 'all' });

    expect(typeof bodies[0]?.['idempotency_key']).toBe('string');
  });

  it('rolls the bubble back when the send fails, and says why', async () => {
    const api = fakeApi({ failSendWith: new Error('Could not reach the server.') });
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    const ok = await store.send('chat-1', { text: 'on my way', recipients: 'all' });

    // A greyed-out message that nobody received is the worst of both answers.
    expect(ok).toBe(false);
    expect(store.transcriptOf('chat-1').events).toEqual([]);
    expect(store.transcriptOf('chat-1').sendError).toBe('Could not reach the server.');
  });

  it('sends an internal note as one, not as a reply', async () => {
    const api = fakeApi();
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    await store.send('chat-1', { text: 'card was declined twice', recipients: 'agents' });

    expect(api.sent[0]?.recipients).toBe('agents');
  });

  it('refuses to send nothing', async () => {
    const api = fakeApi();
    const store = new InboxStore({ api });

    expect(await store.send('chat-1', { text: '   ', recipients: 'all' })).toBe(false);
    expect(api.sent).toEqual([]);
  });
});

describe('realtime', () => {
  it('drops a pushed message into the open transcript', async () => {
    const api = fakeApi({ pages: [{ items: [event({ id: 'THREAD1_1' })] }] });
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    store.applyPush('incoming_event', {
      chat_id: 'chat-1',
      event: event({ id: 'THREAD1_2', text: 'are you there?' }),
    });

    expect(store.transcriptOf('chat-1').events.map((e) => e.id)).toEqual([
      'THREAD1_2',
      'THREAD1_1',
    ]);
  });

  it('shows a replayed event once, not twice', async () => {
    const api = fakeApi({ pages: [{ items: [event({ id: 'THREAD1_1' })] }] });
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    const arriving = event({ id: 'THREAD1_2' });
    store.applyPush('incoming_event', { chat_id: 'chat-1', event: arriving });
    // After a reconnect the same event routinely arrives twice: once live,
    // once in the sync replay.
    store.applyPush('incoming_event', { chat_id: 'chat-1', event: arriving });

    expect(store.transcriptOf('chat-1').events).toHaveLength(2);
  });

  it('replaces our own optimistic bubble when the socket echoes it back', async () => {
    const api = fakeApi();
    const store = new InboxStore({ api, accountId: 'agent-1' });
    await store.loadTranscript('chat-1');

    const inFlight = store.send('chat-1', { text: 'on my way', recipients: 'all' });
    store.applyPush('incoming_event', {
      chat_id: 'chat-1',
      event: event({ id: 'THREAD1_1', text: 'on my way', author_type: 'agent' }),
    });
    await inFlight;

    // The agent must not see their own sentence twice.
    expect(store.transcriptOf('chat-1').events.map((e) => e.text)).toEqual(['on my way']);
    expect(store.transcriptOf('chat-1').events[0]?.id).toBe('THREAD1_1');
  });

  it('moves the conversation to the top of the list and counts it unread', async () => {
    const api = fakeApi({
      chats: [chat({ id: 'chat-1' }), chat({ id: 'chat-2', customer_name: 'Grace' })],
    });
    const store = new InboxStore({ api });
    await store.loadChats();

    store.applyPush('incoming_event', {
      chat_id: 'chat-2',
      event: event({ id: 'THREAD2_1', chat_id: 'chat-2', text: 'still waiting' }),
    });

    const chats = store.getState().chats;
    expect(chats.map((c) => c.id)).toEqual(['chat-2', 'chat-1']);
    expect(chats[0]?.unread_count).toBe(1);
    expect(chats[0]?.last_event?.text).toBe('still waiting');
  });

  it('does not badge the conversation the agent is looking at', async () => {
    const api = fakeApi({ chats: [chat({ id: 'chat-1' })] });
    const store = new InboxStore({ api });
    await store.loadChats();
    store.openChat('chat-1');

    store.applyPush('incoming_event', {
      chat_id: 'chat-1',
      event: event({ id: 'THREAD1_1', text: 'still waiting' }),
    });

    expect(store.getState().chats[0]?.unread_count).toBe(0);
  });

  it('clears the badge when the conversation is opened', async () => {
    const api = fakeApi({ chats: [chat({ id: 'chat-1', unread_count: 3 })] });
    const store = new InboxStore({ api });
    await store.loadChats();

    store.openChat('chat-1');

    expect(store.getState().chats[0]?.unread_count).toBe(0);
  });

  it('refetches a transcript the gateway could not replay', async () => {
    const api = fakeApi({
      pages: [{ items: [event({ id: 'THREAD1_1' })] }, { items: [event({ id: 'THREAD1_40' })] }],
    });
    const store = new InboxStore({ api });
    await store.loadTranscript('chat-1');

    store.applyPush('sync_truncated', { chat_id: 'chat-1' });
    await Promise.resolve();
    await Promise.resolve();

    // A transcript with an invisible hole in it is worse than a spinner.
    expect(api.eventCalls).toHaveLength(2);
  });

  it('forgets a conversation it can no longer see', async () => {
    const forgotten: string[] = [];
    const api = fakeApi({ chats: [chat({ id: 'chat-1' }), chat({ id: 'chat-2' })] });
    const store = new InboxStore({ api, onChatForgotten: (id) => forgotten.push(id) });
    await store.loadChats();
    await store.loadTranscript('chat-1');

    store.applyPush('chat_unfollowed', { chat_id: 'chat-1' });

    expect(store.getState().chats.map((c) => c.id)).toEqual(['chat-2']);
    expect(store.transcriptOf('chat-1').status).toBe('idle');
    expect(forgotten).toEqual(['chat-1']);
  });

  it('refetches the list rather than inventing a row for an unknown chat', async () => {
    const api = fakeApi({ chats: [chat({ id: 'chat-1' })] });
    const store = new InboxStore({ api });
    await store.loadChats();

    store.applyPush('incoming_event', {
      chat_id: 'chat-unknown',
      event: event({ id: 'THREAD9_1', chat_id: 'chat-unknown' }),
    });
    await Promise.resolve();

    expect(api.listCalls).toBe(2);
  });

  it('reports the connection so a screen can say the inbox is stale', () => {
    const store = new InboxStore({ api: fakeApi() });

    store.setConnection('reconnecting');

    expect(store.getState().connection).toBe('reconnecting');
  });
});
