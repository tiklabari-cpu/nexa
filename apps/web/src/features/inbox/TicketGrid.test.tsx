/**
 * The Tickets grid (FR-MOD-02.7) as rendered. The ordering itself is proven in
 * `ticket-grid.test.ts`; these pin the two KK behaviours onto the DOM — a header
 * that reports and requests a sort (`aria-sort` + `onSort`), and a row that opens
 * the ticket conversation — plus the loading and empty states the PRD lists.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketGrid } from './TicketGrid.js';
import { DEFAULT_TICKET_SORT } from './ticket-grid.js';
import { TICKET_BULK_MAX } from './ticket-selection.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
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
    last_message_at: '2026-06-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const TICKETS = [
  makeTicket({ id: 'TCK1', subject: 'Broken checkout', customer_name: 'Mira Haddad' }),
  makeTicket({ id: 'TCK2', subject: 'Refund request', customer_name: 'Sam Okoro' }),
];

function renderGrid(props: Partial<Parameters<typeof TicketGrid>[0]> = {}) {
  const onSort = vi.fn();
  const onOpen = vi.fn();
  render(
    <TicketGrid
      tickets={TICKETS}
      loading={false}
      sort={DEFAULT_TICKET_SORT}
      onSort={onSort}
      onOpen={onOpen}
      selectedId={null}
      {...props}
    />,
  );
  return { onSort, onOpen };
}

describe('TicketGrid', () => {
  it('marks the active column with aria-sort and leaves the others none', () => {
    renderGrid({ sort: { key: 'last_message', order: 'desc' } });
    expect(screen.getByRole('columnheader', { name: /Last message/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: /Subject/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('asks to sort by the column when its header is clicked', async () => {
    const { onSort } = renderGrid();
    await userEvent.click(screen.getByRole('button', { name: 'Subject' }));
    expect(onSort).toHaveBeenCalledWith('subject');
  });

  it('offers no control on the two columns the server cannot order by', () => {
    // Status and assignee are rendered but not sortable (`TICKET_SORT_KEYS`).
    // The header has to be plain text rather than a disabled-looking button:
    // the sorting is the server's, over the whole collection, and a control
    // that could only re-order the rows this browser holds would look exactly
    // like one that sorts the queue.
    renderGrid();
    for (const label of ['Status', 'Assignee']) {
      const header = screen.getByRole('columnheader', { name: label });
      expect(within(header).queryByRole('button')).toBeNull();
      expect(header).not.toHaveAttribute('aria-sort');
    }
  });

  it('opens the ticket conversation when a row is clicked', async () => {
    const { onOpen } = renderGrid();
    // The subject is the row's keyboard-reachable link into the conversation.
    await userEvent.click(screen.getByRole('button', { name: 'Refund request' }));
    expect(onOpen).toHaveBeenCalledWith('TCK2');
  });

  it('renders the rows in the order it is given', () => {
    renderGrid();
    const rows = screen.getAllByRole('row');
    // rows[0] is the header; data rows follow in order (spacers are aria-hidden).
    expect(within(rows[1]!).getByText('Broken checkout')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Refund request')).toBeInTheDocument();
  });

  it('shows a skeleton while loading and no table', () => {
    renderGrid({ loading: true });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Broken checkout')).toBeNull();
  });

  it('shows an empty state when there are no tickets', () => {
    renderGrid({ tickets: [] });
    expect(screen.getByText('No tickets here')).toBeInTheDocument();
  });

  it('shows "Ticket views unavailable" instead of the empty state when the list request failed (FR-MOD-02.1.3)', () => {
    renderGrid({ tickets: [], error: true });
    expect(screen.getByText('Ticket views unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No tickets here')).toBeNull();
  });

  it('forwards onEndReached to the shared virtualizer (NFR-P5)', () => {
    // The grid's two rows fit inside the virtualizer's fallback viewport, so
    // the window already covers the end on mount — proving the prop reaches
    // `VirtualTable` without re-testing the scroll maths themselves
    // (`VirtualList.test.tsx` owns those).
    const onEndReached = vi.fn();
    renderGrid({ onEndReached });
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });
});

/**
 * The selection column (FR-13-EK.3 · FR-MOD-02.7.1). The model itself is proven
 * in `ticket-selection.test.ts`; these pin the three things only the DOM can
 * answer — the column is absent unless a caller asks for it, a partial
 * selection reads as partial, and ticking a box is not the same gesture as
 * opening the ticket.
 */
describe('TicketGrid selection column', () => {
  const withSelection = (selected: string[], props: Record<string, unknown> = {}) => {
    const onToggleOne = vi.fn();
    const onToggleAll = vi.fn();
    const rest = renderGrid({
      selection: new Set(selected),
      onToggleOne,
      onToggleAll,
      ...props,
    });
    return { onToggleOne, onToggleAll, ...rest };
  };

  it('renders no checkbox at all for a caller with no bulk surface', () => {
    renderGrid();
    // The Customers grid and the tests above render the same component without
    // the three selection props; growing a dead column there would be the
    // regression.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('adds one box per row plus the header, without losing a column', () => {
    withSelection([]);
    expect(screen.getAllByRole('checkbox')).toHaveLength(TICKETS.length + 1);
    expect(screen.getByRole('columnheader', { name: /Subject/ })).toBeInTheDocument();
  });

  it('asks to toggle the row it belongs to, and does not open the ticket', async () => {
    const { onToggleOne, onOpen } = withSelection([]);
    await userEvent.click(screen.getByRole('checkbox', { name: /Broken checkout/ }));
    expect(onToggleOne).toHaveBeenCalledWith('TCK1');
    // The row opens on click; without the cell swallowing it, ticking a box
    // would navigate away from the grid the selection lives in and lose it.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows a partial selection as indeterminate rather than as empty', () => {
    withSelection(['TCK1']);
    const header = screen.getByRole('checkbox', { name: /Select every loaded ticket/ });
    // React does not forward `indeterminate`, so this is the assertion that
    // fails if the ref that sets the DOM property is dropped — and an empty box
    // above one ticked row reads as "nothing is selected".
    expect((header as HTMLInputElement).indeterminate).toBe(true);
    expect(header).not.toBeChecked();
  });

  it('ticks the header box only when every loaded row is selected', () => {
    withSelection(TICKETS.map((ticket) => ticket.id));
    const header = screen.getByRole('checkbox', { name: /Select every loaded ticket/ });
    expect(header).toBeChecked();
    expect((header as HTMLInputElement).indeterminate).toBe(false);
  });

  it('disables select-all once the grid holds more rows than one action covers', () => {
    const many = Array.from({ length: TICKET_BULK_MAX + 1 }, (_, i) =>
      makeTicket({ id: `T${String(i)}`, subject: `Row ${String(i)}` }),
    );
    withSelection([], { tickets: many });
    // Refused, not truncated: a box labelled "all" that silently means "the
    // first fifty" is the one outcome a bulk action must never have.
    expect(screen.getByRole('checkbox', { name: /Select every loaded ticket/ })).toBeDisabled();
  });

  it('stops offering unticked rows once the selection is full', () => {
    // A full selection whose other members are on pages this browser has
    // scrolled past: `TCK1` is in it, `TCK2` is not, and the ceiling is reached.
    const full = [
      'TCK1',
      ...Array.from({ length: TICKET_BULK_MAX - 1 }, (_, i) => `OFFSCREEN${String(i)}`),
    ];
    withSelection(full);

    expect(screen.getByRole('checkbox', { name: /Refund request/ })).toBeDisabled();
    // …and the ones already ticked stay operable, or the ceiling is a trap.
    expect(screen.getByRole('checkbox', { name: /Broken checkout/ })).toBeEnabled();
  });
});

describe('TicketGrid localisation (NFR-I18N2)', () => {
  afterEach(() => resetLocale());

  it('paints the grid in Turkish when that is the active locale', () => {
    renderWithLocale(
      <TicketGrid
        tickets={TICKETS}
        loading={false}
        sort={DEFAULT_TICKET_SORT}
        onSort={vi.fn()}
        onOpen={vi.fn()}
        selectedId={null}
      />,
      'tr',
    );
    expect(screen.getByRole('columnheader', { name: /Son mesaj/ })).toBeInTheDocument();
  });
});
