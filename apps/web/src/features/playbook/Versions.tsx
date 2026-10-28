/**
 * Playbook › Sürümler (tm 316.4 · SiyahTuş analysis AI-20 · ADR-14b §2.10):
 * the agent's versions, newest first — the one in production, the one waiting
 * for review or for its time, the ones it replaced — and what a reviewer does
 * with them: approve (now, or at a time up to 30 days ahead), reject, roll
 * back to an earlier one, and tell any two apart.
 *
 * The approve button says why it is closed before the server would: one's own
 * submission (four eyes), and a compliance change for anyone but the Founder.
 * The server refuses both anyway; the reasons here come from the same rule
 * (`approveBlock`). A rollback publishes a copy of the earlier package as a
 * new version — history is not rewritten and the draft is not touched — so it
 * asks once more before it goes.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { AI_CONFIG_SYSTEM_REVIEW_NOTES } from '@siyahtus/types';
import { Card } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  aiConfigKeys,
  approveBlock,
  canRollBackTo,
  isOpenVersion,
  publishAtFromInput,
  versionDiffPath,
  versionsPath,
  type AiConfigDiffSummary,
  type AiConfigVersion,
  type AiConfigVersionList,
} from './ai-config.js';
import { DiffView } from './DiffView.js';

const button =
  'rounded-md border border-border px-2.5 py-1 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primary =
  'rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const field = 'rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary';

const STATUS_CLASS: Record<AiConfigVersion['status'], string> = {
  published: 'bg-success/10 text-success',
  in_review: 'bg-warning/10 text-warning',
  approved: 'bg-surface-2 text-content-brand',
  superseded: 'bg-surface-2 text-content-secondary',
  rejected: 'bg-danger/10 text-danger',
};

function reviewNoteText(t: TFunction, note: string): string {
  return (AI_CONFIG_SYSTEM_REVIEW_NOTES as readonly string[]).includes(note)
    ? t(`playbook.versions.note.${note}`)
    : note;
}

function linkedVersion(): string | null {
  return new URLSearchParams(window.location.search).get('version');
}

function personName(roster: ReadonlyMap<string, string>, id: string | null, t: TFunction): string {
  if (id === null) return t('playbook.versions.person.system');
  return roster.get(id) ?? t('playbook.versions.person.unknown');
}

export function Versions({
  agentId,
  canReview,
  names,
}: {
  agentId: string;
  /** Holds the AI configuration's write scope — offered approve, reject, rollback. */
  canReview: boolean;
  names?: ReadonlyMap<string, string>;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const list = useInfiniteQuery({
    queryKey: aiConfigKeys.versions(agentId),
    queryFn: ({ pageParam }) => api.get<AiConfigVersionList>(versionsPath(agentId, pageParam)),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  // The shell's roster (`PresenceAvatars`) already holds a name for every member.
  const roster = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>('/agents'),
    staleTime: 60_000,
    retry: false,
  });
  const people = new Map((roster.data?.items ?? []).map((member) => [member.id, member.name]));

  const versions = list.data?.pages.flatMap((page) => page.versions) ?? [];
  const [compare, setCompare] = useState<{ from: string; to: string } | null>(null);

  // `?version=<id>` — the Inbox band and the change history link one version.
  // On the loaded page it is marked; further down the list it is read alone.
  const [linkedId] = useState(linkedVersion);
  const linkedOffPage =
    linkedId !== null && list.isSuccess && !versions.some((v) => v.id === linkedId);
  const linked = useQuery({
    queryKey: [...aiConfigKeys.all, 'version', linkedId],
    queryFn: () =>
      api.get<AiConfigVersion>(`/ai/config/versions/${encodeURIComponent(linkedId ?? '')}`),
    enabled: linkedOffPage,
    retry: false,
  });

  return (
    <section
      aria-label={t('playbook.versions.title')}
      data-testid="ai-versions"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 className="text-sm font-semibold">{t('playbook.versions.title')}</h2>
        <p className="mt-0.5 text-2xs text-content-tertiary">
          {t('playbook.versions.description')}
        </p>
      </div>

      {versions.length > 1 && (
        <CompareForm versions={versions} value={compare} onChange={setCompare} />
      )}
      {compare && compare.from !== compare.to && (
        <CompareResult from={compare.from} to={compare.to} names={names} />
      )}

      {linkedOffPage && linked.data && (
        <ol className="flex flex-col rounded-md border border-brand-500">
          <VersionRow
            version={linked.data}
            canReview={canReview}
            people={people}
            names={names}
            linked
          />
        </ol>
      )}

      {list.isPending ? (
        <ListSkeleton rows={3} />
      ) : list.isError ? (
        <LoadError
          title={t('playbook.versions.loadError')}
          error={list.error}
          onRetry={() => void list.refetch()}
        />
      ) : versions.length === 0 ? (
        <EmptyState
          title={t('playbook.versions.empty.title')}
          description={t('playbook.versions.empty.description')}
        />
      ) : (
        <ol className="flex flex-col divide-y divide-border rounded-md border border-border">
          {versions.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              canReview={canReview}
              people={people}
              names={names}
              linked={version.id === linkedId}
            />
          ))}
        </ol>
      )}

      {list.hasNextPage && (
        <button
          type="button"
          className={`${button} self-start`}
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t('playbook.versions.more')}
        </button>
      )}
    </section>
  );
}

function CompareForm({
  versions,
  value,
  onChange,
}: {
  versions: AiConfigVersion[];
  value: { from: string; to: string } | null;
  onChange: (next: { from: string; to: string } | null) => void;
}): ReactElement {
  const t = useTranslate();
  // Newest is first; the default question is "what did the latest change".
  const [from, setFrom] = useState(value?.from ?? versions[1]!.id);
  const [to, setTo] = useState(value?.to ?? versions[0]!.id);
  return (
    <Card>
      <form
        className="flex flex-wrap items-end gap-3 px-4 py-3"
        aria-label={t('playbook.versions.compare.title')}
        onSubmit={(event) => {
          event.preventDefault();
          onChange({ from, to });
        }}
      >
        <label className="flex flex-col gap-1 text-2xs text-content-secondary">
          {t('playbook.versions.compare.from')}
          <select value={from} onChange={(event) => setFrom(event.target.value)} className={field}>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs text-content-secondary">
          {t('playbook.versions.compare.to')}
          <select value={to} onChange={(event) => setTo(event.target.value)} className={field}>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={button} disabled={from === to}>
          {t('playbook.versions.compare.run')}
        </button>
        {value && (
          <button type="button" className={button} onClick={() => onChange(null)}>
            {t('playbook.versions.compare.close')}
          </button>
        )}
      </form>
    </Card>
  );
}

function CompareResult({
  from,
  to,
  names,
}: {
  from: string;
  to: string;
  names?: ReadonlyMap<string, string>;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const diff = useQuery({
    queryKey: aiConfigKeys.diff(from, to),
    queryFn: () => api.get<AiConfigDiffSummary>(versionDiffPath(from, to)),
  });
  return (
    <Card>
      <div className="px-4 py-3" data-testid="ai-versions-compare">
        {diff.isPending ? (
          <ListSkeleton rows={2} />
        ) : diff.isError ? (
          <LoadError
            title={t('playbook.versions.compare.loadError')}
            error={diff.error}
            onRetry={() => void diff.refetch()}
            compact
          />
        ) : (
          <DiffView diff={diff.data} names={names} />
        )}
      </div>
    </Card>
  );
}

function VersionRow({
  version,
  canReview,
  people,
  names,
  linked = false,
}: {
  version: AiConfigVersion;
  canReview: boolean;
  people: ReadonlyMap<string, string>;
  names?: ReadonlyMap<string, string>;
  /** The version a link opened: marked, its changes shown. */
  linked?: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const accountId = useAuth((s) => s.agent?.account_id ?? '');
  const role = useAuth((s) => s.agent?.role ?? '');
  const me = { accountId, role };
  const [open, setOpen] = useState(linked);
  const [publishAt, setPublishAt] = useState('');
  const [note, setNote] = useState('');
  const [confirmRollback, setConfirmRollback] = useState(false);

  const settle = () => void queryClient.invalidateQueries({ queryKey: aiConfigKeys.all });
  const body = (extra: Record<string, unknown> = {}) => ({
    ...(note.trim() ? { note: note.trim() } : {}),
    ...extra,
  });
  const id = encodeURIComponent(version.id);
  const approve = useMutation({
    mutationFn: () => {
      const at = publishAtFromInput(publishAt);
      return api.post<AiConfigVersion>(
        `/ai/config/versions/${id}/approve`,
        body(at ? { publish_at: at } : {}),
      );
    },
    onSettled: settle,
  });
  const reject = useMutation({
    mutationFn: () => api.post<AiConfigVersion>(`/ai/config/versions/${id}/reject`, body()),
    onSettled: settle,
  });
  const rollback = useMutation({
    mutationFn: () => api.post<AiConfigVersion>(`/ai/config/versions/${id}/rollback`, body()),
    onSuccess: () => setConfirmRollback(false),
    onSettled: settle,
  });

  const blocked = approveBlock(version, me);
  const failed = approve.error ?? reject.error ?? rollback.error;
  const reviewable = canReview && isOpenVersion(version);
  const rollbackable = canReview && canRollBackTo(version);

  return (
    <li
      className={`flex flex-col gap-1.5 px-4 py-3 ${linked ? 'bg-surface-2' : ''}`}
      aria-current={linked ? 'true' : undefined}
      data-testid="ai-version-row"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-baseline gap-2 text-sm">
          <span className="font-semibold">{version.label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-2xs font-medium ${STATUS_CLASS[version.status]}`}
          >
            {t(`playbook.versions.status.${version.status}`)}
          </span>
          {version.touches_compliance && (
            <span className="text-2xs text-warning">{t('playbook.versions.compliance')}</span>
          )}
        </p>
        <time dateTime={version.created_at} className="text-2xs text-content-tertiary">
          {formatDateTime(version.published_at ?? version.created_at) ?? version.created_at}
        </time>
      </div>

      <p className="text-2xs text-content-tertiary">
        {version.submitted_at &&
          t('playbook.versions.submittedBy', {
            name: personName(people, version.submitted_by, t),
          })}
        {version.published_at &&
          ` · ${t('playbook.versions.publishedBy', {
            name: personName(people, version.published_by, t),
          })}`}
        {version.status === 'approved' &&
          version.scheduled_at &&
          ` · ${t('playbook.versions.scheduledAt', {
            at: formatDateTime(version.scheduled_at) ?? version.scheduled_at,
          })}`}
        {version.rollback_of && ` · ${t('playbook.versions.rollbackCopy')}`}
        {version.review_note && ` · ${reviewNoteText(t, version.review_note)}`}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {version.diff_summary && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="text-2xs text-content-brand hover:underline"
          >
            {open
              ? t('playbook.versions.hideChanges')
              : t('playbook.versions.showChanges', { count: version.diff_summary.changes })}
          </button>
        )}
        {rollbackable && !confirmRollback && (
          <button type="button" className={button} onClick={() => setConfirmRollback(true)}>
            {t('playbook.versions.rollback')}
          </button>
        )}
      </div>

      {open && version.diff_summary && <DiffView diff={version.diff_summary} names={names} />}

      {(reviewable || confirmRollback) && (
        <label className="flex flex-col gap-1 text-2xs text-content-secondary">
          {t('playbook.versions.noteLabel')}
          <input
            type="text"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
            className={field}
          />
        </label>
      )}

      {reviewable && (
        <div className="flex flex-wrap items-end gap-2">
          {version.status === 'in_review' && (
            <>
              <label className="flex flex-col gap-1 text-2xs text-content-secondary">
                {t('playbook.versions.publishAt')}
                <input
                  type="datetime-local"
                  value={publishAt}
                  onChange={(event) => setPublishAt(event.target.value)}
                  className={field}
                />
              </label>
              <button
                type="button"
                className={primary}
                disabled={blocked !== null || approve.isPending}
                title={blocked ? t(`playbook.versions.approveBlock.${blocked}`) : undefined}
                onClick={() => approve.mutate()}
              >
                {publishAt
                  ? t('playbook.versions.approveScheduled')
                  : t('playbook.versions.approve')}
              </button>
            </>
          )}
          <button
            type="button"
            className={button}
            disabled={reject.isPending}
            onClick={() => reject.mutate()}
          >
            {version.submitted_by === me.accountId
              ? t('playbook.versions.withdraw')
              : t('playbook.versions.reject')}
          </button>
        </div>
      )}
      {reviewable && version.status === 'in_review' && blocked && (
        <p className="text-2xs text-content-tertiary">
          {t(`playbook.versions.approveBlock.${blocked}`)}
        </p>
      )}

      {confirmRollback && (
        <div
          role="group"
          aria-label={t('playbook.versions.rollbackConfirm.title')}
          className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2"
        >
          <p className="text-2xs text-content-secondary">
            {t('playbook.versions.rollbackConfirm.text', { label: version.label })}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={primary}
              disabled={rollback.isPending}
              onClick={() => rollback.mutate()}
            >
              {t('playbook.versions.rollbackConfirm.confirm', { label: version.label })}
            </button>
            <button type="button" className={button} onClick={() => setConfirmRollback(false)}>
              {t('playbook.versions.rollbackConfirm.cancel')}
            </button>
          </div>
        </div>
      )}

      {rollback.isSuccess && (
        <p role="status" className="text-2xs text-success">
          {t('playbook.versions.rolledBack', { label: rollback.data.label })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(failed))}
        </p>
      )}
    </li>
  );
}
