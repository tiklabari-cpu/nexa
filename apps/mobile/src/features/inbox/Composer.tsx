/**
 * Reply and internal note, as one control with two modes.
 *
 * Two separate inputs would be the obvious phone layout and the wrong one: the
 * expensive mistake in this product is sending an internal note to the
 * customer, and two fields make that a matter of which one the thumb landed in.
 * One field with a mode that is impossible to miss — different label, different
 * colour, different placeholder — makes it a deliberate act instead
 * (FR-MOD-02.3.4).
 *
 * Attachments are the console's (`13.7-k` weighs the parity); this is text,
 * which is what a phone is for.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { EventRecipients } from './types';
import { useCopilotDraft, clearCopilotDraft } from '../copilot/copilotDraft';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export interface ComposerProps {
  /** Which chat this composer belongs to — needed to pick up a Copilot draft addressed to it. */
  chatId: string;
  onSend: (input: { text: string; recipients: EventRecipients }) => void;
  sending: boolean;
  error: string | null;
  /** An archived conversation cannot be written to; say so rather than 409. */
  disabled?: boolean;
}

export function Composer({ chatId, onSend, sending, error, disabled = false }: ComposerProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [recipients, setRecipients] = useState<EventRecipients>('all');

  // A suggestion handed over from Copilot (FR-MOD-12.3 / 13.7-i). It fills
  // the reply — always a customer-facing reply, never a note — for the agent
  // to edit and send. Consumed on arrival so it is not re-applied on the
  // next render.
  const copilotDraft = useCopilotDraft(chatId);
  useEffect(() => {
    if (copilotDraft === undefined) return;
    setText(copilotDraft);
    setRecipients('all');
    clearCopilotDraft(chatId);
  }, [copilotDraft, chatId]);

  const isNote = recipients === 'agents';
  const canSend = text.trim() !== '' && !sending && !disabled;

  const submit = (): void => {
    if (!canSend) return;
    onSend({ text: text.trim(), recipients });
    // Cleared optimistically, exactly as the transcript shows the message
    // optimistically: if the send fails the error says so, and retyping a
    // sentence the screen still shows would be worse.
    setText('');
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bgSurface, borderTopColor: colors.border },
      ]}
    >
      {error !== null && (
        <Text testID="composer-error" style={[styles.error, { color: colors.danger }]}>
          {error}
        </Text>
      )}

      <View style={styles.modes}>
        <ModeButton
          label="Reply"
          selected={!isNote}
          onPress={() => setRecipients('all')}
          testID="composer-mode-reply"
        />
        <ModeButton
          label="Internal note"
          selected={isNote}
          onPress={() => setRecipients('agents')}
          testID="composer-mode-note"
          tint={colors.note}
        />
      </View>

      <View style={styles.inputRow}>
        <TextInput
          testID="composer-input"
          accessibilityLabel={isNote ? 'Internal note' : 'Reply to the customer'}
          placeholder={isNote ? 'Visible to your team only…' : 'Write a reply…'}
          placeholderTextColor={colors.textTertiary}
          value={text}
          onChangeText={setText}
          editable={!disabled}
          multiline
          style={[
            styles.input,
            {
              color: colors.textPrimary,
              backgroundColor: isNote ? colors.bubbleNoteBg : colors.bgInset,
              borderColor: isNote ? colors.note : colors.border,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          testID="composer-send"
          disabled={!canSend}
          onPress={submit}
          style={[styles.send, { backgroundColor: canSend ? colors.brand500 : colors.bgInset }]}
        >
          <Text
            style={[
              styles.sendLabel,
              { color: canSend ? colors.textInverse : colors.textTertiary },
            ]}
          >
            {sending ? '…' : 'Send'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ModeButton({
  label,
  selected,
  onPress,
  testID,
  tint,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  tint?: string;
}) {
  const { colors } = useTheme();
  const active = tint ?? colors.brand500;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={[
        styles.mode,
        {
          borderColor: selected ? active : colors.border,
          backgroundColor: selected ? colors.bgSurface2 : 'transparent',
        },
      ]}
    >
      <Text style={[styles.modeLabel, { color: selected ? active : colors.textSecondary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: SPACING[3],
    gap: SPACING[2],
  },
  modes: { flexDirection: 'row', gap: SPACING[2] },
  mode: {
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[1],
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  modeLabel: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: '600',
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACING[2] },
  input: {
    flex: 1,
    minHeight: SPACING[10],
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
    fontSize: FONT_SIZE.sm.size,
  },
  send: {
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[3],
    borderRadius: RADIUS.md,
  },
  sendLabel: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  error: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
  },
});
