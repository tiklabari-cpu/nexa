/**
 * Raporlar › AI Kalite › Kuyruk (tm 319.3 · SiyahTuş analysis AI-24): the
 * conversations the QA queue holds for the caller — a Team Lead their led
 * teams', an administrator every one — most pressing first (risk, then
 * guardrail, then the rest; earliest due within each).
 *
 * Above the list, the last 30 days' figures (`GET /qa/summary`): what is open
 * and overdue, how the completed reviews ended, the mandatory hand-overs the
 * AI missed and the guardrail breaches a reviewer confirmed — what AI-25's
 * rates read from QA.
 *
 * "Review" claims a ready one and opens it; one waiting for its pre-score
 * cannot be claimed yet (the server says `pending_prescore`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  QA_REASONS,
  QA_REVIEW_LIST_LIMIT_DEFAULT,
  type QaReason,
  type QaReviewListStatus,
  type QaReviewStatus,
} from '@siyahtus/types';
import { CopyId } from '../../../components/CopyId.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { LoadError } from '../../../components/LoadError.js';
import { Card, Kpi, KpiGrid } from '../../../components/Page.js';
import { ListSkeleton } from '../../../components/Skeleton.js';
import { Banner } from '../../../components/ui/index.js';
import { errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient, useAuth } from '../../../lib/auth-store.js';
import { formatCount, formatDateTime, formatRate } from '../../../lib/format.js';
import { useTranslate } from '../../../lib/i18n.js';
import {
  qaErrorKey,
  qaKeys,
  qaListPath,
  qaReviewHref,
  refreshQaLists,
  type QaQueueFilter,
  type QaReviewDetail,
  type QaReviewList,
  type QaSummary,
} from './qa.js';

const field = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary';
const button =
  'rounded-md border border-border px-2.5 py-1 text-xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

/** The list statuses offered, `open` first — the default. */
const STATUS_FILTERS: readonly QaReviewListStatus[] = [
  'open',
  'ready',
  'in_review',
  'pending_prescore',
  'completed',
  'all',
];

const STATUS_CLASS: Record<QaReviewStatus, string> = {
  pending_prescore: 'bg-surface-2 text-content-secondary',
  ready: 'bg-warning/10 text-warning',
  in_review: 'bg-brand-500/10 text-content',
  completed: 'bg-success/10 text-success',
};

export function QaStatusBadge({ status }: { status: QaReviewStatus }): ReactElement {
  const t = useTranslate();
  return (
    <span className={`rounded px-1.5 py-0.5 text-2xs font-medium ${STATUS_CLASS[status]}`}>
      {t(`reports.qa.status.${status}`)}
    </span>
  );
}

export function QaReasonChips({ reasons }: { reasons: readonly QaReason[] }): ReactElement {
  const t = useTranslate();
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((reason) => (
        <span
          key={reason}
          className="rounded-sm border border-border px-1 text-2xs text-content-secondary"
        >
          {t(`reports.qa.reason.${reason}`)}
        </span>
      ))}
    </span>
  );
}

export function QaQueue(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.agent?.account_id ?? null);
  const [filter, setFilter] = useState<QaQueueFilter>({ status: 'open', reason: '', mine: false });
  const [offset, setOffset] = useState(0);

  const list = useQuery({
    queryKey: [...qaKeys.list(filter), offset],
    queryFn: () => api.get<QaReviewList>(`${qaListPath(filter)}&offset=${offset}`),
  });
  const claim = useMutation({
    mutationFn: (id: string) =>
      api.post<QaReviewDetail>(`/qa/reviews/${encodeURIComponent(id)}/claim`, {}),
    onSuccess: (row) => {
      queryClient.setQueryData(qaKeys.review(row.id), row);
      refreshQaLists(queryClient);
      navigate(qaReviewHref(row.id));
    },
  });
  const change = (next: Partial<QaQueueFilter>): void => {
    setFilter((current) => ({ ...current, ...next }));
    setOffset(0);
  };

  const reviews = list.data?.reviews ?? [];
  const total = list.data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <QaSummaryFigures />

      {claim.error && (
        <Banner tone="danger">{t(qaErrorKey(claim.error) ?? errorMessageKey(claim.error))}</Banner>
      )}

      <Card>
        <form
          className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3"
          aria-label={t('reports.qa.queue.filters')}
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('reports.qa.queue.statusFilter')}
            <select
              value={filter.status}
              onChange={(event) => change({ status: event.target.value as QaReviewListStatus })}
              className={field}
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {t(`reports.qa.statusOption.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('reports.qa.queue.reasonFilter')}
            <select
              value={filter.reason}
              onChange={(event) => change({ reason: event.target.value as QaReason | '' })}
              className={field}
            >
              <option value="">{t('reports.qa.queue.anyReason')}</option>
              {QA_REASONS.map((value) => (
                <option key={value} value={value}>
                  {t(`reports.qa.reason.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 pb-1 text-2xs text-content-secondary">
            <input
              type="checkbox"
              checked={filter.mine}
              onChange={(event) => change({ mine: event.target.checked })}
            />
            {t('reports.qa.queue.mineOnly')}
          </label>
          {list.data && (
            <p className="ml-auto pb-1 text-2xs text-content-tertiary" aria-live="polite">
              {t('reports.qa.queue.count', { count: total })} ·{' '}
              {t('reports.qa.queue.openCount', { count: list.data.open_count })}
            </p>
          )}
        </form>

        {list.isPending ? (
          <ListSkeleton rows={5} />
        ) : list.isError ? (
          <LoadError
            compact
            title={t('reports.qa.queue.loadError')}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        ) : reviews.length === 0 ? (
          <EmptyState
            title={t('reports.qa.queue.emptyTitle')}
            description={t('reports.qa.queue.emptyDescription')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{t('reports.qa.queue.caption')}</caption>
              <thead className="border-b border-border text-2xs uppercase tracking-wide text-content-tertiary">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('reports.qa.queue.colConversation')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('reports.qa.queue.colReasons')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('reports.qa.queue.colStatus')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    {t('reports.qa.queue.colDue')}
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    <span className="sr-only">{t('reports.qa.queue.colAction')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((row) => {
                  const mine = row.assigned_to !== null && row.assigned_to === me;
                  return (
                    <tr
                      key={row.id}
                      data-testid="qa-queue-row"
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-4 py-2">
                        <CopyId kind="chat" value={row.thread_id} />
                      </td>
                      <td className="px-4 py-2">
                        <QaReasonChips reasons={row.reasons} />
                        <span className="mt-0.5 block text-2xs text-content-tertiary">
                          {t(`reports.qa.priority.${row.priority}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <QaStatusBadge status={row.status} />
                        {row.status === 'completed' && row.final && (
                          <span
                            className={`ml-1.5 text-2xs font-medium ${
                              row.final === 'pass' ? 'text-success' : 'text-danger'
                            }`}
                          >
                            {t(`reports.qa.final.${row.final}`)}
                          </span>
                        )}
                        {mine && row.status === 'in_review' && (
                          <span className="ml-1.5 text-2xs text-content-tertiary">
                            {t('reports.qa.queue.yours')}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-4 py-2 text-content-secondary">
                        {formatDateTime(row.due_at)}
                        {row.overdue && row.status !== 'completed' && (
                          <span className="ml-1.5 font-medium text-danger">
                            {t('reports.qa.queue.overdue')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {row.status === 'ready' ? (
                          <button
                            type="button"
                            className={primaryButton}
                            disabled={claim.isPending}
                            onClick={() => claim.mutate(row.id)}
                          >
                            {t('reports.qa.queue.review')}
                          </button>
                        ) : (
                          <Link to={qaReviewHref(row.id)} className={button}>
                            {mine && row.status === 'in_review'
                              ? t('reports.qa.queue.continue')
                              : t('reports.qa.queue.open')}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > QA_REVIEW_LIST_LIMIT_DEFAULT && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
            <button
              type="button"
              className={button}
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - QA_REVIEW_LIST_LIMIT_DEFAULT))}
            >
              {t('reports.qa.queue.previous')}
            </button>
            <button
              type="button"
              className={button}
              disabled={offset + QA_REVIEW_LIST_LIMIT_DEFAULT >= total}
              onClick={() => setOffset(offset + QA_REVIEW_LIST_LIMIT_DEFAULT)}
            >
              {t('reports.qa.queue.next')}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** The last 30 days' figures (`GET /qa/summary`, the server's default window). */
function QaSummaryFigures(): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const summary = useQuery({
    queryKey: qaKeys.summary,
    queryFn: () => api.get<QaSummary>('/qa/summary'),
  });
  // The queue below says what failed to load; the figures are the extra.
  if (!summary.data) return null;
  const figures = summary.data;
  return (
    <section aria-label={t('reports.qa.summary.title')} className="flex flex-col gap-2">
      <p className="text-2xs text-content-tertiary">{t('reports.qa.summary.window')}</p>
      <KpiGrid>
        <Kpi label={t('reports.qa.summary.open')} value={formatCount(figures.open)} />
        <Kpi
          label={t('reports.qa.summary.overdue')}
          value={formatCount(figures.overdue)}
          tone={figures.overdue > 0 ? 'warn' : 'neutral'}
        />
        <Kpi label={t('reports.qa.summary.completed')} value={formatCount(figures.completed)} />
        <Kpi
          label={t('reports.qa.summary.passRate')}
          value={figures.completed > 0 ? formatRate(figures.passed / figures.completed) : null}
        />
        <Kpi
          label={t('reports.qa.summary.criticalFailed')}
          value={formatCount(figures.critical_failed)}
          tone={figures.critical_failed > 0 ? 'warn' : 'neutral'}
        />
        <Kpi
          label={t('reports.qa.summary.handoffMissed')}
          value={formatCount(figures.mandatory_handoff.violations)}
          hint={t('reports.qa.summary.handoffChecked', {
            count: figures.mandatory_handoff.reviewed,
          })}
        />
        <Kpi
          label={t('reports.qa.summary.guardrailBreaches')}
          value={formatCount(figures.guardrail_violations_confirmed)}
        />
        <Kpi
          label={t('reports.qa.summary.falseResolutions')}
          value={formatCount(figures.false_resolutions)}
        />
      </KpiGrid>
    </section>
  );
}
