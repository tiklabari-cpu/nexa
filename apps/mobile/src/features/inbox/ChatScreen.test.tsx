import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ChatScreen } from './ChatScreen';
import { InboxContext } from './context';
import { InboxStore } from './store';
import type { EventPage, InboxApi } from './api';
import type { ChatEvent, ChatSummary } from './types';
import { ThemeProvider } from '../../theme/theme';

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
  sent: Array<{ text: string; recipients: string }>;
  eventCalls: Array<{ beforeEventId?: string }>;
}

function fakeApi(
  options: { pages?: EventPage[]; chats?: ChatSummary[]; failSend?: Error } = {},
): Fake {
  const pages = [...(options.pages ?? [{ items: [] }])];
  const api: Fake = {
    sent: [],
    eventCalls: [],
    listChats: async () => ({ items: options.chats ?? [] }),
    listEvents: async (_chatId, opts) => {
      api.eventCalls.push({ ...(opts.beforeEventId ? { beforeEventId: opts.beforeEventId } : {}) });
      return pages.shift() ?? { items: [] };
    },
    sendEvent: async (_chatId, body) => {
      if (options.failSend) throw options.failSend;
      api.sent.push({ text: body.text ?? '', recipients: body.recipients ?? 'all' });
      return event({
        id: `THREAD1_${100 + api.sent.length}`,
        text: body.text ?? '',
        author_type: 'agent',
        author_id: 'agent-1',
        ...(body.recipients ? { recipients: body.recipients } : {}),
      });
    },
  };
  return api;
}

async function mount(store: InboxStore, chatId = 'chat-1'): Promise<void> {
  await render(
    <ThemeProvider>
      <InboxContext.Provider value={store}>
        <ChatScreen chatId={chatId} />
      </InboxContext.Provider>
    </ThemeProvider>,
  );
  // The screen loads the transcript in an effect; settle it before asserting.
  await act(async () => {});
}

describe('ChatScreen', () => {
  it('shows the conversation, newest message included', async () => {
    const api = fakeApi({
      pages: [
        {
          items: [
            event({ id: 'THREAD1_2', text: 'are you there?' }),
            event({ id: 'THREAD1_1', text: 'my order never arrived' }),
          ],
        },
      ],
    });
    await mount(new InboxStore({ api }));

    expect(screen.getByText('are you there?')).toBeOnTheScreen();
    expect(screen.getByText('my order never arrived')).toBeOnTheScreen();
  });

  it('says an empty conversation is empty rather than showing a spinner forever', async () => {
    await mount(new InboxStore({ api: fakeApi() }));

    expect(screen.getByTestId('transcript-empty')).toBeOnTheScreen();
  });

  it('offers a retry when the transcript could not be loaded', async () => {
    const api = fakeApi();
    let attempts = 0;
    api.listEvents = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Could not reach the server.');
      return { items: [event({ id: 'THREAD1_1', text: 'back again' })] };
    };
    await mount(new InboxStore({ api }));

    expect(screen.getByText('Could not reach the server.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('transcript-retry'));
    await act(async () => {});

    expect(screen.getByText('back again')).toBeOnTheScreen();
  });

  it('loads older messages when the reader scrolls back through history', async () => {
    const api = fakeApi({
      pages: [
        { items: [event({ id: 'THREAD1_9', text: 'newest' })], next_page_id: 'THREAD1_9' },
        { items: [event({ id: 'THREAD1_8', text: 'older' })] },
      ],
    });
    await mount(new InboxStore({ api }));

    // Inverted list: reaching its end is scrolling upwards into the past.
    await fireEvent(screen.getByTestId('transcript'), 'onEndReached');
    await act(async () => {});

    expect(api.eventCalls[1]).toEqual({ beforeEventId: 'THREAD1_9' });
    expect(screen.getByText('older')).toBeOnTheScreen();
  });

  it('shows a message the moment it is sent, then the server’s own copy', async () => {
    const api = fakeApi();
    const store = new InboxStore({ api, accountId: 'agent-1' });
    await mount(store);

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'on my way');
    await fireEvent.press(screen.getByTestId('composer-send'));

    // Optimistic: on a slow connection this is what stops a second send.
    expect(screen.getByText('on my way')).toBeOnTheScreen();

    await act(async () => {});
    expect(api.sent).toEqual([{ text: 'on my way', recipients: 'all' }]);
    expect(screen.getByTestId('event-THREAD1_101')).toBeOnTheScreen();
  });

  it('sends an internal note as a note, and labels it as one', async () => {
    const api = fakeApi();
    await mount(new InboxStore({ api, accountId: 'agent-1' }));

    await fireEvent.press(screen.getByTestId('composer-mode-note'));
    await fireEvent.changeText(screen.getByTestId('composer-input'), 'card declined twice');
    await fireEvent.press(screen.getByTestId('composer-send'));
    await act(async () => {});

    expect(api.sent).toEqual([{ text: 'card declined twice', recipients: 'agents' }]);
    // Sending a note to the customer by mistake is the expensive error here.
    expect(screen.getByText('Internal note — not sent to the customer')).toBeOnTheScreen();
  });

  it('will not send an empty message', async () => {
    const api = fakeApi();
    await mount(new InboxStore({ api }));

    await fireEvent.press(screen.getByTestId('composer-send'));
    await act(async () => {});

    expect(api.sent).toEqual([]);
  });

  it('says so when the send failed instead of leaving a message nobody received', async () => {
    const api = fakeApi({ failSend: new Error('Could not reach the server.') });
    await mount(new InboxStore({ api }));

    await fireEvent.changeText(screen.getByTestId('composer-input'), 'on my way');
    await fireEvent.press(screen.getByTestId('composer-send'));
    await act(async () => {});

    expect(screen.getByTestId('composer-error')).toHaveTextContent('Could not reach the server.');
    expect(screen.queryByText('on my way')).not.toBeOnTheScreen();
  });

  it('drops a pushed message straight into the open transcript', async () => {
    const api = fakeApi({ pages: [{ items: [event({ id: 'THREAD1_1', text: 'hello' })] }] });
    const store = new InboxStore({ api });
    await mount(store);

    await act(async () => {
      store.applyPush('incoming_event', {
        chat_id: 'chat-1',
        event: event({ id: 'THREAD1_2', text: 'still waiting' }),
      });
    });

    expect(screen.getByText('still waiting')).toBeOnTheScreen();
  });

  it('recovers messages missed while the connection was down', async () => {
    const api = fakeApi({ pages: [{ items: [event({ id: 'THREAD1_4', text: 'seen' })] }] });
    const store = new InboxStore({ api });
    await mount(store);

    // What a reconnect's `sync` replay looks like from the store's side: the
    // same push action, one per recovered event.
    await act(async () => {
      store.applyPush('incoming_event', {
        chat_id: 'chat-1',
        event: event({ id: 'THREAD1_5', text: 'missed one' }),
      });
      store.applyPush('incoming_event', {
        chat_id: 'chat-1',
        event: event({ id: 'THREAD1_6', text: 'missed two' }),
      });
    });

    expect(screen.getByText('missed one')).toBeOnTheScreen();
    expect(screen.getByText('missed two')).toBeOnTheScreen();
  });

  it('refuses to write to an archived conversation, and says why', async () => {
    const api = fakeApi({
      chats: [chat({ id: 'chat-1', active: false })],
      pages: [{ items: [event({ id: 'THREAD1_1' })] }],
    });
    const store = new InboxStore({ api });
    await mount(store);
    await act(async () => {
      await store.loadChats();
    });

    await waitFor(() => expect(screen.getByTestId('chat-closed')).toBeOnTheScreen());
    expect(screen.getByTestId('composer-send')).toBeDisabled();
  });
});
