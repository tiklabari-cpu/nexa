/**
 * The three pieces the sign-in form and the workspace picker both draw with.
 *
 * Kept together so the two screens cannot drift into looking like two products
 * — they are one step apart in the same flow, and the second one appears
 * without any transition a person would read as "somewhere else".
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PropsWithChildren } from 'react';

import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export interface AuthShellProps extends PropsWithChildren {
  testID: string;
  subtitle: string;
}

/** The branded frame: wordmark, one line of context, then the step's own card. */
export function AuthShell({ testID, subtitle, children }: AuthShellProps) {
  const { colors } = useTheme();

  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: colors.bgCanvas }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View
          accessible={false}
          style={[styles.mark, { backgroundColor: colors.brand500 }]}
          testID="auth-wordmark"
        >
          <Text style={[styles.markText, { color: colors.textInverse }]}>N</Text>
        </View>
        <View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Nexa</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        </View>
      </View>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        {children}
      </View>
    </ScrollView>
  );
}

/**
 * Whatever went wrong, said once and read out.
 *
 * `accessibilityRole="alert"` rather than plain text: on a form the message
 * usually appears below the fold of a keyboard, and a screen reader user who
 * pressed a button that seemed to do nothing has no other way to learn why.
 */
export function AuthMessage({ testID, message }: { testID: string; message: string }) {
  const { colors } = useTheme();
  return (
    <Text
      testID={testID}
      accessibilityRole="alert"
      style={[styles.message, { color: colors.danger }]}
    >
      {message}
    </Text>
  );
}

export interface AuthButtonProps {
  testID: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The secondary door (SSO), drawn as an outline rather than a second brand button. */
  variant?: 'primary' | 'secondary';
}

export function AuthButton({
  testID,
  label,
  onPress,
  disabled = false,
  variant = 'primary',
}: AuthButtonProps) {
  const { colors } = useTheme();
  const primary = variant === 'primary';

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary
            ? pressed
              ? colors.brand600
              : colors.brand500
            : pressed
              ? colors.bgSurface2
              : 'transparent',
          borderColor: primary ? 'transparent' : colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text
        style={[styles.buttonText, { color: primary ? colors.textInverse : colors.textPrimary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: SPACING[6], gap: SPACING[5] },
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING[3] },
  mark: {
    width: SPACING[10],
    height: SPACING[10],
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { fontSize: FONT_SIZE.lg.size, fontWeight: '700' },
  title: { fontSize: FONT_SIZE.xl.size, lineHeight: FONT_SIZE.xl.lineHeight, fontWeight: '600' },
  subtitle: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    padding: SPACING[4],
    gap: SPACING[3],
  },
  message: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
  },
  button: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[4],
    alignItems: 'center',
  },
  buttonText: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
});
