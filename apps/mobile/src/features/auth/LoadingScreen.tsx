/**
 * The launch gap: the app is running, the session is not decided yet.
 *
 * `MobileSession.restore()` reads the protected store and, if there is a
 * refresh token, spends a round trip renewing it — a second or two on a train.
 * Rendering the sign-in form during that window would flash a password box at
 * somebody who is already signed in and, worse, invite them to start typing
 * into a form that is about to be replaced. Rendering the inbox would be the
 * opposite lie. So this says neither.
 */
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export function LoadingScreen() {
  const { colors } = useTheme();

  return (
    <View
      testID="session-loading"
      accessibilityRole="progressbar"
      accessibilityLabel="Opening Nexa"
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
    >
      <ActivityIndicator color={colors.brand500} />
      <Text style={[styles.label, { color: colors.textSecondary }]}>Opening Nexa…</Text>
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
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
  },
});
