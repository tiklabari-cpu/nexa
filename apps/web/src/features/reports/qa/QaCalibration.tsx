/**
 * Raporlar › AI Kalite › Kalibrasyon (tm 319.3 · SiyahTuş analysis AI-24):
 * once a month the same completed conversations (up to 20) go to every
 * reviewer, each scores them on their own, and the report says how far they
 * agree — per criterion, the share of values equal to that conversation's
 * majority, and each reviewer's deviation (over 30 % is an outlier).
 *
 * An administrator opens the month's round and closes it; until it closes
 * the report is the administrator's alone, so a reviewer scores without
 * seeing how the others did. Scoring follows the review's rule: every
 * criterion, the critical ones confirmed, a verdict.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import type { QaFinal } from '@siyahtus/types';
import { CopyId } from '../../../components/CopyId.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { LoadError } from '../../../components/LoadError.js';
import { Card } from '../../../components/Page.js';
import { ListSkeleton } from '../../../components/Skeleton.js';
import { Banner } from '../../../components/ui/index.js';
import { errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient, useAuth } from '../../../lib/auth-store.js';
import { formatDateTime, formatRate } from '../../../lib/format.js';
import { useTranslate } from '../../../lib/i18n.js';
import { useAgentRoster } from '../../archive/useArchive.js';
import { roleAtLeast } from '../../team/RoleMenu.js';
import { QaExcerpt } from './QaExcerpt.js';
import { QaReasonChips } from './QaQueue.js';
import { QaScoring } from './QaScoring.js';
import {
  criterionLabel,
  draftFromScores,
  draftProblems,
  qaErrorKey,
  qaKeys,
  scoresBody,
  serverProblems,
  type QaCalibration as QaCalibrationRound,
  type QaCalibrationDetail,
  type QaCalibrationItem,
  type ScoreDraft,
} from './qa.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

export function QaCalibration(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const role = useAuth((s) => s.agent?.role ?? null);
  const isAdministrator = roleAtLeast(role, 'admin');
  const [openId, setOpenId] = useState<string | null>(null);

  const rounds = useQuery({
    queryKey: qaKeys.calibrations,
    queryFn: () => api.get<{ calibrations: QaCalibrationRound[] }>('/qa/calibrations'),
  });
  const create = useMutation({
    mutationFn: () => api.post<QaCalibrationRound>('/qa/calibrations', {}),
    onSuccess: (round) => {
      void queryClient.invalidateQueries({ queryKey: qaKeys.calibrations });
      setOpenId(round.id);
    },
  });

  const list = rounds.data?.calibrations ?? [];
  const selected = openId ?? list[0]?.id ?? null;

  return (
    <div className="flex flex-col gap-4" data-testid="qa-calibration">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-xs text-content-secondary">
          {t('reports.qa.calibration.description')}
        </p>
        {isAdministrator && (
          <button
            type="button"
            className={primaryButton}
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {t('reports.qa.calibration.open')}
          </button>
        )}
      </div>
      {create.error && (
        <Banner tone="danger">
          {t(qaErrorKey(create.error) ?? errorMessageKey(create.error))}
        </Banner>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
        <Card>
          {rounds.isPending ? (
            <ListSkeleton rows={3} />
          ) : rounds.isError ? (
            <LoadError
              compact
              title={t('reports.qa.calibration.loadError')}
              error={rounds.error}
              onRetry={() => void rounds.refetch()}
            />
          ) : list.length === 0 ? (
            <EmptyState
              title={t('reports.qa.calibration.emptyTitle')}
              description={t('reports.qa.calibration.emptyDescription')}
            />
          ) : (
            <ul aria-label={t('reports.qa.calibration.rounds')}>
              {list.map((round) => (
                <li key={round.id} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    aria-current={round.id === selected ? 'true' : undefined}
                    data-testid="qa-calibration-round"
                    onClick={() => setOpenId(round.id)}
                    className={`flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
                      round.id === selected ? 'bg-surface-2' : ''
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium tabular">{round.period}</span>
                      <span className="text-2xs text-content-tertiary">
                        {t(`reports.qa.calibration.status.${round.status}`)}
                      </span>
                    </span>
                    <span className="text-2xs text-content-secondary">
                      {t('reports.qa.calibration.progress', {
                        scored: String(round.my_scored),
                        total: String(round.reviews),
                      })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          {selected ? (
            <CalibrationRound key={selected} id={selected} isAdministrator={isAdministrator} />
          ) : (
            <Card>
              <EmptyState
                title={t('reports.qa.calibration.pickTitle')}
                description={t('reports.qa.calibration.pickDescription')}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function CalibrationRound({
  id,
  isAdministrator,
}: {
  id: string;
  isAdministrator: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const round = useQuery({
    queryKey: qaKeys.calibration(id),
    queryFn: () => api.get<QaCalibrationDetail>(`/qa/calibrations/${encodeURIComponent(id)}`),
  });
  const close = useMutation({
    mutationFn: () =>
      api.post<QaCalibrationDetail>(`/qa/calibrations/${encodeURIComponent(id)}/close`, {}),
    onSuccess: (row) => {
      queryClient.setQueryData(qaKeys.calibration(id), row);
      void queryClient.invalidateQueries({ queryKey: qaKeys.calibrations });
    },
  });
  const [openItem, setOpenItem] = useState<string | null>(null);

  if (round.isPending) return <ListSkeleton rows={4} />;
  if (round.isError) {
    return (
      <LoadError
        title={t('reports.qa.calibration.loadError')}
        error={round.error}
        onRetry={() => void round.refetch()}
      />
    );
  }
  const detail = round.data;
  const closed = detail.status === 'closed';

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <p className="text-sm font-semibold tabular">{detail.period}</p>
          <span className="text-2xs text-content-tertiary">
            {t(`reports.qa.calibration.status.${detail.status}`)} ·{' '}
            {t('reports.qa.calibration.progress', {
              scored: String(detail.my_scored),
              total: String(detail.reviews),
            })}
            {detail.closed_at &&
              ` · ${t('reports.qa.calibration.closedAt', { at: formatDateTime(detail.closed_at) ?? '—' })}`}
          </span>
          {isAdministrator && !closed && (
            <button
              type="button"
              className={`${button} ml-auto`}
              disabled={close.isPending}
              onClick={() => close.mutate()}
            >
              {t('reports.qa.calibration.close')}
            </button>
          )}
        </div>
        {close.error && (
          <div className="px-4 pb-3">
            <Banner tone="danger">{t(errorMessageKey(close.error))}</Banner>
          </div>
        )}
      </Card>

      {detail.report ? (
        <CalibrationReport detail={detail} />
      ) : (
        <p className="text-2xs text-content-tertiary">{t('reports.qa.calibration.reportLater')}</p>
      )}

      <Card>
        <ol aria-label={t('reports.qa.calibration.items')}>
          {detail.items.map((item, index) => {
            const open = openItem === item.review_id;
            return (
              <li
                key={item.review_id}
                data-testid="qa-calibration-item"
                className="border-b border-border last:border-0"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenItem(open ? null : item.review_id)}
                  className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left hover:bg-surface-2"
                >
                  <span className="text-xs font-medium">
                    {t('reports.qa.calibration.item', { n: String(index + 1) })}
                  </span>
                  <QaReasonChips reasons={item.reasons} />
                  <span
                    className={`ml-auto text-2xs ${
                      item.my_final ? 'text-success' : 'text-content-tertiary'
                    }`}
                  >
                    {item.my_final
                      ? t('reports.qa.calibration.scored')
                      : t('reports.qa.calibration.notScored')}
                  </span>
                </button>
                {open && (
                  <CalibrationItem
                    calibrationId={detail.id}
                    item={item}
                    detail={detail}
                    readOnly={closed}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}

function CalibrationItem({
  calibrationId,
  item,
  detail,
  readOnly,
}: {
  calibrationId: string;
  item: QaCalibrationItem;
  detail: QaCalibrationDetail;
  readOnly: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const rubric = detail.rubric.criteria;
  const [draft, setDraft] = useState<ScoreDraft>(() => draftFromScores(rubric, item.my_scores));
  const [final, setFinal] = useState<QaFinal | null>(item.my_final);
  const [tried, setTried] = useState(false);
  const score = useMutation({
    mutationFn: () =>
      api.post<QaCalibrationDetail>(
        `/qa/calibrations/${encodeURIComponent(calibrationId)}/scores`,
        { review_id: item.review_id, scores: scoresBody(draft), final },
      ),
    onSuccess: (row) => {
      queryClient.setQueryData(qaKeys.calibration(calibrationId), row);
      void queryClient.invalidateQueries({ queryKey: qaKeys.calibrations });
    },
  });
  const { problems, criticalFail } = draftProblems(rubric, draft, final);

  return (
    <div className="grid gap-4 px-4 pb-4 xl:grid-cols-2">
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap gap-x-4">
          <CopyId kind="thread" value={item.chat_id} />
          <CopyId kind="chat" value={item.thread_id} />
        </span>
        <QaExcerpt excerpt={item.excerpt} restricted={item.excerpt_restricted} />
      </div>
      <form
        aria-label={t('reports.qa.calibration.scoreForm')}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (problems.length > 0) return;
          score.mutate();
        }}
      >
        <QaScoring
          idPrefix={`cal-${item.review_id}`}
          rubric={rubric}
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            score.reset();
            if (final === 'pass' && draftProblems(rubric, next, final).criticalFail) {
              setFinal('fail');
            }
          }}
          final={final}
          onFinal={(next) => {
            setFinal(next);
            score.reset();
          }}
          criticalFail={criticalFail}
          problems={tried ? [...problems, ...serverProblems(score.error)] : []}
          readOnly={readOnly}
        />
        {score.error && (
          <Banner tone="danger">
            {t(qaErrorKey(score.error) ?? errorMessageKey(score.error))}
          </Banner>
        )}
        {!readOnly && (
          <div className="flex items-center justify-end gap-2">
            {score.isSuccess && (
              <span className="mr-auto text-2xs text-success" role="status">
                {t('reports.qa.calibration.saved')}
              </span>
            )}
            <button type="submit" className={primaryButton} disabled={score.isPending}>
              {t('reports.qa.calibration.saveScores')}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

/** Agreement per criterion and each reviewer's deviation. */
function CalibrationReport({ detail }: { detail: QaCalibrationDetail }): ReactElement {
  const t = useTranslate();
  const roster = useAgentRoster(true);
  const report = detail.report!;
  const nameOf = (id: string): string =>
    roster.data?.items.find((member) => member.id === id)?.name ?? id.slice(0, 8);
  const percent = (value: number | null): string =>
    formatRate(value === null ? null : value / 100) ?? '—';
  const labelOf = (key: string, label: string): string => criterionLabel(t, { key, label });

  return (
    <Card>
      <section
        aria-label={t('reports.qa.calibration.report')}
        data-testid="qa-calibration-report"
        className="grid gap-4 px-4 py-3 lg:grid-cols-2"
      >
        <table className="w-full text-left text-xs">
          <caption className="mb-1 text-left text-xs font-semibold">
            {t('reports.qa.calibration.agreement')}
          </caption>
          <thead className="text-2xs uppercase tracking-wide text-content-tertiary">
            <tr>
              <th scope="col" className="py-1 font-medium">
                {t('reports.qa.calibration.criterion')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('reports.qa.calibration.agreementCol')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('reports.qa.calibration.scoredCol')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.criteria.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <td className="py-1">{labelOf(row.key, row.label)}</td>
                <td className="tabular py-1 text-right">{percent(row.agreement_percent)}</td>
                <td className="tabular py-1 text-right">{row.scored}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="w-full text-left text-xs">
          <caption className="mb-1 text-left text-xs font-semibold">
            {t('reports.qa.calibration.reviewers')}
          </caption>
          <thead className="text-2xs uppercase tracking-wide text-content-tertiary">
            <tr>
              <th scope="col" className="py-1 font-medium">
                {t('reports.qa.calibration.reviewer')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('reports.qa.calibration.deviationCol')}
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                {t('reports.qa.calibration.scoredCol')}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.reviewers.map((row) => (
              <tr key={row.reviewer_id} className="border-t border-border">
                <td className="py-1">
                  {nameOf(row.reviewer_id)}
                  {row.outlier && (
                    <span className="ml-1.5 rounded-sm bg-warning/10 px-1 text-2xs text-warning">
                      {t('reports.qa.calibration.outlier')}
                    </span>
                  )}
                </td>
                <td className="tabular py-1 text-right">{percent(row.deviation_percent)}</td>
                <td className="tabular py-1 text-right">{row.scored}</td>
              </tr>
            ))}
            {/* A conversation one person scored says nothing about agreement:
                the report counts only what two or more scored. */}
            {report.reviewers.length === 0 && (
              <tr className="border-t border-border">
                <td colSpan={3} className="py-1 text-content-tertiary">
                  {t('reports.qa.calibration.needsTwo')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </Card>
  );
}
