/**
 * The skill list — mobile's read-only slice of the web `PlaybookPage` skill
 * table (13.7-n KAPSAM: name, enabled/disabled, how often it has run).
 * Compiling an instruction, editing steps, activating a skill and previewing
 * one against a sample message are all console jobs — §C-A28's "authoring is
 * desk work" still applies here; this screen only reads the same list
 * `GET /skills` already carries that information on.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { usePlaybookApi } from './context';
import type { Skill } from './types';
import { formatDate, formatRunCount } from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export interface SkillListScreenProps {
  onOpenSkill: (skill: { skillId: string; title: string }) => void;
}

type ListStatus = 'loading' | 'ready' | 'error';

interface ListState {
  status: ListStatus;
  items: Skill[];
  error: string | null;
}

const INITIAL_STATE: ListState = { status: 'loading', items: [], error: null };

export function SkillListScreen({ onOpenSkill }: SkillListScreenProps) {
  const { colors } = useTheme();
  const api = usePlaybookApi();

  const [state, setState] = useState<ListState>(INITIAL_STATE);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    api
      .listSkills(controller.signal)
      .then((items) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', items, error: null });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          items: [],
          error: error instanceof Error ? error.message : 'Could not load skills.',
        });
      });

    return () => controller.abort();
  }, [api]);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    setRefreshing(true);
    api
      .listSkills()
      .then((items) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', items, error: null });
      })
      .catch(() => {
        // A failed pull-to-refresh leaves the list as it was rather than
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
        testID="skill-list"
        data={displayItems}
        keyExtractor={(skill) => skill.id}
        contentContainerStyle={displayItems.length === 0 ? styles.emptyContainer : undefined}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textTertiary}
          />
        }
        renderItem={({ item }) => (
          <SkillRow
            skill={item}
            onPress={() => onOpenSkill({ skillId: item.id, title: item.name })}
          />
        )}
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

function SkillRow({ skill, onPress }: { skill: Skill; onPress: () => void }) {
  const { colors } = useTheme();
  const updated = formatDate(skill.updated_at);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${skill.name}. ${skill.active ? 'Active' : 'Inactive'}. ${formatRunCount(skill.runs_count)}`}
      testID={`skill-row-${skill.id}`}
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
          {skill.name}
        </Text>
        <Badge
          label={skill.active ? 'Active' : 'Inactive'}
          tone={skill.active ? colors.success : colors.textTertiary}
        />
      </View>
      <Text numberOfLines={1} style={[styles.meta, { color: colors.textTertiary }]}>
        {formatRunCount(skill.runs_count)}
        {updated ? ` · Updated ${updated}` : ''}
      </Text>
    </Pressable>
  );
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
 * Team roster's `ListPlaceholder`. */
function ListPlaceholder({ status, error }: { status: ListStatus; error: string | null }) {
  const { colors } = useTheme();
  const message = status === 'error' ? (error ?? 'Could not load skills.') : 'No skills yet.';

  return (
    <View style={styles.placeholder} testID="skill-list-placeholder">
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

/** Row-shaped placeholder while the list loads, so the screen does not flash
 * a blank rectangle in the moment before data arrives. */
function ListSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      testID="skill-list-skeleton"
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
