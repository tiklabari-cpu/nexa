/**
 * Teams and their membership counts, read-only — mobile's slice of the web
 * `TeamPage` groups list (13.7-m KAPSAM). Creating a team, renaming one or
 * editing membership priority is desk work; a phone only needs to see which
 * teams exist and how many people are on each.
 */
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { useTeamApi } from './context';
import type { Group } from './types';
import { FONT_SIZE, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

type ListStatus = 'loading' | 'ready' | 'error';

interface ListState {
  status: ListStatus;
  items: Group[];
  error: string | null;
}

const INITIAL_STATE: ListState = { status: 'loading', items: [], error: null };

export function GroupListScreen() {
  const { colors } = useTheme();
  const api = useTeamApi();

  const [state, setState] = useState<ListState>(INITIAL_STATE);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    api
      .listGroups(controller.signal)
      .then((items) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', items, error: null });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          items: [],
          error: error instanceof Error ? error.message : 'Could not load groups.',
        });
      });

    return () => controller.abort();
  }, [api]);

  const displayItems = state.status === 'loading' ? [] : state.items;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <FlatList
        testID="group-list"
        data={displayItems}
        keyExtractor={(group) => String(group.id)}
        contentContainerStyle={displayItems.length === 0 ? styles.emptyContainer : undefined}
        renderItem={({ item }) => <GroupRow group={item} />}
        ListEmptyComponent={
          state.status === 'loading' ? (
            <View
              testID="group-list-skeleton"
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

function GroupRow({ group }: { group: Group }) {
  const { colors } = useTheme();
  return (
    <View
      testID={`group-row-${group.id}`}
      style={[styles.row, { borderBottomColor: colors.border, backgroundColor: colors.bgSurface }]}
    >
      <Text style={[styles.name, { color: colors.textPrimary }]}>{group.name}</Text>
      <Text style={[styles.meta, { color: colors.textTertiary }]}>
        {group.agents.length} {group.agents.length === 1 ? 'member' : 'members'} ·{' '}
        {group.language_code}
      </Text>
    </View>
  );
}

function ListPlaceholder({ status, error }: { status: ListStatus; error: string | null }) {
  const { colors } = useTheme();
  const message = status === 'error' ? (error ?? 'Could not load groups.') : 'No groups yet.';

  return (
    <View style={styles.placeholder} testID="group-list-placeholder">
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
