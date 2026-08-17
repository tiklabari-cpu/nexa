/**
 * Settings → Account (13.7-r) — who is signed in, on which workspace, and the
 * two ways to stop being that account: sign out, or switch to another one.
 *
 * `MobileSession.signIn` / `signInWithSso` / `signOut` had zero production
 * callers until `13.7-p` gave the app a door in; `signOut` and `switchAccount`
 * still had none — §D111 found nothing on the phone ever called them. This
 * screen is the caller for the first (`onSignOut`, threaded down from
 * `SettingsStack` rather than reached through `useServices()` here, the same
 * way `TeamMemberScreen` takes its `agent` as a prop — a screen with no
 * network call of its own has nothing to gain from a context, and plenty to
 * gain from being testable with plain props). It is only a *sender* for the
 * second: pressing "Switch account" spends no credential and closes nothing
 * by itself, because this screen holds none to spend. It only navigates to
 * `AuthStack` in `'switch'` mode (`onSwitchAccount`), and it is that screen —
 * reached while still signed in, exactly the way `SwitchAccount` is wired in
 * `SettingsStack` — whose eventual submit calls `session.switchAccount`
 * (§C-A31: revoke the outgoing account's push token before the incoming one
 * registers). Signing out outright is the one destructive thing this screen
 * triggers, which is why it is the one action here that asks first.
 *
 * Every field is read straight off `sessionState.principal` — no second
 * request. `organization_name` reached that object because `/auth/me` did not
 * carry it before this task (13.7-r's own gap): the console reads a
 * workspace's name once, off `/auth/login`'s membership list, and never
 * revisits it, but a long-lived mobile session has nowhere else to ask.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AuthButton } from '../auth/AuthShell';
import type { SessionPrincipal } from '../../auth/session';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ColorTokens } from '../../theme/tokens';

export interface AccountScreenProps {
  principal: SessionPrincipal | null;
  onSignOut: () => Promise<void>;
  /** `SettingsStack` pushes `AuthStack` in `'switch'` mode (13.7-r). */
  onSwitchAccount: () => void;
}

export function AccountScreen({ principal, onSignOut, onSwitchAccount }: AccountScreenProps) {
  const { colors } = useTheme();

  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await onSignOut();
      // No further state to set: the session has already moved, and
      // `RootNavigator`'s gate is unmounting this screen along with the rest
      // of the signed-in tree the moment its status flips.
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="account-screen"
    >
      <View
        testID="account-identity"
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <Field testID="account-name" label="Name" value={principal?.name ?? '—'} colors={colors} />
        <Field
          testID="account-email"
          label="Email"
          value={principal?.email ?? '—'}
          colors={colors}
        />
        <Field
          testID="account-workspace"
          label="Workspace"
          value={principal?.organization_name ?? '—'}
          colors={colors}
        />
        <Field testID="account-role" label="Role" value={principal?.role ?? '—'} colors={colors} />
      </View>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <AuthButton
          testID="account-switch"
          variant="secondary"
          label="Switch account"
          disabled={confirmingSignOut}
          onPress={onSwitchAccount}
        />

        {!confirmingSignOut ? (
          <AuthButton
            testID="account-sign-out"
            variant="secondary"
            label="Sign out"
            onPress={() => setConfirmingSignOut(true)}
          />
        ) : (
          <View style={styles.confirm} testID="account-sign-out-confirm-group">
            <Text
              accessibilityRole="alert"
              style={[styles.confirmText, { color: colors.textSecondary }]}
            >
              Sign out of this workspace on this phone?
            </Text>
            <AuthButton
              testID="account-sign-out-confirm"
              label={signingOut ? 'Signing out…' : 'Sign out'}
              disabled={signingOut}
              onPress={() => void signOut()}
            />
            <AuthButton
              testID="account-sign-out-cancel"
              variant="secondary"
              label="Cancel"
              disabled={signingOut}
              onPress={() => setConfirmingSignOut(false)}
            />
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Field({
  testID,
  label,
  value,
  colors,
}: {
  testID: string;
  label: string;
  value: string;
  colors: ColorTokens;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text testID={testID} style={[styles.fieldValue, { color: colors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: SPACING[4], gap: SPACING[4] },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[3],
    gap: SPACING[3],
  },
  field: { gap: 2 },
  fieldLabel: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
  fieldValue: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  confirm: { gap: SPACING[2] },
  confirmText: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
});
