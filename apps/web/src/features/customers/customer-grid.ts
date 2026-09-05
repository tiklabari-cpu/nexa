/**
 * The Contacts table — sortable columns and URL-param deep-link (PRD FR-MOD-03.2.3).
 *
 * Mirrors `../inbox/ticket-grid.ts`: the sort lives in the URL (`customer_sort`
 * + `customer_order`) so a sorted view is shareable and survives a reload, and
 * **the server does the sorting** (`GET /customers?sort=…&order=…`) over the
 * whole collection, not the page this browser happens to hold — re-ordering a
 * keyset-paginated loaded window answers a different question than the header
 * claims to (the D3 pattern the audit named), and the row that belongs at the
 * top of a newly sorted list is usually one that was never fetched.
 */
import { CUSTOMER_SORT_KEYS, type CustomerSortKey, type SortOrder } from '@nexa/types';

export type { SortOrder, CustomerSortKey };

/** Every column the table renders — a superset of the sortable ones. */
export type CustomerColumnKey = CustomerSortKey | 'email' | 'phone' | 'chats' | 'tickets';

export interface CustomerSort {
  key: CustomerSortKey;
  order: SortOrder;
}

export interface CustomerColumn {
  key: CustomerColumnKey;
  align?: 'left' | 'right';
  /**
   * The order a fresh click on this column starts from, or `null` when the
   * column cannot be sorted at all.
   */
  defaultOrder: SortOrder | null;
}

/**
 * The table's columns, in the PRD's own order (Name/Email/Phone/Country/Last
 * active/Chats/Tickets). Name and Country open ascending (A→Z reads
 * naturally); Last active opens descending, surfacing whoever wrote most
 * recently first.
 *
 * Email, Phone, Chats and Tickets carry no sort control. `chats`/`tickets` are
 * absent from `CUSTOMER_SORT_KEYS` (`@nexa/types`) because the database cannot
 * order the whole collection by a license-scoped count without disagreeing
 * with the number printed in the cell — the same reason the Tickets grid
 * leaves out `status`/`assignee`. Email/Phone are personal-data columns this
 * round left unsorted rather than adding index/exposure surface for a case the
 * task did not ask for (`#### K03.2.3`).
 */
export const CUSTOMER_COLUMNS: readonly CustomerColumn[] = [
  { key: 'name', defaultOrder: 'asc' },
  { key: 'email', defaultOrder: null },
  { key: 'phone', defaultOrder: null },
  { key: 'country', defaultOrder: 'asc' },
  { key: 'last_activity', defaultOrder: 'desc' },
  { key: 'chats', align: 'right', defaultOrder: null },
  { key: 'tickets', align: 'right', defaultOrder: null },
];

/** Matches the server's default order (`customer-service.ts`). */
export const DEFAULT_CUSTOMER_SORT: CustomerSort = { key: 'last_activity', order: 'desc' };

export const CUSTOMER_SORT_PARAM = 'customer_sort';
export const CUSTOMER_ORDER_PARAM = 'customer_order';

const KEYS = new Set<string>(CUSTOMER_SORT_KEYS);

/** Whether a column can be sorted — the type guard the header rendering needs. */
export function isSortableColumn(key: CustomerColumnKey): key is CustomerSortKey {
  return KEYS.has(key);
}

function columnDefaultOrder(key: CustomerSortKey): SortOrder {
  return CUSTOMER_COLUMNS.find((column) => column.key === key)?.defaultOrder ?? 'asc';
}

/**
 * Read the sort out of the URL, tolerating partial or stale links. A valid key
 * with a missing/garbled order falls back to that column's default order; a
 * key the server cannot sort by — including an old link naming `chats` or
 * `tickets` — falls back to the default rather than being sent on to be
 * refused: a shared link should open the table, not an error.
 */
export function parseCustomerSort(params: URLSearchParams): CustomerSort {
  const key = params.get(CUSTOMER_SORT_PARAM);
  if (!key || !KEYS.has(key)) return DEFAULT_CUSTOMER_SORT;

  const order = params.get(CUSTOMER_ORDER_PARAM);
  return {
    key: key as CustomerSortKey,
    order: order === 'asc' || order === 'desc' ? order : columnDefaultOrder(key as CustomerSortKey),
  };
}

/** A copy of `params` with the sort written in, for `setSearchParams`. */
export function writeCustomerSort(params: URLSearchParams, sort: CustomerSort): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(CUSTOMER_SORT_PARAM, sort.key);
  next.set(CUSTOMER_ORDER_PARAM, sort.order);
  return next;
}

/**
 * The sort a header click produces: the same column flips direction, a new
 * column adopts its own default order (rather than inheriting the last one,
 * which would open some columns in a confusing direction).
 */
export function toggleCustomerSort(current: CustomerSort, key: CustomerSortKey): CustomerSort {
  if (current.key === key) {
    return { key, order: current.order === 'asc' ? 'desc' : 'asc' };
  }
  return { key, order: columnDefaultOrder(key) };
}

/** The `aria-sort` value for a header, so assistive tech announces the order. */
export function ariaSortFor(
  sort: CustomerSort,
  key: CustomerColumnKey,
): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none';
  return sort.order === 'asc' ? 'ascending' : 'descending';
}
