/**
 * Copilot — the mobile slice of the web `CopilotPanel` (13.7-i KAPSAM:
 * "özet + yanıt önerisi", salt-tüketici). Two of the web panel's four
 * sections only — rewriting a draft and the BI report command are the
 * console's; a phone offering the two assists that ask nothing of the agent
 * but the conversation already open is a better trade than a cramped copy of
 * the four-section desktop panel (same reasoning `13.7-g`/`-h` applied to
 * Customers/Reports). Calls the same `/copilot/chats/{chatId}/*` endpoints
 * the console does — no new AI surface, per KAPSAM.
 */
import { useState, type PropsWithChildren, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCopilotApi } from './context';
import { offerDraft } from './copilotDraft';
import type { CopilotReplyDraft, CopilotSummary } from './types';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: T };

export interface CopilotScreenProps {
  chatId: string;
  /** The chat is archived — reopen it in the console to write a note or reply (mirrors `ChatScreen`'s `closed`). */
  chatActive?: boolean;
  /** Pops back to the conversation once a suggestion is handed to the composer. */
  onInserted?: () => void;
}

export function CopilotScreen({ chatId, chatActive = true, onInserted }: CopilotScreenProps): ReactElement {
  const { colors } = useTheme();
  const api = useCopilotApi();
  const [summary, setSummary] = useState<AsyncState<CopilotSummary>>({ status: 'idle' });
  const [reply, setReply] = useState<AsyncState<CopilotReplyDraft>>({ status: 'idle' });

  const runSummary = (): void => {
    setSummary({ status: 'pending' });
    api
      .summarise(chatId)
      .then((data) => setSummary({ status: 'ready', data }))
      .catch((error: unknown) =>
        setSummary({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not summarise — try again.',
        }),
      );
  };

  const runReply = (): void => {
    setReply({ status: 'pending' });
    api
      .draftReply(chatId)
      .then((data) => setReply({ status: 'ready', data }))
      .catch((error: unknown) =>
        setReply({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not draft a reply — try again.',
        }),
      );
  };

  const insert = (text: string): void => {
    offerDraft(chatId, text);
    onInserted?.();
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="copilot-screen"
    >
      {!chatActive && (
        <Text style={[styles.reopen, { color: colors.textTertiary }]}>
          Reopen the conversation to use Copilot.
        </Text>
      )}

      <Section
        title="Summary"
        description="Summarise this conversation and post it as an internal note for your team."
        colors={{ title: colors.textPrimary, description: colors.textTertiary }}
      >
        <ActionButton
          label="Summarise conversation"
          pendingLabel="Summarising…"
          pending={summary.status === 'pending'}
          disabled={!chatActive}
          onPress={runSummary}
          testID="copilot-summarise"
        />
        {summary.status === 'error' && (
          <Text testID="copilot-summary-error" accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
            {summary.message}
          </Text>
        )}
        {summary.status === 'ready' && (
          <View
            testID="copilot-summary-result"
            style={[styles.card, { backgroundColor: colors.bgInset }]}
          >
            <Text style={[styles.body, { color: colors.textSecondary }]}>{summary.data.summary}</Text>
            <Text style={[styles.note, { color: colors.success }]}>Added as an internal note.</Text>
          </View>
        )}
      </Section>

      <Section
        title="Suggested reply"
        description="Draft a reply from the copilot knowledge base."
        colors={{ title: colors.textPrimary, description: colors.textTertiary }}
      >
        <ActionButton
          label="Draft a reply"
          pendingLabel="Drafting…"
          pending={reply.status === 'pending'}
          disabled={!chatActive}
          onPress={runReply}
          testID="copilot-draft-reply"
        />
        {reply.status === 'error' && (
          <Text testID="copilot-reply-error" accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
            {reply.message}
          </Text>
        )}
        {reply.status === 'ready' &&
          (reply.data.draft ? (
            <View testID="copilot-reply-result" style={[styles.card, { backgroundColor: colors.bgInset }]}>
              <Text style={[styles.body, { color: colors.textSecondary }]}>{reply.data.draft}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Insert into reply"
                testID="copilot-insert"
                onPress={() => insert(reply.data.draft)}
                style={[styles.insert, { backgroundColor: colors.brand500 }]}
              >
                <Text style={[styles.insertLabel, { color: colors.textInverse }]}>Insert into reply</Text>
              </Pressable>
              {reply.data.sources.length > 0 && (
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  From: {reply.data.sources.map((source) => source.name).join(', ')}
                </Text>
              )}
            </View>
          ) : (
            <Text testID="copilot-reply-empty" style={[styles.hint, { color: colors.textTertiary }]}>
              No suggestion found in the copilot knowledge base.
            </Text>
          ))}
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  description,
  colors,
  children,
}: PropsWithChildren<{ title: string; description: string; colors: { title: string; description: string } }>) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.title }]}>{title}</Text>
      <Text style={[styles.sectionDescription, { color: colors.description }]}>{description}</Text>
      {children}
    </View>
  );
}

function ActionButton({
  label,
  pendingLabel,
  pending,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  pendingLabel: string;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  const inactive = pending || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive }}
      testID={testID}
      disabled={inactive}
      onPress={onPress}
      style={[styles.action, { borderColor: colors.border, opacity: inactive ? 0.5 : 1 }]}
    >
      {pending && <ActivityIndicator size="small" color={colors.textSecondary} />}
      <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>
        {pending ? pendingLabel : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: SPACING[4], gap: SPACING[6] },
  reopen: { fontSize: FONT_SIZE.xs.size, lineHeight: FONT_SIZE.xs.lineHeight },
  section: { gap: SPACING[2] },
  sectionTitle: { fontSize: FONT_SIZE.lg.size, lineHeight: FONT_SIZE.lg.lineHeight, fontWeight: '600' },
  sectionDescription: { fontSize: FONT_SIZE.xs.size, lineHeight: FONT_SIZE.xs.lineHeight },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING[2],
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING[3],
  },
  actionLabel: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight, fontWeight: '600' },
  card: { borderRadius: RADIUS.md, padding: SPACING[3], gap: SPACING[2] },
  body: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight * 1.3 },
  note: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  hint: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  error: { fontSize: FONT_SIZE.xs.size, lineHeight: FONT_SIZE.xs.lineHeight },
  insert: {
    alignSelf: 'flex-start',
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[3],
    paddingVertical: SPACING[2],
  },
  insertLabel: { fontSize: FONT_SIZE.xs.size, lineHeight: FONT_SIZE.xs.lineHeight, fontWeight: '600' },
});
