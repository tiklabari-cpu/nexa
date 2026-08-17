/**
 * One teammate, read-only — built from the roster row the list screen already
 * has (`GET /agents` carries role/status/expertise; there is no
 * `GET /agents/{agentId}`) plus their declared weekly plan
 * (`GET /agents/{agentId}/work-schedule`). Role, suspension and expertise
 * edits, and the invite flow, are the console's (13.7-m KAPSAM).
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { WORK_SCHEDULE_DAYS } from '@nexa/types';

import { useTeamApi } from './context';
import type { Agent, AgentWorkSchedule } from './types';
import { DAY_LABEL, formatRole, formatRoutingStatus } from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ColorTokens } from '../../theme/tokens';

export interface TeamMemberScreenProps {
  agent: Agent;
}

type ScheduleState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; schedule: AgentWorkSchedule };

export function TeamMemberScreen({ agent }: TeamMemberScreenProps) {
  const { colors } = useTheme();
  const api = useTeamApi();

  const [state, setState] = useState<ScheduleState>({ status: 'loading' });
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState({ status: 'loading' });

    api
      .getAgentWorkSchedule(agent.id, controller.signal)
      .then((schedule) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', schedule });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load this schedule.',
        });
      });

    return () => controller.abort();
  }, [api, agent.id]);

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="team-member"
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{agent.name}</Text>
        {agent.suspended && <Badge label="Suspended" tone={colors.danger} />}
      </View>
      <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
        {formatRole(agent.role)} ·{' '}
        {agent.suspended ? 'Suspended' : formatRoutingStatus(agent.routing_status)}
      </Text>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <Field label="Email" value={agent.email} />
        <Field label="Concurrent chats" value={String(agent.concurrent_chats_limit)} />
        <Field
          label="Two-factor auth"
          value={agent.two_factor_enabled ? 'Enabled' : 'Not enabled'}
        />
      </View>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Expertise</Text>
        {(agent.expertise ?? []).length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
            No expertise areas set.
          </Text>
        ) : (
          <View style={styles.chips}>
            {(agent.expertise ?? []).map((area) => (
              <View key={area.id} style={[styles.chip, { backgroundColor: colors.bgInset }]}>
                <Text style={[styles.chipText, { color: colors.textSecondary }]}>{area.name}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View
        style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
      >
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Work schedule</Text>
        {state.status === 'loading' && (
          <Text
            testID="team-member-schedule-loading"
            style={[styles.emptyText, { color: colors.textTertiary }]}
          >
            Loading…
          </Text>
        )}
        {state.status === 'error' && (
          <Text accessibilityRole="alert" style={[styles.emptyText, { color: colors.danger }]}>
            {state.message}
          </Text>
        )}
        {state.status === 'ready' && <WorkScheduleList schedule={state.schedule} colors={colors} />}
      </View>
    </ScrollView>
  );
}

function WorkScheduleList({
  schedule,
  colors,
}: {
  schedule: AgentWorkSchedule;
  colors: ColorTokens;
}) {
  const slotByDay = new Map(schedule.schedule.map((slot) => [slot.day, slot]));
  return (
    <View testID="team-member-schedule">
      <Text style={[styles.timezone, { color: colors.textTertiary }]}>
        Timezone: {schedule.timezone}
      </Text>
      {WORK_SCHEDULE_DAYS.map((day) => {
        const slot = slotByDay.get(day);
        return (
          <View key={day} style={[styles.scheduleRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.scheduleDay, { color: colors.textPrimary }]}>
              {DAY_LABEL[day]}
            </Text>
            <Text style={[styles.scheduleHours, { color: colors.textSecondary }]}>
              {slot && slot.enabled ? `${slot.start}–${slot.end}` : 'Off'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${tone}1a` }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: SPACING[4], gap: SPACING[4] },
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
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING[1],
  },
  fieldLabel: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
  fieldValue: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING[2] },
  chip: { paddingHorizontal: SPACING[2], paddingVertical: SPACING[1], borderRadius: RADIUS.sm },
  chipText: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  timezone: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    marginBottom: SPACING[1],
  },
  scheduleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scheduleDay: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
  scheduleHours: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  badge: { paddingHorizontal: SPACING[2], paddingVertical: 2, borderRadius: RADIUS.sm },
  badgeText: {
    fontSize: FONT_SIZE['2xs'].size,
    lineHeight: FONT_SIZE['2xs'].lineHeight,
    fontWeight: '600',
  },
});
