/**
 * Copilot's knowledge sources, read-only — mobile's slice of the web
 * `KbArticleList` (13.7-n KAPSAM). Adding a source, crawling a website and
 * deleting one are all console jobs (`POST`/`DELETE /copilot/knowledge*`,
 * neither called here); a phone only needs to see what the assistant is
 * answering from.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { usePlaybookApi } from './context';
import type { KnowledgeSource } from './types';
import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

type ListStatus = 'loading' | 'ready' | 'error';

interface ListState {
  status: ListStatus;
  items: KnowledgeSource[];
  error: string | null;
}

const INITIAL_STATE: ListState = { status: 'loading', items: [], error: null };

export function KnowledgeSourceListScreen() {
  const { colors } = useTheme();
  const api = usePlaybookApi();

  const [state, setState] = useState<ListState>(INITIAL_STATE);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    api
      .listKnowledgeSources(controller.signal)
      .then((items) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', items, error: null });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          items: [],
          error: error instanceof Error ? error.message : 'Could not load knowledge sources.',
        });
      });

    return () => controller.abort();
  }, [api]);

  const displayItems = state.status === 'loading' ? [] : state.items;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <FlatList
        testID="knowledge-list"
        data={displayItems}
        keyExtractor={(source) => source.id}
        contentContainerStyle={displayItems.length === 0 ? styles.emptyContainer : undefined}
        renderItem={({ item }) => <SourceRow source={item} />}
        ListEmptyComponent={
          state.status === 'loading' ? (
            <View
              testID="knowledge-list-skeleton"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Text style={[styles.placeholderText, { color: colors.textSecondary }]}>
                Loading…
              </Text>
            </View>
          ) : (
            <ListPlaceholder status={state.status} error={state.error} />
          )
        }
      />
    </View>
  );
}

function SourceRow({ source }: { source: KnowledgeSource }) {
  const { colors } = useTheme();
  return (
    <View
      testID={`knowledge-row-${source.id}`}
      style={[styles.row, { borderBottomColor: colors.border, backgroundColor: colors.bgSurface }]}
    >
      <Text style={[styles.name, { color: colors.textPrimary }]}>{source.name}</Text>
      <Text style={[styles.meta, { color: colors.textTertiary }]}>
        {source.type} · {source.chunk_count} {source.chunk_count === 1 ? 'chunk' : 'chunks'} ·{' '}
        {source.status}
      </Text>
    </View>
  );
}

function ListPlaceholder({ status, error }: { status: ListStatus; error: string | null }) {
  const { colors } = useTheme();
  const message =
    status === 'error'
      ? (error ?? 'Could not load knowledge sources.')
      : 'No knowledge sources yet.';

  return (
    <View style={styles.placeholder} testID="knowledge-list-placeholder">
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  emptyContainer: { flexGrow: 1 },
  row: {
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING[1],
  },
  name: {
    fontSize: FONT_SIZE.base.size,
    lineHeight: FONT_SIZE.base.lineHeight,
    fontWeight: '600',
  },
  meta: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  placeholderText: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    textAlign: 'center',
  },
});
