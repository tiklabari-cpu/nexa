/**
 * Ticket data for the inbox (PRD FR-MOD-02.1.3, 02.6).
 *
 * Tickets have no realtime channel — they are asynchronous by definition, and
 * a socket push for work that is measured in days would be ceremony. A plain
 * refetch on mutation is the honest shape.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import type { Ticket, TicketStatus, TicketView } from './types.js';

export function ticketsKey(view: TicketView): unknown[] {
  return ['tickets', view];
}

export function useTicketList(view: TicketView, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ticketsKey(view),
    queryFn: () => api.get<{ items: Ticket[]; total: number }>(`/tickets?view=${view}&limit=50`),
    enabled,
  });
}

export function useTicket(ticketId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.get<Ticket>(`/tickets/${ticketId}`),
    enabled: ticketId !== null,
  });
}

export function useUpdateTicket(ticketId: string | null) {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: { status?: TicketStatus; subject?: string }) =>
      api.patch<Ticket>(`/tickets/${ticketId}`, patch),
    onSuccess: async () => {
      // Every view can be affected: solving a ticket moves it out of `my_open`
      // and into `solved` at the same time.
      await client.invalidateQueries({ queryKey: ['tickets'] });
      await client.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });
}

/**
 * The id of the ticket that already exists, when creation was refused because
 * this chat has an unresolved one.
 *
 * Read off the typed error rather than the raw response: the envelope carries
 * `details` for exactly this, and the id is what lets the caller offer "open
 * the existing one" instead of a dead end. The usual way to hit this is an
 * agent clicking the button twice.
 */
export function existingTicketIdOf(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || error.type !== 'ticket_exists') return null;
  const id = error.details?.['existing_ticket_id'];
  return typeof id === 'string' ? id : null;
}

export function useCreateTicketFromChat() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation<Ticket, ApiClientError, { chatId: string; subject: string }>({
    mutationFn: ({ chatId, subject }) =>
      api.post<Ticket>('/tickets', { subject, source_chat_id: chatId }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}
