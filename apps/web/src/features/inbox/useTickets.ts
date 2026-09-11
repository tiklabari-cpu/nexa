/**
 * Ticket data for the inbox (PRD FR-MOD-02.1.3, 02.6, 13.6).
 *
 * Tickets have no realtime channel — they are asynchronous by definition, and
 * a socket push for work that is measured in days would be ceremony. A plain
 * refetch on mutation is the honest shape.
 *
 * The HelpDesk mutations (merge/unmerge/followers) take the ticket id at call
 * time rather than being bound to one id: a merge touches two tickets, and an
 * agent unmerges a folded-in child straight from the primary's pane, so the
 * hook cannot assume a single subject.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { usePagedQuery, type PagedQueryResult } from '../../lib/paged-query.js';
import type { TicketSort } from './ticket-grid.js';
import type { Agent, Ticket, TicketDetail, TicketStatus, TicketView } from './types.js';

/** Rows per request. The grid chains pages from here, so it is a page, not a cap. */
const TICKET_PAGE_SIZE = 50;

/**
 * Cache key for a ticket list. `sort` belongs in it, and it is load-bearing
 * rather than tidy: the server pages this list with a keyset cursor, and a
 * cursor is a position *in one ordering* — `GET /tickets` refuses a `page_id`
 * minted under a different `sort`/`order` (400) rather than quietly restarting.
 * Folding the sort into the key is what makes a header click start a fresh
 * chain from page one instead of appending to the old one — the same "filter
 * change ⇒ new query key" shape `AuditLogPage` uses for its own filters.
 */
export function ticketsKey(view: TicketView, sort: TicketSort): unknown[] {
  return ['tickets', view, sort.key, sort.order];
}

function ticketListUrl(view: TicketView, sort: TicketSort, pageId: string | undefined): string {
  const cursor = pageId ? `&page_id=${encodeURIComponent(pageId)}` : '';
  return (
    `/tickets?view=${view}&sort=${sort.key}&order=${sort.order}` +
    `&limit=${TICKET_PAGE_SIZE}${cursor}`
  );
}

export function useTicketList(
  view: TicketView,
  sort: TicketSort,
  enabled: boolean,
): PagedQueryResult<Ticket> {
  return usePagedQuery<Ticket>({
    queryKey: ticketsKey(view, sort),
    buildUrl: (pageId) => ticketListUrl(view, sort, pageId),
    enabled,
  });
}

export function useTicket(ticketId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => api.get<TicketDetail>(`/tickets/${ticketId}`),
    enabled: ticketId !== null,
  });
}

/**
 * Refresh everything a ticket write can touch. Every list view is invalidated —
 * solving a ticket moves it out of `my_open` and into `solved` at once, and a
 * merge drops the folded ticket out of every list — and every open detail query
 * (`['ticket', …]`) too, because a merge changes both the source and the target.
 * The returned detail seeds the current ticket's cache so the pane updates
 * without a flash of stale data before the refetch lands.
 */
async function settle(client: QueryClient, data: TicketDetail | undefined): Promise<void> {
  if (data) client.setQueryData(['ticket', data.id], data);
  await client.invalidateQueries({ queryKey: ['tickets'] });
  await client.invalidateQueries({ queryKey: ['ticket'] });
}

export function useUpdateTicket(ticketId: string | null) {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: {
      status?: TicketStatus;
      subject?: string;
      priority?: number;
      /** Mail the customer a branded notice about this change (FR-MOD-08.7.5). */
      email_template_id?: string;
    }) => api.patch<TicketDetail>(`/tickets/${ticketId}`, patch),
    onSuccess: (data) => settle(client, data),
  });
}

/** One selected ticket's verdict, straight off `POST /tickets/bulk`. */
export interface TicketBulkRowResult {
  ticket_id: string;
  status: 'updated' | 'skipped';
  reason: 'not_found' | 'merged' | null;
}

export interface TicketBulkResult {
  updated: number;
  failed: number;
  results: TicketBulkRowResult[];
}

/**
 * Apply one change to a selection of tickets (FR-13-EK.3 · FR-MOD-02.7.1).
 *
 * Success is not "everything worked" — the endpoint answers 200 for a partial
 * outcome too, so the caller reads `updated`/`failed` rather than treating the
 * resolved promise as an all-clear. Treating it as one is the specific bug this
 * shape exists to prevent: an agent told "done" about six tickets when two of
 * them were merged out from under the selection.
 *
 * `settle` is reused unchanged and matters more here than on a single write: a
 * bulk status change moves rows between views wholesale, so every list query is
 * invalidated rather than patched — there is no single ticket to seed.
 */
export function useBulkUpdateTickets() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation<
    TicketBulkResult,
    ApiClientError,
    {
      ticketIds: string[];
      patch: { status?: TicketStatus; priority?: number; assignee_id?: string | null };
    }
  >({
    mutationFn: ({ ticketIds, patch }) =>
      api.post<TicketBulkResult>('/tickets/bulk', { ticket_ids: ticketIds, ...patch }),
    onSuccess: () => settle(client, undefined),
  });
}

/** Just enough of a template for the pane's picker — never the body it will send. */
export interface TicketEmailTemplateOption {
  id: string;
  name: string;
  enabled: boolean;
}

/**
 * The templates a status change may notify the customer with (FR-MOD-08.7.5).
 *
 * Read from the settings endpoint an admin authors through — one library, not a
 * second listing that could drift from it. `retry: false` because the one
 * failure worth expecting is a 403 from a narrowed token, and retrying a
 * refusal three times only delays the pane deciding it has no picker to show.
 * A failure is *not* surfaced as an error: the notice is an option on top of
 * changing a status, and a workspace with no templates and a workspace whose
 * token cannot read them should both simply get the plain status control.
 */
export function useTicketEmailTemplates(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['ticket-email-templates'],
    queryFn: () =>
      api.get<{ items: TicketEmailTemplateOption[] }>('/settings/ticket-email-templates'),
    enabled,
    retry: false,
  });
}

/**
 * Set a ticket's custom field values (FR-MOD-08.7.6). The response carries the
 * ticket with its `custom_fields` applied, which seeds the detail cache through
 * `settle` so the pane shows the saved values without a refetch flash.
 */
export function useSetTicketCustomFields(ticketId: string | null) {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (values: Record<string, string | null>) =>
      api.put<TicketDetail>(`/tickets/${ticketId}/custom-fields`, { values }),
    onSuccess: (data) => settle(client, data),
  });
}

/** Merge one ticket into another (FR-MOD-13.6). */
export function useMergeTicket() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation<TicketDetail, ApiClientError, { ticketId: string; into: string }>({
    mutationFn: ({ ticketId, into }) =>
      api.post<TicketDetail>(`/tickets/${ticketId}/merge`, { into }),
    onSuccess: (data) => settle(client, data),
  });
}

/** Undo a merge (FR-MOD-13.6) — pass the id of the folded-in ticket to restore. */
export function useUnmergeTicket() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation<TicketDetail, ApiClientError, string>({
    mutationFn: (ticketId) => api.delete<TicketDetail>(`/tickets/${ticketId}/merge`),
    onSuccess: (data) => settle(client, data),
  });
}

/** Add a follower to a ticket (FR-MOD-13.6). Idempotent on the server. */
export function useAddFollower() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation<TicketDetail, ApiClientError, { ticketId: string; accountId: string }>({
    mutationFn: ({ ticketId, accountId }) =>
      api.post<TicketDetail>(`/tickets/${ticketId}/followers`, { account_id: accountId }),
    onSuccess: (data) => settle(client, data),
  });
}

/** Remove a follower from a ticket (FR-MOD-13.6). */
export function useRemoveFollower() {
  const api = useApiClient();
  const client = useQueryClient();
  return useMutation<TicketDetail, ApiClientError, { ticketId: string; accountId: string }>({
    mutationFn: ({ ticketId, accountId }) =>
      api.delete<TicketDetail>(`/tickets/${ticketId}/followers/${accountId}`),
    onSuccess: (data) => settle(client, data),
  });
}

/**
 * The licence's agents, for the follower picker. Cached under a plain key so the
 * whole app shares one fetch; enabled only when a ticket pane needs it.
 */
export function useAgents(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<{ items: Agent[] }>('/agents'),
    enabled,
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
  return useMutation<TicketDetail, ApiClientError, { chatId: string; subject: string }>({
    mutationFn: ({ chatId, subject }) =>
      api.post<TicketDetail>('/tickets', { subject, source_chat_id: chatId }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}
