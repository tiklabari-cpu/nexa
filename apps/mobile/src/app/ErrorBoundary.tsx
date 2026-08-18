/**
 * What stands between a thrown render and a white screen.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so
 * on a phone the failure mode is not a stack trace an agent can report — it is
 * an app that opens to nothing and looks broken in a way no support ticket can
 * describe. One bad `undefined.map()` in a chat row costs the entire session.
 *
 * Deliberately a single boundary at the root rather than one per screen. Finer
 * boundaries keep more of the app alive, but they also decide *for* the agent
 * that the rest is still trustworthy — and the tree they would keep is the same
 * tree the failed render was reading state from. Losing the screen and offering
 * to rebuild it is the honest answer; recovering half of it silently is not.
 *
 * It sits under `ThemeProvider` (so the fallback is the app's own colours, not
 * a bare white `View`) and *after* `ConfigErrorScreen`, which is a different
 * failure with a different answer: a missing `app.config.ts` value cannot be
 * retried, so it keeps its own screen ahead of this one.
 */
import { Component, Fragment, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FONT_SIZE, RADIUS, SPACING } from '../theme/tokens';
import { useTheme } from '../theme/theme';

export interface ErrorBoundaryProps extends PropsWithChildren {
  /** Injectable so a test can read the report instead of watching a console. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  /**
   * Bumped on every retry so the subtree is rebuilt from scratch rather than
   * re-rendered. Without it React reuses the mounted instances, and a component
   * whose own state is what threw would throw again immediately — "Try again"
   * that cannot work is worse than no button at all.
   */
  attempt: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, attempt: 0 };
  }

  static getDerivedStateFromError(error: Error): Pick<ErrorBoundaryState, 'error'> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const report = this.props.onError ?? defaultReport;
    report(error, info);
  }

  readonly #retry = (): void => {
    this.setState((previous) => ({ error: null, attempt: previous.attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.error !== null) {
      return <ErrorScreen message={this.state.error.message} onRetry={this.#retry} />;
    }
    // `key` is the remount: see `attempt`.
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

/**
 * There is no crash reporter in this build — external services are mocked
 * (MASTER-PROMPT), and shipping one would be a decision about a customer's
 * data, not a debugging convenience. So the log is the whole report, and it
 * carries the component stack: without it "something threw" names no file.
 */
function defaultReport(error: Error, info: ErrorInfo): void {
  console.error('[nexa] a screen failed to render', error, info.componentStack);
}

/**
 * Separate from the boundary because a class component cannot read a hook, and
 * the fallback is exactly where the app's colours matter most: an unstyled
 * white rectangle is indistinguishable from the crash it is reporting.
 */
function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { colors } = useTheme();

  return (
    <View testID="error-boundary" style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <Text accessibilityRole="alert" style={[styles.title, { color: colors.textPrimary }]}>
        Something went wrong
      </Text>
      {/* The message, not the stack: an agent reads this, and the stack is
          already in the log for whoever picks the report up. */}
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        {message === '' ? 'This screen could not be displayed.' : message}
      </Text>
      <Pressable
        accessibilityRole="button"
        testID="error-boundary-retry"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: pressed ? colors.brand600 : colors.brand500 },
        ]}
      >
        <Text style={[styles.buttonText, { color: colors.textInverse }]}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING[6],
    gap: SPACING[3],
  },
  title: {
    fontSize: FONT_SIZE.lg.size,
    lineHeight: FONT_SIZE.lg.lineHeight,
    fontWeight: '600',
    textAlign: 'center',
  },
  detail: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
    textAlign: 'center',
  },
  button: {
    marginTop: SPACING[2],
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[6],
    borderRadius: RADIUS.md,
  },
  buttonText: {
    fontSize: FONT_SIZE.base.size,
    lineHeight: FONT_SIZE.base.lineHeight,
    fontWeight: '600',
  },
});
