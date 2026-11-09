/**
 * The launch gap: the app is running, the session is not decided yet.
 *
 * `MobileSession.restore()` reads the protected store and, if there is a
 * refresh token, spends a round trip renewing it — a second or two on a train.
 * Rendering the sign-in form during that window would flash a password box at
 * somebody who is already signed in and, worse, invite them to start typing
 * into a form that is about to be replaced. Rendering the inbox would be the
 * opposite lie. So this says neither.
 *
 * Until it has waited long enough to say something else (tm 435 · F17). A
 * launch with no signal, or against a server answering 503, cannot decide — the
 * session keeps trying on its own (`auth/restore-retry.ts`), but a spinner that
 * never ends reads as a hung app. After `RESTORE_RETRY_OFFER_MS` the screen
 * admits it cannot connect and offers "Try again"; only the launch gap gets the
 * button (`onRetry`), not the navigator's link-resolution fallback, which is
 * the same picture for a different and much shorter wait.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AuthButton } from './AuthShell';
import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

/** How long the launch screen waits before it offers a manual retry. */
export const RESTORE_RETRY_OFFER_MS = 5_000;

/** What the screen says once the wait has gone on too long. */
export const CANNOT_CONNECT = 'Can’t connect to SiyahTuş. Still trying…';
export const TRY_AGAIN = 'Try again';

export interface LoadingScreenProps {
  /** Supplied for the launch gap: shown as "Try again" after `RESTORE_RETRY_OFFER_MS`. */
  onRetry?: () => void;
}

export function LoadingScreen({ onRetry }: LoadingScreenProps = {}) {
  const { colors } = useTheme();
  const [offerRetry, setOfferRetry] = useState(false);

  useEffect(() => {
    if (onRetry === undefined) return undefined;
    const timer = setTimeout(() => setOfferRetry(true), RESTORE_RETRY_OFFER_MS);
    return () => clearTimeout(timer);
  }, [onRetry]);

  return (
    <View testID="session-loading" style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      {/* The role sits on the spinner, not the screen: a container announced as
          a progress bar can swallow the button below it into one element. */}
      <ActivityIndicator
        accessibilityRole="progressbar"
        accessibilityLabel="Opening SiyahTuş"
        color={colors.brand500}
      />
      {offerRetry && onRetry !== undefined ? (
        <>
          <Text
            testID="session-cannot-connect"
            accessibilityRole="alert"
            style={[styles.label, { color: colors.textSecondary }]}
          >
            {CANNOT_CONNECT}
          </Text>
          <AuthButton testID="session-retry" label={TRY_AGAIN} onPress={onRetry} />
        </>
      ) : (
        <Text style={[styles.label, { color: colors.textSecondary }]}>Opening SiyahTuş…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING[3],
    padding: SPACING[6],
  },
  label: {
    textAlign: 'center',
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
  },
});
