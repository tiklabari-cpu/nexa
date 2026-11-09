import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CANNOT_CONNECT, LoadingScreen, RESTORE_RETRY_OFFER_MS, TRY_AGAIN } from './LoadingScreen';
import { ThemeProvider } from '../../theme/theme';

/**
 * The launch screen's second sentence (tm 435 · F17): after a few seconds of
 * not deciding, it says it cannot connect and offers a retry — but only where
 * it was given one to offer.
 */
describe('LoadingScreen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('offers "Try again" after five seconds, and pressing it retries', async () => {
    const onRetry = jest.fn();
    await render(
      <ThemeProvider>
        <LoadingScreen onRetry={onRetry} />
      </ThemeProvider>,
    );

    expect(screen.getByText('Opening SiyahTuş…')).toBeOnTheScreen();
    await act(() => jest.advanceTimersByTimeAsync(RESTORE_RETRY_OFFER_MS - 1));
    expect(screen.queryByTestId('session-retry')).not.toBeOnTheScreen();

    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(screen.getByText(CANNOT_CONNECT)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: TRY_AGAIN })).toBeOnTheScreen();
    expect(screen.queryByText('Opening SiyahTuş…')).not.toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('session-retry'));
    await fireEvent.press(screen.getByTestId('session-retry'));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('never offers a retry it was not given (the navigator’s link fallback)', async () => {
    await render(
      <ThemeProvider>
        <LoadingScreen />
      </ThemeProvider>,
    );

    await act(() => jest.advanceTimersByTimeAsync(RESTORE_RETRY_OFFER_MS * 3));
    expect(screen.queryByTestId('session-retry')).not.toBeOnTheScreen();
    expect(screen.getByText('Opening SiyahTuş…')).toBeOnTheScreen();
  });

  it('clears its timer when it unmounts before the five seconds are up', async () => {
    const setTimer = jest.spyOn(globalThis, 'setTimeout');
    const clearTimer = jest.spyOn(globalThis, 'clearTimeout');
    const { unmount } = await render(
      <ThemeProvider>
        <LoadingScreen onRetry={jest.fn()} />
      </ThemeProvider>,
    );
    const offer = setTimer.mock.calls.findIndex(([, ms]) => ms === RESTORE_RETRY_OFFER_MS);
    expect(offer).toBeGreaterThanOrEqual(0);
    const id = setTimer.mock.results[offer]!.value;

    await unmount();
    expect(clearTimer).toHaveBeenCalledWith(id);
  });
});
