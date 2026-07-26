/**
 * The Tickets grid — sorting model and URL-param deep-link (PRD FR-MOD-02.7).
 *
 * The grid is sortable by any column, and the sort is carried in the URL
 * (`ticket_sort` + `ticket_order`) so a sorted view is shareable and survives a
 * reload — the "URL param sıralama" the PRD asks for. The sort is applied to the
 * rows the list has already loaded rather than refetched: the collection is
 * keyset-paginated newest-first on the server, and re-ordering the loaded window
 * client-side is honest for a grid and keeps this a pure, testable function.
 *
 * Pure on purpose. The bucketing that has the subtle bugs — nulls-last
 * regardless of direction, a stable tiebreak so equal rows never jitter — lives
 * here and is tested in isolation, not through the rendered table.
 */
import type { Ticket, TicketStatus } from './types.js';

export type TicketSortKey =
  'subject' | 'customer' | 'status' | 'priority' | 'assignee' | 'last_message';

export type SortOrder = 'asc' | 'desc';

export interface TicketSort {
  key: TicketSortKey;
  order: SortOrder;
}

export interface TicketColumn {
  key: TicketSortKey;
  label: string;
  align?: 'left' | 'right';
  /** The order a fresh click on this column starts from. */
  defaultOrder: SortOrder;
}

/**
 * The grid's columns, in display order. Text columns open ascending (A→Z reads
 * naturally); the "how urgent / how recent" columns open descending, so a first
 * click surfaces what needs attention rather than the oldest, lowest row.
 */
export const TICKET_COLUMNS: readonly TicketColumn[] = [
  { key: 'subject', label: 'Subject', defaultOrder: 'asc' },
  { key: 'customer', label: 'Customer', defaultOrder: 'asc' },
  { key: 'status', label: 'Status', defaultOrder: 'asc' },
  { key: 'priority', label: 'Priority', defaultOrder: 'desc' },
  { key: 'assignee', label: 'Assignee', defaultOrder: 'asc' },
  { key: 'last_message', label: 'Last message', align: 'right', defaultOrder: 'desc' },
];

/** Matches the server's default order — newest activity first (`ticket-service`). */
export const DEFAULT_TICKET_SORT: TicketSort = { key: 'last_message', order: 'desc' };

export const TICKET_SORT_PARAM = 'ticket_sort';
export const TICKET_ORDER_PARAM = 'ticket_order';

const KEYS = new Set<string>(TICKET_COLUMNS.map((column) => column.key));

/** Status ordered by where it sits in a ticket's life, not alphabetically. */
const STATUS_ORDER: Record<TicketStatus, number> = {
  open: 0,
  pending: 1,
  solved: 2,
  closed: 3,
  spam: 4,
};

function columnDefaultOrder(key: TicketSortKey): SortOrder {
  return TICKET_COLUMNS.find((column) => column.key === key)?.defaultOrder ?? 'asc';
}

/**
 * The comparable value for a column, or `null` when the ticket has none. `null`
 * is returned rather than a sentinel so the sort can float empty cells to the
 * bottom in *both* directions — an unassigned or activity-less ticket should
 * never outrank a real one just because the order flipped.
 */
function cellValue(ticket: Ticket, key: TicketSortKey): string | number | null {
  switch (key) {
    case 'subject':
      return ticket.subject;
    case 'customer':
      return ticket.customer_name;
    case 'assignee':
      return ticket.assignee_name;
    case 'status':
      return STATUS_ORDER[ticket.status];
    case 'priority':
      return ticket.priority;
    case 'last_message':
      return ticket.last_message_at ? Date.parse(ticket.last_message_at) : null;
  }
}

/** Stable tiebreak: id descending, matching the server's secondary order. */
function tiebreak(a: Ticket, b: Ticket): number {
  return b.id.localeCompare(a.id);
}

/**
 * Sort a loaded page of tickets by one column. Non-mutating (returns a copy),
 * nulls always last, and equal rows fall back to a deterministic id order so the
 * table never reshuffles rows that compare the same.
 */
export function sortTickets(tickets: readonly Ticket[], sort: TicketSort): Ticket[] {
  const direction = sort.order === 'asc' ? 1 : -1;
  return [...tickets].sort((a, b) => {
    const va = cellValue(a, sort.key);
    const vb = cellValue(b, sort.key);

    const aNull = va === null;
    const bNull = vb === null;
    if (aNull && bNull) return tiebreak(a, b);
    if (aNull) return 1;
    if (bNull) return -1;

    const cmp =
      typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });

    return cmp !== 0 ? cmp * direction : tiebreak(a, b);
  });
}

/** Whether the sort is pinned in the URL — the signal a link opens the grid. */
export function hasTicketSortParams(params: URLSearchParams): boolean {
  return params.has(TICKET_SORT_PARAM);
}

/**
 * Read the sort out of the URL, tolerating partial or stale links. A valid key
 * with a missing/garbled order falls back to that column's default order rather
 * than discarding the whole thing, so `?ticket_sort=subject` still sorts.
 */
export function parseTicketSort(params: URLSearchParams): TicketSort {
  const key = params.get(TICKET_SORT_PARAM);
  if (!key || !KEYS.has(key)) return DEFAULT_TICKET_SORT;

  const order = params.get(TICKET_ORDER_PARAM);
  return {
    key: key as TicketSortKey,
    order: order === 'asc' || order === 'desc' ? order : columnDefaultOrder(key as TicketSortKey),
  };
}

/** A copy of `params` with the sort written in, for `setSearchParams`. */
export function writeTicketSort(params: URLSearchParams, sort: TicketSort): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(TICKET_SORT_PARAM, sort.key);
  next.set(TICKET_ORDER_PARAM, sort.order);
  return next;
}

/** A copy of `params` with the sort stripped — used when leaving the grid. */
export function clearTicketSort(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(TICKET_SORT_PARAM);
  next.delete(TICKET_ORDER_PARAM);
  return next;
}

/**
 * The sort a header click produces: the same column flips direction, a new
 * column adopts its own default order (rather than inheriting the last one,
 * which would open some columns in a confusing direction).
 */
export function toggleTicketSort(current: TicketSort, key: TicketSortKey): TicketSort {
  if (current.key === key) {
    return { key, order: current.order === 'asc' ? 'desc' : 'asc' };
  }
  return { key, order: columnDefaultOrder(key) };
}

/** The `aria-sort` value for a header, so assistive tech announces the order. */
export function ariaSortFor(
  sort: TicketSort,
  key: TicketSortKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.order === 'asc' ? 'ascending' : 'descending';
}
