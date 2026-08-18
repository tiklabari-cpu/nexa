/**
 * What the connection is doing, said out loud.
 *
 * The console can afford to keep this quiet — a desktop connection either works
 * or the whole page is obviously broken. A phone loses its connection in lifts,
 * on trains and between cells, and an agent who cannot tell "nothing has
 * happened" from "nothing is arriving" will answer a customer who has been
 * waiting five minutes. So a healthy connection renders nothing at all and
 * every other state says which one it is.
 *
 * Two sources, one band (`13.7-v`). The socket's own status is the finer
 * signal — it knows the difference between a first dial and a resumption — but
 * it is not the *whole* signal: an agent whose radio is gone still has a REST
 * layer failing every request, and the socket, backing off between attempts,
 * says only "reconnecting", which reads as a hiccup. When the network itself is
 * the problem that fact outranks whatever the socket is doing, so it is checked
 * first and it carries the one thing the socket cannot say: when this screen
 * was last true.
 */
import { StyleSheet, Text, View } from 'react-native';

import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useConnectivity } from '../../lib/connectivity';
import { useTheme } from '../../theme/theme';
import type { RtmStatus } from '../../rtm/client';

const LABELS: Record<Exclude<RtmStatus, 'live'>, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting — messages will catch up',
  offline: 'Offline — not receiving new messages',
};

export function ConnectionBanner({ status }: { status: RtmStatus }) {
  const { colors } = useTheme();
  const { online, lastReachableAt } = useConnectivity();

  const offline = !online;
  const label = offline
    ? noNetworkLabel(lastReachableAt)
    : status === 'live'
      ? null
      : LABELS[status];
  if (label === null) return null;

  return (
    <View
      accessibilityRole="alert"
      testID="connection-banner"
      style={[
        styles.banner,
        {
          backgroundColor: offline || status === 'offline' ? colors.bgInset : colors.bgSurface2,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.text, { color: offline ? colors.warning : colors.textSecondary }]}>
        {label}
      </Text>
    </View>
  );
}

/**
 * "No network" on its own invites the wrong question ("is this list current?").
 * The timestamp answers it, and is omitted rather than faked when the app has
 * not reached the server once since launch — there is no last-known-good to
 * name, and "last updated 00:00" would be a worse answer than none.
 */
function noNetworkLabel(lastReachableAt: number | null): string {
  if (lastReachableAt === null) return 'No network — nothing has loaded yet';
  const at = new Date(lastReachableAt).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `No network — last updated ${at}`;
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
