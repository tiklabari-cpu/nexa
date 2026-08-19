/**
 * Billing — plan, trial state and metered usage.
 *
 * The quota is shown before it is exceeded, not after (PRD §8.3 flow 5). A
 * usage limit that only announces itself at 100% arrives as a support ticket.
 *
 * An expired trial is read-only, not locked (ADR-10): the workspace keeps its
 * data and can still export it. The banner says so plainly, because "your trial
 * ended" without that reads as "your data is gone".
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import {
  Card,
  CardSkeleton,
  ErrorNotice,
  Kpi,
  KpiGrid,
  Page,
  Section,
} from '../../components/Page.js';
import { Banner } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { formatCount, formatDate, formatMoney } from '../../lib/format.js';

interface UsageSummary {
  period: string;
  ai_resolutions: {
    used: number;
    included: number;
    overage: number;
    overage_cents: number;
    // The overage pack size and per-resolution price, so the meter can quote the
    // extra-usage price before the allowance runs out (FR-MOD-10.1.4).
    overage_unit: number;
    overage_unit_price_cents: number;
  };
  api_calls: {
    used: number;
    included: number;
    overage: number;
    overage_cents: number;
    // Block size (100,000) and its price — API-call overage bills by the block,
    // not the call (FR-MOD-10.1.5).
    overage_unit: number;
    overage_unit_price_cents: number;
  };
}

interface Subscription {
  plan: string;
  billing_cycle: string;
  status: string;
  access: 'trialing' | 'active' | 'read_only';
  trial: { ends_at: string | null; days_remaining: number | null };
  seats: number;
  min_seats: number;
  unit_price_cents: number;
  usage: UsageSummary;
  estimated_total_cents: number;
  annual_savings_cents: number;
  provider: string;
}

interface Usage extends UsageSummary {
  quota_warning: boolean;
  period_label: string;
}

interface InvoiceLineItem {
  description: string;
  amount_cents: number;
}

interface Invoice {
  number: string;
  period: string;
  period_label: string;
  issued_at: string;
  status: 'paid' | 'open' | 'trial';
  currency: string;
  line_items: InvoiceLineItem[];
  subtotal_cents: number;
  total_cents: number;
}

interface PaymentMethod {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  holder_name: string;
  updated_at: string;
}

/** A catalogue entry a workspace can buy (FR-MOD-09.3). */
interface ApiPackageItem {
  id: string;
  name: string;
  api_calls: number;
  price_cents: number;
}

/** One recorded purchase (FR-MOD-09.3) — quota and price as sold, not re-derived. */
interface ApiPackagePurchase {
  id: string;
  package_id: string;
  name: string | null;
  api_calls: number;
  price_cents: number;
  period: string;
  purchased_at: string;
}

/** The receipt plus the period's usage after the purchase credited its quota. */
interface ApiPackagePurchaseResult {
  purchase: ApiPackagePurchase;
  usage: UsageSummary;
}

const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover'] as const;

export function BillingPage(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const subscription = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => api.get<Subscription>('/billing/subscription'),
  });

  const usage = useQuery({
    queryKey: ['billing', 'usage'],
    queryFn: () => api.get<Usage>('/billing/usage'),
  });

  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (body: { billing_cycle?: string; seats?: number }) =>
      api.patch<Subscription>('/billing/subscription', body),
    // The reply is a full subscription view, so the whole page updates from it
    // without a refetch round trip.
    onSuccess: (updated) => queryClient.setQueryData(['billing', 'subscription'], updated),
  });

  if (subscription.error || usage.error) {
    return (
      <Page title={t('billing.page.title')}>
        <ErrorNotice message={t('billing.page.loadError')} />
      </Page>
    );
  }

  if (subscription.isPending || usage.isPending) {
    return (
      <Page title={t('billing.page.title')}>
        <CardSkeleton rows={2} />
        <CardSkeleton rows={3} />
      </Page>
    );
  }

  const sub = subscription.data;
  const use = usage.data;
  const ai = use.ai_resolutions;
  const apiCalls = use.api_calls;
  const apiOver = apiCalls.overage > 0;
  const quotaFraction = ai.included > 0 ? ai.used / ai.included : 0;
  // The percentage the counter shows next to "N / limit" (FR-MOD-10.1.4). Not
  // clamped — a workspace over its allowance sees the real figure (e.g. 130%),
  // not a reassuring 100%.
  const quotaPercent = Math.round(quotaFraction * 100);
  const aiOver = ai.overage > 0;
  // What a full overage pack costs: pack size × per-resolution price. The pack
  // is a pricing bundle; the invoice still meters per resolution, so a partial
  // pack costs less than this.
  const packPriceCents = ai.overage_unit * ai.overage_unit_price_cents;

  return (
    <Page
      title={t('billing.page.title')}
      description={t('billing.page.description', { period: use.period_label })}
    >
      {sub.access === 'read_only' && (
        <Banner tone="warning" role="alert" title={t('billing.readOnly.title')}>
          {t('billing.readOnly.description')}
        </Banner>
      )}

      {sub.access === 'trialing' && sub.trial.days_remaining !== null && (
        <div role="status" className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium">
            {t('billing.trial.daysLeft', { count: sub.trial.days_remaining })}
          </p>
          <p className="mt-1 text-sm text-content-secondary">
            {sub.trial.ends_at
              ? t('billing.trial.noticeWithEnd', { date: formatDate(sub.trial.ends_at) ?? '' })
              : t('billing.trial.notice')}
          </p>
        </div>
      )}

      <Section title={t('billing.plan.title')}>
        <KpiGrid>
          <Kpi label={t('billing.plan.kpi.plan')} value={sub.plan} hint={sub.billing_cycle} />
          <Kpi
            label={t('billing.plan.kpi.seats')}
            value={formatCount(sub.seats)}
            hint={t('billing.plan.kpi.seatsHint', {
              price: formatMoney(sub.unit_price_cents) ?? '',
            })}
          />
          <Kpi
            label={t('billing.plan.kpi.estimatedTotal')}
            value={formatMoney(sub.estimated_total_cents)}
            hint={
              sub.access === 'trialing'
                ? t('billing.plan.kpi.estimatedTotalHintTrial')
                : t('billing.plan.kpi.estimatedTotalHintPeriod')
            }
          />
          <Kpi
            label={t('billing.plan.kpi.status')}
            value={sub.status}
            tone={
              sub.access === 'active' ? 'good' : sub.access === 'read_only' ? 'warn' : 'neutral'
            }
          />
        </KpiGrid>
      </Section>

      <ManagePlan sub={sub} onChange={change.mutate} pending={change.isPending} />

      <Section title={t('billing.aiMeter.title')} description={t('billing.aiMeter.description')}>
        {/* Proactive warning from 80% (PRD §8.3 flow 5, KR2.3): the quota is
            surfaced before it is exceeded. A limit that only announces itself at
            100% arrives as a support ticket — the "surprise overage" complaint
            Nexa's transparent pricing is meant to eliminate. */}
        {use.quota_warning && (
          <div
            role="alert"
            data-testid="quota-warning"
            className="rounded-lg border border-border bg-surface p-4"
          >
            <p className="text-sm font-medium text-warning">
              {aiOver
                ? t('billing.aiMeter.pastIncluded')
                : t('billing.aiMeter.percentUsedWarning', { percent: quotaPercent })}
            </p>
            <p className="mt-1 text-sm text-content-secondary">
              {aiOver
                ? t('billing.aiMeter.overageDetail', {
                    overage: formatCount(ai.overage) ?? '',
                    included: formatCount(ai.included) ?? '',
                    price: formatMoney(ai.overage_unit_price_cents) ?? '',
                  })
                : t('billing.aiMeter.usedDetail', {
                    used: formatCount(ai.used) ?? '',
                    included: formatCount(ai.included) ?? '',
                    price: formatMoney(ai.overage_unit_price_cents) ?? '',
                  })}
            </p>
          </div>
        )}

        <Card>
          <div className="p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span data-testid="ai-counter" className="tabular text-2xl font-bold">
                {formatCount(ai.used)}
                <span className="text-base font-normal text-content-tertiary">
                  {' / '}
                  {formatCount(ai.included)}{' '}
                  <span data-testid="quota-percent">
                    ({t('billing.aiMeter.percentUsed', { percent: quotaPercent })})
                  </span>
                </span>
              </span>
              {use.quota_warning && (
                <span className="text-xs font-medium text-warning">
                  {aiOver ? t('billing.aiMeter.overAllowance') : t('billing.aiMeter.nearingLimit')}
                </span>
              )}
            </div>

            <QuotaBar fraction={quotaFraction} warning={use.quota_warning} />

            {aiOver && (
              <p className="mt-3 text-sm text-content-secondary">
                {t('billing.aiMeter.overageNotice', {
                  overage: formatCount(ai.overage) ?? '',
                  amount: formatMoney(ai.overage_cents) ?? '',
                })}
              </p>
            )}
          </div>
        </Card>

        {/* Overage package (aşım paketi, FR-MOD-10.1.4). Shown even at zero
            overage: the price of extra usage is visible before you reach the
            limit, not discovered on the bill. */}
        <Card>
          <div
            data-testid="overage-package"
            className="flex flex-wrap items-baseline justify-between gap-2 p-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('billing.aiMeter.overagePackageTitle')}</p>
              <p className="mt-0.5 text-sm text-content-secondary">
                {t('billing.aiMeter.overagePackageDetail', {
                  included: formatCount(ai.included) ?? '',
                  price: formatMoney(ai.overage_unit_price_cents) ?? '',
                  unit: formatCount(ai.overage_unit) ?? '',
                  packPrice: formatMoney(packPriceCents) ?? '',
                })}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                {t('billing.aiMeter.periodLabel')}
              </p>
              <p data-testid="overage-charge" className="tabular text-lg font-semibold">
                {formatMoney(ai.overage_cents)}
              </p>
            </div>
          </div>
        </Card>
      </Section>

      {/* API calls (FR-MOD-10.1.5): the counter (sayaç) and the overage that
          lands on the invoice (aşım faturaya). Billed by the block — $29.50 per
          100,000 over the allowance — with the price shown before any is spent,
          the same up-front honesty as the AI meter. */}
      <Section title={t('billing.apiCalls.title')} description={t('billing.apiCalls.description')}>
        <Card>
          <div className="p-4">
            <KpiGrid>
              <Kpi
                label={t('billing.apiCalls.used')}
                value={formatCount(apiCalls.used)}
                hint={t('billing.apiCalls.usedHint', {
                  included: formatCount(apiCalls.included) ?? '',
                })}
              />
              <Kpi label={t('billing.apiCalls.included')} value={formatCount(apiCalls.included)} />
              <Kpi
                label={t('billing.apiCalls.overage')}
                value={formatCount(apiCalls.overage)}
                tone={apiOver ? 'warn' : 'neutral'}
              />
              <Kpi
                label={t('billing.apiCalls.overageCharge')}
                value={formatMoney(apiCalls.overage_cents)}
                hint={t('billing.apiCalls.overageChargeHint')}
              />
            </KpiGrid>
            <p data-testid="api-overage-terms" className="mt-3 text-2xs text-content-tertiary">
              {t('billing.apiCalls.overageTerms', {
                included: formatCount(apiCalls.included) ?? '',
                price: formatMoney(apiCalls.overage_unit_price_cents) ?? '',
                unit: formatCount(apiCalls.overage_unit) ?? '',
              })}
            </p>
          </div>
        </Card>
      </Section>

      <ApiPackagesSection />

      <ApiPackagePurchasesSection />

      <PaymentMethodSection readOnly={sub.access === 'read_only'} />

      <InvoicesSection />

      <p className="text-2xs text-content-tertiary">
        {t('billing.page.providerNotice', { provider: sub.provider })}
      </p>
    </Page>
  );
}

/**
 * Quota bar that keeps rendering past 100%.
 *
 * The fill is clamped so the bar cannot overflow its track, but the label above
 * carries the true number. Hiding overage behind a full-looking bar is how a
 * customer finds out about it on the invoice instead.
 */
function QuotaBar({ fraction, warning }: { fraction: number; warning: boolean }): ReactElement {
  const t = useTranslate();
  const percent = Math.round(fraction * 100);
  return (
    <div
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t('billing.aiMeter.quotaBarAriaLabel')}
      className="h-2 w-full overflow-hidden rounded-full bg-inset"
    >
      <div
        className={`h-full rounded-full ${warning ? 'bg-warning' : 'bg-brand-500'}`}
        style={{ width: `${Math.min(100, Math.max(1, percent))}%` }}
      />
    </div>
  );
}

/**
 * The checkout levers (FR-MOD-10.1.1–.3): billing cycle, seats and the summary.
 *
 * Every change persists straight away through `PATCH /billing/subscription` and
 * the page re-reads from the reply, so the summary is the server's arithmetic,
 * not a second copy that could drift. The seat count cannot go below the active
 * headcount (`min_seats`) — the minus button disables at the floor rather than
 * letting the request fail.
 *
 * The payment method itself lives in its own section (FR-MOD-10.3); during the
 * trial the amount billed now is $0 (FR-MOD-10.1.6).
 */
function ManagePlan({
  sub,
  onChange,
  pending,
}: {
  sub: Subscription;
  onChange: (body: { billing_cycle?: string; seats?: number }) => void;
  pending: boolean;
}): ReactElement {
  const t = useTranslate();
  const annual = sub.billing_cycle === 'annual';
  const cycleUnit = t(`billing.managePlan.cycleUnit.${annual ? 'year' : 'month'}`);
  const trialing = sub.access === 'trialing';

  // Client-side preview of the recurring charge and the annual saving, matching
  // the API (annual bills ten months, saving two). The number billed *now* still
  // comes from the server — 0 while trialing.
  const recurringCents = sub.seats * sub.unit_price_cents * (annual ? 10 : 1);
  const annualSavingsCents = sub.seats * sub.unit_price_cents * 2;

  const cycleButton = (isActive: boolean): string =>
    `flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'border-brand-500 bg-brand-500 text-white'
        : 'border-border text-content-secondary hover:bg-surface-2'
    }`;

  return (
    <Section
      title={t('billing.managePlan.title')}
      description={t('billing.managePlan.description')}
    >
      <Card>
        <div className="flex flex-col gap-5 p-4">
          {/* Billing cycle (FR-MOD-10.1.2) */}
          <div>
            <p className="mb-2 text-xs font-medium text-content-secondary">
              {t('billing.managePlan.cycleLabel')}
            </p>
            <div
              className="flex gap-2"
              role="group"
              aria-label={t('billing.managePlan.cycleLabel')}
            >
              <button
                type="button"
                aria-pressed={!annual}
                disabled={pending || !annual}
                onClick={() => onChange({ billing_cycle: 'monthly' })}
                className={cycleButton(!annual)}
              >
                {t('billing.managePlan.monthly')}
              </button>
              <button
                type="button"
                aria-pressed={annual}
                disabled={pending || annual}
                onClick={() => onChange({ billing_cycle: 'annual' })}
                className={cycleButton(annual)}
              >
                {t('billing.managePlan.annual')}
                <span className="ml-1 font-normal opacity-90">
                  {t('billing.managePlan.annualSaveHint', {
                    amount: formatMoney(annualSavingsCents) ?? '',
                  })}
                </span>
              </button>
            </div>
          </div>

          {/* Users stepper (FR-MOD-10.1.3) */}
          <div>
            <p className="mb-2 text-xs font-medium text-content-secondary">
              {t('billing.managePlan.seatsLabel')}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={t('billing.managePlan.removeSeat')}
                disabled={pending || sub.seats <= sub.min_seats}
                onClick={() => onChange({ seats: sub.seats - 1 })}
                className="h-8 w-8 rounded-md border border-border text-lg leading-none text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                −
              </button>
              <span
                data-testid="seat-count"
                className="tabular w-8 text-center text-lg font-semibold"
              >
                {sub.seats}
              </span>
              <button
                type="button"
                aria-label={t('billing.managePlan.addSeat')}
                disabled={pending}
                onClick={() => onChange({ seats: sub.seats + 1 })}
                className="h-8 w-8 rounded-md border border-border text-lg leading-none text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                +
              </button>
              <span className="text-sm text-content-secondary">
                {t('billing.managePlan.pricePerUser', {
                  price: formatMoney(sub.unit_price_cents) ?? '',
                })}
              </span>
            </div>
            <p className="mt-1 text-2xs text-content-tertiary">
              {t('billing.managePlan.minSeatsNotice', { min: sub.min_seats })}
            </p>
          </div>

          {/* Subscription summary (FR-MOD-10.1.6) */}
          <div data-testid="billing-summary" className="rounded-md bg-inset p-3 text-sm">
            {trialing ? (
              <>
                <p>
                  {t('billing.managePlan.billedNowPrefix')}{' '}
                  <span className="font-semibold">{formatMoney(0)}</span>{' '}
                  {t('billing.managePlan.billedNowSuffix')}
                </p>
                <p className="text-content-secondary">
                  {t('billing.managePlan.afterTrialPrefix')}{' '}
                  <span className="font-semibold text-content">{formatMoney(recurringCents)}</span>{' '}
                  / {cycleUnit}
                </p>
              </>
            ) : (
              <p>
                {t('billing.managePlan.totalPrefix')}{' '}
                <span className="font-semibold">{formatMoney(sub.estimated_total_cents)}</span> /{' '}
                {cycleUnit}
              </p>
            )}
            {annual && (
              <p className="mt-1 text-2xs text-success">
                {t('billing.managePlan.annualSavingsNotice', {
                  amount: formatMoney(annualSavingsCents) ?? '',
                })}
              </p>
            )}
          </div>
        </div>
      </Card>
    </Section>
  );
}

/**
 * API packages (FR-MOD-09.3, "Fiyatlı API paketleri satışı").
 *
 * A one-off top-up on top of the plan's included API calls — distinct from the
 * automatic overage billed in the section above. Buying a package is a single
 * confirm step; success raises the *current* period's allowance and adds a
 * line item the next invoice read shows (09.3-e), so the purchase invalidates
 * the usage and invoices queries rather than trying to patch them locally —
 * `usage` on the reply is `UsageSummary`, not the full `Usage` this page reads
 * (missing `quota_warning`/`period_label`), so a refetch is the only way to get
 * a shape the rest of the page can render. The purchase-history query is
 * invalidated too, for the list a later screen (09.3-g) will add.
 *
 * The buy buttons are never disabled for a read-only workspace: like the
 * subscription PATCH and payment-method PUT, this write is `allowWhenReadOnly`
 * on the backend (09.3-d) — buying capacity is one of the ways an expired
 * trial comes back.
 */
function ApiPackagesSection(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const catalog = useQuery({
    queryKey: ['billing', 'api-packages'],
    queryFn: () => api.get<{ items: ApiPackageItem[] }>('/billing/api-packages'),
  });

  const buy = useMutation({
    mutationFn: (packageId: string) =>
      api.post<ApiPackagePurchaseResult>('/billing/api-packages', { package_id: packageId }),
    onSuccess: async () => {
      setConfirmingId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['billing', 'usage'] }),
        queryClient.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
        queryClient.invalidateQueries({ queryKey: ['billing', 'api-packages', 'purchases'] }),
      ]);
    },
  });

  const description = t('billing.apiPackages.description');

  if (catalog.isPending) {
    return (
      <Section title={t('billing.apiPackages.title')} description={description}>
        <CardSkeleton rows={2} />
      </Section>
    );
  }

  if (catalog.error) {
    return (
      <Section title={t('billing.apiPackages.title')} description={description}>
        <ErrorNotice message={t('billing.apiPackages.loadError')} />
      </Section>
    );
  }

  const items = catalog.data.items;

  return (
    <Section title={t('billing.apiPackages.title')} description={description}>
      {buy.isError && (
        <Banner tone="danger" role="alert" title={t('billing.apiPackages.buyErrorTitle')}>
          {t('billing.apiPackages.buyErrorDescription')}
        </Banner>
      )}

      {items.length === 0 ? (
        <p data-testid="api-packages-empty" className="text-sm text-content-secondary">
          {t('billing.apiPackages.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          {items.map((pkg) => (
            <ApiPackageCard
              key={pkg.id}
              pkg={pkg}
              confirming={confirmingId === pkg.id}
              pending={buy.isPending && buy.variables === pkg.id}
              onBuyClick={() => {
                buy.reset();
                setConfirmingId(pkg.id);
              }}
              onCancel={() => {
                buy.reset();
                setConfirmingId(null);
              }}
              onConfirm={() => buy.mutate(pkg.id)}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function ApiPackageCard({
  pkg,
  confirming,
  pending,
  onBuyClick,
  onCancel,
  onConfirm,
}: {
  pkg: ApiPackageItem;
  confirming: boolean;
  pending: boolean;
  onBuyClick: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <Card>
      <div data-testid={`api-package-${pkg.id}`} className="flex h-full flex-col gap-1 p-4">
        <span className="text-sm font-medium">{pkg.name}</span>
        <span className="tabular text-xl font-bold">
          {formatCount(pkg.api_calls)}
          <span className="ml-1 text-2xs font-normal text-content-tertiary">
            {t('billing.apiPackages.callsUnit')}
          </span>
        </span>
        <span className="tabular text-sm text-content-secondary">
          {formatMoney(pkg.price_cents)}
        </span>

        {confirming ? (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-2xs text-content-secondary">
              {t('billing.apiPackages.confirmPrompt', {
                name: pkg.name,
                price: formatMoney(pkg.price_cents) ?? '',
              })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label={t('billing.apiPackages.confirmAriaLabel', { name: pkg.name })}
                disabled={pending}
                onClick={onConfirm}
                className="rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {pending
                  ? t('billing.apiPackages.buying')
                  : t('billing.apiPackages.confirmPurchase')}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={onCancel}
                className="rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {t('billing.apiPackages.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            aria-label={t('billing.apiPackages.buyAriaLabel', { name: pkg.name })}
            onClick={onBuyClick}
            className="mt-2 self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
          >
            {t('billing.apiPackages.buy')}
          </button>
        )}
      </div>
    </Card>
  );
}

/**
 * Purchase history for API packages (FR-MOD-09.3, KK-derived — the PRD does
 * not define a purchase-history screen for 09.3; FR-MOD-10.3's invoice list
 * is the pattern this borrows, same table shape as `InvoicesSection` below).
 *
 * The server already returns purchases newest-first (`purchasedAt desc`), so
 * this renders them in that order rather than re-sorting client-side. A
 * successful buy in `ApiPackagesSection` invalidates this query, so a new
 * purchase appears here without a manual refresh.
 */
function ApiPackagePurchasesSection(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const query = useQuery({
    queryKey: ['billing', 'api-packages', 'purchases'],
    queryFn: () => api.get<{ items: ApiPackagePurchase[] }>('/billing/api-packages/purchases'),
  });

  const description = t('billing.purchaseHistory.description');

  if (query.isPending) {
    return (
      <Section title={t('billing.purchaseHistory.title')} description={description}>
        <CardSkeleton rows={2} />
      </Section>
    );
  }
  if (query.error) {
    return (
      <Section title={t('billing.purchaseHistory.title')} description={description}>
        <ErrorNotice message={t('billing.purchaseHistory.loadError')} />
      </Section>
    );
  }

  const purchases = query.data.items;

  return (
    <Section title={t('billing.purchaseHistory.title')} description={description}>
      {purchases.length === 0 ? (
        <p data-testid="api-package-purchases-empty" className="text-sm text-content-secondary">
          {t('billing.purchaseHistory.empty')}
        </p>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="api-package-purchases-table">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-content-tertiary">
                  <th className="px-4 py-2 font-medium">
                    {t('billing.purchaseHistory.table.date')}
                  </th>
                  <th className="px-4 py-2 font-medium">
                    {t('billing.purchaseHistory.table.package')}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t('billing.purchaseHistory.table.quota')}
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    {t('billing.purchaseHistory.table.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((purchase) => (
                  <tr
                    key={purchase.id}
                    data-testid="api-package-purchase-row"
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2 text-content-secondary">
                      {formatDate(purchase.purchased_at)}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      {purchase.name ?? purchase.package_id}
                    </td>
                    <td className="tabular px-4 py-2 text-right">
                      +{formatCount(purchase.api_calls)}
                    </td>
                    <td className="tabular px-4 py-2 text-right">
                      {formatMoney(purchase.price_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </Section>
  );
}

/**
 * The payment method on file (FR-MOD-10.3, "ödeme yöntemi güncelleme").
 *
 * Billing is mocked (ADR-13) and real card entry is out of scope (PRD §11.1/1),
 * so the form collects only the masked fields a processor would return —
 * brand, last four, expiry and holder — never a full card number. Saving it
 * persists through `PUT /billing/payment-method`; the section then reads the
 * stored method back, so what is shown is the server's copy, not the form's.
 *
 * Editable even while the workspace is read-only — putting a card on file is
 * part of how an expired trial comes back.
 */
function PaymentMethodSection({ readOnly }: { readOnly: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const query = useQuery({
    queryKey: ['billing', 'payment-method'],
    queryFn: () => api.get<{ payment_method: PaymentMethod | null }>('/billing/payment-method'),
  });

  const save = useMutation({
    mutationFn: (body: {
      brand: string;
      last4: string;
      exp_month: number;
      exp_year: number;
      holder_name: string;
    }) => api.put<PaymentMethod>('/billing/payment-method', body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['billing', 'payment-method'], { payment_method: updated });
      setEditing(false);
    },
  });

  const description = t('billing.paymentMethod.description');

  if (query.isPending) {
    return (
      <Section title={t('billing.paymentMethod.title')} description={description}>
        <CardSkeleton rows={1} />
      </Section>
    );
  }
  if (query.error) {
    return (
      <Section title={t('billing.paymentMethod.title')} description={description}>
        <ErrorNotice message={t('billing.paymentMethod.loadError')} />
      </Section>
    );
  }

  const method = query.data.payment_method;

  return (
    <Section title={t('billing.paymentMethod.title')} description={description}>
      <Card>
        <div className="flex flex-col gap-4 p-4">
          {method ? (
            <div data-testid="payment-method" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium capitalize">{method.brand}</span>
              <span className="text-content-secondary">
                {t('billing.paymentMethod.ending', { last4: method.last4 })}
              </span>
              <span className="text-content-tertiary">
                {t('billing.paymentMethod.expires', {
                  date: `${String(method.exp_month).padStart(2, '0')}/${method.exp_year}`,
                })}
              </span>
              <span className="text-content-tertiary">· {method.holder_name}</span>
            </div>
          ) : (
            <p data-testid="payment-method-empty" className="text-sm text-content-secondary">
              {t('billing.paymentMethod.empty')}
            </p>
          )}

          {editing ? (
            <PaymentMethodForm
              method={method}
              pending={save.isPending}
              error={save.error ? t('billing.paymentMethod.form.saveError') : null}
              onCancel={() => setEditing(false)}
              onSubmit={(body) => save.mutate(body)}
            />
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
              >
                {method
                  ? t('billing.paymentMethod.updateButton')
                  : t('billing.paymentMethod.addButton')}
              </button>
              {readOnly && (
                <p className="mt-2 text-2xs text-content-tertiary">
                  {t('billing.paymentMethod.readOnlyNotice')}
                </p>
              )}
            </div>
          )}
        </div>
      </Card>
    </Section>
  );
}

/**
 * The masked-card form. Deliberately has no full-card-number field — the
 * out-of-scope data (PRD §11.1/1) has nowhere to be entered.
 */
function PaymentMethodForm({
  method,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  method: PaymentMethod | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (body: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    holder_name: string;
  }) => void;
}): ReactElement {
  const t = useTranslate();
  const thisYear = new Date().getFullYear();
  const [brand, setBrand] = useState(method?.brand ?? 'visa');
  const [last4, setLast4] = useState(method?.last4 ?? '');
  const [expMonth, setExpMonth] = useState(String(method?.exp_month ?? 1));
  // Default a year ahead, not the current year — a card expiring this January
  // would already be in the past for most of the year and the save would be
  // rejected as expired.
  const [expYear, setExpYear] = useState(String(method?.exp_year ?? thisYear + 1));
  const [holder, setHolder] = useState(method?.holder_name ?? '');

  const last4Valid = /^\d{4}$/.test(last4);
  const canSubmit = last4Valid && holder.trim().length > 0 && !pending;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      brand,
      last4,
      exp_month: Number(expMonth),
      exp_year: Number(expYear),
      holder_name: holder.trim(),
    });
  };

  const field = 'rounded-md border border-border bg-inset px-3 py-2 text-sm';

  return (
    <form
      data-testid="payment-form"
      onSubmit={submit}
      role="group"
      aria-label={t('billing.paymentMethod.title')}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="pm-brand" className="text-2xs font-medium text-content-secondary">
          {t('billing.paymentMethod.form.brandLabel')}
        </label>
        <select
          id="pm-brand"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className={`${field} capitalize`}
        >
          {CARD_BRANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pm-last4" className="text-2xs font-medium text-content-secondary">
          {t('billing.paymentMethod.form.last4Label')}
        </label>
        <input
          id="pm-last4"
          inputMode="numeric"
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder={t('billing.paymentMethod.form.last4Placeholder')}
          className={`w-24 ${field}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-2xs font-medium text-content-secondary">
          {t('billing.paymentMethod.form.expiryLabel')}
        </span>
        <div className="flex gap-2">
          <select
            aria-label={t('billing.paymentMethod.form.expiryMonthLabel')}
            value={expMonth}
            onChange={(e) => setExpMonth(e.target.value)}
            className={`w-20 ${field}`}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, '0')}
              </option>
            ))}
          </select>
          <select
            aria-label={t('billing.paymentMethod.form.expiryYearLabel')}
            value={expYear}
            onChange={(e) => setExpYear(e.target.value)}
            className={`w-28 ${field}`}
          >
            {Array.from({ length: 11 }, (_, i) => thisYear + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pm-holder" className="text-2xs font-medium text-content-secondary">
          {t('billing.paymentMethod.form.holderLabel')}
        </label>
        <input
          id="pm-holder"
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          placeholder={t('billing.paymentMethod.form.holderPlaceholder')}
          className={field}
        />
      </div>

      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
      <p className="text-2xs text-content-tertiary">
        {t('billing.paymentMethod.form.stripeNotice')}
      </p>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
        >
          {pending ? t('billing.paymentMethod.form.saving') : t('billing.paymentMethod.form.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('billing.paymentMethod.form.cancel')}
        </button>
      </div>
    </form>
  );
}

/** How each invoice status colours in the list — the label comes from the catalogue. */
const INVOICE_STATUS_CLASS: Record<Invoice['status'], string> = {
  paid: 'text-success',
  open: 'text-content-secondary',
  trial: 'text-content-tertiary',
};

/** Catalogue key for each invoice status's label. */
const INVOICE_STATUS_KEY: Record<Invoice['status'], string> = {
  paid: 'billing.invoices.status.paid',
  open: 'billing.invoices.status.open',
  trial: 'billing.invoices.status.trial',
};

/**
 * Invoices (FR-MOD-10.3, "fatura listesi/indirme").
 *
 * A list of statements, newest first, each downloadable as CSV. The figures are
 * derived server-side from the subscription and usage records (ADR-13) — the
 * current period's total matches the estimated total above.
 *
 * Every row shows the line items behind its total, not just the total: seats,
 * either overage, and any API package bought in the period (09.3-e). The
 * breakdown was previously only in the downloaded CSV, which made a total that
 * moved unexplainable without leaving the screen.
 */
function InvoicesSection(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [downloading, setDownloading] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['billing', 'invoices'],
    queryFn: () => api.get<{ invoices: Invoice[] }>('/billing/invoices'),
  });

  const download = async (invoice: Invoice): Promise<void> => {
    setDownloading(invoice.period);
    try {
      const blob = await api.getBlob(`/billing/invoices/${invoice.period}/download`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nexa-invoice-${invoice.period}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(null);
    }
  };

  if (query.isPending) {
    return (
      <Section
        title={t('billing.invoices.title')}
        description={t('billing.invoices.loadingDescription')}
      >
        <CardSkeleton rows={3} />
      </Section>
    );
  }
  if (query.error) {
    return (
      <Section
        title={t('billing.invoices.title')}
        description={t('billing.invoices.loadingDescription')}
      >
        <ErrorNotice message={t('billing.invoices.loadError')} />
      </Section>
    );
  }

  const invoices = query.data.invoices;

  return (
    <Section title={t('billing.invoices.title')} description={t('billing.invoices.description')}>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="invoices-table">
            <thead>
              <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-content-tertiary">
                <th className="px-4 py-2 font-medium">{t('billing.invoices.table.invoice')}</th>
                <th className="px-4 py-2 font-medium">{t('billing.invoices.table.issued')}</th>
                <th className="px-4 py-2 font-medium">{t('billing.invoices.table.status')}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('billing.invoices.table.amount')}
                </th>
                <th className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">{t('billing.invoices.table.download')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const statusClass = INVOICE_STATUS_CLASS[invoice.status];
                return (
                  <tr
                    key={invoice.period}
                    data-testid="invoice-row"
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium">{invoice.number}</span>
                      <span className="ml-2 text-content-tertiary">{invoice.period_label}</span>
                      {/* What the total is made of, on the statement itself. A
                          row that shows only an amount makes "why is this
                          $29.99 more than last month" a support ticket — and a
                          bought API package (09.3-e) would otherwise be visible
                          nowhere but the downloaded CSV. Keyed by description +
                          index because two purchases of the same package in one
                          period produce two identical descriptions. */}
                      <ul data-testid="invoice-line-items" className="mt-1 flex flex-col gap-0.5">
                        {invoice.line_items.map((item, index) => (
                          <li
                            key={`${item.description}-${index}`}
                            className="text-2xs text-content-tertiary"
                          >
                            {item.description} ·{' '}
                            <span className="tabular">
                              {formatMoney(item.amount_cents, invoice.currency.toUpperCase())}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-4 py-2 text-content-secondary">
                      {formatDate(invoice.issued_at)}
                    </td>
                    <td className={`px-4 py-2 font-medium ${statusClass}`}>
                      {t(INVOICE_STATUS_KEY[invoice.status])}
                    </td>
                    <td data-testid="invoice-total" className="tabular px-4 py-2 text-right">
                      {formatMoney(invoice.total_cents, invoice.currency.toUpperCase())}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        aria-label={t('billing.invoices.downloadAriaLabel', {
                          number: invoice.number,
                        })}
                        disabled={downloading === invoice.period}
                        onClick={() => void download(invoice)}
                        className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
                      >
                        {downloading === invoice.period
                          ? t('billing.invoices.downloading')
                          : t('billing.invoices.table.download')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}
