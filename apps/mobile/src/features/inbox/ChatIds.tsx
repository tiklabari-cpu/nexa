/**
 * The conversation's two numbers, at the top of the chat screen (ID-05 · tm 329).
 *
 * The day's number and the number of the connection that is open, each
 * copyable: a tap or a long press puts exactly the 10 characters on the
 * clipboard — no label, no link — and "Copied" shows for 1.5 s. The numbers are
 * the API's (`chat.id`, `chat.thread_id`), never worked out on the phone. The
 * names come from `idLabels`, which asks `@siyahtus/types`: this screen does not
 * spell "Thread ID" or "Chat ID" itself.
 *
 * Read aloud, a number is spoken one character at a time — "TJ1H8CFKRV" as a
 * word is not something anybody can write down.
 */
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { idHint, idLabel } from '../../lib/idLabels';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

/** How long "Copied" stays up. */
const FEEDBACK_MS = 1_500;

export function ChatIds({ chatId, threadId }: { chatId: string; threadId: string | null }) {
  return (
    <View testID="chat-ids" style={styles.row}>
      <IdChip kind="day_thread" value={chatId} />
      {threadId && <IdChip kind="connection" value={threadId} />}
    </View>
  );
}

function IdChip({ kind, value }: { kind: 'day_thread' | 'connection'; value: string }) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const label = idLabel(kind);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (): void => {
    void Clipboard.setStringAsync(value).then(() => {
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
    });
  };

  return (
    <Pressable
      testID={`chat-id-${kind}`}
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label} ${value.split('').join(' ')}`}
      accessibilityHint={idHint(kind)}
      onPress={copy}
      onLongPress={copy}
      style={[styles.chip, { borderColor: colors.border }]}
    >
      <Text style={[styles.label, { color: colors.textTertiary }]}>{label}</Text>
      <Text selectable style={[styles.value, { color: colors.textPrimary }]}>
        {value}
      </Text>
      <Text accessibilityLiveRegion="polite" style={[styles.copied, { color: colors.brandText }]}>
        {copied ? 'Copied' : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING[2],
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING[2],
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[2],
    paddingVertical: SPACING[1],
  },
  label: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
  },
  value: {
    fontFamily: 'monospace',
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
  },
  copied: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: '600',
  },
});
