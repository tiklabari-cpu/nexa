/**
 * Billing — mobile's read-only slice of the web `BillingPage` (13.7-o KAPSAM:
 * plan card + period usage + entitlement list + invoice rows). Changing the
 * plan, seats or billing cycle, buying an API package, and the payment method
 * itself (reading or writing) are all console jobs — and for the payment
 * method specifically, a hard limit rather than a scope trim: CLAUDE.md rules
 * out a card/payment surface on the phone outright, not just "authoring is
 * desk work" the way the other narrowed modules reason about it.
 *
 * The four requests load together behind one skeleton, the way
 * `ReportsScreen` reads its single endpoint — unlike `TeamMemberScreen` or
 * `SkillDetailScreen`, nothing here is worth showing partially: a plan card
 * without its usage figures, or usage without knowing whether the workspace
 * is read-only, is a page that reads wrong rather than a page that reads
 * incomplete.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useBillingApi } from './context';
import type { Entitlements, Invoice, Subscription, Usage } from './types';
import {
  ENTITLEMENT_LABEL,
  formatCount,
  formatDate,
  formatInvoiceStatus,
  formatMoney,
} from './format';
import { FONT_SIZE, RADIUS, SPACING } from '../../theme/tokens';
import { useTheme } from '../../theme/theme';
import type { ColorTokens } from '../../theme/tokens';

type BillingState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      subscription: Subscription;
      usage: Usage;
      invoices: Invoice[];
      entitlements: Entitlements;
    };

export function BillingScreen() {
  const { colors } = useTheme();
  const api = useBillingApi();

  const [state, setState] = useState<BillingState>({ status: 'loading' });
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    const controller = new AbortController();
    setState({ status: 'loading' });

    Promise.all([
      api.getSubscription(controller.signal),
      api.getUsage(controller.signal),
      api.listInvoices(controller.signal),
      api.getEntitlements(controller.signal),
    ])
      .then(([subscription, usage, invoices, entitlements]) => {
        if (mine !== generation.current) return;
        setState({ status: 'ready', subscription, usage, invoices, entitlements });
      })
      .catch((error: unknown) => {
        if (mine !== generation.current || controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not load billing.',
        });
      });

    return () => controller.abort();
  }, [api]);

  if (state.status === 'loading') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bgCanvas }]} testID="billing-loading">
        <BillingSkeleton />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[styles.centre, { backgroundColor: colors.bgCanvas }]} testID="billing-error">
        <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
          {state.message}
        </Text>
      </View>
    );
  }

  const { subscription, usage, invoices, entitlements } = state;

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.bgCanvas }]}
      contentContainerStyle={styles.content}
      testID="billing-screen"
    >
      <PlanCard subscription={subscription} colors={colors} />
      <UsageCard usage={usage} colors={colors} />
      <EntitlementsCard entitlements={entitlements} colors={colors} />
      <InvoicesCard invoices={invoices} colors={colors} />
    </ScrollView>
  );
}

function PlanCard({ subscription, colors }: { subscription: Subscription; colors: ColorTokens }) {
  const trialDaysRemaining = subscription.trial?.days_remaining ?? null;

  return (
    <View
      testID="billing-plan"
      style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Plan</Text>
        <Badge label={statusLabel(subscription)} tone={statusTone(colors, subscription)} />
      </View>

      {subscription.access === 'read_only' && (
        <Text accessibilityRole="alert" style={[styles.readOnlyNotice, { color: colors.warning }]}>
          This workspace is read-only — the trial ended. Existing conversations stay readable and
          exportable.
        </Text>
      )}

      {subscription.access === 'trialing' && trialDaysRemaining !== null && (
        <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
          {trialDaysRemaining} {trialDaysRemaining === 1 ? 'day' : 'days'} left in the trial.
          Nothing is billed while trialing.
        </Text>
      )}

      <Field label="Plan" value={subscription.plan} colors={colors} />
      <Field label="Billing cycle" value={subscription.billing_cycle} colors={colors} />
      <Field label="Seats" value={formatCount(subscription.seats) ?? '—'} colors={colors} />
      <Field
        label="Price per seat"
        value={
          subscription.pricing === 'quoted'
            ? 'Contact sales'
            : (formatMoney(subscription.unit_price_cents) ?? '—')
        }
        colors={colors}
      />
      <Field
        label="Estimated total"
        value={formatMoney(subscription.estimated_total_cents) ?? '—'}
        colors={colors}
      />
    </View>
  );
}

function statusLabel(subscription: Subscription): string {
  return subscription.status.replace('_', ' ');
}

function statusTone(colors: ColorTokens, subscription: Subscription): string {
  if (subscription.access === 'active') return colors.success;
  if (subscription.access === 'read_only') return colors.warning;
  return colors.textTertiary;
}

function UsageCard({ usage, colors }: { usage: Usage; colors: ColorTokens }) {
  const { ai_resolutions: ai, api_calls: apiCalls } = usage;
  const aiOver = ai.overage > 0;
  const apiOver = apiCalls.overage > 0;

  return (
    <View
      testID="billing-usage"
      style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
    >
      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
        Usage — {usage.period_label}
      </Text>

      {usage.quota_warning && (
        <Text
          testID="billing-quota-warning"
          accessibilityRole="alert"
          style={[styles.readOnlyNotice, { color: colors.warning }]}
        >
          {aiOver
            ? `${formatCount(ai.overage)} AI resolutions past the included allowance this period.`
            : 'Nearing the included AI resolutions for this period.'}
        </Text>
      )}

      <Field
        label="AI resolutions"
        value={`${formatCount(ai.used) ?? 0} / ${formatCount(ai.included) ?? 0}`}
        tone={aiOver ? colors.warning : undefined}
        colors={colors}
      />
      <Field
        label="API calls"
        value={`${formatCount(apiCalls.used) ?? 0} / ${formatCount(apiCalls.included) ?? 0}`}
        tone={apiOver ? colors.warning : undefined}
        colors={colors}
      />
    </View>
  );
}

function EntitlementsCard({
  entitlements,
  colors,
}: {
  entitlements: Entitlements;
  colors: ColorTokens;
}) {
  const keys = Object.keys(ENTITLEMENT_LABEL) as (keyof Entitlements['entitlements'])[];

  return (
    <View
      testID="billing-entitlements"
      style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
    >
      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
        Entitlements — {entitlements.plan}
      </Text>
      {keys.map((key) => {
        const granted = entitlements.entitlements[key];
        return (
          <View key={key} style={styles.entitlementRow} testID={`entitlement-${key}`}>
            <Text style={[styles.entitlementLabel, { color: colors.textSecondary }]}>
              {ENTITLEMENT_LABEL[key]}
            </Text>
            <Badge
              label={granted ? 'On' : 'Off'}
              tone={granted ? colors.success : colors.textTertiary}
            />
          </View>
        );
      })}
    </View>
  );
}

function InvoicesCard({ invoices, colors }: { invoices: Invoice[]; colors: ColorTokens }) {
  return (
    <View
      testID="billing-invoices"
      style={[styles.card, { backgroundColor: colors.bgSurface, borderColor: colors.border }]}
    >
      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Invoices</Text>
      {invoices.length === 0 ? (
        <Text
          testID="billing-invoices-empty"
          style={[styles.emptyText, { color: colors.textTertiary }]}
        >
          No invoices yet.
        </Text>
      ) : (
        invoices.map((invoice) => (
          <View
            key={invoice.period}
            testID={`invoice-row-${invoice.period}`}
            style={[styles.invoiceRow, { borderBottomColor: colors.border }]}
          >
            <View style={styles.invoiceMain}>
              <Text style={[styles.invoiceNumber, { color: colors.textPrimary }]}>
                {invoice.number}
              </Text>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {invoice.period_label} · {formatDate(invoice.issued_at) ?? '—'}
              </Text>
            </View>
            <View style={styles.invoiceAside}>
              <Text style={[styles.invoiceAmount, { color: colors.textPrimary }]}>
                {formatMoney(invoice.total_cents, invoice.currency.toUpperCase()) ?? '—'}
              </Text>
              <Text style={[styles.emptyText, { color: colors.textTertiary }]}>
                {formatInvoiceStatus(invoice.status)}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

function Field({
  label,
  value,
  tone,
  colors,
}: {
  label: string;
  value: string;
  tone?: string;
  colors: ColorTokens;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: tone ?? colors.textPrimary }]}>{value}</Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${tone}1a` }]}>
      <Text style={[styles.badgeText, { color: tone, textTransform: 'capitalize' }]}>{label}</Text>
    </View>
  );
}

/** Card-shaped placeholder while every request loads — same technique as
 * `ReportsScreen`'s skeleton. */
function BillingSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      testID="billing-skeleton"
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
  content: { padding: SPACING[4], gap: SPACING[4] },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING[6] },
  message: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    textAlign: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING[4],
    paddingVertical: SPACING[3],
    gap: SPACING[2],
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING[2] },
  cardTitle: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  readOnlyNotice: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
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
  entitlementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING[1],
  },
  entitlementLabel: { fontSize: FONT_SIZE.sm.size, lineHeight: FONT_SIZE.sm.lineHeight },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING[2],
    paddingVertical: SPACING[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  invoiceMain: { flex: 1, gap: 2 },
  invoiceAside: { alignItems: 'flex-end', gap: 2 },
  invoiceNumber: {
    fontSize: FONT_SIZE.sm.size,
    lineHeight: FONT_SIZE.sm.lineHeight,
    fontWeight: '600',
  },
  invoiceAmount: {
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
  skeleton: { width: '100%', gap: SPACING[3], padding: SPACING[4] },
  skeletonBar: { height: 64, borderRadius: RADIUS.md },
});
