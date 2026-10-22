/**
 * One cluster of unresolved questions (tm 317.3 · AI-22): what it asks, how
 * often, and what to do about it.
 *
 *   - **The examples are always on the page.** The title is a summary — a
 *     model's, or the lexical labeller's — and either can mislead, so the
 *     newest masked messages sit under it with the numbers that find them in
 *     the inbox (the member's day and the one connection, named through `ids.*`).
 *   - **What to do:** add knowledge (a snippet opened with the questions, a
 *     person writes the answer), add example sentences to a procedure's draft
 *     (AI-03), ignore (still counted, out of the default view), mark fixed
 *     ("after the fix: N" counts from now; five bring it back), fold other
 *     clusters into this one.
 *
 * Reading needs `agents-bot--all:ro`; every move `:rw` (`canEdit`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { UNRESOLVED_ADD_EXAMPLES_MAX, UNRESOLVED_IGNORE_REASON_MAX } from '@siyahtus/types';
import { Card, CardSkeleton, Section } from '../../components/Page.js';
import { CopyId } from '../../components/CopyId.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatCount, formatDateTime, formatLanguage, formatRate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  knowledgeDraftOf,
  unresolvedKeys,
  type AddExamplesResult,
  type KnowledgeProposal,
  type MergeResult,
  type UnresolvedCluster,
  type UnresolvedClusterDetail,
} from './ai-unresolved.js';
import type { Skill } from './types.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const field = 'rounded-md border border-border bg-surface px-2 py-1 text-sm text-content-primary';

export const CLUSTER_STATUS_TONE: Record<UnresolvedCluster['status'], StatusTone> = {
  open: 'warning',
  ignored: 'neutral',
  resolved: 'success',
};

type Panel = 'knowledge' | 'examples' | 'ignore' | 'merge' | null;

export function ClusterDetail({
  agentId,
  clusterId,
  clusters,
  skills,
  canEdit,
  onClose,
}: {
  agentId: string;
  clusterId: string;
  /** The list the cluster came from — the other clusters a merge may fold in. */
  clusters: readonly UnresolvedCluster[];
  skills: readonly Pick<Skill, 'id' | 'name' | 'mode' | 'locked' | 'ai_agent_id'>[];
  canEdit: boolean;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: unresolvedKeys.detail(agentId, clusterId),
    queryFn: () =>
      api.get<UnresolvedClusterDetail>(`/ai/unresolved/clusters/${encodeURIComponent(clusterId)}`),
  });

  const changed = () => {
    void queryClient.invalidateQueries({ queryKey: unresolvedKeys.all(agentId) });
  };
  const id = encodeURIComponent(clusterId);

  const move = useMutation({
    mutationFn: (request: { action: 'ignore' | 'reopen' | 'resolve'; body?: object }) =>
      api.post<UnresolvedCluster>(
        request.action === 'ignore'
          ? `/ai/unresolved/clusters/${id}/ignore`
          : request.action === 'reopen'
            ? `/ai/unresolved/clusters/${id}/reopen`
            : `/ai/unresolved/clusters/${id}/resolve`,
        request.body ?? {},
      ),
    onSuccess: () => {
      setPanel(null);
      setNotice(null);
      changed();
    },
  });

  const suggest = useMutation({
    mutationFn: () =>
      api.post<KnowledgeProposal>(`/ai/unresolved/clusters/${id}/suggest-knowledge`, {}),
  });

  if (detail.isPending) return <CardSkeleton rows={5} />;
  if (detail.isError) {
    return (
      <LoadError
        title={t('playbook.unresolved.detail.loadFailed')}
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const cluster = detail.data;
  const procedures = skills.filter(
    (skill) => skill.ai_agent_id === agentId && skill.mode === 'procedure' && !skill.locked,
  );
  const open = (next: Exclude<Panel, null>) => {
    move.reset();
    setNotice(null);
    if (panel === next) {
      setPanel(null);
      return;
    }
    if (next === 'knowledge') suggest.mutate();
    setPanel(next);
  };

  return (
    <section
      aria-label={t('playbook.unresolved.detail.title', { label: cluster.label })}
      data-testid="unresolved-cluster-detail"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" className={button} onClick={onClose}>
          {t('playbook.unresolved.detail.back')}
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{cluster.label}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-2xs text-content-tertiary">
            <StatusDot
              tone={CLUSTER_STATUS_TONE[cluster.status]}
              label={t(`playbook.unresolved.status.${cluster.status}`)}
            />
            {cluster.is_new && <span>{t('playbook.unresolved.badge.new')}</span>}
            {cluster.suggested_action && (
              <span>
                {t('playbook.unresolved.detail.suggested', {
                  action: t(`playbook.unresolved.action.${cluster.suggested_action}`),
                })}
              </span>
            )}
            <span>{t(`playbook.unresolved.labelSource.${cluster.label_source}`)}</span>
          </p>
          <p className="mt-1 text-2xs text-content-tertiary">
            {t('playbook.unresolved.detail.titleNote')}
          </p>
        </div>
      </div>

      {cluster.status === 'ignored' && (
        <p className="text-xs text-content-secondary">
          {cluster.ignore_reason
            ? t('playbook.unresolved.detail.ignoredBecause', { reason: cluster.ignore_reason })
            : t('playbook.unresolved.detail.ignored')}
        </p>
      )}
      {cluster.status === 'resolved' && (
        <p className="text-xs text-content-secondary">
          {t('playbook.unresolved.detail.resolvedAt', {
            date: formatDateTime(cluster.resolved_at) ?? '',
            count: formatCount(cluster.post_fix_count) ?? '0',
          })}
        </p>
      )}

      <Card>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            [t('playbook.unresolved.col.count7d'), formatCount(cluster.count_7d)],
            [t('playbook.unresolved.col.total'), formatCount(cluster.item_count)],
            [t('playbook.unresolved.col.handoff'), formatRate(cluster.handoff_rate)],
            [t('playbook.unresolved.col.abandon'), formatRate(cluster.abandon_rate)],
            [t('playbook.unresolved.col.firstSeen'), formatDateTime(cluster.first_seen)],
            [t('playbook.unresolved.col.lastSeen'), formatDateTime(cluster.last_seen)],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="text-2xs text-content-tertiary">{term}</dt>
              <dd className="text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-end gap-6 border-t border-border px-4 py-3">
          <div
            role="img"
            aria-label={t('playbook.unresolved.detail.trend', {
              counts: cluster.trend.map((point) => point.count).join(', '),
            })}
            className="flex h-10 items-end gap-0.5"
          >
            {cluster.trend.map((point) => (
              <span
                key={point.date}
                aria-hidden="true"
                title={`${point.date}: ${point.count}`}
                className="w-2 rounded-sm bg-brand-500"
                style={{
                  height: `${Math.max(
                    2,
                    Math.round(
                      (point.count / Math.max(1, ...cluster.trend.map((p) => p.count))) * 40,
                    ),
                  )}px`,
                }}
              />
            ))}
          </div>
          <ul
            aria-label={t('playbook.unresolved.detail.reasons')}
            className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-content-secondary"
          >
            {cluster.reasons.map((entry) => (
              <li key={entry.reason}>
                {t(`playbook.unresolved.reason.${entry.reason}`)} · {formatCount(entry.count)}
              </li>
            ))}
            {cluster.languages.map((entry) => (
              <li key={entry.language ?? 'none'}>
                {(entry.language && formatLanguage(entry.language)) ||
                  t('playbook.unresolved.detail.languageUnknown')}{' '}
                · {formatCount(entry.count)}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {canEdit && (
        <Card>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3">
            <button
              type="button"
              className={panel === 'knowledge' ? primaryButton : button}
              aria-expanded={panel === 'knowledge'}
              onClick={() => open('knowledge')}
            >
              {t('playbook.unresolved.actions.addKnowledge')}
            </button>
            <button
              type="button"
              className={panel === 'examples' ? primaryButton : button}
              aria-expanded={panel === 'examples'}
              onClick={() => open('examples')}
            >
              {t('playbook.unresolved.actions.addExamples')}
            </button>
            <button
              type="button"
              className={panel === 'merge' ? primaryButton : button}
              aria-expanded={panel === 'merge'}
              onClick={() => open('merge')}
            >
              {t('playbook.unresolved.actions.merge')}
            </button>
            {cluster.status !== 'ignored' && (
              <button
                type="button"
                className={panel === 'ignore' ? primaryButton : button}
                aria-expanded={panel === 'ignore'}
                onClick={() => open('ignore')}
              >
                {t('playbook.unresolved.actions.ignore')}
              </button>
            )}
            {cluster.status !== 'resolved' && (
              <button
                type="button"
                className={button}
                disabled={move.isPending}
                onClick={() => move.mutate({ action: 'resolve' })}
              >
                {t('playbook.unresolved.actions.resolve')}
              </button>
            )}
            {cluster.status !== 'open' && (
              <button
                type="button"
                className={button}
                disabled={move.isPending}
                onClick={() => move.mutate({ action: 'reopen' })}
              >
                {t('playbook.unresolved.actions.reopen')}
              </button>
            )}
          </div>
          {move.isError && (
            <p role="alert" className="border-t border-border px-4 py-2 text-2xs text-danger">
              {t(errorMessageKey(move.error))}
            </p>
          )}
          {notice && (
            <p role="status" className="border-t border-border px-4 py-2 text-2xs text-success">
              {notice}
            </p>
          )}
          {panel === 'ignore' && (
            <IgnoreForm
              pending={move.isPending}
              onSubmit={(reason) =>
                move.mutate({ action: 'ignore', body: reason ? { reason } : {} })
              }
            />
          )}
          {panel === 'knowledge' && suggest.isError && (
            <p role="alert" className="border-t border-border px-4 py-3 text-2xs text-danger">
              {t(errorMessageKey(suggest.error))}
            </p>
          )}
          {panel === 'knowledge' && suggest.data && (
            <KnowledgeForm
              agentId={agentId}
              proposal={suggest.data}
              onAdded={() => {
                setPanel(null);
                setNotice(t('playbook.unresolved.knowledge.added'));
                void queryClient.invalidateQueries({ queryKey: ['playbook', 'knowledge'] });
              }}
            />
          )}
          {panel === 'examples' && (
            <ExamplesForm
              clusterId={clusterId}
              sentences={cluster.examples.map((example) => example.text)}
              procedures={procedures}
              onAdded={(result) => {
                setNotice(
                  t('playbook.unresolved.examples.added', {
                    added: result.added.length,
                    skipped: result.skipped,
                  }),
                );
                void queryClient.invalidateQueries({ queryKey: ['playbook'] });
              }}
            />
          )}
          {panel === 'merge' && (
            <MergeForm
              clusterId={clusterId}
              candidates={clusters.filter((other) => other.id !== clusterId)}
              onMerged={(result) => {
                setPanel(null);
                setNotice(t('playbook.unresolved.merge.done', { count: result.absorbed }));
                changed();
              }}
            />
          )}
        </Card>
      )}

      <Section title={t('playbook.unresolved.examples.title')}>
        <Card>
          {cluster.examples.length === 0 ? (
            <EmptyState
              title={t('playbook.unresolved.examples.emptyTitle')}
              description={t('playbook.unresolved.examples.emptyDescription')}
            />
          ) : (
            <ul
              aria-label={t('playbook.unresolved.examples.title')}
              className="divide-y divide-border"
            >
              {cluster.examples.map((example) => (
                <li key={example.id} className="flex flex-col gap-1 px-4 py-3">
                  <p className="text-sm">{example.text}</p>
                  {example.context && (
                    <p className="text-2xs text-content-tertiary">
                      {t('playbook.unresolved.examples.before', { text: example.context })}
                    </p>
                  )}
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-content-tertiary">
                    <span>{t(`playbook.unresolved.reason.${example.reason}`)}</span>
                    <span>{formatDateTime(example.created_at)}</span>
                    {example.language && <span>{formatLanguage(example.language)}</span>}
                    <CopyId kind="thread" value={example.chat_id} />
                    <CopyId kind="chat" value={example.thread_id} />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </section>
  );
}

function IgnoreForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (reason: string) => void;
}): ReactElement {
  const t = useTranslate();
  const [reason, setReason] = useState('');
  return (
    <form
      className="flex flex-col gap-2 border-t border-border px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(reason.trim());
      }}
    >
      <p className="text-2xs text-content-tertiary">{t('playbook.unresolved.ignore.note')}</p>
      <label className="flex flex-col gap-1 text-xs text-content-secondary">
        {t('playbook.unresolved.ignore.reason')}
        <input
          value={reason}
          maxLength={UNRESOLVED_IGNORE_REASON_MAX}
          onChange={(event) => setReason(event.target.value)}
          className={field}
        />
      </label>
      <div>
        <button type="submit" className={primaryButton} disabled={pending}>
          {t('playbook.unresolved.ignore.submit')}
        </button>
      </div>
    </form>
  );
}

/** "Add knowledge": the proposal opens an editor; a person writes the answer and adds the source. */
function KnowledgeForm({
  agentId,
  proposal,
  onAdded,
}: {
  agentId: string;
  proposal: KnowledgeProposal;
  onAdded: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [name, setName] = useState(proposal.title);
  const [content, setContent] = useState(() =>
    knowledgeDraftOf(proposal.questions, {
      questions: t('playbook.unresolved.knowledge.questionsHeading'),
      answer: t('playbook.unresolved.knowledge.answerHeading'),
    }),
  );

  const add = useMutation({
    mutationFn: () =>
      api.post('/knowledge-sources', {
        ai_agent_id: agentId,
        name: name.trim(),
        type: 'article',
        content: content.trim(),
      }),
    onSuccess: onAdded,
  });

  return (
    <form
      className="flex flex-col gap-2 border-t border-border px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <p className="text-2xs text-content-tertiary">{t('playbook.unresolved.knowledge.note')}</p>
      <label className="flex flex-col gap-1 text-xs text-content-secondary">
        {t('playbook.unresolved.knowledge.name')}
        <input
          value={name}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-content-secondary">
        {t('playbook.unresolved.knowledge.content')}
        <textarea
          value={content}
          rows={8}
          onChange={(event) => setContent(event.target.value)}
          className={field}
        />
      </label>
      {add.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(add.error))}
        </p>
      )}
      <div>
        <button
          type="submit"
          className={primaryButton}
          disabled={add.isPending || name.trim() === '' || content.trim() === ''}
        >
          {t('playbook.unresolved.knowledge.submit')}
        </button>
      </div>
    </form>
  );
}

/** "Add example sentences": pick a procedure and some of the cluster's questions. */
function ExamplesForm({
  clusterId,
  sentences,
  procedures,
  onAdded,
}: {
  clusterId: string;
  sentences: readonly string[];
  procedures: readonly Pick<Skill, 'id' | 'name'>[];
  onAdded: (result: AddExamplesResult) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [skillId, setSkillId] = useState(procedures[0]?.id ?? '');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  const add = useMutation({
    mutationFn: () =>
      api.post<AddExamplesResult>(
        `/ai/unresolved/clusters/${encodeURIComponent(clusterId)}/add-examples`,
        { skill_id: skillId, sentences: [...picked] },
      ),
    onSuccess: (result) => {
      setPicked(new Set());
      onAdded(result);
    },
  });

  if (procedures.length === 0) {
    return (
      <p className="border-t border-border px-4 py-3 text-2xs text-content-tertiary">
        {t('playbook.unresolved.examples.noProcedures')}
      </p>
    );
  }
  const toggle = (sentence: string) => {
    const next = new Set(picked);
    if (next.has(sentence)) next.delete(sentence);
    else if (next.size < UNRESOLVED_ADD_EXAMPLES_MAX) next.add(sentence);
    setPicked(next);
  };
  return (
    <form
      className="flex flex-col gap-2 border-t border-border px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <p className="text-2xs text-content-tertiary">
        {t('playbook.unresolved.examples.note', { max: UNRESOLVED_ADD_EXAMPLES_MAX })}
      </p>
      <label className="flex flex-col gap-1 text-xs text-content-secondary">
        {t('playbook.unresolved.examples.procedure')}
        <select
          value={skillId}
          onChange={(event) => setSkillId(event.target.value)}
          className={field}
        >
          {procedures.map((procedure) => (
            <option key={procedure.id} value={procedure.id}>
              {procedure.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs text-content-secondary">
          {t('playbook.unresolved.examples.pick')}
        </legend>
        {sentences.map((sentence) => (
          <label key={sentence} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.has(sentence)}
              onChange={() => toggle(sentence)}
              className="mt-1"
            />
            <span>{sentence}</span>
          </label>
        ))}
      </fieldset>
      {add.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(add.error))}
        </p>
      )}
      <div>
        <button
          type="submit"
          className={primaryButton}
          disabled={add.isPending || picked.size === 0 || skillId === ''}
        >
          {t('playbook.unresolved.examples.submit', { count: picked.size })}
        </button>
      </div>
    </form>
  );
}

/** "Merge": other clusters of the list fold into this one — for good, so it asks. */
function MergeForm({
  clusterId,
  candidates,
  onMerged,
}: {
  clusterId: string;
  candidates: readonly UnresolvedCluster[];
  onMerged: (result: MergeResult) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const merge = useMutation({
    mutationFn: () =>
      api.post<MergeResult>(`/ai/unresolved/clusters/${encodeURIComponent(clusterId)}/merge`, {
        source_ids: [...picked],
      }),
    onSuccess: (result) => {
      setConfirming(false);
      onMerged(result);
    },
  });

  if (candidates.length === 0) {
    return (
      <p className="border-t border-border px-4 py-3 text-2xs text-content-tertiary">
        {t('playbook.unresolved.merge.none')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
      <p className="text-2xs text-content-tertiary">{t('playbook.unresolved.merge.note')}</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs text-content-secondary">
          {t('playbook.unresolved.merge.pick')}
        </legend>
        {candidates.map((candidate) => (
          <label key={candidate.id} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={picked.has(candidate.id)}
              onChange={() => {
                const next = new Set(picked);
                if (next.has(candidate.id)) next.delete(candidate.id);
                else next.add(candidate.id);
                setPicked(next);
              }}
              className="mt-1"
            />
            <span>
              {candidate.label} · {formatCount(candidate.item_count)}
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <button
          type="button"
          className={primaryButton}
          disabled={picked.size === 0}
          onClick={() => {
            merge.reset();
            setConfirming(true);
          }}
        >
          {t('playbook.unresolved.merge.submit', { count: picked.size })}
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={t('playbook.unresolved.merge.confirmTitle')}
          description={t('playbook.unresolved.merge.confirmDescription', { count: picked.size })}
          confirmLabel={t('playbook.unresolved.actions.merge')}
          pending={merge.isPending}
          failure={merge.isError ? t(errorMessageKey(merge.error)) : null}
          onConfirm={() => merge.mutate()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
