/**
 * The Contacts table sorting + URL model (FR-MOD-03.2.3). Mirrors
 * `../inbox/ticket-grid.test.ts`: the ordering itself is proven server-side
 * (`customers.test.ts`, against a fixture larger than a page); what belongs
 * here is what stayed client-side — which columns may be sorted at all, what a
 * header click means, and a URL that tolerates a half-written link.
 */
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_COLUMNS,
  DEFAULT_CUSTOMER_SORT,
  ariaSortFor,
  isSortableColumn,
  parseCustomerSort,
  toggleCustomerSort,
  writeCustomerSort,
} from './customer-grid.js';

describe('the sortable columns', () => {
  it('marks exactly the columns the server can order the collection by', () => {
    const sortable = CUSTOMER_COLUMNS.filter((column) => isSortableColumn(column.key));
    expect(sortable.map((column) => column.key)).toEqual(['name', 'country', 'last_activity']);

    // Email/phone/chats/tickets are rendered but not sortable: chats/tickets
    // are license-scoped counts the database cannot order the whole collection
    // by without disagreeing with the number in the cell (`CUSTOMER_SORT_KEYS`,
    // `@nexa/types`), and email/phone were left unsorted for this round.
    expect(
      CUSTOMER_COLUMNS.filter((column) => !isSortableColumn(column.key)).map((c) => c.key),
    ).toEqual(['email', 'phone', 'chats', 'tickets']);
  });

  it('gives every sortable column a starting direction and no other one', () => {
    // A column with a `defaultOrder` but no server support would be a header
    // that looks live and is refused; the reverse would toggle into `undefined`.
    for (const column of CUSTOMER_COLUMNS) {
      expect(column.defaultOrder === null).toBe(!isSortableColumn(column.key));
    }
  });
});

describe('parseCustomerSort', () => {
  it('reads a full sort from the URL', () => {
    const params = new URLSearchParams({ customer_sort: 'name', customer_order: 'desc' });
    expect(parseCustomerSort(params)).toEqual({ key: 'name', order: 'desc' });
  });

  it("falls back to the column's default order when the order is missing", () => {
    expect(parseCustomerSort(new URLSearchParams({ customer_sort: 'name' }))).toEqual({
      key: 'name',
      order: 'asc',
    });
    expect(parseCustomerSort(new URLSearchParams({ customer_sort: 'last_activity' }))).toEqual({
      key: 'last_activity',
      order: 'desc',
    });
  });

  it('falls back to the default sort for an unknown key or empty params', () => {
    expect(parseCustomerSort(new URLSearchParams({ customer_sort: 'nonsense' }))).toEqual(
      DEFAULT_CUSTOMER_SORT,
    );
    expect(parseCustomerSort(new URLSearchParams())).toEqual(DEFAULT_CUSTOMER_SORT);
  });

  it('falls back for a column the server will not sort by, rather than sending it', () => {
    // The API answers an unsupported `sort` with a 400 (`customers.test.ts`),
    // so a stale or hand-edited link has to read as no key at all.
    for (const key of ['chats', 'tickets', 'created_at']) {
      expect(
        parseCustomerSort(new URLSearchParams({ customer_sort: key, customer_order: 'asc' })),
      ).toEqual(DEFAULT_CUSTOMER_SORT);
    }
  });
});

describe('URL round-trip and header toggles', () => {
  it('writes the sort params without disturbing other params', () => {
    const base = new URLSearchParams({ customer: 'C9' });
    const written = writeCustomerSort(base, { key: 'country', order: 'desc' });
    expect(written.get('customer_sort')).toBe('country');
    expect(written.get('customer_order')).toBe('desc');
    expect(written.get('customer')).toBe('C9');
  });

  it('toggles direction on the same column and adopts a new column default', () => {
    const start = { key: 'name', order: 'asc' } as const;
    expect(toggleCustomerSort(start, 'name')).toEqual({ key: 'name', order: 'desc' });
    // A new column starts from its own default (last_activity → desc), not asc.
    expect(toggleCustomerSort(start, 'last_activity')).toEqual({
      key: 'last_activity',
      order: 'desc',
    });
  });
});

describe('ariaSortFor', () => {
  it('reports the order for the active column and none for the rest', () => {
    const sort = { key: 'country', order: 'desc' } as const;
    expect(ariaSortFor(sort, 'country')).toBe('descending');
    expect(ariaSortFor({ key: 'name', order: 'asc' }, 'name')).toBe('ascending');
    expect(ariaSortFor(sort, 'name')).toBe('none');
    // A column that can never be the active one still has to answer.
    expect(ariaSortFor(sort, 'chats')).toBe('none');
  });
});
