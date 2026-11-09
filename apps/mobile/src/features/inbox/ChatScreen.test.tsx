import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ChatScreen } from './ChatScreen';
import { InboxContext } from './context';
import { InboxStore } from './store';
import type { EventPage, InboxApi } from './api';
import type { ChatEvent, ChatSummary } from './types';
import { failedSendCopy } from './failedSend';
import { replyGuardCopy } from './replyGuard';
import { ApiClientError } from '../../lib/api-client';
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

  it("marks where the member's return starts, with its number (ID-02 · tm 286.4)", async () => {
    const api = fakeApi({
      pages: [
        {
          items: [
            event({ id: 'THREAD2_1', thread_id: 'THREAD2', text: 'me again' }),
            event({ id: 'THREAD1_2', text: 'thanks, bye' }),
            event({ id: 'THREAD1_1', text: 'my order never arrived' }),
          ],
        },
      ],
    });
    await mount(new InboxStore({ api }));

    const separator = screen.getByTestId('connection-THREAD2');
    expect(separator).toHaveTextContent(/^Chat ID THREAD2 · /);
    expect(screen.queryByTestId('connection-THREAD1')).toBeNull();
  });

  it('shows the day and the open connection under the title, each copyable (ID-05 · tm 329)', async () => {
    const api = fakeApi({ pages: [{ items: [event({ id: 'THREAD1_1', text: 'hello' })] }] });
    await mount(new InboxStore({ api }));

    expect(screen.getByTestId('chat-id-day_thread')).toHaveTextContent(/^Thread IDs*chat-1/);
    expect(screen.getByTestId('chat-id-connection')).toHaveTextContent(/^Chat IDs*THREAD1/);
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

  /**
   * On a weak signal the composer has cleared before the send fails; the
   * bubble is the only copy of the reply left (tm 437 · FR-MOD-02.3.6).
   */
  describe('a send that fails (tm 437 · FR-MOD-02.3.6)', () => {
    const COPY = failedSendCopy();

    function flakyApi(failures: Error[]): Fake & { keys: Array<string | undefined> } {
      const api = Object.assign(fakeApi(), { keys: [] as Array<string | undefined> });
      const succeed = api.sendEvent;
      api.sendEvent = async (chatId, body) => {
        api.keys.push(body.idempotency_key);
        const failure = failures.shift();
        if (failure !== undefined) throw failure;
        return succeed(chatId, body);
      };
      return api;
    }

    const offline = (): ApiClientError =>
      new ApiClientError({
        type: 'network',
        status: 0,
        message: 'Could not reach the server.',
        requestId: '-',
      });

    async function sendAndFail(
      api: Fake,
      text = 'on my way',
      mode: 'reply' | 'note' = 'reply',
    ): Promise<string> {
      await mount(new InboxStore({ api, accountId: 'agent-1' }));
      if (mode === 'note') await fireEvent.press(screen.getByTestId('composer-mode-note'));
      await fireEvent.changeText(screen.getByTestId('composer-input'), text);
      await fireEvent.press(screen.getByTestId('composer-send'));
      await act(async () => {});
      const row = screen.getByTestId(/^event-send-failed-/);
      return String(row.props.testID).replace('event-send-failed-', '');
    }

    it('keeps the message on screen as not sent, with the reason, instead of losing it', async () => {
      const api = flakyApi([offline()]);
      const id = await sendAndFail(api);

      expect(screen.getByText('on my way')).toBeOnTheScreen();
      expect(screen.getByTestId(`event-send-failed-${id}`)).toHaveTextContent(
        new RegExp(`^${COPY.notSent}`),
      );
      expect(screen.getByTestId(`event-retry-${id}`)).toHaveTextContent(COPY.retry);
      expect(screen.getByTestId(`event-cancel-${id}`)).toHaveTextContent(COPY.cancel);
      expect(screen.getByTestId('composer-error')).toHaveTextContent('Could not reach the server.');
      // The words live in the bubble now, so the field is free for the next message.
      expect(screen.getByTestId('composer-input').props.value).toBe('');
    });

    it('"Try again" resends with the same key, and the bubble becomes the sent message', async () => {
      const api = flakyApi([offline()]);
      const id = await sendAndFail(api);

      await fireEvent.press(screen.getByTestId(`event-retry-${id}`));
      await act(async () => {});

      expect(api.keys).toHaveLength(2);
      expect(api.keys[1]).toBe(api.keys[0]);
      expect(api.sent).toEqual([{ text: 'on my way', recipients: 'all' }]);
      expect(screen.getByTestId('event-THREAD1_101')).toHaveTextContent(/on my way/);
      expect(screen.queryByTestId(/^event-send-failed-/)).toBeNull();
      expect(screen.queryByTestId('composer-error')).toBeNull();
    });

    it('a retry that fails again stays not sent, still offering "Try again"', async () => {
      const api = flakyApi([offline(), offline()]);
      const id = await sendAndFail(api);

      await fireEvent.press(screen.getByTestId(`event-retry-${id}`));
      await act(async () => {});

      expect(screen.getByTestId(`event-retry-${id}`)).toBeOnTheScreen();
      expect(screen.getByText('on my way')).toBeOnTheScreen();
      expect(api.keys).toEqual([api.keys[0], api.keys[0]]);
    });

    it('"Cancel" puts the text and its mode back in the composer and removes the bubble', async () => {
      const api = flakyApi([offline()]);
      const id = await sendAndFail(api, 'card declined twice', 'note');
      // The composer was left in note mode; switch away to prove Cancel restores it.
      await fireEvent.press(screen.getByTestId('composer-mode-reply'));

      await fireEvent.press(screen.getByTestId(`event-cancel-${id}`));

      expect(screen.getByTestId('composer-input').props.value).toBe('card declined twice');
      expect(screen.getByTestId('composer-mode-note')).toHaveProp('accessibilityState', {
        selected: true,
      });
      expect(screen.queryByTestId(`event-send-failed-${id}`)).toBeNull();
      expect(screen.queryByText('card declined twice', { exact: true })).toBeNull();
      expect(screen.queryByTestId('composer-error')).toBeNull();
    });

    it('"Cancel" keeps what was typed since, putting the returned message first', async () => {
      const api = flakyApi([offline()]);
      const id = await sendAndFail(api, 'on my way');
      await fireEvent.changeText(screen.getByTestId('composer-input'), 'one more thing');

      await fireEvent.press(screen.getByTestId(`event-cancel-${id}`));

      expect(screen.getByTestId('composer-input').props.value).toBe('on my way\none more thing');
    });

    it('offers only "Cancel" when the request itself was refused, so the words are never stranded', async () => {
      const api = flakyApi([
        new ApiClientError({
          type: 'validation',
          status: 400,
          message: 'Text is too long.',
          requestId: 'req-1',
        }),
      ]);
      const id = await sendAndFail(api);

      expect(screen.getByTestId(`event-send-failed-${id}`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`event-retry-${id}`)).toBeNull();
      expect(screen.getByTestId(`event-cancel-${id}`)).toBeOnTheScreen();
      expect(screen.getByTestId('composer-error')).toHaveTextContent('Text is too long.');
    });
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

  describe('reply guard (tm 475.5)', () => {
    const NOT_MINE = replyGuardCopy().notMine;

    async function mountWithList(store: InboxStore): Promise<void> {
      await mount(store);
      await act(async () => {
        await store.loadChats();
      });
    }

    it('leaves the composer open on a chat assigned to me', async () => {
      const api = fakeApi({ chats: [chat({ id: 'chat-1', assignee_id: 'agent-1' })] });
      await mountWithList(new InboxStore({ api, accountId: 'agent-1' }));

      expect(screen.queryByTestId('chat-not-mine')).toBeNull();
      await fireEvent.changeText(screen.getByTestId('composer-input'), 'on my way');
      expect(screen.getByTestId('composer-send')).toBeEnabled();
      await fireEvent.press(screen.getByTestId('composer-send'));
      await act(async () => {});

      expect(api.sent).toEqual([{ text: 'on my way', recipients: 'all' }]);
    });

    it('closes the composer on a chat assigned to somebody else, and says why', async () => {
      const api = fakeApi({ chats: [chat({ id: 'chat-1', assignee_id: 'agent-2' })] });
      await mountWithList(new InboxStore({ api, accountId: 'agent-1' }));

      expect(screen.getByTestId('chat-not-mine')).toHaveTextContent(NOT_MINE);
      expect(screen.getByTestId('composer-send')).toBeDisabled();
      expect(screen.getByTestId('composer-input').props.editable).toBe(false);
      // There is no "Take" on the phone; that happens in the console.
      expect(screen.queryByText(/^Take/)).toBeNull();
    });

    it('closes the composer when a colleague takes the open chat, and keeps what was typed', async () => {
      const api = fakeApi({ chats: [chat({ id: 'chat-1', assignee_id: 'agent-1' })] });
      const store = new InboxStore({ api, accountId: 'agent-1' });
      await mountWithList(store);
      await fireEvent.changeText(screen.getByTestId('composer-input'), 'half a sentence');

      await act(async () => {
        api.listChats = async () => ({ items: [] });
        store.applyPush('chat_taken_over', { chat_id: 'chat-1' });
      });

      expect(screen.getByTestId('chat-not-mine')).toHaveTextContent(NOT_MINE);
      expect(screen.getByTestId('composer-send')).toBeDisabled();
      expect(screen.getByTestId('composer-input').props.value).toBe('half a sentence');
    });

    it('keeps a reply the server refused (409) on screen as not sent, with no retry', async () => {
      const api = fakeApi({
        chats: [chat({ id: 'chat-1', assignee_id: 'agent-1' })],
        failSend: new ApiClientError({
          type: 'reply_requires_assignment',
          status: 409,
          message: 'Only the agent this chat is assigned to can reply to the customer.',
          requestId: 'req-1',
          details: { reason: 'assigned_to_other' },
        }),
      });
      const store = new InboxStore({ api, accountId: 'agent-1' });
      await mountWithList(store);
      api.listChats = async () => ({ items: [] });

      await fireEvent.changeText(screen.getByTestId('composer-input'), 'on my way');
      await fireEvent.press(screen.getByTestId('composer-send'));
      await act(async () => {});

      // The words did not vanish…
      expect(screen.getByText('on my way')).toBeOnTheScreen();
      expect(screen.getByTestId(/^event-not-sent-/)).toHaveTextContent(replyGuardCopy().notSent);
      // …nothing offers to send them again…
      expect(screen.queryByText(/try again|retry/i)).toBeNull();
      expect(screen.queryByTestId('composer-error')).toBeNull();
      // …and the composer says why it is closed.
      expect(screen.getByTestId('chat-not-mine')).toHaveTextContent(NOT_MINE);
      expect(screen.getByTestId('composer-send')).toBeDisabled();
    });
  });
});
