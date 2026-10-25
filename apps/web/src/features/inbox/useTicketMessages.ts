/**
 * A ticket's conversation: the thread's read and the composer's two writes
 * (tm 356.4 · HD-01).
 *
 * Unlike the rest of the ticket surface this one has a realtime half — a
 * player's message or a teammate's note lands while the pane is open — but the
 * push carries ids only (`ticket_message_created`), so the answer to it is a
 * re-read, never a patch: what a caller may see of a thread is the server's
 * decision. The one exception is `ticket_message_delivery_changed`, which
 * carries a status and nothing else, and so redraws one badge in place.
 */
import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';
import { usePagedQuery, type PagedQueryResult, type PagedResponse } from '../../lib/paged-query.js';
import type { TicketComposerKind, TicketReplySetStatus } from '@siyahtus/types';
import { ticketMessagesKey, withMessage } from './ticketMessages.js';
import type { TicketMessage } from './types.js';

const MESSAGE_PAGE_SIZE = 50;

/**
 * The whole conversation, oldest first; the pane keeps asking until the end.
 *
 * `pollMs` re-reads while a reply is still on its way out. The push that settles
 * it goes to the ticket's assignee, followers and team, so a ticket nobody holds
 * yet would leave the replier looking at "Sending…" for good.
 */
export function useTicketMessages(
  ticketId: string | null,
  pollMs: number | false = false,
): PagedQueryResult<TicketMessage> {
  return usePagedQuery<TicketMessage>({
    queryKey: ticketMessagesKey(ticketId ?? ''),
    buildUrl: (pageId) =>
      `/tickets/${ticketId}/messages?limit=${MESSAGE_PAGE_SIZE}` +
      (pageId ? `&page_id=${encodeURIComponent(pageId)}` : ''),
    enabled: ticketId !== null,
    refetchInterval: pollMs,
  });
}

export interface TicketMessageDraft {
  kind: TicketComposerKind;
  text: string;
  setStatus?: TicketReplySetStatus;
  /** Stays the same across retries of one message, so a repeat is one message. */
  idempotencyKey: string;
}

/** `POST /tickets/{id}/messages`: a reply to the player or a note to the team. */
export function useSendTicketMessage(ticketId: string) {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: TicketMessageDraft) =>
      api.post<TicketMessage>(`/tickets/${ticketId}/messages`, {
        kind: draft.kind,
        text: draft.text,
        ...(draft.setStatus ? { set_status: draft.setStatus } : {}),
        idempotency_key: draft.idempotencyKey,
      }),
    onSuccess: async () => {
      // A reply moves the ticket to pending (or solved), so the pane's status
      // and every list it sits in are stale as well as the thread.
      await Promise.all([
        client.invalidateQueries({ queryKey: ticketMessagesKey(ticketId) }),
        client.invalidateQueries({ queryKey: ['ticket', ticketId] }),
        client.invalidateQueries({ queryKey: ['tickets'] }),
      ]);
    },
  });
}

/** `POST /tickets/{id}/messages/{messageId}/resend`: "try again" on a failed e-mail. */
export function useResendTicketMessage(ticketId: string) {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api.post<TicketMessage>(`/tickets/${ticketId}/messages/${messageId}/resend`),
    onSuccess: (message) => {
      // The answer is the reply as it now stands (`queued`); the push that
      // follows settles it. Written into every loaded thread that holds it — a
      // merged ticket's reply also reads in its primary's.
      client.setQueriesData<InfiniteData<PagedResponse<TicketMessage>>>(
        { queryKey: ['ticket-messages'] },
        (data) => withMessage(data, message),
      );
    },
  });
}

/** The saved replies the ticket composer's `#` picker offers (`scope=ticket`). */
export function useTicketCannedResponses() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['canned-responses', 'ticket'],
    queryFn: () =>
      api.get<{ items: { id: string; shortcut: string; text: string }[] }>(
        '/settings/canned-responses?scope=ticket',
      ),
    staleTime: 5 * 60_000,
  });
}
