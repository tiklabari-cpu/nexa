/**
 * What renders instead of the navigator when `readMobileConfig` throws.
 *
 * Carried over from the `13.7-a` boot screen (`App.tsx` used to render this
 * inline) rather than dropped: a misconfigured `app.json` is still the single
 * most likely reason a fresh checkout shows a blank app, and the navigator
 * below needs a valid config anyway once its screens start calling the API.
 */
import { StyleSheet, Text, View } from 'react-native';

import { FONT_SIZE, SPACING } from '../theme/tokens';
import { useTheme } from '../theme/theme';

interface ConfigErrorScreenProps {
  message: string;
}

export function ConfigErrorScreen({ message }: ConfigErrorScreenProps) {
  const { colors } = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  message: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
    textAlign: 'center',
  },
});
