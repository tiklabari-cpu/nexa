/**
 * Notification preferences (FR-MOD-08.2 · FR-MOD-13.8) — the phone's window
 * onto the same account-level preference the web console's
 * `NotificationSettings` reads and writes. One dictionary, `@nexa/types`'s
 * `NotificationPreferences` — no parallel model, per FR-MOD-13.8's "kanallar
 * arası tutarlı" acceptance criterion, so every channel the console shows is
 * shown here too.
 *
 * This screen manages the *preference* only. It does not register or revoke
 * this handset's push token — that lifecycle is `13.7-b`'s
 * (`auth/device-token.ts`), on purpose: a failed revoke at sign-out or
 * account switch is a cross-tenant delivery risk, an isolation decision, not
 * a settings-screen one (13.7-j KAPSAM).
 *
 * "İzin durumu" is two questions, not one, and `13.7-l` is where the second
 * one arrived. `pushAllowed(prefs)` (`@nexa/types`) is what the *account*
 * asked for — the single place the master switch's effect on push is decided,
 * named for this screen in that function's own doc comment: "the sender
 * (13.7-d), the mobile settings screen (13.7-j) and the web console cannot
 * disagree about what 'notifications off' means for a phone." What it cannot
 * see is whether this *handset* will show anything, which is the operating
 * system's answer and overrules the account's. A screen that reported only the
 * first would show "on" to somebody who has denied Nexa notifications in iOS
 * Settings and will never be interrupted — the one failure a settings screen
 * must not have, because the person has no way to discover it.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { pushAllowed } from '@nexa/types';

import { useDevicePushPermission, useNotificationsApi } from './context';
import type { NotificationPreferences, NotificationPreferencesPatch } from './types';
import type { PushPermission } from '../../auth/push-tokens';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ColorTokens } from '../../theme/tokens';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; prefs: NotificationPreferences };

export function NotificationsScreen() {
  const { colors } = useTheme();
  const api = useNotificationsApi();

  const readDevicePermission = useDevicePushPermission();

  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [saveError, setSaveError] = useState(false);
  /** `null` until the device has answered — and on a build that cannot ask. */
  const [devicePermission, setDevicePermission] = useState<PushPermission | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (readDevicePermission === null) return;
    let live = true;
    readDevicePermission()
      .then((permission) => {
        if (live) setDevicePermission(permission);
      })
      .catch(() => {
        // Not knowing is not a refusal; leaving it null keeps the screen quiet
        // rather than accusing the phone of blocking something.
        if (live) setDevicePermission(null);
      });
    return () => {
      live = false;
    };
  }, [readDevicePermission]);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState({ status: 'loading' });

    api
      .getPreferences(controller.signal)
      .then((prefs) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', prefs });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load your preferences.',
        });
      });

    return () => controller.abort();
  }, [api]);

  // Optimistic, with a rollback on failure — the same shape the web
  // console's `setNotificationPreferences` uses, so a switch on this screen
  // never ends up lying about what the account actually holds.
  async function update(patch: NotificationPreferencesPatch): Promise<void> {
    if (state.status !== 'ready') return;
    const previous = state.prefs;
    setState({ status: 'ready', prefs: { ...previous, ...patch } });
    setSaveError(false);
    try {
      const confirmed = await api.updatePreferences(patch);
      setState({ status: 'ready', prefs: confirmed });
    } catch {
      setState({ status: 'ready', prefs: previous });
      setSaveError(true);
    }
  }

  if (state.status === 'loading') {
    return (
      <View
        style={[styles.centre, { backgroundColor: colors.bgCanvas }]}
        testID="notifications-loading"
      >
        <Text style={[styles.message, { color: colors.textTertiary }]}>Loading…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View
        style={[styles.centre, { backgroundColor: colors.bgCanvas }]}
        testID="notifications-error"
      >
        <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
          {state.message}
        </Text>
      </View>
    );
  }

  const { prefs } = state;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="notification-settings"
    >
      <Text style={[styles.description, { color: colors.textTertiary }]}>
        How you are alerted to a new chat, an assignment or a mention. These follow your account on
        this workspace.
      </Text>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <Row
          label="Enable notifications"
          hint={
            saveError
              ? 'Could not save — please try again.'
              : 'Turning this off silences sound, push and desktop alerts alike. Email still reaches you.'
          }
          hintTone={saveError ? 'danger' : 'neutral'}
          value={prefs.enabled}
          onValueChange={(value) => void update({ enabled: value })}
          testID="notification-toggle-enabled"
        />
        <Row
          label="Play a sound"
          hint="A short chime when a visitor writes in."
          value={prefs.sound}
          disabled={!prefs.enabled}
          onValueChange={(value) => void update({ sound: value })}
          testID="notification-toggle-sound"
        />
        <Row
          label="Push notifications"
          hint={pushStatusHint(prefs, devicePermission)}
          hintTone={pushReaches(prefs, devicePermission) ? 'neutral' : 'warn'}
          value={prefs.push}
          disabled={!prefs.enabled}
          onValueChange={(value) => void update({ push: value })}
          testID="notification-toggle-push"
        />
        <Row
          label="Desktop notifications"
          hint="Shown on the web console — still gated on that browser's own permission."
          value={prefs.desktop}
          disabled={!prefs.enabled}
          onValueChange={(value) => void update({ desktop: value })}
          testID="notification-toggle-desktop"
        />
        <Row
          label="Email notifications"
          hint="Emailed when a chat assigned to you has new activity, even when Nexa is closed."
          value={prefs.email}
          onValueChange={(value) => void update({ email: value })}
          testID="notification-toggle-email"
          last
        />
      </View>
    </ScrollView>
  );
}

/**
 * Whether a push would actually arrive on this handset right now.
 *
 * Two gates, and both have to be open. `pushAllowed` is the account's, the
 * single source the sender (`13.7-d`) and the web console already defer to, so
 * this half can never disagree with what happens on send. The device's is the
 * other half, and it is the one the server cannot see: the operating system
 * shows nothing regardless of what the account asked for.
 *
 * `null` — not yet read, or a build that cannot ask — counts as open. The
 * alternative is a warning that flashes on every mount before the device has
 * answered, which trains people to ignore the one that means something.
 */
function pushReaches(prefs: NotificationPreferences, device: PushPermission | null): boolean {
  return pushAllowed(prefs) && !deviceBlocksPush(device);
}

function deviceBlocksPush(device: PushPermission | null): boolean {
  return device === 'denied' || device === 'undetermined';
}

/**
 * The one line this screen must not get wrong: why a push will or will not
 * arrive. Ordered from the switch furthest from the person's control to the
 * nearest, so the sentence names the thing they would have to change.
 */
function pushStatusHint(prefs: NotificationPreferences, device: PushPermission | null): string {
  if (!prefs.enabled) return 'Off — notifications are disabled above.';
  if (!prefs.push) return 'Off for this workspace.';
  if (deviceBlocksPush(device)) {
    // The state 13.7-j could not report: on for the account, silent on the
    // handset. Says where the switch is, because it is not on this screen.
    return 'On for this workspace, but this phone is not allowing Nexa to notify you — turn notifications on in your device settings.';
  }
  return 'Delivered to this phone and any other device signed in on this workspace.';
}

function Row({
  label,
  hint,
  hintTone = 'neutral',
  value,
  disabled = false,
  onValueChange,
  testID,
  last = false,
}: {
  label: string;
  hint: string;
  hintTone?: 'neutral' | 'danger' | 'warn';
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  testID: string;
  last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>{label}</Text>
        <Text style={[styles.rowHint, { color: hintColor(colors, hintTone) }]}>{hint}</Text>
      </View>
      <Switch
        testID={testID}
        value={value}
        disabled={disabled}
        // A disabled switch must not be toggle-able even if something drives
        // an event straight at it — real hardware already refuses the touch,
        // this keeps the state machine honest about that same rule.
        onValueChange={disabled ? undefined : onValueChange}
        trackColor={{ false: colors.bgInset, true: colors.brand500 }}
        thumbColor={colors.bgSurface}
      />
    </View>
  );
}

function hintColor(colors: ColorTokens, tone: 'neutral' | 'danger' | 'warn'): string {
  if (tone === 'danger') return colors.danger;
  if (tone === 'warn') return colors.warning;
  return colors.textTertiary;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: SPACING[4], gap: SPACING[4] },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  message: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    textAlign: 'center',
  },
  description: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  card: { borderWidth: 1, borderRadius: RADIUS.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING[3], padding: SPACING[4] },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight, fontWeight: '600' },
  rowHint: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
});
