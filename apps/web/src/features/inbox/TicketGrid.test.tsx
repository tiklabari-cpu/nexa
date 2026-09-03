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
