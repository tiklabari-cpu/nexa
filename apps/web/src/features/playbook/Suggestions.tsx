/**
 * Playbook › Öneriler (tm 318.2 · SiyahTuş analysis AI-23): the coaching and
 * suggestion queue. Agents mark the AI's messages or offer their own answers
 * (the transcript's message menu); the people who review them — a Team Lead
 * for the teams they lead, an administrator for all — read them here.
 *
 *   - **Left**, the queue: kind, the marked message, when, where it stands.
 *     The badge on the tab is the open count of what the caller reviews
 *     (`ai_suggestion_created` moves it within a second).
 *   - **Right**, one suggestion: the masked excerpt with its identifiers, the
 *     agent's note, the proposal — editable — and what to do with it: accept
 *     into the AI-20 draft (never live), reject (the reason is required),
 *     merge into another, or keep the conversation as a test scenario.
 *   - "The knowledge already has this" is the drafting job's duplicate check:
 *     the answer exists, so the question is why the AI did not find it.
 *
 * Who: whoever may review decides; anyone else sees the suggestions they made
 * and how each ended (the API answers only that much). The tab is not the
 * authority — the routes are.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type ReactElement } from 'react';
import {
  SUGGESTION_BODY_MAX,
  SUGGESTION_LIST_STATUSES,
  SUGGESTION_REVIEW_NOTE_MAX,
  SUGGESTION_SPECIFIC_PLACEHOLDERS,
  SUGGESTION_TARGETS,
  SUGGESTION_TITLE_MAX,
  type SuggestionListStatus,
  type SuggestionTarget,
} from '@siyahtus/types';
import { CopyId } from '../../components/CopyId.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { Card } from '../../components/Page.js';
import { Banner } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  draftOf,
  isOpenSuggestion,
  needsProcedure,
  proposalBody,
  proposalIssue,
  sameProposal,
  suggestionKeys,
  suggestionListPath,
  type AiSuggestion,
  type AiSuggestionList,
  type ProposalDraft,
} from './ai-suggestions.js';
import type { Skill } from './types.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const field = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary';

const STATUS_CLASS: Record<AiSuggestion['status'], string> = {
  new: 'bg-warning/10 text-warning',
  drafting: 'bg-surface-2 text-content-secondary',
  in_review: 'bg-warning/10 text-warning',
  accepted: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
  merged: 'bg-surface-2 text-content-secondary',
};

/** The procedure targets name the procedure they change: only a list of them can be picked from. */
const PROCEDURE_TARGETS: readonly SuggestionTarget[] = ['procedure_example', 'procedure_note'];

export function Suggestions({
  skills = [],
  canReview,
}: {
  /** The AI agent's procedures — what `procedure_example` / `procedure_note` change. */
  skills?: readonly Pick<Skill, 'id' | 'name' | 'mode'>[];
  /** Holds the review capability (the routes decide; this decides what is drawn). */
  canReview: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [status, setStatus] = useState<SuggestionListStatus>('open');
  const [mine, setMine] = useState(!canReview);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: suggestionKeys.list(status, mine),
    queryFn: () => api.get<AiSuggestionList>(suggestionListPath(status, mine)),
  });
  const suggestions = list.data?.suggestions ?? [];
  const opened = openId ? (suggestions.find((row) => row.id === openId) ?? null) : null;

  return (
    <section
      aria-label={t('playbook.suggestions.title')}
      data-testid="ai-suggestions"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-sm font-semibold">{t('playbook.suggestions.title')}</h2>
        <p className="mt-0.5 text-2xs text-content-tertiary">
          {canReview
            ? t('playbook.suggestions.description')
            : t('playbook.suggestions.descriptionMine')}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <form
            className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3"
            aria-label={t('playbook.suggestions.filters')}
            onSubmit={(event) => event.preventDefault()}
          >
            <label className="flex flex-col gap-1 text-2xs text-content-secondary">
              {t('playbook.suggestions.statusFilter')}
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as SuggestionListStatus);
                  setOpenId(null);
                }}
                className={field}
              >
                {SUGGESTION_LIST_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`playbook.suggestions.statusOption.${value}`)}
                  </option>
                ))}
              </select>
            </label>
            {canReview && (
              <label className="flex items-center gap-1.5 pb-1 text-2xs text-content-secondary">
                <input
                  type="checkbox"
                  checked={mine}
                  onChange={(event) => {
                    setMine(event.target.checked);
                    setOpenId(null);
                  }}
                />
                {t('playbook.suggestions.mineOnly')}
              </label>
            )}
            {list.data && (
              <p className="ml-auto pb-1 text-2xs text-content-tertiary" aria-live="polite">
                {t('playbook.suggestions.count', { count: list.data.total })}
              </p>
            )}
          </form>

          {list.isPending ? (
            <ListSkeleton rows={4} />
          ) : list.isError ? (
            <LoadError
              compact
              title={t('playbook.suggestions.loadError')}
              error={list.error}
              onRetry={() => void list.refetch()}
            />
          ) : suggestions.length === 0 ? (
            <EmptyState
              title={t('playbook.suggestions.emptyTitle')}
              description={t('playbook.suggestions.emptyDescription')}
            />
          ) : (
            <ul>
              {suggestions.map((row) => (
                <li key={row.id} className="border-b border-border last:border-0">
                  <button
                    type="button"
                    aria-current={row.id === openId ? 'true' : undefined}
                    data-testid="ai-suggestion-row"
                    onClick={() => setOpenId(row.id)}
                    className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
                      row.id === openId ? 'bg-surface-2' : ''
                    }`}
                  >
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">
                        {t(`playbook.suggestions.kind.${row.kind}`)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-2xs font-medium ${STATUS_CLASS[row.status]}`}
                      >
                        {t(`playbook.suggestions.status.${row.status}`)}
                      </span>
                    </span>
                    <span className="line-clamp-2 break-words text-xs text-content-secondary">
                      {markedText(row) ?? row.proposed_change?.title ?? row.note ?? '—'}
                    </span>
                    <span className="text-2xs text-content-tertiary">
                      {formatDateTime(row.created_at)}
                      {row.already_known && ` · ${t('playbook.suggestions.alreadyKnownTag')}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div>
          {opened ? (
            <SuggestionDetail
              key={opened.id}
              initial={opened}
              others={suggestions.filter((row) => row.id !== opened.id && isOpenSuggestion(row))}
              skills={skills}
              canReview={canReview}
            />
          ) : (
            <Card>
              <EmptyState
                title={t('playbook.suggestions.pickTitle')}
                description={t('playbook.suggestions.pickDescription')}
              />
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

/** The marked message of the excerpt, or the last one when none is marked. */
function markedText(row: AiSuggestion): string | null {
  const marked = row.excerpt.find((message) => message.marked) ?? row.excerpt.at(-1);
  return marked?.text ?? null;
}

function SuggestionDetail({
  initial,
  others,
  skills,
  canReview,
}: {
  initial: AiSuggestion;
  others: readonly AiSuggestion[];
  skills: readonly Pick<Skill, 'id' | 'name' | 'mode'>[];
  canReview: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const id = initial.id;
  const detail = useQuery({
    queryKey: suggestionKeys.detail(id),
    queryFn: () => api.get<AiSuggestion>(`/ai/suggestions/${encodeURIComponent(id)}`),
    initialData: initial,
    // The list row is as fresh as the list; the drafting job fills the proposal later.
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.status === 'drafting' ? 3_000 : false),
  });
  const suggestion = detail.data;

  const [draft, setDraft] = useState<ProposalDraft | null>(() => draftOf(initial));
  // The drafting job wrote its proposal while the pane was open: take it once.
  const arrived = suggestion.proposed_change !== null;
  useEffect(() => {
    if (arrived) setDraft((current) => current ?? draftOf(suggestion));
  }, [arrived, suggestion]);

  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const [done, setDone] = useState<'accepted' | 'scenario' | null>(null);
  const [scenarioName, setScenarioName] = useState<string | null>(null);
  const noteId = useId();

  const settle = (row: AiSuggestion): void => {
    queryClient.setQueryData(suggestionKeys.detail(id), row);
    void queryClient.invalidateQueries({ queryKey: suggestionKeys.all });
  };
  const review = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch<AiSuggestion>(`/ai/suggestions/${encodeURIComponent(id)}`, body),
    onSuccess: settle,
  });
  const toScenario = useMutation({
    mutationFn: () =>
      api.post<{ id: string; name: string }>(
        `/ai/suggestions/${encodeURIComponent(id)}/to-scenario`,
        {},
      ),
    onSuccess: (scenario) => {
      setScenarioName(scenario.name);
      setDone('scenario');
    },
  });

  const closed = !isOpenSuggestion(suggestion);
  const reviewable = canReview && !closed;
  const issue = draft ? proposalIssue(draft) : null;
  const dirty = draft !== null && !sameProposal(draft, suggestion.proposed_change);
  const failed = review.error ?? toScenario.error;
  const busy = review.isPending || toScenario.isPending;
  const changeKind = draft?.target ?? null;
  const procedureChoices = skills.filter((skill) => skill.mode === 'procedure');
  const targets = SUGGESTION_TARGETS.filter(
    (target) =>
      !PROCEDURE_TARGETS.includes(target) ||
      procedureChoices.length > 0 ||
      draft?.target === target,
  );

  const act = (action: 'edit' | 'accept'): void => {
    if (!draft) return;
    setDone(null);
    review.mutate(
      { action, proposed_change: proposalBody(draft) },
      { onSuccess: () => action === 'accept' && setDone('accepted') },
    );
  };

  return (
    <Card>
      <article
        aria-label={t(`playbook.suggestions.kind.${suggestion.kind}`)}
        data-testid="ai-suggestion-detail"
        className="flex flex-col gap-4 px-4 py-4"
      >
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {t(`playbook.suggestions.kind.${suggestion.kind}`)}
          </h3>
          <span
            className={`rounded px-1.5 py-0.5 text-2xs font-medium ${STATUS_CLASS[suggestion.status]}`}
          >
            {t(`playbook.suggestions.status.${suggestion.status}`)}
          </span>
        </header>

        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {suggestion.chat_id && <CopyId kind="thread" value={suggestion.chat_id} />}
          {suggestion.thread_id && <CopyId kind="chat" value={suggestion.thread_id} />}
          <span className="text-2xs text-content-tertiary">
            {t(`playbook.suggestions.source.${suggestion.source}`)} ·{' '}
            {formatDateTime(suggestion.created_at)}
          </span>
        </div>

        {suggestion.excerpt.length > 0 && (
          <section aria-label={t('playbook.suggestions.excerpt')} className="flex flex-col gap-1.5">
            <p className="text-2xs font-medium text-content-secondary">
              {t('playbook.suggestions.excerpt')}
            </p>
            <ol className="flex flex-col gap-1.5">
              {suggestion.excerpt.map((message) => (
                <li
                  key={message.event_id}
                  data-marked={message.marked ? 'true' : undefined}
                  className={`rounded-md border px-2.5 py-1.5 text-xs ${
                    message.marked ? 'border-brand-500 bg-brand-500/10' : 'border-border'
                  }`}
                >
                  <span className="mr-1.5 font-medium">
                    {message.is_ai
                      ? t('playbook.suggestions.author.ai')
                      : t(`playbook.suggestions.author.${message.author_type}`)}
                  </span>
                  <span className="tabular text-content-tertiary">
                    {formatDateTime(message.created_at)}
                  </span>
                  {message.marked && (
                    <span className="ml-1.5 rounded-sm bg-surface-2 px-1 text-2xs">
                      {t('playbook.suggestions.marked')}
                    </span>
                  )}
                  <p className="mt-0.5 whitespace-pre-wrap break-words">{message.text}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {suggestion.note && (
          <p className="text-xs">
            <span className="font-medium">{t('playbook.suggestions.note')}: </span>
            <span className="break-words">{suggestion.note}</span>
          </p>
        )}

        {suggestion.already_known && (
          <Banner tone="warning" title={t('playbook.suggestions.alreadyKnownTitle')}>
            {t('playbook.suggestions.alreadyKnownBody', {
              sources:
                suggestion.similar_sources.map((source) => source.source_name).join(', ') || '—',
            })}
          </Banner>
        )}

        <section aria-label={t('playbook.suggestions.proposal')} className="flex flex-col gap-2">
          <p className="text-2xs font-medium text-content-secondary">
            {t('playbook.suggestions.proposal')}
          </p>
          {suggestion.status === 'drafting' && (
            <p className="text-xs text-content-tertiary" role="status">
              {t('playbook.suggestions.drafting')}
            </p>
          )}
          {suggestion.removed_specifics.length > 0 && (
            <p className="text-2xs text-content-tertiary">
              {t('playbook.suggestions.removed', {
                list: suggestion.removed_specifics
                  .map((kind) => SUGGESTION_SPECIFIC_PLACEHOLDERS[kind])
                  .join(' '),
              })}
            </p>
          )}

          {draft === null ? (
            suggestion.status !== 'drafting' && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-content-tertiary">
                  {t('playbook.suggestions.noProposal')}
                </p>
                {reviewable && (
                  <button
                    type="button"
                    className={`${button} self-start`}
                    onClick={() =>
                      setDraft({
                        target: 'knowledge_snippet',
                        title: '',
                        body: '',
                        source_id: null,
                      })
                    }
                  >
                    {t('playbook.suggestions.writeProposal')}
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-2xs text-content-secondary">
                {t('playbook.suggestions.target')}
                <select
                  value={draft.target}
                  disabled={!reviewable}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      target: event.target.value as SuggestionTarget,
                      source_id: null,
                    })
                  }
                  className={field}
                >
                  {targets.map((target) => (
                    <option key={target} value={target}>
                      {t(`playbook.suggestions.targetOption.${target}`)}
                    </option>
                  ))}
                </select>
              </label>
              {changeKind && PROCEDURE_TARGETS.includes(changeKind) && (
                <label className="flex flex-col gap-1 text-2xs text-content-secondary">
                  {t('playbook.suggestions.procedure')}
                  <select
                    value={draft.source_id ?? ''}
                    disabled={!reviewable}
                    onChange={(event) =>
                      setDraft({ ...draft, source_id: event.target.value || null })
                    }
                    className={field}
                  >
                    <option value="">{t('playbook.suggestions.procedurePick')}</option>
                    {procedureChoices.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-2xs text-content-secondary">
                {t('playbook.suggestions.titleLabel')}
                <input
                  value={draft.title}
                  maxLength={SUGGESTION_TITLE_MAX}
                  readOnly={!reviewable}
                  onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1 text-2xs text-content-secondary">
                {t('playbook.suggestions.bodyLabel')}
                <textarea
                  value={draft.body}
                  maxLength={SUGGESTION_BODY_MAX}
                  readOnly={!reviewable}
                  rows={6}
                  onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  className={`${field} resize-y`}
                />
              </label>
            </div>
          )}
        </section>

        {closed && (
          <p className="text-xs" data-testid="ai-suggestion-outcome">
            {t(`playbook.suggestions.outcome.${suggestion.status}`)}
            {suggestion.review_note && (
              <>
                {' '}
                <span className="break-words text-content-secondary">
                  {t('playbook.suggestions.outcomeNote', { note: suggestion.review_note })}
                </span>
              </>
            )}
          </p>
        )}

        {done === 'accepted' && (
          <Banner tone="success" role="status">
            {t('playbook.suggestions.acceptedDone')}
          </Banner>
        )}
        {done === 'scenario' && (
          <Banner tone="success" role="status">
            {t('playbook.suggestions.scenarioDone', { name: scenarioName ?? '' })}
          </Banner>
        )}
        {failed && <Banner tone="danger">{t(errorMessageKey(failed))}</Banner>}

        {reviewable && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {draft && issue !== null && (
              <p className="text-2xs text-content-tertiary">
                {t(`playbook.suggestions.issue.${issue}`)}
              </p>
            )}
            {draft && needsProcedure(draft) && (
              <p className="text-2xs text-content-tertiary">
                {t('playbook.suggestions.issue.procedure')}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButton}
                disabled={busy || draft === null || issue !== null || needsProcedure(draft)}
                onClick={() => act('accept')}
              >
                {t('playbook.suggestions.accept')}
              </button>
              <button
                type="button"
                className={button}
                disabled={busy || draft === null || issue !== null || !dirty}
                onClick={() => act('edit')}
              >
                {t('playbook.suggestions.saveEdit')}
              </button>
              <button
                type="button"
                className={button}
                disabled={busy || suggestion.chat_id === null}
                onClick={() => {
                  setDone(null);
                  toScenario.mutate();
                }}
              >
                {t('playbook.suggestions.toScenario')}
              </button>
              <button
                type="button"
                className={button}
                aria-expanded={rejecting}
                disabled={busy}
                onClick={() => setRejecting((open) => !open)}
              >
                {t('playbook.suggestions.reject')}
              </button>
            </div>

            {rejecting && (
              <form
                className="flex flex-col gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  const note = rejectNote.trim();
                  if (note) review.mutate({ action: 'reject', review_note: note });
                }}
              >
                <label htmlFor={noteId} className="text-2xs text-content-secondary">
                  {t('playbook.suggestions.rejectNote')}
                </label>
                <textarea
                  id={noteId}
                  value={rejectNote}
                  maxLength={SUGGESTION_REVIEW_NOTE_MAX}
                  rows={2}
                  required
                  onChange={(event) => setRejectNote(event.target.value)}
                  className={`${field} resize-y`}
                />
                <button
                  type="submit"
                  className={`${button} self-start`}
                  disabled={busy || rejectNote.trim().length === 0}
                >
                  {t('playbook.suggestions.rejectConfirm')}
                </button>
              </form>
            )}

            {others.length > 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-2xs text-content-secondary">
                  {t('playbook.suggestions.mergeInto')}
                  <select
                    value={mergeInto}
                    onChange={(event) => setMergeInto(event.target.value)}
                    className={field}
                  >
                    <option value="">{t('playbook.suggestions.mergePick')}</option>
                    {others.map((other) => (
                      <option key={other.id} value={other.id}>
                        {t(`playbook.suggestions.kind.${other.kind}`)} ·{' '}
                        {(markedText(other) ?? other.proposed_change?.title ?? '—').slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className={button}
                  disabled={busy || mergeInto === ''}
                  onClick={() => review.mutate({ action: 'merge', duplicate_of: mergeInto })}
                >
                  {t('playbook.suggestions.merge')}
                </button>
              </div>
            )}
          </div>
        )}
      </article>
    </Card>
  );
}
