/**
 * The ticket half of the inbox (PRD FR-MOD-02.1.3).
 *
 * A ticket has no transcript to stream, so this pane is a record rather than a
 * conversation: what it is about, who owns it, and the chat it came from. The
 * link back to that chat is the point — an agent picking up follow-up work
 * needs the conversation that produced it, and hunting for it by customer name
 * is how context gets lost.
 */
import { useState, type ReactElement } from 'react';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useTicket, useUpdateTicket } from './useTickets.js';
import type { Ticket, TicketStatus } from './types.js';

const STATUSES: TicketStatus[] = ['open', 'pending', 'solved', 'closed', 'spam'];

/** Solved and closed read as done; spam is its own thing, and not a success. */
function toneFor(status: TicketStatus): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'open') return 'warning';
  if (status === 'solved' || status === 'closed') return 'success';
  if (status === 'spam') return 'danger';
  return 'neutral';
}

export function TicketList({
  tickets,
  loading,
  selectedId,
  onSelect,
}: {
  tickets: Ticket[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): ReactElement {
  if (loading) {
    return (
      <ul aria-hidden="true" className="animate-pulse">
        {[0, 1, 2].map((i) => (
          <li key={i} className="border-b border-border px-4 py-3">
            <div className="mb-2 h-3 w-2/3 rounded-sm bg-inset" />
            <div className="h-3 w-1/3 rounded-sm bg-inset" />
          </li>
        ))}
      </ul>
    );
  }

  if (tickets.length === 0) {
    return (
      <EmptyState
        title="No tickets here"
        description="Follow-up work created from a conversation shows up in this list."
      />
    );
  }

  return (
    <ul>
      {tickets.map((ticket) => (
        <li key={ticket.id}>
          <button
            type="button"
            onClick={() => onSelect(ticket.id)}
            aria-current={selectedId === ticket.id ? 'true' : undefined}
            className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors ${
              selectedId === ticket.id ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2'
            }`}
          >
            <span className="truncate text-sm font-medium">{ticket.subject}</span>
            <span className="flex items-center gap-2 text-xs text-content-secondary">
              <span className="truncate">{ticket.customer_name ?? 'Visitor'}</span>
              <StatusDot tone={toneFor(ticket.status)} label={ticket.status} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TicketDetailPane({ ticketId }: { ticketId: string | null }): ReactElement {
  const ticket = useTicket(ticketId);
  const update = useUpdateTicket(ticketId);
  const [subject, setSubject] = useState<string | null>(null);

  if (!ticketId || !ticket.data) {
    return (
      <main className="flex min-w-0 flex-1 flex-col bg-canvas">
        <EmptyState
          title="No ticket selected"
          description="Pick a ticket from the list to see it here."
        />
      </main>
    );
  }

  const data = ticket.data;
  const draft = subject ?? data.subject;
  const dirty = draft.trim() !== data.subject && draft.trim().length > 0;

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h2 className="flex-1 truncate text-sm font-semibold">{data.subject}</h2>
        <span className="font-mono text-2xs text-content-tertiary">{data.id}</span>
        <StatusDot tone={toneFor(data.status)} label={data.status} />
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <dl className="grid max-w-xl grid-cols-[8rem_1fr] gap-y-3 text-sm">
          <dt className="text-content-tertiary">Customer</dt>
          <dd>
            {data.customer_name ?? 'Visitor'}
            {data.customer_email && (
              <span className="ml-2 text-content-tertiary">{data.customer_email}</span>
            )}
          </dd>

          <dt className="text-content-tertiary">Assignee</dt>
          <dd>{data.assignee_name ?? <span className="text-content-tertiary">Unassigned</span>}</dd>

          <dt className="text-content-tertiary">Created</dt>
          <dd>{new Date(data.created_at).toLocaleString()}</dd>

          <dt className="text-content-tertiary">From chat</dt>
          <dd>
            {data.source_chat_id ? (
              <span className="font-mono text-xs">{data.source_chat_id}</span>
            ) : (
              <span className="text-content-tertiary">Created directly</span>
            )}
          </dd>
        </dl>

        <div className="mt-8 max-w-xl border-t border-border pt-6">
          <label
            htmlFor="ticket-subject"
            className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            Subject
          </label>
          <div className="flex gap-2">
            <input
              id="ticket-subject"
              value={draft}
              onChange={(event) => setSubject(event.target.value)}
              className="flex-1 rounded-md border border-border bg-inset px-2.5 py-1.5 text-sm"
            />
            <button
              type="button"
              // Disabled until something actually changed: a save button that
              // is always live invites saving nothing and wondering if it worked.
              disabled={!dirty || update.isPending}
              onClick={() => {
                update.mutate({ subject: draft.trim() });
                setSubject(null);
              }}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
          </div>

          <label
            htmlFor="ticket-status"
            className="mb-1.5 mt-6 block text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            Status
          </label>
          <select
            id="ticket-status"
            value={data.status}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ status: event.target.value as TicketStatus })}
            className="w-full max-w-xs rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          {update.isError && (
            <p role="alert" className="mt-3 text-xs text-danger">
              Could not save that change.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
