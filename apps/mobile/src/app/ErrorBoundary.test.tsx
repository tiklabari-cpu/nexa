/**
 * The property here is not "an error is displayed" — it is that the app is
 * still on screen afterwards. A render that throws past every boundary unmounts
 * the whole tree, and on a phone that is not a stack trace anybody can report:
 * it is an app that opens to nothing.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ErrorBoundary } from './ErrorBoundary';
import { ThemeProvider } from '../theme/theme';

/** Throws while `shouldThrow` says to, so a test can stop the fault and retry. */
const state = { shouldThrow: true };

function Fragile() {
  if (state.shouldThrow) throw new Error('chat row exploded');
  return <Text>the inbox</Text>;
}

function mount(onError = jest.fn()) {
  return {
    onError,
    tree: (
      <ThemeProvider>
        <ErrorBoundary onError={onError}>
          <Fragile />
        </ErrorBoundary>
      </ThemeProvider>
    ),
  };
}

beforeEach(() => {
  state.shouldThrow = true;
  // React itself logs every caught error; the suite is testing the boundary,
  // not React's logging, and the noise would drown the real failures.
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  it('gets out of the way when nothing throws', async () => {
    state.shouldThrow = false;
    const { tree } = mount();

    await render(tree);

    expect(screen.getByText('the inbox')).toBeOnTheScreen();
    expect(screen.queryByTestId('error-boundary')).not.toBeOnTheScreen();
  });

  it('shows a screen instead of unmounting the app', async () => {
    const { tree } = mount();

    await render(tree);

    expect(screen.getByTestId('error-boundary')).toBeOnTheScreen();
    expect(screen.getByText('Something went wrong')).toBeOnTheScreen();
    // The message, so a report says which screen — a bare apology names nothing.
    expect(screen.getByText('chat row exploded')).toBeOnTheScreen();
  });

  it('reports what broke, with the component stack', async () => {
    const { tree, onError } = mount();

    await render(tree);

    expect(onError).toHaveBeenCalledTimes(1);
    const [error, info] = onError.mock.calls[0] as [Error, { componentStack?: string | null }];
    expect(error.message).toBe('chat row exploded');
    expect(info.componentStack).toContain('Fragile');
  });

  it('rebuilds the subtree when the agent tries again', async () => {
    const { tree } = mount();
    await render(tree);

    // Whatever was wrong is over — a lost connection, a half-written cache.
    state.shouldThrow = false;
    await fireEvent.press(screen.getByTestId('error-boundary-retry'));

    expect(screen.getByText('the inbox')).toBeOnTheScreen();
    expect(screen.queryByTestId('error-boundary')).not.toBeOnTheScreen();
  });

  it('catches the next failure too, rather than retrying once and giving up', async () => {
    const { tree } = mount();
    await render(tree);

    // Still broken. "Try again" that silently white-screens the second time is
    // worse than one that keeps saying so.
    await fireEvent.press(screen.getByTestId('error-boundary-retry'));

    expect(screen.getByTestId('error-boundary')).toBeOnTheScreen();
  });
});
