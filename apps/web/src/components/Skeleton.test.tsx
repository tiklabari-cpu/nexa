/**
 * The shared loading placeholder (FR-EK-B.1, design-brief §1.5): every Must list
 * flashes the *same* row skeleton, and that skeleton must never reach the
 * accessibility tree — otherwise a screen reader hears a list of empty rows and
 * `getByRole('list')` matches placeholder instead of data.
 *
 * The last block wires the primitive through a real Must list (Tickets, the one
 * that is a pure prop-driven component) to prove the loop the KK cares about:
 * loading → skeleton, empty → a *meaningful* empty state (a heading and a next
 * step, not a bare rectangle), rows → a real list.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListSkeleton, Skeleton } from './Skeleton.js';
import { TicketList } from '../features/inbox/TicketPane.js';
import type { Ticket } from '../features/inbox/types.js';

function makeTicket(i: number): Ticket {
  return {
    id: `t${i}`,
    subject: `Ticket ${i}`,
    status: 'open',
    assignee_id: null,
    assignee_name: null,
    group_id: null,
    customer_id: null,
    customer_name: `Customer ${i}`,
    customer_email: null,
    source_chat_id: null,
    last_message_at: null,
    created_at: new Date(0).toISOString(),
  };
}

describe('Skeleton atom', () => {
  it('paints one inset bar at the width and height it is given', () => {
    const { container } = render(<Skeleton width="45%" height="1rem" />);
    const bar = container.firstChild as HTMLElement;
    expect(bar).toHaveStyle({ width: '45%', height: '1rem' });
    expect(bar).toHaveClass('bg-inset');
  });
});

describe('ListSkeleton', () => {
  it('renders one placeholder row per requested row', () => {
    const { container } = render(<ListSkeleton rows={3} />);
    expect(container.querySelectorAll('li')).toHaveLength(3);
  });

  it('defaults to five rows', () => {
    const { container } = render(<ListSkeleton />);
    expect(container.querySelectorAll('li')).toHaveLength(5);
  });

  it('is hidden from assistive tech, so it never reads as a real list', () => {
    const { container } = render(<ListSkeleton rows={3} />);
    // aria-hidden keeps the placeholder out of the a11y tree entirely.
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    const ul = container.querySelector('ul');
    expect(ul).toHaveAttribute('aria-hidden', 'true');
    expect(ul).toHaveClass('animate-pulse');
  });
});

describe('a Must list (Tickets) across its three states', () => {
  const noop = vi.fn();

  it('shows the skeleton while loading — not a list and not an empty message', () => {
    const { container } = render(
      <TicketList tickets={[]} loading selectedId={null} onSelect={noop} />,
    );
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/no tickets/i)).toBeNull();
  });

  it('shows a meaningful empty state — a heading and a next step, not a bare rectangle', () => {
    const { container } = render(
      <TicketList tickets={[]} loading={false} selectedId={null} onSelect={noop} />,
    );
    expect(screen.getByText('No tickets here')).toBeInTheDocument();
    expect(screen.getByText(/follow-up work/i)).toBeInTheDocument();
    // The empty state is neither the skeleton nor a list.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders the rows in a real list once data arrives', () => {
    render(
      <TicketList
        tickets={[makeTicket(1), makeTicket(2)]}
        loading={false}
        selectedId={null}
        onSelect={noop}
      />,
    );
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('Ticket 1')).toBeInTheDocument();
    expect(screen.getByText('Ticket 2')).toBeInTheDocument();
  });
});
