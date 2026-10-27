/**
 * Billing across every workspace (tm 389.12 · FR-ADMIN-12): revenue by month from the closed
 * statements, every subscription, every issued statement, the credits granted, the plans and
 * the packages on sale — and the two writes, a credit and a subscription by hand.
 *
 * Amounts and identities only: a workspace appears as its organization's name and licence
 * number, linked to its page. The writes are `billing.manage` (billing and superadmin); the
 * buttons are hidden from a role without it, and the server refuses it either way. Revenue is
 * the closed statements exactly; the open period is shown apart, as what was already bought.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { SUBSCRIPTION_STATUSES } from '@siyahtus/types';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/Banner.js';
import { ApiClientError } from '../../lib/api-client.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatCount, formatDate, formatMoney, formatPeriod } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { saveBlob } from '../workspaces/WorkspaceTabs.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  FIELD_CLASS,
  LINK_CLASS,
  Loading,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import {
  downloadInvoice,
  EMPTY_SUBSCRIPTION_FILTERS,
  useCredits,
  useGrantCredit,
  useInvoices,
  useManualSubscription,
  usePackages,
  usePlans,
  useRevenue,
  useSubscriptions,
  type SubscriptionFilters,
} from './queries.js';

const PLANS = ['growth', 'enterprise'] as const;
const LICENSE_RE = /^[1-9]\d{0,18}$/;

type Dialog = 'credit' | 'manual' | null;
interface Notice {
  tone: 'success' | 'info';
  message: string;
}

export function BillingPage(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'billing.manage');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const actions = canManage ? (
    <div className="flex gap-2">
      <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setDialog('credit')}>
        {t('billing.credit.open')}
      </button>
      <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => setDialog('manual')}>
        {t('billing.manual.open')}
      </button>
    </div>
  ) : undefined;

  return (
    <Page
      title={t('nav.billing')}
      description={t('shell.pages.billing.description')}
      actions={actions}
    >
      {notice && (
        <Banner tone={notice.tone} role="status" dismissible onDismiss={() => setNotice(null)}>
          {notice.message}
        </Banner>
      )}
      <RevenueSection />
      <SubscriptionsSection />
      <InvoicesSection />
      <CreditsSection />
      <CatalogueSection />
      {dialog === 'credit' && (
        <CreditDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setNotice({ tone: 'success', message: t('billing.credit.done') });
          }}
        />
      )}
      {dialog === 'manual' && (
        <ManualSubscriptionDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setNotice({ tone: 'success', message: t('billing.manual.done') });
          }}
        />
      )}
    </Page>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="mb-3 text-sm font-semibold">
        {title}
      </h2>
      <Card>{children}</Card>
    </section>
  );
}

function WorkspaceLink({ id, name }: { id: string; name: string }): ReactElement {
  return (
    <Link to={`/workspaces/${id}`} className={LINK_CLASS}>
      {name}
    </Link>
  );
}

const money = (cents: number, currency = 'USD') =>
  formatMoney(cents, currency.toUpperCase()) ?? String(cents);

function MoreButton({
  query,
  t,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  t: TFunction;
}): ReactElement | null {
  if (!query.hasNextPage) return null;
  return (
    <div className="border-t border-border p-3">
      <button
        type="button"
        className={SECONDARY_BUTTON_CLASS}
        disabled={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        {query.isFetchingNextPage ? t('billing.loading') : t('billing.more')}
      </button>
    </div>
  );
}

// --- Revenue -----------------------------------------------------------------

function RevenueSection(): ReactElement {
  const t = useTranslate();
  const query = useRevenue();
  return (
    <Section id="billing-revenue" title={t('billing.revenue.title')}>
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.revenue.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-content-secondary">{t('billing.revenue.hint')}</p>
          <DataTable
            caption={t('billing.revenue.title')}
            headers={[
              t('billing.revenue.period'),
              t('billing.revenue.invoices'),
              t('billing.revenue.subtotal'),
              t('billing.revenue.credits'),
              t('billing.revenue.total'),
            ]}
          >
            {query.data.months.map((month) => (
              <tr key={`${month.period}-${month.currency}`}>
                <Cell>{formatPeriod(month.period)}</Cell>
                <Cell>
                  <span className="tabular-nums">{formatCount(month.invoices)}</span>
                </Cell>
                <Cell>{money(month.subtotal_cents, month.currency)}</Cell>
                <Cell>{money(month.credit_cents, month.currency)}</Cell>
                <Cell>{money(month.total_cents, month.currency)}</Cell>
              </tr>
            ))}
          </DataTable>
          <dl className="grid grid-cols-1 gap-3 border-t border-border p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-content-secondary">
                {t('billing.revenue.open', {
                  period: formatPeriod(query.data.open_period.period) ?? '',
                })}
              </dt>
              <dd className="mt-0.5">{money(query.data.open_period.package_purchases_cents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-content-secondary">{t('billing.revenue.openCredits')}</dt>
              <dd className="mt-0.5">
                {query.data.open_credits.length === 0
                  ? t('billing.revenue.noOpenCredits')
                  : query.data.open_credits
                      .map((row) =>
                        t('billing.revenue.openCreditLine', {
                          amount: money(row.amount_minor, row.currency),
                          count: row.credits,
                        }),
                      )
                      .join(' · ')}
              </dd>
            </div>
          </dl>
        </>
      )}
    </Section>
  );
}

// --- Subscriptions -----------------------------------------------------------

function SubscriptionsSection(): ReactElement {
  const t = useTranslate();
  const [filters, setFilters] = useState<SubscriptionFilters>(EMPTY_SUBSCRIPTION_FILTERS);
  const query = useSubscriptions(filters);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Section id="billing-subscriptions" title={t('billing.subscriptions.title')}>
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <div>
          <label htmlFor="billing-plan" className="text-xs text-content-secondary">
            {t('billing.subscriptions.plan')}
          </label>
          <select
            id="billing-plan"
            className={FIELD_CLASS}
            value={filters.plan}
            onChange={(event) => setFilters({ ...filters, plan: event.target.value })}
          >
            <option value="">{t('billing.any')}</option>
            {PLANS.map((plan) => (
              <option key={plan} value={plan}>
                {t(`billing.plan.${plan}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="billing-status" className="text-xs text-content-secondary">
            {t('billing.subscriptions.status')}
          </label>
          <select
            id="billing-status"
            className={FIELD_CLASS}
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value })}
          >
            <option value="">{t('billing.any')}</option>
            {SUBSCRIPTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`billing.status.${status}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 pb-1.5">
          <input
            id="billing-past-due"
            type="checkbox"
            checked={filters.pastDue}
            onChange={(event) => setFilters({ ...filters, pastDue: event.target.checked })}
          />
          <label htmlFor="billing-past-due" className="text-sm">
            {t('billing.subscriptions.pastDue')}
          </label>
        </div>
      </div>
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.subscriptions.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyLine>{t('billing.subscriptions.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('billing.subscriptions.title')}
          headers={[
            t('billing.workspace'),
            t('billing.subscriptions.plan'),
            t('billing.subscriptions.status'),
            t('billing.subscriptions.seats'),
            t('billing.subscriptions.price'),
            t('billing.subscriptions.periodEnd'),
          ]}
        >
          {rows.map((row) => (
            <tr key={row.license_id}>
              <Cell>
                <WorkspaceLink id={row.license_id} name={row.organization_name} />
              </Cell>
              <Cell>{t(`billing.plan.${row.plan}`)}</Cell>
              <Cell>
                {t(`billing.status.${row.status}`)}
                {row.cancel_at_period_end && (
                  <span className="ml-1 text-xs text-content-secondary">
                    {t('billing.subscriptions.cancelling')}
                  </span>
                )}
              </Cell>
              <Cell>
                <span className="tabular-nums">{formatCount(row.seats)}</span>
              </Cell>
              <Cell>
                {t('billing.subscriptions.perSeat', { price: money(row.unit_price_cents) })}
              </Cell>
              <Cell>{row.current_period_end ? formatDate(row.current_period_end) : null}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <MoreButton query={query} t={t} />
    </Section>
  );
}

// --- Invoices ----------------------------------------------------------------

function InvoicesSection(): ReactElement {
  const t = useTranslate();
  const [draft, setDraft] = useState('');
  const [licenseId, setLicenseId] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const query = useInvoices(licenseId);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  async function download(id: string, number: string, period: string): Promise<void> {
    setFailed(null);
    try {
      saveBlob(await downloadInvoice(id), `invoice-${number}-${period}.csv`);
    } catch {
      setFailed(number);
    }
  }

  return (
    <Section id="billing-invoices" title={t('billing.invoices.title')}>
      <form
        role="search"
        className="flex flex-wrap items-end gap-3 border-b border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setLicenseId(LICENSE_RE.test(draft.trim()) ? draft.trim() : '');
        }}
      >
        <div>
          <label htmlFor="billing-invoice-licence" className="text-xs text-content-secondary">
            {t('billing.licence')}
          </label>
          <input
            id="billing-invoice-licence"
            inputMode="numeric"
            className={FIELD_CLASS}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <button type="submit" className={SECONDARY_BUTTON_CLASS}>
          {t('billing.invoices.filter')}
        </button>
      </form>
      {failed && (
        <p role="alert" className="px-4 pt-3 text-sm text-danger">
          {t('billing.invoices.downloadFailed', { number: failed })}
        </p>
      )}
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.invoices.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyLine>{t('billing.invoices.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('billing.invoices.title')}
          headers={[
            t('billing.workspace'),
            t('billing.invoices.number'),
            t('billing.revenue.period'),
            t('billing.invoices.status'),
            t('billing.revenue.credits'),
            t('billing.revenue.total'),
            t('billing.invoices.file'),
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell>
                <WorkspaceLink id={row.license_id} name={row.organization_name} />
              </Cell>
              <Cell>{row.number}</Cell>
              <Cell>{formatPeriod(row.period)}</Cell>
              <Cell>{t(`billing.invoices.state.${row.status}`)}</Cell>
              <Cell>{row.credit_cents > 0 ? money(row.credit_cents, row.currency) : null}</Cell>
              <Cell>{money(row.total_cents, row.currency)}</Cell>
              <Cell>
                <button
                  type="button"
                  className={LINK_CLASS}
                  onClick={() => void download(row.id, row.number, row.period)}
                >
                  {t('billing.invoices.download', { number: row.number })}
                </button>
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <MoreButton query={query} t={t} />
    </Section>
  );
}

// --- Credits -----------------------------------------------------------------

function CreditsSection(): ReactElement {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const query = useCredits(open);
  const rows = query.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <Section id="billing-credits" title={t('billing.credits.title')}>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <input
          id="billing-credits-open"
          type="checkbox"
          checked={open}
          onChange={(event) => setOpen(event.target.checked)}
        />
        <label htmlFor="billing-credits-open" className="text-sm">
          {t('billing.credits.openOnly')}
        </label>
      </div>
      {query.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : query.isError ? (
        <LoadError
          title={t('billing.credits.failed')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyLine>{t('billing.credits.empty')}</EmptyLine>
      ) : (
        <DataTable
          caption={t('billing.credits.title')}
          headers={[
            t('billing.workspace'),
            t('billing.credits.amount'),
            t('billing.credits.state'),
            t('billing.credits.reason'),
            t('billing.credits.by'),
            t('billing.credits.created'),
          ]}
        >
          {rows.map((row) => (
            <tr key={row.id}>
              <Cell>
                <WorkspaceLink id={row.license_id} name={row.organization_name} />
              </Cell>
              <Cell>{money(row.amount_minor, row.currency)}</Cell>
              <Cell>
                {row.invoice_number
                  ? t('billing.credits.applied', {
                      number: row.invoice_number,
                      period: formatPeriod(row.invoice_period) ?? '',
                    })
                  : t('billing.credits.open')}
                {row.remainder_of && (
                  <span className="ml-1 text-xs text-content-secondary">
                    {t('billing.credits.remainder')}
                  </span>
                )}
              </Cell>
              <Cell>{row.reason}</Cell>
              <Cell>{row.admin_email}</Cell>
              <Cell>{formatDate(row.created_at)}</Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <MoreButton query={query} t={t} />
    </Section>
  );
}

// --- Plans and packages ------------------------------------------------------

function CatalogueSection(): ReactElement {
  const t = useTranslate();
  const plans = usePlans();
  const packages = usePackages();
  const tokens = (value: number | null) =>
    value === null ? t('billing.plans.inherits') : (formatCount(value) ?? String(value));

  return (
    <Section id="billing-catalogue" title={t('billing.plans.title')}>
      {plans.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : plans.isError ? (
        <LoadError
          title={t('billing.plans.failed')}
          error={plans.error}
          onRetry={() => void plans.refetch()}
        />
      ) : (
        <DataTable
          caption={t('billing.plans.title')}
          headers={[
            t('billing.subscriptions.plan'),
            t('billing.subscriptions.price'),
            t('billing.plans.resolutions'),
            t('billing.plans.aiLlm'),
            t('billing.plans.aiEmbedding'),
            t('billing.plans.workspaces'),
          ]}
        >
          {plans.data.data.map((plan) => (
            <tr key={plan.id}>
              <Cell>{t(`billing.plan.${plan.id}`)}</Cell>
              <Cell>
                {plan.unit_price_cents === null
                  ? t('billing.plans.quoted')
                  : t('billing.subscriptions.perSeat', { price: money(plan.unit_price_cents) })}
              </Cell>
              <Cell>
                {plan.ai_resolutions_included === null
                  ? t('billing.plans.contract')
                  : formatCount(plan.ai_resolutions_included)}
              </Cell>
              <Cell>{tokens(plan.ai_daily_tokens.llm)}</Cell>
              <Cell>{tokens(plan.ai_daily_tokens.embedding)}</Cell>
              <Cell>
                <span className="tabular-nums">{formatCount(plan.workspaces)}</span>
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <h3 className="border-t border-border px-4 pt-3 text-xs font-semibold">
        {t('billing.packages.title', {
          period: packages.data ? (formatPeriod(packages.data.period) ?? '') : '',
        })}
      </h3>
      {packages.isPending ? (
        <Loading label={t('billing.loading')} />
      ) : packages.isError ? (
        <LoadError
          title={t('billing.packages.failed')}
          error={packages.error}
          onRetry={() => void packages.refetch()}
        />
      ) : (
        <DataTable
          caption={t('billing.packages.caption')}
          headers={[
            t('billing.packages.name'),
            t('billing.subscriptions.price'),
            t('billing.packages.sold'),
            t('billing.packages.revenue'),
          ]}
        >
          {packages.data.api_packages.map((entry) => (
            <tr key={entry.id}>
              <Cell>
                {t('billing.packages.api', {
                  name: entry.name,
                  calls: formatCount(entry.api_calls) ?? '',
                })}
              </Cell>
              <Cell>{money(entry.price_cents)}</Cell>
              <Cell>{formatCount(entry.sold.count)}</Cell>
              <Cell>{money(entry.sold.revenue_cents)}</Cell>
            </tr>
          ))}
          <tr>
            <Cell>
              {t('billing.packages.ai', {
                resolutions: packages.data.ai_resolution_pack.resolutions_per_pack,
              })}
            </Cell>
            <Cell>{money(packages.data.ai_resolution_pack.pack_price_cents)}</Cell>
            <Cell>{formatCount(packages.data.ai_resolution_pack.sold.count)}</Cell>
            <Cell>{money(packages.data.ai_resolution_pack.sold.revenue_cents)}</Cell>
          </tr>
        </DataTable>
      )}
    </Section>
  );
}

// --- Dialogs -----------------------------------------------------------------

/** `"12.50"` → 1250; null for an empty box, NaN for anything that is not an amount. */
export function parseAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!match) return Number.NaN;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return cents >= 1 ? cents : Number.NaN;
}

function describe(t: TFunction) {
  return (error: unknown): string | null => {
    if (!(error instanceof ApiClientError)) return null;
    const reason = error.details?.['reason'];
    if (error.status === 404) return t('billing.dialog.notFound');
    if (error.type === 'platform_workspace_state' && reason === 'workspace_closed') {
      return t('billing.manual.closed');
    }
    if (reason === 'currency_mismatch') return t('billing.credit.currency');
    if (reason === 'period_end_past') return t('billing.manual.past');
    return null;
  };
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-content-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

function CreditDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslate();
  const grant = useGrantCredit();
  const [licenseId, setLicenseId] = useState('');
  const [amount, setAmount] = useState('');
  const cents = parseAmount(amount);
  const valid =
    LICENSE_RE.test(licenseId.trim()) && cents !== null && !Number.isNaN(cents) && cents <= 1e8;

  return (
    <ReasonDialog
      title={t('billing.credit.title')}
      description={t('billing.credit.body')}
      confirmLabel={t('billing.credit.confirm')}
      confirmDisabled={!valid}
      extraDirty={licenseId !== '' || amount !== ''}
      describeError={describe(t)}
      onCancel={onClose}
      onDone={onDone}
      onConfirm={({ reason }) =>
        grant.mutateAsync({
          license_id: licenseId.trim(),
          amount_minor: cents ?? 0,
          currency: 'USD',
          reason,
        })
      }
    >
      <Field id="credit-licence" label={t('billing.licence')}>
        <input
          id="credit-licence"
          inputMode="numeric"
          className={FIELD_CLASS}
          value={licenseId}
          onChange={(event) => setLicenseId(event.target.value)}
        />
      </Field>
      <Field id="credit-amount" label={t('billing.credit.amount')} hint={t('billing.credit.hint')}>
        <input
          id="credit-amount"
          inputMode="decimal"
          className={FIELD_CLASS}
          value={amount}
          aria-describedby="credit-amount-hint"
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
    </ReasonDialog>
  );
}

function ManualSubscriptionDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const t = useTranslate();
  const subscribe = useManualSubscription();
  const [licenseId, setLicenseId] = useState('');
  const [plan, setPlan] = useState<string>('growth');
  const [periodEnd, setPeriodEnd] = useState('');
  const [seats, setSeats] = useState('');
  const seatCount = seats.trim() === '' ? null : /^\d+$/.test(seats.trim()) ? Number(seats) : NaN;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(periodEnd) ? `${periodEnd}T23:59:59.000Z` : null;
  const valid =
    LICENSE_RE.test(licenseId.trim()) &&
    end !== null &&
    (seatCount === null || (!Number.isNaN(seatCount) && seatCount >= 1));

  return (
    <ReasonDialog
      title={t('billing.manual.title')}
      description={t('billing.manual.body')}
      confirmLabel={t('billing.manual.confirm')}
      confirmDisabled={!valid}
      extraDirty={licenseId !== '' || periodEnd !== '' || seats !== ''}
      describeError={describe(t)}
      onCancel={onClose}
      onDone={onDone}
      onConfirm={({ reason }) =>
        subscribe.mutateAsync({
          license_id: licenseId.trim(),
          plan,
          period_end: end ?? '',
          ...(seatCount !== null ? { seats: seatCount } : {}),
          reason,
        })
      }
    >
      <Field id="manual-licence" label={t('billing.licence')}>
        <input
          id="manual-licence"
          inputMode="numeric"
          className={FIELD_CLASS}
          value={licenseId}
          onChange={(event) => setLicenseId(event.target.value)}
        />
      </Field>
      <Field id="manual-plan" label={t('billing.subscriptions.plan')}>
        <select
          id="manual-plan"
          className={FIELD_CLASS}
          value={plan}
          onChange={(event) => setPlan(event.target.value)}
        >
          {PLANS.map((id) => (
            <option key={id} value={id}>
              {t(`billing.plan.${id}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field id="manual-end" label={t('billing.manual.periodEnd')} hint={t('billing.manual.hint')}>
        <input
          id="manual-end"
          type="date"
          className={FIELD_CLASS}
          value={periodEnd}
          aria-describedby="manual-end-hint"
          onChange={(event) => setPeriodEnd(event.target.value)}
        />
      </Field>
      <Field id="manual-seats" label={t('billing.manual.seats')}>
        <input
          id="manual-seats"
          inputMode="numeric"
          className={FIELD_CLASS}
          value={seats}
          onChange={(event) => setSeats(event.target.value)}
        />
      </Field>
    </ReasonDialog>
  );
}
