/**
 * The Tickets grid sorting + URL model (FR-MOD-02.7). The bucketing with the
 * subtle bugs — nulls-last in both directions, a stable tiebreak, a URL that
 * tolerates a half-written link — is proven here, away from the rendered table.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_SORT,
  ariaSortFor,
  clearTicketSort,
  hasTicketSortParams,
  parseTicketSort,
  sortTickets,
  toggleTicketSort,
  writeTicketSort,
} from './ticket-grid.js';
import type { Ticket } from './types.js';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'TCK1',
    subject: 'Broken checkout',
    status: 'open',
    priority: 0,
    assignee_id: null,
    assignee_name: null,
    group_id: null,
    customer_id: 'cust-1',
    customer_name: 'Mira Haddad',
    customer_email: null,
    source_chat_id: null,
    merged_into_id: null,
    last_message_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ids = (tickets: Ticket[]): string[] => tickets.map((t) => t.id);

describe('sortTickets', () => {
  it('sorts by subject ascending and descending, case-insensitively', () => {
    const list = [
      makeTicket({ id: 'a', subject: 'banana' }),
      makeTicket({ id: 'b', subject: 'Apple' }),
      makeTicket({ id: 'c', subject: 'cherry' }),
    ];
    expect(ids(sortTickets(list, { key: 'subject', order: 'asc' }))).toEqual(['b', 'a', 'c']);
    expect(ids(sortTickets(list, { key: 'subject', order: 'desc' }))).toEqual(['c', 'a', 'b']);
  });

  it('orders last_message newest-first by default and floats null activity last in both directions', () => {
    const list = [
      makeTicket({ id: 'old', last_message_at: '2026-01-01T00:00:00.000Z' }),
      makeTicket({ id: 'new', last_message_at: '2026-06-01T00:00:00.000Z' }),
      makeTicket({ id: 'none', last_message_at: null }),
    ];
    // desc: newest → oldest, then the activity-less row.
    expect(ids(sortTickets(list, { key: 'last_message', order: 'desc' }))).toEqual([
      'new',
      'old',
      'none',
    ]);
    // asc: oldest → newest, but the null still sinks to the bottom, not the top.
    expect(ids(sortTickets(list, { key: 'last_message', order: 'asc' }))).toEqual([
      'old',
      'new',
      'none',
    ]);
  });

  it('sorts priority numerically, urgent first when descending', () => {
    const list = [
      makeTicket({ id: 'low', priority: -50 }),
      makeTicket({ id: 'urgent', priority: 100 }),
      makeTicket({ id: 'normal', priority: 0 }),
    ];
    expect(ids(sortTickets(list, { key: 'priority', order: 'desc' }))).toEqual([
      'urgent',
      'normal',
      'low',
    ]);
  });

  it('sorts status by its lifecycle order, not alphabetically', () => {
    const list = [
      makeTicket({ id: 'spam', status: 'spam' }),
      makeTicket({ id: 'open', status: 'open' }),
      makeTicket({ id: 'solved', status: 'solved' }),
    ];
    expect(ids(sortTickets(list, { key: 'status', order: 'asc' }))).toEqual([
      'open',
      'solved',
      'spam',
    ]);
  });

  it('breaks ties by id descending so equal rows never reshuffle', () => {
    const list = [
      makeTicket({ id: 'TCK1', assignee_name: null }),
      makeTicket({ id: 'TCK3', assignee_name: null }),
      makeTicket({ id: 'TCK2', assignee_name: null }),
    ];
    // All assignee values null → all tie → deterministic id-desc fallback.
    expect(ids(sortTickets(list, { key: 'assignee', order: 'asc' }))).toEqual([
      'TCK3',
      'TCK2',
      'TCK1',
    ]);
  });

  it('does not mutate the input array', () => {
    const list = [makeTicket({ id: 'a' }), makeTicket({ id: 'b' })];
    const before = ids(list);
    sortTickets(list, { key: 'subject', order: 'desc' });
    expect(ids(list)).toEqual(before);
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
  });
});
