/**
 * A "My team" row's own actions (RL-03 · tm 326): Watch and Take over, beside
 * the row rather than inside it — the row is a button, and a button cannot
 * hold another one.
 *
 * Watch registers the caller as watching (`POST /chats/{id}/supervise`, the
 * Traffic board's action) and opens the conversation; Take over asks first, in
 * the Details panel's own dialog, and opens it once it is the caller's. Take
 * over is drawn only when the caller's `chats.takeover` reaches the row
 * (`takeover.ts`); the server decides either way.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { TakeoverModal } from './DetailsPanel.js';

/** Just enough of `GET /agents` to name who holds the chat; the Details panel's key. */
interface RosterAgent {
  id: string;
  name: string | null;
}

export function TeamRowActions({
  chatId,
  customerName,
  assigneeId,
  canTakeover,
  onOpen,
}: {
  chatId: string;
  /** The row's name, so each row's controls say which conversation they act on. */
  customerName: string;
  assigneeId: string | null;
  canTakeover: boolean;
  onOpen: (chatId: string) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const roster = useQuery({
    queryKey: ['team', 'agents'],
    queryFn: () => api.get<{ items: RosterAgent[] }>('/agents'),
    staleTime: 60_000,
    enabled: confirming && assigneeId !== null,
  });
  const assigneeName =
    assigneeId === null
      ? null
      : (roster.data?.items.find((agent) => agent.id === assigneeId)?.name ??
        t('inbox.details.takeover.fallbackName'));

  const watch = useMutation({
    mutationFn: () => api.post(`/chats/${chatId}/supervise`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['chats', 'supervised'] });
      onOpen(chatId);
    },
  });

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 pb-2">
      <button
        type="button"
        onClick={() => watch.mutate()}
        disabled={watch.isPending}
        aria-label={t('inbox.list.team.watchAria', { name: customerName })}
        className="rounded-sm border border-border px-1.5 py-0.5 text-2xs hover:bg-surface-2 disabled:opacity-60"
      >
        {t('inbox.list.team.watch')}
      </button>
      {canTakeover && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          aria-label={t('inbox.list.team.takeoverAria', { name: customerName })}
          className="rounded-sm border border-border px-1.5 py-0.5 text-2xs hover:bg-surface-2"
        >
          {t('inbox.details.takeover.cta')}
        </button>
      )}
      {watch.isError && (
        <span role="alert" className="text-2xs text-danger">
          {t('inbox.list.team.watchError')}
        </span>
      )}
      {confirming && (
        <TakeoverModal
          chatId={chatId}
          assigneeName={assigneeName}
          onClose={() => setConfirming(false)}
          onTaken={() => onOpen(chatId)}
        />
      )}
    </div>
  );
}
