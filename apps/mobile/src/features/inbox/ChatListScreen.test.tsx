import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ChatListScreen } from './ChatListScreen';
import { InboxContext } from './context';
import { InboxStore } from './store';
import type { InboxApi } from './api';
import type { ChatEvent, ChatSummary } from './types';
import { ThemeProvider } from '../../theme/theme';

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

function api(overrides: Partial<InboxApi> = {}): InboxApi {
  return {
    listChats: async () => ({ items: [] }),
    listEvents: async () => ({ items: [] }),
    sendEvent: async () => event({ id: 'THREAD1_1' }),
    ...overrides,
  };
}

/**
 * RNTL v14 renders through a concurrent root, so `render` and `fireEvent`
 * return promises — an un-awaited one leaves `screen` empty rather than
 * failing loudly.
 */
async function mount(
  store: InboxStore,
  onOpenChat = jest.fn(),
): Promise<{ onOpenChat: jest.Mock }> {
  const tree: ReactElement = (
    <ThemeProvider>
      <InboxContext.Provider value={store}>
        <ChatListScreen onOpenChat={onOpenChat} />
      </InboxContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  // Then let the first load — which the screen kicks off in an effect — settle
  // inside `act`, so the assertions see the answer rather than the spinner.
  await act(async () => {});
  return { onOpenChat };
}

describe('ChatListScreen', () => {
  it('says the inbox is empty rather than showing a blank rectangle', async () => {
    await mount(new InboxStore({ api: api() }));

    expect(await screen.findByText('No conversations here yet.')).toBeOnTheScreen();
  });

  it('says what went wrong when the list could not be loaded', async () => {
    const store = new InboxStore({
      api: api({
        listChats: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    });
    await mount(store);

    // "Nothing is waiting for you" and "we could not ask" must not look alike.
    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('lists conversations with their last message and unread count', async () => {
    const store = new InboxStore({
      api: api({
        listChats: async () => ({
          items: [
            chat({
              id: 'chat-1',
              customer_name: 'Ada',
              unread_count: 2,
              last_event: event({ id: 'THREAD1_4', text: 'my order never arrived' }),
            }),
          ],
        }),
      }),
    });
    await mount(store);

    expect(await screen.findByText('Ada')).toBeOnTheScreen();
    expect(screen.getByText('my order never arrived')).toBeOnTheScreen();
    expect(screen.getByLabelText('2 unread')).toBeOnTheScreen();
  });

  it('names an anonymous visitor rather than showing a blank row', async () => {
    const store = new InboxStore({
      api: api({
        listChats: async () => ({ items: [chat({ id: 'chat-1', customer_name: null })] }),
      }),
    });
    await mount(store);

    expect(await screen.findByText('Visitor')).toBeOnTheScreen();
  });

  it('marks an internal note as one in the preview', async () => {
    const store = new InboxStore({
      api: api({
        listChats: async () => ({
          items: [
            chat({
              id: 'chat-1',
              last_event: event({
                id: 'THREAD1_4',
                text: 'refunded manually',
                recipients: 'agents',
              }),
            }),
          ],
        }),
      }),
    });
    await mount(store);

    // The preview is the one place a note could pass for something the customer
    // saw, so it says which it is.
    expect(await screen.findByText('Note: refunded manually')).toBeOnTheScreen();
  });

  it('opens the conversation that was tapped', async () => {
    const store = new InboxStore({
      api: api({
        listChats: async () => ({ items: [chat({ id: 'chat-7', customer_name: 'Grace' })] }),
      }),
    });
    const { onOpenChat } = await mount(store);

    await fireEvent.press(await screen.findByTestId('chat-row-chat-7'));

    expect(onOpenChat).toHaveBeenCalledWith({ chatId: 'chat-7', title: 'Grace' });
  });

  it('shows a new message arriving over the socket, at the top of the list', async () => {
    const store = new InboxStore({
      api: api({
        listChats: async () => ({
          items: [
            chat({ id: 'chat-1', customer_name: 'Ada' }),
            chat({ id: 'chat-2', customer_name: 'Grace' }),
          ],
        }),
      }),
    });
    await mount(store);
    await screen.findByText('Ada');

    await act(async () => {
      store.applyPush('incoming_event', {
        chat_id: 'chat-2',
        event: event({ id: 'THREAD2_1', chat_id: 'chat-2', text: 'still waiting' }),
      });
    });

    await waitFor(() => expect(screen.getByText('still waiting')).toBeOnTheScreen());
    expect(screen.getByLabelText('1 unread')).toBeOnTheScreen();
  });

  it('says the socket is away instead of letting a stale list look current', async () => {
    const store = new InboxStore({ api: api() });
    await mount(store);
    await screen.findByText('No conversations here yet.');

    await act(async () => store.setConnection('reconnecting'));

    await waitFor(() =>
      expect(screen.getByTestId('connection-banner')).toHaveTextContent(
        'Reconnecting — messages will catch up',
      ),
    );
  });

  it('says nothing at all when the connection is healthy', async () => {
    const store = new InboxStore({ api: api() });
    await mount(store);
    await screen.findByText('No conversations here yet.');

    await act(async () => store.setConnection('live'));

    await waitFor(() => expect(screen.queryByTestId('connection-banner')).not.toBeOnTheScreen());
  });
});
