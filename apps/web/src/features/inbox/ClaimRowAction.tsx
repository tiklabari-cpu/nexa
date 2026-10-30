/**
 * A Queued-view row's "Take" (WG-07 · tm 346): a conversation waiting in a
 * manual team's queue goes to nobody until a member takes it, and the first
 * to ask has it (`POST /chats/{id}/claim`). Beside the row rather than inside
 * it — the row is a button, and a button cannot hold another one
 * (`TeamRowActions` is the same shape).
 *
 * Drawn only on a row whose queue team is manual and has the caller as a
 * member; the server decides either way. A refusal says why in the row:
 * someone else took it first (the list re-reads, so the row leaves), or the
 * caller is at their concurrent chat limit.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

/** The message key a refused take shows. */
export function claimRefusalKey(error: unknown): string {
  if (error instanceof ApiClientError && error.type === 'chat_claim_refused') {
    const reason = error.details?.['reason'];
    if (reason === 'claimed') return 'inbox.list.claim.taken';
    if (reason === 'limit') return 'inbox.list.claim.limit';
    return 'inbox.list.claim.gone';
  }
  return errorMessageKey(error);
}

export function ClaimRowAction({
  chatId,
  customerName,
  onOpen,
}: {
  chatId: string;
  /** The row's name, so each row's control says which conversation it takes. */
  customerName: string;
  onOpen: (chatId: string) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [refusal, setRefusal] = useState<string | null>(null);

  const take = useMutation({
    mutationFn: () => api.post(`/chats/${chatId}/claim`),
    onSuccess: async () => {
      setRefusal(null);
      await queryClient.invalidateQueries({ queryKey: ['chats'] });
      onOpen(chatId);
    },
    onError: (error: unknown) => {
      setRefusal(claimRefusalKey(error));
      // Taken by someone else, or no longer waiting: the row is stale.
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 pb-2">
      <button
        type="button"
        onClick={() => take.mutate()}
        disabled={take.isPending}
        aria-label={t('inbox.list.claim.aria', { name: customerName })}
        className="rounded-sm bg-brand-500 px-1.5 py-0.5 text-2xs font-medium text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {t('inbox.list.claim.cta')}
      </button>
      {refusal && (
        <span role="alert" className="text-2xs text-danger">
          {t(refusal)}
        </span>
      )}
    </div>
  );
}
