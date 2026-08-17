/**
 * One skill, read-only — the mobile slice of the web `SkillEditor` (13.7-n
 * KAPSAM: "salt-okunur özet + runs"). Compiling an instruction, editing the
 * step list, activating/deactivating and previewing are the console's; a
 * phone showing what a skill has been doing is a better trade than one that
 * can also change what it does.
 *
 * Unlike the Team roster (no per-agent `GET`), `GET /skills/{skillId}` exists,
 * so this screen fetches its own copy rather than trusting the row the list
 * screen navigated from — the same reasoning `CustomerDetailScreen` follows.
 * Runs load as a second, independent request, mirroring `TeamMemberScreen`'s
 * work-schedule section: the skill's own fields can render before its run
 * history has arrived.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { usePlaybookApi } from './context';
import type { SkillDetail, SkillRun } from './types';
import { formatDate, formatRunStatus } from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ColorTokens } from '../../theme/tokens';

export interface SkillDetailScreenProps {
  skillId: string;
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; skill: SkillDetail };

type RunsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; runs: SkillRun[] };

export function SkillDetailScreen({ skillId }: SkillDetailScreenProps) {
  const { colors } = useTheme();
  const api = usePlaybookApi();

  const [detail, setDetail] = useState<DetailState>({ status: 'loading' });
  const detailGeneration = useRef(0);

  useEffect(() => {
    const mine = ++detailGeneration.current;
    const controller = new AbortController();
    setDetail({ status: 'loading' });

    api
      .getSkill(skillId, controller.signal)
      .then((skill) => {
        if (mine !== detailGeneration.current) return;
        setDetail({ status: 'ready', skill });
      })
      .catch((error: unknown) => {
        if (mine !== detailGeneration.current || controller.signal.aborted) return;
        setDetail({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load this skill.',
        });
      });

    return () => controller.abort();
  }, [api, skillId]);

  const [runs, setRuns] = useState<RunsState>({ status: 'loading' });
  const runsGeneration = useRef(0);

  useEffect(() => {
    const mine = ++runsGeneration.current;
    const controller = new AbortController();
    setRuns({ status: 'loading' });

    api
      .listSkillRuns(skillId, controller.signal)
      .then((items) => {
        if (mine !== runsGeneration.current) return;
        setRuns({ status: 'ready', runs: items });
      })
      .catch((error: unknown) => {
        if (mine !== runsGeneration.current || controller.signal.aborted) return;
        setRuns({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load recent runs.',
        });
      });

    return () => controller.abort();
  }, [api, skillId]);

  if (detail.status === 'loading') {
    return (
      <View
        style={[styles.centre, { backgroundColor: colors.bgCanvas }]}
        testID="skill-detail-loading"
      >
        <DetailSkeleton />
      </View>
    );
  }

  if (detail.status === 'error') {
    return (
      <View
        style={[styles.centre, { backgroundColor: colors.bgCanvas }]}
        testID="skill-detail-error"
      >
        <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
          {detail.message}
        </Text>
      </View>
    );
  }

  const skill = detail.skill;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="skill-detail"
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{skill.name}</Text>
        <Badge
          label={skill.active ? 'Active' : 'Inactive'}
          tone={skill.active ? colors.success : colors.textTertiary}
        />
      </View>
      <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
        {skill.kind === 'ai_agent' ? 'AI agent skill' : 'Workspace skill'} · {skill.steps.length}{' '}
        {skill.steps.length === 1 ? 'step' : 'steps'}
      </Text>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Instruction</Text>
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {skill.instruction ?? 'No instruction on file — built from steps directly.'}
        </Text>
      </View>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Recent runs</Text>
        {runs.status === 'loading' && (
          <Text
            testID="skill-detail-runs-loading"
            style={[styles.emptyText, { color: colors.textTertiary }]}
          >
            Loading…
          </Text>
        )}
        {runs.status === 'error' && (
          <Text accessibilityRole="alert" style={[styles.emptyText, { color: colors.danger }]}>
            {runs.message}
          </Text>
        )}
        {runs.status === 'ready' && <RunsList runs={runs.runs} colors={colors} />}
      </View>
    </ScrollView>
  );
}

function RunsList({ runs, colors }: { runs: SkillRun[]; colors: ColorTokens }) {
  if (runs.length === 0) {
    return (
      <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
        This skill has not run yet.
      </Text>
    );
  }

  return (
    <View testID="skill-detail-runs">
      {runs.map((run) => (
        <View key={run.id} testID={`skill-run-${run.id}`} style={styles.runRow}>
          <View style={styles.runHeader}>
            <Badge label={formatRunStatus(run.status)} tone={runTone(colors, run.status)} />
            <Text style={[styles.runDate, { color: colors.textTertiary }]}>
              {formatDate(run.ran_at) ?? '—'}
            </Text>
          </View>
          {run.outcome && (
            <Text style={[styles.runOutcome, { color: colors.textSecondary }]}>{run.outcome}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

function runTone(colors: ColorTokens, status: SkillRun['status']): string {
  if (status === 'succeeded') return colors.success;
  if (status === 'failed') return colors.danger;
  return colors.warning;
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${tone}1a` }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{label}</Text>
    </View>
  );
}

/** Row-shaped placeholder while the record loads — same technique as the
 * Customers detail's. */
function DetailSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      testID="skill-detail-skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.skeleton}
    >
      <View
        style={[styles.skeletonBar, { width: '55%', height: 20, backgroundColor: colors.bgInset }]}
      />
      <View style={[styles.skeletonBar, { width: '35%', backgroundColor: colors.bgInset }]} />
      <View style={[styles.skeletonBar, { width: '80%', backgroundColor: colors.bgInset }]} />
      <View style={[styles.skeletonBar, { width: '60%', backgroundColor: colors.bgInset }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: SPACING[4], gap: SPACING[4] },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  message: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    textAlign: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  title: { fontSize: FONT_SIZE.xl.size, lineHeight: FONT_SIZE.xl.lineHeight, fontWeight: '600' },
  subtitle: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[3],
    gap: SPACING[2],
  },
  cardTitle: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  emptyText: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
  runRow: {
    paddingVertical: SPACING[2],
    gap: SPACING[1],
  },
  runHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  runDate: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  runOutcome: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
  badge: { paddingHorizontal: SPACING[2], paddingVertical: 2, borderRadius: RADIUS.sm },
  badgeText: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: '600',
  },
  skeleton: { width: '100%', gap: SPACING[3], padding: SPACING[4] },
  skeletonBar: { height: 12, borderRadius: RADIUS.sm },
});
