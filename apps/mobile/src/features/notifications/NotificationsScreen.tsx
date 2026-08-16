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
 * "İzin durumu" here is not an OS permission prompt — a phone that never
 * asked for one has no separate capability to query, and this screen does
 * not add one. It is `pushAllowed(prefs)` (`@nexa/types`), the single place
 * the master switch's effect on push is decided, named for this screen in
 * that function's own doc comment: "the sender (13.7-d), the mobile settings
 * screen (13.7-j) and the web console cannot disagree about what
 * 'notifications off' means for a phone."
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { pushAllowed } from '@nexa/types';

import { useNotificationsApi } from './context';
import type { NotificationPreferences, NotificationPreferencesPatch } from './types';
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

  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  const [saveError, setSaveError] = useState(false);
  const generation = useRef(0);

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
          hint={pushStatusHint(prefs)}
          hintTone={pushAllowed(prefs) ? 'neutral' : 'warn'}
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
 * The one line this screen must not get wrong: whether a push actually
 * reaches this handset right now. `pushAllowed` is the single source both
 * the sender (`13.7-d`) and the web console already defer to, so a "denied"
 * reading here can never disagree with what actually happens on send.
 */
function pushStatusHint(prefs: NotificationPreferences): string {
  if (pushAllowed(prefs)) {
    return 'Delivered to this phone and any other device signed in on this workspace.';
  }
  if (!prefs.enabled) return 'Off — notifications are disabled above.';
  return 'Off for this workspace.';
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
