/**
 * One customer, read-only — the mobile slice of the web `CustomerDetailPanel`
 * (13.7-g KAPSAM: "salt-okunur + temel alanlar"). Editing, the ban toggle,
 * custom fields, visit history and the conversation list are the console's;
 * a phone showing a stranger's browsing history and a destructive action one
 * mis-tap away is a worse trade than a screen that only answers "who is this".
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useCustomersApi } from './context';
import type { CustomerDetail } from './types';
import { formatDate } from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';

export interface CustomerDetailScreenProps {
  customerId: string;
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; customer: CustomerDetail };

export function CustomerDetailScreen({ customerId }: CustomerDetailScreenProps) {
  const { colors } = useTheme();
  const api = useCustomersApi();

  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState({ status: 'loading' });

    api
      .getCustomer(customerId, controller.signal)
      .then((customer) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', customer });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load this customer.',
        });
      });

    return () => controller.abort();
  }, [api, customerId]);

  if (state.status === 'loading') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bgCanvas }]} testID="customer-detail-loading">
        <DetailSkeleton />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bgCanvas }]} testID="customer-detail-error">
        <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
          {state.message}
        </Text>
      </View>
    );
  }

  const customer = state.customer;
  const name = customer.name ?? 'Unnamed visitor';

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="customer-detail"
    >
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
        {customer.is_lead && <Badge label="Lead" tone={colors.info} />}
        {customer.banned && <Badge label="Banned" tone={colors.danger} />}
      </View>
      <Text style={[styles.subtitle, { color: colors.textTertiary }]}>
        First seen {formatDate(customer.created_at) ?? '—'}
      </Text>

      <View style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
        <Field label="Email" value={customer.email ?? '—'} />
        <Field label="Phone" value={customer.phone ?? '—'} />
        <Field label="Country" value={customer.country ?? customer.country_code ?? '—'} />
      </View>

      <View style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}>
        <Field label="Conversations" value={String(customer.chats_count)} />
        <Field label="Tickets" value={String(customer.tickets_count)} />
        <Field label="Last active" value={formatDate(customer.last_activity_at) ?? 'Never'} />
      </View>
    </ScrollView>
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

/** Row-shaped placeholder while the record loads — same technique as the list's. */
function DetailSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      testID="customer-detail-skeleton"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.skeleton}
    >
      <View style={[styles.skeletonBar, { width: '55%', height: 20, backgroundColor: colors.bgInset }]} />
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
  message: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight, textAlign: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  title: { fontSize: FONT_SIZE.xl.size, lineHeight: FONT_SIZE.xl.lineHeight, fontWeight: '600' },
  subtitle: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[1],
  },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING[2],
  },
  fieldLabel: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
  fieldValue: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight, fontWeight: '600' },
  badge: { paddingHorizontal: SPACING[2], paddingVertical: 2, borderRadius: RADIUS.sm },
  badgeText: { fontSize: FONT_SIZE['2xs'].size, lineHeight: FONT_SIZE['2xs'].lineHeight, fontWeight: '600' },
  skeleton: { width: '100%', gap: SPACING[3], padding: SPACING[4] },
  skeletonBar: { height: 12, borderRadius: RADIUS.sm },
});
