/**
 * Which workspace, for an account that belongs to more than one.
 *
 * Reached only from `SignInScreen`, and only after `/auth/login` has already
 * accepted the password — this screen spends no credential of its own until a
 * row is pressed.
 *
 * The email and password arrive as a prop rather than a route param. Navigation
 * state is a serialisable object React Navigation persists, restores and (since
 * `13.7-q` added `linking`) maps to and from URLs; a password has no business in
 * any of those. `AuthStack` holds them in component state for the length of the
 * flow, which is why this screen also has to handle arriving without them: a
 * process restart between the two steps leaves the memberships on screen and
 * nothing to open them with, and saying so beats a row that silently fails.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { AuthButton, AuthMessage, AuthShell } from './AuthShell';
import { continueWithSso, enterWorkspace, type SsoOffer } from './enter';
import { passwordWorks, type AuthSession, type PendingSignIn } from './types';
import type { Workspace } from '../../auth/session';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export interface WorkspacePickerScreenProps {
  session: AuthSession;
  /** `null` once the credentials this step needs are gone — see the note above. */
  pending: PendingSignIn | null;
  /** Back to the first step, credentials cleared. */
  onStartOver: () => void;
}

export function WorkspacePickerScreen({
  session,
  pending,
  onStartOver,
}: WorkspacePickerScreenProps) {
  const { colors } = useTheme();

  const [message, setMessage] = useState<string | null>(null);
  const [sso, setSso] = useState<SsoOffer | null>(null);
  const [busy, setBusy] = useState(false);

  if (pending === null) {
    return (
      <AuthShell testID="workspace-picker" subtitle="Choose a workspace">
        <Text
          testID="workspace-picker-expired"
          style={[styles.lead, { color: colors.textSecondary }]}
        >
          This sign-in has expired. Enter your email and password again.
        </Text>
        <AuthButton testID="workspace-picker-restart" label="Start over" onPress={onStartOver} />
      </AuthShell>
    );
  }

  const open = async (workspace: Workspace): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setSso(null);
    try {
      const result = await enterWorkspace(session, pending, workspace);
      // `signed-in` sets no state: the gate above is already unmounting this.
      if (result.status === 'sso-required') {
        setSso(result.offer);
        setMessage(result.message);
      } else if (result.status === 'failed') {
        setMessage(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const startSso = async (offer: SsoOffer): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await continueWithSso(session, offer);
      if (result.status === 'failed') setMessage(result.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell testID="workspace-picker" subtitle={`Signed in as ${pending.email}`}>
      <Text style={[styles.lead, { color: colors.textSecondary }]}>
        This account belongs to more than one workspace.
      </Text>

      {message !== null && <AuthMessage testID="workspace-picker-error" message={message} />}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {pending.memberships.map((workspace) => (
          <WorkspaceRow
            key={workspace.license_id}
            workspace={workspace}
            disabled={busy}
            onPress={() => void open(workspace)}
          />
        ))}
      </ScrollView>

      {sso !== null && (
        <AuthButton
          testID="workspace-picker-sso"
          variant="secondary"
          label="Continue with SSO"
          disabled={busy}
          onPress={() => void startSso(sso)}
        />
      )}
    </AuthShell>
  );
}

function WorkspaceRow({
  workspace,
  disabled,
  onPress,
}: {
  workspace: Workspace;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  // The role is what this account *is* here; "SSO required" replaces it when
  // that is the more useful thing to know before pressing.
  const trailing = passwordWorks(workspace) ? workspace.role : 'SSO required';

  return (
    <Pressable
      testID={`workspace-${workspace.license_id}`}
      accessibilityRole="button"
      accessibilityLabel={`${workspace.organization_name}, ${trailing}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: colors.border,
          backgroundColor: pressed ? colors.bgSurface2 : 'transparent',
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text numberOfLines={1} style={[styles.rowName, { color: colors.textPrimary }]}>
        {workspace.organization_name}
      </Text>
      <Text style={[styles.rowMeta, { color: colors.textTertiary }]}>{trailing}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
  },
  list: { maxHeight: 320 },
  listContent: { gap: SPACING[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[3],
  },
  rowName: {
    flex: 1,
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: FONT_SIZE['2xs'].weight,
  },
});
