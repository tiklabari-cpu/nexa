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
import { useState, type ReactElement } from 'react';
import {
  Card,
  CardSkeleton,
  ErrorNotice,
  Kpi,
  KpiGrid,
  Page,
  Section,
} from '../../components/Page.js';
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
        <div role="alert" className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-medium text-warning">This workspace is read-only.</p>
          <p className="mt-1 text-sm text-content-secondary">
            The trial has ended. Existing conversations stay readable and exportable and nothing has
            been deleted — but new conversations cannot be started until a plan is active.
          </p>
        </div>
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
 * The checkout levers (FR-MOD-10.1.1–.3, .6): billing cycle, seats and payment.
 *
 * Every change persists straight away through `PATCH /billing/subscription` and
 * the page re-reads from the reply, so the summary is the server's arithmetic,
 * not a second copy that could drift. The seat count cannot go below the active
 * headcount (`min_seats`) — the minus button disables at the floor rather than
 * letting the request fail.
 *
 * Payment is mocked (ADR-13): the panel is a labelled placeholder, not a real
 * card form. Nothing is collected or charged, and during the trial the amount
 * billed now is $0 (FR-MOD-10.1.6).
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
  const [showPayment, setShowPayment] = useState(false);
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

          {/* Enter payment details — mocked (FR-MOD-10.1.6, ADR-13) */}
          <div>
            <button
              type="button"
              onClick={() => setShowPayment((v) => !v)}
              className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              Enter payment details
            </button>

            {showPayment && (
              <div
                data-testid="payment-panel"
                role="group"
                aria-label="Payment details"
                className="mt-3 rounded-md border border-border p-3"
              >
                <p className="mb-3 text-2xs text-content-tertiary">
                  Payment is mocked (ADR-13). No card is collected or charged — a real Stripe form
                  would mount here. Billed now{' '}
                  <span className="font-medium text-content">
                    {trialing ? formatMoney(0) : formatMoney(sub.estimated_total_cents)}
                  </span>
                  .
                </p>
                <div className="flex flex-col gap-2">
                  <input
                    aria-label="Card number"
                    placeholder="Card number (mocked)"
                    disabled
                    className="rounded-md border border-border bg-inset px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <input
                      aria-label="Expiry"
                      placeholder="MM / YY"
                      disabled
                      className="w-24 rounded-md border border-border bg-inset px-3 py-2 text-sm"
                    />
                    <input
                      aria-label="CVC"
                      placeholder="CVC"
                      disabled
                      className="w-20 rounded-md border border-border bg-inset px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Section>
  );
}
