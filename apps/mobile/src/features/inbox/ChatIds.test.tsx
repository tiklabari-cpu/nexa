/**
 * The chat screen's two numbers (ID-05 · tm 329): both on screen, each copied
 * alone — a tap or a long press — and "Copied" for a moment after.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import { ChatIds } from './ChatIds';
import { ThemeProvider } from '../../theme/theme';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const setString = Clipboard.setStringAsync as jest.Mock;

async function mountIds(threadId: string | null = 'K3M9Q2XW7B'): Promise<void> {
  await render(
    <ThemeProvider>
      <ChatIds chatId="TJ1H8CFKRV" threadId={threadId} />
    </ThemeProvider>,
  );
}

describe('ChatIds', () => {
  beforeEach(() => {
    setString.mockClear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('shows the day and the open connection, each under its name', async () => {
    await mountIds();

    expect(screen.getByTestId('chat-id-day_thread')).toHaveTextContent(/^Thread ID\s*TJ1H8CFKRV/);
    expect(screen.getByTestId('chat-id-connection')).toHaveTextContent(/^Chat ID\s*K3M9Q2XW7B/);
  });

  it('copies exactly the 10 characters on a press, and again on a long press', async () => {
    await mountIds();

    await fireEvent.press(screen.getByTestId('chat-id-connection'));
    expect(setString).toHaveBeenLastCalledWith('K3M9Q2XW7B');

    await fireEvent(screen.getByTestId('chat-id-day_thread'), 'longPress');
    expect(setString).toHaveBeenLastCalledWith('TJ1H8CFKRV');
    expect(setString).toHaveBeenCalledTimes(2);
  });

  it('says "Copied" for 1.5 s, then stops', async () => {
    await mountIds();
    expect(screen.queryByText('Copied')).toBeNull();

    await fireEvent.press(screen.getByTestId('chat-id-connection'));
    await act(async () => {});
    expect(screen.getByText('Copied')).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(1_500);
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('reads each number a character at a time to a screen reader', async () => {
    await mountIds();

    expect(screen.getByTestId('chat-id-connection').props.accessibilityLabel).toBe(
      'Copy Chat ID K 3 M 9 Q 2 X W 7 B',
    );
  });

  it('shows only the day before the chat has a connection', async () => {
    await mountIds(null);

    expect(screen.getByTestId('chat-id-day_thread')).toBeOnTheScreen();
    expect(screen.queryByTestId('chat-id-connection')).toBeNull();
  });
});
