/**
 * Reports — the mobile slice of the web `ReportsPage`'s Overview tab
 * (13.7-h KAPSAM: "Overview KPI kartları, salt-okunur"). No range picker, no
 * benchmark baseline, no by-agent table or tag list — those are the console's;
 * a phone reading headline numbers at a glance is a better trade than a
 * cramped copy of the ten-tab desktop report (same reasoning `13.7-g` applied
 * to the Customers detail panel). The API still defaults to the last 30 days
 * with no query at all, so this screen asks for nothing and gets that window.
 *
 * The SLA card's `low_confidence` hint is the one piece of desktop behaviour
 * this screen must not drop (FR-MOD-07.3.2 "düşük-baz uyarısı") — dropping it
 * would let a two-case window's breach count read as a solid fact rather than
 * the noise it is.
 */
import { useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useReportsApi } from './context';
import type { ReportsOverview } from './types';
import { formatCount, formatDuration, formatRate } from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ColorTokens } from '../../theme/tokens';

type OverviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; overview: ReportsOverview };

export function ReportsScreen() {
  const { colors } = useTheme();
  const api = useReportsApi();

  const [state, setState] = useState<OverviewState>({ status: 'loading' });
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState({ status: 'loading' });

    api
      .getOverview(controller.signal)
      .then((overview) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', overview });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load reports.',
        });
      });

    return () => controller.abort();
  }, [api]);

  if (state.status === 'loading') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bgCanvas }]} testID="reports-loading">
        <ReportsSkeleton />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bgCanvas }]} testID="reports-error">
        <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
          {state.message}
        </Text>
      </View>
    );
  }

  const { totals, chats, response_times, satisfaction, sla } = state.overview;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="reports-overview"
    >
      <Section title="Volume" description="Conversations and tickets in the last 30 days.">
        <KpiCard label="Conversations" value={formatCount(totals.chats)} />
        <KpiCard
          label="Total cases"
          value={formatCount(totals.total_cases)}
          hint={`${formatCount(totals.chats)} chats + ${formatCount(totals.tickets)} tickets`}
        />
        <KpiCard label="Closed" value={formatCount(totals.closed)} />
        <KpiCard
          label="In queue now"
          value={formatCount(totals.queued_now)}
          tone={totals.queued_now > 0 ? 'warn' : 'neutral'}
          hint={totals.queued_now > 0 ? 'Waiting for an agent' : 'Nobody waiting'}
        />
        <KpiCard label="Achieved goals" value={formatCount(totals.achieved_goals)} />
      </Section>

      <Section
        title="Resolution"
        description="How closed conversations were handled. Manual, assisted and automated add up to every closed case."
      >
        <KpiCard
          label="Manual"
          value={formatCount(totals.manual)}
          hint={closedShare(totals.manual_rate)}
        />
        <KpiCard
          label="Assisted"
          value={formatCount(totals.assisted)}
          hint={closedShare(totals.assisted_rate)}
          tone="good"
        />
        <KpiCard
          label="Automated"
          value={formatCount(totals.automated)}
          hint={closedShare(totals.automated_rate)}
          tone="good"
        />
      </Section>

      <Section
        title="Chats"
        description="How fast the AI clears conversations and how long they run."
      >
        <KpiCard
          label="Automated chats / hour"
          value={formatCount(chats.automated_per_hour)}
          hint="AI resolutions per hour across the window"
        />
        <KpiCard
          label="Automated chat duration"
          value={formatDuration(chats.automated_avg_duration_seconds)}
          hint="Average, open to close"
        />
        <KpiCard
          label="Total chat duration"
          value={formatDuration(chats.total_duration_seconds)}
          hint="Every closed conversation, summed"
        />
      </Section>

      <Section title="Responsiveness">
        <KpiCard
          label="First response"
          value={formatDuration(response_times.avg_first_response_seconds)}
          hint="Average time to the first agent reply"
        />
        <KpiCard
          label="Conversation length"
          value={formatDuration(response_times.avg_duration_seconds)}
          hint="Average from open to close"
        />
        <KpiCard
          label="Satisfaction"
          value={formatRate(satisfaction.score) ?? '—'}
          hint={
            satisfaction.responses === 0
              ? 'No ratings yet'
              : `${formatCount(satisfaction.responses)} rating${satisfaction.responses === 1 ? '' : 's'}`
          }
          tone={
            satisfaction.score == null ? 'neutral' : satisfaction.score >= 0.8 ? 'good' : 'warn'
          }
        />
        <KpiCard
          label="Negative ratings"
          value={formatCount(satisfaction.bad)}
          tone={satisfaction.bad > 0 ? 'warn' : 'neutral'}
        />
        <KpiCard
          label="SLA breaches"
          value={sla.active ? formatCount(sla.breaches) : '—'}
          tone={sla.active && sla.breaches > 0 ? 'warn' : 'neutral'}
          hint={
            !sla.active
              ? 'Set targets in Settings → SLA to track this'
              : sla.low_confidence
                ? 'Not enough cases yet to read much into this'
                : undefined
          }
        />
      </Section>
    </ScrollView>
  );
}

/** Hint under a resolution KPI: its share of *closed* conversations. Mirrors
 * the web Reports page's `closedShare` — null (not 0%) reads as "nothing
 * closed", never as a failure. */
function closedShare(rate: number | null | undefined): string {
  return rate == null ? 'Nothing closed in this window' : `${formatRate(rate)} of closed`;
}

function Section({
  title,
  description,
  children,
}: PropsWithChildren<{ title: string; description?: string }>) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>{title}</Text>
      {description && (
        <Text style={[styles.sectionDescription, { color: colors.textTertiary }]}>
          {description}
        </Text>
      )}
      <View style={styles.grid}>{children}</View>
    </View>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | null;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const { colors } = useTheme();
  return (
    <View
      testID={`reports-kpi-${label}`}
      style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
    >
      <Text style={[styles.cardLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.cardValue, { color: toneColor(colors, tone) }]}>{value ?? '—'}</Text>
      {hint && <Text style={[styles.cardHint, { color: colors.textTertiary }]}>{hint}</Text>}
    </View>
  );
}

function toneColor(colors: ColorTokens, tone: 'neutral' | 'good' | 'warn'): string {
  if (tone === 'good') return colors.success;
  if (tone === 'warn') return colors.warning;
  return colors.textPrimary;
}

/** Card-shaped placeholder while the overview loads — same technique as the
 * Customers screens' skeletons. */
function ReportsSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      testID="reports-skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.skeleton}
    >
      {Array.from({ length: 4 }, (_, index) => (
        <View key={index} style={[styles.skeletonBar, { backgroundColor: colors.bgInset }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: SPACING[4], gap: SPACING[6] },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  message: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    textAlign: 'center',
  },
  section: { gap: SPACING[2] },
  sectionTitle: {
    fontSize: FONT_SIZE.lg.size,
    lineHeight: FONT_SIZE.lg.lineHeight,
    fontWeight: '600',
  },
  sectionDescription: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING[3] },
  card: {
    minWidth: 150,
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING[3],
    gap: SPACING[1],
  },
  cardLabel: {
    fontSize: FONT_SIZE.xs.size,
    lineHeight: FONT_SIZE.xs.lineHeight,
    fontWeight: '500',
  },
  cardValue: {
    fontSize: FONT_SIZE.xl.size,
    lineHeight: FONT_SIZE.xl.lineHeight,
    fontWeight: '600',
  },
  cardHint: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  skeleton: { width: '100%', gap: SPACING[3], padding: SPACING[4] },
  skeletonBar: { height: 64, borderRadius: RADIUS.md },
});
