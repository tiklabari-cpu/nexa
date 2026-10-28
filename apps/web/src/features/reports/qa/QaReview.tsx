/**
 * Raporlar › AI Kalite › one review (tm 319.3 · SiyahTuş analysis AI-24) —
 * `/app/reports/ai-quality/<id>`, three panes:
 *
 *   - **Conversation** — the masked excerpt kept when it was queued (the AI's
 *     part and the first human messages after a hand-over).
 *   - **Decision trail** (ID-09) — each AI turn's decision, the guardrails
 *     that checked it, its hand-overs and risk flags: ids and codes, while
 *     the connection's trail is kept.
 *   - **Rubric** — the reviewer's scores. The model's pre-score sits beside
 *     each criterion with the messages it cites; "Use the pre-score" fills
 *     what is not scored yet, and confirms nothing: each critical criterion
 *     is ticked by the person, one by one, before the review completes.
 *
 * Who: the routes decide (`ai.qa.review`, the teams a lead leads — anything
 * else is a 404). Scoring needs the review claimed by the caller: "Claim"
 * here, or "Review" in the queue. A completed critical failure opens an AI-23
 * suggestion and an AI-19 scenario draft; the pane links to both.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QA_COMMENTS_MAX, type QaFinal } from '@siyahtus/types';
import { CopyId } from '../../../components/CopyId.js';
import { LoadError } from '../../../components/LoadError.js';
import { Card, CardSkeleton, Page } from '../../../components/Page.js';
import { Banner } from '../../../components/ui/index.js';
import { errorMessageKey } from '../../../lib/api-client.js';
import { useApiClient, useAuth } from '../../../lib/auth-store.js';
import { formatDateTime } from '../../../lib/format.js';
import { useTranslate } from '../../../lib/i18n.js';
import { QaExcerpt } from './QaExcerpt.js';
import { QaScoring } from './QaScoring.js';
import {
  QA_PATH,
  draftFromScores,
  draftProblems,
  draftWithPrescore,
  qaErrorKey,
  qaKeys,
  refreshQaLists,
  scoresBody,
  serverProblems,
  type QaReviewDetail,
  type ScoreDraft,
} from './qa.js';
import { QaReasonChips, QaStatusBadge } from './QaQueue.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

/** `/app/reports/ai-quality/:reviewId`. */
export function QaReviewPage(): ReactElement {
  const t = useTranslate();
  const { reviewId = '' } = useParams();
  const api = useApiClient();
  const review = useQuery({
    queryKey: qaKeys.review(reviewId),
    queryFn: () => api.get<QaReviewDetail>(`/qa/reviews/${encodeURIComponent(reviewId)}`),
  });

  return (
    <Page
      title={t('reports.qa.review.title')}
      description={t('reports.qa.review.description')}
      actions={
        <Link to={QA_PATH} className={button}>
          {t('reports.qa.review.back')}
        </Link>
      }
    >
      {review.isPending ? (
        <CardSkeleton rows={6} />
      ) : review.isError ? (
        <LoadError
          title={t('reports.qa.review.loadError')}
          error={review.error}
          onRetry={() => void review.refetch()}
        />
      ) : (
        <QaReviewBody key={review.data.id} review={review.data} />
      )}
    </Page>
  );
}

function QaReviewBody({ review }: { review: QaReviewDetail }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const me = useAuth((s) => s.agent?.account_id ?? null);
  const formId = useId();
  const commentsId = useId();
  const rubric = review.rubric.criteria;

  const [draft, setDraft] = useState<ScoreDraft>(() => draftFromScores(rubric, review.scores));
  const [final, setFinal] = useState<QaFinal | null>(review.final);
  const [comments, setComments] = useState(review.comments ?? '');
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [triedComplete, setTriedComplete] = useState(false);
  const [saved, setSaved] = useState<'save' | 'complete' | null>(null);

  const settle = (row: QaReviewDetail): void => {
    queryClient.setQueryData(qaKeys.review(row.id), row);
    refreshQaLists(queryClient);
  };
  const claim = useMutation({
    mutationFn: () =>
      api.post<QaReviewDetail>(`/qa/reviews/${encodeURIComponent(review.id)}/claim`, {}),
    onSuccess: settle,
  });
  const update = useMutation({
    mutationFn: (action: 'save' | 'complete' | 'release') =>
      api.put<QaReviewDetail>(`/qa/reviews/${encodeURIComponent(review.id)}`, {
        action,
        scores: scoresBody(draft),
        ...(action === 'complete' && final ? { final } : {}),
        comments: comments.trim() === '' ? null : comments,
      }),
    onSuccess: (row, action) => {
      settle(row);
      setSaved(action === 'release' ? null : action);
    },
  });

  const holding = review.status === 'in_review' && review.assigned_to === me;
  const completed = review.status === 'completed';
  const { problems, criticalFail } = draftProblems(rubric, draft, final);
  const shownProblems = triedComplete
    ? [...problems, ...serverProblems(update.error)]
    : serverProblems(update.error);
  const failure = claim.error ?? update.error;
  const busy = claim.isPending || update.isPending;

  const changeDraft = (next: ScoreDraft): void => {
    setDraft(next);
    setSaved(null);
    // A critical criterion that fails makes the verdict a fail (AI-24 §4).
    if (final === 'pass' && draftProblems(rubric, next, final).criticalFail) setFinal('fail');
  };

  return (
    <div className="flex flex-col gap-4" data-testid="qa-review">
      <Card>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <QaStatusBadge status={review.status} />
          <CopyId kind="thread" value={review.chat_id} />
          <CopyId kind="chat" value={review.thread_id} />
          <QaReasonChips reasons={review.reasons} />
          <span className="text-2xs text-content-tertiary">
            {t(`reports.qa.priority.${review.priority}`)} ·{' '}
            {t('reports.qa.queue.due', { at: formatDateTime(review.due_at) ?? '—' })}
            {review.overdue && !completed && (
              <span className="ml-1.5 font-medium text-danger">
                {t('reports.qa.queue.overdue')}
              </span>
            )}
          </span>
          {review.rubric.version !== null && (
            <span className="text-2xs text-content-tertiary">
              {t('reports.qa.review.rubricVersion', { version: String(review.rubric.version) })}
            </span>
          )}
        </div>
      </Card>

      {failure && (
        <Banner tone="danger">{t(qaErrorKey(failure) ?? errorMessageKey(failure))}</Banner>
      )}

      {completed && <CompletedOutcome review={review} />}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
        <Pane label={t('reports.qa.review.conversation')}>
          <QaExcerpt
            excerpt={review.excerpt}
            restricted={review.excerpt_restricted}
            highlighted={highlighted}
          />
        </Pane>

        <Pane label={t('reports.qa.review.trail')}>
          <DecisionTrail review={review} />
        </Pane>

        <Pane label={t('reports.qa.review.rubric')}>
          {review.status === 'pending_prescore' && (
            <p className="text-xs text-content-tertiary" role="status">
              {t('reports.qa.review.pendingPrescore')}
            </p>
          )}
          {review.status === 'ready' && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-content-secondary">{t('reports.qa.review.claimFirst')}</p>
              <button
                type="button"
                className={`${primaryButton} self-start`}
                disabled={busy}
                onClick={() => claim.mutate()}
              >
                {t('reports.qa.review.claim')}
              </button>
            </div>
          )}
          {review.status === 'in_review' && !holding && (
            <p className="text-xs text-content-secondary">{t('reports.qa.review.heldByOther')}</p>
          )}

          {(holding || completed) && (
            <form
              id={formId}
              aria-label={t('reports.qa.review.rubric')}
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                setTriedComplete(true);
                if (problems.length > 0) return;
                update.mutate('complete');
              }}
            >
              {review.prescore && holding && (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-2xs text-content-secondary">
                  <span>
                    {t('reports.qa.prescore.overall', {
                      value: t(`reports.qa.final.${review.prescore.overall}`),
                    })}
                  </span>
                  <button
                    type="button"
                    className={button}
                    onClick={() => changeDraft(draftWithPrescore(rubric, draft, review.prescore!))}
                  >
                    {t('reports.qa.prescore.use')}
                  </button>
                  <span>{t('reports.qa.prescore.neverConfirms')}</span>
                </div>
              )}
              {!review.prescore && holding && (
                <p className="text-2xs text-content-tertiary">{t('reports.qa.prescore.none')}</p>
              )}

              <QaScoring
                idPrefix={`qa-${review.id}`}
                rubric={rubric}
                draft={draft}
                onChange={changeDraft}
                final={final}
                onFinal={(next) => {
                  setFinal(next);
                  setSaved(null);
                }}
                criticalFail={criticalFail}
                problems={shownProblems}
                prescore={holding ? review.prescore : null}
                onEvidence={setHighlighted}
                readOnly={!holding}
              />

              <div className="flex flex-col gap-1">
                <label htmlFor={commentsId} className="text-2xs text-content-secondary">
                  {t('reports.qa.review.comments')}
                </label>
                <textarea
                  id={commentsId}
                  value={comments}
                  rows={3}
                  maxLength={QA_COMMENTS_MAX}
                  readOnly={!holding}
                  onChange={(event) => {
                    setComments(event.target.value);
                    setSaved(null);
                  }}
                  className="resize-y rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary"
                />
              </div>

              {holding && (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {saved === 'save' && (
                    <span className="mr-auto text-2xs text-success" role="status">
                      {t('reports.qa.review.saved')}
                    </span>
                  )}
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => update.mutate('release')}
                  >
                    {t('reports.qa.review.release')}
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() => update.mutate('save')}
                  >
                    {t('reports.qa.review.save')}
                  </button>
                  <button type="submit" className={primaryButton} disabled={busy}>
                    {t('reports.qa.review.complete')}
                  </button>
                </div>
              )}
              {holding && triedComplete && problems.length > 0 && (
                <p className="text-2xs text-danger" role="alert">
                  {t('reports.qa.review.incomplete', { count: problems.length })}
                </p>
              )}
            </form>
          )}
        </Pane>
      </div>
    </div>
  );
}

function Pane({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <Card>
      <section aria-label={label} className="flex flex-col gap-3 px-4 py-3">
        <p className="text-xs font-semibold">{label}</p>
        {children}
      </section>
    </Card>
  );
}

/** What a completed review decided, and what a critical failure opened. */
function CompletedOutcome({ review }: { review: QaReviewDetail }): ReactElement {
  const t = useTranslate();
  const { suggestion_id: suggestion, scenario_id: scenario } = review.follow_ups;
  return (
    <Banner
      tone={review.final === 'pass' ? 'success' : 'warning'}
      role="status"
      title={t(
        review.critical_fail
          ? 'reports.qa.outcome.criticalFail'
          : review.final === 'pass'
            ? 'reports.qa.outcome.passed'
            : 'reports.qa.outcome.failed',
      )}
    >
      <span data-testid="qa-review-outcome" className="flex flex-col gap-1">
        <span>
          {t('reports.qa.outcome.reviewedAt', { at: formatDateTime(review.reviewed_at) ?? '—' })}
        </span>
        {review.follow_ups.mandatory_handoff_violation && (
          <span>{t('reports.qa.outcome.mandatoryHandoff')}</span>
        )}
        {(suggestion || scenario) && (
          <span className="flex flex-wrap gap-3">
            {suggestion && (
              <Link
                to="/app/playbook?view=suggestions"
                className="font-medium text-content-brand underline"
              >
                {t('reports.qa.outcome.suggestion')}
              </Link>
            )}
            {scenario && (
              <Link
                to="/app/playbook?view=test"
                className="font-medium text-content-brand underline"
              >
                {t('reports.qa.outcome.scenario')}
              </Link>
            )}
          </span>
        )}
      </span>
    </Banner>
  );
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.map(String).join(', ');
  return String(value);
}

/** The decision trail (ID-09): codes and ids, oldest first. */
function DecisionTrail({ review }: { review: QaReviewDetail }): ReactElement {
  const t = useTranslate();
  const { decisions, guardrail_hits: hits, handoffs, risk_flags: flags } = review.trace;
  if (decisions.length + hits.length + handoffs.length + flags.length === 0) {
    return <p className="text-xs text-content-tertiary">{t('reports.qa.trail.empty')}</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-xs">
      {decisions.length > 0 && (
        <TrailList title={t('reports.qa.trail.decisions')}>
          {decisions.map((row, index) => (
            <li key={text(row['id']) + index} className="rounded-md border border-border px-2 py-1">
              <span className="font-medium">{text(row['decision'])}</span>
              <span className="ml-1.5 tabular text-content-tertiary">
                {formatDateTime(text(row['created_at']))}
              </span>
              <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-2xs text-content-secondary">
                {row['step'] != null && (
                  <>
                    <dt>{t('reports.qa.trail.step')}</dt>
                    <dd>{text(row['step'])}</dd>
                  </>
                )}
                {row['procedure_version'] != null && (
                  <>
                    <dt>{t('reports.qa.trail.procedure')}</dt>
                    <dd>{`v${text(row['procedure_version'])}`}</dd>
                  </>
                )}
                {row['handoff_reason'] != null && (
                  <>
                    <dt>{t('reports.qa.trail.handoffReason')}</dt>
                    <dd>{text(row['handoff_reason'])}</dd>
                  </>
                )}
                <dt>{t('reports.qa.trail.sources')}</dt>
                <dd>
                  {Array.isArray(row['knowledge_source_ids'])
                    ? row['knowledge_source_ids'].length
                    : 0}
                </dd>
              </dl>
            </li>
          ))}
        </TrailList>
      )}
      {hits.length > 0 && (
        <TrailList title={t('reports.qa.trail.guardrails')}>
          {hits.map((row, index) => (
            <li key={index} className="rounded-md border border-border px-2 py-1">
              <span className="font-medium">{text(row['rule_key'])}</span>
              <span className="ml-1.5 text-2xs text-content-secondary">
                {text(row['stage'])} · {text(row['action_taken'])}
              </span>
            </li>
          ))}
        </TrailList>
      )}
      {handoffs.length > 0 && (
        <TrailList title={t('reports.qa.trail.handoffs')}>
          {handoffs.map((row, index) => (
            <li key={text(row['id']) + index} className="rounded-md border border-border px-2 py-1">
              <span className="font-medium">{text(row['primary_reason'])}</span>
              <span className="ml-1.5 text-2xs text-content-secondary">
                {text(row['reason_codes'])}
                {row['accepted_at'] ? ` · ${t('reports.qa.trail.accepted')}` : ''}
              </span>
            </li>
          ))}
        </TrailList>
      )}
      {flags.length > 0 && (
        <TrailList title={t('reports.qa.trail.riskFlags')}>
          {flags.map((row, index) => (
            <li key={index} className="rounded-md border border-border px-2 py-1">
              <span className="font-medium">{text(row['type'])}</span>
              <span className="ml-1.5 text-2xs text-content-secondary">
                {text(row['severity'])} · {text(row['status'])}
              </span>
            </li>
          ))}
        </TrailList>
      )}
    </div>
  );
}

function TrailList({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-2xs font-medium text-content-secondary">{title}</p>
      <ol className="flex flex-col gap-1">{children}</ol>
    </div>
  );
}
