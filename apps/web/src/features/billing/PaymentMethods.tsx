/**
 * Paying for the subscription (tm 382 · BL-01 · ADR-13a) — the billing
 * screen's payment half: which methods this workspace is offered, the amount
 * one term costs, and for each method the next step.
 *
 *   - **Bank transfer** — the platform's bank details and a reference to write
 *     in the transfer description. The SiyahTuş team marks it paid.
 *   - **Crypto** — "request an address": the owner asks, the team answers with
 *     a wallet address on the request (never shown by itself), the owner
 *     writes the TXID, the team confirms it.
 *   - **Card** — off to the processor's hosted page; the card never touches
 *     SiyahTuş. Offered only when the deployment runs a real processor.
 *
 * The same amount whichever way. Confirming a payment is never possible from
 * here: that is the team's, in the root panel. A member who is not the owner
 * (K7) reads every panel with the buttons gone.
 *
 * {@link PaymentStatusBand} is the "payment failed" band: a renewal that
 * failed (the dunning plan's grace, with the next retry and the read-only
 * date), a checkout that did not go through, or the browser's way back from
 * the hosted page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Card, CardSkeleton, ErrorNotice, Section } from '../../components/Page.js';
import { Banner } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { reasonMessage } from '../../lib/reason-message.js';

type PaymentMethodId = 'swift_manual' | 'crypto_manual' | 'stripe';
type CryptoNetwork = 'usdt_trc20' | 'usdt_erc20';

interface SwiftPayment {
  reference: string;
  amount_minor: number;
  currency: string;
  billing_cycle: 'monthly' | 'annual';
  created_at: string;
}

export interface PaymentOptions {
  methods: PaymentMethodId[];
  card_form: boolean;
  amount_due: {
    amount_minor: number;
    currency: string;
    billing_cycle: 'monthly' | 'annual';
    seats: number;
  } | null;
  swift: {
    bank: {
      beneficiary: string;
      bank_name: string;
      iban: string;
      swift_bic: string;
      bank_address: string | null;
    } | null;
    pending: SwiftPayment | null;
  };
  state: {
    license_status: string;
    provider: PaymentMethodId | null;
    paid_through: string | null;
    past_due_since: string | null;
    read_only_after: string | null;
    next_retry_at: string | null;
    last_failure: { reference: string; failure_code: string | null; at: string } | null;
  };
}

interface CryptoRequest {
  id: string;
  network: CryptoNetwork;
  status: 'requested' | 'address_sent' | 'paid' | 'rejected' | 'canceled';
  amount_minor: number;
  currency: string;
  billing_name: string;
  billing_details: string | null;
  wallet_address: string | null;
  txid: string | null;
  txid_submitted_at: string | null;
  closed_reason: string | null;
  created_at: string;
  closed_at: string | null;
}

interface PaymentRecord {
  id: string;
  reference: string;
  provider: PaymentMethodId;
  kind: 'checkout' | 'renewal';
  status: 'pending' | 'succeeded' | 'failed' | 'canceled' | 'disputed';
  amount_minor: number;
  currency: string;
  attempt: number;
  failure_code: string | null;
  term_start: string | null;
  term_end: string | null;
  created_at: string;
}

const OPTIONS_KEY = ['billing', 'payment-options'] as const;
const CRYPTO_KEY = ['billing', 'crypto-requests'] as const;
const PAYMENTS_KEY = ['billing', 'payments'] as const;

const METHOD_LABEL_KEYS: Record<PaymentMethodId, string> = {
  swift_manual: 'billing.payments.method.swift_manual',
  crypto_manual: 'billing.payments.method.crypto_manual',
  stripe: 'billing.payments.method.stripe',
};

/** `GET /billing/payment-options`, shared by the band, the section and the page. */
export function usePaymentOptions() {
  const api = useApiClient();
  return useQuery({
    queryKey: OPTIONS_KEY,
    queryFn: () => api.get<PaymentOptions>('/billing/payment-options'),
  });
}

/** An API refusal in the words of this screen, or the generic sentence for its type. */
function failureText(t: TFunction, error: unknown): string {
  return reasonMessage(t, error, 'billing.payments.errors') ?? t(errorMessageKey(error));
}

/** USDT is read 1:1 from US cents (ADR-13a §3) — no exchange rate, no rounding. */
function usdt(amountMinor: number): string {
  return `${(amountMinor / 100).toFixed(2)} USDT`;
}

function cycleLabel(t: TFunction, cycle: 'monthly' | 'annual'): string {
  return t(`billing.payments.cycle.${cycle}`);
}

/** Where the browser came back from the hosted page, if it did — read once. */
function returnedFromCheckout(): 'success' | 'canceled' | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get('payment');
  return value === 'success' || value === 'canceled' ? value : null;
}

export function PaymentStatusBand(): ReactElement | null {
  const t = useTranslate();
  const options = usePaymentOptions();
  const [returned] = useState(returnedFromCheckout);
  const state = options.data?.state;

  if (state?.license_status === 'past_due') {
    return (
      <Banner tone="danger" role="alert" title={t('billing.payments.band.pastDueTitle')}>
        <span data-testid="payment-failed-band">
          {t('billing.payments.band.pastDueBody', {
            retry: formatDate(state.next_retry_at) ?? t('billing.payments.band.noRetry'),
            readOnly: formatDate(state.read_only_after) ?? '',
          })}
        </span>
      </Banner>
    );
  }
  if (state?.last_failure) {
    return (
      <Banner tone="warning" role="alert" title={t('billing.payments.band.failedTitle')}>
        <span data-testid="payment-failed-band">
          {t('billing.payments.band.failedBody', { reference: state.last_failure.reference })}
        </span>
      </Banner>
    );
  }
  if (returned === 'success') {
    return (
      <Banner tone="success" title={t('billing.payments.band.returnedSuccessTitle')}>
        {t('billing.payments.band.returnedSuccessBody')}
      </Banner>
    );
  }
  if (returned === 'canceled') {
    return <Banner tone="info">{t('billing.payments.band.returnedCanceled')}</Banner>;
  }
  return null;
}

export function PaymentOptionsSection({ canManage }: { canManage: boolean }): ReactElement {
  const t = useTranslate();
  const options = usePaymentOptions();
  const [chosen, setChosen] = useState<PaymentMethodId | null>(null);
  const title = t('billing.payments.title');

  if (options.isPending) {
    return (
      <Section title={title}>
        <CardSkeleton rows={2} />
      </Section>
    );
  }
  if (options.error) {
    return (
      <Section title={title}>
        <ErrorNotice message={t('billing.payments.loadError')} />
      </Section>
    );
  }

  const data = options.data;
  const due = data.amount_due;
  const methods = data.methods;
  const tab = chosen && methods.includes(chosen) ? chosen : (methods[0] ?? null);

  return (
    <Section title={title} description={t('billing.payments.description')}>
      <Card>
        <div className="flex flex-col gap-4 p-4">
          <div data-testid="payment-amount-due" className="text-sm">
            {due ? (
              <p>
                {t('billing.payments.amountDue', {
                  amount: formatMoney(due.amount_minor) ?? '',
                  seats: due.seats,
                  cycle: cycleLabel(t, due.billing_cycle),
                })}
              </p>
            ) : (
              <p className="text-content-secondary">{t('billing.payments.quoted')}</p>
            )}
            {data.state.paid_through && (
              <p className="mt-1 text-2xs text-content-tertiary">
                {t('billing.payments.paidThrough', {
                  date: formatDate(data.state.paid_through) ?? '',
                })}
              </p>
            )}
          </div>

          {methods.length === 0 || !due ? (
            due && (
              <p className="text-sm text-content-secondary">{t('billing.payments.noMethods')}</p>
            )
          ) : (
            <>
              <div
                role="tablist"
                aria-label={t('billing.payments.tablistLabel')}
                className="flex gap-1 border-b border-border"
              >
                {methods.map((id) => {
                  const selected = tab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      id={`payment-tab-${id}`}
                      aria-selected={selected}
                      aria-controls={`payment-panel-${id}`}
                      onClick={() => setChosen(id)}
                      className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                        selected
                          ? 'border-brand-500 text-content'
                          : 'border-transparent text-content-secondary hover:text-content'
                      }`}
                    >
                      {t(METHOD_LABEL_KEYS[id])}
                    </button>
                  );
                })}
              </div>
              {tab && (
                <div
                  role="tabpanel"
                  id={`payment-panel-${tab}`}
                  aria-labelledby={`payment-tab-${tab}`}
                >
                  {tab === 'swift_manual' && <SwiftPanel options={data} canManage={canManage} />}
                  {tab === 'crypto_manual' && (
                    <CryptoPanel amountMinor={due.amount_minor} canManage={canManage} />
                  )}
                  {tab === 'stripe' && (
                    <CardPanel amountMinor={due.amount_minor} canManage={canManage} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </Section>
  );
}

function SwiftPanel({
  options,
  canManage,
}: {
  options: PaymentOptions;
  canManage: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const issue = useMutation({
    mutationFn: () => api.post<SwiftPayment>('/billing/payments/swift'),
    // The reference is a payment waiting in the history too.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
      void queryClient.invalidateQueries({ queryKey: PAYMENTS_KEY });
    },
  });
  const bank = options.swift.bank;
  const pending = issue.data ?? options.swift.pending;

  return (
    <div className="flex flex-col gap-3 pt-3 text-sm" data-testid="swift-panel">
      {bank ? (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-content-secondary">{t('billing.payments.swift.beneficiary')}</dt>
          <dd>{bank.beneficiary}</dd>
          <dt className="text-content-secondary">{t('billing.payments.swift.bank')}</dt>
          <dd>{bank.bank_name}</dd>
          <dt className="text-content-secondary">{t('billing.payments.swift.iban')}</dt>
          <dd className="font-mono">{bank.iban}</dd>
          <dt className="text-content-secondary">{t('billing.payments.swift.bic')}</dt>
          <dd className="font-mono">{bank.swift_bic}</dd>
          {bank.bank_address && (
            <>
              <dt className="text-content-secondary">{t('billing.payments.swift.address')}</dt>
              <dd>{bank.bank_address}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-content-secondary">{t('billing.payments.swift.noBank')}</p>
      )}

      {pending ? (
        <div className="rounded-md border border-border p-3">
          <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('billing.payments.swift.referenceLabel')}
          </p>
          <p data-testid="swift-reference" className="font-mono text-lg font-semibold">
            {pending.reference}
          </p>
          <p className="mt-1 text-content-secondary">
            {t('billing.payments.swift.instructions', {
              amount: formatMoney(pending.amount_minor) ?? '',
            })}
          </p>
        </div>
      ) : canManage ? (
        <div>
          <button
            type="button"
            onClick={() => issue.mutate()}
            disabled={issue.isPending}
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {issue.isPending
              ? t('billing.payments.swift.issuing')
              : t('billing.payments.swift.issueButton')}
          </button>
        </div>
      ) : null}
      {issue.error && (
        <p className="text-danger" role="alert">
          {failureText(t, issue.error)}
        </p>
      )}
    </div>
  );
}

/** Why the SiyahTuş team rejected the last crypto request, in the team's own words. */
function RejectedNotice({ reason, canRetry }: { reason: string; canRetry: boolean }): ReactElement {
  const t = useTranslate();
  return (
    <div
      className="rounded-md border border-border bg-surface-2 p-3"
      data-testid="crypto-rejected-reason"
    >
      <p className="font-medium">{t('billing.payments.crypto.rejectedTitle')}</p>
      <p className="mt-1 text-2xs font-medium text-content-secondary">
        {t('billing.payments.crypto.rejectedSource')}
      </p>
      <p className="whitespace-pre-wrap break-words">{reason}</p>
      {canRetry && (
        <p className="mt-2 text-content-secondary">{t('billing.payments.crypto.rejectedRetry')}</p>
      )}
    </div>
  );
}

function CryptoPanel({
  amountMinor,
  canManage,
}: {
  amountMinor: number;
  canManage: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: CRYPTO_KEY,
    queryFn: () => api.get<{ requests: CryptoRequest[] }>('/billing/crypto-requests'),
  });
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: CRYPTO_KEY });
    void queryClient.invalidateQueries({ queryKey: OPTIONS_KEY });
  };

  const [network, setNetwork] = useState<CryptoNetwork>('usdt_trc20');
  const [billingName, setBillingName] = useState('');
  const [billingDetails, setBillingDetails] = useState('');
  const [txid, setTxid] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.post<CryptoRequest>('/billing/crypto-requests', {
        network,
        billing_name: billingName.trim(),
        billing_details: billingDetails.trim() || null,
      }),
    onSuccess: refresh,
  });
  const submitTxid = useMutation({
    mutationFn: (id: string) =>
      api.post<CryptoRequest>(`/billing/crypto-requests/${id}/txid`, { txid: txid.trim() }),
    onSuccess: () => {
      setTxid('');
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post<CryptoRequest>(`/billing/crypto-requests/${id}/cancel`),
    onSuccess: refresh,
  });

  if (requests.isPending) return <CardSkeleton rows={2} />;
  if (requests.error) return <ErrorNotice message={t('billing.payments.crypto.loadError')} />;

  const list = requests.data.requests;
  const open = list.find((r) => r.status === 'requested' || r.status === 'address_sent');
  const closed = list.filter((r) => r !== open).slice(0, 5);
  // The newest request, when the team rejected it and said why. The reason is the
  // operator's own words (not translated); it goes away once a new request is open.
  const rejectedReason =
    !open && list[0]?.status === 'rejected' ? list[0].closed_reason?.trim() : '';

  const onCreate = (event: FormEvent): void => {
    event.preventDefault();
    if (billingName.trim()) create.mutate();
  };
  const onTxid = (event: FormEvent): void => {
    event.preventDefault();
    if (open && txid.trim()) submitTxid.mutate(open.id);
  };

  return (
    <div className="flex flex-col gap-3 pt-3 text-sm" data-testid="crypto-panel">
      {open ? (
        <div className="rounded-md border border-border p-3" data-testid="crypto-open-request">
          <p className="font-medium">
            {t(`billing.payments.crypto.status.${open.status}`)} ·{' '}
            {t(`billing.payments.crypto.network.${open.network}`)}
          </p>
          {open.status === 'requested' && (
            <p className="mt-1 text-content-secondary">
              {t('billing.payments.crypto.waitingForAddress')}
            </p>
          )}
          {open.status === 'address_sent' && open.wallet_address && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-content-secondary">
                {t('billing.payments.crypto.sendExactly', {
                  amount: usdt(open.amount_minor),
                  network: t(`billing.payments.crypto.network.${open.network}`),
                })}
              </p>
              <p data-testid="crypto-wallet-address" className="break-all font-mono">
                {open.wallet_address}
              </p>
              {open.txid && (
                <p className="text-content-secondary">
                  {t('billing.payments.crypto.txidSubmitted', { txid: open.txid })}
                </p>
              )}
              {canManage && (
                <form onSubmit={onTxid} className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-2xs font-medium text-content-secondary">
                      {t('billing.payments.crypto.txidLabel')}
                    </span>
                    <input
                      value={txid}
                      onChange={(e) => setTxid(e.target.value)}
                      maxLength={66}
                      className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={submitTxid.isPending || !txid.trim()}
                    className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                  >
                    {open.txid
                      ? t('billing.payments.crypto.replaceTxid')
                      : t('billing.payments.crypto.submitTxid')}
                  </button>
                </form>
              )}
            </div>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => cancel.mutate(open.id)}
              disabled={cancel.isPending}
              className="mt-3 text-sm font-medium text-content-secondary underline hover:text-content"
            >
              {t('billing.payments.crypto.withdraw')}
            </button>
          )}
          {submitTxid.error && (
            <p className="mt-2 text-danger" role="alert">
              {failureText(t, submitTxid.error)}
            </p>
          )}
          {cancel.error && (
            <p className="mt-2 text-danger" role="alert">
              {failureText(t, cancel.error)}
            </p>
          )}
        </div>
      ) : canManage ? (
        <form
          onSubmit={onCreate}
          className="flex flex-col gap-3"
          aria-label={t('billing.payments.crypto.formLabel')}
        >
          {rejectedReason && <RejectedNotice reason={rejectedReason} canRetry />}
          <p className="text-content-secondary">
            {t('billing.payments.crypto.intro', { amount: usdt(amountMinor) })}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-content-secondary">
              {t('billing.payments.crypto.networkLabel')}
            </span>
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value as CryptoNetwork)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            >
              <option value="usdt_trc20">{t('billing.payments.crypto.network.usdt_trc20')}</option>
              <option value="usdt_erc20">{t('billing.payments.crypto.network.usdt_erc20')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-content-secondary">
              {t('billing.payments.crypto.billingNameLabel')}
            </span>
            <input
              value={billingName}
              onChange={(e) => setBillingName(e.target.value)}
              maxLength={200}
              required
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-medium text-content-secondary">
              {t('billing.payments.crypto.billingDetailsLabel')}
            </span>
            <textarea
              value={billingDetails}
              onChange={(e) => setBillingDetails(e.target.value)}
              maxLength={1000}
              rows={2}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={create.isPending || !billingName.trim()}
              className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {t('billing.payments.crypto.requestButton')}
            </button>
          </div>
          {create.error && (
            <p className="text-danger" role="alert">
              {failureText(t, create.error)}
            </p>
          )}
        </form>
      ) : rejectedReason ? (
        <RejectedNotice reason={rejectedReason} canRetry={false} />
      ) : (
        <p className="text-content-secondary">{t('billing.payments.crypto.noRequest')}</p>
      )}

      {closed.length > 0 && (
        <ul className="flex flex-col gap-1 text-2xs text-content-tertiary">
          {closed.map((r) => (
            <li key={r.id}>
              {formatDate(r.created_at)} · {t(`billing.payments.crypto.network.${r.network}`)} ·{' '}
              {t(`billing.payments.crypto.status.${r.status}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CardPanel({
  amountMinor,
  canManage,
}: {
  amountMinor: number;
  canManage: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const pay = useMutation({
    mutationFn: () => api.post<{ url: string }>('/billing/payments/stripe/checkout'),
    // The processor's page, in this tab: the card is typed there, never here.
    onSuccess: ({ url }) => window.location.assign(url),
  });
  return (
    <div className="flex flex-col gap-3 pt-3 text-sm" data-testid="card-panel">
      <p className="text-content-secondary">
        {t('billing.payments.card.intro', { amount: formatMoney(amountMinor) ?? '' })}
      </p>
      {canManage && (
        <div>
          <button
            type="button"
            onClick={() => pay.mutate()}
            disabled={pay.isPending || pay.isSuccess}
            className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
          >
            {pay.isPending || pay.isSuccess
              ? t('billing.payments.card.redirecting')
              : t('billing.payments.card.payButton')}
          </button>
        </div>
      )}
      {pay.error && (
        <p className="text-danger" role="alert">
          {failureText(t, pay.error)}
        </p>
      )}
    </div>
  );
}

export function PaymentHistorySection(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const history = useQuery({
    queryKey: PAYMENTS_KEY,
    queryFn: () => api.get<{ payments: PaymentRecord[] }>('/billing/payments'),
  });
  const title = t('billing.payments.history.title');

  if (history.isPending) {
    return (
      <Section title={title}>
        <CardSkeleton rows={1} />
      </Section>
    );
  }
  if (history.error) {
    return (
      <Section title={title}>
        <ErrorNotice message={t('billing.payments.history.loadError')} />
      </Section>
    );
  }
  const payments = history.data.payments;
  return (
    <Section title={title}>
      <Card>
        {payments.length === 0 ? (
          <p className="p-4 text-sm text-content-secondary" data-testid="payment-history-empty">
            {t('billing.payments.history.empty')}
          </p>
        ) : (
          <table className="w-full text-sm" data-testid="payment-history">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-wide text-content-tertiary">
                <th className="px-4 py-2 font-medium">{t('billing.payments.history.date')}</th>
                <th className="px-4 py-2 font-medium">{t('billing.payments.history.method')}</th>
                <th className="px-4 py-2 font-medium">{t('billing.payments.history.reference')}</th>
                <th className="px-4 py-2 font-medium">{t('billing.payments.history.status')}</th>
                <th className="px-4 py-2 text-right font-medium">
                  {t('billing.payments.history.amount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2">{formatDateTime(p.created_at)}</td>
                  <td className="px-4 py-2">{t(METHOD_LABEL_KEYS[p.provider])}</td>
                  <td className="px-4 py-2 font-mono">{p.reference}</td>
                  <td className="px-4 py-2">
                    {t(`billing.payments.history.statusValue.${p.status}`)}
                    {p.status === 'succeeded' && p.term_end && (
                      <span className="block text-2xs text-content-tertiary">
                        {t('billing.payments.history.term', {
                          from: formatDate(p.term_start) ?? '',
                          to: formatDate(p.term_end) ?? '',
                        })}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-2 text-right">{formatMoney(p.amount_minor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Section>
  );
}
