/**
 * The Archive's other two panes (AR-01 · tm 335.2): one connection's transcript,
 * read-only, and the player panel beside it.
 *
 * Nothing in either writes to the conversation. The transcript is given no edit
 * handler, so no bubble offers one; the panel shows the connection's own tags,
 * assignee and rating — not the day's latest — and the player card the Inbox
 * shows. Going back to work on it is a separate act: "Open in Inbox" looks at it
 * where the live console is, "Reopen" starts a new connection on it
 * (`POST /chats/{id}/resume`) and follows that one.
 */
import type { ReactElement, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ArchiveConversationDetail } from '@siyahtus/types';
import { CopyId } from '../../components/CopyId.js';
import { timelineAddress } from '../timeline/timeline.js';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { Panel, PanelSection } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { TranscriptFocus } from '../inbox/dayConnections.js';
import { PlayerCard } from '../inbox/PlayerCard.js';
import { Transcript } from '../inbox/Transcript.js';
import { archiveRefusal } from './archive.js';
import { useArchiveTranscript, useReopenConnection, useTeamNames } from './useArchive.js';

type DetailQuery = UseQueryResult<ArchiveConversationDetail>;

/** The address of a conversation in the live console, at the connection that was opened here. */
function inboxAddress(detail: ArchiveConversationDetail): string {
  const params = new URLSearchParams({ chat: detail.chat_id, thread: detail.thread_id });
  return `/app/inbox?${params.toString()}`;
}

/** The middle pane: header, actions and the transcript — or the reason there is none. */
export function ArchiveTranscript({
  threadId,
  detail,
  focus,
  canReopen,
}: {
  threadId: string | null;
  detail: DetailQuery;
  focus: (TranscriptFocus & { threadId: string }) | null;
  /** The caller holds a write scope on chats, so "Reopen" would not be refused. */
  canReopen: boolean;
}): ReactElement {
  const t = useTranslate();

  if (threadId === null) {
    return (
      <EmptyState
        title={t('archive.detail.none.title')}
        description={t('archive.detail.none.hint')}
      />
    );
  }
  if (detail.isPending) {
    return (
      <div className="flex flex-1 flex-col" aria-busy="true">
        <p role="status" className="px-5 py-3 text-xs text-content-tertiary">
          {t('archive.detail.loading')}
        </p>
        <ListSkeleton rows={3} />
      </div>
    );
  }
  if (detail.isError) {
    const refusal = archiveRefusal(detail.error);
    if (refusal === 'retention_expired') {
      return (
        <EmptyState
          title={t('archive.detail.retention.title')}
          description={t('archive.detail.retention.description')}
        />
      );
    }
    if (refusal === 'not_found') {
      return (
        <EmptyState
          title={t('archive.detail.notFound.title')}
          description={t('archive.detail.notFound.description')}
        />
      );
    }
    return (
      <LoadError
        title={t('archive.detail.error.title')}
        error={detail.error}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const row = detail.data;
  return (
    <>
      <ConnectionHeader detail={row} canReopen={canReopen} />
      <ConnectionTranscript
        key={row.thread_id}
        detail={row}
        focus={focus?.threadId === row.thread_id ? focus : undefined}
      />
    </>
  );
}

function ConnectionHeader({
  detail,
  canReopen,
}: {
  detail: ArchiveConversationDetail;
  canReopen: boolean;
}): ReactElement {
  const t = useTranslate();
  const navigate = useNavigate();
  const reopen = useReopenConnection();
  const closed = detail.ended_at !== null;
  const timelineAllowed = useAuth((s) => s.agent?.capabilities?.['timeline.view']) !== 'none';

  return (
    <header className="flex flex-col gap-2 border-b border-border px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 truncate text-base font-semibold">
          {detail.customer.name ?? t('inbox.list.item.visitorFallback')}
        </h2>
        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {closed ? t('archive.detail.status.closed') : t('archive.detail.status.open')}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(inboxAddress(detail))}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
          >
            {t('archive.action.openInbox')}
          </button>
          {timelineAllowed && (
            <button
              type="button"
              onClick={() => navigate(timelineAddress(detail.chat_id, detail.thread_id))}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
            >
              {t('archive.action.timeline')}
            </button>
          )}
          {closed && canReopen && (
            <button
              type="button"
              disabled={reopen.isPending}
              onClick={() => {
                // An earlier day's conversation continues under the member's chat
                // for today: the answer names the one to open. The promise, not a
                // per-call callback — the invalidation the success triggers can
                // re-render this header before TanStack would run the callback,
                // and a callback of an observer that moved on is dropped.
                reopen.mutateAsync(detail.chat_id).then(
                  (resumed) =>
                    navigate(`/app/inbox?${new URLSearchParams({ chat: resumed.id }).toString()}`),
                  () => undefined, // shown by `reopen.isError` below
                );
              }}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {reopen.isPending ? t('archive.action.reopening') : t('archive.action.reopen')}
            </button>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-content-tertiary">
        <span className="tabular">
          {formatDateTime(detail.started_at)}
          {detail.ended_at ? ` → ${formatDateTime(detail.ended_at)}` : ''}
        </span>
        <CopyId kind="chat" value={detail.thread_id} className="text-2xs" />
        <CopyId kind="thread" value={detail.chat_id} className="text-2xs" />
      </div>
      {reopen.isError && (
        <p role="alert" className="text-xs text-danger">
          {t(errorMessageKey(reopen.error))}
        </p>
      )}
    </header>
  );
}

/** The messages of one connection. Read-only: no handler is given, so no bubble offers an edit. */
function ConnectionTranscript({
  detail,
  focus,
}: {
  detail: ArchiveConversationDetail;
  focus: TranscriptFocus | undefined;
}): ReactElement {
  const t = useTranslate();
  const agentId = useAuth((s) => s.agent?.account_id ?? null);
  const transcript = useArchiveTranscript(detail.chat_id, detail.thread_id);

  if (transcript.isError) {
    return (
      <LoadError
        title={t('archive.detail.transcriptError.title')}
        error={transcript.error}
        onRetry={transcript.refetch}
      />
    );
  }
  return (
    <Transcript
      chatId={detail.thread_id}
      events={transcript.events}
      focus={focus}
      loading={transcript.isPending}
      currentAgentId={agentId}
      hasOlder={transcript.hasOlder}
      isLoadingOlder={transcript.isLoadingOlder}
      onLoadOlder={transcript.loadOlder}
    />
  );
}

/** The right pane: the player card of the Inbox, then what this connection — not the day — holds. */
export function ArchivePlayer({
  threadId,
  detail,
}: {
  threadId: string | null;
  detail: DetailQuery;
}): ReactElement {
  const t = useTranslate();
  const row = detail.data;

  return (
    <Panel
      label={t('archive.player.ariaLabel')}
      title={t('archive.player.title')}
      className="w-details shrink-0 overflow-y-auto border-l border-border max-lg:w-full max-lg:border-l-0"
    >
      {threadId === null || !row ? (
        <p className="p-4 text-xs text-content-tertiary">
          {threadId === null
            ? t('archive.player.none')
            : detail.isPending
              ? t('archive.detail.loading')
              : t('archive.player.unavailable')}
        </p>
      ) : (
        <>
          <PlayerCard chatId={row.chat_id} customerId={row.customer.id} recognizedDevice={false} />
          <ConnectionFacts detail={row} />
        </>
      )}
    </Panel>
  );
}

function ConnectionFacts({ detail }: { detail: ArchiveConversationDetail }): ReactElement {
  const t = useTranslate();
  const teams = useTeamNames();
  const teamNames = detail.group_ids
    .map((id) => teams.get(id))
    .filter((name): name is string => name !== undefined);
  const none = <span className="text-content-tertiary">—</span>;

  return (
    <PanelSection title={t('archive.facts.section')}>
      <dl data-testid="archive-facts" className="flex flex-col gap-2">
        <Fact label={t('archive.facts.assignee')}>
          {detail.assignee ? detail.assignee.name : t('archive.row.unassigned')}
        </Fact>
        <Fact label={t('archive.facts.team')}>
          {teamNames.length > 0 ? teamNames.join(', ') : none}
        </Fact>
        <Fact label={t('archive.facts.handledBy')}>
          {detail.handled_by
            ? t(`archive.handledBy.${detail.handled_by}`)
            : t('archive.handledBy.unknown')}
        </Fact>
        <Fact label={t('archive.facts.rating')}>
          {detail.rating ? (
            <span className="flex flex-col items-end gap-0.5">
              <span>{t(`archive.rating.${detail.rating.value}`)}</span>
              {detail.rating.comment && (
                <span className="break-words text-2xs text-content-secondary">
                  {detail.rating.comment}
                </span>
              )}
            </span>
          ) : (
            none
          )}
        </Fact>
        <Fact label={t('archive.facts.tags')}>
          {detail.tags.length > 0 ? (
            <span className="flex flex-wrap justify-end gap-1">
              {detail.tags.map((tag) => (
                <span key={tag.id} className="rounded-sm bg-inset px-1.5 text-2xs">
                  {tag.name}
                </span>
              ))}
            </span>
          ) : (
            none
          )}
        </Fact>
        <Fact label={t('archive.facts.risk')}>
          {detail.risk_flags.length > 0
            ? detail.risk_flags.map((flag) => t(`inbox.risk.type.${flag}`)).join(', ')
            : none}
        </Fact>
        <Fact label={t('archive.facts.messages')}>{detail.message_count}</Fact>
      </dl>
      {detail.summary && (
        <p className="mt-2 break-words text-xs text-content-secondary">{detail.summary}</p>
      )}
    </PanelSection>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-xs text-content-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-right text-xs">{children}</dd>
    </div>
  );
}
