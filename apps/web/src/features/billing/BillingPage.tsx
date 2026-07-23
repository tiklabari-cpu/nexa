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
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
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
  ai_resolutions: { used: number; included: number; overage: number; overage_cents: number };
  api_calls: { used: number; included: number };
}

interface Subscription {
  plan: string;
  billing_cycle: string;
  status: string;
  access: 'trialing' | 'active' | 'read_only';
  trial: { ends_at: string | null; days_remaining: number | null };
  seats: number;
  unit_price_cents: number;
  usage: UsageSummary;
  estimated_total_cents: number;
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
  const quotaFraction =
    use.ai_resolutions.included > 0 ? use.ai_resolutions.used / use.ai_resolutions.included : 0;

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

      <Section
        title="AI resolutions"
        description="A conversation an AI closed without a human ever replying."
      >
        <Card>
          <div className="p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="tabular text-2xl font-bold">
                {formatCount(use.ai_resolutions.used)}
                <span className="text-base font-normal text-content-tertiary">
                  {' / '}
                  {formatCount(use.ai_resolutions.included)}
                </span>
              </span>
              {use.quota_warning && (
                <span className="text-xs font-medium text-warning">
                  {use.ai_resolutions.overage > 0
                    ? 'Over the included allowance'
                    : 'Nearing the limit'}
                </span>
              )}
            </div>

            <QuotaBar fraction={quotaFraction} warning={use.quota_warning} />

            {use.ai_resolutions.overage > 0 && (
              <p className="mt-3 text-sm text-content-secondary">
                {formatCount(use.ai_resolutions.overage)} beyond the included allowance —{' '}
                <span className="tabular font-medium text-content">
                  {formatMoney(use.ai_resolutions.overage_cents)}
                </span>{' '}
                this period.
              </p>
            )}
          </div>
        </Card>
      </Section>

      <Section title="API calls">
        <KpiGrid>
          <Kpi label="Used" value={formatCount(use.api_calls.used)} />
          <Kpi label="Included" value={formatCount(use.api_calls.included)} />
        </KpiGrid>
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
