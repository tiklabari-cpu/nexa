/**
 * Sign-in — the screen the phone did not have.
 *
 * `13.7-b` built the whole token flow and `13.7-e`…`-o` built four surfaces on
 * top of it, and nothing ever called `signIn`: a cold launch mounted the inbox,
 * the inbox asked for `/chats` without a token, and the person was left reading
 * a 401 with no way forward (§D111). This is that way forward, and it adds no
 * second route to a credential — every line below ends in `MobileSession`.
 *
 * Two steps, like the console's own (`apps/web/src/features/auth/SignInPage.tsx`):
 * `/auth/login` says which workspaces this password opens, and only then is one
 * of them entered. Picking afterwards would be worse — the agent would land in
 * the wrong inbox and have to work out why — and the step is skipped entirely
 * when there is only one.
 *
 * A workspace that federates sign-in is offered its own door rather than a
 * refusal (`enter.ts`). Pressing it is `13.7-q`'s wiring; until that lands the
 * session has no browser and says so, which is a sentence somebody can act on.
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthButton, AuthMessage, AuthShell } from './AuthShell';
import { continueWithSso, enterWorkspace, type SsoOffer } from './enter';
import { signInErrorMessage } from './messages';
import type { AuthSession, PendingSignIn } from './types';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export interface SignInScreenProps {
  session: AuthSession;
  /** More than one workspace: the stack takes it from here (`AuthStack`). */
  onChooseWorkspace: (pending: PendingSignIn) => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

export function SignInScreen({ session, onChooseWorkspace }: SignInScreenProps) {
  const { colors } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [sso, setSso] = useState<SsoOffer | null>(null);
  const [busy, setBusy] = useState(false);

  // Both filled is the bar for enabling the button; whether the address *looks*
  // like one is checked on submit, so nobody is told they typed it wrong while
  // they are still typing it.
  const ready = email.trim() !== '' && password !== '' && !busy;

  const submit = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!looksLikeEmail(trimmed)) {
      setFieldErrors({ email: 'Enter a valid email address.' });
      return;
    }

    setFieldErrors({});
    setMessage(null);
    setSso(null);
    setBusy(true);

    try {
      const memberships = await session.listWorkspaces(trimmed, password);

      if (memberships.length === 0) {
        setMessage('This account is not a member of any workspace.');
        return;
      }

      if (memberships.length > 1) {
        onChooseWorkspace({ email: trimmed, password, memberships });
        return;
      }

      const result = await enterWorkspace(session, { email: trimmed, password }, memberships[0]!);
      // `signed-in` sets no state on purpose: the session has already moved, so
      // the gate in `RootNavigator` is unmounting this screen. Leaving the
      // button in its busy state for those few frames is the honest picture.
      if (result.status === 'sso-required') {
        setSso(result.offer);
        setMessage(result.message);
      } else if (result.status === 'failed') {
        setMessage(result.message);
      }
    } catch (error) {
      // `/auth/login` answers a wrong password and an unknown address with one
      // `authentication` refusal, and `signInErrorMessage` renders that as one
      // sentence. What it does *not* do is blame the person for a tunnel: the
      // console collapses every throw here into "Invalid email or password",
      // and on a radio that sentence is usually a lie.
      setMessage(signInErrorMessage(error));
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
    <AuthShell testID="sign-in" subtitle="Sign in to your workspace">
      <Field
        testID="sign-in-email"
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        editable={!busy}
        autoComplete="email"
        textContentType="username"
        keyboardType="email-address"
      />
      <Field
        testID="sign-in-password"
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        editable={!busy}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
      />

      {message !== null && <AuthMessage testID="sign-in-error" message={message} />}

      <AuthButton
        testID="sign-in-submit"
        label={busy ? 'Signing in…' : 'Sign in'}
        disabled={!ready}
        onPress={() => void submit()}
      />

      {sso !== null && (
        <AuthButton
          testID="sign-in-sso"
          variant="secondary"
          label="Continue with SSO"
          disabled={busy}
          onPress={() => void startSso(sso)}
        />
      )}

      <Text style={[styles.hint, { color: colors.textTertiary }]}>
        Signing in registers this handset for push notifications.
      </Text>
    </AuthShell>
  );
}

interface FieldProps {
  testID: string;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string | undefined;
  editable: boolean;
  secureTextEntry?: boolean;
  autoComplete: 'email' | 'current-password';
  textContentType: 'username' | 'password';
  keyboardType?: 'email-address';
}

function Field({ testID, label, error, ...input }: FieldProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.input,
          {
            backgroundColor: colors.bgInset,
            borderColor: error === undefined ? colors.border : colors.danger,
            color: colors.textPrimary,
          },
        ]}
        {...input}
      />
      {error !== undefined && <AuthMessage testID={`${testID}-error`} message={error} />}
    </View>
  );
}

/**
 * The shape check, not a verdict on the address. Anything stricter rejects
 * addresses that work; anything looser lets an obvious typo spend a round trip
 * and come back as "invalid email or password", which reads as the wrong
 * problem. Same bar as the console's `emailRule()`.
 */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const styles = StyleSheet.create({
  field: { gap: SPACING[1] },
  label: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: '600',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
    fontSize: FONT_SIZE.base.size,
  },
  hint: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: FONT_SIZE['2xs'].weight,
    textAlign: 'center',
  },
});
