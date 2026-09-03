/**
 * The Tickets grid — sorting model and URL-param deep-link (PRD FR-MOD-02.7).
 *
 * The grid is sortable, and the sort is carried in the URL (`ticket_sort` +
 * `ticket_order`) so a sorted view is shareable and survives a reload — the
 * "URL param sıralama" the PRD asks for. The view filter (`ticket_view`) lives
 * in the same contract, further down this file.
 *
 * **The server does the sorting** (`GET /tickets?sort=…&order=…`). This module
 * used to re-order the rows the list had already loaded, which reads fine on a
 * fixture and is wrong on a real workspace: the collection is keyset-paginated,
 * the console holds fifty rows of it, and the row that belongs at the top of a
 * newly sorted list is usually one that was never fetched. A header that
 * answers "the first of what I happen to have" while looking like it answers
 * "the first of these tickets" is the defect the D3 audit named, and the reason
 * `sortTickets` is gone rather than kept as a fallback — two sorts over one
 * list is a way to get a third order that is neither.
 *
 * What is left here is pure and testable: which columns can be sorted at all,
 * what a header click means, and the URL round-trip.
 */
import { TICKET_SORT_KEYS, type SortOrder, type TicketSortKey } from '@nexa/types';
import type { TicketView } from './types.js';

export type { SortOrder, TicketSortKey };

/** Every column the grid renders — a superset of the sortable ones. */
export type TicketColumnKey = TicketSortKey | 'status' | 'assignee';

export interface TicketSort {
  key: TicketSortKey;
  order: SortOrder;
}

export interface TicketColumn {
  key: TicketColumnKey;
  label: string;
  align?: 'left' | 'right';
  /**
   * The order a fresh click on this column starts from, or `null` when the
   * column cannot be sorted at all — see `TICKET_SORT_KEYS` (`@nexa/types`) for
   * why `status` and `assignee` are the two: the database cannot order the
   * collection by either, and the ticket *views* already slice by both.
   */
  defaultOrder: SortOrder | null;
}

/**
 * The grid's columns, in display order. Text columns open ascending (A→Z reads
 * naturally); the "how urgent / how recent" columns open descending, so a first
 * click surfaces what needs attention rather than the oldest, lowest row.
 */
export const TICKET_COLUMNS: readonly TicketColumn[] = [
  { key: 'subject', label: 'Subject', defaultOrder: 'asc' },
  { key: 'customer', label: 'Customer', defaultOrder: 'asc' },
  { key: 'status', label: 'Status', defaultOrder: null },
  { key: 'priority', label: 'Priority', defaultOrder: 'desc' },
  { key: 'assignee', label: 'Assignee', defaultOrder: null },
  { key: 'last_message', label: 'Last message', align: 'right', defaultOrder: 'desc' },
];

/** Matches the server's default order — newest activity first (`ticket-service`). */
export const DEFAULT_TICKET_SORT: TicketSort = { key: 'last_message', order: 'desc' };

export const TICKET_SORT_PARAM = 'ticket_sort';
export const TICKET_ORDER_PARAM = 'ticket_order';

const KEYS = new Set<string>(TICKET_SORT_KEYS);

/** Whether a column can be sorted — the type guard the header rendering needs. */
export function isSortableColumn(key: TicketColumnKey): key is TicketSortKey {
  return KEYS.has(key);
}

function columnDefaultOrder(key: TicketSortKey): SortOrder {
  return TICKET_COLUMNS.find((column) => column.key === key)?.defaultOrder ?? 'asc';
}

/** Whether the sort is pinned in the URL — the signal a link opens the grid. */
export function hasTicketSortParams(params: URLSearchParams): boolean {
  return params.has(TICKET_SORT_PARAM);
}

/**
 * Read the sort out of the URL, tolerating partial or stale links. A valid key
 * with a missing/garbled order falls back to that column's default order rather
 * than discarding the whole thing, so `?ticket_sort=subject` still sorts. A key
 * the server cannot sort by — including `?ticket_sort=status`, which older
 * links do carry — falls back to the default rather than being sent on to be
 * refused: the address bar is editable, and a shared link should open the grid.
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
  key: TicketColumnKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.order === 'asc' ? 'ascending' : 'descending';
}

/**
 * The Tickets view filter — URL-param deep-link, same contract as the sort
 * above (PRD FR-MOD-02.7 / 02.1.2). `GET /tickets?view=…` already takes this;
 * what was missing was carrying the agent's choice in the address bar.
 */
export const TICKET_VIEW_PARAM = 'ticket_view';

export const DEFAULT_TICKET_VIEW: TicketView = 'all';

const TICKET_VIEW_KEYS = new Set<string>(['all', 'unassigned', 'my_open', 'solved']);

/** Whether the view filter is pinned in the URL — the signal a link opens the grid. */
export function hasTicketViewParam(params: URLSearchParams): boolean {
  return params.has(TICKET_VIEW_PARAM);
}

/**
 * Read the view filter out of the URL. An unrecognised value — a stale link,
 * or the address bar edited by hand — falls back to the default rather than
 * being sent on to the server, which refuses an unknown `view` with a `400`
 * (`routes/tickets.ts`); a shared link should open the grid, not an error.
 */
export function parseTicketView(params: URLSearchParams): TicketView {
  const raw = params.get(TICKET_VIEW_PARAM);
  return raw !== null && TICKET_VIEW_KEYS.has(raw) ? (raw as TicketView) : DEFAULT_TICKET_VIEW;
}

/** A copy of `params` with the view filter written in, for `setSearchParams`. */
export function writeTicketView(params: URLSearchParams, view: TicketView): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(TICKET_VIEW_PARAM, view);
  return next;
}

/** A copy of `params` with the view filter stripped — used when leaving the grid. */
export function clearTicketView(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(TICKET_VIEW_PARAM);
  return next;
}
