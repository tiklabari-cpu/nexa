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

const CARD_BRANDS = ['visa', 'mastercard', 'amex', 'discover'] as const;

export function BillingPage(): ReactElement {
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
      <Page title="Billing">
        <ErrorNotice message="Could not load billing. Check that the API is reachable and try again." />
      </Page>
    );
  }

  if (subscription.isPending || usage.isPending) {
    return (
      <Page title="Billing">
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
    <Page title="Billing" description={`Plan, usage and charges for period ${use.period_label}.`}>
      {sub.access === 'read_only' && (
        <Banner tone="warning" role="alert" title="This workspace is read-only.">
          The trial has ended. Existing conversations stay readable and exportable and nothing has
          been deleted — but new conversations cannot be started until a plan is active.
        </Banner>
      )}

      {sub.access === 'trialing' && sub.trial.days_remaining !== null && (
        <div role="status" className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium">
            {sub.trial.days_remaining} day{sub.trial.days_remaining === 1 ? '' : 's'} left in your
            trial
          </p>
          <p className="mt-1 text-sm text-content-secondary">
            Nothing is billed during the trial
            {sub.trial.ends_at ? `, which ends on ${formatDate(sub.trial.ends_at)}` : ''}.
          </p>
        </div>
      )}

      <Section title="Plan">
        <KpiGrid>
          <Kpi label="Plan" value={sub.plan} hint={sub.billing_cycle} />
          <Kpi
            label="Seats"
            value={formatCount(sub.seats)}
            hint={`${formatMoney(sub.unit_price_cents)} per seat`}
          />
          <Kpi
            label="Estimated total"
            value={formatMoney(sub.estimated_total_cents)}
            hint={sub.access === 'trialing' ? 'Nothing billed during the trial' : 'This period'}
          />
          <Kpi
            label="Status"
            value={sub.status}
            tone={
              sub.access === 'active' ? 'good' : sub.access === 'read_only' ? 'warn' : 'neutral'
            }
          />
        </KpiGrid>
      </Section>

      <ManagePlan sub={sub} onChange={change.mutate} pending={change.isPending} />

      <Section
        title="AI resolutions"
        description="A conversation an AI closed without a human ever replying."
      >
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
                ? 'Past your included AI resolutions'
                : `You have used ${quotaPercent}% of your AI resolutions`}
            </p>
            <p className="mt-1 text-sm text-content-secondary">
              {aiOver ? (
                <>
                  {formatCount(ai.overage)} beyond the included {formatCount(ai.included)} this
                  period. Each extra resolution bills at {formatMoney(ai.overage_unit_price_cents)}{' '}
                  — no surprise on the invoice.
                </>
              ) : (
                <>
                  {formatCount(ai.used)} of {formatCount(ai.included)} used. Beyond the allowance,
                  resolutions bill at {formatMoney(ai.overage_unit_price_cents)} each.
                </>
              )}
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
                  <span data-testid="quota-percent">({quotaPercent}% used)</span>
                </span>
              </span>
              {use.quota_warning && (
                <span className="text-xs font-medium text-warning">
                  {aiOver ? 'Over the included allowance' : 'Nearing the limit'}
                </span>
              )}
            </div>

            <QuotaBar fraction={quotaFraction} warning={use.quota_warning} />

            {aiOver && (
              <p className="mt-3 text-sm text-content-secondary">
                {formatCount(ai.overage)} beyond the included allowance —{' '}
                <span className="tabular font-medium text-content">
                  {formatMoney(ai.overage_cents)}
                </span>{' '}
                this period.
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
              <p className="text-sm font-medium">Overage package</p>
              <p className="mt-0.5 text-sm text-content-secondary">
                Beyond the included {formatCount(ai.included)}, AI resolutions bill at{' '}
                <span className="font-medium text-content">
                  {formatMoney(ai.overage_unit_price_cents)}
                </span>{' '}
                each — sold in packs of {formatCount(ai.overage_unit)} (
                {formatMoney(packPriceCents)} per pack).
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                This period
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
      <Section
        title="API calls"
        description="Requests your integrations make with a personal access token, metered per call."
      >
        <Card>
          <div className="p-4">
            <KpiGrid>
              <Kpi
                label="Used"
                value={formatCount(apiCalls.used)}
                hint={`of ${formatCount(apiCalls.included)} included`}
              />
              <Kpi label="Included" value={formatCount(apiCalls.included)} />
              <Kpi
                label="Overage"
                value={formatCount(apiCalls.overage)}
                tone={apiOver ? 'warn' : 'neutral'}
              />
              <Kpi
                label="Overage charge"
                value={formatMoney(apiCalls.overage_cents)}
                hint="this period"
              />
            </KpiGrid>
            <p data-testid="api-overage-terms" className="mt-3 text-2xs text-content-tertiary">
              Beyond the included {formatCount(apiCalls.included)}, API calls bill at{' '}
              <span className="font-medium text-content">
                {formatMoney(apiCalls.overage_unit_price_cents)}
              </span>{' '}
              per {formatCount(apiCalls.overage_unit)} — billed by the block.
            </p>
          </div>
        </Card>
      </Section>

      <PaymentMethodSection readOnly={sub.access === 'read_only'} />

      <InvoicesSection />

      <p className="text-2xs text-content-tertiary">
        Payment provider: {sub.provider}. No external charge is made — usage figures and the
        arithmetic above are real.
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
  const percent = Math.round(fraction * 100);
  return (
    <div
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Included AI resolutions used"
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
  const annual = sub.billing_cycle === 'annual';
  const cycleUnit = annual ? 'year' : 'month';
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
      title="Manage plan"
      description="Billing is mocked — nothing is charged. Changes save as you make them."
    >
      <Card>
        <div className="flex flex-col gap-5 p-4">
          {/* Billing cycle (FR-MOD-10.1.2) */}
          <div>
            <p className="mb-2 text-xs font-medium text-content-secondary">Billing cycle</p>
            <div className="flex gap-2" role="group" aria-label="Billing cycle">
              <button
                type="button"
                aria-pressed={!annual}
                disabled={pending || !annual}
                onClick={() => onChange({ billing_cycle: 'monthly' })}
                className={cycleButton(!annual)}
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed={annual}
                disabled={pending || annual}
                onClick={() => onChange({ billing_cycle: 'annual' })}
                className={cycleButton(annual)}
              >
                Annual
                <span className="ml-1 font-normal opacity-90">
                  · save {formatMoney(annualSavingsCents)}/yr
                </span>
              </button>
            </div>
          </div>

          {/* Users stepper (FR-MOD-10.1.3) */}
          <div>
            <p className="mb-2 text-xs font-medium text-content-secondary">Seats</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Remove a seat"
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
                aria-label="Add a seat"
                disabled={pending}
                onClick={() => onChange({ seats: sub.seats + 1 })}
                className="h-8 w-8 rounded-md border border-border text-lg leading-none text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
              >
                +
              </button>
              <span className="text-sm text-content-secondary">
                {formatMoney(sub.unit_price_cents)} / user / month
              </span>
            </div>
            <p className="mt-1 text-2xs text-content-tertiary">
              Minimum {sub.min_seats} — you cannot buy fewer seats than your active agents.
            </p>
          </div>

          {/* Subscription summary (FR-MOD-10.1.6) */}
          <div data-testid="billing-summary" className="rounded-md bg-inset p-3 text-sm">
            {trialing ? (
              <>
                <p>
                  Billed now <span className="font-semibold">{formatMoney(0)}</span> during the
                  trial.
                </p>
                <p className="text-content-secondary">
                  After the trial:{' '}
                  <span className="font-semibold text-content">{formatMoney(recurringCents)}</span>{' '}
                  / {cycleUnit}
                </p>
              </>
            ) : (
              <p>
                Total:{' '}
                <span className="font-semibold">{formatMoney(sub.estimated_total_cents)}</span> /{' '}
                {cycleUnit}
              </p>
            )}
            {annual && (
              <p className="mt-1 text-2xs text-success">
                Saving {formatMoney(annualSavingsCents)} a year versus monthly billing.
              </p>
            )}
          </div>
        </div>
      </Card>
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

  const description =
    'Billing is mocked — no card is charged and no full card number is collected.';

  if (query.isPending) {
    return (
      <Section title="Payment method" description={description}>
        <CardSkeleton rows={1} />
      </Section>
    );
  }
  if (query.error) {
    return (
      <Section title="Payment method" description={description}>
        <ErrorNotice message="Could not load the payment method." />
      </Section>
    );
  }

  const method = query.data.payment_method;

  return (
    <Section title="Payment method" description={description}>
      <Card>
        <div className="flex flex-col gap-4 p-4">
          {method ? (
            <div data-testid="payment-method" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium capitalize">{method.brand}</span>
              <span className="text-content-secondary">ending {method.last4}</span>
              <span className="text-content-tertiary">
                · expires {String(method.exp_month).padStart(2, '0')}/{method.exp_year}
              </span>
              <span className="text-content-tertiary">· {method.holder_name}</span>
            </div>
          ) : (
            <p data-testid="payment-method-empty" className="text-sm text-content-secondary">
              No payment method on file yet.
            </p>
          )}

          {editing ? (
            <PaymentMethodForm
              method={method}
              pending={save.isPending}
              error={save.error ? 'Could not save the payment method. Check the details.' : null}
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
                {method ? 'Update payment method' : 'Add payment method'}
              </button>
              {readOnly && (
                <p className="mt-2 text-2xs text-content-tertiary">
                  You can still update your payment method while the workspace is read-only.
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
      aria-label="Payment method"
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="pm-brand" className="text-2xs font-medium text-content-secondary">
          Card brand
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
          Last 4 digits
        </label>
        <input
          id="pm-last4"
          inputMode="numeric"
          maxLength={4}
          value={last4}
          onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="4242"
          className={`w-24 ${field}`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-2xs font-medium text-content-secondary">Expiry</span>
        <div className="flex gap-2">
          <select
            aria-label="Expiry month"
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
            aria-label="Expiry year"
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
          Cardholder name
        </label>
        <input
          id="pm-holder"
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          placeholder="Jane Doe"
          className={field}
        />
      </div>

      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
      <p className="text-2xs text-content-tertiary">
        A real Stripe card element would mount here. Only the masked details are stored.
      </p>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** How each invoice status reads and colours in the list. */
const INVOICE_STATUS: Record<Invoice['status'], { label: string; className: string }> = {
  paid: { label: 'Paid', className: 'text-success' },
  open: { label: 'Open', className: 'text-content-secondary' },
  trial: { label: 'Trial', className: 'text-content-tertiary' },
};

/**
 * Invoices (FR-MOD-10.3, "fatura listesi/indirme").
 *
 * A list of statements, newest first, each downloadable as CSV. The figures are
 * derived server-side from the subscription and usage records (ADR-13) — the
 * current period's total matches the estimated total above.
 */
function InvoicesSection(): ReactElement {
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
      <Section title="Invoices" description="Your billing statements.">
        <CardSkeleton rows={3} />
      </Section>
    );
  }
  if (query.error) {
    return (
      <Section title="Invoices" description="Your billing statements.">
        <ErrorNotice message="Could not load invoices." />
      </Section>
    );
  }

  const invoices = query.data.invoices;

  return (
    <Section title="Invoices" description="Your billing statements, newest first.">
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="invoices-table">
            <thead>
              <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-content-tertiary">
                <th className="px-4 py-2 font-medium">Invoice</th>
                <th className="px-4 py-2 font-medium">Issued</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const status = INVOICE_STATUS[invoice.status];
                return (
                  <tr
                    key={invoice.period}
                    data-testid="invoice-row"
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium">{invoice.number}</span>
                      <span className="ml-2 text-content-tertiary">{invoice.period_label}</span>
                    </td>
                    <td className="px-4 py-2 text-content-secondary">
                      {formatDate(invoice.issued_at)}
                    </td>
                    <td className={`px-4 py-2 font-medium ${status.className}`}>{status.label}</td>
                    <td className="tabular px-4 py-2 text-right">
                      {formatMoney(invoice.total_cents, invoice.currency.toUpperCase())}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Download invoice ${invoice.number}`}
                        disabled={downloading === invoice.period}
                        onClick={() => void download(invoice)}
                        className="rounded-md border border-border px-2 py-1 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
                      >
                        {downloading === invoice.period ? 'Downloading…' : 'Download'}
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
