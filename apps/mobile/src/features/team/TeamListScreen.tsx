/**
 * The Team roster — mobile's read-only slice of the web `TeamPage` directory
 * (13.7-m KAPSAM: who is online, who is suspended, what role. Role changes,
 * suspension, expertise edits and invites are all console jobs — §C-A28's
 * "authoring is desk work" for a role/suspension change still applies here;
 * this screen only reads the same list `GET /agents` already carries that
 * information on).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useTeamApi } from './context';
import type { Agent } from './types';
import { formatRole, formatRoutingStatus } from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ColorTokens } from '../../theme/tokens';

export interface TeamListScreenProps {
  onOpenAgent: (agent: Agent) => void;
}

type ListStatus = 'loading' | 'ready' | 'error';

interface ListState {
  status: ListStatus;
  items: Agent[];
  error: string | null;
}

const INITIAL_STATE: ListState = { status: 'loading', items: [], error: null };

export function TeamListScreen({ onOpenAgent }: TeamListScreenProps) {
  const { colors } = useTheme();
  const api = useTeamApi();

  const [state, setState] = useState<ListState>(INITIAL_STATE);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    api
      .listAgents(controller.signal)
      .then((items) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', items, error: null });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          items: [],
          error: error instanceof Error ? error.message : 'Could not load the team.',
        });
      });

    return () => controller.abort();
  }, [api]);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    setRefreshing(true);
    api
      .listAgents()
      .then((items) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', items, error: null });
      })
      .catch(() => {
        // A failed pull-to-refresh leaves the roster as it was rather than
        // replacing something the reader can already see with an error screen.
      })
      .finally(() => {
        if (mine === generation.current) setRefreshing(false);
      });
  }, [api]);

  const displayItems = state.status === 'loading' ? [] : state.items;

  return (
    <View style={[styles.screen, { backgroundColor: colors.bgCanvas }]}>
      <FlatList
        testID="team-list"
        data={displayItems}
        keyExtractor={(agent) => agent.id}
        contentContainerStyle={displayItems.length === 0 ? styles.emptyContainer : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textTertiary}
          />
        }
        renderItem={({ item }) => <AgentRow agent={item} onPress={() => onOpenAgent(item)} />}
        ListEmptyComponent={
          state.status === 'loading' ? (
            <ListSkeleton />
          ) : (
            <ListPlaceholder status={state.status} error={state.error} />
          )
        }
      />
    </View>
  );
}

function AgentRow({ agent, onPress }: { agent: Agent; onPress: () => void }) {
  const { colors } = useTheme();
  const status = formatRoutingStatus(agent.routing_status);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${agent.name}. ${formatRole(agent.role)}. ${agent.suspended ? 'Suspended' : status}`}
      testID={`team-row-${agent.id}`}
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
          {agent.name}
        </Text>
        {agent.suspended ? (
          <Badge label="Suspended" tone={colors.danger} />
        ) : (
          <Badge label={status} tone={statusTone(colors, agent.routing_status)} />
        )}
      </View>
      <Text numberOfLines={1} style={[styles.meta, { color: colors.textTertiary }]}>
        {formatRole(agent.role)} · {agent.email}
      </Text>
    </Pressable>
  );
}

function statusTone(colors: ColorTokens, status: Agent['routing_status']): string {
  if (status === 'accepting_chats') return colors.success;
  if (status === 'not_accepting_chats') return colors.warning;
  return colors.textTertiary;
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${tone}1a` }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{label}</Text>
    </View>
  );
}

/** The empty list is three different situations wearing one shape: still
 * loading, nothing to show, or a request that failed — same reasoning as the
 * Customers list's `ListPlaceholder`. */
function ListPlaceholder({ status, error }: { status: ListStatus; error: string | null }) {
  const { colors } = useTheme();
  const message = status === 'error' ? (error ?? 'Could not load the team.') : 'No teammates yet.';

  return (
    <View style={styles.placeholder} testID="team-list-placeholder">
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

/** Row-shaped placeholder while the roster loads, so the screen does not
 * flash a blank rectangle in the moment before data arrives. */
function ListSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      testID="team-list-skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={[styles.skeletonRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.skeletonBar, { width: '45%', backgroundColor: colors.bgInset }]} />
          <View style={[styles.skeletonBar, { width: '70%', backgroundColor: colors.bgInset }]} />
        </View>
      ))}
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
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  name: {
    flex: 1,
    fontSize: FONT_SIZE.base.size,
    lineHeight: FONT_SIZE.base.lineHeight,
    fontWeight: '600',
  },
  meta: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  badge: {
    paddingHorizontal: SPACING[2],
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  badgeText: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: '600',
  },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  placeholderText: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: FONT_SIZE.sm.weight,
    textAlign: 'center',
  },
  skeletonRow: {
    paddingVertical: SPACING[3],
    paddingHorizontal: SPACING[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: SPACING[2],
  },
  skeletonBar: { height: 10, borderRadius: RADIUS.sm },
});
