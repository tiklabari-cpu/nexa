/**
 * The Tickets grid sorting + URL model (FR-MOD-02.7).
 *
 * There used to be a `sortTickets` suite here, proving nulls-last bucketing and
 * a stable tiebreak over an array. Those tests were green and the feature was
 * wrong: the array was the page the browser had loaded, not the collection, so
 * every one of them agreed with a header that reorders fifty rows out of six
 * hundred. The sorting is the server's now (`GET /tickets?sort=…&order=…`,
 * proven in `tickets.test.ts` against a fixture larger than a page), and what
 * belongs here is what stayed client-side: which columns may be sorted at all,
 * what a header click means, and a URL that tolerates a half-written link.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_SORT,
  DEFAULT_TICKET_VIEW,
  TICKET_COLUMNS,
  ariaSortFor,
  clearTicketSort,
  clearTicketView,
  hasTicketSortParams,
  hasTicketViewParam,
  isSortableColumn,
  parseTicketSort,
  parseTicketView,
  toggleTicketSort,
  writeTicketSort,
  writeTicketView,
} from './ticket-grid.js';

describe('the sortable columns', () => {
  it('marks exactly the columns the server can order the collection by', () => {
    const sortable = TICKET_COLUMNS.filter((column) => isSortableColumn(column.key));
    expect(sortable.map((column) => column.key)).toEqual([
      'subject',
      'customer',
      'priority',
      'last_message',
    ]);

    // Status and assignee are rendered but not sortable: the database cannot
    // order by either (status is text, so its lifecycle order is not its
    // alphabetical one; a ticket stores `assignee_id` while the grid shows the
    // account's name). The views already slice by both.
    expect(
      TICKET_COLUMNS.filter((column) => !isSortableColumn(column.key)).map((c) => c.key),
    ).toEqual(['status', 'assignee']);
  });

  it('gives every sortable column a starting direction and no other one', () => {
    // A column with a `defaultOrder` but no server support would be a header
    // that looks live and is refused; the reverse would toggle into `undefined`.
    for (const column of TICKET_COLUMNS) {
      expect(column.defaultOrder === null).toBe(!isSortableColumn(column.key));
    }
  });
});

describe('parseTicketSort', () => {
  it('reads a full sort from the URL', () => {
    const params = new URLSearchParams({ ticket_sort: 'subject', ticket_order: 'asc' });
    expect(parseTicketSort(params)).toEqual({ key: 'subject', order: 'asc' });
  });

  it("falls back to the column's default order when the order is missing", () => {
    expect(parseTicketSort(new URLSearchParams({ ticket_sort: 'subject' }))).toEqual({
      key: 'subject',
      order: 'asc',
    });
    expect(parseTicketSort(new URLSearchParams({ ticket_sort: 'priority' }))).toEqual({
      key: 'priority',
      order: 'desc',
    });
  });

  it('falls back to the default sort for an unknown key or empty params', () => {
    expect(parseTicketSort(new URLSearchParams({ ticket_sort: 'nonsense' }))).toEqual(
      DEFAULT_TICKET_SORT,
    );
    expect(parseTicketSort(new URLSearchParams())).toEqual(DEFAULT_TICKET_SORT);
  });

  it('falls back for a column the server will not sort by, rather than sending it', () => {
    // `?ticket_sort=status` is a link this product used to hand out, and the
    // API answers an unsupported `sort` with a 400. A shared link has to open
    // the grid, so a key that is no longer sortable reads as no key at all.
    for (const key of ['status', 'assignee']) {
      expect(
        parseTicketSort(new URLSearchParams({ ticket_sort: key, ticket_order: 'asc' })),
      ).toEqual(DEFAULT_TICKET_SORT);
    }
  });
});

describe('URL round-trip and header toggles', () => {
  it('writes then clears the sort params without disturbing other params', () => {
    const base = new URLSearchParams({ ticket: 'TCK9' });
    const written = writeTicketSort(base, { key: 'customer', order: 'desc' });
    expect(written.get('ticket_sort')).toBe('customer');
    expect(written.get('ticket_order')).toBe('desc');
    expect(written.get('ticket')).toBe('TCK9');
    expect(hasTicketSortParams(written)).toBe(true);

    const cleared = clearTicketSort(written);
    expect(hasTicketSortParams(cleared)).toBe(false);
    expect(cleared.get('ticket')).toBe('TCK9');
  });

  it('toggles direction on the same column and adopts a new column default', () => {
    const start = { key: 'subject', order: 'asc' } as const;
    expect(toggleTicketSort(start, 'subject')).toEqual({ key: 'subject', order: 'desc' });
    // A new column starts from its own default (last_message → desc), not asc.
    expect(toggleTicketSort(start, 'last_message')).toEqual({ key: 'last_message', order: 'desc' });
  });
});

describe('ariaSortFor', () => {
  it('reports the order for the active column and none for the rest', () => {
    const sort = { key: 'priority', order: 'desc' } as const;
    expect(ariaSortFor(sort, 'priority')).toBe('descending');
    expect(ariaSortFor({ key: 'subject', order: 'asc' }, 'subject')).toBe('ascending');
    expect(ariaSortFor(sort, 'subject')).toBe('none');
    // A column that can never be the active one still has to answer.
    expect(ariaSortFor(sort, 'status')).toBe('none');
  });
});

describe('parseTicketView', () => {
  it('reads a recognised view from the URL', () => {
    for (const view of ['all', 'unassigned', 'my_open', 'solved'] as const) {
      expect(parseTicketView(new URLSearchParams({ ticket_view: view }))).toBe(view);
    }
  });

  it('falls back to the default for an unknown value or missing params', () => {
    // The address bar is editable, and `GET /tickets` 400s an unrecognised
    // `view` rather than defaulting it server-side — the client has to be the
    // one that tolerates a stale or hand-edited link.
    expect(parseTicketView(new URLSearchParams({ ticket_view: 'nonsense' }))).toBe(
      DEFAULT_TICKET_VIEW,
    );
    expect(parseTicketView(new URLSearchParams())).toBe(DEFAULT_TICKET_VIEW);
  });
});

describe('URL round-trip for the view filter', () => {
  it('writes then clears the view param without disturbing other params', () => {
    const base = new URLSearchParams({ ticket_sort: 'subject' });
    const written = writeTicketView(base, 'solved');
    expect(written.get('ticket_view')).toBe('solved');
    expect(written.get('ticket_sort')).toBe('subject');
    expect(hasTicketViewParam(written)).toBe(true);

    const cleared = clearTicketView(written);
    expect(hasTicketViewParam(cleared)).toBe(false);
    expect(cleared.get('ticket_sort')).toBe('subject');
  });

  it('writes the default view explicitly rather than omitting the param', () => {
    // Same contract as `writeTicketSort`: the value a click produces is always
    // written, even when it equals the default, so the URL always says which
    // filter is showing.
    const written = writeTicketView(new URLSearchParams(), 'all');
    expect(written.get('ticket_view')).toBe('all');
  });
});
