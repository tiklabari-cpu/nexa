/**
 * The Tickets grid (PRD FR-MOD-02.7) — the sortable, deep-linkable table half of
 * the ticket surface.
 *
 * A grid rather than the narrow inbox list because tickets are compared across
 * columns (who owns it, how urgent, when it last moved) the way a chat list is
 * not. Four of the six headers sort — the server does the sorting, over the
 * whole collection, and the two it cannot order by say so by not being buttons
 * (`ColumnHeader` below). The sort lives in the URL so a link reopens the same
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
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { hasElevatedPriority, nearestPriority } from './ticket-priority.js';
import {
  TICKET_COLUMNS,
  ariaSortFor,
  isSortableColumn,
  type TicketColumn,
  type TicketColumnKey,
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

/** Display word for the raw status enum — kept in one place so the grid and the pane agree. */
const STATUS_LABEL_KEY: Record<TicketStatus, string> = {
  open: 'inbox.ticketStatus.open',
  pending: 'inbox.ticketStatus.pending',
  solved: 'inbox.ticketStatus.solved',
  closed: 'inbox.ticketStatus.closed',
  spam: 'inbox.ticketStatus.spam',
};

/** Display word for a named priority level — `nearestPriority().label` is English-only. */
const PRIORITY_LABEL_KEY: Record<string, string> = {
  Urgent: 'inbox.priority.urgent',
  High: 'inbox.priority.high',
  Normal: 'inbox.priority.normal',
  Low: 'inbox.priority.low',
};

/** Display word for a grid column — `TICKET_COLUMNS[].label` is English-only. */
const COLUMN_LABEL_KEY: Record<TicketColumnKey, string> = {
  subject: 'inbox.ticketGrid.column.subject',
  customer: 'inbox.ticketGrid.column.customer',
  status: 'inbox.ticketGrid.column.status',
  priority: 'inbox.ticketGrid.column.priority',
  assignee: 'inbox.ticketGrid.column.assignee',
  last_message: 'inbox.ticketGrid.column.lastMessage',
};

/** The priority cell: a named level, muted when it is the unremarkable default. */
function PriorityCell({ value, t }: { value: number; t: TFunction }): ReactElement {
  const level = nearestPriority(value);
  const label = t(PRIORITY_LABEL_KEY[level.label] ?? level.label);
  if (!hasElevatedPriority(value)) {
    return <span className="text-content-tertiary">{label}</span>;
  }
  const tone = level.tone === 'danger' ? 'text-danger' : 'text-warning';
  return <span className={tone}>{label}</span>;
}

/**
 * A column header. Sortable ones are a button carrying `aria-sort`; the rest are
 * plain text, deliberately not a control that does nothing.
 *
 * Status and Assignee are the plain two, and they are not an oversight — the
 * server cannot order the whole collection by either (`TICKET_SORT_KEYS`,
 * `@nexa/types`), and a header that only re-orders the fifty rows this browser
 * happens to hold looks exactly like one that sorts the queue. Offering the
 * gesture and answering a different question is worse than not offering it; the
 * ticket views already slice by status and by "assigned to me".
 */
function ColumnHeader({
  column,
  sort,
  onSort,
  t,
}: {
  column: TicketColumn;
  sort: TicketSort;
  onSort: (key: TicketSortKey) => void;
  t: TFunction;
}): ReactElement {
  const className = `px-4 py-2 text-xs font-medium text-content-secondary ${
    column.align === 'right' ? 'text-right' : 'text-left'
  }`;
  const label = t(COLUMN_LABEL_KEY[column.key]);

  if (!isSortableColumn(column.key)) {
    return (
      <th scope="col" className={className}>
        {label}
      </th>
    );
  }

  const key = column.key;
  const active = sort.key === key;
  const glyph = active ? (sort.order === 'asc' ? '▲' : '▼') : '↕';
  return (
    <th scope="col" aria-sort={ariaSortFor(sort, key)} className={className}>
      <button
        type="button"
        onClick={() => onSort(key)}
        className={`inline-flex items-center gap-1 hover:text-content ${
          active ? 'text-content' : ''
        }`}
      >
        <span>{label}</span>
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
  error = false,
  sort,
  onSort,
  onOpen,
  selectedId,
  onEndReached,
}: {
  tickets: Ticket[];
  loading: boolean;
  /** The list query failed (FR-MOD-02.1.3) — distinct from a filter that is
   * honestly empty, so the reader is not told "no tickets" when the real
   * answer is "couldn't ask". */
  error?: boolean;
  sort: TicketSort;
  onSort: (key: TicketSortKey) => void;
  onOpen: (id: string) => void;
  selectedId: string | null;
  /** Asks for the next page as the grid scrolls near the end (NFR-P5); omit for no effect. */
  onEndReached?: () => void;
}): ReactElement {
  const t = useTranslate();
  if (loading) {
    return <ListSkeleton rows={6} />;
  }

  if (error) {
    return (
      <EmptyState
        title={t('inbox.ticketGrid.error.title')}
        description={t('common.errors.service_unavailable')}
      />
    );
  }

  if (tickets.length === 0) {
    return (
      <EmptyState
        title={t('inbox.ticketGrid.empty.title')}
        description={t('inbox.ticketGrid.empty.description')}
      />
    );
  }

  return (
    <VirtualTable
      items={tickets}
      rowHeight={52}
      maxHeight="100%"
      onEndReached={onEndReached}
      caption={t('inbox.ticketGrid.caption')}
      colSpan={TICKET_COLUMNS.length}
      tableClassName="w-full text-sm"
      head={
        <thead>
          <tr className="border-b border-border">
            {TICKET_COLUMNS.map((column) => (
              <ColumnHeader key={column.key} column={column} sort={sort} onSort={onSort} t={t} />
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
              {ticket.customer_name ?? t('inbox.ticketGrid.visitorFallback')}
            </span>
          </td>
          <td className="px-4 py-2.5">
            <StatusDot
              tone={statusTone(ticket.status)}
              label={t(STATUS_LABEL_KEY[ticket.status])}
            />
          </td>
          <td className="px-4 py-2.5">
            <PriorityCell value={ticket.priority} t={t} />
          </td>
          <td className="px-4 py-2.5 text-content-secondary">
            {ticket.assignee_name ?? (
              <span className="text-content-tertiary">
                {t('inbox.ticketGrid.assigneeUnassigned')}
              </span>
            )}
          </td>
          <td className="px-4 py-2.5 text-right text-content-secondary">
            {formatDate(ticket.last_message_at) ?? '—'}
          </td>
        </tr>
      )}
    />
  );
}
