/**
 * What the socket is doing, said out loud.
 *
 * The console can afford to keep this quiet — a desktop connection either works
 * or the whole page is obviously broken. A phone loses its connection in lifts,
 * on trains and between cells, and an agent who cannot tell "nothing has
 * happened" from "nothing is arriving" will answer a customer who has been
 * waiting five minutes. So `live` renders nothing at all and every other state
 * says which one it is.
 */
import { StyleSheet, Text, View } from 'react-native';

import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { RtmStatus } from '../../rtm/client';

const LABELS: Record<Exclude<RtmStatus, 'live'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting — messages will catch up',
  offline: 'Offline — not receiving new messages',
};

export function ConnectionBanner({ status }: { status: RtmStatus }) {
  const { colors } = useTheme();
  if (status === 'live') return null;

  const label = LABELS[status];
  return (
    <View
      accessibilityRole="alert"
      testID="connection-banner"
      style={[
        styles.banner,
        {
          backgroundColor: status === 'offline' ? colors.bgInset : colors.bgSurface2,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.text, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: SPACING[2],
    paddingHorizontal: SPACING[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
    textAlign: 'center',
  },
});
