/**
 * The strip above the composer when the open connection is not the caller's
 * (tm 475.4 · owner decision 2026-11-06): only the agent a conversation is
 * assigned to answers the customer, so everyone else is told why Reply will
 * not send and offered the way to take the chat — "Take" when it is nobody's
 * and theirs to take (a team's queue they belong to, or the AI's), "Take over"
 * when it is a colleague's and they may (`canTakeOver`). An internal note is
 * always open; the composer below keeps it working (`Composer` `replyLocked`).
 *
 * What is offered is `replyClaim.ts`; the server decides either way. A refused
 * Take says why in the strip — the same sentences as the Queued row's
 * (`claimRefusalKey`) — and re-reads the chat, which may have just become
 * someone else's.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { claimRefusalKey } from './ClaimRowAction.js';
import { TakeoverModal } from './DetailsPanel.js';
import { replyClaim, type ReplyClaim } from './replyClaim.js';
import { canTakeOver } from './takeover.js';
import { TEAMS_KEY, claimableTeamIds, type TransferTeam } from './transfer.js';
import { eventsKey } from './useInbox.js';
import type { ChatDetail } from './types.js';

/** The strip's state for this chat and the signed-in agent — `mine` draws nothing. */
export function useReplyClaim(chat: ChatDetail): ReplyClaim {
  const api = useApiClient();
  const accountId = useAuth((s) => s.agent?.account_id ?? null);
  const role = useAuth((s) => s.agent?.role ?? null);
  const capabilities = useAuth((s) => s.agent?.capabilities);
  // The key the Details panel, the Queued rows and the Teams page share, so
  // this opens no second request.
  const teamsQuery = useQuery({
    queryKey: TEAMS_KEY,
    queryFn: () => api.get<{ items: TransferTeam[] }>('/groups'),
    staleTime: 60_000,
  });
  const teams = teamsQuery.data?.items ?? [];
  return replyClaim(chat, accountId, {
    memberOf: claimableTeamIds(teams, accountId),
    canTakeOver:
      chat.active &&
      canTakeOver(
        { role, accountId, ...(capabilities ? { capabilities } : {}) },
        chat.access.group_ids,
        teams,
      ),
  });
}

export function ReplyClaimBar({
  chatId,
  claim,
}: {
  chatId: string;
  /** `useReplyClaim` for the open chat; not `mine`. */
  claim: Exclude<ReplyClaim, { kind: 'mine' }>;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [takeoverOpen, setTakeoverOpen] = useState(false);

  const reread = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
  };

  const take = useMutation({
    mutationFn: () => api.post(`/chats/${chatId}/claim`),
    onSuccess: () => {
      setRefusal(null);
      reread();
      // Taking it from the AI writes a line into the transcript.
      void queryClient.invalidateQueries({ queryKey: eventsKey(chatId) });
    },
    onError: (error: unknown) => {
      setRefusal(claimRefusalKey(error));
      // Someone else took it, or it stopped waiting: what is drawn is stale.
      reread();
    },
  });

  // The roster that names the colleague — the key the Details panel and the
  // takeover dialog already read, so no second request.
  const roster = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string | null }> }>('/agents'),
    staleTime: 60_000,
    enabled: claim.kind === 'other',
  });
  const assigneeName =
    claim.kind === 'other'
      ? (roster.data?.items.find((agent) => agent.id === claim.assigneeId)?.name ?? null)
      : null;

  const sentence =
    claim.kind === 'claim'
      ? t('inbox.composer.claim.unassigned')
      : claim.kind === 'waiting'
        ? t('inbox.composer.claim.waiting')
        : assigneeName
          ? t('inbox.composer.claim.other', { name: assigneeName })
          : t('inbox.composer.claim.otherUnnamed');

  return (
    <>
      <div
        data-testid="reply-claim-bar"
        data-claim={claim.kind}
        // A push can turn the chat into someone else's under the agent's eyes;
        // the new sentence is announced, politely.
        aria-live="polite"
        className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border bg-inset px-4 py-2 text-xs text-content"
      >
        <p className="min-w-0 flex-1">
          {sentence}{' '}
          <span className="text-content-secondary">{t('inbox.composer.claim.noteOpen')}</span>
        </p>
        {claim.kind === 'claim' && (
          <button
            type="button"
            onClick={() => take.mutate()}
            disabled={take.isPending}
            className="shrink-0 rounded-md bg-brand-500 px-3 py-1 text-xs font-medium text-white hover:bg-brand-600 disabled:opacity-60 max-lg:min-h-11"
          >
            {take.isPending ? t('inbox.composer.claim.pending') : t('inbox.composer.claim.cta')}
          </button>
        )}
        {claim.kind === 'other' && claim.canTakeOver && (
          <button
            type="button"
            onClick={() => setTakeoverOpen(true)}
            className="shrink-0 rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-content hover:bg-surface-2 max-lg:min-h-11"
          >
            {t('inbox.details.takeover.cta')}
          </button>
        )}
        {refusal && (
          <p role="alert" className="w-full text-xs text-danger">
            {t(refusal)}
          </p>
        )}
      </div>
      {/* Outside the live region: a dialog is not an announcement. */}
      {takeoverOpen && (
        <TakeoverModal
          chatId={chatId}
          assigneeName={assigneeName ?? t('inbox.details.takeover.fallbackName')}
          onClose={() => setTakeoverOpen(false)}
        />
      )}
    </>
  );
}
