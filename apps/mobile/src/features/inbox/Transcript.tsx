/**
 * The conversation itself.
 *
 * Inverted rather than scrolled-to-bottom: an inverted `FlatList` renders index
 * zero at the foot of the screen, which means the newest message is on screen
 * the instant the first page lands and no scroll animation has to chase it. It
 * also puts `onEndReached` at the *top* of the view, which is exactly where
 * "load more history" belongs — so backwards infinite scroll falls out of the
 * list rather than being simulated on top of it.
 *
 * The events array is newest-first everywhere behind this screen for the same
 * reason: the API returns it that way (`sort: newest`), a push prepends to it,
 * and this list consumes it unreversed.
 */
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { isPending, type ChatEvent } from './types';
import { idHint, idLabel } from '../../lib/idLabels';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export interface TranscriptProps {
  events: ChatEvent[];
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** So a bubble knows whether it is this agent's own words. */
  currentAccountId: string | null;
}

export function Transcript({
  events,
  loadingOlder,
  onLoadOlder,
  currentAccountId,
}: TranscriptProps) {
  const { colors } = useTheme();

  return (
    <FlatList
      testID="transcript"
      inverted
      data={events}
      keyExtractor={(event) => event.id}
      onEndReached={onLoadOlder}
      onEndReachedThreshold={0.4}
      contentContainerStyle={styles.content}
      renderItem={({ item, index }) => {
        const opens = opensConnection(events, index);
        const bubble = <MessageBubble event={item} isMine={item.author_id === currentAccountId} />;
        return opens === null ? (
          bubble
        ) : (
          <View>
            <ConnectionSeparator threadId={opens} at={item.created_at} />
            {bubble}
          </View>
        );
      }}
      // Inverted, so the footer is the visual top — where older history loads.
      ListFooterComponent={
        loadingOlder ? (
          <ActivityIndicator
            testID="transcript-loading-older"
            style={styles.spinner}
            color={colors.textTertiary}
          />
        ) : null
      }
    />
  );
}

/**
 * The connection an event opens, when it opens one (ID-02 · tm 286.4): the
 * event older than it (the next index — the list is newest-first) belongs to
 * another connection of the same day. An optimistic bubble has no
 * `thread_id` yet and opens nothing.
 */
export function opensConnection(events: readonly ChatEvent[], index: number): string | null {
  const current = events[index]?.thread_id;
  const older = events[index + 1]?.thread_id;
  if (!current || !older || current === older) return null;
  return current;
}

/** "<connection label> C2 · 14:02" — where a member's return starts in the transcript. */
export function ConnectionSeparator({ threadId, at }: { threadId: string; at: string }) {
  const { colors } = useTheme();
  const text = `${idLabel('connection')} ${threadId} · ${formatTime(at)}`;
  return (
    <View
      testID={`connection-${threadId}`}
      accessibilityRole="text"
      accessibilityLabel={`${text} — ${idHint('connection')}`}
      style={styles.separator}
    >
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <Text style={[styles.separatorText, { color: colors.textSecondary }]}>{text}</Text>
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
    </View>
  );
}

export function MessageBubble({ event, isMine }: { event: ChatEvent; isMine: boolean }) {
  const { colors } = useTheme();
  const isNote = event.recipients === 'agents';
  const isSystem = event.type === 'system_message' || event.author_type === 'system';
  const pending = isPending(event);

  if (isSystem) {
    return (
      <Text testID={`event-${event.id}`} style={[styles.system, { color: colors.textTertiary }]}>
        {event.text}
      </Text>
    );
  }

  const fromCustomer = event.author_type === 'customer';
  const background = isNote
    ? colors.bubbleNoteBg
    : event.author_type === 'bot'
      ? colors.bubbleAiBg
      : fromCustomer
        ? colors.bubbleCustomerBg
        : isMine
          ? colors.bubbleAgentBg
          : colors.bubbleCustomerBg;
  const foreground =
    !isNote && !fromCustomer && isMine && event.author_type !== 'bot'
      ? colors.bubbleAgentText
      : colors.bubbleCustomerText;

  return (
    <View
      testID={`event-${event.id}`}
      style={[styles.bubbleRow, fromCustomer ? styles.fromThem : styles.fromMe]}
    >
      {/* An internal note gets its own treatment and its own words, because
          sending one to the customer by mistake is the expensive error here
          (FR-MOD-02.3.4). */}
      {isNote && (
        <Text style={[styles.noteLabel, { color: colors.note }]}>
          Internal note — not sent to the customer
        </Text>
      )}
      <View
        style={[
          styles.bubble,
          { backgroundColor: background, opacity: pending ? 0.6 : 1 },
          isNote ? { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.note } : null,
        ]}
      >
        {event.text !== null && event.text !== undefined && event.text !== '' && (
          <Text style={[styles.text, { color: foreground }]}>{event.text}</Text>
        )}
        {event.attachment_url !== null && event.attachment_url !== undefined && (
          <Text style={[styles.attachment, { color: foreground }]}>Attachment</Text>
        )}
      </View>
      <Text style={[styles.meta, { color: colors.textTertiary }]}>
        {pending ? 'Sending…' : formatTime(event.created_at)}
        {event.author_type === 'bot' ? ' · AI' : ''}
      </Text>
    </View>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const styles = StyleSheet.create({
  content: { padding: SPACING[4], gap: SPACING[3] },
  spinner: { paddingVertical: SPACING[4] },
  bubbleRow: { maxWidth: '82%', gap: SPACING[1] },
  fromThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  fromMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
    gap: SPACING[1],
  },
  text: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
  },
  attachment: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: FONT_SIZE.xs.weight,
  },
  noteLabel: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: '600',
  },
  meta: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: FONT_SIZE['2xs'].weight,
  },
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING[2],
    marginBottom: SPACING[3],
  },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  separatorText: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: '600',
  },
  system: {
    alignSelf: 'center',
    textAlign: 'center',
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: FONT_SIZE['2xs'].weight,
  },
});
