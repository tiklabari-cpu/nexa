/**
 * One conversation: its transcript and the composer under it.
 *
 * The screen owns almost nothing. Opening it tells the store which chat is on
 * screen — which is what stops an unread badge appearing for a message the
 * agent is looking at — and everything else is the store's state rendered.
 */
import { useEffect } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Composer } from './Composer';
import { ConnectionBanner } from './ConnectionBanner';
import { Transcript } from './Transcript';
import { useInboxState, useTranscript } from './useInbox';
import { useInboxStore } from './context';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export function ChatScreen({ chatId }: { chatId: string }) {
  const store = useInboxStore();
  const state = useInboxState();
  const transcript = useTranscript(chatId);
  const { colors } = useTheme();

  useEffect(() => {
    store.openChat(chatId);
    return () => store.closeChat(chatId);
  }, [store, chatId]);

  const chat = state.chats.find((candidate) => candidate.id === chatId);
  // Only an archived conversation refuses writes, and `undefined` here means
  // the list has not loaded — not that the chat is closed.
  const closed = chat !== undefined && chat.active === false;

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ConnectionBanner status={state.connection} />

      {transcript.status === 'error' ? (
        <View style={styles.centre} testID="transcript-error">
          <Text style={[styles.message, { color: colors.danger }]}>
            {transcript.error ?? 'Could not load this conversation.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            testID="transcript-retry"
            onPress={() => void store.loadTranscript(chatId)}
            style={[styles.retry, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryLabel, { color: colors.brandText }]}>Try again</Text>
          </Pressable>
        </View>
      ) : transcript.status !== 'ready' ? (
        <View style={styles.centre} testID="transcript-loading">
          <Text style={[styles.message, { color: colors.textSecondary }]}>Loading messages…</Text>
        </View>
      ) : transcript.events.length === 0 ? (
        <View style={styles.centre} testID="transcript-empty">
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            No messages in this conversation yet.
          </Text>
        </View>
      ) : (
        <Transcript
          events={transcript.events}
          loadingOlder={transcript.loadingOlder}
          onLoadOlder={() => void store.loadOlder(chatId)}
          currentAccountId={store.accountId}
        />
      )}

      {closed && (
        <Text testID="chat-closed" style={[styles.closed, { color: colors.textTertiary }]}>
          This conversation is archived — reopen it in the console to reply.
        </Text>
      )}

      <Composer
        onSend={(input) => void store.send(chatId, input)}
        sending={transcript.sending}
        error={transcript.sendError}
        disabled={closed}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING[6],
    gap: SPACING[3],
  },
  message: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
    textAlign: 'center',
  },
  retry: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[2],
  },
  retryLabel: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  closed: {
    textAlign: 'center',
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[2],
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
  },
});
