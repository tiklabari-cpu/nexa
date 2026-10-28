/**
 * The Playbook's version bar (tm 316.4 · SiyahTuş analysis AI-20 · ADR-14b
 * §2.10): what the AI answers from and how far the draft has moved from it —
 * "Yayında v12 · Taslak 7 değişiklik" — with the three ways on: see the
 * changes, test them (the Test tab's pre-publish run), send them for review.
 *
 * "Onaya gönder" is closed until the server says the draft is submittable,
 * and the bar says why: nothing changed, the draft does not compile (its
 * problems listed) or the compliance pack has not passed for this revision.
 * A version already waiting is replaced by a new submission, and the bar says
 * so before the click. The submission carries the revision the bar
 * was drawn from (`If-Match`), so a save somebody made since is a 409 to
 * reload, not a submission nobody here saw.
 *
 * `DraftStrip` is the editing screens' reminder of the same thing: what is
 * written here is the draft; the live AI keeps the published version until a
 * new one is approved.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  aiConfigKeys,
  draftPath,
  ifMatch,
  isAiConfigDraft,
  submitBlock,
  type AiConfigDraft,
  type AiConfigSubmission,
  type AiConfigVersion,
  type SubmitBlock,
} from './ai-config.js';
import { DiffView } from './DiffView.js';

const button =
  'rounded-md border border-border px-2.5 py-1 text-2xs font-medium text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primary =
  'rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

/** The draft, read once per page (the bar and the strip share the query). */
/**
 * The editors save through many endpoints and invalidate their own keys, not
 * this one; every one of those saves may move the draft. So the bar reads the
 * draft again after any mutation on the page succeeds — one cheap read, and no
 * editor has to know the bar exists.
 */
function useDraftFollowsSaves(agentId: string): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      queryClient.getMutationCache().subscribe((event) => {
        if (event.type === 'updated' && event.action.type === 'success') {
          void queryClient.invalidateQueries({ queryKey: aiConfigKeys.draft(agentId) });
        }
      }),
    [queryClient, agentId],
  );
}

export function useAiConfigDraft(agentId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: aiConfigKeys.draft(agentId),
    queryFn: async () => {
      const body = await api.get<unknown>(draftPath(agentId));
      return isAiConfigDraft(body) ? body : null;
    },
  });
}

function blockText(t: TFunction, block: SubmitBlock): string {
  switch (block.kind) {
    case 'no_changes':
      return t('playbook.versions.bar.block.noChanges');
    case 'problems':
      return t('playbook.versions.bar.block.problems', { count: block.count });
    case 'compliance':
      return t('playbook.versions.bar.block.compliance', {
        gate: t(`playbook.test.gate.${block.state}`),
      });
  }
}

function openText(t: TFunction, open: AiConfigVersion): string {
  return open.status === 'approved' && open.scheduled_at
    ? t('playbook.versions.bar.scheduled', {
        label: open.label,
        at: formatDateTime(open.scheduled_at) ?? open.scheduled_at,
      })
    : t('playbook.versions.bar.inReview', { label: open.label });
}

export function VersionBar({
  agentId,
  canSubmit,
  names,
  onOpenTests,
  onOpenVersions,
}: {
  agentId: string;
  /** May edit the draft — and so send it for review (a Team Lead up). */
  canSubmit: boolean;
  /** Item names the difference can show instead of keys. */
  names?: ReadonlyMap<string, string>;
  onOpenTests: () => void;
  onOpenVersions: () => void;
}): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const draft = useAiConfigDraft(agentId);
  useDraftFollowsSaves(agentId);
  const [showDiff, setShowDiff] = useState(false);
  const [note, setNote] = useState('');

  const submit = useMutation({
    mutationFn: (current: AiConfigDraft) =>
      api.post<AiConfigSubmission>(
        '/ai/config/versions',
        { ai_agent_id: agentId, ...(note.trim() ? { note: note.trim() } : {}) },
        ifMatch(current.draft_revision),
      ),
    onSuccess: () => setNote(''),
    // A conflict means the draft moved under the bar: read it again either way.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: aiConfigKeys.all }),
  });

  if (draft.isPending) return null;
  if (draft.isError) {
    return (
      <Card>
        <p role="alert" className="px-4 py-2 text-2xs text-danger">
          {t('playbook.versions.bar.loadError')}
        </p>
      </Card>
    );
  }

  const data = draft.data;
  if (!data) return null;
  const changes = data.diff?.changes ?? 0;
  const block = submitBlock(data);
  const conflict =
    submit.error instanceof ApiClientError && submit.error.type === 'ai_config_revision_conflict';

  return (
    <Card>
      <div className="flex flex-col gap-2 px-4 py-3" data-testid="ai-version-bar">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium" data-testid="ai-version-live">
              {data.published
                ? t('playbook.versions.bar.live', { label: data.published.label })
                : t('playbook.versions.bar.liveNone')}
            </span>
            <span className="text-content-tertiary"> · </span>
            <span data-testid="ai-version-draft">
              {data.ok
                ? t('playbook.versions.bar.draft', { count: changes })
                : t('playbook.versions.bar.draftInvalid')}
            </span>
            {!data.active && (
              <span className="ml-2 text-2xs text-warning">
                {t('playbook.versions.bar.paused')}
              </span>
            )}
          </p>
          <button
            type="button"
            className={button}
            aria-expanded={showDiff}
            disabled={!data.diff || changes === 0}
            onClick={() => setShowDiff((open) => !open)}
          >
            {showDiff
              ? t('playbook.versions.bar.hideChanges')
              : t('playbook.versions.bar.showChanges')}
          </button>
          <button type="button" className={button} onClick={onOpenTests}>
            {t('playbook.versions.bar.test')}
          </button>
          {canSubmit && (
            <button
              type="button"
              className={primary}
              disabled={block !== null || submit.isPending}
              aria-describedby={block ? 'ai-version-block' : undefined}
              onClick={() => submit.mutate(data)}
            >
              {t('playbook.versions.bar.submit')}
            </button>
          )}
        </div>

        {data.open && (
          <p className="flex flex-wrap items-center gap-2 text-2xs text-content-secondary">
            <span data-testid="ai-version-open">{openText(t, data.open)}</span>
            <button
              type="button"
              className="text-content-brand hover:underline"
              onClick={onOpenVersions}
            >
              {t('playbook.versions.bar.openVersions')}
            </button>
          </p>
        )}

        {canSubmit && block && (
          <p id="ai-version-block" className="text-2xs text-content-tertiary">
            {blockText(t, block)}
            {block.kind === 'compliance' && (
              <>
                {' '}
                <button
                  type="button"
                  className="text-content-brand hover:underline"
                  onClick={onOpenTests}
                >
                  {t('playbook.versions.bar.runPack')}
                </button>
              </>
            )}
          </p>
        )}

        {canSubmit && block === null && data.open && (
          <p className="text-2xs text-warning">
            {t('playbook.versions.bar.replaces', { label: data.open.label })}
          </p>
        )}

        {canSubmit && block === null && (
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('playbook.versions.bar.note')}
            <input
              type="text"
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary"
            />
          </label>
        )}

        {data.problems.length > 0 && (
          <ul
            className="flex flex-col gap-1 text-2xs text-danger"
            aria-label={t('playbook.versions.bar.problems')}
          >
            {data.problems.map((problem, index) => (
              <li key={`${problem.code}-${problem.key ?? index}`}>{problem.message}</li>
            ))}
          </ul>
        )}

        {submit.isSuccess && (
          <p role="status" className="text-2xs text-success">
            {t('playbook.versions.bar.submitted', { label: submit.data.version.label })}
          </p>
        )}
        {submit.isError && (
          <p role="alert" className="text-2xs text-danger">
            {conflict ? t('playbook.versions.bar.conflict') : t(errorMessageKey(submit.error))}
          </p>
        )}

        {showDiff && data.diff && <DiffView diff={data.diff} names={names} />}
      </div>
    </Card>
  );
}

/**
 * The editing screens' "Taslak" strip: what is saved here is the draft, and
 * the live AI keeps answering from the published version until a new one is
 * approved.
 */
export function DraftStrip({ agentId }: { agentId: string }): ReactElement | null {
  const t = useTranslate();
  const draft = useAiConfigDraft(agentId);
  if (!draft.data) return null;
  const live = draft.data.published?.label ?? null;
  return (
    <p
      role="note"
      data-testid="ai-draft-strip"
      className="mb-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-2xs text-content-secondary"
    >
      <span className="rounded bg-warning/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-warning">
        {t('playbook.versions.strip.badge')}
      </span>
      <span>
        {live
          ? t('playbook.versions.strip.text', { label: live })
          : t('playbook.versions.strip.textNone')}
      </span>
    </p>
  );
}
