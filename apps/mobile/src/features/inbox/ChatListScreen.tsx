/**
 * The conversation list — the phone's whole answer to "is anything waiting for
 * me?", and the screen an agent opens fifty times a day.
 *
 * Ordered newest-activity-first and kept that way by the store rather than
 * re-sorted here: a list that reshuffles on render moves the row under the
 * thumb that is reaching for it.
 */
import { useEffect } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConnectionBanner } from './ConnectionBanner';
import { useInboxState } from './useInbox';
import { useInboxStore } from './context';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ChatSummary } from './types';

export interface ChatListScreenProps {
  onOpenChat: (chat: { chatId: string; title: string }) => void;
}

export function ChatListScreen({ onOpenChat }: ChatListScreenProps) {
  const store = useInboxStore();
  const state = useInboxState();
  const { colors } = useTheme();

  useEffect(() => {
    if (state.status === 'idle') void store.loadChats();
  }, [store, state.status]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <ConnectionBanner status={state.connection} />
      <FlatList
        testID="chat-list"
        data={state.chats}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={state.chats.length === 0 ? styles.emptyContainer : undefined}
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={() => void store.loadChats({ refresh: true })}
            tintColor={colors.textTertiary}
          />
        }
        renderItem={({ item }) => (
          <ChatRow
            chat={item}
            onPress={() => onOpenChat({ chatId: item.id, title: titleOf(item) })}
          />
        )}
        ListEmptyComponent={<ListPlaceholder status={state.status} error={state.error} />}
      />
    </View>
  );
}

function ChatRow({ chat, onPress }: { chat: ChatSummary; onPress: () => void }) {
  const { colors } = useTheme();
  const preview = previewOf(chat);
  const unread = chat.unread_count ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${titleOf(chat)}. ${preview}`}
      testID={`chat-row-${chat.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.bgSurface2 : colors.bgSurface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <View style={styles.rowHeader}>
        <Text numberOfLines={1} style={[styles.name, { color: colors.textPrimary }]}>
          {titleOf(chat)}
        </Text>
        <Text style={[styles.time, { color: colors.textTertiary }]}>
          {formatTime(chat.last_event?.created_at ?? chat.created_at)}
        </Text>
      </View>

      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={[styles.preview, { color: colors.textSecondary }]}>
          {preview}
        </Text>
        {unread > 0 && (
          <View
            testID={`chat-unread-${chat.id}`}
            accessibilityLabel={`${unread} unread`}
            style={[styles.badge, { backgroundColor: colors.brand500 }]}
          >
            <Text style={[styles.badgeText, { color: colors.textInverse }]}>{unread}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

/**
 * The empty list, which is three different situations wearing one shape: still
 * loading, nothing to show, or a request that failed. A blank rectangle for all
 * three is how "the network is down" gets read as "a quiet morning".
 */
function ListPlaceholder({ status, error }: { status: string; error: string | null }) {
  const { colors } = useTheme();

  const message =
    status === 'loading'
      ? 'Loading conversations…'
      : status === 'error'
        ? (error ?? 'Could not load conversations.')
        : 'No conversations here yet.';

  return (
    <View style={styles.placeholder} testID="chat-list-placeholder">
      <Text
        style={[
          styles.placeholderText,
          { color: status === 'error' ? colors.danger : colors.textSecondary },
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

function titleOf(chat: ChatSummary): string {
  // An anonymous visitor is the common case, not an error state.
  return chat.customer_name ?? 'Visitor';
}

function previewOf(chat: ChatSummary): string {
  const event = chat.last_event;
  if (event === undefined || event === null) return 'No messages yet';
  if (event.recipients === 'agents') return `Note: ${event.text ?? ''}`.trim();
  if (event.text !== null && event.text !== undefined && event.text !== '') return event.text;
  return event.attachment_url ? 'Attachment' : 'No messages yet';
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  emptyContainer: { flexGrow: 1 },
  row: {
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING[1],
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  rowBody: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  name: {
    flex: 1,
    fontSize: FONT_SIZE.base.size,
    lineHeight: FONT_SIZE.base.lineHeight,
    fontWeight: '600',
  },
  time: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: FONT_SIZE['2xs'].weight,
  },
  preview: {
    flex: 1,
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
  },
  badge: {
    minWidth: SPACING[5],
    paddingHorizontal: SPACING[2],
    paddingVertical: 2,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: '700',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING[6],
  },
  placeholderText: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
    textAlign: 'center',
  },
});
