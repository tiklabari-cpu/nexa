/**
 * The Tickets grid (PRD FR-MOD-02.7) — the sortable, deep-linkable table half of
 * the ticket surface.
 *
 * A grid rather than the narrow inbox list because tickets are compared across
 * columns (who owns it, how urgent, when it last moved) the way a chat list is
 * not. Every header sorts; the sort lives in the URL so a link reopens the same
 * order (see `ticket-grid.ts`). A row opens the ticket conversation — the whole
 * reason the grid exists is to get from a queue to the follow-up work behind a
 * row, so the row, not a hidden action, is the link.
 *
 * Built on the shared {@link VirtualTable} primitive (T6-a): the grid is meant
 * to hold a directory's worth of tickets at 60fps, so only the visible rows are
 * ever in the DOM.
 */
import type { ReactElement } from 'react';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { VirtualTable } from '../../components/VirtualList.js';
import { StatusDot } from '../../components/StatusDot.js';
import { formatDate } from '../../lib/format.js';
import { hasElevatedPriority, nearestPriority } from './ticket-priority.js';
import {
  TICKET_COLUMNS,
  ariaSortFor,
  type TicketColumn,
  type TicketSort,
  type TicketSortKey,
} from './ticket-grid.js';
import type { Ticket, TicketStatus } from './types.js';

/** Solved and closed read as done; spam is its own thing, and not a success. */
function statusTone(status: TicketStatus): 'success' | 'warning' | 'neutral' | 'danger' {
  if (status === 'open') return 'warning';
  if (status === 'solved' || status === 'closed') return 'success';
  if (status === 'spam') return 'danger';
  return 'neutral';
}

/** The priority cell: a named level, muted when it is the unremarkable default. */
function PriorityCell({ value }: { value: number }): ReactElement {
  const level = nearestPriority(value);
  if (!hasElevatedPriority(value)) {
    return <span className="text-content-tertiary">{level.label}</span>;
  }
  const tone = level.tone === 'danger' ? 'text-danger' : 'text-warning';
  return <span className={tone}>{level.label}</span>;
}

/** A sortable column header: a button that toggles the sort, with `aria-sort`. */
function SortHeader({
  column,
  sort,
  onSort,
}: {
  column: TicketColumn;
  sort: TicketSort;
  onSort: (key: TicketSortKey) => void;
}): ReactElement {
  const active = sort.key === column.key;
  const glyph = active ? (sort.order === 'asc' ? '▲' : '▼') : '↕';
  return (
    <th
      scope="col"
      aria-sort={ariaSortFor(sort, column.key)}
      className={`px-4 py-2 text-xs font-medium text-content-secondary ${
        column.align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={`inline-flex items-center gap-1 hover:text-content ${
          active ? 'text-content' : ''
        }`}
      >
        <span>{column.label}</span>
        <span aria-hidden="true" className={active ? '' : 'text-content-tertiary'}>
          {glyph}
        </span>
      </button>
    </th>
  );
}

export function TicketGrid({
  tickets,
  loading,
  sort,
  onSort,
  onOpen,
  selectedId,
}: {
  tickets: Ticket[];
  loading: boolean;
  sort: TicketSort;
  onSort: (key: TicketSortKey) => void;
  onOpen: (id: string) => void;
  selectedId: string | null;
}): ReactElement {
  if (loading) {
    return <ListSkeleton rows={6} />;
  }

  if (tickets.length === 0) {
    return (
      <EmptyState
        title="No tickets here"
        description="Follow-up work created from a conversation shows up in this grid."
      />
    );
  }

  return (
    <VirtualTable
      items={tickets}
      rowHeight={52}
      maxHeight="100%"
      caption="Tickets"
      colSpan={TICKET_COLUMNS.length}
      tableClassName="w-full text-sm"
      head={
        <thead>
          <tr className="border-b border-border">
            {TICKET_COLUMNS.map((column) => (
              <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
      }
      renderRow={(ticket) => (
        <tr
          key={ticket.id}
          aria-selected={selectedId === ticket.id}
          className={`cursor-pointer border-b border-border transition-colors last:border-0 ${
            selectedId === ticket.id ? 'bg-brand-100 dark:bg-brand-950' : 'hover:bg-surface-2'
          }`}
          onClick={() => onOpen(ticket.id)}
        >
          <td className="max-w-0 px-4 py-2.5">
            <button
              type="button"
              // The row is clickable for the mouse; this keeps it reachable by
              // keyboard without an interactive <tr> (mirrors the Customers grid).
              onClick={() => onOpen(ticket.id)}
              className="block max-w-full truncate text-left font-medium"
            >
              {ticket.subject}
            </button>
          </td>
          <td className="px-4 py-2.5 text-content-secondary">
            <span className="block max-w-[12rem] truncate">
              {ticket.customer_name ?? 'Visitor'}
            </span>
          </td>
          <td className="px-4 py-2.5">
            <StatusDot tone={statusTone(ticket.status)} label={ticket.status} />
          </td>
          <td className="px-4 py-2.5">
            <PriorityCell value={ticket.priority} />
          </td>
          <td className="px-4 py-2.5 text-content-secondary">
            {ticket.assignee_name ?? <span className="text-content-tertiary">Unassigned</span>}
          </td>
          <td className="px-4 py-2.5 text-right text-content-secondary">
            {formatDate(ticket.last_message_at) ?? '—'}
          </td>
        </tr>
      )}
    />
  );
}
