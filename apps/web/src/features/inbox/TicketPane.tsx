/**
 * The ticket half of the inbox (PRD FR-MOD-02.1.3, HelpDesk layer FR-MOD-13.6).
 *
 * A ticket has no transcript to stream, so this pane is a record rather than a
 * conversation: what it is about, who owns it, and the chat it came from. The
 * link back to that chat is the point — an agent picking up follow-up work
 * needs the conversation that produced it, and hunting for it by customer name
 * is how context gets lost.
 *
 * The HelpDesk controls live here too: priority, followers, and merge/unmerge.
 * A merged ticket is folded under its primary and disappears from every list, so
 * the only place to undo that is the primary's own pane — which is why the
 * merged-in children are listed here with their own unmerge affordance.
 */
import { useState, type ReactElement } from 'react';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualList } from '../../components/VirtualList.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Banner } from '../../components/ui/index.js';
import {
  useAddFollower,
  useAgents,
  useMergeTicket,
  useRemoveFollower,
  useTicket,
  useUnmergeTicket,
  useUpdateTicket,
} from './useTickets.js';
import { TICKET_PRIORITIES, hasElevatedPriority, nearestPriority } from './ticket-priority.js';
import type { Ticket, TicketDetail, TicketStatus } from './types.js';

const STATUSES: TicketStatus[] = ['open', 'pending', 'solved', 'closed', 'spam'];

/** Solved and closed read as done; spam is its own thing, and not a success. */
function toneFor(status: TicketStatus): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'open') return 'warning';
  if (status === 'solved' || status === 'closed') return 'success';
  if (status === 'spam') return 'danger';
  return 'neutral';
}

const PRIORITY_PILL: Record<'danger' | 'warning' | 'neutral', string> = {
  danger: 'bg-inset text-danger',
  warning: 'bg-inset text-warning',
  neutral: 'bg-inset text-content-tertiary',
};

/** A small coloured label for a non-default priority, in the list and the pane. */
function PriorityPill({ value }: { value: number }): ReactElement | null {
  if (!hasElevatedPriority(value)) return null;
  const level = nearestPriority(value);
  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-2xs ${PRIORITY_PILL[level.tone]}`}>
      {level.label}
    </span>
  );
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
    return <ListSkeleton rows={3} />;
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
    <VirtualList
      items={tickets}
      rowHeight={60}
      maxHeight="100%"
      label="Tickets"
      renderRow={(ticket) => (
        <div key={ticket.id} role="listitem">
          <button
            type="button"
            onClick={() => onSelect(ticket.id)}
            aria-current={selectedId === ticket.id ? 'true' : undefined}
            className={`flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left transition-colors ${
              selectedId === ticket.id ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="flex-1 truncate text-sm font-medium">{ticket.subject}</span>
              <PriorityPill value={ticket.priority} />
            </span>
            <span className="flex items-center gap-2 text-xs text-content-secondary">
              <span className="truncate">{ticket.customer_name ?? 'Visitor'}</span>
              <StatusDot tone={toneFor(ticket.status)} label={ticket.status} />
            </span>
          </button>
        </div>
      )}
    />
  );
}

/** The banner shown at the top of a ticket that has been folded into another. */
function MergedBanner({
  ticket,
  onUnmerge,
  pending,
}: {
  ticket: TicketDetail;
  onUnmerge: () => void;
  pending: boolean;
}): ReactElement {
  return (
    <Banner
      tone="neutral"
      className="mb-6 max-w-xl"
      cta={
        <button
          type="button"
          onClick={onUnmerge}
          disabled={pending}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium disabled:opacity-40"
        >
          Unmerge
        </button>
      }
    >
      Merged into <span className="font-mono text-xs">{ticket.merged_into_id}</span>. It is folded
      under that ticket and hidden from lists until you unmerge it.
    </Banner>
  );
}

/** Followers: passive watchers of a ticket (FR-MOD-13.6). */
function FollowersSection({ ticket }: { ticket: TicketDetail }): ReactElement {
  const agents = useAgents(true);
  const add = useAddFollower();
  const remove = useRemoveFollower();
  const [choice, setChoice] = useState('');

  const following = new Set(ticket.followers.map((f) => f.account_id));
  const addable = (agents.data?.items ?? []).filter((agent) => !following.has(agent.id));

  return (
    <section className="mt-8 max-w-xl border-t border-border pt-6">
      <h3 className="mb-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        Followers
      </h3>

      {ticket.followers.length === 0 ? (
        <p className="text-sm text-content-tertiary">No one is following this ticket yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {ticket.followers.map((follower) => (
            <li key={follower.account_id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{follower.name ?? follower.account_id}</span>
              <button
                type="button"
                onClick={() =>
                  remove.mutate({ ticketId: ticket.id, accountId: follower.account_id })
                }
                disabled={remove.isPending}
                className="text-xs text-content-tertiary hover:text-danger disabled:opacity-40"
                aria-label={`Remove ${follower.name ?? follower.account_id}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2">
        <label htmlFor="ticket-follower" className="sr-only">
          Add a follower
        </label>
        <select
          id="ticket-follower"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          disabled={addable.length === 0}
          className="flex-1 rounded-md border border-border bg-inset px-2 py-1.5 text-sm disabled:opacity-40"
        >
          <option value="">
            {addable.length === 0 ? 'Everyone is already following' : 'Add a follower…'}
          </option>
          {addable.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!choice || add.isPending}
          onClick={() => {
            add.mutate({ ticketId: ticket.id, accountId: choice });
            setChoice('');
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {(add.isError || remove.isError) && (
        <p role="alert" className="mt-2 text-xs text-danger">
          Could not update followers.
        </p>
      )}
    </section>
  );
}

/**
 * Merge controls (FR-MOD-13.6). A standalone ticket can be merged into another;
 * a primary lists the tickets folded into it, each with its own unmerge.
 */
function MergeSection({
  ticket,
  candidates,
}: {
  ticket: TicketDetail;
  candidates: Ticket[];
}): ReactElement {
  const merge = useMergeTicket();
  const unmerge = useUnmergeTicket();
  const [choice, setChoice] = useState('');

  const targets = candidates.filter((candidate) => candidate.id !== ticket.id);
  const isPrimary = ticket.merged_ticket_ids.length > 0;

  return (
    <section className="mt-8 max-w-xl border-t border-border pt-6">
      <h3 className="mb-2 text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        Merge
      </h3>

      {isPrimary ? (
        <>
          <p className="mb-2 text-sm text-content-secondary">
            {ticket.merged_ticket_ids.length} ticket
            {ticket.merged_ticket_ids.length === 1 ? '' : 's'} folded into this one.
          </p>
          <ul className="flex flex-col gap-1.5">
            {ticket.merged_ticket_ids.map((id) => (
              <li key={id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 font-mono text-xs">{id}</span>
                <button
                  type="button"
                  onClick={() => unmerge.mutate(id)}
                  disabled={unmerge.isPending}
                  className="text-xs text-content-tertiary hover:text-content disabled:opacity-40"
                >
                  Unmerge
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : targets.length === 0 ? (
        <p className="text-sm text-content-tertiary">No other ticket to merge into.</p>
      ) : (
        <div className="flex gap-2">
          <label htmlFor="ticket-merge" className="sr-only">
            Merge into another ticket
          </label>
          <select
            id="ticket-merge"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="flex-1 rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            <option value="">Merge into…</option>
            {targets.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.subject} ({candidate.id})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!choice || merge.isPending}
            onClick={() => {
              merge.mutate({ ticketId: ticket.id, into: choice });
              setChoice('');
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
          >
            Merge
          </button>
        </div>
      )}

      {(merge.isError || unmerge.isError) && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {merge.error?.message ?? unmerge.error?.message ?? 'Could not change the merge.'}
        </p>
      )}
    </section>
  );
}

export function TicketDetailPane({
  ticketId,
  candidates,
}: {
  ticketId: string | null;
  candidates: Ticket[];
}): ReactElement {
  const ticket = useTicket(ticketId);
  const update = useUpdateTicket(ticketId);
  const unmerge = useUnmergeTicket();
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
  // A merged ticket is folded under its primary; the server refuses edits until
  // it is unmerged, so the controls follow that rule rather than letting an
  // agent try a change that can only bounce back.
  const merged = data.merged_into_id !== null;
  const priorityValue = String(nearestPriority(data.priority).value);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h2 className="flex-1 truncate text-sm font-semibold">{data.subject}</h2>
        <PriorityPill value={data.priority} />
        <span className="font-mono text-2xs text-content-tertiary">{data.id}</span>
        <StatusDot tone={toneFor(data.status)} label={data.status} />
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {merged && (
          <MergedBanner
            ticket={data}
            onUnmerge={() => unmerge.mutate(data.id)}
            pending={unmerge.isPending}
          />
        )}

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
              disabled={merged}
              onChange={(event) => setSubject(event.target.value)}
              className="flex-1 rounded-md border border-border bg-inset px-2.5 py-1.5 text-sm disabled:opacity-40"
            />
            <button
              type="button"
              // Disabled until something actually changed: a save button that
              // is always live invites saving nothing and wondering if it worked.
              disabled={!dirty || merged || update.isPending}
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
            disabled={merged || update.isPending}
            onChange={(event) => update.mutate({ status: event.target.value as TicketStatus })}
            className="w-full max-w-xs rounded-md border border-border bg-inset px-2 py-1.5 text-sm disabled:opacity-40"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <label
            htmlFor="ticket-priority"
            className="mb-1.5 mt-6 block text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            Priority
          </label>
          <select
            id="ticket-priority"
            value={priorityValue}
            disabled={merged || update.isPending}
            onChange={(event) => update.mutate({ priority: Number(event.target.value) })}
            className="w-full max-w-xs rounded-md border border-border bg-inset px-2 py-1.5 text-sm disabled:opacity-40"
          >
            {TICKET_PRIORITIES.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>

          {update.isError && (
            <p role="alert" className="mt-3 text-xs text-danger">
              Could not save that change.
            </p>
          )}
        </div>

        {/* A merged ticket manages nothing of its own — followers and further
            merges belong to its primary — so these are hidden while it is folded in. */}
        {!merged && (
          <>
            <FollowersSection ticket={data} />
            <MergeSection ticket={data} candidates={candidates} />
          </>
        )}
      </div>
    </main>
  );
}
